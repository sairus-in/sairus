/**
 * Driver Repository Layer
 * All Prisma queries for driver operations.
 * Maps Prisma errors to AppError.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { NotFoundError, ForbiddenError, AppError } from '../../lib/errors';

/**
 * Get driver's active trip for today (SCHEDULED or ACTIVE).
 * Used to populate /today-assignment and similar endpoints.
 */
export async function getDriverActiveTrip(driverId: string) {
  try {
    const trip = await prisma.trip.findFirst({
      where: {
        driverId,
        date: new Date().toISOString().split('T')[0], // YYYY-MM-DD
        status: { in: ['SCHEDULED', 'ACTIVE'] },
      },
      include: {
        bus: {
          select: { id: true, number: true },
        },
        route: {
          select: { id: true, name: true, area: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return trip || null;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError(500, 'DATABASE_ERROR', `Failed to fetch driver trip: ${e.message}`);
    }
    throw e;
  }
}

/**
 * Get route with active stops (ordered by sequence).
 * Includes related data for serialization.
 */
export async function getRoute(routeId: string) {
  try {
    // @ts-ignore - Prisma type compatibility
    const route = await prisma.route.findUnique({
      where: { id: routeId },
      include: {
        stops: {
          where: { isActive: true },
          orderBy: { sequence: 'asc' },
          include: { stop: true },
        },
        // For route-stops endpoint: get student counts per stop
        students: {
          where: { isActive: true },
          select: { stopId: true },
        },
      },
    });

    if (!route) {
      throw new NotFoundError('ROUTE_NOT_FOUND');
    }

    return route;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      throw new NotFoundError('ROUTE_NOT_FOUND');
    }
    if (e instanceof AppError) throw e;
    throw new AppError(500, 'DATABASE_ERROR', `Failed to fetch route: ${(e as Error).message}`);
  }
}

/**
 * Count expected students for a route (for today's assignment serialization).
 */
export async function getExpectedStudentCount(routeId: string): Promise<number> {
  try {
    const count = await prisma.routeAssignment.count({
      where: {
        routeId,
        isActive: true,
      },
    });
    return count;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError(500, 'DATABASE_ERROR', `Failed to count students: ${e.message}`);
    }
    throw e;
  }
}

/**
 * Get full trip summary with attendance logs.
 * Used by /trip-summary endpoint.
 * Authorization: caller must be the trip's driver.
 */
export async function getTripSummary(tripId: string, requestingDriverId: string) {
  try {
    // @ts-ignore - Prisma type compatibility
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        attendanceLogs: {
          include: {
            user: {
              select: { id: true, name: true, rollNumber: true },
            },
          },
        },
      },
    });

    if (!trip) {
      throw new NotFoundError('TRIP_NOT_FOUND');
    }

    // Authorization: enforce driver ownership
    if (trip.driverId !== requestingDriverId) {
      throw new ForbiddenError('NOT_YOUR_TRIP');
    }

    return trip;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      throw new NotFoundError('TRIP_NOT_FOUND');
    }
    if (e instanceof AppError) throw e;
    throw new AppError(500, 'DATABASE_ERROR', `Failed to fetch trip summary: ${(e as Error).message}`);
  }
}

/**
 * Get driver stats for a date range (optional, for future use).
 * Used by analytics endpoints.
 */
export async function getDriverStats(driverId: string, from: Date, to: Date) {
  try {
    const dateFrom = from.toISOString().split('T')[0];
    const dateTo = to.toISOString().split('T')[0];

    const trips = await prisma.trip.findMany({
      where: {
        driverId,
        date: {
          gte: dateFrom,
          lte: dateTo,
        },
      },
      select: {
        id: true,
        date: true,
        status: true,
        type: true,
        expectedCount: true,
        boardedCount: true,
        startedAt: true,
        endedAt: true,
      },
    });

    return {
      driverId,
      dateRange: { from: dateFrom, to: dateTo },
      totalTrips: trips.length,
      completedTrips: trips.filter((t) => t.status === 'COMPLETED').length,
      trips,
    };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError(500, 'DATABASE_ERROR', `Failed to fetch driver stats: ${e.message}`);
    }
    throw e;
  }
}

/**
 * Update driver's last known location.
 * Called asynchronously from GPS module.
 * Non-critical — errors are logged but don't fail the request.
 */
export async function updateDriverLocation(
  driverId: string,
  lat: number,
  lng: number,
  timestamp: Date,
) {
  try {
    // Future: store in driver_locations table for historical tracking
    // For now, this is a placeholder for the interface
    return { driverId, lat, lng, timestamp };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError(500, 'DATABASE_ERROR', `Failed to update driver location: ${e.message}`);
    }
    throw e;
  }
}
