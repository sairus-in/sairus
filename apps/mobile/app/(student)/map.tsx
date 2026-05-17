import React, { useCallback, useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Dimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';
import MapView, { PROVIDER_DEFAULT } from 'react-native-maps';
import Svg, { Path } from 'react-native-svg';

import { useStudentHome } from '../../hooks/useStudentHome';
import { useAnimatedBusPosition } from '../../hooks/useAnimatedBusPosition';
import { useMapCamera } from '../../hooks/useMapCamera';
import { BusMarker } from '../../components/student/v2/BusMarker';
import { StopMarker } from '../../components/student/v2/StopMarker';
import { RoutePolyline } from '../../components/student/v2/RoutePolyline';
import { MapBottomSheet } from '../../components/student/v2/MapBottomSheet';
import { AtmosphericBackground } from '../../components/v2/AtmosphericBackground';
import { brand, elevation, radius, space } from '../../constants/brand';
import { type as fontType } from '../../constants/typography';

// Derive a short route number from the route name (matches TripCard logic). Backend
// doesn't ship a dedicated field today; we extract the first 1-4 digit token.
function extractRouteNumber(routeName: string | null | undefined): string | null {
  if (!routeName) return null;
  const match = routeName.match(/\b(\d{1,4})\b/);
  return match ? match[1] : null;
}

const { width, height } = Dimensions.get('window');

// Icons
const BackIcon = ({ color = brand.neutral[0] }: { color?: string }) => (
  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
    <Path d="M15 6l-6 6 6 6" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

// Skeleton loader for loading state
function MapSkeletonLoader({ label = 'Locating bus...' }: { label?: string }) {
  return (
    <View style={styles.skeletonContainer}>
      <View style={styles.skeletonMap}>
        <View style={styles.skeletonBackground} />
        <View style={styles.skeletonCard}>
          <ActivityIndicator size="small" color={brand.blue[500]} />
          <Text style={styles.skeletonLabel}>{label}</Text>
        </View>
      </View>
    </View>
  );
}

// Floating banner
function FloatingBanner({ text }: { text: string }) {
  return (
    <View style={styles.banner}>
      <Text style={styles.bannerText}>{text}</Text>
    </View>
  );
}

// Top chips — blue filled back circle on the left, pale-blue "BUS NO : 177" pill on the right.
function MapTopChips({
  routeNumber,
  onBack,
}: {
  routeNumber: string | null;
  onBack: () => void;
}) {
  return (
    <View style={styles.topChips}>
      <TouchableOpacity
        style={styles.backChip}
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <BackIcon />
      </TouchableOpacity>
      <View style={styles.busChip}>
        <Text style={styles.busChipText}>BUS NO : {routeNumber ?? '—'}</Text>
      </View>
    </View>
  );
}

export default function MapScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();

  const { data } = useStudentHome();
  const trip = data?.transport?.trip ?? null;
  const busId = trip?.busId ?? null;
  const stopName = data?.student?.stopName ?? null;
  const routeGeometry = data?.transport?.routeGeometry ?? null;

  const screenState = data?.screenState;

  // Get animated bus position with dead-reckoning
  const {
    animatedLat,
    animatedLon,
    animatedHeading,
    busLocation,
    gpsStatus,
    studentUI,
  } = useAnimatedBusPosition(busId);

  // Current lat/lon for camera hook
  const currentLat = busLocation?.lat ?? 12.9716;
  const currentLon = busLocation?.lon ?? 77.5946;

  // Map camera hook — follow mode auto-resumes 4s after the last pan
  const {
    cameraRef,
    onMapPanDrag,
    onRegionChangeComplete,
  } = useMapCamera({
    busLat: currentLat,
    busLon: currentLon,
  });

  // Sheet snap index for map padding
  const [sheetSnapIndex, setSheetSnapIndex] = useState(0);

  // Compute map padding based on sheet position
  const mapPadding = useMemo(() => {
    const bottomOffset = sheetSnapIndex === 0 ? 160 : sheetSnapIndex === 1 ? height * 0.5 : height * 0.95;
    return [0, 0, 0, bottomOffset + insets.bottom] as [number, number, number, number];
  }, [sheetSnapIndex, insets.bottom]);

  const handleSnapChange = useCallback((index: number) => {
    setSheetSnapIndex(index);
  }, []);

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const routeNumber = extractRouteNumber(trip?.routeName);

  // Extract ETA and distance from screenState or busLocation
  const etaMin = screenState?.status === 'trip_active' ? screenState.busEta ?? busLocation?.etaMin ?? null : null;
  const distanceM = screenState?.status === 'trip_active' ? screenState.distanceRemainingM ?? busLocation?.distanceRemainingM ?? null : null;
  const canCheckIn = screenState?.status === 'trip_active' ? screenState.canCheckIn : false;

  // Calculate split index for polyline (first upcoming stop)
  const splitIndex = routeGeometry?.stops.findIndex(s => !s.passed) ?? -1;

  // Handle case when no bus location yet
  if (!busLocation && trip) {
    return (
      <View style={styles.root}>
        <AtmosphericBackground />
        <SafeAreaView style={styles.safe} edges={['top']}>
          <MapTopChips routeNumber={extractRouteNumber(trip.routeName)} onBack={handleBack} />
          <MapSkeletonLoader label="Locating bus..." />
        </SafeAreaView>
        <MapBottomSheet
          onSnapChange={handleSnapChange}
          trip={trip}
          stopName={stopName}
          etaMin={null}
          distanceM={null}
          canCheckIn={canCheckIn}
          stops={routeGeometry?.stops ?? null}
        />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <AtmosphericBackground />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <MapTopChips routeNumber={routeNumber} onBack={handleBack} />

        <View style={styles.mapCard}>
          <MapView
            ref={cameraRef as React.MutableRefObject<MapView | null>}
            provider={PROVIDER_DEFAULT}
            style={styles.map}
            onPanDrag={onMapPanDrag}
            onRegionChangeComplete={(region, details) =>
              onRegionChangeComplete(region, { isGesture: details.isGesture ?? false })
            }
            mapPadding={{
              top: mapPadding[0],
              right: mapPadding[1],
              bottom: mapPadding[3],
              left: mapPadding[2],
            }}
            showsUserLocation
            initialRegion={{
              latitude: currentLat,
              longitude: currentLon,
              latitudeDelta: 0.01,
              longitudeDelta: 0.01,
            }}
          >
            {/* Route polyline */}
            {routeGeometry && (
              <RoutePolyline
                polyline={routeGeometry.polyline}
                splitIndex={splitIndex >= 0 ? splitIndex : undefined}
              />
            )}

            {/* Stop markers */}
            {routeGeometry?.stops.map((stop) => (
              <StopMarker
                key={stop.id}
                id={stop.id}
                name={stop.name}
                lat={stop.lat}
                lon={stop.lon}
                sequence={stop.sequence}
                passed={stop.passed}
                isMyStop={stop.isMyStop}
              />
            ))}

            {/* Bus marker */}
            {busLocation && (
              <BusMarker
                animatedLat={animatedLat}
                animatedLon={animatedLon}
                animatedHeading={animatedHeading}
                busNumber={trip?.busNumber ?? '—'}
                markerOpacity={studentUI.markerOpacity}
                showPulse={studentUI.markerPulse}
                reducedMotion={reducedMotion}
              />
            )}
          </MapView>

          {/* Floating banner */}
          {studentUI.showBanner && studentUI.bannerText && (
            <FloatingBanner text={studentUI.bannerText} />
          )}
        </View>
      </SafeAreaView>

      <MapBottomSheet
        onSnapChange={handleSnapChange}
        trip={trip}
        stopName={stopName}
        etaMin={etaMin}
        distanceM={distanceM}
        canCheckIn={canCheckIn}
        stops={routeGeometry?.stops ?? null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: brand.blue[600],
  },
  safe: {
    flex: 1,
  },
  topChips: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  backChip: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: brand.blue[700],
    alignItems: 'center',
    justifyContent: 'center',
    ...elevation.button,
  },
  busChip: {
    backgroundColor: brand.blue[100],
    paddingHorizontal: space.md,
    paddingVertical: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: brand.blue[300],
    ...elevation.card,
  },
  busChipText: {
    ...fontType.body.sm,
    color: brand.blue[900],
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  mapCard: {
    flex: 1,
    marginHorizontal: space.md,
    marginBottom: space.md,
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: brand.neutral[0],
    ...elevation.card,
  },
  map: {
    flex: 1,
  },
  banner: {
    position: 'absolute',
    top: space.md,
    left: space.md,
    right: space.md,
    backgroundColor: brand.neutral[0],
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  bannerText: {
    color: brand.ink[700],
    fontSize: 13,
    textAlign: 'center',
  },
  skeletonContainer: {
    flex: 1,
    marginHorizontal: space.md,
    marginBottom: space.md,
  },
  skeletonMap: {
    flex: 1,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: brand.neutral[0],
  },
  skeletonBackground: {
    flex: 1,
    backgroundColor: brand.blue[50],
  },
  skeletonCard: {
    position: 'absolute',
    bottom: space.lg,
    left: space.lg,
    right: space.lg,
    backgroundColor: brand.neutral[0],
    borderRadius: 16,
    padding: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  skeletonLabel: {
    color: brand.ink[500],
    fontSize: 14,
  },
});