import { useEffect } from 'react';
import * as Haptics from 'expo-haptics';
import { bindSocketHandler, getSocket } from '../lib/socket';
import { useTripStore } from '../store/trip.store';
import { useAuth } from '../store/auth.store';

export function useKioskSocket(tripId: string, busId?: string) {
  const token = useAuth((state) => state.token);
  const setQR = useTripStore((state) => state.setQR);
  const setBoardedCount = useTripStore((state) => state.setBoardedCount);
  const setLastToast = useTripStore((state) => state.setLastToast);
  const addWaitRequest = useTripStore((state) => state.addWaitRequest);
  const addAdminMessage = useTripStore((state) => state.addAdminMessage);
  const setSocketStatus = useTripStore((state) => state.setSocketStatus);

  // DEV ONLY: inject a rotating fake QR token every 50 s; skip real socket.
  useEffect(() => {
    if (!__DEV__ || !token?.startsWith('dev_token_')) return;

    const refreshQR = () => {
      // Encode a minimal JSON payload that QRCode will render without crashing
      setQR(
        JSON.stringify({ tripId, nonce: `DEV_${Date.now()}`, sig: 'devonly' }),
        Date.now() + 60_000,
      );
    };

    refreshQR();
    setSocketStatus('connected');

    const interval = setInterval(refreshQR, 50_000);
    return () => clearInterval(interval);
  }, [token, tripId, setQR, setSocketStatus]);

  useEffect(() => {
    if (!token || (__DEV__ && token.startsWith('dev_token_'))) {
      return;
    }

    const socket = getSocket();

    if (!socket.connected) {
      socket.connect();
    }

    const joinRooms = () => {
      socket.emit('join-trip', { tripId });
      if (busId) {
        socket.emit('join-bus', { busId });
      }
    };

    const handleQrRefresh = ({ qrToken, expiresAt }: { qrToken: string; expiresAt: number }) => {
      setQR(qrToken, expiresAt);
    };

    const handleCheckinSuccess = ({ name, status, distanceToStop }: {
      userId: string;
      name: string;
      status: 'PRESENT' | 'LATE_BOARD';
      distanceToStop: number;
    }) => {
      setLastToast({ name, status, distanceToStop, time: Date.now() });
      setBoardedCount((prev: number) => prev + 1);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    };

    const handleWaitRequest = ({ studentName, etaMinutes }: { studentName: string; etaMinutes: number }) => {
      addWaitRequest({ studentName, etaMinutes, receivedAt: Date.now() });
    };

    const handleAdminMessage = ({ body, isUrgent }: { body: string; isUrgent: boolean }) => {
      addAdminMessage({ body, isUrgent, receivedAt: Date.now() });
      if (isUrgent) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }
    };

    const handleGpsStatusUpdate = ({ message }: { message: string }) => {
      addAdminMessage({ body: message, isUrgent: false, receivedAt: Date.now() });
    };

    const handleDelegateActivated = () => {
      addAdminMessage({
        body: 'GPS delegate activated. Tracking should resume shortly.',
        isUrgent: false,
        receivedAt: Date.now(),
      });
    };

    const handleConnect = () => {
      setSocketStatus('connected');
      joinRooms();
    };

    const handleReconnectAttempt = () => setSocketStatus('reconnecting');
    const handleDisconnect = () => setSocketStatus('disconnected');

    joinRooms();

    bindSocketHandler(socket, 'qr:refresh', handleQrRefresh);
    bindSocketHandler(socket, 'checkin:success', handleCheckinSuccess);
    bindSocketHandler(socket, 'wait:request', handleWaitRequest);
    bindSocketHandler(socket, 'admin:message', handleAdminMessage);
    bindSocketHandler(socket, 'gps:status_update', handleGpsStatusUpdate);
    bindSocketHandler(socket, 'delegate:activated', handleDelegateActivated);
    bindSocketHandler(socket, 'connect', handleConnect);
    bindSocketHandler(socket, 'reconnect_attempt', handleReconnectAttempt);
    bindSocketHandler(socket, 'disconnect', handleDisconnect);

    return () => {
      socket.emit('leave-trip', { tripId });
      if (busId) {
        socket.emit('leave-bus', { busId });
      }

      socket.off('qr:refresh', handleQrRefresh);
      socket.off('checkin:success', handleCheckinSuccess);
      socket.off('wait:request', handleWaitRequest);
      socket.off('admin:message', handleAdminMessage);
      socket.off('gps:status_update', handleGpsStatusUpdate);
      socket.off('delegate:activated', handleDelegateActivated);
      socket.off('connect', handleConnect);
      socket.off('reconnect_attempt', handleReconnectAttempt);
      socket.off('disconnect', handleDisconnect);
    };
  }, [
    tripId,
    busId,
    token,
    addAdminMessage,
    addWaitRequest,
    setBoardedCount,
    setLastToast,
    setQR,
    setSocketStatus,
  ]);
}
