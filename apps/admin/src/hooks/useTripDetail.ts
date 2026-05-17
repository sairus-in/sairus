import { useQuery } from '@tanstack/react-query';
import { AdminTripStudent, AdminTripTimelineEvent } from 'shared';
import { api } from '../lib/api.client';
import { QK } from '../lib/query-keys';
import { LiveTripState } from './useActiveTrips';
export type TripStudent = AdminTripStudent;
export type TripTimelineEvent = AdminTripTimelineEvent;

const tripStudentsKey = (tripId: string) => [...QK.tripState(tripId), 'students'] as const;
const tripTimelineKey = (tripId: string) => [...QK.tripState(tripId), 'timeline'] as const;

export const useTripLive = (tripId: string) => {
  return useQuery({
    queryKey: QK.tripState(tripId),
    queryFn: (): Promise<LiveTripState> => api.get<LiveTripState>(`/v1/admin/live/trips/${tripId}`),
    retry: false
  });
};

export const useTripStudents = (tripId: string) => {
  return useQuery({
    queryKey: tripStudentsKey(tripId),
    queryFn: async (): Promise<TripStudent[]> => {
      return api.get<TripStudent[]>(`/v1/admin/trips/${tripId}/students`);
    },
    staleTime: 60_000,
  });
};

export const useTripTimeline = (tripId: string) => {
  return useQuery({
    queryKey: tripTimelineKey(tripId),
    queryFn: async (): Promise<TripTimelineEvent[]> => {
      return api.get<TripTimelineEvent[]>(`/v1/admin/trips/${tripId}/timeline`);
    },
    staleTime: 30_000,
  });
};
