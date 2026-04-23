import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { AuthAuditEventType, MobileJWTPayload, Role } from 'shared';
import { writeAuthAuditEvent, hashForLog } from '../../lib/auth-audit';
import { writeAuthUserCache } from '../../lib/auth-cache';
import { jwtConfig } from '../../lib/auth-config';
import { revokeMobileAuthState } from '../../lib/auth-state-change';
import { AppError } from '../../lib/errors';
import { firebaseAdmin } from '../../lib/firebase';
import { logger } from '../../lib/logger';
import { metrics } from '../../lib/metrics';
import { circuitExecute } from '../../lib/redis-circuit';
import { redis } from '../../lib/redis';
import { mobileAuthRepository } from './mobile-auth.repository';

/**
 * Check mobile login rate limit by IP address.
 * Allows up to 10 login attempts per IP per 60 seconds.
 * Redis failure degrades open with explicit logging and metrics.
 */
export const checkMobileLoginRateLimit = async (ipAddress: string): Promise<void> => {
  const rateLimitKey = `ratelimit:mobile:login:${ipAddress}`;
  const windowSeconds = 60;
  const maxAttempts = 10;

  const attempts = await circuitExecute(
    async () => {
      const count = await redis.incr(rateLimitKey);
      if (count === 1) {
        await redis.expire(rateLimitKey, windowSeconds);
      }
      return count;
    },
    'allow_degraded',
    async () => {
      await metrics.increment('rate_limit.degraded_allow', { key: 'mobile-login-ip' });
      return 0;
    },
    'mobile-login-ip',
  );

  if (attempts > maxAttempts) {
    logger.warn({
      event: 'mobile_login_rate_limited',
      source: 'SYSTEM',
      meta: { ipAddress, attempts },
    });
    throw new AppError('Too many login attempts. Please try again later.', 429, 'RATE_LIMITED');
  }
};

/**
 * Check mobile login rate limit by phone number.
 * Allows up to 5 login attempts per phone per 300 seconds (5 minutes).
 * Redis failure degrades open with explicit logging and metrics.
 */
export const checkMobileLoginPhoneRateLimit = async (phoneNumber: string): Promise<void> => {
  const rateLimitKey = `ratelimit:mobile:login:phone:${phoneNumber}`;
  const windowSeconds = 300;
  const maxAttempts = 5;

  const attempts = await circuitExecute(
    async () => {
      const count = await redis.incr(rateLimitKey);
      if (count === 1) {
        await redis.expire(rateLimitKey, windowSeconds);
      }
      return count;
    },
    'allow_degraded',
    async () => {
      await metrics.increment('rate_limit.degraded_allow', { key: 'mobile-login-phone' });
      return 0;
    },
    'mobile-login-phone',
  );

  if (attempts > maxAttempts) {
    logger.warn({
      event: 'mobile_login_phone_rate_limited',
      source: 'SYSTEM',
      meta: { phoneHash: hashForLog(phoneNumber), attempts },
    });
    throw new AppError(
      'Too many login attempts for this number. Try again in 5 minutes.',
      429,
      'RATE_LIMITED',
    );
  }
};

const issueMobileJwt = (
  user: { id: string; role: string; sessionVersion: number },
  deviceIdHash: string,
) => {
  const jwtPayload: MobileJWTPayload = {
    sub: user.id,
    type: 'MOBILE',
    role: user.role as Role,
    deviceId: deviceIdHash,
    sv: user.sessionVersion,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
  };

  return jwt.sign(jwtPayload, jwtConfig.secret, {
    expiresIn: '24h',
    issuer: jwtConfig.issuer,
    audience: jwtConfig.mobileAudience,
    algorithm: jwtConfig.algorithm,
  });
};

