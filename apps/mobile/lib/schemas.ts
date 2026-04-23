import { z } from 'zod';
import type {
  StudentHomeAttendance,
  StudentHomeResponse,
} from 'shared';
import {
  AttendanceHistoryResponseSchema as SharedAttendanceHistoryResponseSchema,
  CheckinSuccessResponseSchema as SharedCheckinSuccessResponseSchema,
  StudentHomeResponseSchema as SharedStudentHomeResponseSchema,
} from 'shared';

type MobileAttendance = Omit<StudentHomeAttendance, 'today'> & {
  today: string | null;
  isOptimistic?: boolean;
};

export type StudentHomeResponseV3 = Omit<StudentHomeResponse, 'transport'> & {
  transport: Omit<StudentHomeResponse['transport'], 'attendance'> & {
    attendance: MobileAttendance;
  };
};

export const StudentHomeSchema = SharedStudentHomeResponseSchema;
export const CheckInResponseSchema = SharedCheckinSuccessResponseSchema;
export const AttendanceHistorySchema = SharedAttendanceHistoryResponseSchema;

export type CheckInResponseV3 = z.infer<typeof CheckInResponseSchema>;
export type AttendanceHistoryResponseV3 = z.infer<typeof AttendanceHistorySchema>;
export type QRTokenV3 = {
  qrToken: string;
  expiresAt: number;
  tripId: string;
};
export type BusLocation = {
  lat: number;
  lon: number;
  speed: number;
  heading: number;
  lastUpdated: number;
};

export const QRTokenSchema = z.object({
  qrToken: z.string(),
  expiresAt: z.number(),
  tripId: z.string(),
});

export const BusLocationSchema = z.object({
  lat: z.number(),
  lon: z.number(),
  speed: z.number(),
  heading: z.number(),
  lastUpdated: z.number(),
});
