import fastify from 'fastify';
import { randomUUID } from 'crypto';
import cors from '@fastify/cors';
import { prisma } from './lib/prisma';
import { resolveAllowedOrigins } from './lib/auth-config';
import { env, isProduction } from './lib/env';
import { redis } from './lib/redis';
import { AppError } from './lib/errors';
import { ok } from 'shared';

// Plugins
import idempotencyPlugin from './plugins/idempotency';
import requestContextPlugin from './plugins/request-context';

import { authRoutes } from './modules/auth/auth.routes';
import { adminAuthRoutes } from './modules/auth/admin-auth.routes';
import { studentRoutes } from './modules/student/student.routes';
import { gpsRoutes } from './modules/gps/gps.routes';
import { tripsRoutes } from './modules/trips/trips.routes';
import { attendanceRoutes } from './modules/attendance/attendance.routes';
import { incidentsRoutes } from './modules/incidents/incidents.routes';
import { usersRoutes } from './modules/users/users.routes';
import { jobsRoutes } from './modules/jobs/jobs.routes';
import { adminRoutes } from './modules/admin/admin.routes';
import { importRoutes } from './modules/import/import.routes';
import { routesRoutes } from './modules/routes/routes.routes';
import { fleetRoutes } from './modules/fleet/fleet.routes';
import { driverRoutes } from './modules/driver/driver.routes';
import { actorHealthRoutes } from './modules/health/actor-health.routes';
import { MobileJWTPayload, AdminJWTPayload } from 'shared';

type AuthenticatedMobileRequestUser = MobileJWTPayload & { userId: string };
type AuthenticatedAdminRequestUser = AdminJWTPayload & { userId: string };

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedMobileRequestUser | AuthenticatedAdminRequestUser;
  }
}

const app = fastify({
  logger: true,
  requestIdHeader: 'x-request-id',
  genReqId: (request) => {
    const requestIdHeader = request.headers['x-request-id'];

    if (typeof requestIdHeader === 'string' && requestIdHeader.trim().length > 0) {
      return requestIdHeader;
    }

    if (Array.isArray(requestIdHeader) && requestIdHeader[0]?.trim()) {
      return requestIdHeader[0];
    }

    return randomUUID();
  },
});
const allowedOrigins = resolveAllowedOrigins();

if (isProduction && allowedOrigins.length === 0) {
  throw new Error('CORS_ALLOWED_ORIGINS must be configured in production');
}

import cookie from '@fastify/cookie';

// ── Plugin Registration (order matters) ──────────────────────────────────
// 1. Infrastructure
app.register(cors, {
  credentials: true,
  allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Authorization', 'Idempotency-Key', 'X-Device-Id'],
  exposedHeaders: ['X-Request-Id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Idempotency-Replay'],
  origin: (origin, callback) => {
    if (!origin) {
      // In production, require Origin header
      if (isProduction) {
        callback(new Error('Origin header is required in production'), false);
      } else {
        callback(null, true); // Allow curl/Postman in dev
      }
      return;
    }

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('Origin not allowed by CORS'), false);
  },
});
app.register(cookie);

// 2. Observability (before routes so requestId is available)
app.register(requestContextPlugin);

// 3. Idempotency
app.register(idempotencyPlugin);

app.addHook('onRequest', async (req, reply) => {
  reply.header('X-Request-Id', req.id);
});

app.addHook('onSend', async (req, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('X-XSS-Protection', '1; mode=block');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('Permissions-Policy', 'camera=(), geolocation=(), microphone=()');
  if (isProduction) {
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  reply.removeHeader('X-Powered-By');
  reply.removeHeader('Server');
});

// ── Health Probes (standard response envelope) ─────────────────────────
app.get('/v1/live', async (request, reply) => {
  return reply.send(ok({ status: 'ok' }, request.id));
});

app.get('/v1/ready', async (request, reply) => {
  const [dbCheck, redisCheck] = await Promise.allSettled([
    prisma.$queryRaw`SELECT 1` as Promise<any>,
    redis.ping(),
  ]);

  const checks = {
    database: dbCheck.status === 'fulfilled' ? 'ok' : 'fail',
    redis: redisCheck.status === 'fulfilled' ? 'ok' : 'fail',
  };

  const isReady = checks.database === 'ok' && checks.redis === 'ok';

  if (!isReady) {
    app.log.error({
      event: 'readiness_check_failed',
      severity: 'WARNING',
      checks,
    });
  }

  return reply.code(isReady ? 200 : 503).send(
    ok({ status: isReady ? 'ready' : 'not_ready', checks }, request.id),
  );
});

app.get('/v1/health', async (_request, reply) => {
  return reply.redirect('/v1/ready');
});

// ── Route Registration ──────────────────────────────────────────────────
app.register(authRoutes, { prefix: '/v1/auth' });
app.register(adminAuthRoutes, { prefix: '/v1/admin/auth' });
app.register(studentRoutes, { prefix: '/v1/student' });
app.register(gpsRoutes, { prefix: '/v1/gps' });
app.register(tripsRoutes, { prefix: '/v1/trips' });
app.register(attendanceRoutes, { prefix: '/v1/attendance' });
app.register(incidentsRoutes, { prefix: '/v1/incidents' });
app.register(usersRoutes, { prefix: '/v1/users' });
app.register(jobsRoutes, { prefix: '/v1/jobs' });
app.register(adminRoutes, { prefix: '/v1/admin' });
app.register(importRoutes, { prefix: '/v1/import' });
app.register(routesRoutes, { prefix: '/v1/routes' });
app.register(fleetRoutes, { prefix: '/v1/fleet' });
app.register(driverRoutes, { prefix: '/v1/driver' });
// Phase 1a Commit 3 — staging-only actor resolver health checks. Delete at end of Phase 1a.
app.register(actorHealthRoutes, { prefix: '/v1/health' });

// ── Error Handler (must be last) ────────────────────────────────────────
import { setupErrorHandler } from './lib/error-handler';
setupErrorHandler(app);

export default app;
