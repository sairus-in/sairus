import { prisma } from '../../lib/prisma';
import { Prisma } from '@prisma/client';
import { BadRequestError } from '../../lib/errors';

/**
 * Layer 3: Repository — all Prisma calls live here.
 * No business logic. Just data access. Maps Prisma errors to AppError where applicable.
 */
export class GpsRepository {
  /**
   * Look up a trip for source-validation in GPS ping ingestion.
   * Returns null if not found — caller decides how to react.
   */
  async findTripById(tripId: string) {
    return prisma.trip.findUnique({ where: { id: tripId } });
  }

  /**
   * Batch-insert buffered GPS pings.
   * Maps P2003 (FK violation) to INVALID_REFERENCE — possible if a bus or trip
   * is deleted between the ping arriving and the buffer flushing.
   */
  async createManyGpsLogs(data: Prisma.GpsLogCreateManyInput[]) {
    try {
      return await prisma.gpsLog.createMany({ data });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new BadRequestError('INVALID_REFERENCE', { meta: err.meta });
      }
      throw err;
    }
  }

  /**
   * Delete GPS logs older than the cutoff. Returns the number of rows deleted.
   * Used by the nightly gps-cleanup Cloud Tasks job.
   */
  async deleteLogsOlderThan(cutoff: Date) {
    const { count } = await prisma.gpsLog.deleteMany({
      where: { timestamp: { lt: cutoff } },
    });
    return count;
  }

  /**
   * Find trip with route stops for ETA calculation.
   */
  async findTripWithRouteStops(tripId: string) {
    return prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        route: {
          include: {
            stops: {
              include: { stop: true },
              orderBy: { sequence: 'asc' },
            },
          },
        },
      },
    });
  }

  /**
   * Find route assignments for a route (for finding assigned stops).
   */
  async findRouteAssignments(routeId: string) {
    return prisma.routeAssignment.findMany({
      where: { routeId, isActive: true },
      select: { stopId: true },
      take: 1,
    });
  }
}

export const gpsRepository = new GpsRepository();
