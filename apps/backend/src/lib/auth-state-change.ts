import { Prisma } from '@prisma/client';
import { invalidateAdminAuthCache, invalidateMobileAuthCache } from './auth-cache';
import { logger } from './logger';
import { prisma } from './prisma';
import { redis } from './redis';

async function bestEffortRedisDelete(key: string): Promise<void> {
  try {
    await redis.del(key);
  } catch (error) {
    logger.warn({
      event: 'auth_state_redis_delete_failed',
      source: 'SYSTEM',
      meta: { key, error: String(error) },
    });
  }
}

export const revokeMobileAuthState = async (
  userId: string,
  data: Omit<Prisma.UserUpdateInput, 'sessionVersion'> = {},
) => {
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      ...data,
      sessionVersion: { increment: 1 },
    },
  });

  await invalidateMobileAuthCache(userId);
  await bestEffortRedisDelete(`jwt:blacklist:${userId}`);

  return user;
};

export const revokeAdminAuthState = async (
  adminId: string,
  data: Omit<Prisma.AdminUserUpdateInput, 'sessionVersion'> = {},
) => {
  const admin = await prisma.adminUser.update({
    where: { id: adminId },
    data: {
      ...data,
      sessionVersion: { increment: 1 },
    },
  });

  await invalidateAdminAuthCache(adminId);

  return admin;
};
