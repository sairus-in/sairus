import { prisma } from './prisma';
import { redis } from './redis';
import { circuitExecute } from './redis-circuit';
import { logger } from './logger';
import { metrics } from './metrics';

interface MobileAuthState {
  isActive: boolean;
  authStatus: string;
  role: string;
  sessionVersion: number;
  registeredDeviceId: string | null;
  forcedReloginAt: string | null;
}

export const AUTH_CACHE_TTL = 24 * 60 * 60;

const buildMobileAuthState = (user: {
  isActive: boolean;
  authStatus: string;
  role: string;
  sessionVersion: number;
  registeredDeviceId: string | null;
  forcedReloginAt: Date | null;
}): MobileAuthState => ({
  isActive: user.isActive,
  authStatus: user.authStatus,
  role: user.role,
  sessionVersion: user.sessionVersion,
  registeredDeviceId: user.registeredDeviceId,
  forcedReloginAt: user.forcedReloginAt?.toISOString() ?? null,
});

const cacheAuthState = async (key: string, ttlSeconds: number, value: unknown): Promise<void> => {
  try {
    await redis.setex(key, ttlSeconds, JSON.stringify(value));
  } catch (error) {
    logger.warn({
      event: 'auth_cache_write_failed',
      source: 'SYSTEM',
      meta: { key, error: String(error) },
    });
  }
};

const deleteAuthState = async (key: string): Promise<void> => {
  try {
    await redis.del(key);
  } catch (error) {
    logger.warn({
      event: 'auth_cache_delete_failed',
      source: 'SYSTEM',
      meta: { key, error: String(error) },
    });
  }
};

export const writeAuthUserCache = async (userId: string): Promise<void> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      isActive: true,
      authStatus: true,
      role: true,
      sessionVersion: true,
      registeredDeviceId: true,
      forcedReloginAt: true,
    },
  });

  if (!user) {
    return;
  }

  // CACHE: auth:user:* stores the DB-backed auth state for JWT validation.
  await cacheAuthState(`auth:user:${userId}`, AUTH_CACHE_TTL, buildMobileAuthState(user));
};

export const getAuthUserState = async (userId: string): Promise<MobileAuthState | null> => {
  const cacheKey = `auth:user:${userId}`;
  const cached = await circuitExecute(
    () => redis.get(cacheKey),
    'db_lookup',
    async () => {
      logger.warn({
        event: 'auth_user_cache_fallback_to_db',
        source: 'SYSTEM',
        meta: { userId },
      });
      await metrics.increment('auth.session.redis_miss_fallback', { scope: 'mobile' });
      return null;
    },
    'auth-user-state',
  );

  if (cached) {
    return JSON.parse(cached) as MobileAuthState;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      isActive: true,
      authStatus: true,
      role: true,
      sessionVersion: true,
      registeredDeviceId: true,
      forcedReloginAt: true,
    },
  });

  if (!user) {
    return null;
  }

  const state = buildMobileAuthState(user);
  void cacheAuthState(cacheKey, AUTH_CACHE_TTL, state);
  return state;
};

export const invalidateMobileAuthCache = async (userId: string): Promise<void> => {
  await deleteAuthState(`auth:user:${userId}`);
};

interface AdminAuthState {
  isActive: boolean;
  sessionVersion: number;
  role: string;
  mfaEnabled: boolean;
}

export const ADMIN_CACHE_TTL = 8 * 60 * 60;

const buildAdminAuthState = (admin: {
  isActive: boolean;
  sessionVersion: number;
  role: string;
  mfaEnabled: boolean;
}): AdminAuthState => ({
  isActive: admin.isActive,
  sessionVersion: admin.sessionVersion,
  role: admin.role,
  mfaEnabled: admin.mfaEnabled,
});

export const writeAuthAdminCache = async (adminId: string): Promise<void> => {
  const admin = await prisma.adminUser.findUnique({
    where: { id: adminId },
    select: { isActive: true, sessionVersion: true, role: true, mfaEnabled: true },
  });

  if (!admin) {
    return;
  }

  // CACHE: auth:admin:* stores the DB-backed admin auth state for middleware checks.
  await cacheAuthState(`auth:admin:${adminId}`, ADMIN_CACHE_TTL, buildAdminAuthState(admin));
};

export const getAuthAdminState = async (adminId: string): Promise<AdminAuthState | null> => {
  const cacheKey = `auth:admin:${adminId}`;
  const cached = await circuitExecute(
    () => redis.get(cacheKey),
    'db_lookup',
    async () => {
      logger.warn({
        event: 'auth_admin_cache_fallback_to_db',
        source: 'SYSTEM',
        meta: { adminId },
      });
      await metrics.increment('auth.session.redis_miss_fallback', { scope: 'admin' });
      return null;
    },
    'auth-admin-state',
  );

  if (cached) {
    return JSON.parse(cached) as AdminAuthState;
  }

  const admin = await prisma.adminUser.findUnique({
    where: { id: adminId },
    select: { isActive: true, sessionVersion: true, role: true, mfaEnabled: true },
  });

  if (!admin) {
    return null;
  }

  const state = buildAdminAuthState(admin);
  void cacheAuthState(cacheKey, ADMIN_CACHE_TTL, state);
  return state;
};

export const invalidateAdminAuthCache = async (adminId: string): Promise<void> => {
  await deleteAuthState(`auth:admin:${adminId}`);
};
