/**
 * Admin Rate Limiting — Layered Rate Limit Enforcement
 * Implements §11 Rate Limiting specification
 * 
 * Three layers:
 * 1. API Gateway / Nginx (300 req/min per IP on /admin/*)
 * 2. Application (Redis-B) for auth endpoints
 * 3. Application (Redis-B) for anomaly scoring
 */

import { redisB } from './redis-client';
import { logger } from './logger';
import { CONSTANTS } from '../modules/auth/admin-auth.types';

/**
 * Check login rate limits (IP + Email)
 * Returns: { allowed: boolean, remaining: number, resetIn: number }
 * 
 * Limits:
 *   - 5 attempts per 15 minutes per IP
 *   - 10 attempts per 1 hour per email
 */
export async function checkLoginRateLimit(ip: string, email: string): Promise<{
  allowed: boolean;
  remaining: number;
  resetIn: number;
  reason?: string;
}> {
  const emailHash = hashEmail(email);

  // Check IP rate limit
  const ipKey = `ratelimit:login:ip:${ip}`;
  const ipLimited = await redisB.isRateLimited(
    ipKey,
    CONSTANTS.RATE_LIMIT_LOGIN_IP.max,
    CONSTANTS.RATE_LIMIT_LOGIN_IP.window
  );

  if (ipLimited) {
    logger.warn('Login rate limit exceeded (IP)', { ip });
    const ttl = await redisB.redis.ttl(ipKey);
    return {
      allowed: false,
      remaining: 0,
      resetIn: ttl > 0 ? ttl : 60,
      reason: 'too_many_attempts_from_ip',
    };
  }

  // Check email rate limit (account lockout)
  const emailKey = `ratelimit:login:email:${emailHash}`;
  const emailLimited = await redisB.isRateLimited(
    emailKey,
    CONSTANTS.RATE_LIMIT_LOGIN_EMAIL.max,
    CONSTANTS.RATE_LIMIT_LOGIN_EMAIL.window
  );

  if (emailLimited) {
    logger.warn('Login rate limit exceeded (Email)', { email: emailHash });
    const ttl = await redisB.redis.ttl(emailKey);
    return {
      allowed: false,
      remaining: 0,
      resetIn: ttl > 0 ? ttl : 3600,
      reason: 'account_locked',
    };
  }

  return { allowed: true, remaining: CONSTANTS.RATE_LIMIT_LOGIN_IP.max, resetIn: 0 };
}

/**
 * Check refresh token rate limit
 * Limit: 20 requests per minute per session
 */
export async function checkRefreshRateLimit(sessionId: string): Promise<{
  allowed: boolean;
  remaining: number;
}> {
  const key = `ratelimit:refresh:session:${sessionId}`;
  const limited = await redisB.isRateLimited(
    key,
    CONSTANTS.RATE_LIMIT_REFRESH.max,
    CONSTANTS.RATE_LIMIT_REFRESH.window
  );

  if (limited) {
    logger.warn('Refresh rate limit exceeded', { sessionId });
    return { allowed: false, remaining: 0 };
  }

  return { allowed: true, remaining: CONSTANTS.RATE_LIMIT_REFRESH.max };
}

/**
 * Check step-up authentication rate limit
 * Limit: 3 attempts per 5 minutes per admin
 */
export async function checkStepUpRateLimit(adminId: string): Promise<{
  allowed: boolean;
  remaining: number;
  resetIn: number;
}> {
  const key = `ratelimit:step_up:admin:${adminId}`;
  const limited = await redisB.isRateLimited(
    key,
    CONSTANTS.RATE_LIMIT_STEP_UP.max,
    CONSTANTS.RATE_LIMIT_STEP_UP.window
  );

  if (limited) {
    logger.warn('Step-up rate limit exceeded', { adminId });
    const ttl = await redisB.redis.ttl(key);
    return {
      allowed: false,
      remaining: 0,
      resetIn: ttl > 0 ? ttl : 60,
    };
  }

  return { allowed: true, remaining: CONSTANTS.RATE_LIMIT_STEP_UP.max, resetIn: 0 };
}

/**
 * Check general API rate limit for admin
 * Limit: 100 requests per minute per admin
 * Anomaly triggered at: 80+ requests (score increment)
 */
export async function checkAPIRateLimit(adminId: string): Promise<{
  allowed: boolean;
  requestCount: number;
  anomalyTriggered: boolean;
}> {
  const key = `ratelimit:api:admin:${adminId}`;
  const limited = await redisB.isRateLimited(
    key,
    CONSTANTS.RATE_LIMIT_API.max,
    CONSTANTS.RATE_LIMIT_API.window
  );

  // Get current count for anomaly scoring
  const currentCount = await redisB.redis.get(key);
  const count = currentCount ? parseInt(currentCount, 10) : 0;

  // Anomaly triggered if count >= 80
  const anomalyTriggered = count >= 80;

  if (limited) {
    logger.warn('API rate limit exceeded', { adminId, count });
    return { allowed: false, requestCount: count, anomalyTriggered: true };
  }

  return { allowed: true, requestCount: count, anomalyTriggered };
}

/**
 * Increment failed login attempt counter
 * Used to track consecutive failed logins
 */
