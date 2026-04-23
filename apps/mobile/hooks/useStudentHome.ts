// hooks/useStudentHome.ts — Optimized student home data fetching (ENHANCED)
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { ApiError } from '../lib/api.client';
import {
  LEGACY_HOME_CACHE_KEY,
  readStudentHomeCache,
  STUDENT_HOME_CACHE_TTL_MS,
  writeStudentHomeCache,
} from '../lib/persisted-cache';
import { type StudentHomeResponseV3 } from '../lib/schemas';
import { queryClient } from '../lib/query-client';
import { studentService } from '../services/student.service';
import { useAuthStore } from '../store/auth.store';

interface UseStudentHomeOptions {
  enabled?: boolean;
}

type StudentHomeSecondaryData = Pick<StudentHomeResponseV3['transport'], 'alerts' | 'history'>;

async function fetchStudentHome(): Promise<StudentHomeResponseV3> {
  const data = await studentService.getHome();
  // Cache to AsyncStorage for offline support
  writeStudentHomeCache(data.student.id, data).catch(() => {});
  AsyncStorage.removeItem(LEGACY_HOME_CACHE_KEY).catch(() => {});
  return data;
}

export function useStudentHome(options: UseStudentHomeOptions = {}) {
  const { enabled = true } = options;

  // REALTIME (socket-owned): the initial payload comes from HTTP, but Socket.IO owns freshness after hydration.
  const query = useQuery<StudentHomeResponseV3>({
    queryKey: ['student-home'],
    queryFn: fetchStudentHome,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    networkMode: 'offlineFirst',
    enabled,
    placeholderData: (prev: StudentHomeResponseV3 | undefined) => prev,
    // Handle optimistic updates for attendance
    select: useCallback((incomingData: StudentHomeResponseV3) => {
      const cached = queryClient.getQueryData<StudentHomeResponseV3>(['student-home']);
      if (cached?.transport?.attendance?.isOptimistic) {
        return {
          ...incomingData,
          transport: {
            ...incomingData.transport,
            attendance: cached.transport.attendance,
          },
        };
      }
      return incomingData;
    }, []),
    // Better error handling
    retry: (failureCount, error: unknown) => {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        return false;
      }
      return failureCount < 3;
    },
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  });

  // Memoized data extraction with stable references
  const memoizedData = useMemo(() => {
    if (!query.data) return null;
    return {
      screenState: query.data.screenState,
      meta: query.data.meta,
      student: query.data.student,
      transport: query.data.transport,
      features: query.data.features,
    };
  }, [query.data]);

  // Stable refetch function
  const refetch = useCallback(() => {
    return query.refetch();
  }, [query.refetch]);

  return {
    ...query,
    data: memoizedData,
    refetch,
    // Convenience getters
    student: memoizedData?.student ?? null,
    transport: memoizedData?.transport ?? null,
    trip: memoizedData?.transport?.trip ?? null,
    attendance: memoizedData?.transport?.attendance ?? null,
    alerts: memoizedData?.transport?.alerts ?? [],
    history: memoizedData?.transport?.history ?? [],
  };
}

export function useStudentHomeSecondary() {
  // REALTIME (socket-owned): below-the-fold sections defer to a separate consumer on the shared student-home cache.
  return useSuspenseQuery<StudentHomeResponseV3, Error, StudentHomeSecondaryData>({
    queryKey: ['student-home'],
    queryFn: fetchStudentHome,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    networkMode: 'offlineFirst',
    select: (data) => ({
      alerts: data.transport.alerts,
      history: data.transport.history,
    }),
  });
}

// Hook for manual refresh
export function useRefreshStudentHome() {
  return useCallback(() => {
    return queryClient.invalidateQueries({ queryKey: ['student-home'] });
  }, []);
}

// Get cached data for offline-first rendering
export async function getCachedHomeData(): Promise<StudentHomeResponseV3 | null> {
  const userId = useAuthStore.getState().user?.id;
  if (!userId) {
    return null;
  }

  return readStudentHomeCache<StudentHomeResponseV3>(userId, STUDENT_HOME_CACHE_TTL_MS);
}

// Prefetch for navigation
export async function prefetchStudentHome(): Promise<void> {
  await queryClient.prefetchQuery({
    queryKey: ['student-home'],
    queryFn: fetchStudentHome,
    staleTime: 60_000,
  });
}
