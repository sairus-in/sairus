import { useQuery } from '@tanstack/react-query';
import { AdminLiveTripState } from 'shared';
import { api } from '../lib/api.client';
import { QK } from '../lib/query-keys';

export type LiveTripState = AdminLiveTripState;

export const useActiveTrips = () => {
  return useQuery({
    queryKey: QK.activeTrips(),
    queryFn: (): Promise<LiveTripState[]> => api.get<LiveTripState[]>('/v1/admin/live/trips/active'),
  });
};
