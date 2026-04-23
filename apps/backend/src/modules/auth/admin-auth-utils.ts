/**
 * Admin Authentication Utilities
 * Crypto, password, TOTP, token, and fingerprint helpers
 */

import crypto from 'crypto';
import * as argon2 from 'argon2';
import * as jwtLib from 'jsonwebtoken';
import * as speakeasy from 'speakeasy';
import * as qrcode from 'qrcode';
import {
  AdminJWTPayload,
  AdminStepUpToken,
  AdminPermission,
  AdminRole,
  FingerprintSignals,
  FingerprintDriftResult,
  CONSTANTS,
  AUTH_ERROR_RESPONSES,
} from './admin-auth-types';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key';

// ─── PASSWORD HASHING ─────────────────────────────────────

/**
 * Hash password using Argon2id
 * Memory: 64MB, Iterations: 3, Time Cost: 4
 */
export async function hashPassword(password: string): Promise<string> {
  try {
    return await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: CONSTANTS.MEMORY_COST,
      timeCost: CONSTANTS.TIME_COST,
      parallelism: 4,
    });
  } catch (error) {
    throw new Error('Password hashing failed');
  }
}

/**
 * Verify password against hash (constant-time)
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch (error) {
    return false;
  }
}

/**
 * Validate password strength
 * §8.1: min 12 chars, uppercase, lowercase, number, special
 */
export function isValidPasswordStrength(password: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (password.length < CONSTANTS.PASSWORD_MIN_LENGTH) {
    errors.push(`Password must be at least ${CONSTANTS.PASSWORD_MIN_LENGTH} characters.`);
  }
  if (password.length > CONSTANTS.PASSWORD_MAX_LENGTH) {
    errors.push(`Password must not exceed ${CONSTANTS.PASSWORD_MAX_LENGTH} characters.`);
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter.');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter.');
  }
  if (!/\d/.test(password)) {
    errors.push('Password must contain at least one digit.');
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('Password must contain at least one special character.');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ─── TOTP / MFA ───────────────────────────────────────────

/**
 * Generate TOTP secret
 */
export function generateTotpSecret(): string {
  const secret = speakeasy.generateSecret({
    name: 'College Bus Admin',
    issuer: 'College Bus System',
  });
  return secret.base32;
}

/**
 * Verify TOTP code
 */
export function verifyTotp(code: string, secret: string): boolean {
  try {
    return speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token: code,
      window: CONSTANTS.TOTP_WINDOW,
    });
  } catch (error) {
    return false;
  }
}

/**
 * Generate QR code for TOTP setup
 */
export async function generateTotpQRCode(secret: string, email: string): Promise<string> {
  const otpauthUrl = speakeasy.otpauthURL({
    secret,
    label: `College Bus Admin (${email})`,
    issuer: 'College Bus System',
  });
  return qrcode.toDataURL(otpauthUrl);
}

/**
 * Encrypt TOTP secret with key
 * Uses AES-256-GCM
 */
