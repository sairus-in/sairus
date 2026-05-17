import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Marker, MapMarker } from 'react-native-maps';
import Animated, {
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  useSharedValue,
  useAnimatedReaction,
  runOnJS,
  Easing,
  SharedValue,
} from 'react-native-reanimated';
import Svg, { Rect, Path } from 'react-native-svg';
import { brand } from '../../../constants/brand';

interface BusMarkerProps {
  animatedLat: SharedValue<number>;
  animatedLon: SharedValue<number>;
  animatedHeading: SharedValue<number>;
  busNumber: string;
  markerOpacity: number;
  showPulse: boolean;
  reducedMotion: boolean;
}

/**
 * Bus marker with native-driven smooth interpolation between GPS pings.
 *
 * The trick: react-native-maps coordinates are JS-controlled, so we sample
 * the Reanimated shared value on every JS frame via useAnimatedReaction's
 * runOnJS bridge and push the new coordinate via setNativeProps. This avoids
 * React re-renders (which would defeat tracksViewChanges={false}) while still
 * moving the marker visibly between pings.
 */
export function BusMarker({
  animatedLat,
  animatedLon,
  animatedHeading,
  busNumber,
  markerOpacity,
  showPulse,
  reducedMotion,
}: BusMarkerProps) {
  const markerRef = useRef<MapMarker>(null);
  const arrowRef = useRef<View>(null);
  const pulseScale = useSharedValue(1);
  const pulseOpacity = useSharedValue(0.5);

  // Push coordinate updates to the native marker without re-rendering React.
  const updateCoordinate = (lat: number, lon: number) => {
    markerRef.current?.setNativeProps({
      coordinate: { latitude: lat, longitude: lon },
    });
  };

  const updateHeading = (heading: number) => {
    arrowRef.current?.setNativeProps({
      style: { transform: [{ rotate: `${heading}deg` }] },
    });
  };

  useAnimatedReaction(
    () => ({ lat: animatedLat.value, lon: animatedLon.value }),
    (current, prev) => {
      if (prev && current.lat === prev.lat && current.lon === prev.lon) return;
      runOnJS(updateCoordinate)(current.lat, current.lon);
    },
    [],
  );

  useAnimatedReaction(
    () => animatedHeading.value,
    (current, prev) => {
      if (prev !== null && current === prev) return;
      runOnJS(updateHeading)(current);
    },
    [],
  );

  // Pulse halo
  useEffect(() => {
    if (showPulse && !reducedMotion) {
      pulseScale.value = withRepeat(
        withSequence(
          withTiming(1.6, { duration: 1500, easing: Easing.out(Easing.ease) }),
          withTiming(1, { duration: 0 }),
        ),
        -1,
        false,
      );
      pulseOpacity.value = withRepeat(
        withSequence(
          withTiming(0, { duration: 1500, easing: Easing.out(Easing.ease) }),
          withTiming(0.5, { duration: 0 }),
        ),
        -1,
        false,
      );
    } else {
      pulseScale.value = 1;
      pulseOpacity.value = 0;
    }
  }, [showPulse, reducedMotion]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
    opacity: pulseOpacity.value,
  }));

  return (
    <Marker
      ref={markerRef}
      coordinate={{ latitude: animatedLat.value, longitude: animatedLon.value }}
      tracksViewChanges={false}
      anchor={{ x: 0.5, y: 0.5 }}
    >
      <View style={styles.container}>
        {showPulse && !reducedMotion && (
          <Animated.View style={[styles.pulseHalo, pulseStyle]} />
        )}

        <View style={[styles.busPill, { opacity: markerOpacity }]}>
          <BusIcon />
          <Text style={styles.busNumber}>{busNumber}</Text>
        </View>

        <View ref={arrowRef} style={styles.headingArrow}>
          <Svg width={12} height={12} viewBox="0 0 12 12">
            <Path d="M6 0L12 12L6 9L0 12L6 0Z" fill={brand.blue[600]} />
          </Svg>
        </View>
      </View>
    </Marker>
  );
}

function BusIcon() {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24">
      <Rect x="4" y="3" width="16" height="18" rx="2" stroke="white" strokeWidth={2} />
      <Path d="M4 11h16M8 17h.01M16 17h.01" stroke="white" strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseHalo: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: brand.blue[500],
  },
  busPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: brand.blue[600],
    borderRadius: 14,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 4,
    minWidth: 44,
    height: 28,
  },
  busNumber: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  headingArrow: {
    marginTop: 2,
  },
});
