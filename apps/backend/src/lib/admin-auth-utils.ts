/**
 * Admin Auth Utilities
 * Cryptographic operations, fingerprinting, and common helpers
 * Implements specifications from admin-auth-system.md §4, §9, §11
 */

import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import {
  FingerprintSignalsClient,
  FingerprintSignalsServer,
  FingerprintSignals,
  FingerprintDriftResult,
  FingerprintVerdict,
  CONSTANTS,
  AdminJWTPayload,
  StepUpTokenPayload,
  InviteTokenPayload,
  TokenType,
} from '../modules/auth/admin-auth.types';

// ─── PASSWORD HASHING (§2.2) ──────────────────────────────────

/**
 * Hash password with bcrypt
 * Rounds: 12 (high security for internal admin panel)
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, CONSTANTS.BCRYPT_ROUNDS);
}

/**
 * Verify password against hash
 * Uses constant-time comparison
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ─── TOKEN GENERATION ──────────────────────────────────────

/**
 * Generate random refresh token (32 bytes raw)
 * Stored as bcrypt hash in database
 */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Generate random invite token (32 bytes)
 */
export function generateInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Generate random step-up token ID for Redis
 */
export function generateStepUpTokenId(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Hash token for database storage
 * Using bcrypt with rounds=10 (faster than password hashing, but still secure)
 */
export async function hashToken(token: string): Promise<string> {
  return bcrypt.hash(token, 10);
}

/**
 * Verify token against hash
 */
export async function verifyTokenHash(token: string, hash: string): Promise<boolean> {
  return bcrypt.compare(token, hash);
}

// ─── FINGERPRINTING (§4) ───────────────────────────────────

/**
 * Compute fingerprint hash from signals
 * Combines client + server signals into SHA256 hash
 * §4.2 Fingerprint hash implementation
 *
 * Canonical string: signal1||signal2||signal3||...
 * Uses ipCountry (not specific IP) to handle VPN/proxy changes
 */
export function computeFingerprintHash(signals: FingerprintSignals): string {
  const canonical = [
    signals.userAgent,
    signals.acceptLanguage,
    signals.timezone,
    signals.screenRes,
    signals.colorDepth?.toString() || '0',
    signals.platform,
    signals.hardwareConcurrency?.toString() || '0',
    signals.ipCountry,
  ].join('||');

  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Evaluate fingerprint drift score
 * Probabilistic, not binary:
 *   0 pts = MATCH (identical)
 *   ≤25 pts = MINOR_DRIFT (allow, log)
 *   26-50 pts = DRIFT (step-up required)
 *   >50 pts = MISMATCH (deny)
 *
 * §4.3 Probabilistic evaluation
 */
export function evaluateFingerprintDrift(
  stored: FingerprintSignals,
  current: FingerprintSignals
): FingerprintDriftResult {
  let score = 0;
  const changedSignals: string[] = [];

  if (stored.userAgent !== current.userAgent) {
    score += CONSTANTS.FINGERPRINT_SCORE_UA;
    changedSignals.push('userAgent');
  }
  if (stored.timezone !== current.timezone) {
    score += CONSTANTS.FINGERPRINT_SCORE_TIMEZONE;
    changedSignals.push('timezone');
  }
  if (stored.ipCountry !== current.ipCountry) {
    score += CONSTANTS.FINGERPRINT_SCORE_COUNTRY;
    changedSignals.push('ipCountry');
  }
  if (stored.screenRes !== current.screenRes) {
    score += CONSTANTS.FINGERPRINT_SCORE_SCREENRES;
    changedSignals.push('screenRes');
  }
  if (stored.platform !== current.platform) {
    score += CONSTANTS.FINGERPRINT_SCORE_PLATFORM;
    changedSignals.push('platform');
  }
  if (stored.ipASN !== current.ipASN) {
    score += CONSTANTS.FINGERPRINT_SCORE_ASN;
    changedSignals.push('ipASN');
  }

  let verdict: FingerprintVerdict;
  let action: 'ALLOW' | 'LOG' | 'STEP_UP_AUTH' | 'DENY';

  if (score === 0) {
    verdict = FingerprintVerdict.MATCH;
    action = 'ALLOW';
  } else if (score <= CONSTANTS.FINGERPRINT_THRESHOLD_DRIFT) {
    verdict = FingerprintVerdict.MINOR_DRIFT;
    action = 'LOG';
  } else if (score <= CONSTANTS.FINGERPRINT_THRESHOLD_DENY) {
    verdict = FingerprintVerdict.DRIFT;
    action = 'STEP_UP_AUTH';
  } else {
    verdict = FingerprintVerdict.MISMATCH;
    action = 'DENY';
  }

  return {
    verdict,
    action,
    score,
    details: {
      changedSignals,
    },
  };
}

// ─── TOTP (§9) ────────────────────────────────────────────

/**
 * Generate TOTP secret for new admin
 * Returns: base32-encoded secret (scan into Google Authenticator, Authy, etc.)
 */
export function generateTotpSecret(email: string): { secret: string; qrCode: string } {
  const secret = authenticator.generateSecret();
  const qrCode = authenticator.keyuri(email, 'UniverBus Admin', secret);
  return { secret, qrCode };
}

/**
 * Verify TOTP code
 * Allows ±1 step tolerance (30s steps) for clock skew
 */
export function verifyTotp(code: string, secret: string): boolean {
  try {
    return authenticator.verify({
      token: code,
      secret,
      window: CONSTANTS.TOTP_WINDOW,
    });
  } catch (error) {
    return false;
  }
}

/**
 * Encrypt TOTP secret for database storage
 * Using a master key from environment
 */
export function encryptTotpSecret(secret: string, masterKey: string): string {
  // Simple XOR-based encryption (in production, use crypto library)
  // For production: use libsodium or crypto-js
  const buffer = Buffer.from(secret);
  const key = Buffer.from(masterKey.padEnd(buffer.length, '0'));
  const encrypted = Buffer.alloc(buffer.length);

  for (let i = 0; i < buffer.length; i++) {
    encrypted[i] = buffer[i] ^ key[i];
  }

  return encrypted.toString('base64');
}

/**
 * Decrypt TOTP secret
 */
export function decryptTotpSecret(encrypted: string, masterKey: string): string {
  const buffer = Buffer.from(encrypted, 'base64');
  const key = Buffer.from(masterKey.padEnd(buffer.length, '0'));
  const decrypted = Buffer.alloc(buffer.length);

  for (let i = 0; i < buffer.length; i++) {
    decrypted[i] = buffer[i] ^ key[i];
  }

  return decrypted.toString();
}

// ─── BACKUP CODES (§9.3) ───────────────────────────────────

/**
 * Generate 8 backup codes (8 characters each, alphanumeric)
 */
export function generateBackupCodes(count: number = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const code = randomBytes(6).toString('base64url').slice(0, 8).toUpperCase();
    codes.push(code);
  }
  return codes;
}

/**
 * Hash backup code for storage
 */
export async function hashBackupCode(code: string): Promise<string> {
  return bcrypt.hash(code, 10);
}

/**
 * Verify backup code
 */
export async function verifyBackupCode(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(code, hash);
}

// ─── JWT PAYLOAD GENERATION ───────────────────────────────

/**
 * Create access token payload
 * Lifetime: 15 minutes
 */
export function createAccessTokenPayload(
  adminId: string,
  sessionId: string,
  role: string,
  permissions: string[],
  fpHash: string
): AdminJWTPayload {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: adminId,
    sessionId,
    role: role as any,
    permissions,
    fpHash,
    iat: now,
    exp: now + CONSTANTS.ACCESS_TOKEN_LIFETIME,
    jti: generateTokenId(),
    type: TokenType.ACCESS,
  };
}

