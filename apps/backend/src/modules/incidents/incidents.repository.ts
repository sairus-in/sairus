import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { AppError } from '../../lib/errors';
import type { IncidentStatus, EscalationLevel, Role } from '@prisma/client';

/**
 * INCIDENTS REPOSITORY — Data Access Layer
 *
 * Isolates all Prisma queries for the Incidents domain.
 * Handles incident reporting, escalation, resolution, and querying.
 * All functions return bare data (no transformation).
 * Error handling: P2025 → 404 (not found)
 */

/**
 * Get a trip by ID with bus and route context
 */
export async function getTripWithContext(tripId: string) {
  try {
    return await prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        bus: { select: { id: true, number: true } },
        route: { select: { id: true, name: true } },
      },
    });
  } catch (e: any) {
    if (e.code === 'P2025') throw new AppError('Trip not found', 404, 'TRIP_NOT_FOUND');
    logger.error({ source: 'SYSTEM', event: 'db_query_error', meta: { fn: 'getTripWithContext', tripId, error: e.message } });
    throw new AppError('Failed to fetch trip', 500, 'DB_ERROR');
  }
}

/**
 * Create an incident report
 */
export async function createIncident(
  tripId: string,
  busId: string,
  routeId: string,
  reportedById: string,
  type: string,
  description: string,
) {
  try {
    return await prisma.incident.create({
      data: {
        tripId,
        busId,
        routeId,
        reportedById,
        type: type as any,
        description,
        status: 'REPORTED',
        escalationLevel: 'COORDINATOR',
      },
    });
  } catch (e: any) {
    logger.error({ source: 'SYSTEM', event: 'db_query_error', meta: { fn: 'createIncident', tripId, error: e.message } });
    throw new AppError('Failed to create incident', 500, 'DB_ERROR');
  }
}

/**
 * Get route coordinators for a route
 */
export async function getRouteCoordinators(routeId: string) {
  try {
    const coordinators = await prisma.routeCoordinator.findMany({
      where: { routeId },
      include: { user: { select: { id: true } } },
    });
    return coordinators.map(c => c.user.id);
  } catch (e: any) {
    logger.error({ source: 'SYSTEM', event: 'db_query_error', meta: { fn: 'getRouteCoordinators', routeId, error: e.message } });
    throw new AppError('Failed to fetch coordinators', 500, 'DB_ERROR');
  }
}

/**
 * Get an incident by ID with full context
 */
export async function getIncidentById(incidentId: string) {
  try {
    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      select: {
        id: true,
        tripId: true,
        busId: true,
        routeId: true,
        type: true,
        description: true,
        reportedAt: true,
        reportedById: true,
        status: true,
        escalationLevel: true,
        resolvedAt: true,
        resolvedById: true,
        resolutionNotes: true,
        trip: {
          include: {
            bus: { select: { id: true, number: true } },
            route: { select: { id: true, name: true } },
            driver: { select: { id: true, name: true } },
          },
        },
        reportedBy: { select: { id: true, name: true } },
        resolvedBy: { select: { id: true, name: true } },
      },
    });

    if (!incident) throw new AppError('Incident not found', 404, 'INCIDENT_NOT_FOUND');
    return incident;
  } catch (e: any) {
    if (e instanceof AppError) throw e;
    logger.error({ source: 'SYSTEM', event: 'db_query_error', meta: { fn: 'getIncidentById', incidentId, error: e.message } });
    throw new AppError('Failed to fetch incident', 500, 'DB_ERROR');
  }
}

/**
 * Update incident escalation level
 */
export async function updateIncidentEscalationLevel(
  incidentId: string,
  newLevel: EscalationLevel,
) {
  try {
    return await prisma.incident.update({
      where: { id: incidentId },
      data: { escalationLevel: newLevel },
      include: {
        trip: {
          include: {
            bus: { select: { id: true, number: true } },
            route: { select: { id: true, name: true } },
          },
        },
      },
    });
  } catch (e: any) {
    if (e.code === 'P2025') throw new AppError('Incident not found', 404, 'INCIDENT_NOT_FOUND');
    logger.error({ source: 'SYSTEM', event: 'db_query_error', meta: { fn: 'updateIncidentEscalationLevel', incidentId, error: e.message } });
    throw new AppError('Failed to update incident', 500, 'DB_ERROR');
  }
}

