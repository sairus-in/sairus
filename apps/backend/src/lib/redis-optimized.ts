// Optimized Redis Implementation for High Throughput
// Based on Uber-scale patterns

import Redis from 'ioredis';
import { gridDisk, latLngToCell } from 'h3-js';
import { env } from './env';

export const createRedisClient = () => {
  return new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    connectionName: 'bus-backend',
    retryStrategy: (times) => {
      const delay = Math.min(Math.exp(times) * 100, 20000);
      console.log(`Redis reconnect attempt ${times}, delay ${delay}ms`);
      return delay;
    },
    reconnectOnError: (err) => {
      const targetErrors = ['READONLY', 'ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET'];
      return targetErrors.some((errorCode) => err.message.includes(errorCode));
    },
    keepAlive: 30000,
    enableOfflineQueue: true,
  });
};

export const redis = createRedisClient();
export const redisPub = redis.duplicate();
export const redisSub = redis.duplicate();

const H3_RESOLUTION = 9;

export const latLngToH3 = (lat: number, lng: number): string => {
  return latLngToCell(lat, lng, H3_RESOLUTION);
};

export const getH3Neighbors = (h3Index: string, k: number = 1): string[] => {
  return gridDisk(h3Index, k);
};

export const isWithinH3Range = (
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
  maxK: number = 2
): boolean => {
  const h3_1 = latLngToH3(lat1, lng1);
  const h3_2 = latLngToH3(lat2, lng2);
  const neighbors = getH3Neighbors(h3_1, maxK);
  return neighbors.includes(h3_2);
};

export const batchUpdateBusLocations = async (
  locations: Array<{ busId: string; lat: number; lng: number; timestamp: number }>
): Promise<void> => {
  if (locations.length === 0) return;

  const pipeline = redis.pipeline();
  const h3Pipeline = redis.pipeline();

  for (const { busId, lat, lng, timestamp } of locations) {
    const h3Index = latLngToH3(lat, lng);

    pipeline.geoadd('fleet:positions', lng, lat, busId);
    h3Pipeline.sadd(`h3:${h3Index}`, busId);
    h3Pipeline.expire(`h3:${h3Index}`, 300);
    pipeline.setex(`bus:${busId}:location`, 300, JSON.stringify({ lat, lng, timestamp, h3Index }));
    pipeline.setex(`bus:${busId}:lastseen`, 300, timestamp.toString());
  }

  await Promise.all([pipeline.exec(), h3Pipeline.exec()]);
};

