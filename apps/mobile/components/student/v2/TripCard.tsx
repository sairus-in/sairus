import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { PROVIDER_DEFAULT, Marker } from 'react-native-maps';
import Svg, { Path, Rect } from 'react-native-svg';
import { useRouter } from 'expo-router';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { brand, elevation, pill, radius, space } from '../../../constants/brand';
import { type } from '../../../constants/typography';
import type { StudentHomeTrip, StudentScreenState } from 'shared';
import { useLiveBus } from '../../../hooks/useLiveBus';

interface TripCardProps {
  trip: StudentHomeTrip | null;
  screenState: StudentScreenState;
  stopName: string | null;
  canCheckIn: boolean;
  onScanPress: () => void;
}

type PillVariant = keyof typeof pill;

function resolvePill(
  screenState: StudentScreenState,
  trip: StudentHomeTrip | null,
): { variant: PillVariant; label: string } {
  if (screenState.status === 'no_trip') return { variant: 'noTrip', label: 'NO TRIP' };
  if (screenState.status === 'trip_completed') return { variant: 'completed', label: 'COMPLETED' };
  if (screenState.status === 'trip_upcoming') return { variant: 'scheduled', label: 'SCHEDULED' };

  const gps = trip?.gpsStatus;
  if (gps === 'OFFLINE' || gps === 'STALE') return { variant: 'gpsWeak', label: 'GPS WEAK' };

  if (screenState.status === 'checked_in') return { variant: 'onTime', label: 'BOARDED' };
  return { variant: 'onTime', label: 'ON TIME' };
}

// Derive a short route number (e.g., "177") from the route name. Backend doesn't ship a
// dedicated field today, so we extract the first 1-4 digit token from the human-readable
// route name. Returns null when the route name has no numeric token.
function extractRouteNumber(routeName: string | null | undefined): string | null {
  if (!routeName) return null;
  const match = routeName.match(/\b(\d{1,4})\b/);
  return match ? match[1] : null;
}

function resolveEta(screenState: StudentScreenState, trip: StudentHomeTrip | null): string {
  if (screenState.status === 'trip_active') {
    if (screenState.busEta == null) return '—';
    return String(screenState.busEta);
  }
  if (screenState.status === 'trip_upcoming' && trip?.minutesLate != null) {
    return String(Math.abs(trip.minutesLate));
  }
  return '—';
}

