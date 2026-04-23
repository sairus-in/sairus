import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AdminCoordinatorOverrideResponse,
  AdminGpsOutageCorrection,
  AdminGpsOutageQueueResponse,
} from 'shared';
import { api } from '../lib/api.client';
import { QK } from '../lib/query-keys';

const outageCorrectionsKey = [...QK.gpsOutages(), 'corrections'] as const;

export const useGpsOutageQueue = () => {
  return useQuery({
    queryKey: QK.gpsOutages(),
    queryFn: () => api.get<AdminGpsOutageQueueResponse>('/v1/admin/ops/gps-outages'),
  });
};

export const useGpsOutageCorrections = () => {
  return useQuery({
    queryKey: outageCorrectionsKey,
    queryFn: () => api.get<AdminGpsOutageCorrection[]>('/v1/admin/ops/gps-outage-corrections'),
  });
};

export const useCoordinatorOverride = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (tripId: string) =>
      api.post<AdminCoordinatorOverrideResponse>(`/v1/admin/ops/gps-outages/${tripId}/coordinator-override`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QK.gpsOutages() });
      queryClient.invalidateQueries({ queryKey: outageCorrectionsKey });
      queryClient.invalidateQueries({ queryKey: QK.corrections() });
      queryClient.invalidateQueries({ queryKey: QK.dashboard() });
      queryClient.invalidateQueries({ queryKey: QK.activeTrips() });
      queryClient.invalidateQueries({ queryKey: QK.commandCenter() });
    },
  });
};
