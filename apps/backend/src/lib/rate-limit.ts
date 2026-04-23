/**
 * RATE LIMITING UTILITY
 *
 * Atomic Redis rate limiting using Lua scripts.
 * Replaces the non-atomic INCR->EXPIRE pattern which had a race condition.
 *
 * Always sets X-RateLimit-* response headers so clients can implement
 * proper backoff instead of hammering the server after a 429.
 */

import type { FastifyReply } from 'fastify';
import type Redis from 'ioredis';
import * as crypto from 'crypto';
import { AppError, TooManyRequestsError } from './errors';
import { logger } from './logger';
import { metrics } from './metrics';
import { redis } from './redis';
import { circuitExecute } from './redis-circuit';

const RATE_LIMIT_LUA = `
  local key     = KEYS[1]
  local max     = tonumber(ARGV[1])
  local window  = tonumber(ARGV[2])
  local current = redis.call('INCR', key)
  if current == 1 then
    redis.call('EXPIRE', key, window)
  end
  local ttl = redis.call('TTL', key)
  return { current, ttl }
`;

type RedisEvalLike = Pick<Redis, 'eval'>;

type WindowCounterResult = {
  count: number;
  degraded: boolean;
};

export interface RateLimitOptions {
  key: string;
  max: number;
  windowSeconds: number;
  reply: FastifyReply;
  message?: string;
}

async function incrementWindowCounter(
  key: string,
  windowSeconds: number,
  breakerName: string,
): Promise<WindowCounterResult> {
  return circuitExecute<WindowCounterResult>(
    async () => {
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, windowSeconds);
      }

      return { count, degraded: false };
    },
    'allow_degraded',
    async () => ({ count: 0, degraded: true }),
    breakerName,
  );
}

async function allowDegradedRateLimit(
  operation: () => Promise<void>,
  breakerName: string,
  labels: Record<string, string>,
): Promise<void> {
  await circuitExecute(
    operation,
    'allow_degraded',
    async () => {
      await metrics.increment('rate_limit.degraded_allow', labels);
    },
    breakerName,
  );
}

export async function checkRateLimit(
  redisInstance: RedisEvalLike | null | undefined,
  options: RateLimitOptions,
): Promise<void> {
  if (!redisInstance) {
    return;
  }

  const { key, max, windowSeconds, reply } = options;

  const result = await circuitExecute(
    async () =>
      redisInstance.eval(RATE_LIMIT_LUA, 1, key, max, windowSeconds) as Promise<[number, number]>,
    'allow_degraded',
    async () => {
      await metrics.increment('rate_limit.degraded_allow', { key: 'generic' });
      return [0, windowSeconds] as [number, number];
    },
    'generic-rate-limit',
  );

  const [current, ttl] = result;
  const remaining = Math.max(0, max - current);
  const resetAt = Math.floor(Date.now() / 1000) + Math.max(0, ttl);

  reply.header('X-RateLimit-Limit', max);
  reply.header('X-RateLimit-Remaining', remaining);
  reply.header('X-RateLimit-Reset', resetAt);

  if (current > max) {
    reply.header('Retry-After', ttl > 0 ? ttl : windowSeconds);
    throw new TooManyRequestsError();
  }
}

export const RateLimits = {
  mobileLogin: (ip: string) => ({
    key: `rl:mobile:login:ip:${ip}`,
    max: 10,
    windowSeconds: 60,
  }),
  mobileRefresh: (ip: string) => ({
    key: `rl:mobile:refresh:ip:${ip}`,
    max: 10,
    windowSeconds: 60,
  }),
  adminLogin: (ip: string) => ({
    key: `rl:admin:login:ip:${ip}`,
    max: 10,
    windowSeconds: 60,
  }),
  logoutAll: (userId: string) => ({
    key: `rl:logout-all:user:${userId}`,
    max: 3,
    windowSeconds: 3600,
  }),
  checkIn: (userId: string) => ({
    key: `rl:checkin:user:${userId}`,
    max: 5,
    windowSeconds: 60,
  }),
  gpsPing: (busId: string) => ({
    key: `rl:gps:bus:${busId}`,
    max: 30,
    windowSeconds: 60,
  }),
  incidentReport: (driverId: string) => ({
    key: `rl:incident:driver:${driverId}`,
    max: 10,
    windowSeconds: 3600,
  }),
  mfaDisable: (adminId: string) => ({
    key: `rl:mfa-disable:admin:${adminId}`,
    max: 3,
    windowSeconds: 900,
  }),
  forgotPassword: (ip: string) => ({
    key: `rl:forgot-pw:ip:${ip}`,
    max: 5,
    windowSeconds: 3600,
  }),
} as const;

export const checkMobileLoginRateLimit = async (phone: string, ip: string) => {
  const phoneHash = crypto.createHash('sha256').update(phone).digest('hex').slice(0, 16);

  const ipCounter = await incrementWindowCounter(`ratelimit:mobile:login:ip:${ip}`, 60, 'mobile-login-ip');
  if (ipCounter.count > 10) {
    throw new AppError(
      'Too many login attempts. Please try again later.',
      429,
      'RATE_LIMITED',
    );
  }

  const phoneCounter = await incrementWindowCounter(
    `ratelimit:mobile:login:phone:${phoneHash}`,
    60,
    'mobile-login-phone',
  );
  if (phoneCounter.count > 5) {
    throw new AppError(
      'Too many login attempts for this number. Please try again later.',
      429,
      'RATE_LIMITED',
    );
  }
};

