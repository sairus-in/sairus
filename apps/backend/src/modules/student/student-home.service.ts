import { redis } from '../../lib/redis';
import { getRouteAssignmentCached } from '../../lib/cache';
import { logger } from '../../lib/logger';
import { studentRepository } from './student.repository';
import {
  getMinutesSinceMidnightIST,
  getTodayDateKey,
  getYesterdayDateKey,
  minutesToTimeString,
  StudentHomeResponse,
  StudentHomeTrip,
  StudentHomeAttendance,
  StudentScreenState,
  RouteGeometry,
} from 'shared';
import { AppError } from '../../lib/errors';
import { getDistanceMetres } from 'shared';

const PRESENT_STATUSES = new Set(['PRESENT', 'LATE_BOARD', 'MANUAL']);
const CACHE_TTL = 300; // 5 minutes
const ROUTE_GEOMETRY_CACHE_TTL = 30; // 30 seconds

/**
 * Hydrate route geometry for a student's trip.
 * Uses Redis cache (30s TTL) and derives "passed" stops via 200m proximity check.
 */
async function getRouteGeometry(
  tripId: string,
  routeId: string,
  studentStopId: string,
  busLat?: number,
  busLon?: number,
): Promise<RouteGeometry | null> {
  const cacheKey = `trip:${tripId}:geometry`;

  try {
    // Try cache first
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    // Fetch route stops from DB
    const routeStops = await studentRepository.getRouteStopsOrdered(routeId);
    if (!routeStops || routeStops.length === 0) {
      return null;
    }

    // Determine which stops have been passed
    let lastVisitedSequence = 0;
    if (busLat !== undefined && busLon !== undefined) {
      // Use 200m proximity check to find last visited stop
      for (const rs of routeStops) {
        const dist = getDistanceMetres(busLat, busLon, rs.stop.lat, rs.stop.lon);
        if (dist < 200) {
          lastVisitedSequence = rs.sequence;
        }
      }
    }

    // Build geometry
    const geometry: RouteGeometry = {
      stops: routeStops.map(rs => ({
        id: rs.stopId,
        name: rs.stop.name,
        lat: rs.stop.lat,
        lon: rs.stop.lon,
        sequence: rs.sequence,
        passed: rs.sequence < lastVisitedSequence,
        isMyStop: rs.stopId === studentStopId,
      })),
      polyline: routeStops.map(rs => [rs.stop.lat, rs.stop.lon] as [number, number]),
    };

    // Cache it
    await redis.setex(cacheKey, ROUTE_GEOMETRY_CACHE_TTL, JSON.stringify(geometry));
    return geometry;
  } catch (error) {
    logger.warn({
      event: 'route_geometry_error',
      source: 'STUDENT',
      meta: { tripId, routeId, error: String(error) },
    });
    return null;
  }
}

function deriveStudentScreenState(input: {
  trip: StudentHomeTrip | null;
  attendance: StudentHomeAttendance;
  resolvedAt: string;
}): StudentScreenState {
  const { trip, attendance, resolvedAt } = input;

  if (!trip) {
    return { status: 'no_trip' };
  }

  if (trip.status === 'COMPLETED' || trip.status === 'CANCELLED') {
    return {
      status: 'trip_completed',
      tripId: trip.id,
      completedAt: resolvedAt,
    };
  }

  if (
    attendance.checkedInAt &&
    (attendance.today === 'PRESENT' || attendance.today === 'LATE_BOARD' || attendance.today === 'MANUAL')
  ) {
    return {
      status: 'checked_in',
      tripId: trip.id,
      busId: trip.busId,
      checkedInAt: attendance.checkedInAt,
    };
  }

  if (trip.status === 'ACTIVE') {
    return {
      status: 'trip_active',
      tripId: trip.id,
      busId: trip.busId,
      canCheckIn: trip.canCheckIn,
      busEta: null,
      distanceRemainingM: null,
    };
  }

  return {
    status: 'trip_upcoming',
    tripId: trip.id,
    departureAt: trip.scheduledDeparture ?? 'TBD',
    busNumber: trip.busNumber,
  };
}

