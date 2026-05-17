import { describe, expect, it } from 'vitest';
import type { StudentHomeResponse } from 'shared';

const fixture: StudentHomeResponse = {
  screenState: {
    status: 'checked_in',
    tripId: 'trip_1',
    busId: 'bus_1',
    checkedInAt: '2026-03-24T02:15:00.000Z',
  },
  meta: {
    studentName: 'Student Name',
    avatarUrl: null,
    resolvedAt: '2026-03-24T02:16:00.000Z',
  },
  student: {
    id: 'student_1',
    name: 'Student Name',
    rollNumber: '23CS001',
    department: 'CSE',
    year: 3,
    routeId: 'route_1',
    routeName: 'North Route',
    stopId: 'stop_1',
    stopName: 'Main Gate',
    busId: 'bus_1',
    busNumber: 'TN-01-AB-1234',
  },
  transport: {
    trip: {
      id: 'trip_1',
      type: 'MORNING',
      status: 'ACTIVE',
      routeName: 'North Route',
      busId: 'bus_1',
      busNumber: 'TN-01-AB-1234',
      driverName: 'Driver Name',
      gpsStatus: 'LIVE',
      expectedCount: 42,
      boardedCount: 12,
      scheduledDeparture: '07:35',
      minutesLate: 4,
      canCheckIn: true,
      checkInReason: null,
      isSubstitute: false,
      originalBusNumber: null,
      substituteInfo: null,
    },
    attendance: {
      today: 'PRESENT',
      checkedInAt: '2026-03-24T02:15:00.000Z',
      busNumber: 'TN-01-AB-1234',
      arrivalVerified: true,
    },
    history: {
      presentCount: 120,
      absentCount: 3,
      percentage: 98,
      pendingCorrections: 1,
    },
    alerts: {
      yesterdayAbsent: false,
      yesterdayDate: null,
      substituteAssigned: false,
    },
    routeGeometry: null,
  },
  features: {
    hasAssignment: true,
    canCheckIn: true,
    canSkipToday: true,
    canUseLiveMap: true,
    canRequestCorrection: true,
  },
};

describe('student home contract', () => {
  it('exposes the required top-level sections', () => {
    expect(fixture).toHaveProperty('screenState');
    expect(fixture).toHaveProperty('meta');
    expect(fixture).toHaveProperty('student');
    expect(fixture).toHaveProperty('transport.trip');
    expect(fixture).toHaveProperty('transport.attendance');
    expect(fixture).toHaveProperty('transport.history');
    expect(fixture).toHaveProperty('transport.alerts');
    expect(fixture).toHaveProperty('features');
  });
});
