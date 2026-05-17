import { useEffect } from 'react';
import type { AttendanceStatus } from 'shared';
import type { StudentHomeResponseV3 } from '../lib/schemas';
import { queryClient } from '../lib/query-client';
import { bindSocketHandler, getSocket } from '../lib/socket';
import { useAuth } from '../store/auth.store';

type StudentSocketOptions = {
  tripId?: string | null;
  busId?: string | null;
  routeId?: string | null;
};

type CheckinSuccessEvent = {
  tripId: string;
  userId: string;
  status: AttendanceStatus;
  checkedInAt: string;
};

type TripStartedEvent = {
  tripId: string;
  busId: string;
  routeId: string;
  startedAt: string;
};

type TripEndedEvent = {
  tripId: string;
  endedAt: string;
};

type GpsStatusEvent = {
  status: 'LIVE' | 'STALE' | 'OFFLINE';
};

type GpsUpdateEvent = {
  gpsStatus?: 'LIVE' | 'STALE' | 'OFFLINE';
  delegateActive?: boolean;
};

type DelegateActivatedEvent = {
  busId: string;
  delegateType: 'GPS' | 'KIOSK' | 'BOTH';
};

type AdminMessageEvent = {
  busId?: string | null;
  routeId?: string | null;
  tripId?: string | null;
};

const studentHomeKey = ['student-home'] as const;
const attendanceHistoryKey = ['attendance-history'] as const;

