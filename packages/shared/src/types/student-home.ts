import type { AttendanceStatus } from './attendance.types';

export interface StudentHomeIdentity {
  id: string;
  name: string;
  rollNumber: string | null;
  department: string | null;
  year: number | null;
  routeId: string | null;
  routeName: string | null;
  stopId: string | null;
  stopName: string | null;
  busId: string | null;
  busNumber: string | null;
}

export interface StudentHomeTrip {
  id: string;
  type: 'MORNING' | 'RETURN';
  status: 'SCHEDULED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  routeName: string;
  busId: string;
  busNumber: string;
  driverName: string | null;
  gpsStatus: string | null;
  expectedCount: number;
  boardedCount: number;
  scheduledDeparture: string | null;
  minutesLate: number | null;
  canCheckIn: boolean;
  checkInReason: 'TRIP_SKIPPED' | 'WINDOW_CLOSED' | null;
  isSubstitute: boolean;
  originalBusNumber: string | null;
  substituteInfo: {
    reason: string;
    assignedAt: string | null;
  } | null;
}

export interface StudentHomeAttendance {
  today: AttendanceStatus | null;
  checkedInAt: string | null;
  busNumber: string | null;
  arrivalVerified: boolean | null;
}

export interface StudentHomeHistory {
  presentCount: number;
  absentCount: number;
  percentage: number;
  pendingCorrections: number;
}

export interface StudentHomeAlerts {
  yesterdayAbsent: boolean;
  yesterdayDate: string | null;
  substituteAssigned: boolean;
}

export interface StudentHomeFeatures {
  hasAssignment: boolean;
  canCheckIn: boolean;
  canSkipToday: boolean;
  canUseLiveMap: boolean;
  canRequestCorrection: boolean;
}

export type StudentScreenState =
  | { status: 'no_trip' }
  | { status: 'trip_upcoming'; tripId: string; departureAt: string; busNumber: string }
  | { status: 'trip_active'; tripId: string; busId: string; canCheckIn: boolean; busEta: number | null }
  | { status: 'checked_in'; tripId: string; busId: string; checkedInAt: string }
  | { status: 'trip_completed'; tripId: string; completedAt: string };

export interface StudentHomeMeta {
  studentName: string;
  avatarUrl: string | null;
  resolvedAt: string;
}

export interface StudentHomeResponse {
  screenState: StudentScreenState;
  meta: StudentHomeMeta;
  student: StudentHomeIdentity;
  transport: {
    trip: StudentHomeTrip | null;
    attendance: StudentHomeAttendance;
    history: StudentHomeHistory;
    alerts: StudentHomeAlerts;
  };
  features: StudentHomeFeatures;
}