export const checkAdminLoginRateLimit = async (email: string, ip: string) => {
  const emailHash = crypto.createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 16);
  const lockKey = `ratelimit:admin:locked:${emailHash}`;
  const accountKey = `ratelimit:admin:account:${emailHash}`;

  const locked = await circuitExecute(
    () => redis.get(lockKey),
    'allow_degraded',
    async () => null,
    'admin-login-lock-check',
  );
  if (locked) {
    throw new AppError('Account locked for 15 minutes.', 429, 'ACCOUNT_TEMPORARILY_LOCKED');
  }

  const ipCounter = await incrementWindowCounter(`ratelimit:admin:login:ip:${ip}`, 60, 'admin-login-ip');
  if (ipCounter.count > 10) {
    throw new AppError('Too many login attempts from this IP.', 429, 'RATE_LIMITED');
  }

  const accountCounter = await incrementWindowCounter(accountKey, 5 * 60, 'admin-login-account');
  if (accountCounter.count > 5) {
    await allowDegradedRateLimit(
      async () => {
        await redis.setex(lockKey, 15 * 60, '1');
        await redis.del(accountKey);
      },
      'admin-login-lock-write',
      { key: 'admin-login-lock-write' },
    );

    throw new AppError(
      'Too many failed attempts. Account locked for 15 minutes.',
      429,
      'ACCOUNT_TEMPORARILY_LOCKED',
    );
  }
};

export const resetAdminLoginRateLimit = async (email: string) => {
  const emailHash = crypto.createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 16);
  await allowDegradedRateLimit(
    async () => {
      await redis.del(`ratelimit:admin:account:${emailHash}`);
    },
    'admin-login-reset',
    { key: 'admin-login-reset' },
  );
};

export const checkAdminAuthenticatedRateLimit = async (adminId: string, ip: string) => {
  const adminCounter = await incrementWindowCounter(`ratelimit:admin:api:${adminId}`, 60, 'admin-api-admin');
  if (adminCounter.count > 100) {
    throw new AppError(
      'Too many admin API requests. Please slow down and try again.',
      429,
      'RATE_LIMITED',
    );
  }

  const ipCounter = await incrementWindowCounter(`ratelimit:admin:api:ip:${ip}`, 60, 'admin-api-ip');
  if (ipCounter.count > 300) {
    throw new AppError(
      'Too many admin requests from this IP. Please slow down and try again.',
      429,
      'RATE_LIMITED',
    );
  }

  return {
    adminCount: adminCounter.count,
    ipCount: ipCounter.count,
    anomalyTriggered: adminCounter.count >= 80,
  };
};

export const checkAdminForgotPasswordRateLimit = async (ip: string) => {
  const counter = await incrementWindowCounter(`ratelimit:admin:forgot:${ip}`, 300, 'admin-forgot-password');
  if (counter.count > 5) {
    throw new AppError(
      'Too many requests. Please wait before asking for a new password link.',
      429,
      'RATE_LIMITED',
    );
  }
};

export const checkAdminMfaRateLimit = async (challengeToken: string, ip: string) => {
  const ipCounter = await incrementWindowCounter(`ratelimit:admin:mfa:ip:${ip}`, 5 * 60, 'admin-mfa-ip');
  if (ipCounter.count > 20) {
    throw new AppError('Too many MFA verification attempts from this IP.', 429, 'RATE_LIMITED');
  }

  const challengeCounter = await incrementWindowCounter(
    `ratelimit:admin:mfa:challenge:${challengeToken}`,
    5 * 60,
    'admin-mfa-challenge',
  );
  if (challengeCounter.count > 8) {
    throw new AppError(
      'Too many MFA verification attempts. Start over and sign in again.',
      429,
      'RATE_LIMITED',
    );
  }
};

export const checkAdminStepUpRateLimit = async (adminId: string, ip: string) => {
  const adminCounter = await incrementWindowCounter(
    `ratelimit:admin:stepup:admin:${adminId}`,
    5 * 60,
    'admin-step-up-admin',
  );
  if (adminCounter.count > 5) {
    throw new AppError(
      'Too many step-up attempts. Please wait a few minutes and try again.',
      429,
      'TOO_MANY_ATTEMPTS',
    );
  }

  const ipCounter = await incrementWindowCounter(
    `ratelimit:admin:stepup:ip:${ip}`,
    5 * 60,
    'admin-step-up-ip',
  );
  if (ipCounter.count > 20) {
    throw new AppError(
      'Too many step-up attempts from this IP. Please wait and try again.',
      429,
      'RATE_LIMITED',
    );
  }
};

export const checkAdminInviteRateLimit = async (ip: string) => {
  const counter = await incrementWindowCounter(`ratelimit:admin:invite:ip:${ip}`, 3600, 'admin-invite');
  if (counter.count > 20) {
    throw new AppError(
      'Too many invitations sent from this IP. Please try again later.',
      429,
      'RATE_LIMITED',
    );
  }
};
