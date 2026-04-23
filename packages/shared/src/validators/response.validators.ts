// packages/shared/src/validators/response.validators.ts
// Response schema validation — crash in dev, warn in prod.
// Every API response consumed by mobile gets validated through here.
// If backend sends garbage, we fail LOUD, not silent.
import { z } from 'zod';

// ─── Student Home Response Schema ───────────────────────────

export const StudentHomeIdentitySchema = z.object({
  id: z.string(),
  name: z.string(),
  rollNumber: z.string().nullable(),
  department: z.string().nullable(),
  year: z.number().nullable(),
  routeId: z.string().nullable(),
  routeName: z.string().nullable(),
  stopId: z.string().nullable(),
  stopName: z.string().nullable(),
  busId: z.string().nullable(),
  busNumber: z.string().nullable(),
});

export const StudentHomeTripSchema = z.object({
  id: z.string(),
  type: z.enum(['MORNING', 'RETURN']),
  status: z.enum(['SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED']),
  routeName: z.string(),
  busId: z.string(),
  busNumber: z.string(),
  driverName: z.string().nullable(),
  gpsStatus: z.string().nullable(),
  expectedCount: z.number(),
  boardedCount: z.number(),
  scheduledDeparture: z.string().nullable(),
  minutesLate: z.number().nullable(),
  canCheckIn: z.boolean(),
  checkInReason: z.enum(['TRIP_SKIPPED', 'WINDOW_CLOSED']).nullable(),
  isSubstitute: z.boolean(),
  originalBusNumber: z.string().nullable(),
  substituteInfo: z.object({
    reason: z.string(),
    assignedAt: z.string().nullable(),
  }).nullable(),
});

export const StudentHomeAttendanceSchema = z.object({
  today: z.string().nullable(), // AttendanceStatus enum
  checkedInAt: z.string().nullable(),
  busNumber: z.string().nullable(),
  arrivalVerified: z.boolean().nullable(),
});

export const StudentHomeHistorySchema = z.object({
  presentCount: z.number(),
  absentCount: z.number(),
  percentage: z.number(),
  pendingCorrections: z.number(),
});

export const StudentHomeAlertsSchema = z.object({
  yesterdayAbsent: z.boolean(),
  yesterdayDate: z.string().nullable(),
  substituteAssigned: z.boolean(),
});

export const StudentHomeFeaturesSchema = z.object({
  hasAssignment: z.boolean(),
  canCheckIn: z.boolean(),
  canSkipToday: z.boolean(),
  canUseLiveMap: z.boolean(),
  canRequestCorrection: z.boolean(),
});

export const StudentScreenStateSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('no_trip') }),
  z.object({
    status: z.literal('trip_upcoming'),
    tripId: z.string(),
    departureAt: z.string(),
    busNumber: z.string(),
  }),
  z.object({
    status: z.literal('trip_active'),
    tripId: z.string(),
    busId: z.string(),
    canCheckIn: z.boolean(),
    busEta: z.number().nullable(),
  }),
  z.object({
    status: z.literal('checked_in'),
    tripId: z.string(),
    busId: z.string(),
    checkedInAt: z.string(),
  }),
  z.object({
    status: z.literal('trip_completed'),
    tripId: z.string(),
    completedAt: z.string(),
  }),
]);

export const StudentHomeMetaSchema = z.object({
  studentName: z.string(),
  avatarUrl: z.string().nullable(),
  resolvedAt: z.string(),
});

export const StudentHomeResponseSchema = z.object({
  screenState: StudentScreenStateSchema,
  meta: StudentHomeMetaSchema,
  student: StudentHomeIdentitySchema,
  transport: z.object({
    trip: StudentHomeTripSchema.nullable(),
    attendance: StudentHomeAttendanceSchema,
    history: StudentHomeHistorySchema,
    alerts: StudentHomeAlertsSchema,
  }),
  features: StudentHomeFeaturesSchema,
});

// ─── Checkin Response Schema ────────────────────────────────

export const CheckinSuccessResponseSchema = z.object({
  attendanceStatus: z.enum(['PRESENT', 'LATE_BOARD']),
  checkedInAt: z.string(),
  distanceToBus: z.number().optional(),
  distanceToStop: z.number().optional(),
});

export const CheckinErrorResponseSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  meta: z.record(z.union([z.string(), z.number()])).optional(),
});

// ─── Attendance History Response Schema ─────────────────────

export const AttendanceHistoryResponseSchema = z.object({
  data: z.array(z.object({
    id: z.string(),
    date: z.string(),
    status: z.enum(['PRESENT', 'ABSENT', 'SELF_ARRANGED', 'LATE_BOARD', 'MANUAL', 'EXCUSED', 'PENDING']),
    checkedInAt: z.string().nullable(),
    busNumber: z.string().nullable(),
    tripType: z.enum(['MORNING', 'RETURN']).optional(),
  })),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    hasMore: z.boolean(),
  }),
});

// ─── Driver Today Response Schema ───────────────────────────

export const DriverTodayResponseSchema = z.object({
  trip: z.object({
    id: z.string(),
    busId: z.string(),
    routeId: z.string(),
    type: z.enum(['MORNING', 'RETURN']),
    status: z.enum(['SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED']),
    scheduledDeparture: z.string().nullable(),
    minutesLate: z.number(),
  }).nullable(),
  bus: z.object({
    number: z.string(),
  }).nullable(),
  route: z.object({
    name: z.string(),
  }).nullable(),
  expectedStudents: z.number(),
});

export const AttendanceLogResponseSchema = z.object({
  id: z.string(),
  date: z.string(),
  status: z.enum(['PRESENT', 'ABSENT', 'SELF_ARRANGED', 'LATE_BOARD', 'MANUAL', 'EXCUSED', 'PENDING']),
  checkedInAt: z.string().nullable(),
  busNumber: z.string().nullable(),
  tripType: z.enum(['MORNING', 'RETURN']),
  distanceToBus: z.number().nullable().optional(),
  distanceToStop: z.number().nullable().optional(),
});

export const SelfReportResponseSchema = z.object({
  success: z.boolean().optional(),
  id: z.string().optional(),
  attendanceStatus: z.enum(['PRESENT', 'ABSENT', 'SELF_ARRANGED', 'LATE_BOARD', 'MANUAL', 'EXCUSED', 'PENDING']).optional(),
  status: z.string().optional(),
});

// ─── Safe Parse Utility ─────────────────────────────────────

/**
 * Validates an API response against a Zod schema.
 * - In development: THROWS on validation failure (crash early, find bugs fast)
 * - In production: WARNS and returns data as-is (graceful degradation)
 *
 * Usage:
 *   const data = validateResponse(StudentHomeResponseSchema, rawData, 'StudentHome');
 */
export function validateResponse<T>(
  schema: z.ZodType<T>,
  data: unknown,
  endpointName: string,
): T {
  const result = schema.safeParse(data);

  if (result.success) {
    return result.data;
  }

  const errorMsg = `[API Contract] ${endpointName} response validation failed:\n${
    result.error.issues.map(i => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
  }`;

  if (process.env.NODE_ENV !== 'production') {
    // In development: crash hard so the issue is immediately visible.
    // This is intentional. You WANT to see this error.
    throw new Error(errorMsg);
  }

  // In production: log the error but don't crash.
  // The UI may render incorrectly, but at least it won't white-screen.
  console.error(errorMsg); // eslint-disable-line no-console
  return data as T;
}