export function encryptTotpSecret(secret: string, encryptionKey: string): string {
  const key = crypto
    .createHash('sha256')
    .update(encryptionKey)
    .digest();

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(secret, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Return: base64(iv || authTag || encrypted)
  const combined = Buffer.concat([iv, authTag, Buffer.from(encrypted, 'hex')]);
  return combined.toString('base64');
}

/**
 * Decrypt TOTP secret
 */
export function decryptTotpSecret(encryptedSecret: string, encryptionKey: string): string {
  const key = crypto
    .createHash('sha256')
    .update(encryptionKey)
    .digest();

  const combined = Buffer.from(encryptedSecret, 'base64');
  const iv = combined.slice(0, 16);
  const authTag = combined.slice(16, 32);
  const encrypted = combined.slice(32).toString('hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Generate backup codes (10 codes, 8 chars each)
 */
export function generateBackupCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < CONSTANTS.BACKUP_CODE_COUNT; i++) {
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    codes.push(code);
  }
  return codes;
}

/**
 * Hash backup code
 */
export async function hashBackupCode(code: string): Promise<string> {
  return crypto.createHash('sha256').update(code).digest('hex');
}

// ─── TOKEN GENERATION & VERIFICATION ──────────────────────

/**
 * Generate 32-byte random refresh token
 */
export function generateRefreshToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Hash token for storage (SHA256)
 */
export async function hashToken(token: string): Promise<string> {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Verify token hash
 */
export async function verifyTokenHash(token: string, hash: string): Promise<boolean> {
  const computed = crypto.createHash('sha256').update(token).digest('hex');
  // Constant-time comparison
  return crypto.timingSafeEqual(
    Buffer.from(computed),
    Buffer.from(hash)
  );
}

/**
 * Generate random token ID (JTI)
 */
export function generateTokenId(): string {
  return crypto.randomUUID();
}

/**
 * Create JWT access token payload (§3.1)
 */
export function createAccessTokenPayload(
  adminId: string,
  sessionId: string,
  role: AdminRole,
  permissions: AdminPermission[],
  fpHash: string
): AdminJWTPayload {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + CONSTANTS.ACCESS_TOKEN_TTL_MINUTES * 60;

  return {
    sub: adminId,
    sessionId,
    aud: 'admin-api',
    role,
    permissions,
    fpHash,
    iss: process.env.JWT_ISSUER || 'https://admin.busapp.university',
    iat: now,
    exp,
    jti: generateTokenId(),
    type: 'access',
  };
}

/**
 * Create step-up token payload (§6.2)
 */
export function createStepUpTokenPayload(
  adminId: string,
  sessionId: string
): AdminStepUpToken {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + CONSTANTS.STEP_UP_TOKEN_TTL_MINUTES * 60;

  return {
    sub: adminId,
    sessionId,
    type: 'step_up',
    iss: process.env.JWT_ISSUER || 'https://admin.busapp.university',
    iat: now,
    exp,
    jti: generateTokenId(),
  };
}

// ─── DEVICE FINGERPRINTING (§4) ────────────────────────────

/**
 * Compute cryptographic hash of fingerprint signals
 * Blake3 would be ideal, but use SHA256 for now
 */
export function computeFingerprintHash(signals: FingerprintSignals): string {
  const normalized = JSON.stringify({
    userAgent: signals.userAgent,
    acceptLanguage: signals.acceptLanguage,
    timezone: signals.timezone,
    screenRes: signals.screenRes,
    colorDepth: signals.colorDepth,
    platform: signals.platform,
    hardwareConcurrency: signals.hardwareConcurrency,
    deviceMemory: signals.deviceMemory || 0,
    ip: signals.ip,
    ipCountry: signals.ipCountry,
    ipASN: signals.ipASN,
  });

  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Evaluate fingerprint drift (§4.2)
 * Returns: verdict (low|medium|high), driftScore (0-100), requiresStepUp
 */
export function evaluateFingerprintDrift(
  stored: FingerprintSignals,
  current: FingerprintSignals
): FingerprintDriftResult {
  const changes: Record<string, string | number> = {};
  let driftScore = 0;

  // Evaluate each signal with weighting (§4.2)
  const weights = {
    userAgent: 20,
    acceptLanguage: 5,
    timezone: 10,
    screenRes: 10,
    colorDepth: 5,
    platform: 15,
    hardwareConcurrency: 10,
    deviceMemory: 5,
    ip: 25, // Highest weight: IP changes are suspicious
    ipCountry: 20,
    ipASN: 10,
  };

  // Check user agent
  if (stored.userAgent !== current.userAgent) {
    changes['userAgent'] = current.userAgent;
    driftScore += weights['userAgent'];
  }

  // Check language
  if (stored.acceptLanguage !== current.acceptLanguage) {
    changes['acceptLanguage'] = current.acceptLanguage;
    driftScore += weights['acceptLanguage'];
  }

  // Check timezone
  if (stored.timezone !== current.timezone) {
    changes['timezone'] = current.timezone;
    driftScore += weights['timezone'];
  }

  // Check screen resolution
  if (stored.screenRes !== current.screenRes) {
    changes['screenRes'] = current.screenRes;
    driftScore += weights['screenRes'];
  }

  // Check color depth
  if (stored.colorDepth !== current.colorDepth) {
    changes['colorDepth'] = current.colorDepth;
    driftScore += weights['colorDepth'];
  }

  // Check platform
  if (stored.platform !== current.platform) {
    changes['platform'] = current.platform;
    driftScore += weights['platform'];
  }

  // Check hardware concurrency
  if (stored.hardwareConcurrency !== current.hardwareConcurrency) {
    changes['hardwareConcurrency'] = current.hardwareConcurrency;
    driftScore += weights['hardwareConcurrency'];
  }

  // Check device memory (if available)
  if (
    (stored.deviceMemory || 0) !== (current.deviceMemory || 0) &&
    current.deviceMemory !== undefined
  ) {
    changes['deviceMemory'] = current.deviceMemory;
    driftScore += weights['deviceMemory'];
  }

  // Check IP (heavy weight)
  if (stored.ip !== current.ip) {
    changes['ip'] = current.ip;
    driftScore += weights['ip'];
  }

  // Check IP country
  if (stored.ipCountry !== current.ipCountry) {
    changes['ipCountry'] = current.ipCountry;
    driftScore += weights['ipCountry'];
  }

  // Check ASN (indicates different ISP)
  if (stored.ipASN !== current.ipASN) {
    changes['ipASN'] = current.ipASN;
    driftScore += weights['ipASN'];
  }

  // Normalize to 0-100
  driftScore = Math.min(driftScore, 100);

  // Determine verdict
  let verdict: 'low' | 'medium' | 'high';
  if (driftScore < CONSTANTS.FP_DRIFT_LOW) {
    verdict = 'low';
  } else if (driftScore < CONSTANTS.FP_DRIFT_MEDIUM) {
    verdict = 'medium';
  } else {
    verdict = 'high';
  }

  return {
    verdict,
    driftScore,
    changes,
    requiresStepUp: driftScore > CONSTANTS.FP_DRIFT_HIGH_THRESHOLD,
  };
}

// ─── RATE LIMITING HELPERS ────────────────────────────────

/**
 * Create Redis key for rate limiting
 */
export function createRateLimitKey(prefix: string, identifier: string): string {
  return `ratelimit:${prefix}:${identifier}`;
}

/**
 * Hash email for rate limit keys (prevent enumeration)
 */
export function hashEmailForRateLimit(email: string): string {
  return crypto.createHash('sha256').update(email).digest('hex').slice(0, 16);
}

// ─── TIMING HELPERS ───────────────────────────────────────

/**
 * Get current Unix timestamp in seconds
 */
export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Get remaining seconds until timestamp
 */
export function getRemainingSeconds(until: number): number {
  const remaining = until - nowSec();
  return Math.max(0, remaining);
}

// ─── RE-EXPORTS ───────────────────────────────────────────

// Re-export error responses from types
export { AUTH_ERROR_RESPONSES };
