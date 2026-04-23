import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AdminAttendanceReportOverview, AdminReportEnqueueResponse, AdminReportStatus } from 'shared';
import { api } from '../lib/api.client';
import { QK } from '../lib/query-keys';

export function useReports(filters: { startDate: string; endDate: string; routeId?: string }) {
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const overview = useQuery<AdminAttendanceReportOverview>({
    queryKey: QK.reportOverview(filters),
    queryFn: () => api.get('/v1/admin/reports/attendance/overview', {
      params: {
        startDate: filters.startDate,
        endDate: filters.endDate,
        routeId: filters.routeId || undefined,
      }
    }),
  });

  // Poll for job status every 1 second while there's an activeJobId
  const { data: jobStatus, isFetching: isStatusFetching } = useQuery<AdminReportStatus | null>({
    queryKey: QK.reportStatus(activeJobId ?? ''),
    queryFn: async () => {
      if (!activeJobId) return null;
      return api.get<AdminReportStatus>(`/v1/admin/reports/${activeJobId}/status`);
    },
    enabled: !!activeJobId,
    refetchInterval: (query) => {
      const state = query.state.data;
      if (state && (state.status === 'COMPLETED' || state.status === 'FAILED')) {
        return false; // Stop polling
      }
      return 1500; // Poll every 1.5s
    },
  });

  // Mutate to spawn the job
  const generateReport = useMutation({
    mutationFn: async (vars: { startDate: string, endDate: string, routeId?: string }) => {
      return api.post<AdminReportEnqueueResponse>('/v1/admin/reports/attendance', vars);
    },
    onSuccess: (data) => {
      if (data.jobId) {
        setActiveJobId(data.jobId);
      }
    }
  });

  return {
    generateReport,
    activeJobId,
    jobStatus,
    isStatusFetching,
    overview,
  };
}
