import { useQuery } from '@tanstack/react-query';
import { AdminLiveAlert } from 'shared';
import { api } from '../lib/api.client';
import { QK } from '../lib/query-keys';
export type LiveAlert = AdminLiveAlert;

export const useAlerts = () => {
  return useQuery({
    queryKey: QK.alerts(),
    queryFn: async (): Promise<LiveAlert[]> => {
      // Return top urgent items from backend stream
      return api.get('/v1/admin/live/alerts');
    },
  });
};
