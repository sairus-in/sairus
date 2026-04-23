/**
 * REQUEST CONTEXT PLUGIN
 *
 * Adds to every request:
 *   - requestId: unique ID, echoed back in X-Request-Id header + all log lines
 *   - startTime: for computing response duration
 *   - Structured access log on every response (method, path, userId, role, duration, status)
 *
 * Install before route registration so requestId is available everywhere.
 * Install: app.register(requestContextPlugin)
 */

import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { enterRequestContext } from '../lib/correlation';

declare module 'fastify' {
  interface FastifyRequest {
    startTime: number;
  }
}

const requestContextPlugin: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (request) => {
    enterRequestContext(request.id);
    request.startTime = Date.now();
  });

  app.addHook('onResponse', async (request) => {
    const durationMs = Date.now() - request.startTime;
    const user = (request as { user?: { sub?: string; role?: string } }).user;

    request.log.info({
      method: request.method,
      path: request.routerPath ?? request.url,
      statusCode: (request as { __statusCode?: number }).__statusCode ?? 200,
      durationMs,
      userId: user?.sub ?? null,
      role: user?.role ?? null,
    });

    if (durationMs > 2000) {
      request.log.warn({
        path: request.routerPath ?? request.url,
        durationMs,
        msg: 'SLOW_REQUEST: exceeded 2000ms threshold',
      });
    }
  });
};

export default fp(requestContextPlugin, { name: 'request-context' });
