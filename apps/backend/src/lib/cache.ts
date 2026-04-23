// apps/backend/src/lib/cache.ts
// Resilient Redis helpers plus Redis-first read helpers for hot paths.

import { Prisma } from '@prisma/client';
import { CACHE_TTL } from 'shared';
import { logger } from './logger';
import { prisma } from './prisma';
import { redis } from './redis';

type CachedRouteAssignment = Prisma.RouteAssignmentGetPayload<{
  include: {
    stop: true;
    route: {
      include: {
        stops: {
          orderBy: {
            sequence: 'asc';
          };
        };
      };
    };
  };
}>;

type CachedUser = Prisma.UserGetPayload<Record<string, never>>;

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const value = await redis.get(key);
    if (value === null) {
      return null;
    }

    try {
      return JSON.parse(value) as T;
    } catch {
      return value as T;
    }
  } catch (error) {
    logger.warn({
      event: 'cache_get_failed',
      source: 'SYSTEM',
      meta: { key, error: String(error) },
    });
    return null;
  }
}

export function cacheSet(key: string, value: unknown, ttlSeconds: number): void {
  void redis.setex(key, ttlSeconds, JSON.stringify(value)).catch((error) => {
    logger.warn({
      event: 'cache_set_failed',
      source: 'SYSTEM',
      meta: { key, error: String(error) },
    });
  });
}

export async function cacheDel(keys: string | string[]): Promise<void> {
  const normalizedKeys = Array.isArray(keys) ? keys.filter(Boolean) : [keys];
  if (normalizedKeys.length === 0) {
    return;
  }

  try {
    await redis.del(...normalizedKeys);
  } catch (error) {
    logger.warn({
      event: 'cache_del_failed',
      source: 'SYSTEM',
      meta: { keys: normalizedKeys, error: String(error) },
    });
  }
}

export async function cacheHIncrBy(key: string, field: string, increment: number): Promise<void> {
  try {
    await redis.hincrby(key, field, increment);
  } catch (error) {
    logger.warn({
      event: 'cache_hincrby_failed',
      source: 'SYSTEM',
      meta: { key, field, increment, error: String(error) },
    });
  }
}

export async function cacheSRem(key: string, member: string): Promise<void> {
  try {
    await redis.srem(key, member);
  } catch (error) {
    logger.warn({
      event: 'cache_srem_failed',
      source: 'SYSTEM',
      meta: { key, member, error: String(error) },
    });
  }
}

export async function cacheSAdd(key: string, member: string): Promise<void> {
  try {
    await redis.sadd(key, member);
  } catch (error) {
    logger.warn({
      event: 'cache_sadd_failed',
      source: 'SYSTEM',
      meta: { key, member, error: String(error) },
    });
  }
}

export async function cacheHSet(key: string, value: Record<string, string | number>): Promise<void> {
  try {
    await redis.hset(key, value);
  } catch (error) {
    logger.warn({
      event: 'cache_hset_failed',
      source: 'SYSTEM',
      meta: { key, error: String(error) },
    });
  }
}

export async function invalidateAdminScopedCache(adminUserId: string): Promise<void> {
  try {
    const keys = await redis.keys(`admin:${adminUserId}:*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }

    logger.info({
      event: 'admin_scoped_cache_invalidated',
      source: 'SYSTEM',
      userId: adminUserId,
      meta: { count: keys.length },
    });
  } catch (error) {
    logger.warn({
      event: 'admin_scoped_cache_invalidation_failed',
      source: 'SYSTEM',
      userId: adminUserId,
      meta: { error: String(error) },
    });
  }
}

/**
 * Get the active trip for a bus.
 * Redis key: trip:active:{busId} (stored as tripId string).
 */
export async function getActiveTripCached(busId: string) {
  const cacheKey = `trip:active:${busId}`;
  const cachedTripId = await cacheGet<string>(cacheKey);

  if (cachedTripId) {
    return prisma.trip.findUnique({ where: { id: cachedTripId } });
  }

  const trip = await prisma.trip.findFirst({
    where: { busId, status: 'ACTIVE' },
  });

  if (trip) {
    cacheSet(cacheKey, trip.id, CACHE_TTL.ACTIVE_TRIP_SECONDS);
  }

  return trip;
}

/**
 * Set the active trip for a bus in Redis (called on trip start).
 */
export async function setActiveTripCache(busId: string, tripId: string) {
  cacheSet(`trip:active:${busId}`, tripId, CACHE_TTL.ACTIVE_TRIP_SECONDS);
}

/**
 * Clear the active trip cache (called on trip end).
 */
export async function clearActiveTripCache(busId: string) {
  await cacheDel(`trip:active:${busId}`);
}

/**
 * Get a student's route assignment (cached 1 hour, rarely changes).
 */
export async function getRouteAssignmentCached(userId: string) {
  const cacheKey = `route:assignment:${userId}`;
  const cached = await cacheGet<CachedRouteAssignment>(cacheKey);

  if (cached) {
    return cached;
  }

  const assignment = await prisma.routeAssignment.findUnique({
    where: { userId },
    include: { stop: true, route: { include: { stops: { orderBy: { sequence: 'asc' } } } } },
  });

  if (assignment) {
    cacheSet(cacheKey, assignment, CACHE_TTL.ROUTE_ASSIGNMENT_SECONDS);
  }

  return assignment;
}

/**
 * Invalidate route assignment cache (called on re-assignment).
 */
export async function invalidateRouteAssignmentCache(userId: string) {
  await cacheDel(`route:assignment:${userId}`);
}

/**
 * Get the user object with deviceId/fcmToken for auth checks (short TTL).
 */
export async function getUserCached(userId: string) {
  const cacheKey = `user:${userId}`;
  const cached = await cacheGet<CachedUser>(cacheKey);
  if (cached) {
    return cached;
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (user) {
    cacheSet(cacheKey, user, 60);
  }
  return user;
}
