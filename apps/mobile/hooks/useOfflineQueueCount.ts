// hooks/useOfflineQueueCount.ts
// HARDENED v3: Listens to queue and network state to display pending count.
import { useState, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { checkinQueue } from '../lib/checkin-queue';

export const useOfflineQueueCount = () => {
  const [count, setCount] = useState(0);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const refresh = async () => {
      const c = await checkinQueue.count();
      setCount(c);
    };

    refresh();

    // Re-check when app comes to foreground
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });

    // Re-check on network reconnect
    const netSub = NetInfo.addEventListener((state) => {
      if (state.isConnected) {
        // Wait a moment for flush to complete, then update count
        if (refreshTimerRef.current) {
          clearTimeout(refreshTimerRef.current);
        }
        refreshTimerRef.current = setTimeout(() => {
          void refresh();
          refreshTimerRef.current = null;
        }, 2000);
      }
    });

    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      sub.remove();
      netSub();
    };
  }, []);

  return count;
};
