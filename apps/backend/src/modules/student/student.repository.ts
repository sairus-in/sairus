import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { AppError } from '../../lib/errors';

/**
 * STUDENT REPOSITORY — Data Access Layer
 *
 * Isolates all Prisma queries for Student domain.
 * Used by student-home.service.ts for caching + business logic.
 *
 * All functions return bare data (no transformation).
 * Error mapping: P2025 → 404 (not found), P2003 → 400 (relation error)
 */

/**
 * Get student profile (public fields only)
 */
export async function getStudentProfile(userId: string) {
  try {
    return await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        rollNumber: true,
        email: true,
        department: true,
        year: true,

      },
    });
  } catch (e: any) {
    if (e.code === 'P2025') throw new AppError('Student not found', 404, 'STUDENT_NOT_FOUND');
    logger.error({ source: 'STUDENT', event: 'db_query_error', meta: { fn: 'getStudentProfile', userId, error: e.message } });
    throw new AppError('Failed to fetch student profile', 500, 'DB_ERROR');
  }
}

/**
 * Get today's route assignment with full context
 * Includes route + stops for schedule display
 */
export async function getRouteAssignmentToday(userId: string) {
  try {
    return await prisma.routeAssignment.findUnique({
      where: { userId },
      select: {
        id: true,
        routeId: true,
        stopId: true,
        route: {
          select: {
            id: true,
            name: true,
            stops: {
              select: {
                stopId: true,
                sequence: true,
                scheduledTimeMorning: true,
                scheduledTimeReturn: true,
              },
            },
          },
        },
        stop: {
          select: {
            id: true,
            name: true,
            lat: true,
            lon: true,
          },
        },
      },
    });
  } catch (e: any) {
    if (e.code === 'P2025') return null; // Not assigned
    logger.error({ source: 'STUDENT', event: 'db_query_error', meta: { fn: 'getRouteAssignmentToday', userId, error: e.message } });
    throw new AppError('Failed to fetch route assignment', 500, 'DB_ERROR');
  }
}

/**
 * Get today's trip on student's route (SCHEDULED or ACTIVE)
 */
