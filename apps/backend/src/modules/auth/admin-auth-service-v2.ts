/**
 * Admin Auth Service — Complete Implementation
 * Implements all 6 core authentication flows from spec §3, §6, §9
 * 
 * Layer: Business Logic (no HTTP concerns)
 * Depends on: DB, Redis, Utilities, Rate Limiter, Audit Logger
 */

import { Prisma } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import { db } from '../../db/prisma-client';
import { redisA, redisB } from '../../lib/redis-client';
import {
  hashPassword,
  verifyPassword,
  verifyTotp,
  generateRefreshToken,
  hashToken,
  verifyTokenHash,
  computeFingerprintHash,
  evaluateFingerprintDrift,
  createAccessTokenPayload,
  createStepUpTokenPayload,
  generateTotpSecret,
  encryptTotpSecret,
  decryptTotpSecret,
  generateBackupCodes,
  hashBackupCode,
  isValidPasswordStrength,
  hashEmailForRateLimit,
  createRateLimitKey,
  nowSec,
  getRemainingSeconds,
  AUTH_ERROR_RESPONSES,
  generateTokenId,
} from '../../lib/admin-auth-utils';
import {
  AdminRole,
  AdminSession,
  AdminJWTPayload,
  FingerprintSignalsClient,
  FingerprintSignalsServer,
  FingerprintSignals,
  FingerprintDriftResult,
  AuthError,
  AdminRefreshTokenRecord,
  AdminAuthEventType,
  CONSTANTS,
  PERMISSION_MAP,
} from './admin-auth.types';
import {
  recordAdminAuditEvent,
  logAdminLogin,
  logAdminMFA,
  logAdminStepUp,
  logAdminTokenRefresh,
  logAdminLogout,
  logTokenReuseDetected,
  logFingerprintMismatch,
} from '../../lib/admin-audit-logger';
import {
  checkLoginRateLimit,
  checkRefreshRateLimit,
  checkStepUpRateLimit,
  recordFailedLoginAttempt,
  resetFailedLoginAttempts,
  isAccountLocked,
  lockAccountTemporarily,
} from '../../lib/admin-rate-limiter';
import { logger } from '../../lib/logger';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key';
const JWT_ISSUER = process.env.JWT_ISSUER || 'https://admin.busapp.university';

// ─── LOGIN FLOW (§3.1) ────────────────────────────────────

/**
 * Authenticate admin with email + password + TOTP
 * Returns: { accessToken, refreshToken }
 *
 * Implements:
 *   §3.1 Login flow
 *   §4 Device fingerprinting
 *   §11 Rate limiting
 */
