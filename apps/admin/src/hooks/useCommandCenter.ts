import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AdminCommandCenterPayload,
  AdminMessageInput,
  AdminSubstituteCandidate,
} from 'shared';
import { api } from '../lib/api.client';
import { QK } from '../lib/query-keys';

const incidentScopeKey = [QK.incidents()[0], QK.incidents()[1]] as const;
const messageScopeKey = [QK.messages()[0], QK.messages()[1]] as const;

export const useCommandCenter = (enabled = true) => {
  return useQuery({
    queryKey: QK.commandCenter(),
    queryFn: (): Promise<AdminCommandCenterPayload> => api.get('/v1/admin/live/command-center'),
    enabled,
  });
};

const invalidateOps = async (queryClient: ReturnType<typeof useQueryClient>) => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: QK.commandCenter() }),
    queryClient.invalidateQueries({ queryKey: QK.dashboard() }),
    queryClient.invalidateQueries({ queryKey: QK.activeTrips() }),
    queryClient.invalidateQueries({ queryKey: incidentScopeKey }),
    queryClient.invalidateQueries({ queryKey: QK.gpsOutages() }),
    queryClient.invalidateQueries({ queryKey: messageScopeKey }),
  ]);
};

export const useNotifyAffectedUsers = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ tripId, note }: { tripId: string; note?: string }) =>
      api.post(`/v1/admin/trips/${tripId}/notify-affected`, { note }),
    onSuccess: async () => {
      await invalidateOps(queryClient);
    },
  });
};

export const useRequestDelegate = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ tripId, note }: { tripId: string; note?: string }) =>
      api.post(`/v1/admin/trips/${tripId}/request-delegate`, { note }),
    onSuccess: async () => {
      await invalidateOps(queryClient);
    },
  });
};

export const useEscalateIncident = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ incidentId, note }: { incidentId: string; note?: string }) =>
      api.post(`/v1/admin/incidents/${incidentId}/escalate`, { note }),
    onSuccess: async () => {
      await invalidateOps(queryClient);
    },
  });
};

export const useAssignSubstitute = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ incidentId, alternateBusId }: { incidentId: string; alternateBusId: string }) =>
      api.post(`/v1/admin/incidents/${incidentId}/assign-substitute`, { alternateBusId }),
    onSuccess: async () => {
      await invalidateOps(queryClient);
    },
  });
};

export const useSubstituteCandidates = (tripId?: string) => {
  return useQuery({
    queryKey: [...QK.commandCenter(), 'substitute-candidates', tripId] as const,
    queryFn: (): Promise<AdminSubstituteCandidate[]> => api.get(`/v1/admin/trips/${tripId}/substitute-candidates`),
    enabled: Boolean(tripId),
  });
};

export const useSendContextMessage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: AdminMessageInput) => api.post('/v1/admin/messages', payload),
    onSuccess: async () => {
      await invalidateOps(queryClient);
    },
  });
};