const haversineMeters = (lat1: number, lng1: number, lat2: number, lng2: number) => {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const findNearbyBusesH3 = async (
  lat: number,
  lng: number,
  k: number = 1
): Promise<Array<{ busId: string; distance: number }>> => {
  const centerH3 = latLngToH3(lat, lng);
  const searchHexagons = getH3Neighbors(centerH3, k);

  if (searchHexagons.length === 0) return [];

  const busIds = await redis.sunion(...searchHexagons.map((hexagon) => `h3:${hexagon}`));
  if (busIds.length === 0) return [];

  const locations = await Promise.all(
    busIds.map(async (busId) => {
      const location = await redis.get(`bus:${busId}:location`);
      if (!location) return null;
      const parsed = JSON.parse(location) as { lat: number; lng: number };
      return {
        busId,
        distance: haversineMeters(lat, lng, parsed.lat, parsed.lng),
      };
    })
  );

  return locations.filter((item): item is { busId: string; distance: number } => item !== null);
};

export const storeLocationTiered = async (data: {
  busId: string;
  lat: number;
  lng: number;
  timestamp: number;
  speed?: number;
  heading?: number;
}): Promise<void> => {
  const { busId, lat, lng, timestamp, speed = 0, heading = 0 } = data;
  const h3Index = latLngToH3(lat, lng);

  const pipeline = redis.pipeline();

  pipeline.setex(
    `bus:${busId}:loc`,
    300,
    JSON.stringify({ lat, lng, timestamp, h3Index, speed, heading })
  );
  pipeline.geoadd('fleet:positions', lng, lat, busId);
  pipeline.zadd(`ts:bus:${busId}:gps`, timestamp, JSON.stringify({ lat, lng, speed, heading }));
  pipeline.zremrangebyscore(`ts:bus:${busId}:gps`, 0, timestamp - 86400000);
  pipeline.xadd(
    'gps:cold-storage',
    '*',
    'busId', busId,
    'lat', lat.toString(),
    'lng', lng.toString(),
    'h3', h3Index,
    't', timestamp.toString(),
    's', speed.toString()
  );

  await pipeline.exec();
};

export const getBusLocation = async (busId: string): Promise<{
  lat: number;
  lng: number;
  timestamp: number;
  stale: boolean;
} | null> => {
  const hot = await redis.get(`bus:${busId}:loc`);
  if (hot) {
    const data = JSON.parse(hot) as { lat: number; lng: number; timestamp: number };
    return { ...data, stale: false };
  }

  const pos = await redis.geopos('fleet:positions', busId);
  if (pos?.[0]) {
    const [lng, lat] = pos[0];
    if (lng !== null && lat !== null) {
      return {
        lat: parseFloat(String(lat)),
        lng: parseFloat(String(lng)),
        timestamp: Date.now(),
        stale: true,
      };
    }
  }

  return null;
};

export const checkRateLimit = async (
  key: string,
  maxTokens: number,
  refillRate: number
): Promise<{ allowed: boolean; remaining: number; resetTime: number }> => {
  const now = Date.now();
  const bucketKey = `ratelimit:${key}`;

  const luaScript = `
    local key = KEYS[1]
    local now = tonumber(ARGV[1])
    local maxTokens = tonumber(ARGV[2])
    local refillRate = tonumber(ARGV[3])
    local window = tonumber(ARGV[4])

    local bucket = redis.call('HMGET', key, 'tokens', 'lastRefill')
    local tokens = tonumber(bucket[1]) or maxTokens
    local lastRefill = tonumber(bucket[2]) or now

    local deltaTime = (now - lastRefill) / 1000
    local tokensToAdd = deltaTime * refillRate
    tokens = math.min(maxTokens, tokens + tokensToAdd)

    local allowed = 0
    if tokens >= 1 then
      tokens = tokens - 1
      allowed = 1
    end

    redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', now)
    redis.call('EXPIRE', key, window)

    return {allowed, math.floor(tokens)}
  `;

  const result = await redis.eval(
    luaScript,
    1,
    bucketKey,
    now.toString(),
    maxTokens.toString(),
    refillRate.toString(),
    '60'
  ) as [number, number];

  return {
    allowed: result[0] === 1,
    remaining: result[1],
    resetTime: now + 1000 / refillRate,
  };
};

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private lastFailureTime?: number;
  private readonly threshold: number;
  private readonly timeout: number;

  constructor(
    private readonly name: string,
    options: { threshold?: number; timeout?: number } = {}
  ) {
    this.threshold = options.threshold || 5;
    this.timeout = options.timeout || 30000;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - (this.lastFailureTime || 0) > this.timeout) {
        this.state = 'HALF_OPEN';
        this.failures = 0;
      } else {
        throw new Error(`Circuit breaker OPEN for ${this.name}`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess() {
    this.failures = 0;
    this.state = 'CLOSED';
  }

  private onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.threshold) {
      this.state = 'OPEN';
      console.error(`Circuit breaker OPENED for ${this.name}`);
    }
  }
}

export const redisCircuitBreaker = new CircuitBreaker('redis', {
  threshold: 3,
  timeout: 10000,
});

export const getCached = async <T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttlSeconds: number,
  staleTtlSeconds?: number
): Promise<T> => {
  const data = await redis.get(key);

  if (data) {
    const parsed = JSON.parse(data) as { value: T; timestamp: number };
    const age = (Date.now() - parsed.timestamp) / 1000;
    if (staleTtlSeconds && age > ttlSeconds) {
      void revalidate(key, fetchFn, ttlSeconds);
    }

    return parsed.value;
  }

  const value = await fetchFn();
  await redis.setex(
    key,
    ttlSeconds + (staleTtlSeconds || 0),
    JSON.stringify({ value, timestamp: Date.now() })
  );

  return value;
};

const revalidate = async <T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttlSeconds: number
) => {
  try {
    const value = await fetchFn();
    await redis.setex(
      key,
      ttlSeconds,
      JSON.stringify({ value, timestamp: Date.now() })
    );
  } catch (err) {
    console.error('Revalidation failed:', err);
  }
};

export const recordRedisMetrics = async () => {
  const info = await redis.info('stats');
  const keyspaceHits = parseInt(info.match(/keyspace_hits:(\d+)/)?.[1] || '0', 10);
  const keyspaceMisses = parseInt(info.match(/keyspace_misses:(\d+)/)?.[1] || '0', 10);
  const denominator = keyspaceHits + keyspaceMisses;
  const hitRate = denominator === 0 ? 0 : keyspaceHits / denominator;

  console.log({
    event: 'redis_metrics',
    hitRate: hitRate.toFixed(4),
    connectedClients: parseInt(info.match(/connected_clients:(\d+)/)?.[1] || '0', 10),
    usedMemory: info.match(/used_memory_human:(\S+)/)?.[1],
    evictedKeys: parseInt(info.match(/evicted_keys:(\d+)/)?.[1] || '0', 10),
  });
};

setInterval(() => {
  void recordRedisMetrics();
}, 60000);