/**
 * Create step-up token payload
 * Lifetime: 5 minutes
 * Used for sensitive operations requiring recent password confirmation
 */
export function createStepUpTokenPayload(
  adminId: string,
  sessionId: string
): StepUpTokenPayload {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: adminId,
    sessionId,
    type: TokenType.STEP_UP,
    iat: now,
    exp: now + CONSTANTS.STEP_UP_TOKEN_LIFETIME,
    jti: generateTokenId(),
  };
}

/**
 * Create invite token payload
 * Lifetime: 48 hours
 */
export function createInviteTokenPayload(
  email: string,
  role: string,
  invitedBy: string
): InviteTokenPayload {
  const now = Math.floor(Date.now() / 1000);
  return {
    email,
    role: role as any,
    invitedBy,
    type: TokenType.INVITE,
    iat: now,
    exp: now + CONSTANTS.INVITE_TOKEN_LIFETIME,
    jti: generateTokenId(),
  };
}

/**
 * Generate unique token ID (jti) for JWT blocklisting
 */
export function generateTokenId(): string {
  return randomBytes(8).toString('hex');
}

// ─── RATE LIMITING HELPERS (§11) ──────────────────────────

/**
 * Hash email for rate limiting key
 * Prevents enumeration attacks (email not visible in logs)
 */
