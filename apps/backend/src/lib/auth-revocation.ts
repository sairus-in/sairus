import { AuthAuditEventType } from 'shared';
import { invalidateMobileAuthCache } from './auth-cache';
import { writeAuthAuditEvent } from './auth-audit';
import { logger } from './logger';
import { prisma } from './prisma';
import { redis } from './redis';
import { scanKeys } from './redis-scan';
import { actorCache } from '../spine/auth';

async function bestEffortDelete(key: string): Promise<void> {
  try {
    await redis.del(key);
  } catch (error) {
    logger.warn({
      event: 'auth_revocation_redis_delete_failed',
      source: 'SYSTEM',
      meta: { key, error: String(error) },
    });
  }
}

async function bestEffortSetex(key: string, ttlSeconds: number, value: string): Promise<void> {
  try {
    await redis.setex(key, ttlSeconds, value);
  } catch (error) {
    logger.warn({
      event: 'auth_revocation_redis_set_failed',
      source: 'SYSTEM',
      meta: { key, error: String(error) },
    });
  }
}

export const revokeAllSessions = async (userId: string, reason: string, actorId?: string) => {
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } },
    select: { sessionVersion: true },
  });

  await invalidateMobileAuthCache(userId);
  await actorCache.invalidate('mobile', userId);
  await bestEffortDelete(`jwt:blacklist:${userId}`);

  void writeAuthAuditEvent({
    actorType: actorId ? 'ADMIN_USER' : 'SYSTEM',
    actorId: actorId ?? 'system',
    targetType: 'MOBILE_USER',
    targetId: userId,
    eventType: AuthAuditEventType.SESSION_VERSION_BUMPED,
    metadata: { reason, newVersion: updated.sessionVersion },
  });
};

export const forceReloginAfter = async (userIds: string[], afterTimestamp: Date, reason: string) => {
  await prisma.user.updateMany({
    where: { id: { in: userIds } },
    data: { forcedReloginAt: afterTimestamp },
  });

  await Promise.all(
    userIds.map(async (id) => {
      await invalidateMobileAuthCache(id);
      await actorCache.invalidate('mobile', id);
      await bestEffortSetex(`jwt:blacklist:${id}`, 24 * 60 * 60, '1');
    }),
  );

  void writeAuthAuditEvent({
    actorType: 'SYSTEM',
    eventType: AuthAuditEventType.FORCED_RELOGIN_SET,
    metadata: { reason, userCount: userIds.length, afterTimestamp: afterTimestamp.toISOString() },
  });
};

export const wipeAllMobileAuthCaches = async (): Promise<number> => {
  try {
    const authKeys = await scanKeys('auth:user:*');
    if (authKeys.length === 0) {
      return 0;
    }

    let deleted = 0;
    for (let i = 0; i < authKeys.length; i += 100) {
      const batch = authKeys.slice(i, i + 100);
      await redis.del(...batch);
      deleted += batch.length;
    }

    logger.info({
      event: 'auth_cache_wiped',
      source: 'SYSTEM',
      meta: { deletedCount: deleted },
    });
    return deleted;
  } catch (error) {
    logger.warn({
      event: 'auth_cache_wipe_failed',
      source: 'SYSTEM',
      meta: { error: String(error) },
    });
    return 0;
  }
};
