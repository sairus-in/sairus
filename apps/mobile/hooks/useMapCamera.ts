import { useRef, useCallback, useState, useEffect } from 'react';
import type { Region, AnimatedRegion } from 'react-native-maps';

interface MapViewRef {
  animateToRegion: (region: Region, duration: number) => void;
  getLastRuntimeRegion?: () => Region;
}

type CameraRef = MapViewRef | AnimatedRegion | null;

interface UseMapCameraProps {
  busLat: number;
  busLon: number;
  defaultRegion?: Region;
  debounceMs?: number;
  /**
   * Auto-resume follow mode after this many ms of no panning. Default 4000.
   * After the user pans the map, follow is suspended; this timer re-enables
   * it so the bus eventually slides back into view without a manual recenter.
   */
  idleResumeMs?: number;
}

interface UseMapCameraReturn {
  cameraRef: React.MutableRefObject<CameraRef>;
  followMode: boolean;
  onMapPanDrag: () => void;
  onRecenterPress: () => void;
  onRegionChangeComplete: (region: Region, details: { isGesture?: boolean }) => void;
}

/**
 * Map camera hook with gesture-suspend follow mode.
 */
export function useMapCamera({
  busLat,
  busLon,
  defaultRegion = {
    latitude: 12.9716,
    longitude: 77.5946,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  },
  debounceMs = 1000,
  idleResumeMs = 4000,
}: UseMapCameraProps): UseMapCameraReturn {
  const cameraRef = useRef<CameraRef>(null);
  const [followMode, setFollowMode] = useState(true);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleResumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const INNER_VIEWPORT_RATIO = 0.3;

  const isOutsideInnerViewport = useCallback(
    (region: Region): boolean => {
      const latSpan = region.latitudeDelta;
      const lonSpan = region.longitudeDelta;
      const innerLatMin = region.latitude - latSpan * INNER_VIEWPORT_RATIO;
      const innerLatMax = region.latitude + latSpan * INNER_VIEWPORT_RATIO;
      const innerLonMin = region.longitude - lonSpan * INNER_VIEWPORT_RATIO;
      const innerLonMax = region.longitude + lonSpan * INNER_VIEWPORT_RATIO;

      return (
        busLat < innerLatMin ||
        busLat > innerLatMax ||
        busLon < innerLonMin ||
        busLon > innerLonMax
      );
    },
    [busLat, busLon],
  );

  const onMapPanDrag = useCallback(() => {
    setFollowMode(false);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    if (idleResumeTimerRef.current) {
      clearTimeout(idleResumeTimerRef.current);
    }
    idleResumeTimerRef.current = setTimeout(() => {
      setFollowMode(true);
    }, idleResumeMs);
  }, [idleResumeMs]);

  const onRegionChangeComplete = useCallback(
    (region: Region, details: { isGesture?: boolean }) => {
      if (details.isGesture) {
        setFollowMode(false);
        return;
      }

      if (followMode && isOutsideInnerViewport(region)) {
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }
        debounceTimerRef.current = setTimeout(() => {
          setFollowMode(true);
        }, debounceMs);
      }
    },
    [followMode, isOutsideInnerViewport, debounceMs],
  );

  const onRecenterPress = useCallback(() => {
    const map = cameraRef.current;
    if (!map) return;

    if ('animateToRegion' in map && typeof map.animateToRegion === 'function') {
      map.animateToRegion(
        {
          latitude: busLat,
          longitude: busLon,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        },
        500,
      );
    }

    setFollowMode(true);
  }, [busLat, busLon]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (idleResumeTimerRef.current) {
        clearTimeout(idleResumeTimerRef.current);
      }
    };
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ref = cameraRef as any;

  return {
    cameraRef: ref,
    followMode,
    onMapPanDrag,
    onRecenterPress,
    onRegionChangeComplete,
  };
}