export async function adminLogin(
  email: string,
  password: string,
  totpCode: string,
  fingerprintSignals: FingerprintSignalsClient,
  ipAddress: string,
  ipCountry: string,
  ipASN: string
): Promise<{ accessToken: string; refreshToken: string }> {
  // ─── RATE LIMITING (§11) ───────────────────────────────

  const rateLimitCheck = await checkLoginRateLimit(ipAddress, email);
  if (!rateLimitCheck.allowed) {
    if (rateLimitCheck.reason === 'account_locked') {
      throw new AuthError(
        'ACCOUNT_LOCKED',
        'Too many login attempts. Account locked. Try again later.',
        429
      );
    }
    throw new AuthError(
      'RATE_LIMITED',
      `Too many login attempts. Please try again in ${rateLimitCheck.resetIn} seconds.`,
      429
    );
  }

  // Check if account is locked
  if (await isAccountLocked(email)) {
    throw new AuthError(
      'ACCOUNT_LOCKED',
      'Account temporarily locked due to multiple failed attempts.',
      429
    );
  }

  // ─── CREDENTIAL VALIDATION ────────────────────────────

  const admin = await db.adminUser.findUnique({ where: { email } });

  if (!admin) {
    // Record failed attempt (brute force)
    await recordFailedLoginAttempt(email);
    logger.info('Login attempt for non-existent admin', { email });

    // Don't expose if user exists (enumeration prevention) - same error as wrong password
    await logAdminLogin(
      '[unknown]',
      ipAddress,
      ipCountry,
      fingerprintSignals.userAgent,
      false,
      'invalid_credentials'
    );

    throw new AuthError(
      'INVALID_CREDENTIALS',
      AUTH_ERROR_RESPONSES.INVALID_CREDENTIALS.message,
      401
    );
  }

  // Check if suspended
  if (admin.deactivatedAt || admin.isSuspended || !admin.isActive) {
    logger.warn('Login attempt for suspended/inactive admin', { adminId: admin.id });
    throw new AuthError(
      'ACCOUNT_SUSPENDED',
      'This account has been suspended. Contact administrator.',
      403
    );
  }

  // Verify password (constant-time comparison)
  const passwordValid = await verifyPassword(password, admin.passwordHash);
  if (!passwordValid) {
    // Record failed attempt
    const attemptCount = await recordFailedLoginAttempt(email);
    logger.info('Invalid password for admin', { adminId: admin.id, attemptCount });

    // Lock account after 10 failed attempts in 1 hour
    if (attemptCount >= 10) {
      await lockAccountTemporarily(email, 'failed_login_attempts');
    }

    await logAdminLogin(admin.id, ipAddress, ipCountry, fingerprintSignals.userAgent, false, 'invalid_password');

    throw new AuthError(
      'INVALID_CREDENTIALS',
      AUTH_ERROR_RESPONSES.INVALID_CREDENTIALS.message,
      401
    );
  }

  // Verify MFA if enabled
  if (admin.mfaEnabled) {
    if (!admin.mfaSecretEncrypted) {
      logger.error('MFA enabled but secret not found', { adminId: admin.id });
      throw new AuthError('AUTH_ERROR', 'MFA configuration error', 500);
    }

    const secret = decryptTotpSecret(admin.mfaSecretEncrypted, process.env.TOTP_ENCRYPTION_KEY || '');
    const totpValid = verifyTotp(totpCode, secret);

    if (!totpValid) {
      logger.info('Invalid MFA code for admin', { adminId: admin.id });
      await logAdminMFA(admin.id, '', ipAddress, false);
      throw new AuthError(
        'INVALID_TOTP',
        AUTH_ERROR_RESPONSES.INVALID_TOTP.message,
        401
      );
    }

    await logAdminMFA(admin.id, '', ipAddress, true);
  }

  // ─── DEVICE FINGERPRINTING (§4) ────────────────────────

  const serverSignals: FingerprintSignalsServer = {
    ip: ipAddress,
    ipCountry,
    ipASN,
  };
  const allSignals: FingerprintSignals = {
    ...fingerprintSignals,
    ...serverSignals,
  };
  const fpHash = computeFingerprintHash(allSignals);

  // Store or validate fingerprint
  let fpDriftResult: FingerprintDriftResult | null = null;
  const storedFingerprint = await db.adminFingerprint.findUnique({
    where: { adminId: admin.id },
  });

  if (storedFingerprint) {
    const storedSignals: FingerprintSignals = {
      userAgent: storedFingerprint.userAgent,
      acceptLanguage: storedFingerprint.acceptLanguage,
      timezone: storedFingerprint.timezone,
      screenRes: storedFingerprint.screenRes,
      colorDepth: storedFingerprint.colorDepth,
      platform: storedFingerprint.platform,
      hardwareConcurrency: storedFingerprint.hardwareConcurrency,
      deviceMemory: storedFingerprint.deviceMemory ?? undefined,
      ip: ipAddress,
      ipCountry: storedFingerprint.ipCountry,
      ipASN: storedFingerprint.ipASN,
    };

    fpDriftResult = evaluateFingerprintDrift(storedSignals, allSignals);
    logger.info('Fingerprint evaluated', { adminId: admin.id, verdict: fpDriftResult.verdict });
  } else {
    // New admin: store initial fingerprint
    await db.adminFingerprint.create({
      data: {
        adminId: admin.id,
        userAgent: fingerprintSignals.userAgent,
        acceptLanguage: fingerprintSignals.acceptLanguage,
        timezone: fingerprintSignals.timezone,
        screenRes: fingerprintSignals.screenRes,
        colorDepth: fingerprintSignals.colorDepth,
        platform: fingerprintSignals.platform,
        hardwareConcurrency: fingerprintSignals.hardwareConcurrency,
        deviceMemory: fingerprintSignals.deviceMemory,
        ipCountry,
        ipASN,
        fpHash,
        lastDriftScore: 0,
      },
    });
  }

  // ─── CREATE SESSION (§3.1) ────────────────────────────

  const sessionId = generateSessionId();
  const permissions = PERMISSION_MAP[admin.role as AdminRole] || [];
  const absoluteDeadline = Date.now() + 24 * 60 * 60 * 1000;

  const session: AdminSession = {
    adminId: admin.id,
    sessionId,
    role: admin.role,
    permissions,
    fpHash,
    createdAt: Date.now(),
    absoluteDeadline,
    lastActivity: Date.now(),
    needsReauth: false,
    ip: ipAddress,
    ipCountry,
  };

  // Store session in Redis-A
  await redisA.setSession(sessionId, session);

  // ─── GENERATE TOKENS ──────────────────────────────────

  // Access token (JWT, 15 minutes)
  const accessPayload = createAccessTokenPayload(
    admin.id,
    sessionId,
    admin.role,
    permissions,
    fpHash
  );
  const accessToken = signJWT(accessPayload);

  // Refresh token (raw, 32 bytes, stored as hash in DB)
  const refreshTokenRaw = generateRefreshToken();
  const refreshTokenHash = await hashToken(refreshTokenRaw);
  const refreshTokenFamilyId = generateSessionId();
  const absoluteExp = Date.now() + 24 * 60 * 60 * 1000;

  // Store refresh token in database (§3.2)
  await db.adminRefreshToken.create({
    data: {
      adminId: admin.id,
      tokenHash: refreshTokenHash,
      familyId: refreshTokenFamilyId,
      sessionId,
      absoluteExp: BigInt(absoluteExp),
      createdAt: new Date(),
      deviceFpHash: fpHash,
      ipAtCreation: ipAddress,
    },
  });

  // ─── UPDATE ADMIN RECORD ──────────────────────────────

  await db.adminUser.update({
    where: { id: admin.id },
    data: {
      lastLoginAt: new Date(),
      lastLoginIp: ipAddress,
      lastLoginUserAgent: fingerprintSignals.userAgent,
      failedLoginAttempts: 0,
      lastFailedLoginAt: null,
    },
  });

  // Clear failed attempts rate limit
  await resetFailedLoginAttempts(email);

  // ─── AUDIT LOG ────────────────────────────────────────

  await logAdminLogin(admin.id, ipAddress, ipCountry, fingerprintSignals.userAgent, true);

  // ─── RETURN TOKENS ────────────────────────────────────

  return {
    accessToken,
    refreshToken: refreshTokenRaw,
  };
}