export async function recordFailedLoginAttempt(email: string): Promise<number> {
  const emailHash = hashEmail(email);
  const key = `failed_login:${emailHash}`;
  const count = await redisB.redis.incr(key);

  if (count === 1) {
    // Set TTL on first increment (1 hour window)
    await redisB.redis.expire(key, 3600);
  }

  return count;
}

/**
 * Reset failed login attempts on successful login
 */
export async function resetFailedLoginAttempts(email: string): Promise<void> {
  const emailHash = hashEmail(email);
  const key = `failed_login:${emailHash}`;
  await redisB.redis.del(key);
}

/**
 * Get failed login attempts for an email
 */
export async function getFailedLoginAttempts(email: string): Promise<number> {
  const emailHash = hashEmail(email);
  const key = `failed_login:${emailHash}`;
  const count = await redisB.redis.get(key);
  return count ? parseInt(count, 10) : 0;
}

/**
 * Lock account after too many failed attempts
 * Lock duration: 1 hour
 */
export async function lockAccountTemporarily(email: string, reasonCode: string = 'failed_login_attempts'): Promise<void> {
  const lockKey = `account_locked:${hashEmail(email)}`;
  await redisB.redis.setex(lockKey, 3600, reasonCode); // 1 hour lock
}

/**
 * Check if account is locked
 */
export async function isAccountLocked(email: string): Promise<boolean> {
  const lockKey = `account_locked:${hashEmail(email)}`;
  const locked = await redisB.redis.exists(lockKey);
  return locked === 1;
}

/**
 * Increment anomaly score for a session
 * Called when threshold behaviors are detected
 */
export async function incrementAnomalyScore(sessionId: string, points: number, reason: string): Promise<number> {
  return redisB.addAnomalyScore(sessionId, points);
}

/**
 * Get current anomaly score for a session
 */
export async function getAnomalyScore(sessionId: string): Promise<number> {
  return redisB.getAnomalyScore(sessionId);
}

/**
 * Reset anomaly score (after re-authentication)
 */
export async function resetAnomalyScore(sessionId: string): Promise<void> {
  return redisB.resetAnomalyScore(sessionId);
}

/**
 * Record a behavior event for anomaly evaluation
 */
export async function recordBehaviorEvent(
  adminId: string,
  sessionId: string,
  eventType: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  return redisB.recordBehaviorEvent(adminId, sessionId, eventType, metadata);
}

/**
 * Get behavior window for anomaly scoring
 */
export async function getBehaviorWindow(adminId: string): Promise<Array<{ type: string; timestamp: number }>> {
  return redisB.getBehaviorWindow(adminId);
}

// ─── HELPER FUNCTIONS ──────────────────────────────────

/**
 * Hash email for rate limiting keys
 * Prevents enumeration attacks (email not visible in logs)
 */
function hashEmail(email: string): string {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(email).digest('hex');
}

/**
 * Config for layered rate limits
 */
export const RATE_LIMIT_CONFIG = {
  // API Gateway level (not enforced in code, configured in nginx/reverse proxy)
  API_GATEWAY: {
    path: '/admin/*',
    limit: 300,
    window: 60,
    per: 'ip',
  },

  // Application level (Redis-B)
  LOGIN_IP: {
    max: CONSTANTS.RATE_LIMIT_LOGIN_IP.max,
    window: CONSTANTS.RATE_LIMIT_LOGIN_IP.window,
  },
  LOGIN_EMAIL: {
    max: CONSTANTS.RATE_LIMIT_LOGIN_EMAIL.max,
    window: CONSTANTS.RATE_LIMIT_LOGIN_EMAIL.window,
  },
  REFRESH: {
    max: CONSTANTS.RATE_LIMIT_REFRESH.max,
    window: CONSTANTS.RATE_LIMIT_REFRESH.window,
  },
  STEP_UP: {
    max: CONSTANTS.RATE_LIMIT_STEP_UP.max,
    window: CONSTANTS.RATE_LIMIT_STEP_UP.window,
  },
  API: {
    max: CONSTANTS.RATE_LIMIT_API.max,
    window: CONSTANTS.RATE_LIMIT_API.window,
  },
};

/**
 * Print rate limit config for documentation
 */
export function describeRateLimits(): string {
  return `
Rate Limiting Configuration:

Login Protection:
  - ${RATE_LIMIT_CONFIG.LOGIN_IP.max} attempts per ${RATE_LIMIT_CONFIG.LOGIN_IP.window}s per IP
  - ${RATE_LIMIT_CONFIG.LOGIN_EMAIL.max} attempts per ${RATE_LIMIT_CONFIG.LOGIN_EMAIL.window}s per email (account lockout)

Token Refresh:
  - ${RATE_LIMIT_CONFIG.REFRESH.max} refreshes per ${RATE_LIMIT_CONFIG.REFRESH.window}s per session

Step-Up Authentication:
  - ${RATE_LIMIT_CONFIG.STEP_UP.max} attempts per ${RATE_LIMIT_CONFIG.STEP_UP.window}s per admin

API Endpoints:
  - ${RATE_LIMIT_CONFIG.API.max} requests per ${RATE_LIMIT_CONFIG.API.window}s per admin
  - Anomaly scoring triggered at 80+ requests/min
`;
}
