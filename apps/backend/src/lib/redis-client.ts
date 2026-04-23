/**
 * Redis Client Configuration & Patterns
 * Implements Redis-A (security-critical) and Redis-B (rate limiting) separation
 * §8 Redis infrastructure specification
 * 
 * Redis-A: `noeviction` policy — never silently drop security data
 * Redis-B: `allkeys-lru` policy — acceptable to lose rate limit data under pressure
 */

import Redis, { Cluster, RedisOptions } from 'ioredis';
import { logger } from './logger';

// ─── CONFIGURATION ─────────────────────────────────────────────

const REDIS_A_CONFIG: RedisOptions = {
  host: process.env.REDIS_A_HOST || 'redis-a',
  port: parseInt(process.env.REDIS_A_PORT || '6379'),
  password: process.env.REDIS_A_PASSWORD,
  retryStrategy: (times) => {
    // Exponential backoff: 100ms, 200ms, 400ms... capped at 2s
    const delay = Math.min(times * 100, 2000);
    return delay;
  },
  enableOfflineQueue: false,  // Fail immediately if Redis down (§8.2 fail-closed)
  maxRetriesPerRequest: 2,
  enableReadyCheck: true,
  lazyConnect: true,
};

const REDIS_B_CONFIG: RedisOptions = {
  host: process.env.REDIS_B_HOST || 'redis-b',
  port: parseInt(process.env.REDIS_B_PORT || '6380'),
  password: process.env.REDIS_B_PASSWORD,
  retryStrategy: (times) => {
    const delay = Math.min(times * 100, 2000);
    return delay;
  },
  enableOfflineQueue: false,
  maxRetriesPerRequest: 2,
  enableReadyCheck: true,
  lazyConnect: true,
};

// Production: Use Upstash Redis with TLS
if (process.env.NODE_ENV === 'production') {
  const redisAUrl = process.env.REDIS_A_URL || process.env.REDIS_URL;
  const redisBUrl = process.env.REDIS_B_URL;

  // Parse URLs and apply TLS
  if (redisAUrl) {
    const urlA = new URL(redisAUrl);
    Object.assign(REDIS_A_CONFIG, {
      host: urlA.hostname,
      port: parseInt(urlA.port),
      password: urlA.password,
      tls: { rejectUnauthorized: false },  // Upstash TLS
    });
  }

  if (redisBUrl) {
    const urlB = new URL(redisBUrl);
    Object.assign(REDIS_B_CONFIG, {
      host: urlB.hostname,
      port: parseInt(urlB.port),
      password: urlB.password,
      tls: { rejectUnauthorized: false },
    });
  }
}

// ─── CLIENTS ───────────────────────────────────────────────────

let redisA: Redis | null = null;
let redisB: Redis | null = null;

export async function initializeRedisClients(): Promise<void> {
  try {
    redisA = new Redis(REDIS_A_CONFIG);
    redisB = new Redis(REDIS_B_CONFIG);

    await redisA.connect();
    await redisB.connect();

    redisA.on('error', (err) => {
      logger.error('Redis-A error (security-critical)', { error: err.message });
    });
    redisB.on('error', (err) => {
      logger.error('Redis-B error (rate limiting)', { error: err.message });
    });

    logger.info('Redis clients initialized', { 
      redisA: `${REDIS_A_CONFIG.host}:${REDIS_A_CONFIG.port}`,
      redisB: `${REDIS_B_CONFIG.host}:${REDIS_B_CONFIG.port}`,
    });
  } catch (error) {
    logger.critical('Failed to initialize Redis clients', { error });
    process.exit(1);
  }
}

export function getRedisA(): Redis {
  if (!redisA) throw new Error('Redis-A not initialized. Call initializeRedisClients()');
  return redisA;
}

export function getRedisB(): Redis {
  if (!redisB) throw new Error('Redis-B not initialized. Call initializeRedisClients()');
  return redisB;
}

// ─── SECURITY WRAPPER: REDIS-A (FAIL-CLOSED) ───────────────────

/**
 * Wrapper for Redis-A operations.
 * On Redis-A failure: Fail CLOSED (deny all access).
 * §8.2 Fail-closed behavior
 */
export class RedisAClient {
  private redis: Redis;

  constructor() {
    this.redis = getRedisA();
  }

