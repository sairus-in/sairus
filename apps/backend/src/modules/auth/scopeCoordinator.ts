import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../lib/prisma';
import { ROLES } from 'shared';

// Extend FastifyRequest globally to include coordinatorRouteIds
declare module 'fastify' {
  interface FastifyRequest {
    coordinatorRouteIds?: string[];
  }
}

export const scopeCoordinator = async (request: FastifyRequest, reply: FastifyReply) => {
  if (request.user?.role === 'COORDINATOR') {
    const coordinatedRoutes = await prisma.routeCoordinator.findMany({
      where: { userId: request.user.sub },
      select: { routeId: true },
    });
    request.coordinatorRouteIds = coordinatedRoutes.map(cr => cr.routeId);
  }
};