const toMobileAuthUser = (user: {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  role: string;
  isActive: boolean;
  department: string | null;
  year: number | null;
  rollNumber: string | null;
  routeAssignment: {
    id: string;
    routeId: string;
    stopId: string;
    route: { id: string; name: string; area: string };
    stop: { id: string; name: string; lat: number; lon: number };
  } | null;
}) => ({
  id: user.id,
  name: user.name,
  phone: user.phone,
  email: user.email,
  role: user.role,
  isActive: user.isActive,
  department: user.department,
  year: user.year,
  rollNumber: user.rollNumber,
  routeAssignment: user.routeAssignment,
});

const resolveFirebaseIdentity = async (firebaseToken: string) => {
  if (firebaseAdmin) {
    const decodedFirebase = await firebaseAdmin.auth().verifyIdToken(firebaseToken);
    return {
      phoneNumber: decodedFirebase.phone_number,
      uid: decodedFirebase.sub,
    };
  }

  if (process.env.NODE_ENV !== 'production' && firebaseToken.startsWith('mock_')) {
    const mockPayload = firebaseToken.slice('mock_'.length);
    const lastSeparator = mockPayload.lastIndexOf('_');
    const phoneNumber = lastSeparator === -1 ? mockPayload : mockPayload.slice(0, lastSeparator);

    return {
      phoneNumber,
      uid: `mock:${phoneNumber}`,
    };
  }

  throw new AppError('Invalid firebase token', 401, 'INVALID_FIREBASE_TOKEN');
};

export const mobileLogin = async (
  firebaseToken: string,
  rawDeviceId: string,
  ipAddress: string,
) => {
  const identity = await resolveFirebaseIdentity(firebaseToken);
  const phoneNumber = identity.phoneNumber;

  if (!phoneNumber) {
    throw new AppError('Invalid token', 401, 'INVALID_FIREBASE_TOKEN');
  }

  await checkMobileLoginPhoneRateLimit(phoneNumber);

  const user = await mobileAuthRepository.findUserByPhoneWithRouteAssignment(phoneNumber);

  if (!user) {
    void writeAuthAuditEvent({
      actorType: 'MOBILE_USER',
      eventType: AuthAuditEventType.MOBILE_LOGIN_FAILURE,
      ipAddress,
      metadata: { reason: 'USER_NOT_FOUND', phoneHash: hashForLog(phoneNumber) },
    });
    throw new AppError('This phone number is not registered in the system.', 404, 'USER_NOT_REGISTERED');
  }

  if (!user.isActive || user.authStatus === 'DISABLED') {
    throw new AppError('Account disabled', 403, 'ACCOUNT_DISABLED');
  }

  const deviceIdHash = crypto.createHash('sha256').update(rawDeviceId).digest('hex');

  if (user.authStatus === 'PENDING_PROVISIONING') {
    return {
      success: true,
      data: {
        status: 'PENDING_PROVISIONING',
        token: issueMobileJwt(user, deviceIdHash),
        user: {
          id: user.id,
          name: user.name,
          phone: user.phone,
          role: user.role,
        },
      },
    };
  }

  if (!user.firebaseUid) {
    await mobileAuthRepository.updateFirebaseUid(user.id, identity.uid);
  } else if (user.firebaseUid !== identity.uid) {
    void writeAuthAuditEvent({
      actorType: 'MOBILE_USER',
      actorId: user.id,
      eventType: AuthAuditEventType.MOBILE_LOGIN_FAILURE,
      ipAddress,
      metadata: { reason: 'FIREBASE_UID_MISMATCH' },
    });
    throw new AppError('Auth conflict', 409, 'AUTH_CONFLICT');
  }

  const isNewDevice = user.registeredDeviceId !== deviceIdHash;
  const deviceBoundAt = isNewDevice ? new Date() : undefined;
  await mobileAuthRepository.updateUserDeviceBinding(user.id, {
    registeredDeviceId: deviceIdHash,
    lastLoginAt: new Date(),
    deviceBoundAt,
  });

  const token = issueMobileJwt(user, deviceIdHash);

  await writeAuthUserCache(user.id);
  void redis.del(`jwt:blacklist:${user.id}`).catch((error) => {
    logger.warn({
      event: 'mobile_login_blacklist_clear_failed',
      source: 'SYSTEM',
      meta: { userId: user.id, error: String(error) },
    });
  });

  void writeAuthAuditEvent({
    actorType: 'MOBILE_USER',
    actorId: user.id,
    eventType: AuthAuditEventType.MOBILE_LOGIN_SUCCESS,
    deviceId: deviceIdHash,
    ipAddress,
    metadata: { isNewDevice, role: user.role },
  });

  if (isNewDevice) {
    void writeAuthAuditEvent({
      actorType: 'MOBILE_USER',
      actorId: user.id,
      eventType: AuthAuditEventType.DEVICE_REBOUND,
      deviceId: deviceIdHash,
      ipAddress,
      metadata: { previousDevice: user.registeredDeviceId ? 'existed' : 'none' },
    });
  }

  return {
    success: true,
    data: {
      token,
      user: toMobileAuthUser(user),
    },
  };
};

