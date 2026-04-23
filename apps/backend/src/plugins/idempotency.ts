/**
 * IDEMPOTENCY PLUGIN
 *
 * Prevents duplicate database writes when the mobile client retries
 * after a network timeout. Critical for:
 *   - Attendance check-ins (students retry on flaky 4G)
 *   - Incident reports (drivers retry on bad connection)
 *   - Skip-today actions (one-per-day; duplicate = data corruption)
 *   - Correction requests, import execution, delegation actions
 *
 * HOW IT WORKS:
 *   1. Client generates a UUID per logical action and sends it in
 *      the Idempotency-Key header. The SAME key must be sent on retries.
 *   2. On first request: key not in Redis → process normally → cache result.
 *   3. On retry: key found in Redis → return cached result immediately,
 *      no DB write.
 *   4. TTL expires after the configured window → key cleared automatically.
 *
 * ACTIVATION:
 *   Routes opt in by calling cacheIdempotentResponse() after their
 *   operation completes. Routes that don't call it are unaffected.
 *
 * Install: app.register(idempotencyPlugin)
 */

import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { AppError } from '../lib/errors';
import { fail } from 'shared';

declare module 'fastify' {
  interface FastifyRequest {
    idempotencyKey?: string;
  }
}

const IDEMPOTENCY_CACHE_PREFIX = 'idem:v1:';

const idempotencyPlugin: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const key = request.headers['idempotency-key'];

    // No header → proceed normally, idempotency not requested
    if (!key || typeof key !== 'string') return;

    // Validate key format
    if (key.length < 1 || key.length > 100) {
      return reply.code(400).send(
        fail('INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must be 1–100 characters.', {
          retryable: false,
          requestId: request.id,
        }),
      );
    }

    const redis = (app as any).redis;
    if (!redis) {
      // Redis not configured — continue without idempotency
      request.idempotencyKey = key;
      return;
    }

    const cacheKey = `${IDEMPOTENCY_CACHE_PREFIX}${key}`;

    try {
      const cached = await redis.get(cacheKey);

      if (cached) {
        let parsed: { statusCode: number; body: unknown };
        try {
          parsed = JSON.parse(cached);
        } catch {
          // Corrupted cache entry — clear it and process fresh
          await redis.del(cacheKey);
          request.idempotencyKey = key;
          return;
        }

        request.log.info({
          idempotencyKey: key,
          cacheHit: true,
          msg: 'Idempotent cache hit — returning cached response',
        });

        reply.header('Idempotency-Replay', 'true');
        return reply.code(parsed.statusCode).send(parsed.body);
      }

      // Key not in cache — store on request for route handler to use
      request.idempotencyKey = key;
    } catch (_err) {
      // Redis error — proceed without idempotency
      request.idempotencyKey = key;
    }
  });
};

export const IDEMPOTENCY_TTL = {
  /** Daily actions — check-in, skip-today */
  ONE_DAY: 86400,
  /** Short-lived session actions — wait-for-me, correction request */
  ONE_HOUR: 3600,
  /** 30 minutes */
  THIRTY_MINUTES: 1800,
  /** 6 hours — incident report, delegation */
  SIX_HOURS: 21600,
  /** 48 hours — import execution, report generation */
  TWO_DAYS: 172800,
} as const;

/**
 * Call this in a route handler AFTER the operation succeeds.
 * Subsequent requests with the same Idempotency-Key will receive
 * this exact response without re-executing the operation.
 *
 * @param request    Fastify request (must have idempotencyKey set)
 * @param statusCode HTTP status code that was returned
 * @param body       Response body that was returned
 * @param ttlSeconds How long to cache (see IDEMPOTENCY_TTL constants)
 */
export async function cacheIdempotentResponse(
  request: FastifyRequest,
  statusCode: number,
  body: unknown,
  ttlSeconds = 3600,
): Promise<void> {
  if (!request.idempotencyKey) return;

  const redis = (request.server as any).redis;
  if (!redis) return; // Redis not configured

  const cacheKey = `${IDEMPOTENCY_CACHE_PREFIX}${request.idempotencyKey}`;

  try {
    await redis.setex(cacheKey, ttlSeconds, JSON.stringify({ statusCode, body }));
  } catch (_err) {
    // Redis error — log but don't fail the request
    request.log.warn({
      idempotencyKey: request.idempotencyKey,
      msg: 'Failed to cache idempotent response',
    });
  }
}

export default fp(idempotencyPlugin, { name: 'idempotency' });
