import { logger } from './logger';
import { metrics } from './metrics';

export type FallbackStrategy = 'db_lookup' | 'allow_degraded' | 'fail_hard' | 'skip_silent';

type CircuitState = 'closed' | 'open' | 'half_open';

class SimpleCircuitBreaker {
  private state: CircuitState = 'closed';
  private failures = 0;
  private openedAt = 0;

  constructor(
    private readonly name: string,
    private readonly threshold = 3,
    private readonly cooldownMs = 10_000,
  ) {}

  isOpen() {
    if (this.state !== 'open') {
      return false;
    }

    if (Date.now() - this.openedAt > this.cooldownMs) {
      this.state = 'half_open';
      return false;
    }

    return true;
  }

  recordSuccess() {
    this.state = 'closed';
    this.failures = 0;
  }

  recordFailure(error: unknown) {
    this.failures += 1;

    if (this.failures >= this.threshold) {
      this.state = 'open';
      this.openedAt = Date.now();
      logger.warn({
        event: 'redis_circuit_opened',
        source: 'SYSTEM',
        meta: {
          circuit: this.name,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
}

const breakers = new Map<string, SimpleCircuitBreaker>();

function getBreaker(name: string): SimpleCircuitBreaker {
  const existing = breakers.get(name);
  if (existing) {
    return existing;
  }

  const created = new SimpleCircuitBreaker(name);
  breakers.set(name, created);
  return created;
}

export async function circuitExecute<T>(
  operation: () => Promise<T>,
  strategy: FallbackStrategy,
  fallback?: () => Promise<T>,
  breakerName = 'redis',
): Promise<T> {
  const breaker = getBreaker(breakerName);

  if (breaker.isOpen()) {
    return executeFallback(strategy, fallback, breakerName);
  }

  try {
    const result = await operation();
    breaker.recordSuccess();
    return result;
  } catch (error) {
    breaker.recordFailure(error);
    return executeFallback(strategy, fallback, breakerName, error);
  }
}

async function executeFallback<T>(
  strategy: FallbackStrategy,
  fallback: (() => Promise<T>) | undefined,
  breakerName: string,
  originalError?: unknown,
): Promise<T> {
  switch (strategy) {
    case 'db_lookup':
      metrics.increment('redis.circuit.db_lookup', { breaker: breakerName }).catch(() => undefined);
      if (!fallback) {
        throw originalError instanceof Error ? originalError : new Error(String(originalError));
      }
      return fallback();
    case 'allow_degraded':
      metrics.increment('redis.circuit.allow_degraded', { breaker: breakerName }).catch(() => undefined);
      logger.warn({
        event: 'redis_circuit_allow_degraded',
        source: 'SYSTEM',
        meta: {
          breaker: breakerName,
          error: originalError instanceof Error ? originalError.message : String(originalError),
        },
      });
      if (!fallback) {
        throw new Error(`Fallback missing for ${breakerName}`);
      }
      return fallback();
    case 'skip_silent':
      metrics.increment('redis.circuit.skip_silent', { breaker: breakerName }).catch(() => undefined);
      if (!fallback) {
        return null as T;
      }
      return fallback();
    case 'fail_hard':
    default:
      metrics.increment('redis.circuit.fail_hard', { breaker: breakerName }).catch(() => undefined);
      throw originalError instanceof Error ? originalError : new Error(String(originalError));
  }
}
