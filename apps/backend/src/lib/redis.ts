import Redis from 'ioredis';
import { env, isProduction } from './env';
import { wrapOwnedRedis } from './redis-owned';

/**
 * Redis Client Initialization
 * Connects to local Docker Redis (dev) or Upstash/Memorystore (production).
 * Upstash URLs with rediss:// automatically use TLS - no extra config needed.
 * For GCP Memorystore, TLS is configured at the instance level.
 */
const redisUrl = env.REDIS_URL;

const redisClient = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    return Math.min(times * 50, 2000);
  },
  enableReadyCheck: true,
  lazyConnect: false,
});

export const redis = wrapOwnedRedis(redisClient);

redis.on('error', (err) => {
  if (isProduction) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: 'error',
        event: 'redis_error',
        error: err.message,
      }),
    );
  } else {
    console.error('[Redis Error]', err);
  }
});

redis.on('connect', () => {
  if (isProduction) {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: 'info',
        event: 'redis_connected',
      }),
    );
  } else {
    console.log('Connected to Redis cache');
  }
});
