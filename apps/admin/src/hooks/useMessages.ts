import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AdminActionContextType, AdminMessage, AdminMessageInput, AdminMessagePriority, AdminMessageType } from 'shared';
import { api } from '../lib/api.client';
import { QK } from '../lib/query-keys';

export type Message = AdminMessage;

const messageScopeKey = [QK.messages()[0], QK.messages()[1]] as const;

export const useMessages = (
  busId?: string,
  limit: number = 50,
  context?: { contextType?: AdminActionContextType; contextId?: string },
) => {
  return useQuery({
    queryKey: [...QK.messages(busId), limit, context?.contextType, context?.contextId] as const,
    queryFn: async (): Promise<Message[]> => {
      const p = new URLSearchParams();
      if (busId) p.append('busId', busId);
      if (limit) p.append('limit', limit.toString());
      if (context?.contextType) p.append('contextType', context.contextType);
      if (context?.contextId) p.append('contextId', context.contextId);
      return api.get<Message[]>(`/v1/admin/messages?${p.toString()}`);
    },
  });
};

export const useSendMessage = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: AdminMessageInput & { type?: AdminMessageType; priority?: AdminMessagePriority }) => {
      return api.post<Message>('/v1/admin/messages', vars);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messageScopeKey });
    }
  });
};
