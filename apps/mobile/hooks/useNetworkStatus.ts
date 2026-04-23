// hooks/useNetworkStatus.ts — NetInfo wrapper + offline queue auto-flush
// HARDENED v3: Use ref for stale-closure-safe isConnected check in event listener.
// Bug fix: previous version re-subscribed on every isConnected change, causing
// the listener to read a stale value and potentially double-fire flush.
import { useEffect, useRef, useState } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { checkinQueue } from '../lib/checkin-queue';
import { queryClient } from '../lib/query-client';
import { analytics } from '../lib/analytics';

export function useNetworkStatus() {
  const [isConnected, setIsConnected] = useState<boolean>(true);
  const [wasOffline, setWasOffline] = useState<boolean>(false);

  // Use a ref so the listener closure always reads current value — no re-subscribe needed
  const isConnectedRef = useRef<boolean>(true);
  const wasOfflineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void (async () => {
      await checkinQueue.init();

      const state = await NetInfo.fetch();
      const connected = !!(state.isConnected && state.isInternetReachable);

      isConnectedRef.current = connected;
      setIsConnected(connected);

      if (connected) {
        void checkinQueue.flush();
      }
    })();

    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      const connected = !!(state.isConnected && state.isInternetReachable);
      const wasConnected = isConnectedRef.current;

      if (connected && !wasConnected) {
        // Just came back online — flush queued check-ins and refresh data
        analytics.track('network_online_restored', {});
        checkinQueue.flush();
        queryClient.refetchQueries({ type: 'active' });

        setWasOffline(true);
        if (wasOfflineTimerRef.current) {
          clearTimeout(wasOfflineTimerRef.current);
        }
        wasOfflineTimerRef.current = setTimeout(() => {
          setWasOffline(false);
          wasOfflineTimerRef.current = null;
        }, 2000);
      } else if (!connected && wasConnected) {
        analytics.track('network_offline_detected', {});
      }

      isConnectedRef.current = connected;
      setIsConnected(connected);
    });

    return () => {
      unsubscribe();
      if (wasOfflineTimerRef.current) {
        clearTimeout(wasOfflineTimerRef.current);
        wasOfflineTimerRef.current = null;
      }
    };
  }, []); // stable: no deps, ref handles stale closure

  return { isConnected, wasOffline };
}