export function hashEmailForRateLimit(email: string): string {
  return createHash('sha256').update(email).digest('hex');
}

/**
 * Create rate limit key from template
 */
export function createRateLimitKey(
  template: string,
  replacements: Record<string, string>
): string {
  let key = template;
  for (const [placeholder, value] of Object.entries(replacements)) {
    key = key.replace(`{${placeholder}}`, value);
  }
  return key;
}

// ─── VALIDATION HELPERS ───────────────────────────────────

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Check password complexity
 * Minimum 12 chars, uppercase, number, special char
 */
export function isValidPasswordStrength(password: string): { valid: boolean; reason?: string } {
  if (password.length < CONSTANTS.PASSWORD_MIN_LENGTH) {
    return { valid: false, reason: `Minimum ${CONSTANTS.PASSWORD_MIN_LENGTH} characters` };
  }
  if (CONSTANTS.PASSWORD_REQUIRE_UPPERCASE && !/[A-Z]/.test(password)) {
    return { valid: false, reason: 'Require uppercase letter' };
  }
  if (CONSTANTS.PASSWORD_REQUIRE_NUMBER && !/\d/.test(password)) {
    return { valid: false, reason: 'Require number' };
  }
  if (CONSTANTS.PASSWORD_REQUIRE_SPECIAL && !/[!@#$%^&*()_\-+=[\]{};:'",.<>?/\\|`~]/.test(password)) {
    return { valid: false, reason: 'Require special character' };
  }
  return { valid: true };
}

// ─── TIME HELPERS ────────────────────────────────────────

/**
 * Get current UNIX timestamp in milliseconds
 */
export function nowMs(): number {
  return Date.now();
}

/**
 * Get current UNIX timestamp in seconds
 */
export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Check if timestamp has expired
 */
export function isExpired(expiresAt: number, nowMs: number = Date.now()): boolean {
  return nowMs > expiresAt;
}

/**
 * Get remaining time in seconds
 */
export function getRemainingSeconds(expiresAt: number): number {
  const remaining = expiresAt - Date.now();
  return Math.max(0, Math.ceil(remaining / 1000));
}

// ─── ERROR RESPONSE CONSTANTS ─────────────────────────────

export const AUTH_ERROR_RESPONSES = {
  INVALID_CREDENTIALS: {
    code: 'INVALID_CREDENTIALS',
    message: 'Invalid email or password',
    statusCode: 401,
  },
  INVALID_TOTP: {
    code: 'INVALID_TOTP',
    message: 'Invalid OTP code',
    statusCode: 401,
  },
  SESSION_EXPIRED: {
    code: 'SESSION_EXPIRED',
    message: 'Session expired. Please log in again.',
    statusCode: 401,
  },
  UNAUTHORIZED: {
    code: 'UNAUTHORIZED',
    message: 'Unauthorized access',
    statusCode: 401,
  },
  PERMISSION_DENIED: {
    code: 'PERMISSION_DENIED',
    message: 'Insufficient permissions',
    statusCode: 403,
  },
  STEP_UP_REQUIRED: {
    code: 'STEP_UP_REQUIRED',
    message: 'This action requires recent password confirmation',
    statusCode: 403,
  },
  ACCOUNT_SUSPENDED: {
    code: 'ACCOUNT_SUSPENDED',
    message: 'This account has been suspended',
    statusCode: 403,
  },
  ACCOUNT_LOCKED: {
    code: 'ACCOUNT_LOCKED',
    message: 'Too many login attempts. Account locked.',
    statusCode: 429,
  },
  RATE_LIMITED: {
    code: 'RATE_LIMITED',
    message: 'Too many requests. Please try again later.',
    statusCode: 429,
  },
  ANOMALY_DETECTED: {
    code: 'ANOMALY_DETECTED',
    message: 'Unusual activity detected. Please re-authenticate.',
    statusCode: 401,
  },
  FINGERPRINT_MISMATCH: {
    code: 'FINGERPRINT_MISMATCH',
    message: 'Device fingerprint mismatch. Unusual login detected.',
    statusCode: 403,
  },
};
