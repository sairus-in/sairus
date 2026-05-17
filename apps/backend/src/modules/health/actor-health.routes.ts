/**
 * Synthetic actor health endpoints — Phase 1a Commit 3 staging verification.
 *
 * Returns the resolved req.actor with capabilities flattened to an array
 * for human inspection. Used to confirm resolveActor produces the right
 * shape for a known mobile JWT and admin cookie before any policy or
 * serializer migration depends on it.
 *
 * Env-gated to non-production so a forgotten deletion at the end of
 * Phase 1a cannot leak debug shape into prod. Delete at end of Phase 1a.
 *
 * Actor contains no credential material (no password hashes, no MFA
 * secrets, no FCM tokens, no JWT) so the response is safe to return as-is.
 */

import type { FastifyInstance } from 'fastify';
import { requireMobileAuth } from '../auth/auth.middleware';
import { requireAdminAuth } from '../auth/admin-auth.middleware';
import { ok } from 'shared';
import { AppError } from '../../lib/errors';
import { isProduction } from '../../lib/env';

const serializeActorForDebug = (actor: NonNullable<import('fastify').FastifyRequest['actor']>) => ({
  actorId: actor.actorId,
  actorType: actor.actorType,
  capabilities: [...actor.capabilities].sort(),
  scope: actor.scope,
  sessionContext: actor.sessionContext,
});

export async function actorHealthRoutes(app: FastifyInstance): Promise<void> {
  if (isProduction) {
    return;
  }

  app.get('/actor/mobile', { preHandler: [requireMobileAuth] }, async (req, reply) => {
    if (!req.actor) throw new AppError(500, 'INTERNAL_SERVER_ERROR', req.id);
    return reply.send(ok(serializeActorForDebug(req.actor), req.id));
  });

  app.get('/actor/admin', { preHandler: [requireAdminAuth] }, async (req, reply) => {
    if (!req.actor) throw new AppError(500, 'INTERNAL_SERVER_ERROR', req.id);
    return reply.send(ok(serializeActorForDebug(req.actor), req.id));
  });
}
