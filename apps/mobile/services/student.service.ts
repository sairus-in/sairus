import type { MobileCheckinPayload } from 'shared';
import {
  AttendanceLogResponseSchema,
  MobileCheckinPayloadSchema,
  SelfReportResponseSchema,
} from 'shared';
import { api } from '../lib/api.client';
import {
  AttendanceHistorySchema,
  CheckInResponseSchema,
  StudentHomeSchema,
  type AttendanceHistoryResponseV3,
  type CheckInResponseV3,
  type StudentHomeResponseV3,
} from '../lib/schemas';

export type CheckinPayload = MobileCheckinPayload;

export interface AttendanceHistoryParams {
  page: number;
  limit?: number;
  filter?: 'ABSENT' | 'CORRECTIONS';
}

export interface AttendanceLogResponse {
  id: string;
  date: string;
  status: 'PRESENT' | 'ABSENT' | 'SELF_ARRANGED' | 'LATE_BOARD' | 'MANUAL' | 'EXCUSED' | 'PENDING';
  checkedInAt: string | null;
  busNumber: string | null;
  tripType: 'MORNING' | 'RETURN';
  distanceToBus?: number | null;
  distanceToStop?: number | null;
}

export interface CorrectionPayload {
  attendanceId: string;
  reason: string;
}

export interface SkipTodayPayload {
  tripId: string;
  reason: string;
  notes?: string;
}

export interface SelfReportPayload {
  tripId: string;
  wasOnBus: boolean;
}

export interface SelfReportResponse {
  success?: boolean;
  attendanceStatus?: 'PRESENT' | 'ABSENT' | 'SELF_ARRANGED' | 'LATE_BOARD' | 'MANUAL' | 'EXCUSED' | 'PENDING';
  status?: string;
  id?: string;
}

export interface VerifyArrivalPayload {
  tripId: string;
  lat: number;
  lon: number;
  method?: 'SOCKET' | 'PUSH_NOTIFICATION';
}

export const studentService = {
  getHome: async (): Promise<StudentHomeResponseV3> => {
    const parsed = await api.getParsed('/v1/student/home', StudentHomeSchema);

    return {
      ...parsed,
      transport: {
        ...parsed.transport,
        attendance: {
          ...parsed.transport.attendance,
          isOptimistic: false,
        },
      },
    };
  },

  submitCheckIn: async (payload: CheckinPayload): Promise<CheckInResponseV3> => {
    const parsedPayload = MobileCheckinPayloadSchema.parse(payload);
    return api.postParsed('/v1/attendance/checkin', parsedPayload, CheckInResponseSchema);
  },

  getHistory: async ({ page, limit = 20, filter }: AttendanceHistoryParams): Promise<AttendanceHistoryResponseV3> => {
    return api.getParsed('/v1/attendance/history', AttendanceHistorySchema, {
      params: { page, limit, filter },
    });
  },

  getAttendanceLog: async (logId: string): Promise<AttendanceLogResponse> => {
    return api.getParsed(`/v1/attendance/logs/${logId}`, AttendanceLogResponseSchema);
  },

  submitCorrection: async (payload: CorrectionPayload) => {
    return api.post('/v1/attendance/corrections', payload);
  },

  skipToday: async (payload: SkipTodayPayload) => {
    return api.post('/v1/attendance/skip-today', payload);
  },

  selfReport: async (payload: SelfReportPayload): Promise<SelfReportResponse> => {
    return api.postParsed('/v1/attendance/self-report', payload, SelfReportResponseSchema);
  },

  verifyArrival: async (payload: VerifyArrivalPayload) => {
    return api.post('/v1/attendance/verify-arrival', {
      ...payload,
      method: payload.method ?? 'PUSH_NOTIFICATION',
    });
  },
};