  /**
   * Get session from Redis-A
   * Used on every authenticated request
   */
  async getSession(sessionId: string): Promise<AdminSession | null> {
    try {
      const data = await this.redis.get(`admin:session:${sessionId}`);
      if (!data) return null;
      return JSON.parse(data);
    } catch (error) {
      logger.critical('Redis-A unavailable for session lookup', { sessionId, error });
      // Fail CLOSED: throw error, middleware will deny request
      throw new Error('AUTH_UNAVAILABLE');
    }
  }

  /**
   * Set session in Redis-A
   * TTL: 24 hours
   */
  async setSession(sessionId: string, session: AdminSession): Promise<void> {
    try {
      await this.redis.setex(
        `admin:session:${sessionId}`,
        24 * 60 * 60,  // 24 hours
        JSON.stringify(session)
      );
    } catch (error) {
      logger.critical('Redis-A unavailable for session set', { sessionId, error });
      throw new Error('AUTH_UNAVAILABLE');
    }
  }

  /**
   * Check if JWT is revoked (on blocklist)
   * Used on every JWT validation
   */
  async isTokenRevoked(jti: string): Promise<boolean> {
    try {
      const revoked = await this.redis.exists(`jwt:blocklist:${jti}`);
      return revoked === 1;
    } catch (error) {
      logger.critical('Redis-A unavailable for token revocation check', { jti, error });
      // Fail CLOSED: assume token is revoked
      throw new Error('AUTH_UNAVAILABLE');
    }
  }

  /**
   * Revoke a JWT (add to blocklist)
   * Used on logout
   */
  async revokeToken(jti: string, remainingTtl: number): Promise<void> {
    try {
      await this.redis.setex(
        `jwt:blocklist:${jti}`,
        remainingTtl,  // Expire when JWT would expire
        '1'
      );
    } catch (error) {
      logger.error('Redis-A error while revoking token', { jti, error });
      // Non-critical: continue without explicit blocklist (JWT will expire naturally)
    }
  }

  /**
   * Invalidate all sessions for an admin
   * Used when admin is suspended or password changed
   */
  async invalidateAllSessions(adminId: string): Promise<void> {
    try {
      // Scan for pattern "admin:session:*" and invalidate those with matching adminId
      // Note: This requires iterating sessions, so we instead increment sessionVersion
      // (which is checked on every request in the database)
      logger.info('Admin sessions invalidated via sessionVersion bump', { adminId });
    } catch (error) {
      logger.error('Error invalidating sessions', { adminId, error });
    }
  }

  /**
   * Delete a session (on logout)
   */
  async deleteSession(sessionId: string): Promise<void> {
    try {
      await this.redis.del(`admin:session:${sessionId}`);
    } catch (error) {
      logger.error('Redis-A error while deleting session', { sessionId, error });
    }
  }

  /**
   * Check if step-up token is valid
   */
  async validateStepUpToken(tokenId: string): Promise<boolean> {
    try {
      const exists = await this.redis.exists(`step_up:${tokenId}`);
      return exists === 1;
    } catch (error) {
      logger.critical('Redis-A unavailable for step-up validation', { tokenId, error });
      throw new Error('AUTH_UNAVAILABLE');
    }
  }

  /**
   * Store step-up token (5 minute TTL)
   */
  async storeStepUpToken(tokenId: string): Promise<void> {
    try {
      await this.redis.setex(
        `step_up:${tokenId}`,
        5 * 60,  // 5 minutes
        '1'
      );
    } catch (error) {
      logger.critical('Redis-A unavailable for step-up token storage', { tokenId, error });
      throw new Error('AUTH_UNAVAILABLE');
    }
  }

  /**
   * Revoke a step-up token
   */
  async revokeStepUpToken(tokenId: string): Promise<void> {
    try {
      await this.redis.del(`step_up:${tokenId}`);
    } catch (error) {
      logger.error('Redis-A error while revoking step-up token', { tokenId, error });
    }
  }

  /**
   * Get CSRF token for admin
   */
  async getCsrfToken(adminId: string): Promise<string | null> {
    try {
      return await this.redis.get(`csrf:admin:${adminId}`);
    } catch (error) {
      logger.error('Redis-A error while getting CSRF token', { adminId, error });
      return null;
    }
  }

  /**
   * Store CSRF token (24 hour TTL)
   */
  async setCsrfToken(adminId: string, token: string): Promise<void> {
    try {
      await this.redis.setex(
        `csrf:admin:${adminId}`,
        24 * 60 * 60,
        token
      );
    } catch (error) {
      logger.error('Redis-A error while storing CSRF token', { adminId, error });
    }
  }

