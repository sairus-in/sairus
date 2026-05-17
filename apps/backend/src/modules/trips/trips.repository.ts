import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { AppError } from '../../lib/errors';
import { getISODateIST } from 'shared';

/**
 * TRIPS REPOSITORY — Data Access Layer
 *
 * Isolates all Prisma queries for the Trips domain.
 * Handles atomic transactions for trip state changes.
 * All functions return bare data (no transformation).
 * Error handling: P2025 → 404 (not found), P2003 → 400 (relation error)
 */

/**
 * Get trip by ID with full context (bus, driver, route)
 */
export async function getTripById(tripId: string) {
  try {
    return await prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        bus: { select: { id: true, number: true } },
        route: { select: { id: true, name: true } },
        driver: { select: { id: true, name: true, phone: true } },
        delegate: { select: { id: true, name: true } },
      },
    });
  } catch (e: any) {
    if (e.code === 'P2025') throw new AppError('Trip not found', 404, 'TRIP_NOT_FOUND');
    logger.error({ source: 'SYSTEM', event: 'db_query_error', meta: { fn: 'getTripById', tripId, error: e.message } });
    throw new AppError('Failed to fetch trip', 500, 'DB_ERROR');
  }
}

/**
 * Start a trip: SCHEDULED → ACTIVE
 * Atomic operation with transaction if needed
 */
export async function startTrip(tripId: string) {
  try {
    return await prisma.trip.update({
      where: { id: tripId },
      data: { status: 'ACTIVE', startedAt: new Date() },
      include: {
        bus: { select: { id: true, number: true } },
        route: { select: { id: true, name: true } },
        driver: { select: { id: true, name: true } },
      },
    });
  } catch (e: any) {
    if (e.code === 'P2025') throw new AppError('Trip not found', 404, 'TRIP_NOT_FOUND');
    logger.error({ source: 'SYSTEM', event: 'db_query_error', meta: { fn: 'startTrip', tripId, error: e.message } });
    throw new AppError('Failed to start trip', 500, 'DB_ERROR');
  }
}

/**
 * End a trip: ACTIVE → COMPLETED
 * Atomic operation
 */
export async function endTrip(tripId: string) {
  try {
    return await prisma.trip.update({
      where: { id: tripId },
      data: { status: 'COMPLETED', endedAt: new Date() },
    });
  } catch (e: any) {
    if (e.code === 'P2025') throw new AppError('Trip not found', 404, 'TRIP_NOT_FOUND');
    logger.error({ source: 'SYSTEM', event: 'db_query_error', meta: { fn: 'endTrip', tripId, error: e.message } });
    throw new AppError('Failed to end trip', 500, 'DB_ERROR');
  }
}

/**
 * Get scheduled trip for driver (today, SCHEDULED or ACTIVE)
 */
export async function getScheduledTripForDriver(driverId: string) {
  try {
    const today = getISODateIST();
    return await prisma.trip.findFirst({
      where: {
        driverId,
        date: today,
        status: { in: ['SCHEDULED', 'ACTIVE'] },
      },
      include: {
        bus: { select: { id: true, number: true } },
        route: { select: { id: true, name: true } },
      },
      orderBy: { type: 'asc' }, // MORNING first
    });
  } catch (e: any) {
    logger.error({ source: 'SYSTEM', event: 'db_query_error', meta: { fn: 'getScheduledTripForDriver', driverId, error: e.message } });
    throw new AppError('Failed to fetch trip', 500, 'DB_ERROR');
  }
}

/**
 * Get all students on a trip with attendance status
 */
export async function getTripStudents(tripId: string) {
  try {
    return await prisma.attendanceLog.findMany({
      where: { tripId },
      include: {
        user: {
          select: { id: true, name: true, rollNumber: true, department: true },
        },
      },
      orderBy: { checkedInAt: 'asc' },
    });
  } catch (e: any) {
    logger.error({ source: 'SYSTEM', event: 'db_query_error', meta: { fn: 'getTripStudents', tripId, error: e.message } });
    throw new AppError('Failed to fetch trip students', 500, 'DB_ERROR');
  }
}

/**
 * Get all trips scheduled for today (used to find late-starting trips)
 */