export async function getTodaysTripStatus(userId: string, routeId: string) {
  try {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    return await prisma.trip.findFirst({
      where: {
        routeId,
        date: today,
        status: { in: ['SCHEDULED', 'ACTIVE'] },
      },
      select: {
        id: true,
        busId: true,
        status: true,
        type: true,
        gpsStatus: true,
        expectedCount: true,
        boardedCount: true,
        delegateId: true,
        gpsOutageStart: true,
        bus: {
          select: {
            id: true,
            number: true,
          },
        },
        route: {
          select: {
            name: true,
          },
        },
        driver: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
        delegate: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { type: 'asc' }, // MORNING first
    });
  } catch (e: any) {
    logger.error({ source: 'STUDENT', event: 'db_query_error', meta: { fn: 'getTodaysTripStatus', userId, routeId, error: e.message } });
    throw new AppError('Failed to fetch trip status', 500, 'DB_ERROR');
  }
}

/**
 * Get today's attendance for a specific trip
 */
export async function getTodaysAttendance(userId: string, tripId: string) {
  try {
    return await prisma.attendanceLog.findUnique({
      where: {
        userId_tripId: { userId, tripId },
      },
      select: {
        id: true,
        status: true,
        method: true,
        checkedInAt: true,
        arrivalVerified: true,
        lat: true,
        lon: true,
      },
    });
  } catch (e: any) {
    if (e.code === 'P2025') return null; // Not checked in
    logger.error({ source: 'STUDENT', event: 'db_query_error', meta: { fn: 'getTodaysAttendance', userId, tripId, error: e.message } });
    throw new AppError('Failed to fetch attendance', 500, 'DB_ERROR');
  }
}

/**
 * Get attendance history (30 days, paginated cursor)
 */
export async function getAttendanceHistory(userId: string, limit: number = 30, cursor?: string) {
  try {
    const logs = await prisma.attendanceLog.findMany({
      where: { userId },
      select: {
        id: true,
        dateKey: true,
        status: true,
        checkedInAt: true,
        method: true,
      },
      orderBy: { dateKey: 'desc' },
      take: limit,
      skip: cursor ? 1 : 0,
      ...(cursor && { cursor: { id: cursor } }),
    });

    const totalCount = await prisma.attendanceLog.count({
      where: { userId },
    });

    return {
      logs,
      totalCount,
      nextCursor: logs.length > 0 ? logs[logs.length - 1].id : null,
    };
  } catch (e: any) {
    logger.error({ source: 'STUDENT', event: 'db_query_error', meta: { fn: 'getAttendanceHistory', userId, error: e.message } });
    throw new AppError('Failed to fetch attendance history', 500, 'DB_ERROR');
  }
}

/**
 * Get student feature flags
 * TODO: Implement real feature flag logic per student
 */
export async function getStudentFeatureFlags(userId: string) {
  try {
    return {
      canRequestCorrection: true,
      canViewLiveMap: true,
      canSkipTrip: true,
    };
  } catch (e: any) {
    logger.error({ source: 'STUDENT', event: 'db_query_error', meta: { fn: 'getStudentFeatureFlags', userId, error: e.message } });
    throw new AppError('Failed to fetch feature flags', 500, 'DB_ERROR');
  }
}

/**
 * Get active bus assignment for a route (for substitute driver info)
 */
export async function getActiveBusAssignment(routeId: string) {
  try {
    return await prisma.busAssignment.findFirst({
      where: {
        routeId,
        isActive: true,
      },
      select: {
        id: true,
        substituteId: true,
        bus: { select: { id: true, number: true } },
        driver: { select: { name: true } },
        substitute: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  } catch (e: any) {
    logger.error({ source: 'STUDENT', event: 'db_query_error', meta: { fn: 'getActiveBusAssignment', routeId, error: e.message } });
    throw new AppError('Failed to fetch bus assignment', 500, 'DB_ERROR');
  }
}

/**
 * Get today's trip skips for a student
 */
export async function getTodaysTripSkips(userId: string, date: string) {
  try {
    return await prisma.tripSkip.findMany({
      where: { userId, date },
      select: { type: true },
    });
  } catch (e: any) {
    logger.error({ source: 'STUDENT', event: 'db_query_error', meta: { fn: 'getTodaysTripSkips', userId, date, error: e.message } });
    throw new AppError('Failed to fetch trip skips', 500, 'DB_ERROR');
  }
}

/**
 * Get attendance history summary (counts by status)
 */
export async function getAttendanceHistorySummary(userId: string) {
  try {
    return await prisma.attendanceLog.groupBy({
      by: ['status'],
      where: {
        userId,
        status: { in: ['PRESENT', 'LATE_BOARD', 'MANUAL', 'ABSENT'] },
      },
      _count: { _all: true },
    });
  } catch (e: any) {
    logger.error({ source: 'STUDENT', event: 'db_query_error', meta: { fn: 'getAttendanceHistorySummary', userId, error: e.message } });
    throw new AppError('Failed to fetch attendance summary', 500, 'DB_ERROR');
  }
}

/**
 * Get pending corrections count
 */
export async function getPendingCorrectionsCount(userId: string) {
  try {
    return await prisma.attendanceCorrection.count({
      where: {
        requestedById: userId,
        status: 'PENDING',
      },
    });
  } catch (e: any) {
    logger.error({ source: 'STUDENT', event: 'db_query_error', meta: { fn: 'getPendingCorrectionsCount', userId, error: e.message } });
    throw new AppError('Failed to fetch pending corrections', 500, 'DB_ERROR');
  }
}

/**
 * Check if student was absent yesterday
 */
export async function getYesterdayAbsent(userId: string, yesterdayDate: string) {
  try {
    return await prisma.attendanceLog.findFirst({
      where: {
        userId,
        dateKey: yesterdayDate,
        status: 'ABSENT',
      },
      select: { id: true },
    });
  } catch (e: any) {
    logger.error({ source: 'STUDENT', event: 'db_query_error', meta: { fn: 'getYesterdayAbsent', userId, yesterdayDate, error: e.message } });
    throw new AppError('Failed to fetch yesterday attendance', 500, 'DB_ERROR');
  }
}

export const studentRepository = {
  getStudentProfile,
  getRouteAssignmentToday,
  getTodaysTripStatus,
  getTodaysAttendance,
  getAttendanceHistory,
  getStudentFeatureFlags,
  getActiveBusAssignment,
  getTodaysTripSkips,
  getAttendanceHistorySummary,
  getPendingCorrectionsCount,
  getYesterdayAbsent,
};