export const mobileRefresh = async (firebaseToken: string, rawDeviceId: string) => {
  const identity = await resolveFirebaseIdentity(firebaseToken);
  const phoneNumber = identity.phoneNumber;

  if (!phoneNumber) {
    throw new AppError('Invalid firebase token', 401, 'INVALID_FIREBASE_TOKEN');
  }

  const user = await mobileAuthRepository.findUserByPhoneForRefresh(phoneNumber);

  if (!user || !user.isActive || user.authStatus === 'DISABLED') {
    throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
  }

  const deviceIdHash = crypto.createHash('sha256').update(rawDeviceId).digest('hex');

  if (user.registeredDeviceId !== deviceIdHash) {
    void writeAuthAuditEvent({
      actorType: 'MOBILE_USER',
      actorId: user.id,
      eventType: AuthAuditEventType.MOBILE_REFRESH_REJECTED,
      metadata: { reason: 'DEVICE_MISMATCH' },
    });
    throw new AppError('Device mismatch', 401, 'DEVICE_MISMATCH');
  }

  const token = issueMobileJwt(user, deviceIdHash);
  void redis.del(`jwt:blacklist:${user.id}`).catch((error) => {
    logger.warn({
      event: 'mobile_refresh_blacklist_clear_failed',
      source: 'SYSTEM',
      meta: { userId: user.id, error: String(error) },
    });
  });

  void writeAuthAuditEvent({
    actorType: 'MOBILE_USER',
    actorId: user.id,
    eventType: AuthAuditEventType.MOBILE_REFRESH_SUCCESS,
    deviceId: deviceIdHash,
  });

  return {
    success: true,
    data: { token },
  };
};

export const mobileLogout = async (userId: string, deviceId: string) => {
  await revokeMobileAuthState(userId, {
    fcmToken: null,
    registeredDeviceId: null,
    deviceBoundAt: null,
  });

  void writeAuthAuditEvent({
    actorType: 'MOBILE_USER',
    actorId: userId,
    eventType: AuthAuditEventType.MOBILE_LOGOUT,
    deviceId,
  });
};

export const getMobileUserProfile = async (userId: string) => {
  const user = await mobileAuthRepository.findUserWithFullProfile(userId);

  if (!user) {
    logger.warn({
      event: 'mobile_user_profile_not_found',
      source: 'SYSTEM',
      meta: { userId },
    });
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  return user;
};

export const revokeAllSessionsForUser = async (userId: string, deviceId?: string) => {
  await revokeMobileAuthState(userId, {
    registeredDeviceId: null,
    fcmToken: null,
    deviceBoundAt: null,
  });

  void writeAuthAuditEvent({
    actorType: 'MOBILE_USER',
    actorId: userId,
    eventType: AuthAuditEventType.LOGOUT_ALL_SESSIONS,
    deviceId,
    metadata: { reason: 'USER_INITIATED' },
  });

  logger.info({
    event: 'mobile_logout_all_sessions_completed',
    source: 'SYSTEM',
    meta: { userId },
  });
};
