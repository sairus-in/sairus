import { useEffect } from 'react';
import { useSharedValue, SharedValue, withTiming, cancelAnimation, Easing } from 'react-native-reanimated';
import { useReducedMotion } from 'react-native-reanimated';
import { useLiveBus, BusLocation } from './useLiveBus';

const ANIMATION_DURATION_MS = 4500; // 4.5 seconds between pings
const PING_INTERVAL_MS = 4500;

/**
 * Animated bus position hook with dead-reckoning.
 * Projects bus forward based on current speed/heading and animates to it.
 * When real ping arrives, retargets to new truth.
 */
export function useAnimatedBusPosition(busId: string | null) {
  const reducedMotion = useReducedMotion();
  const { busLocation, gpsStatus, isStale, studentUI, ...rest } = useLiveBus(busId);

  // Shared values for animated position
  const animatedLat = useSharedValue(0);
  const animatedLon = useSharedValue(0);
  const animatedHeading = useSharedValue(0);

  // Track the last "target" we animated toward (for cancellation)
  const lastTargetLat = useSharedValue(0);
  const lastTargetLon = useSharedValue(0);

  // Project forward position based on speed and heading
  const projectForward = (
    lat: number,
    lon: number,
    speedKmh: number,
    headingDeg: number,
    intervalMs: number,
  ): { lat: number; lon: number } => {
    // Convert speed from km/h to m/s
    const speedMs = speedKmh / 3.6;
    // Distance traveled in the interval
    const distanceM = speedMs * (intervalMs / 1000);
    // Convert heading to radians (heading is clockwise from north)
    const headingRad = (headingDeg - 90) * (Math.PI / 180);
    // Approximate lat/lon delta (simplified, works for small distances)
    const latDelta = (distanceM * Math.cos(headingRad)) / 111320;
    const lonDelta = (distanceM * Math.sin(headingRad)) / (111320 * Math.cos(lat * Math.PI / 180));

    return {
      lat: lat + latDelta,
      lon: lon + lonDelta,
    };
  };

  useEffect(() => {
    if (!busLocation) {
      return;
    }

    const { lat, lon, speed, heading } = busLocation;

    if (reducedMotion) {
      // Snap instantly when reduced motion is enabled
      animatedLat.value = lat;
      animatedLon.value = lon;
      animatedHeading.value = heading;
      lastTargetLat.value = lat;
      lastTargetLon.value = lon;
      return;
    }

    // Project the expected position at next ping time
    const projected = projectForward(lat, lon, speed, heading, PING_INTERVAL_MS);

    // Cancel any in-flight animation to the previous target
    cancelAnimation(animatedLat);
    cancelAnimation(animatedLon);

    // Animate from current position to projected position
    animatedLat.value = withTiming(projected.lat, {
      duration: ANIMATION_DURATION_MS,
      easing: Easing.linear,
    });
    animatedLon.value = withTiming(projected.lon, {
      duration: ANIMATION_DURATION_MS,
      easing: Easing.linear,
    });
    animatedHeading.value = withTiming(heading, {
      duration: ANIMATION_DURATION_MS,
      easing: Easing.linear,
    });

    // Track the target for next-frame cancellation
    lastTargetLat.value = projected.lat;
    lastTargetLon.value = projected.lon;
  }, [busLocation, reducedMotion]);

  return {
    animatedLat: animatedLat as SharedValue<number>,
    animatedLon: animatedLon as SharedValue<number>,
    animatedHeading: animatedHeading as SharedValue<number>,
    busLocation,
    gpsStatus,
    isStale,
    studentUI,
    ...rest,
  };
}