/**
 * Mark incident as resolved
 */
export async function resolveIncident(
  incidentId: string,
  resolverId: string,
  resolutionNotes: string,
) {
  try {
    return await prisma.incident.update({
      where: { id: incidentId },
      data: {
        status: 'RESOLVED',
        resolvedById: resolverId,
        resolutionNotes,
        resolvedAt: new Date(),
      },
      include: {
        trip: {
          include: {
            bus: { select: { id: true, number: true } },
            route: { select: { id: true, name: true } },
          },
        },
      },
    });
  } catch (e: any) {
    if (e.code === 'P2025') throw new AppError('Incident not found', 404, 'INCIDENT_NOT_FOUND');
    logger.error({ source: 'SYSTEM', event: 'db_query_error', meta: { fn: 'resolveIncident', incidentId, error: e.message } });
    throw new AppError('Failed to resolve incident', 500, 'DB_ERROR');
  }
}

/**
 * List incidents with filtering, sorting, and cursor pagination
 */
export async function listIncidents(filters: {
  tripId?: string;
  status?: IncidentStatus;
  escalationLevel?: EscalationLevel;
  routeId?: string;
  from?: Date;
  to?: Date;
  cursor?: string;
  limit?: number;
}) {
  try {
    const limit = Math.min(filters.limit ?? 20, 100); // Cap at 100 items

    const incidents = await prisma.incident.findMany({
      where: {
        ...(filters.tripId && { tripId: filters.tripId }),
        ...(filters.status && { status: filters.status }),
        ...(filters.escalationLevel && { escalationLevel: filters.escalationLevel }),
        ...(filters.routeId && { routeId: filters.routeId }),
        ...((filters.from || filters.to) && {
          createdAt: {
            ...(filters.from && { gte: filters.from }),
            ...(filters.to && { lte: filters.to }),
          },
        }),
        ...(filters.cursor && { id: { lt: filters.cursor } }),
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      include: {
        trip: {
          include: {
            bus: { select: { id: true, number: true } },
            route: { select: { id: true, name: true } },
            driver: { select: { id: true, name: true } },
          },
        },
        reportedBy: { select: { id: true, name: true } },
        resolvedBy: { select: { id: true, name: true } },
      },
    });

    const hasMore = incidents.length > limit;
    return {
      incidents: incidents.slice(0, limit),
      nextCursor: hasMore ? incidents[limit - 1]?.id : null,
    };
  } catch (e: any) {
    logger.error({ source: 'SYSTEM', event: 'db_query_error', meta: { fn: 'listIncidents', error: e.message } });
    throw new AppError('Failed to list incidents', 500, 'DB_ERROR');
  }
}

/**
 * Get users for escalation by level and route
 * Returns user IDs for the target escalation level
 */
export async function getEscalationRecipients(
  level: EscalationLevel,
  routeId: string,
): Promise<string[]> {
  try {
    const roleMap: Record<EscalationLevel, Role[]> = {
      COORDINATOR: ['COORDINATOR' as Role],
      TRANSPORT_OFFICER: ['TRANSPORT_OFFICER' as Role],
      PRINCIPAL: ['PRINCIPAL' as Role],
    };

    const users = await prisma.user.findMany({
      where: {
        role: {
          in: roleMap[level],
        },
        ...(level === 'COORDINATOR' && {
          routeCoordinators: { some: { routeId } },
        }),
      },
      select: { id: true },
    });

    return users.map(u => u.id);
  } catch (e: any) {
    logger.error({ source: 'SYSTEM', event: 'db_query_error', meta: { fn: 'getEscalationRecipients', level, routeId, error: e.message } });
    throw new AppError('Failed to fetch escalation recipients', 500, 'DB_ERROR');
  }
}

export const incidentsRepository = {
  getTripWithContext,
  createIncident,
  getRouteCoordinators,
  getIncidentById,
  updateIncidentEscalationLevel,
  resolveIncident,
  listIncidents,
  getEscalationRecipients,
};
