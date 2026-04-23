import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AdminCorrection } from 'shared';
import { api } from '../lib/api.client';
import { QK } from '../lib/query-keys';

export type Correction = AdminCorrection;

export const useCorrections = () => {
  return useQuery({
    queryKey: QK.corrections(),
    queryFn: (): Promise<Correction[]> => api.get('/v1/admin/corrections'),
    refetchInterval: 15_000, // Poll every 15s pattern 2 cache
  });
};

export const useResolveCorrection = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'APPROVED' | 'REJECTED' }) => {
      return api.post(`/v1/admin/corrections/${id}/resolve`, { status });
    },
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: QK.corrections() });
      const previous = queryClient.getQueryData<Correction[]>(QK.corrections());
      
      // Optimistically remove from list
      if (previous) {
        queryClient.setQueryData<Correction[]>(
          QK.corrections(),
          previous.filter(c => c.id !== id)
        );
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(QK.corrections(), context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: QK.corrections() });
      // Invalidate dashboard stats since correction count changed
      queryClient.invalidateQueries({ queryKey: QK.dashboard() });
      queryClient.invalidateQueries({ queryKey: QK.commandCenter() });
    },
  });
};