export async function getTodaysScheduledTrips() {
  try {
    const today = getISODateIST();
    return await prisma.trip.findMany({
      where: { date: today, status: 'SCHEDULED' },
      include: {
        bus: { select: { id: true, number: true } },
        route: {
          select: {
            id: true,
            name: true,
            stops: {
              orderBy: { sequence: 'asc' },
              take: 1,
              include: {
                stop: {
                  select: { id: true, name: true },
                },
              },
            },
          },
        },
        driver: { select: { id: true, name: true } },
      },
    });
  } catch (e: any) {
    logger.error({ source: 'SYSTEM', event: 'db_query_error', meta: { fn: 'getTodaysScheduledTrips', error: e.message } });
    throw new AppError('Failed to fetch scheduled trips', 500, 'DB_ERROR');
  }
}

/**
 * Get route assignment students (for cache invalidation)
 */
export async function getRouteStudents(routeId: string) {
  try {
    return await prisma.routeAssignment.findMany({
      where: { routeId },
      select: { userId: true },
    });
  } catch (e: any) {
    logger.error({ source: 'SYSTEM', event: 'db_query_error', meta: { fn: 'getRouteStudents', routeId, error: e.message } });
    throw new AppError('Failed to fetch route students', 500, 'DB_ERROR');
  }
}

/**
 * Get pending (unchecked) student userIds for a trip.
 * Read-only FK join — acceptable here since trips owns the trip→logs relationship.
 */
export async function getPendingStudentLogs(tripId: string) {
  try {
    return await prisma.attendanceLog.findMany({
      where: { tripId, status: 'PENDING' },
      select: { userId: true },
    });
  } catch (e: any) {
    logger.error({ source: 'SYSTEM', event: 'db_query_error', meta: { fn: 'getPendingStudentLogs', tripId, error: e.message } });
    throw new AppError('Failed to fetch pending student logs', 500, 'DB_ERROR');
  }
}

export async function getTripByIdForAdmin(tripId: string) {
  return await prisma.trip.findUnique({
    where: { id: tripId },
    select: { id: true, routeId: true, busId: true },
  });
}

export async function getScheduledTripsForLateCheck(routeIds: string[] | null, today: string) {
  return await prisma.trip.findMany({
    where: {
      date: today,
      status: 'SCHEDULED',
      ...(routeIds ? { routeId: { in: routeIds } } : {}),
    },
    include: {
      bus: { select: { number: true } },
      route: {
        select: {
          name: true,
          stops: { orderBy: { sequence: 'asc' }, take: 1, include: { stop: true } },
        },
      },
      driver: { select: { name: true } },
    },
  });
}

export async function countActiveOfflineTrips(routeIds: string[]) {
  return await prisma.trip.count({
    where: { status: 'ACTIVE', gpsStatus: 'OFFLINE', routeId: { in: routeIds } },
  });
}

export async function getTripsByIdsAndRoutes(tripIds: string[], routeIds: string[]) {
  return await prisma.trip.findMany({
    where: { id: { in: tripIds }, routeId: { in: routeIds } },
    select: { id: true },
  });
}

export async function getCompletedOutageTrips(routeIds: string[] | null) {
  return await prisma.trip.findMany({
    where: {
      status: 'COMPLETED',
      gpsOutageStart: { not: null },
      ...(routeIds ? { routeId: { in: routeIds } } : {}),
    },
    include: { bus: { select: { number: true } }, route: { select: { id: true, name: true } } },
    orderBy: { endedAt: 'desc' },
    take: 25,
  });
}

export async function getTripWithBusAndRoute(tripId: string) {
  return await prisma.trip.findUnique({
    where: { id: tripId },
    include: { bus: { select: { number: true } }, route: { select: { id: true, name: true } } },
  });
}

export async function getActiveBusIds() {
  const activeTrips = await prisma.trip.findMany({
    where: { status: 'ACTIVE' },
    select: { busId: true },
  });
  return activeTrips.map(t => t.busId);
}

export async function getActiveTripByBus(busId: string) {
  return await prisma.trip.findFirst({
    where: { busId, status: 'ACTIVE' },
    select: { id: true },
  });
}

export const tripsRepository = {
  getTripById,
  startTrip,
  endTrip,
  getScheduledTripForDriver,
  getTripStudents,
  getTodaysScheduledTrips,
  getRouteStudents,
  getPendingStudentLogs,
  getTripByIdForAdmin,
  getScheduledTripsForLateCheck,
  countActiveOfflineTrips,
  getTripsByIdsAndRoutes,
  getCompletedOutageTrips,
  getTripWithBusAndRoute,
  getActiveBusIds,
  getActiveTripByBus,
};