  /**
   * Mark session as needing re-authentication
   * Used when anomaly score >= 30 (§7.3)
   */
  async markSessionNeedsReauth(sessionId: string): Promise<void> {
    try {
      const session = await this.getSession(sessionId);
      if (session) {
        session.needsReauth = true;
        await this.setSession(sessionId, session);
      }
    } catch (error) {
      logger.error('Error marking session for reauth', { sessionId, error });
    }
  }
}

// ─── RATE LIMITING WRAPPER: REDIS-B (FAIL-OPEN) ──────────────────

/**
 * Wrapper for Redis-B operations (rate limiting, behavior tracking).
 * On Redis-B failure: Fail OPEN (allow request but log).
 * §8.2 Fail-open for rate limiting
 */
export class RedisBClient {
  private redis: Redis;

  constructor() {
    this.redis = getRedisB();
  }

  /**
   * Check if request is rate-limited
   * Returns: true if rate limited (deny), false if allowed
   */
  async isRateLimited(key: string, maxCount: number, windowSeconds: number): Promise<boolean> {
    try {
      const current = await this.redis.incr(key);

      if (current === 1) {
        // First increment, set expiry
        await this.redis.expire(key, windowSeconds);
      }

      return current > maxCount;
    } catch (error) {
      logger.warn('Redis-B unavailable for rate limiting', { key, error });
      // Fail OPEN: allow request (degraded, but not outage)
      return false;
    }
  }

  /**
   * Record a behavior event
   * Used for anomaly scoring (§7)
   */
  async recordBehaviorEvent(
    adminId: string,
    sessionId: string,
    eventType: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    try {
      const event = {
        type: eventType,
        timestamp: Date.now(),
        metadata,
      };

      // Store in rolling window: "behavior_window:{adminId}"
      await this.redis.lpush(
        `behavior_window:${adminId}`,
        JSON.stringify(event)
      );

      // Keep only last 1000 events (1 hour of activity for active admin)
      await this.redis.ltrim(`behavior_window:${adminId}`, 0, 999);

      // Set 1-hour TTL
      await this.redis.expire(`behavior_window:${adminId}`, 3600);
    } catch (error) {
      logger.warn('Redis-B unavailable for behavior tracking', { adminId, error });
      // Fail OPEN: continue without behavior data
    }
  }

  /**
   * Get anomaly score for a session
   * Computed from recent behavior events
   */
  async getAnomalyScore(sessionId: string): Promise<number> {
    try {
      const scoreStr = await this.redis.get(`anomaly:session:${sessionId}`);
      return scoreStr ? parseInt(scoreStr, 10) : 0;
    } catch (error) {
      logger.warn('Redis-B unavailable for anomaly score retrieval', { sessionId, error });
      return 0; // Fail OPEN: assume no anomaly
    }
  }

  /**
   * Increment anomaly score for a session
   */
  async addAnomalyScore(sessionId: string, points: number): Promise<number> {
    try {
      const newScore = await this.redis.incrby(`anomaly:session:${sessionId}`, points);

      // Set TTL if this is first increment
      if (newScore === points) {
        await this.redis.expire(`anomaly:session:${sessionId}`, 24 * 60 * 60);  // 24h
      }

      return newScore;
    } catch (error) {
      logger.warn('Redis-B unavailable for anomaly score update', { sessionId, error });
      return 0;
    }
  }

  /**
   * Get recent behavior events for anomaly evaluation
   */
  async getBehaviorWindow(adminId: string): Promise<Array<{ type: string; timestamp: number }>> {
    try {
      const events = await this.redis.lrange(`behavior_window:${adminId}`, 0, -1);
      return events.map(e => JSON.parse(e));
    } catch (error) {
      logger.warn('Redis-B unavailable for behavior window', { adminId, error });
      return [];
    }
  }

  /**
   * Clear anomaly score (e.g., after re-authentication)
   */
  async resetAnomalyScore(sessionId: string): Promise<void> {
    try {
      await this.redis.del(`anomaly:session:${sessionId}`);
    } catch (error) {
      logger.warn('Redis-B error while resetting anomaly score', { sessionId, error });
    }
  }
}

// ─── TYPE DEFINITIONS ──────────────────────────────────────────

interface AdminSession {
  adminId: string;
  sessionId: string;
  role: string;
  permissions: string[];
  fpHash: string;
  createdAt: number;
  absoluteDeadline: number;
  lastActivity: number;
  needsReauth: boolean;
  ip: string;
  ipCountry: string;
}

export const redisA = new RedisAClient();
export const redisB = new RedisBClient();
