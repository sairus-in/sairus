// apps/mobile/lib/warmCache.ts
// HARDENED v3: Cold start warm cache. Prefetch immediately after login
// before student navigates to home screen. Prevents blank screen at 8AM.

import { QueryClient } from '@tanstack/react-query';
import { studentService } from '../services/student.service';
import { analytics } from './analytics';

export const warmCache = (queryClientData: QueryClient) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const queryClient = queryClientData as any;
  // Fire and forget — don't await
  // Data arrives in background while student navigates to home screen
  
  queryClient.prefetchQuery({
    queryKey: ['student-home'],
    queryFn: studentService.getHome,
    staleTime: 5 * 60 * 1000,
  });

  queryClient.prefetchQuery({
    queryKey: ['attendance-history', 'ALL'],
    // Use default values 1 and 20 for history prefetch matching the expected page defaults
    queryFn: () => studentService.getHistory({ page: 1, limit: 20 }),
    staleTime: 10 * 60 * 1000,
  });

  analytics.track('warm_cache_started');
};
