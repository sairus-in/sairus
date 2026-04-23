import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { redis } from '../../lib/redis';
import { jwtConfig } from '../../lib/auth-config';
import { QR } from 'shared';

interface QRPayload {
  nonce: string;
  tripId: string;
  busId: string;
  routeId: string;
  issuedAt: number;
}

export class QRService {
  private secret = jwtConfig.secret;

  /**
   * Generates a new cryptographically signed QR token and stores its nonce in Redis.
   * CRITICAL: Nonce is stored BEFORE pushing to kiosk — never push first.
   */
  async generateToken(payload: Omit<QRPayload, 'nonce' | 'issuedAt'>): Promise<string> {
    const nonce = randomUUID();
    const issuedAt = Date.now();

    const fullPayload: QRPayload = { ...payload, nonce, issuedAt };

    // Sign with explicit expiry
    const token = jwt.sign(fullPayload, this.secret, {
      expiresIn: QR.JWT_EXPIRY_SECONDS,
    });

    // Store nonce in Redis — GETDEL in check-in atomically burns it
    await redis.set(`qr:nonce:${nonce}`, 'ACTIVE', 'EX', QR.REDIS_TTL_SECONDS);

    return token;
  }
}

export const qrService = new QRService();
