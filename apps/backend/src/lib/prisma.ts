import { PrismaClient } from '@prisma/client';
import { logger } from './logger';

/**
 * Prisma Client Singleton
 * Prevents multiple instances of Prisma Client in development
 * when hot-reloading happens.
 *
 * Connection pooling:
 * Prisma respects `connection_limit` and `pool_timeout` in DATABASE_URL.
 * For Cloud Run (horizontal scaling), set in your env:
 *   DATABASE_URL="postgresql://...?connection_limit=5&pool_timeout=20"
 * This keeps each container instance to max 5 connections.
 * At 10 instances × 5 = 50 connections — well within PostgreSQL's default 100.
 */

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

export const prisma =
  global.prisma ||
  new PrismaClient({
    // Enable query logging in development for debugging
    // log: ['query', 'info', 'warn', 'error'],
  });

prisma.$use(async (params, next) => {
  const before = Date.now();

  const result = await Promise.race([
    next(params),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Query timeout: ${params.model}.${params.action}`)),
        5000
      )
    )
  ]);

  const durationMs = Date.now() - before;

  if (durationMs > 1000) {
    logger.warn({
      event: 'slow_query',
      meta: {
        model: params.model,
        action: params.action,
        durationMs,
      },
    });
  }

  return result;
});

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}