// The central trip card. Composes a map preview, bus info row, ETA hero block, and the
// "scan Qr" action. All sub-pieces are inline here because none are reused outside this
// card. Splitting them would be premature abstraction.
export function TripCard({ trip, screenState, stopName, canCheckIn, onScanPress }: TripCardProps) {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const pillSpec = pill[resolvePill(screenState, trip).variant];
  const pillLabel = resolvePill(screenState, trip).label;
  const eta = resolveEta(screenState, trip);
  const busNumber = trip?.busNumber ?? '—';
  const routeName = trip?.routeName ?? 'No route assigned';
  const routeNumber = extractRouteNumber(trip?.routeName);
  const busId = trip?.busId ?? null;
  const { busLocation } = useLiveBus(busId);
  const hasLiveBus = busLocation !== null && busLocation !== undefined;

  return (
    <Animated.View
      entering={reducedMotion ? undefined : FadeInDown.duration(420).delay(80)}
      style={styles.card}
    >
      {/* "BUS is at : Junction, …" header pill */}
      <View style={styles.busAtRow}>
        <Text style={styles.busAtLabel}>BUS is at : </Text>
        <Text style={styles.busAtPlace} numberOfLines={1}>
          {routeName}
        </Text>
      </View>

      {/* Live mini-map preview */}
      <Pressable
        onPress={() => router.push('/(student)/map')}
        style={({ pressed }) => [styles.mapPreview, pressed && { opacity: 0.92 }]}
        accessibilityRole="button"
        accessibilityLabel="Open live map"
      >
        {hasLiveBus ? (
          <>
            <MapView
              style={StyleSheet.absoluteFillObject}
              provider={PROVIDER_DEFAULT}
              pointerEvents="none"
              scrollEnabled={false}
              zoomEnabled={false}
              rotateEnabled={false}
              pitchEnabled={false}
              showsUserLocation={false}
              showsMyLocationButton={false}
              showsCompass={false}
              showsScale={false}
              toolbarEnabled={false}
              liteMode
              initialRegion={{
                latitude: busLocation.lat,
                longitude: busLocation.lon,
                latitudeDelta: 0.012,
                longitudeDelta: 0.012,
              }}
            >
              <Marker
                coordinate={{ latitude: busLocation.lat, longitude: busLocation.lon }}
                tracksViewChanges={false}
                anchor={{ x: 0.5, y: 0.5 }}
              >
                <View style={styles.miniBusPin} />
              </Marker>
            </MapView>
            <View style={styles.mapPreviewOverlay} pointerEvents="none" />
          </>
        ) : (
          <Text style={styles.mapLabel}>MAP</Text>
        )}
      </Pressable>

      <View style={styles.busInfoRow}>
        <Text style={styles.busNoText}>
          <Text style={styles.busNoLabel}>BUS no : </Text>
          <Text style={styles.busNoCode}>{busNumber}</Text>
          {routeNumber ? (
            <>
              <Text style={styles.busNoSeparator}> / </Text>
              <Text style={styles.busNoCode}>{routeNumber}</Text>
            </>
          ) : null}
        </Text>
        <View
          style={[
            styles.statusPill,
            { backgroundColor: pillSpec.bg, borderColor: pillSpec.border },
          ]}
        >
          <View style={[styles.statusDot, { backgroundColor: pillSpec.dot }]} />
          <Text style={[styles.statusText, { color: pillSpec.text }]}>{pillLabel}</Text>
        </View>
      </View>

      {/* ETA hero — the only block using Morne */}
      <View style={styles.etaBlock}>
        <Text style={styles.etaPrefix}>•Estimately</Text>
        <View style={styles.etaRow}>
          <Text style={styles.etaNumber}>{eta}</Text>
          <Text style={styles.etaUnit}>mins</Text>
          <View style={styles.etaDivider} />
          <View style={styles.etaTargetDot} />
          <Text style={styles.etaTargetLabel}>
            To your <Text style={styles.etaTargetHighlight}>location</Text>
          </Text>
        </View>
      </View>

      <View style={styles.pointRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.pointLabel}>Your point:</Text>
          <Text style={styles.pointValue} numberOfLines={1}>
            {stopName ?? '—'}
          </Text>
        </View>
        <Pressable
          onPress={onScanPress}
          disabled={!canCheckIn}
          style={({ pressed }) => [
            styles.scanCta,
            !canCheckIn && styles.scanCtaDisabled,
            pressed && styles.scanCtaPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={canCheckIn ? 'Scan QR to check in' : 'Scan unavailable right now'}
          accessibilityState={{ disabled: !canCheckIn }}
        >
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
            <Rect x={3} y={3} width={7} height={7} rx={1} stroke={brand.blue[900]} strokeWidth={1.8} />
            <Rect x={14} y={3} width={7} height={7} rx={1} stroke={brand.blue[900]} strokeWidth={1.8} />
            <Rect x={3} y={14} width={7} height={7} rx={1} stroke={brand.blue[900]} strokeWidth={1.8} />
            <Path
              d="M14 14h7v7h-7zM14 17h7M17 14v7"
              stroke={brand.blue[900]}
              strokeWidth={1.8}
            />
          </Svg>
          <Text style={styles.scanCtaText}>scan Qr</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: brand.neutral[0],
    borderRadius: radius.xl,
    paddingHorizontal: space.md,
    paddingTop: space.md,
    paddingBottom: space.md,
    marginHorizontal: space.md,
    ...elevation.card,
  },
  busAtRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: space.sm,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: brand.neutral[0],
    borderWidth: 1,
    borderColor: brand.neutral[300],
    marginBottom: space.sm,
  },
  busAtLabel: {
    ...type.body.sm,
    color: brand.ink[500],
  },
  busAtPlace: {
    ...type.body.sm,
    color: brand.blue[400],
  },
  mapPreview: {
    height: 132,
    borderRadius: radius.lg,
    backgroundColor: brand.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
    overflow: 'hidden',
  },
  mapPreviewOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  miniBusPin: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: brand.blue[600],
    borderWidth: 2,
    borderColor: brand.neutral[0],
  },
  mapLabel: {
    ...type.display.lg,
    fontSize: 28,
    color: brand.neutral[500],
  },
  busInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.md,
  },
  busNoText: {
    flex: 1,
  },
  busNoLabel: {
    ...type.body.sm,
    color: brand.ink[800],
  },
  busNoCode: {
    ...type.code.md,
    color: brand.blue[700],
  },
  busNoSeparator: {
    ...type.body.sm,
    color: brand.ink[500],
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusText: {
    ...type.body.xs,
    letterSpacing: 0.6,
  },
  etaBlock: {
    borderWidth: 1,
    borderColor: brand.neutral[300],
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    marginBottom: space.md,
  },
  etaPrefix: {
    ...type.body.xs,
    color: brand.ink[500],
    marginBottom: 4,
  },
  etaRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
  },
  etaNumber: {
    ...type.eta.hero,
    color: brand.blue[400],
  },
  etaUnit: {
    ...type.eta.unit,
    color: brand.ink[800],
    marginBottom: 10,
  },
  etaDivider: {
    flex: 1,
    height: 1,
    backgroundColor: brand.neutral[400],
    marginBottom: 16,
    marginLeft: space.sm,
  },
  etaTargetDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: brand.ink[800],
    marginBottom: 14,
  },
  etaTargetLabel: {
    ...type.eta.label,
    color: brand.ink[800],
    marginBottom: 12,
  },
  etaTargetHighlight: {
    color: brand.blue[400],
  },
  pointRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  pointLabel: {
    ...type.body.md,
    color: brand.ink[900],
  },
  pointValue: {
    ...type.body.md,
    color: brand.blue[700],
  },
  scanCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    borderRadius: radius.pill,
    backgroundColor: brand.blue[50],
  },
  scanCtaDisabled: {
    opacity: 0.5,
  },
  scanCtaPressed: {
    transform: [{ scale: 0.96 }],
    backgroundColor: brand.blue[100],
  },
  scanCtaText: {
    ...type.body.md,
    color: brand.blue[900],
  },
});
