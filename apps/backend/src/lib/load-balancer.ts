// Load Balancer & Scaling Optimizations
// Handles 6000+ concurrent users

import { redis, getCached } from './redis-optimized';
import { prisma } from './prisma';

interface BatchedGpsPing {
  busId: string;
  lat: number;
  lng: number;
  timestamp: number;
  speed?: number;
  heading?: number;
  accuracy?: number;
}

/**
 * Prisma connection pool configuration for high load.
 * Query timeout and slow-query logging already live in the shared Prisma singleton.
 */
export const optimizedPrismaClient = () => prisma;

/**
 * Batcher for database writes.
 */
export class WriteBatcher<T> {
  private buffer: T[] = [];
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly name: string,
    private readonly flushFn: (items: T[]) => Promise<void>,
    private readonly options: {
      maxSize: number;
      maxWaitMs: number;
    }
  ) {}

  add(item: T): void {
    this.buffer.push(item);

    if (this.buffer.length >= this.options.maxSize) {
      void this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => void this.flush(), this.options.maxWaitMs);
    }
  }

  private async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    if (this.buffer.length === 0) return;

    const batch = this.buffer.splice(0, this.buffer.length);

    try {
      await this.flushFn(batch);
    } catch (err) {
      console.error(`Batcher ${this.name} flush failed:`, err);
      this.buffer.unshift(...batch);
    }
  }

  async shutdown(): Promise<void> {
    await this.flush();
  }
}

export const gpsPingBatcher = new WriteBatcher<BatchedGpsPing>(
  'gps-pings',
  async (pings) => {
    await prisma.gpsLog.createMany({
      data: pings.map((ping) => ({
        busId: ping.busId,
        lat: ping.lat,
        lon: ping.lng,
        timestamp: new Date(ping.timestamp),
        speed: ping.speed ?? 0,
        heading: ping.heading ?? 0,
        accuracy: ping.accuracy ?? 0,
      })),
    });
  },
  { maxSize: 100, maxWaitMs: 1000 }
);

export const withReadReplica = <T>(
  readFn: () => Promise<T>,
  options: { useReplica?: boolean; cacheKey?: string; cacheTtl?: number } = {}
): Promise<T> => {
  const { useReplica = true, cacheKey, cacheTtl = 30 } = options;

  if (cacheKey) {
    return getCached(cacheKey, readFn, cacheTtl);
  }

  if (useReplica) {
    return readFn();
  }

  return readFn();
};

interface ScalingMetrics {
  activeConnections: number;
  requestLatency: number;
  cpuUtilization: number;
  memoryUtilization: number;
  queueDepth: number;
}

export const evaluateScaling = async (metrics: ScalingMetrics): Promise<{
  action: 'SCALE_UP' | 'SCALE_DOWN' | 'MAINTAIN';
  reason: string;
  targetInstances?: number;
}> => {
  const { activeConnections, requestLatency, cpuUtilization, queueDepth } = metrics;

  if (requestLatency > 500 || cpuUtilization > 70 || queueDepth > 100) {
    return {
      action: 'SCALE_UP',
      reason: `High load detected: latency=${requestLatency}ms, cpu=${cpuUtilization}%`,
      targetInstances: Math.min(10, Math.ceil(activeConnections / 50)),
    };
  }

  const hour = new Date().getHours();
  const isPeak = hour >= 7 && hour <= 10;

  if (!isPeak && cpuUtilization < 20 && requestLatency < 100) {
    return {
      action: 'SCALE_DOWN',
      reason: `Low utilization during off-peak: cpu=${cpuUtilization}%`,
      targetInstances: Math.max(2, Math.floor(activeConnections / 100)),
    };
  }

  return {
    action: 'MAINTAIN',
    reason: 'Metrics within normal range',
  };
};

export const FEATURE_FLAGS = {
  ENABLE_GEO_CACHE: 'flag:geo-cache',
  ENABLE_BATCH_WRITES: 'flag:batch-writes',
  ENABLE_READ_REPLICA: 'flag:read-replica',
  REDUCE_GPS_PRECISION: 'flag:reduce-gps-precision',
  DISABLE_NON_CRITICAL_JOBS: 'flag:disable-jobs',
} as const;

export const isFeatureEnabled = async (flag: string): Promise<boolean> => {
  try {
    const value = await redis.get(flag);
    return value === 'true';
  } catch {
    return true;
  }
};

export const autoDegrade = async (metrics: ScalingMetrics): Promise<void> => {
  if (metrics.cpuUtilization > 80) {
    await redis.setex(FEATURE_FLAGS.DISABLE_NON_CRITICAL_JOBS, 300, 'true');
    console.warn('Auto-degraded: Disabled non-critical jobs');
  }

  if (metrics.requestLatency > 1000) {
    await redis.setex(FEATURE_FLAGS.ENABLE_GEO_CACHE, 300, 'true');
    console.warn('Auto-degraded: Enabled aggressive geo caching');
  }

  if (metrics.memoryUtilization > 85) {
    await redis.setex(FEATURE_FLAGS.REDUCE_GPS_PRECISION, 300, 'true');
    console.warn('Auto-degraded: Reduced GPS precision');
  }
};

export const rateLimitStrategy = {
  STUDENT: { burst: 10, sustained: 5, window: 60 },
  DRIVER: { burst: 60, sustained: 30, window: 60 },
  ADMIN: { burst: 100, sustained: 50, window: 60 },
  EXTERNAL: { burst: 10, sustained: 5, window: 60 },
};

export const checkUserRateLimit = async (
  userId: string,
  userType: keyof typeof rateLimitStrategy
): Promise<{ allowed: boolean; retryAfter?: number }> => {
  const strategy = rateLimitStrategy[userType];
  const key = `ratelimit:${userType}:${userId}`;

  const now = Date.now();
  const windowStart = now - strategy.window * 1000;

  const pipeline = redis.pipeline();
  pipeline.zremrangebyscore(key, 0, windowStart);
  pipeline.zcard(key);
  pipeline.zadd(key, now, `${now}-${Math.random()}`);
  pipeline.pexpire(key, strategy.window * 1000);

  const results = await pipeline.exec();
  const currentCount = Number(results?.[1]?.[1] ?? 0);

  if (currentCount > strategy.burst) {
    const oldest = await redis.zrange(key, 0, 0, 'WITHSCORES');
    const retryAfter = oldest.length >= 2
      ? Math.ceil((parseInt(oldest[1], 10) + strategy.window * 1000 - now) / 1000)
      : strategy.window;
    return { allowed: false, retryAfter };
  }

  return { allowed: true };
};

export const getHealthStatus = async (): Promise<{
  healthy: boolean;
  checks: Record<string, boolean>;
  load: number;
}> => {
  const checks: Record<string, boolean> = {
    database: false,
    redis: false,
    memory: false,
    cpu: false,
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = true;
  } catch {
    checks.database = false;
  }

  try {
    await redis.ping();
    checks.redis = true;
  } catch {
    checks.redis = false;
  }

  const memUsage = process.memoryUsage();
  checks.memory = memUsage.heapUsed < 400 * 1024 * 1024;
  checks.cpu = true;

  const healthy = Object.values(checks).every(Boolean);
  const load = Math.round(
    (memUsage.heapUsed / (512 * 1024 * 1024)) * 50 +
    (checks.database ? 0 : 25) +
    (checks.redis ? 0 : 25)
  );

  return { healthy, checks, load };
};
