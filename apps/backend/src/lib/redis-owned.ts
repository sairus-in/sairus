import type Redis from 'ioredis';
import { logger } from './logger';
import { metrics } from './metrics';

const KEY_OWNERS: Record<string, string> = {
  'cache:trip:': 'trips.service',
  'cache:route:': 'routes.service',
  'cache:user:': 'users.service',
  'rl:login:': 'auth.service',
  'rl:checkin:': 'attendance.service',
  'auth:session:': 'auth.service',
  'auth:admin:': 'auth.service',
  'auth:user:': 'auth.service',
  'lock:': 'distributed-lock',
  'sms:delivered:': 'notification.worker',
  'push:dedup:': 'notification.worker',
  'dash:': 'admin.service',
  'dashboard:': 'admin.service',
  'gps:': 'trips.service',
  'trip:delegate:': 'trips.service',
} as const;

function inferCallerModule(): string | null {
  const stack = new Error().stack;
  if (!stack) {
    return null;
  }

  const normalized = stack.replace(/\//g, '\\');

  if (normalized.includes('\\modules\\attendance\\')) return 'attendance.service';
  if (normalized.includes('\\modules\\trips\\')) return 'trips.service';
  if (normalized.includes('\\modules\\routes\\')) return 'routes.service';
  if (normalized.includes('\\modules\\users\\')) return 'users.service';
  if (normalized.includes('\\modules\\auth\\') || normalized.includes('\\lib\\auth-')) return 'auth.service';
  if (normalized.includes('\\jobs\\notification.worker\\') || normalized.includes('\\modules\\notifications\\')) {
    return 'notification.worker';
  }
  if (normalized.includes('\\modules\\admin\\') || normalized.includes('\\jobs\\reconcile-dashboard-stats')) {
    return 'admin.service';
  }
  if (normalized.includes('\\lib\\distributed-lock')) return 'distributed-lock';

  return null;
}

export function assertKeyOwnership(key: string, callerModule: string | null): void {
  if (!callerModule) {
    return;
  }

  for (const [prefix, owner] of Object.entries(KEY_OWNERS)) {
    if (!key.startsWith(prefix) || owner === callerModule) {
      continue;
    }

    const message = `Key ownership violation: "${callerModule}" wrote "${key}" (owned by "${owner}")`;
    logger.error({
      event: 'redis_ownership_violation',
      source: 'SYSTEM',
      meta: { key, callerModule, owner, prefix },
    });
    void metrics.increment('redis.ownership_violation', {
      key_prefix: prefix,
      caller: callerModule,
    });

    if (process.env.NODE_ENV !== 'production') {
      throw new Error(message);
    }

    return;
  }
}

export async function safeRedisSet(
  redis: Redis,
  key: string,
  value: string,
  ttlSeconds: number,
  callerModule: string | null = inferCallerModule(),
): Promise<'OK'> {
  assertKeyOwnership(key, callerModule);
  return redis.setex(key, ttlSeconds, value);
}

type RedisWriteMethod = 'set' | 'setex' | 'hset' | 'sadd' | 'expire' | 'del' | 'incr' | 'incrby' | 'decr';

export function wrapOwnedRedis<T extends Redis>(client: T): T {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== 'string' || typeof value !== 'function') {
        return value;
      }

      const writeMethods: RedisWriteMethod[] = ['set', 'setex', 'hset', 'sadd', 'expire', 'del', 'incr', 'incrby', 'decr'];
      if (!writeMethods.includes(prop as RedisWriteMethod)) {
        return value.bind(target);
      }

      return (...args: unknown[]) => {
        const callerModule = inferCallerModule();

        if (prop === 'del') {
          args
            .filter((arg): arg is string => typeof arg === 'string')
            .forEach((key) => assertKeyOwnership(key, callerModule));
        } else {
          const key = typeof args[0] === 'string' ? args[0] : null;
          if (key) {
            assertKeyOwnership(key, callerModule);
          }
        }

        return value.apply(target, args);
      };
    },
  });
}
