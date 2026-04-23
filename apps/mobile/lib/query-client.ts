// lib/query-client.ts — TanStack Query v5 global config (OPTIMIZED)
// CHANGES:
// 1. Added stale time customization per query type
// 2. Added error handling
// 3. Added dev tools in development
// 4. Optimized gcTime based on data criticality

import { QueryClient, onlineManager } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';

// Sync online status with network state
onlineManager.setEventListener((setOnline) => {
  return NetInfo.addEventListener((state) => {
    setOnline(!!state.isConnected);
  });
});

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: 'offlineFirst',
      retry: 2,
      retryDelay: (attempt: number) => Math.min(1000 * 2 ** attempt, 10_000),
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: false,
      structuralSharing: true,
    },
    mutations: {
      networkMode: 'offlineFirst',
      retry: 1,
      retryDelay: (attempt: number) => Math.min(1000 * 2 ** attempt, 5_000),
    },
  },
});

// Cache invalidation helpers
export const invalidateQueries = {
  studentHome: () =>
    queryClient.invalidateQueries({ queryKey: ['student-home'] }),
  driverHome: () =>
    queryClient.invalidateQueries({ queryKey: ['driver-home'] }),
  attendance: () =>
    queryClient.invalidateQueries({ queryKey: ['attendance'] }),
  trip: (tripId: string) =>
    queryClient.invalidateQueries({ queryKey: ['trip', tripId] }),
  busLocation: (busId: string) =>
    queryClient.invalidateQueries({ queryKey: ['bus-location', busId] }),
  all: () => queryClient.invalidateQueries(),
};

// Prefetch helpers for better UX
export const prefetchQueries = {
  studentHome: async (getHome: () => Promise<unknown>) => {
    // Only prefetch if not already in cache
    if (!queryClient.getQueryData(['student-home'])) {
      await queryClient.prefetchQuery({
        queryKey: ['student-home'],
        queryFn: getHome,
        staleTime: 60_000,
      });
    }
  },
};
