import { useQuery } from '@tanstack/react-query';
import { AdminIncident } from 'shared';
import { api } from '../lib/api.client';
import { QK } from '../lib/query-keys';

export type Incident = AdminIncident;

export const useIncidents = (status?: string) => {
  return useQuery({
    queryKey: QK.incidents(status),
    queryFn: async (): Promise<Incident[]> => {
      const qs = status ? `?status=${status}` : '';
      return api.get<Incident[]>(`/v1/admin/incidents${qs}`);
    },
  });
};
