export const ATTENDANCE_STATUS = {
  PRESENT: 'PRESENT',
  ABSENT: 'ABSENT',
  SELF_ARRANGED: 'SELF_ARRANGED',
  LATE_BOARD: 'LATE_BOARD',
  MANUAL: 'MANUAL',
  EXCUSED: 'EXCUSED',
  PENDING: 'PENDING',
} as const;

export type AttendanceStatus = typeof ATTENDANCE_STATUS[keyof typeof ATTENDANCE_STATUS];

export const ATTENDANCE_EVENT_TYPE = {
  CHECK_IN: 'CHECK_IN',
  MANUAL_CORRECTION: 'MANUAL_CORRECTION',
  MARK_EXCUSED: 'MARK_EXCUSED',
  SKIP_TODAY: 'SKIP_TODAY',
  WAIT_FOR_ME: 'WAIT_FOR_ME',
  TRIP_END_ABSENT: 'TRIP_END_ABSENT',
  ARRIVAL_VERIFIED: 'ARRIVAL_VERIFIED',
  ARRIVAL_FLAGGED: 'ARRIVAL_FLAGGED',
} as const;

export type AttendanceEventType = typeof ATTENDANCE_EVENT_TYPE[keyof typeof ATTENDANCE_EVENT_TYPE];

export const CHECKIN_METHOD = {
  QR_SCAN: 'QR_SCAN',
  MANUAL_DRIVER: 'MANUAL_DRIVER',
  MANUAL_ADMIN: 'MANUAL_ADMIN',
  SYSTEM_AUTO: 'SYSTEM_AUTO',
} as const;

export type CheckInMethod = typeof CHECKIN_METHOD[keyof typeof CHECKIN_METHOD];

export interface AttendanceRecord {
  id: string; // Composite: `tripId_studentId` or UUID
  studentId: string;
  tripId: string;
  busId: string;
  routeId: string;
  date: string; // YYYY-MM-DD
  status: AttendanceStatus;
  
  // Latest scan context
  lat?: number;
  lng?: number;
  distanceToBus?: number;
  distanceToStop?: number;
  boardedNearStopId?: string;
  
  // Review context
  failReason?: string | null;
  correctionRequestedAt?: string | null;
  correctionReason?: string | null;
  
  createdAt: string;
  updatedAt: string;
  events?: AttendanceEvent[]; // History
}

export interface AttendanceEvent {
  id: string;
  attendanceId: string; // Foreign key to AttendanceRecord
  type: AttendanceEventType;
  method: CheckInMethod;
  actorId: string; // Who triggered it (student, driver, admin, or "SYSTEM")
  previousStatus?: AttendanceStatus;
  newStatus: AttendanceStatus;
  timestamp: string;
  metadata?: Record<string, any>; // JSON payload for flexibility
}
