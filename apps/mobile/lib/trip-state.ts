import type { StudentHomeResponseV3 } from './schemas';

export type TripScreenState =
  | { type: 'NO_TRIP' }
  | { type: 'NOT_STARTED'; minutesLate: number | null; checkInState: 'inactive' }
  | { type: 'LATE_START'; minutesLate: number; checkInState: 'inactive' }
  | { type: 'ACTIVE'; gpsStatus: 'LIVE' | 'STALE' | 'OFFLINE' | 'UNKNOWN'; checkInState: 'active'; showSkipLink: boolean }
  | { type: 'CHECKED_IN'; status: 'PRESENT' | 'LATE_BOARD'; isOptimistic: boolean; checkInState: 'checked-in' }
  | { type: 'WINDOW_CLOSED'; checkInState: 'closed' }
  | { type: 'SKIPPED'; checkInState: 'skip' }
  | { type: 'UNKNOWN' };

export function deriveTripState(
  home: StudentHomeResponseV3 | undefined,
  busLocation: { lat: number; lon: number; speed: number; lastUpdated: number } | null
): TripScreenState {
  if (!home) return { type: 'UNKNOWN' };
  if (!home.transport.trip) return { type: 'NO_TRIP' };

  const { trip, attendance } = home.transport;

  if (attendance.today === 'PRESENT' || attendance.today === 'LATE_BOARD' || attendance.isOptimistic) {
    return {
      type: 'CHECKED_IN',
      status: attendance.today === 'LATE_BOARD' ? 'LATE_BOARD' : 'PRESENT',
      isOptimistic: attendance.isOptimistic ?? false,
      checkInState: 'checked-in',
    };
  }

  if (trip.checkInReason === 'TRIP_SKIPPED') {
    return { type: 'SKIPPED', checkInState: 'skip' };
  }
  if (trip.status === 'COMPLETED') return { type: 'WINDOW_CLOSED', checkInState: 'closed' };

  if (trip.status === 'ACTIVE') {
    const age = busLocation ? Date.now() - busLocation.lastUpdated : Infinity;
    const gpsStatus =
      !busLocation      ? 'UNKNOWN'
      : age > 90_000    ? 'OFFLINE'
      : age > 30_000    ? 'STALE'
      : 'LIVE';

    return { type: 'ACTIVE', gpsStatus, checkInState: 'active', showSkipLink: home.features.canSkipToday };
  }

  if (trip.status === 'SCHEDULED') {
    const minutesLate = trip.minutesLate ?? 0;
    return {
      type: minutesLate > 10 ? 'LATE_START' : 'NOT_STARTED',
      minutesLate,
      checkInState: 'inactive',
    };
  }

  return { type: 'UNKNOWN' };
}
