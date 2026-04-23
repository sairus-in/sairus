import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { analytics } from '../lib/analytics';
import { ApiError, NetworkError } from '../lib/api.client';
import { checkinQueue } from '../lib/checkin-queue';
import { queryClient } from '../lib/query-client';
import type { CheckInResponseV3, StudentHomeResponseV3 } from '../lib/schemas';
import { studentService, type CheckinPayload } from '../services/student.service';

type CheckInUIState =
  | 'idle'
  | 'processing'
  | 'confirmed'
  | 'failed'
  | 'offline-queued';

interface CheckinFailure {
  success: false;
  reason: string;
  meta: Record<string, unknown>;
}

interface CheckinQueuedResult {
  success: true;
  offline: true;
  status?: 'PRESENT' | 'LATE_BOARD';
  checkedInAt?: string;
  distanceToBus?: number;
  distanceToStop?: number;
  reason?: string;
  meta?: Record<string, string | number>;
}

interface CheckinConfirmedResult {
  success: true;
  offline?: false;
  status: CheckInResponseV3['attendanceStatus'];
  checkedInAt: string;
  distanceToBus?: number;
  distanceToStop?: number;
  reason?: string;
  meta?: Record<string, string | number>;
}

type CheckinMutationResult = CheckinQueuedResult | CheckinConfirmedResult;
type CheckinContext = { prev?: StudentHomeResponseV3 };

export interface CheckinResult {
  success: boolean;
  offline?: boolean;
  status?: 'PRESENT' | 'LATE_BOARD';
  checkedInAt?: string;
  reason?: string;
  meta?: Record<string, string | number>;
}

export const useCheckin = () => {
  const [uiState, setUiState] = useState<CheckInUIState>('idle');

  const mutation = useMutation<CheckinMutationResult, CheckinFailure, CheckinPayload, CheckinContext>({
    mutationFn: async (payload: CheckinPayload) => {
      try {
        const data = await studentService.submitCheckIn(payload);
        return {
          success: true,
          status: data.attendanceStatus,
          checkedInAt: data.checkedInAt,
          distanceToBus: data.distanceToBus,
          distanceToStop: data.distanceToStop,
        };
      } catch (error: unknown) {
        if (error instanceof NetworkError) {
          await checkinQueue.add({
            ...payload,
            accuracy: payload.accuracy ?? null,
          });
          return { success: true, offline: true };
        }

        if (error instanceof ApiError) {
          throw {
            success: false,
            reason: error.code || 'UNKNOWN',
            meta: (error.details as Record<string, unknown> | undefined) ?? {},
          };
        }

        throw {
          success: false,
          reason: 'UNKNOWN',
          meta: {},
        };
      }
    },

    onMutate: async (payload: CheckinPayload) => {
      setUiState('processing');
      analytics.track('checkin_attempt', { gpsState: payload.gpsState });
      if (payload.isLowTrust) {
        analytics.track('checkin_low_trust', {
          gpsState: payload.gpsState,
          accuracy: payload.accuracy ?? null,
        });
      }

      await queryClient.cancelQueries({ queryKey: ['student-home'] });
      const prev = queryClient.getQueryData<StudentHomeResponseV3>(['student-home']);

      if (prev) {
        queryClient.setQueryData<StudentHomeResponseV3>(['student-home'], (old) => {
          if (!old) {
            return old;
          }

          return {
            ...old,
            transport: {
              ...old.transport,
              attendance: {
                ...old.transport.attendance,
                today: 'PRESENT',
                checkedInAt: new Date().toISOString(),
                isOptimistic: true,
              },
            },
          };
        });
      }

      return { prev };
    },

    onSuccess: (data, payload) => {
      if (data.offline) {
        setUiState('offline-queued');
        return;
      }

      queryClient.setQueryData<StudentHomeResponseV3>(['student-home'], (old) => {
        if (!old) {
          return old;
        }

        return {
          ...old,
          transport: {
            ...old.transport,
            attendance: {
              ...old.transport.attendance,
              today: data.status,
              checkedInAt: data.checkedInAt,
              isOptimistic: false,
            },
          },
        };
      });

      setUiState('confirmed');
      analytics.track('checkin_success', {
        status: data.status,
        gpsState: payload.gpsState,
      });

      queryClient.invalidateQueries({
        queryKey: ['student-home'],
        refetchType: 'none',
      });
      queryClient.invalidateQueries({
        queryKey: ['attendance-history'],
        refetchType: 'none',
      });
    },

    onError: (error, payload, context) => {
      if (context?.prev) {
        queryClient.setQueryData<StudentHomeResponseV3>(['student-home'], context.prev);
      }
      setUiState('failed');
      analytics.track('checkin_failure', {
        error: error.reason || 'UNKNOWN_ERROR',
        gpsState: payload.gpsState,
      });
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['student-home'] });
      queryClient.invalidateQueries({ queryKey: ['attendance-history'] });
    },
  });

  return { ...mutation, uiState };
};