// ─── REFRESH TOKEN FLOW (§3.2) ────────────────────────

/**
 * Refresh access token with family rotation
 * Implements:
 *   §3.2 Token refresh flow with family rotation
 *   §3.4 Absolute session lifetime enforcement
 *   Token reuse detection (§14 threat model)
 */
export async function adminRefresh(
  refreshTokenRaw: string,
  ipAddress: string,
  ipCountry: string
): Promise<{ accessToken: string; newRefreshToken: string }> {
  // ─── HASH & LOOKUP TOKEN ──────────────────────────────

  const refreshTokenHash = await hashToken(refreshTokenRaw);
  const tokenRecord = await db.adminRefreshToken.findUnique({
    where: { tokenHash: refreshTokenHash },
  });

  if (!tokenRecord) {
    logger.warn('Refresh token not found (possible token forgery)', { ip: ipAddress });
    throw new AuthError(
      'UNAUTHORIZED',
      AUTH_ERROR_RESPONSES.UNAUTHORIZED.message,
      401
    );
  }

  // ─── CHECK IF REVOKED ─────────────────────────────────

  if (tokenRecord.isRevoked) {
    logger.warn('Refresh token already revoked', {
      adminId: tokenRecord.adminId,
      revokeReason: tokenRecord.revokeReason,
    });
    throw new AuthError(
      'UNAUTHORIZED',
      AUTH_ERROR_RESPONSES.UNAUTHORIZED.message,
      401
    );
  }

  // ─── TOKEN REUSE DETECTION (§3.2) ─────────────────────
  // If an old token from same family is seen, family was compromised

  const familyTokens = await db.adminRefreshToken.findMany({
    where: {
      familyId: tokenRecord.familyId,
      isRevoked: true,
    },
  });

  if (familyTokens.length > 0) {
    logger.critical('Token reuse detected (possible theft)', {
      adminId: tokenRecord.adminId,
      familyId: tokenRecord.familyId,
      ip: ipAddress,
    });

    // Revoke entire family immediately
    await db.adminRefreshToken.updateMany(
      { where: { familyId: tokenRecord.familyId } },
      { isRevoked: true, revokeReason: 'family_revocation' }
    );

    // Revoke all sessions for this admin (bump sessionVersion)
    const admin = await db.adminUser.findUnique({
      where: { id: tokenRecord.adminId },
    });
    if (admin) {
      await db.adminUser.update({
        where: { id: tokenRecord.adminId },
        data: { sessionVersion: admin.sessionVersion + 1 },
      });
    }

    // Audit event
    await logTokenReuseDetected(tokenRecord.adminId, tokenRecord.sessionId, ipAddress);

    throw new AuthError(
      'SESSION_EXPIRED',
      'Token reuse detected. All sessions revoked. Please log in again.',
      401
    );
  }

  // ─── ABSOLUTE LIFETIME CHECK (§3.4) ────────────────

  const tokenAge = Date.now() - tokenRecord.createdAt.getTime();
  if (tokenAge > 24 * 60 * 60 * 1000) {
    logger.info('Refresh token exceeded absolute lifetime', {
      adminId: tokenRecord.adminId,
    });
    throw new AuthError(
      'SESSION_EXPIRED',
      'Refresh token has expired. Please log in again.',
      401
    );
  }

  // ─── CHECK RATE LIMIT ──────────────────────────────────

  const rateLimitCheck = await checkRefreshRateLimit(tokenRecord.sessionId);
  if (!rateLimitCheck.allowed) {
    throw new AuthError(
      'RATE_LIMITED',
      'Too many refresh attempts. Please try again later.',
      429
    );
  }

  // ─── FETCH ADMIN & SESSION ────────────────────────────

  const admin = await db.adminUser.findUnique({
    where: { id: tokenRecord.adminId },
  });

  if (!admin || !admin.isActive || admin.deactivatedAt || admin.isSuspended) {
    throw new AuthError(
      'UNAUTHORIZED',
      AUTH_ERROR_RESPONSES.UNAUTHORIZED.message,
      401
    );
  }

  const session = await redisA.getSession(tokenRecord.sessionId);
  if (!session) {
    throw new AuthError(
      'SESSION_EXPIRED',
      AUTH_ERROR_RESPONSES.SESSION_EXPIRED.message,
      401
    );
  }

  // ─── CHECK ABSOLUTE SESSION LIFETIME (§3.4) ──────────

  const sessionAge = Date.now() - session.createdAt;
  if (sessionAge > 24 * 60 * 60 * 1000) {
    logger.info('Session exceeded absolute lifetime', {
      adminId: admin.id,
      sessionId: tokenRecord.sessionId,
    });
    await redisA.deleteSession(tokenRecord.sessionId);
    throw new AuthError(
      'SESSION_EXPIRED',
      'Session lifetime exceeded. Please log in again.',
      401
    );
  }

  // ─── ISSUE NEW TOKENS (ROTATE) ────────────────────────

  const permissions = PERMISSION_MAP[admin.role as AdminRole] || [];
  const accessPayload = createAccessTokenPayload(
    admin.id,
    tokenRecord.sessionId,
    admin.role,
    permissions,
    session.fpHash
  );
  const accessToken = signJWT(accessPayload);

  // New refresh token (rotate)
  const newRefreshTokenRaw = generateRefreshToken();
  const newRefreshTokenHash = await hashToken(newRefreshTokenRaw);
  const newAbsoluteExp = Date.now() + 24 * 60 * 60 * 1000;

  await db.adminRefreshToken.create({
    data: {
      adminId: admin.id,
      tokenHash: newRefreshTokenHash,
      familyId: tokenRecord.familyId,  // Same family
      sessionId: tokenRecord.sessionId,
      absoluteExp: BigInt(newAbsoluteExp),
      createdAt: new Date(),
      deviceFpHash: session.fpHash,
      ipAtCreation: ipAddress,
    },
  });

  // Mark old token as revoked
  await db.adminRefreshToken.update({
    where: { id: tokenRecord.id },
    data: {
      isRevoked: true,
      revokeReason: 'rotated',
      lastUsedAt: new Date(),
    },
  });

  // Update session activity
  session.lastActivity = Date.now();
  session.ip = ipAddress;
  session.ipCountry = ipCountry;
  await redisA.setSession(tokenRecord.sessionId, session);

  // ─── AUDIT ────────────────────────────────────────────

  await logAdminTokenRefresh(admin.id, tokenRecord.sessionId, ipAddress);

  return {
    accessToken,
    newRefreshToken: newRefreshTokenRaw,
  };
}

