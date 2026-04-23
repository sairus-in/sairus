import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AdminDashboardStats, AdminTripStudent, type AttendanceStatus } from 'shared';
import { getAdminSocket } from '../lib/socket';
import { QK } from '../lib/query-keys';
import { LiveTripState } from './useActiveTrips';
import { TripStudent } from './useTripDetail';

const messageScopeKey = [QK.messages()[0], QK.messages()[1]] as const;
const outageCorrectionsKey = [...QK.gpsOutages(), 'corrections'] as const;
const tripStudentsKey = (tripId: string) => [...QK.tripState(tripId), 'students'] as const;
const tripTimelineKey = (tripId: string) => [...QK.tripState(tripId), 'timeline'] as const;
const incidentScopeKey = [QK.incidents()[0], QK.incidents()[1]] as const;

interface AttendanceStatusEvent {
  tripId: string;
  userId: string;
  status: AttendanceStatus;
  checkedInAt: string;
}

interface TripLifecycleEvent {
  tripId: string;
}

interface DelegateLifecycleEvent {
  tripId: string;
}

export const useAdminSocket = () => {
  const queryClient = useQueryClient();

  useEffect(() => {
    const socket = getAdminSocket();
    const invalidateLiveOps = () => {
      queryClient.invalidateQueries({ queryKey: QK.commandCenter() });
      queryClient.invalidateQueries({ queryKey: QK.dashboard() });
      queryClient.invalidateQueries({ queryKey: QK.activeTrips() });
      queryClient.invalidateQueries({ queryKey: QK.alerts() });
      queryClient.invalidateQueries({ queryKey: QK.gpsOutages() });
    };
    const resyncLiveOps = () => {
      invalidateLiveOps();
      queryClient.invalidateQueries({ queryKey: incidentScopeKey });
      queryClient.invalidateQueries({ queryKey: messageScopeKey });
      queryClient.invalidateQueries({ queryKey: outageCorrectionsKey });
    };

    socket.on('checkin:success', (data: AttendanceStatusEvent) => {
      queryClient.invalidateQueries({ queryKey: QK.commandCenter() });

      queryClient.setQueryData<AdminDashboardStats | undefined>(QK.dashboard(), (old: AdminDashboardStats | undefined) => {
        if (!old) return old;
        return { ...old, checkedIn: old.checkedIn + 1 };
      });

      queryClient.setQueryData<LiveTripState[] | undefined>(QK.activeTrips(), (old: LiveTripState[] | undefined) => {
        if (!old) return old;
        return old.map((trip) =>
          trip.id === data.tripId
            ? { ...trip, boardedCount: trip.boardedCount + 1 }
            : trip,
        );
      });

      queryClient.setQueryData<TripStudent[] | undefined>(tripStudentsKey(data.tripId), (old: TripStudent[] | undefined) => {
        if (!old) return old;
        return old.map((student) =>
          student.user.id === data.userId
            ? { ...student, status: data.status as AdminTripStudent['status'], checkedInAt: data.checkedInAt }
            : student,
        );
      });

      queryClient.setQueryData<LiveTripState | undefined>(QK.tripState(data.tripId), (old: LiveTripState | undefined) => {
        if (!old) return old;
        return { ...old, boardedCount: old.boardedCount + 1 };
      });

      queryClient.invalidateQueries({ queryKey: tripTimelineKey(data.tripId) });
    });

    socket.on('gps:status', (data: { tripId: string; status: 'LIVE' | 'STALE' | 'OFFLINE' }) => {
      queryClient.invalidateQueries({ queryKey: QK.commandCenter() });

      queryClient.setQueryData<LiveTripState[] | undefined>(QK.activeTrips(), (old: LiveTripState[] | undefined) => {
        if (!old) return old;
        return old.map((trip) => (trip.id === data.tripId ? { ...trip, gpsStatus: data.status } : trip));
      });

      queryClient.setQueryData<LiveTripState | undefined>(QK.tripState(data.tripId), (old: LiveTripState | undefined) => {
        if (!old) return old;
        return { ...old, gpsStatus: data.status };
      });

      if (data.status === 'OFFLINE') {
        queryClient.invalidateQueries({ queryKey: QK.dashboard() });
      }

      queryClient.invalidateQueries({ queryKey: QK.gpsOutages() });
    });

    socket.on('trip:started', () => {
      invalidateLiveOps();
    });

    socket.on('trip:ended', (data: TripLifecycleEvent) => {
      invalidateLiveOps();
      queryClient.invalidateQueries({ queryKey: QK.tripState(data.tripId) });
      queryClient.invalidateQueries({ queryKey: tripStudentsKey(data.tripId) });
      queryClient.invalidateQueries({ queryKey: tripTimelineKey(data.tripId) });
    });

    socket.on('outage:escalation', () => {
      queryClient.invalidateQueries({ queryKey: QK.commandCenter() });
      queryClient.invalidateQueries({ queryKey: QK.gpsOutages() });
    });

    socket.on('trip:absent_finalized', () => {
      queryClient.invalidateQueries({ queryKey: QK.commandCenter() });
      queryClient.invalidateQueries({ queryKey: QK.gpsOutages() });
      queryClient.invalidateQueries({ queryKey: outageCorrectionsKey });
      queryClient.invalidateQueries({ queryKey: QK.alerts() });
    });

    socket.on('incident:reported', () => {
      queryClient.invalidateQueries({ queryKey: incidentScopeKey });
      invalidateLiveOps();
    });

    socket.on('incident:updated', () => {
      queryClient.invalidateQueries({ queryKey: incidentScopeKey });
      invalidateLiveOps();
    });

    socket.on('trip:late-start', () => {
      queryClient.invalidateQueries({ queryKey: QK.commandCenter() });
      queryClient.invalidateQueries({ queryKey: QK.alerts() });
    });

    socket.on('delegate:activated', (data: DelegateLifecycleEvent) => {
      queryClient.invalidateQueries({ queryKey: QK.gpsOutages() });
      queryClient.invalidateQueries({ queryKey: QK.commandCenter() });
      queryClient.invalidateQueries({ queryKey: QK.activeTrips() });
      queryClient.invalidateQueries({ queryKey: QK.dashboard() });
      queryClient.invalidateQueries({ queryKey: QK.tripState(data.tripId) });
    });

    socket.on('delegation:ended', (data: DelegateLifecycleEvent) => {
      queryClient.invalidateQueries({ queryKey: QK.gpsOutages() });
      queryClient.invalidateQueries({ queryKey: QK.commandCenter() });
      queryClient.invalidateQueries({ queryKey: QK.activeTrips() });
      queryClient.invalidateQueries({ queryKey: QK.dashboard() });
      queryClient.invalidateQueries({ queryKey: QK.tripState(data.tripId) });
    });

    socket.on('gps:outage_review_updated', (data: TripLifecycleEvent) => {
      queryClient.invalidateQueries({ queryKey: QK.gpsOutages() });
      queryClient.invalidateQueries({ queryKey: outageCorrectionsKey });
      queryClient.invalidateQueries({ queryKey: QK.commandCenter() });
      queryClient.invalidateQueries({ queryKey: QK.dashboard() });
      queryClient.invalidateQueries({ queryKey: QK.activeTrips() });
      queryClient.invalidateQueries({ queryKey: QK.tripState(data.tripId) });
    });

    socket.on('admin:message', () => {
      queryClient.invalidateQueries({ queryKey: messageScopeKey });
      queryClient.invalidateQueries({ queryKey: QK.commandCenter() });
    });

    socket.on('connect', resyncLiveOps);

    return () => {
      socket.off('checkin:success');
      socket.off('gps:status');
      socket.off('trip:started');
      socket.off('trip:ended');
      socket.off('outage:escalation');
      socket.off('trip:absent_finalized');
      socket.off('incident:reported');
      socket.off('incident:updated');
      socket.off('trip:late-start');
      socket.off('delegate:activated');
      socket.off('delegation:ended');
      socket.off('gps:outage_review_updated');
      socket.off('admin:message');
      socket.off('connect', resyncLiveOps);
    };
  }, [queryClient]);
};