export const useStudentSocket = ({ tripId, busId, routeId }: StudentSocketOptions) => {
  const userId = useAuth((state) => state.user?.id);
  const token = useAuth((state) => state.token);

  useEffect(() => {
    // DEV ONLY: skip real socket connection when a dev_token_* is active.
    // The student home data comes from the mock API adapter instead.
    if (!token || (__DEV__ && token.startsWith('dev_token_'))) {
      return;
    }

    const socket = getSocket();

    if (!socket.connected) {
      socket.connect();
    }

    const updateHome = (
      updater: (current: StudentHomeResponseV3) => StudentHomeResponseV3,
    ) => {
      queryClient.setQueryData<StudentHomeResponseV3>(studentHomeKey, (current) => (
        current ? updater(current) : current
      ));
    };

    const invalidateAttendanceHistory = () => {
      queryClient.invalidateQueries({ queryKey: attendanceHistoryKey });
    };

    const joinRooms = () => {
      if (tripId) {
        socket.emit('join-trip', { tripId });
      }
      if (busId) {
        socket.emit('join-bus', { busId });
      }
      if (routeId) {
        socket.emit('join-route', { routeId });
      }
    };

    const leaveRooms = () => {
      if (tripId) {
        socket.emit('leave-trip', { tripId });
      }
      if (busId) {
        socket.emit('leave-bus', { busId });
      }
      if (routeId) {
        socket.emit('leave-route', { routeId });
      }
    };

    const handleTripStarted = (event: TripStartedEvent) => {
      if (routeId && event.routeId !== routeId) {
        return;
      }

      updateHome((current) => {
        const checkedInAt = current.transport.attendance.checkedInAt;

        return {
          ...current,
          screenState: checkedInAt
            ? {
                status: 'checked_in',
                tripId: event.tripId,
                busId: event.busId,
                checkedInAt,
              }
            : {
                status: 'trip_active',
                tripId: event.tripId,
                busId: event.busId,
                canCheckIn: current.features.canCheckIn,
                busEta: current.screenState.status === 'trip_active' ? current.screenState.busEta : null,
                distanceRemainingM:
                  current.screenState.status === 'trip_active' ? current.screenState.distanceRemainingM : null,
              },
          meta: {
            ...current.meta,
            resolvedAt: new Date().toISOString(),
          },
          transport: {
            ...current.transport,
            trip: current.transport.trip
              ? {
                  ...current.transport.trip,
                  id: event.tripId,
                  busId: event.busId,
                  status: 'ACTIVE',
                }
              : current.transport.trip,
          },
        };
      });
    };

    const handleTripEnded = (event: TripEndedEvent) => {
      if (tripId && event.tripId !== tripId) {
        return;
      }

      updateHome((current) => ({
        ...current,
        screenState: current.transport.trip && current.transport.trip.id === event.tripId
          ? {
              status: 'trip_completed',
              tripId: event.tripId,
              completedAt: event.endedAt,
            }
          : current.screenState,
        meta: {
          ...current.meta,
          resolvedAt: new Date().toISOString(),
        },
        features: {
          ...current.features,
          canCheckIn: false,
        },
        transport: {
          ...current.transport,
          trip: current.transport.trip && current.transport.trip.id === event.tripId
            ? {
                ...current.transport.trip,
                status: 'COMPLETED',
                canCheckIn: false,
              }
            : current.transport.trip,
        },
      }));
    };

    const handleCheckinSuccess = (event: CheckinSuccessEvent) => {
      if (!userId || event.userId !== userId) {
        return;
      }

      updateHome((current) => ({
        ...current,
        screenState: {
          status: 'checked_in',
          tripId: event.tripId,
          busId: current.transport.trip?.busId ?? busId ?? '',
          checkedInAt: event.checkedInAt,
        },
        meta: {
          ...current.meta,
          resolvedAt: new Date().toISOString(),
        },
        transport: {
          ...current.transport,
          attendance: {
            ...current.transport.attendance,
            today: event.status,
            checkedInAt: event.checkedInAt,
            isOptimistic: false,
          },
        },
      }));

      invalidateAttendanceHistory();
    };

    const handleGpsStatus = (event: GpsStatusEvent) => {
      updateHome((current) => ({
        ...current,
        meta: {
          ...current.meta,
          resolvedAt: new Date().toISOString(),
        },
        transport: {
          ...current.transport,
          trip: current.transport.trip
            ? {
                ...current.transport.trip,
                gpsStatus: event.status,
              }
            : current.transport.trip,
        },
      }));
    };

    const handleGpsUpdate = (event: GpsUpdateEvent) => {
      if (!event.gpsStatus && !event.delegateActive) {
        return;
      }

      updateHome((current) => ({
        ...current,
        meta: {
          ...current.meta,
          resolvedAt: new Date().toISOString(),
        },
        transport: {
          ...current.transport,
          alerts: {
            ...current.transport.alerts,
            substituteAssigned: event.delegateActive ? true : current.transport.alerts.substituteAssigned,
          },
          trip: current.transport.trip
            ? {
                ...current.transport.trip,
                gpsStatus: event.gpsStatus ?? current.transport.trip.gpsStatus,
                isSubstitute: event.delegateActive ? true : current.transport.trip.isSubstitute,
                substituteInfo: event.delegateActive
                  ? (
                      current.transport.trip.substituteInfo ?? {
                        reason: 'GPS delegate active',
                        assignedAt: new Date().toISOString(),
                      }
                    )
                  : current.transport.trip.substituteInfo,
              }
            : current.transport.trip,
        },
      }));
    };

    const handleDelegateActivated = (event: DelegateActivatedEvent) => {
      if (busId && event.busId !== busId) {
        return;
      }

      updateHome((current) => ({
        ...current,
        meta: {
          ...current.meta,
          resolvedAt: new Date().toISOString(),
        },
        transport: {
          ...current.transport,
          alerts: {
            ...current.transport.alerts,
            substituteAssigned: true,
          },
          trip: current.transport.trip
            ? {
                ...current.transport.trip,
                isSubstitute: true,
                substituteInfo: {
                  reason: `GPS delegate active (${event.delegateType.toLowerCase()})`,
                  assignedAt: new Date().toISOString(),
                },
              }
            : current.transport.trip,
        },
      }));
    };

    const handleAdminMessage = (event: AdminMessageEvent) => {
      if (event.tripId && tripId && event.tripId !== tripId) {
        return;
      }
      if (event.busId && busId && event.busId !== busId) {
        return;
      }
      if (event.routeId && routeId && event.routeId !== routeId) {
        return;
      }
    };

    joinRooms();

    bindSocketHandler(socket, 'connect', joinRooms);
    bindSocketHandler(socket, 'trip:started', handleTripStarted);
    bindSocketHandler(socket, 'trip:ended', handleTripEnded);
    bindSocketHandler(socket, 'checkin:success', handleCheckinSuccess);
    bindSocketHandler(socket, 'gps:status', handleGpsStatus);
    bindSocketHandler(socket, 'gps:update', handleGpsUpdate);
    bindSocketHandler(socket, 'delegate:activated', handleDelegateActivated);
    bindSocketHandler(socket, 'admin:message', handleAdminMessage);
    bindSocketHandler(socket, 'trip:absent_finalized', invalidateAttendanceHistory);

    return () => {
      socket.off('connect', joinRooms);
      socket.off('trip:started', handleTripStarted);
      socket.off('trip:ended', handleTripEnded);
      socket.off('checkin:success', handleCheckinSuccess);
      socket.off('gps:status', handleGpsStatus);
      socket.off('gps:update', handleGpsUpdate);
      socket.off('delegate:activated', handleDelegateActivated);
      socket.off('admin:message', handleAdminMessage);
      socket.off('trip:absent_finalized', invalidateAttendanceHistory);

      leaveRooms();
    };
  }, [tripId, busId, routeId, userId, token]);
};