// ─── STEP-UP AUTHENTICATION (§6) ───────────────────────

/**
 * Initiate step-up authentication
 * User provides password confirmation, receives short-lived step-up token
 * §6.2 Step-up token flow
 */
export async function initiateStepUp(
  adminId: string,
  password: string,
  sessionId: string,
  ipAddress: string
): Promise<{ stepUpToken: string }> {
  // ─── RATE LIMITING ────────────────────────────────────

  const rateLimitCheck = await checkStepUpRateLimit(adminId);
  if (!rateLimitCheck.allowed) {
    logger.warn('Step-up rate limit exceeded', { adminId });
    await logAdminStepUp(adminId, sessionId, ipAddress, false);
    throw new AuthError(
      'RATE_LIMITED',
      AUTH_ERROR_RESPONSES.RATE_LIMITED.message,
      429
    );
  }

  // ─── VERIFY ADMIN & PASSWORD ──────────────────────────

  const admin = await db.adminUser.findUnique({ where: { id: adminId } });
  if (!admin || !admin.isActive) {
    throw new AuthError('UNAUTHORIZED', AUTH_ERROR_RESPONSES.UNAUTHORIZED.message, 401);
  }

  const passwordValid = await verifyPassword(password, admin.passwordHash);
  if (!passwordValid) {
    logger.info('Invalid password during step-up', { adminId });
    await logAdminStepUp(adminId, sessionId, ipAddress, false);
    throw new AuthError(
      'INVALID_CREDENTIALS',
      AUTH_ERROR_RESPONSES.INVALID_CREDENTIALS.message,
      401
    );
  }

  // ─── CREATE STEP-UP TOKEN ─────────────────────────────

  const stepUpPayload = createStepUpTokenPayload(adminId, sessionId);
  const stepUpToken = signJWT(stepUpPayload);
  const stepUpTokenId = stepUpPayload.jti;

  // Store in Redis-A (5 minute TTL)
  await redisA.storeStepUpToken(stepUpTokenId);

  // ─── AUDIT ────────────────────────────────────────────

  await logAdminStepUp(adminId, sessionId, ipAddress, true);

  return { stepUpToken };
}

