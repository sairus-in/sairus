import type { FastifyRequest } from 'fastify';
import type { Actor } from 'shared';
import { AppError } from '../../lib/errors';

export function assertActor(request: FastifyRequest): Actor {
  if (!request.actor) {
    throw new AppError(500, 'ACTOR_NOT_RESOLVED');
  }
  return request.actor;
}
