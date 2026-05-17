import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { AppError } from '../../lib/errors';
import type { MessageType } from '@prisma/client';

type MessageQuery = {
  busId?: string;
  limit?: number;
  contextType?: string;
  contextId?: string;
};

type CreateMessageData = {
  senderId: string;
  body: string;
  busId?: string | null;
  routeId?: string | null;
  tripId?: string | null;
  incidentId?: string | null;
  contextType: string;
  contextId: string;
  type: MessageType;
  priority?: string;
};

export async function findMessages(params: MessageQuery, routeIds?: string[] | null) {
  try {
    const { busId, contextType, contextId } = params;
    const limit = Math.min(Math.max(params.limit ?? 50, 1), 100);

    let whereClause: Record<string, unknown> = {};

    if (contextType && contextId) {
      whereClause = { contextType, contextId };
    } else if (busId) {
      whereClause = { busId };
    } else {
      whereClause = {
        OR: [
          { type: 'BROADCAST_ALL' },
          { contextType: 'BROADCAST', contextId: 'GLOBAL' },
        ],
      };
    }

    if (routeIds) {
      whereClause = {
        AND: [
          whereClause,
          {
            OR: [
              { routeId: { in: routeIds } },
              {
                AND: [
                  {
                    OR: [
                      { type: 'BROADCAST_ALL' as const },
                      { contextType: 'BROADCAST', contextId: 'GLOBAL' },
                    ],
                  },
                  { routeId: null },
                ],
              },
            ],
          },
        ],
      };
    }

    return await prisma.message.findMany({
      where: whereClause,
      include: {
        sender: { select: { name: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  } catch (e: any) {
    logger.error({ source: 'SYSTEM', event: 'db_query_error', meta: { fn: 'findMessages', error: e.message } });
    throw new AppError('Failed to fetch messages', 500, 'DB_ERROR');
  }
}

export async function createMessage(data: CreateMessageData) {
  try {
    return await prisma.message.create({
      data: {
        senderId: data.senderId,
        body: data.body,
        busId: data.busId,
        routeId: data.routeId,
        tripId: data.tripId,
        incidentId: data.incidentId,
        contextType: data.contextType,
        contextId: data.contextId,
        type: data.type,
        priority: data.priority ?? 'NORMAL',
      },
      include: {
        sender: { select: { name: true, role: true } },
      },
    });
  } catch (e: any) {
    logger.error({ source: 'SYSTEM', event: 'db_query_error', meta: { fn: 'createMessage', error: e.message } });
    throw new AppError('Failed to create message', 500, 'DB_ERROR');
  }
}

export async function findActiveRouteAssignments(routeIds: string[]) {
  return await prisma.routeAssignment.findMany({
    where: { routeId: { in: routeIds } },
    select: { userId: true },
  });
}

export async function findActiveRouteCoordinators(routeIds: string[]) {
  return await prisma.routeCoordinator.findMany({
    where: { routeId: { in: routeIds } },
    select: { userId: true },
  });
}

export async function findCoordinatorsForRoute(routeId: string) {
  return await prisma.routeCoordinator.findMany({
    where: { routeId },
    select: { userId: true },
  });
}

export async function findActiveUsersByRole(roles: string[]) {
  return await prisma.user.findMany({
    where: {
      role: { in: roles as any },
      isActive: true,
    },
    select: { id: true },
  });
}

export async function findSubstituteBuses(excludeBusId: string) {
  return await prisma.bus.findMany({
    where: {
      isActive: true,
      id: { not: excludeBusId },
    },
    include: {
      assignments: {
        where: { isActive: true },
        include: {
          route: { select: { id: true, name: true } },
          driver: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { number: 'asc' },
  });
}

export async function findBusById(busId: string) {
  return await prisma.bus.findUnique({
    where: { id: busId },
    select: { id: true, number: true, isActive: true },
  });
}