/**
 * Verify step-up token is valid
 */
export async function verifyStepUpToken(stepUpTokenId: string, adminId: string): Promise<boolean> {
  const isValid = await redisA.validateStepUpToken(stepUpTokenId);
  if (isValid) {
    // Burn token (single-use)
    await redisA.revokeStepUpToken(stepUpTokenId);
  }
  return isValid;
}

// ─── LOGOUT FLOW (§3.3) ────────────────────────────────

/**
 * Logout: revoke session and access token
 */
export async function adminLogout(
  adminId: string,
  sessionId: string,
  jti: string,
  remainingTokenTtl: number,
  ipAddress: string
): Promise<void> {
  // Revoke JWT
  await redisA.revokeToken(jti, remainingTokenTtl);

  // Delete session
  await redisA.deleteSession(sessionId);

  // Mark refresh tokens as revoked
  await db.adminRefreshToken.updateMany(
    { where: { sessionId } },
    { isRevoked: true, revokeReason: 'logout' }
  );

  // Audit
  await logAdminLogout(adminId, sessionId, ipAddress);
}

/**
 * Logout all sessions for admin
 * Used on password change or admin suspension
 */
export async function adminLogoutAll(adminId: string, reason: string): Promise<void> {
  // Revoke all refresh tokens
  await db.adminRefreshToken.updateMany(
    { where: { adminId } },
    { isRevoked: true, revokeReason: reason }
  );

  // Bump session version (forces all JWTs to be invalid)
  const admin = await db.adminUser.findUnique({ where: { id: adminId } });
  if (admin) {
    await db.adminUser.update({
      where: { id: adminId },
      data: { sessionVersion: admin.sessionVersion + 1 },
    });
  }

  logger.info('All sessions revoked for admin', { adminId, reason });
}

// ─── HELPER FUNCTIONS ─────────────────────────────────

function generateSessionId(): string {
  const crypto = require('crypto');
  return crypto.randomUUID();
}

function signJWT(payload: any): string {
  return jwt.sign(payload, JWT_SECRET, {
    algorithm: 'HS256',
    issuer: JWT_ISSUER,
  });
}

/**
 * Verify JWT signature and return payload
 */
export function verifyJWT(token: string): any {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
    });
    return decoded;
  } catch (error) {
    throw new AuthError('UNAUTHORIZED', 'Invalid or expired token', 401);
  }
}

/**
 * Get session from JWT sub
 * Used by middleware
 */
export async function getSessionFromJWT(token: string): Promise<AdminSession | null> {
  try {
    const decoded = verifyJWT(token) as AdminJWTPayload;
    return redisA.getSession(decoded.sessionId);
  } catch (error) {
    return null;
  }
}
