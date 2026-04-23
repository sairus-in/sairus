import { randomUUID } from 'crypto';
import { metrics } from './metrics';
import { redis } from './redis';

const releaseScript = `
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
  end
  return 0
`;

const renewScript = `
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('PEXPIRE', KEYS[1], ARGV[2])
  end
  return 0
`;

export interface Lock {
  resource: string;
  value: string;
  ttlMs: number;
  release: () => Promise<void>;
}

/**
 * Best-effort distributed lock using Redis SET NX PX.
 *
 * IMPORTANT: This is NOT full Redlock. This provides mutual exclusion
 * only while a single Redis node remains healthy. Known limitations:
 * - Redis restart loses all locks, so concurrent execution becomes possible
 * - Network partitions can make lock state inconsistent
 *
 * Acceptable for: dashboard reconciliation, cache rebuilds, report generation
 * Not acceptable for: money movement, hard uniqueness guarantees, booking prevention
 */
export async function acquireLock(resource: string, ttlMs: number): Promise<Lock | null> {
  const value = randomUUID();
  // COORDINATION: lock:* serializes best-effort background jobs on the single Redis node.
  const key = `lock:${resource}`;
  const acquired = await redis.set(key, value, 'PX', ttlMs, 'NX');

  if (acquired !== 'OK') {
    return null;
  }

  return {
    resource,
    value,
    ttlMs,
    release: async () => {
      await redis.eval(releaseScript, 1, key, value);
    },
  };
}

async function renewLock(lock: Lock): Promise<boolean> {
  // COORDINATION: lock:* renewal preserves ownership while the job is still active.
  const result = await redis.eval(
    renewScript,
    1,
    `lock:${lock.resource}`,
    lock.value,
    String(lock.ttlMs),
  );

  return result === 1;
}

export async function withLock(
  resource: string,
  ttlMs: number,
  work: () => Promise<void>,
): Promise<boolean> {
  const lock = await acquireLock(resource, ttlMs);
  if (!lock) {
    return false;
  }

  let lostError: Error | null = null;
  const renewalInterval = Math.max(1_000, Math.floor(ttlMs / 2));
  const timer = setInterval(() => {
    void renewLock(lock)
      .then(async (ok) => {
        if (ok) {
          return;
        }

        await metrics.increment('distributed_lock.lost', { resource });
        lostError = new Error(`Lock lost while renewing ${resource}`);
      })
      .catch(async (error) => {
        await metrics.increment('distributed_lock.lost', { resource });
        lostError = error instanceof Error ? error : new Error(String(error));
      });
  }, renewalInterval);

  try {
    await work();

    if (lostError) {
      throw lostError;
    }

    return true;
  } finally {
    clearInterval(timer);
    await lock.release().catch(() => undefined);
  }
}
