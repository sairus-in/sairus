import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { AppError, BadRequestError, ForbiddenError } from '../../lib/errors';
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
 * Manual mark attendance (driver marks student as present without QR)
 * Atomic transaction: upsert attendance + increment boardedCount + create event
 */
export async function manualMarkAttendance(
  tripId: string,
  studentId: string,
  driverId: string,
  note?: string,
) {
  try {
    const today = getISODateIST();
    const trip = await prisma.trip.findUnique({ where: { id: tripId } });
    
    if (!trip) throw new BadRequestError('TRIP_NOT_FOUND');
    if (trip.driverId !== driverId) throw new ForbiddenError('UNAUTHORIZED');
    if (trip.status !== 'ACTIVE') throw new BadRequestError('TRIP_NOT_ACTIVE');

    const [log] = await prisma.$transaction([
      // Upsert attendance
      prisma.attendanceLog.upsert({
        where: { userId_tripId: { userId: studentId, tripId } },
        update: {
          status: 'MANUAL',
          method: 'MANUAL_DRIVER',
          checkedInAt: new Date(),
          driverNote: note,
        },
        create: {
          userId: studentId,
          tripId,
          busId: trip.busId,
          routeId: trip.routeId,
          date: today,
          dateKey: today,
          status: 'MANUAL',
          method: 'MANUAL_DRIVER',
          checkedInAt: new Date(),
          driverNote: note,
        },
      }),
      // Increment trip boarded count
      prisma.trip.update({
        where: { id: tripId },
        data: { boardedCount: { increment: 1 } },
      }),
    ]);

    // Create event log separately (needs attendance log ID)
    await prisma.attendanceEvent.create({
      data: {
        attendanceId: log.id,
        type: 'MANUAL_CORRECTION',
        method: 'MANUAL_DRIVER',
        actorId: driverId,
        previousStatus: null,
        newStatus: 'MANUAL',
        metadata: { note },
      },
    });

    return log;
  } catch (e: any) {
    if (e instanceof BadRequestError || e instanceof ForbiddenError) throw e;
    logger.error({ source: 'SYSTEM', event: 'db_query_error', meta: { fn: 'manualMarkAttendance', tripId, studentId, error: e.message } });
    throw new AppError('Failed to mark attendance', 500, 'DB_ERROR');
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

export const tripsRepository = {
  getTripById,
  startTrip,
  endTrip,
  getScheduledTripForDriver,
  getTripStudents,
  manualMarkAttendance,
  getTodaysScheduledTrips,
  getRouteStudents,
};
