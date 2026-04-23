/**
 * Driver Service Layer
 * Orchestrates business logic by calling repository and other services.
 * No Prisma imports. No HTTP-specific logic.
 */

import { AppError } from '../../lib/errors';
import * as driverRepository from './driver.repository';
import { logger } from '../../lib/logger';

/**
 * Get today's assignment for a driver.
 * Returns trip + route details, or empty assignment if none scheduled.
 */
export async function getTodayAssignment(driverId: string) {
  try {
    const trip = await driverRepository.getDriverActiveTrip(driverId);

    if (!trip) {
      return {
        trip: null,
        bus: null,
        route: null,
        expectedStudents: 0,
        scheduledDeparture: null,
      };
    }

    // Fetch full route with stops
    const route = await driverRepository.getRoute(trip.routeId);
    const expectedStudents = await driverRepository.getExpectedStudentCount(trip.routeId);

    // Extract scheduled departure from first stop
    const firstStop = route.stops[0];
    let scheduledDeparture: string | null = null;
    if (firstStop) {
      const minutes = trip.type === 'MORNING' 
        ? firstStop.scheduledTimeMorning 
        : firstStop.scheduledTimeReturn;
      scheduledDeparture = minutes ? formatMinutesToTime(minutes) : null;
    }

    return {
      trip,
      bus: trip.bus,
      route: { id: route.id, name: route.name },
      expectedStudents,
      scheduledDeparture,
    };
  } catch (e) {
    logger.error({ source: 'SYSTEM', event: 'driver_today_assignment_error', meta: { driverId, error: String(e) } });
    throw e;
  }
}

/**
 * Get route stops for a driver's assigned route.
 * Includes student count per stop for UI rendering.
 */
export async function getRouteStops(driverId: string) {
  try {
    const trip = await driverRepository.getDriverActiveTrip(driverId);

    if (!trip) {
      return { stops: [] };
    }

    const route = await driverRepository.getRoute(trip.routeId);

    // Build student counts per stop
    const studentCounts = route.students.reduce<Record<string, number>>((acc, assignment) => {
      acc[assignment.stopId] = (acc[assignment.stopId] || 0) + 1;
      return acc;
    }, {});

    const stops = route.stops.map((routeStop) => ({
      id: routeStop.stop.id,
      name: routeStop.stop.name,
      order: routeStop.sequence,
      studentCount: studentCounts[routeStop.stopId] || 0,
    }));

    return { stops };
  } catch (e) {
    logger.error({ source: 'SYSTEM', event: 'driver_route_stops_error', meta: { driverId, error: String(e) } });
    throw e;
  }
}

/**
 * Get trip summary for a driver.
 * Returns trip details + list of absent students.
 * Authorization enforced: driver can only access their own trip.
 */
export async function getTripSummary(tripId: string, driverId: string) {
  try {
    const trip = await driverRepository.getTripSummary(tripId, driverId);

    // Determine absent students (not present or late boarded)
    const absentStudents = trip.attendanceLogs
      .filter((log) => !['PRESENT', 'LATE_BOARD', 'MANUAL'].includes(log.status))
      .map((log) => ({
        id: log.user.id,
        name: log.user.name,
        rollNumber: log.user.rollNumber || '',
        reason: log.failReason || 'No check-in',
      }));

    // Format duration
    const duration = formatDuration(trip.startedAt, trip.endedAt);

    return {
      boardedCount: trip.boardedCount,
      expectedCount: trip.expectedCount,
      startedAt: trip.startedAt ? formatTimeIST(trip.startedAt) : null,
      arrivedAt: trip.endedAt ? formatTimeIST(trip.endedAt) : null,
      duration,
      absentStudents,
      date: getISODateIST(),
    };
  } catch (e) {
    logger.error({ source: 'SYSTEM', event: 'driver_trip_summary_error', meta: { tripId, driverId, error: String(e) } });
    throw e;
  }
}

/**
 * Get driver statistics for a date range.
 * Used by analytics/reporting endpoints.
 */
export async function getStatistics(driverId: string, from: Date, to: Date) {
  try {
    const stats = await driverRepository.getDriverStats(driverId, from, to);
    return stats;
  } catch (e) {
    logger.error({ source: 'SYSTEM', event: 'driver_statistics_error', meta: { driverId, error: String(e) } });
    throw e;
  }
}

/**
 * Update driver's location (non-blocking async operation).
 * Called from GPS module after bus ping received.
 */
export async function updateLocation(driverId: string, lat: number, lng: number) {
  try {
    // @ts-ignore - Method signature compatibility
    const result = await driverRepository.updateDriverLocation(driverId, lat, lng, new Date());
    return result;
  } catch (e) {
    // Log but don't throw — location updates are async and non-critical
    logger.warn({ source: 'SYSTEM', event: 'driver_location_update_failed', meta: { driverId, error: String(e) } });
    return null;
  }
}

// ============================================================================
// Formatting Helpers
// ============================================================================

/**
 * Format minutes (0-1440) to HH:MM format.
 * Example: 480 → "08:00"
 */
function formatMinutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/**
 * Format duration between two dates.
 * Example: "2h 30m" or "45m"
 */
function formatDuration(startedAt: Date | null, endedAt: Date | null): string | null {
  if (!startedAt || !endedAt) return null;
  const totalMinutes = Math.max(
    0,
    Math.round((endedAt.getTime() - startedAt.getTime()) / 60000),
  );
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

/**
 * Format date in IST.
 * Example: new Date() → "2025-10-15"
 */
function getISODateIST(): string {
  const date = new Date();
  const istDate = new Date(date.getTime() + 5.5 * 60 * 60 * 1000); // IST = UTC+5:30
  return istDate.toISOString().split('T')[0];
}

/**
 * Format Date object to IST human-readable time.
 * Example: "10:30 AM"
 */
function formatTimeIST(date: Date): string {
  const istDate = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
  const hours = istDate.getUTCHours();
  const minutes = istDate.getUTCMinutes();
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  return `${String(displayHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${period}`;
}

export const driverService = {
  getTodayAssignment,
  getRouteStops,
  getTripSummary,
  getStatistics,
  updateLocation,
};
