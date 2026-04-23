// hooks/useLiveBus.ts - Firebase RTDB subscription with React Query cache ownership
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { features } from '../lib/config';
import { database, off, onValue, ref } from '../lib/firebase';

export interface BusLocation {
  lat: number;
  lon: number;
  speed: number;
  heading: number;
  gpsStatus: 'LIVE' | 'STALE' | 'OFFLINE' | 'UNKNOWN';
  lastUpdated: number;
}

const BusLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  speed: z.number(),
  heading: z.number(),
  gpsStatus: z.enum(['LIVE', 'STALE', 'OFFLINE', 'UNKNOWN']),
  lastUpdated: z.number().int().nonnegative(),
});

const busLocationKey = (busId: string) => ['bus-location', busId] as const;

export function useLiveBus(busId: string | null) {
  const queryClient = useQueryClient();
  const [listenerError, setListenerError] = useState<Error | null>(null);
  const prevBusIdRef = useRef<string | null>(null);
  const listenerRef = useRef<(() => void) | null>(null);

  // REALTIME: Firebase RTDB owns freshness for this cache entry, so the query never polls.
  const busLocationQuery = useQuery<BusLocation | null>({
    queryKey: busId ? busLocationKey(busId) : ['bus-location', 'idle'],
    queryFn: async () => (
      busId ? queryClient.getQueryData<BusLocation | null>(busLocationKey(busId)) ?? null : null
    ),
    enabled: !!busId,
    staleTime: Infinity,
    gcTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
    networkMode: 'offlineFirst',
  });

  useEffect(() => {
    const detachListener = () => {
      listenerRef.current?.();
      listenerRef.current = null;
    };

    if (!busId) {
      detachListener();
      if (prevBusIdRef.current) {
        queryClient.removeQueries({
          queryKey: busLocationKey(prevBusIdRef.current),
          exact: true,
        });
      }
      prevBusIdRef.current = null;
      setListenerError(null);
      return;
    }

    if (busId === prevBusIdRef.current && listenerRef.current) {
      return;
    }

    detachListener();
    if (prevBusIdRef.current && prevBusIdRef.current !== busId) {
      queryClient.removeQueries({
        queryKey: busLocationKey(prevBusIdRef.current),
        exact: true,
      });
    }

    prevBusIdRef.current = busId;
    setListenerError(null);

    if (!features.firebaseRealtime || !database) {
      queryClient.setQueryData<BusLocation | null>(busLocationKey(busId), null);
      return;
    }

    // [FIX 5] Scoped offline caching
    // Note: The Firebase JS SDK handles active listener caching automatically.
    // If we ever migrate to @react-native-firebase/database native SDK, we MUST call here:
    // database().ref(`/buses/${busId}`).keepSynced(true)
    // The critical v2 rule is adhered to: we scope subscriptions strictly to /buses/${busId}
    // and NEVER attach listeners or keepSynced to the /buses root.
    const busRef = ref(database, `/buses/${busId}`);
    const handler = onValue(
      busRef,
      (snapshot: any) => {
        const data = snapshot.val();
        if (!data) {
          queryClient.setQueryData<BusLocation | null>(busLocationKey(busId), null);
          setListenerError(null);
          return;
        }

        const parsed = BusLocationSchema.safeParse(data);
        if (parsed.success) {
          queryClient.setQueryData<BusLocation | null>(busLocationKey(busId), parsed.data);
          setListenerError(null);
          return;
        }

        queryClient.setQueryData<BusLocation | null>(busLocationKey(busId), null);
        setListenerError(new Error('Received invalid live bus payload from Firebase RTDB.'));
      },
      (error) => {
        queryClient.setQueryData<BusLocation | null>(busLocationKey(busId), null);
        setListenerError(error instanceof Error ? error : new Error('Failed to subscribe to Firebase RTDB bus updates.'));
      },
    );

    listenerRef.current = () => off(busRef, 'value', handler);

    return () => {
      detachListener();
    };
  }, [busId, queryClient]);

  const busLocation = busId
    ? (
        busLocationQuery.data
        ?? queryClient.getQueryData<BusLocation | null>(busLocationKey(busId))
        ?? null
      )
    : null;

  const secondsSincePing = busLocation
    ? (Date.now() - busLocation.lastUpdated) / 1000
    : Number.POSITIVE_INFINITY;

  const rawStatus: BusLocation['gpsStatus'] =
    !busLocation ? 'UNKNOWN'
    : secondsSincePing < 15 ? 'LIVE'
    : secondsSincePing < 60 ? 'STALE'
    : 'OFFLINE';

  const isStale = rawStatus === 'STALE' || rawStatus === 'OFFLINE';

  // Phase 3.5: Fallback UX Translation Layer
  // We NEVER show 'OFFLINE' or 'STALE' to a student. We show calm visual states.
  const getStudentFacingState = () => {
    if (rawStatus === 'LIVE' && !isStale) {
      return {
        markerOpacity: 1.0,
        markerPulse: false,
        showBanner: false,
        bannerText: null,
        etaVisible: true,
      };
    }

    // We don't have a full route estimation engine yet, but when we do, 'hasEstimate' goes here.
    const hasEstimate = false;
    if (hasEstimate) {
      return {
        markerOpacity: 0.75,
        markerPulse: true,
        showBanner: true,
        bannerText: 'Estimated position',
        etaVisible: true,
      };
    }

    if (busLocation) {
      const minutesAgo = Math.floor((Date.now() - busLocation.lastUpdated) / 60000);
      return {
        markerOpacity: 0.4,
        markerPulse: false,
        showBanner: true,
        bannerText: `Last seen - ${minutesAgo} min ago`,
        etaVisible: false,
      };
    }

    return {
      markerOpacity: 0,
      markerPulse: false,
      showBanner: true,
      bannerText: 'Bus location temporarily unavailable',
      etaVisible: false,
    };
  };

  return {
    ...busLocationQuery,
    busLocation,
    gpsStatus: rawStatus,
    isStale,
    error: listenerError ?? busLocationQuery.error,
    isError: Boolean(listenerError) || busLocationQuery.isError,
    studentUI: getStudentFacingState(),
  };
}