function buildEmptyHome(user: {
  id: string;
  name: string;
  rollNumber: string | null;
  department: string | null;
  year: number | null;
}): StudentHomeResponse {
  const resolvedAt = new Date().toISOString();

  return {
    screenState: {
      status: 'no_trip',
    },
    meta: {
      studentName: user.name,
      avatarUrl: null,
      resolvedAt,
    },
    student: {
      id: user.id,
      name: user.name,
      rollNumber: user.rollNumber,
      department: user.department,
      year: user.year,
      routeId: null,
      routeName: null,
      stopId: null,
      stopName: null,
      busId: null,
      busNumber: null,
    },
    transport: {
      trip: null,
      attendance: {
        today: null,
        checkedInAt: null,
        busNumber: null,
        arrivalVerified: null,
      },
      history: {
        presentCount: 0,
        absentCount: 0,
        percentage: 0,
        pendingCorrections: 0,
      },
      alerts: {
        yesterdayAbsent: false,
        yesterdayDate: null,
        substituteAssigned: false,
      },
      routeGeometry: null,
    },
    features: {
      hasAssignment: false,
      canCheckIn: false,
      canSkipToday: false,
      canUseLiveMap: false,
      canRequestCorrection: true,
    },
  };
}

export const studentHomeService = {
  async getHome(userId: string): Promise<StudentHomeResponse> {
    const cacheKey = `student:home:${userId}`;
    
    // Step 1: Try Redis cache (5 min TTL)
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        logger.info({
          source: 'STUDENT',
          event: 'student_home_cache_hit',
          userId,
        });
        return JSON.parse(cached);
      }
    } catch (e) {
      logger.warn({
        source: 'STUDENT',
        event: 'redis_cache_error',
        meta: { userId, error: String(e) },
      });
      // continue to DB
    }

    logger.info({
      source: 'STUDENT',
      event: 'student_home_db_query',
      userId,
    });

    // Step 2: Fetch user + assignment using repository methods
    const [user, assignment] = await Promise.all([
      studentRepository.getStudentProfile(userId),
      getRouteAssignmentCached(userId),
    ]);

    if (!user) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }

    if (!assignment) {
      return buildEmptyHome(user);
    }

    const today = getTodayDateKey();
    const yesterday = getYesterdayDateKey();

    // Step 3: Fetch all data via repository layer (Layer 3)
    const [trip, activeBusAssignment, tripSkips, historyRows, pendingCorrections, yesterdayAbsentLog] =
      await Promise.all([
        studentRepository.getTodaysTripStatus(userId, assignment.routeId),
        studentRepository.getActiveBusAssignment(assignment.routeId),
        studentRepository.getTodaysTripSkips(userId, today),
        studentRepository.getAttendanceHistorySummary(userId),
        studentRepository.getPendingCorrectionsCount(userId),
        studentRepository.getYesterdayAbsent(userId, yesterday),
      ]);

    // Get today's attendance for trip (after trip is fetched via repository)
    const todaysAttendance = trip
      ? await studentRepository.getTodaysAttendance(userId, trip.id)
      : null;

    // Step 4: Compute derived fields
    const historyCounts = historyRows.reduce(
      (acc, row) => {
        const count = row._count._all;
        if (PRESENT_STATUSES.has(row.status)) {
          acc.presentCount += count;
        }
        if (row.status === 'ABSENT') {
          acc.absentCount += count;
        }
        return acc;
      },
      { presentCount: 0, absentCount: 0 },
    );

    const totalTrackedDays = historyCounts.presentCount + historyCounts.absentCount;
    const percentage =
      totalTrackedDays > 0
        ? Math.round((historyCounts.presentCount / totalTrackedDays) * 100)
        : 0;

    const assignedStop = assignment.route?.stops?.find(
      (stop: any) => stop.stopId === assignment.stopId,
    );
    const scheduledMinutes =
      trip && assignedStop
        ? trip.type === 'MORNING'
          ? assignedStop.scheduledTimeMorning
          : assignedStop.scheduledTimeReturn
        : null;
    const scheduledDeparture =
      scheduledMinutes !== null && scheduledMinutes !== undefined
        ? minutesToTimeString(scheduledMinutes)
        : null;

    const tripSkipped = Boolean(
      trip && tripSkips.some((entry: any) => entry.type === trip.type),
    );
    const canCheckIn = trip?.status === 'ACTIVE' && !tripSkipped;
    const minutesLate =
      trip?.status === 'SCHEDULED' && typeof scheduledMinutes === 'number'
        ? Math.max(0, getMinutesSinceMidnightIST() - scheduledMinutes)
        : null;

    const substituteInfo = trip?.delegateId
      ? {
          reason: 'GPS delegate active',
          assignedAt: trip.gpsOutageStart?.toISOString() ?? null,
        }
      : activeBusAssignment?.substituteId
        ? {
            reason: 'Substitute driver assigned',
            assignedAt: null,
          }
        : null;

    const busId = trip?.busId ?? activeBusAssignment?.bus.id ?? null;
    const busNumber = trip?.bus?.number ?? activeBusAssignment?.bus.number ?? null;
    const driverName =
      trip?.delegate?.name ??
      trip?.driver?.name ??
      activeBusAssignment?.substitute?.name ??
      activeBusAssignment?.driver?.name ??
      null;
    const isSubstitute = Boolean(trip?.delegateId || activeBusAssignment?.substituteId);

    const attendance: StudentHomeAttendance = {
      today: todaysAttendance?.status ?? null,
      checkedInAt: todaysAttendance?.checkedInAt?.toISOString() ?? null,
      busNumber,
      arrivalVerified: todaysAttendance?.arrivalVerified ?? null,
    };

    const transportTrip: StudentHomeTrip | null = trip
      ? {
          id: trip.id,
          type: trip.type,
          status: trip.status,
          routeName: trip.route.name,
          busId: trip.busId,
          busNumber: trip.bus.number,
          driverName,
          gpsStatus: trip.gpsStatus ?? null,
          expectedCount: trip.expectedCount,
          boardedCount: trip.boardedCount,
          scheduledDeparture,
          minutesLate,
          canCheckIn,
          checkInReason: tripSkipped ? 'TRIP_SKIPPED' : null,
          isSubstitute,
          originalBusNumber: null,
          substituteInfo,
        }
      : null;

    const resolvedAt = new Date().toISOString();

    // Hydrate route geometry for active/upcoming trips
    let routeGeometry: Awaited<ReturnType<typeof getRouteGeometry>> = null;
    if (trip && assignment.routeId && assignment.stopId && (trip.status === 'ACTIVE' || trip.status === 'SCHEDULED')) {
      // Get current bus position from Redis for proximity check
      let busLat: number | undefined;
      let busLon: number | undefined;
      if (busId) {
        try {
          const liveStateStr = await redis.get(`bus:${busId}:live`);
          if (liveStateStr) {
            const liveState = JSON.parse(liveStateStr);
            busLat = liveState.lat;
            busLon = liveState.lon;
          }
        } catch (e) {
          // Non-critical, continue without bus position
        }
      }
      routeGeometry = await getRouteGeometry(trip.id, assignment.routeId, assignment.stopId, busLat, busLon);
    }

    // Step 5: Build response
    const response: StudentHomeResponse = {
      screenState: deriveStudentScreenState({
        trip: transportTrip,
        attendance,
        resolvedAt,
      }),
      meta: {
        studentName: user.name,
        avatarUrl: null,
        resolvedAt,
      },
      student: {
        id: user.id,
        name: user.name,
        rollNumber: user.rollNumber,
        department: user.department,
        year: user.year,
        routeId: assignment.routeId,
        routeName: assignment.route?.name ?? null,
        stopId: assignment.stopId,
        stopName: assignment.stop?.name ?? null,
        busId,
        busNumber,
      },
      transport: {
        trip: transportTrip,
        attendance,
        history: {
          presentCount: historyCounts.presentCount,
          absentCount: historyCounts.absentCount,
          percentage,
          pendingCorrections,
        },
        alerts: {
          yesterdayAbsent: Boolean(yesterdayAbsentLog),
          yesterdayDate: yesterdayAbsentLog ? yesterday : null,
          substituteAssigned: isSubstitute,
        },
        routeGeometry,
      },
      features: {
        hasAssignment: true,
        canCheckIn,
        canSkipToday: Boolean(trip),
        canUseLiveMap: Boolean(busId),
        canRequestCorrection: true,
      },
    };

    // Step 6: Cache the response
    try {
      await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(response));
    } catch (e) {
      logger.warn({
        source: 'STUDENT',
        event: 'redis_cache_set_error',
        meta: { userId, error: String(e) },
      });
      // non-critical error
    }

    return response;
  },

  // Cache invalidation helper
  async invalidateCache(userId: string): Promise<void> {
    const cacheKey = `student:home:${userId}`;
    try {
      await redis.del(cacheKey);
      logger.info({
        source: 'STUDENT',
        event: 'student_home_cache_invalidated',
        userId,
      });
    } catch (e) {
      logger.warn({
        source: 'STUDENT',
        event: 'redis_cache_delete_error',
        meta: { userId, error: String(e) },
      });
    }
  },
};
