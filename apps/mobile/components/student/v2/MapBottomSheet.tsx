import React, { useCallback, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Share } from 'react-native';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useRouter } from 'expo-router';
import Svg, { Path, Rect } from 'react-native-svg';
import { brand, elevation, pill, radius, space } from '../../../constants/brand';
import { type } from '../../../constants/typography';
import type { StudentHomeTrip, RouteGeometryStop } from 'shared';

interface MapBottomSheetProps {
  onSnapChange?: (index: number) => void;
  trip: StudentHomeTrip | null;
  stopName: string | null;
  etaMin: number | null;
  distanceM: number | null;
  canCheckIn: boolean;
  stops?: RouteGeometryStop[] | null;
}

type StatusKey = 'onTime' | 'scheduled' | 'gpsWeak' | 'completed' | 'noTrip';

function formatDistance(distanceM: number | null): string {
  if (distanceM === null) return '';
  if (distanceM < 1000) return `(${distanceM}m)`;
  return `(${(distanceM / 1000).toFixed(1)}km)`;
}

function formatTime(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Derive the peek-row status pill from trip GPS + status.
function resolveStatus(trip: StudentHomeTrip | null): { key: StatusKey; label: string } {
  if (!trip) return { key: 'noTrip', label: 'NO TRIP' };
  if (trip.status === 'COMPLETED') return { key: 'completed', label: 'COMPLETED' };
  if (trip.status === 'SCHEDULED') return { key: 'scheduled', label: 'SCHEDULED' };
  if (trip.gpsStatus === 'OFFLINE' || trip.gpsStatus === 'STALE') {
    return { key: 'gpsWeak', label: 'GPS WEAK' };
  }
  if (trip.minutesLate != null && trip.minutesLate > 5) {
    return { key: 'scheduled', label: `RUNNING LATE` };
  }
  return { key: 'onTime', label: 'ON TIME' };
}

export function MapBottomSheet({
  onSnapChange,
  trip,
  stopName,
  etaMin,
  distanceM,
  canCheckIn,
  stops,
}: MapBottomSheetProps) {
  const router = useRouter();
  const bottomSheetRef = useRef<BottomSheet>(null);

  // Peek shows the status pill + ETA + Checkin. Mid reveals your-stop, next-stop,
  // driver row, and a substitute/outage banner when relevant. Expanded reveals quick
  // actions + timeline + messages + metadata.
  const snapPoints = useMemo(() => ['16%', '48%', '92%'], []);

  const handleSheetChanges = useCallback(
    (index: number) => onSnapChange?.(index),
    [onSnapChange],
  );

  const handleScanQR = useCallback(() => router.push('/(student)/scanner'), [router]);
  const handleSelfReport = useCallback(() => router.push('/(student)/self-report-prompt'), [router]);
  const handleNotifyLate = useCallback(() => router.push('/(student)/self-report-prompt'), [router]);
  const handleShare = useCallback(async () => {
    if (!trip) return;
    try {
      await Share.share({
        message: `Tracking bus ${trip.busNumber} on ${trip.routeName}. ETA ${etaMin ?? '—'} min to my stop.`,
      });
    } catch {
      // Share was dismissed — nothing to do.
    }
  }, [trip, etaMin]);

  const status = useMemo(() => resolveStatus(trip), [trip]);
  const statusPill = pill[status.key];

  const etaLabel = etaMin !== null ? `${etaMin} min` : '— min';
  const distLabel = formatDistance(distanceM);

  // Stop counting — find my stop's index in the route, count upcoming stops before it.
  const stopMeta = useMemo(() => {
    if (!stops || stops.length === 0) return null;
    const myIdx = stops.findIndex((s) => s.isMyStop);
    if (myIdx < 0) return null;
    const total = stops.length;
    const upcomingBefore = stops.slice(0, myIdx).filter((s) => !s.passed).length;
    return { mySeq: myIdx + 1, total, upcomingBefore };
  }, [stops]);

  // Next upcoming stop (first not-passed, not-my-stop).
  const nextStop = useMemo(() => {
    if (!stops || stops.length === 0) return null;
    return stops.find((s) => !s.passed && !s.isMyStop) ?? null;
  }, [stops]);

  const showSubstituteBanner = trip?.isSubstitute === true;
  const showOutageBanner =
    trip?.gpsStatus === 'OFFLINE' || trip?.gpsStatus === 'STALE';
  const scheduledLabel = formatTime(trip?.scheduledDeparture ?? null);
  const driverInitial = trip?.driverName?.trim()?.charAt(0)?.toUpperCase() ?? null;

  return (
    <BottomSheet
      ref={bottomSheetRef}
      index={0}
      snapPoints={snapPoints}
      onChange={handleSheetChanges}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handleIndicator}
      enablePanDownToClose={false}
    >
      <BottomSheetScrollView contentContainerStyle={styles.scroll}>
        {/* PEEK — tiny status pill, ETA, Checkin */}
        <View style={styles.peekRow}>
          <View style={styles.peekLeft}>
            <View
              style={[
                styles.statusPill,
                { backgroundColor: statusPill.bg, borderColor: statusPill.border },
              ]}
            >
              <View style={[styles.statusDot, { backgroundColor: statusPill.dot }]} />
              <Text style={[styles.statusText, { color: statusPill.text }]}>{status.label}</Text>
            </View>
            <Text style={styles.etaLine}>
              <Text style={styles.etaValue}>{etaLabel}</Text>
              {distLabel ? <Text style={styles.etaDist}> {distLabel}</Text> : null}
            </Text>
          </View>
          <Pressable
            onPress={handleScanQR}
            disabled={!canCheckIn}
            style={({ pressed }) => [
              styles.checkinPill,
              !canCheckIn && styles.checkinPillDisabled,
              pressed && { opacity: 0.85 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Check in"
            accessibilityState={{ disabled: !canCheckIn }}
          >
            <Text style={styles.checkinText}>Checkin</Text>
            <CheckIcon />
          </Pressable>
        </View>

        <View style={styles.divider} />

        {/* MID — banners */}
        {showSubstituteBanner ? (
          <View style={[styles.banner, styles.bannerCoral]}>
            <Text style={styles.bannerText}>
              Substitute bus today
              {trip?.originalBusNumber ? ` (was ${trip.originalBusNumber})` : ''}.
              Look for {trip?.busNumber ?? 'the new bus'} instead.
            </Text>
          </View>
        ) : null}

        {showOutageBanner ? (
          <View style={[styles.banner, styles.bannerAmber]}>
            <Text style={styles.bannerText}>
              GPS is weak right now. The bus position may not reflect reality. We&apos;ll
              update as soon as we get a fresh ping.
            </Text>
          </View>
        ) : null}

        {/* MID — your stop */}
        {stopName ? (
          <View style={styles.yourStopCard}>
            <Text style={styles.yourStopLabel}>YOUR STOP</Text>
            <Text style={styles.yourStopName} numberOfLines={1}>
              {stopName}
            </Text>
            {stopMeta ? (
              <Text style={styles.yourStopMeta}>
                Stop {stopMeta.mySeq} of {stopMeta.total}
                {stopMeta.upcomingBefore > 0
                  ? ` · ${stopMeta.upcomingBefore} stop${stopMeta.upcomingBefore === 1 ? '' : 's'} away`
                  : ' · next stop'}
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* MID — next stop chip */}
        {nextStop ? (
          <View style={styles.nextStopRow}>
            <Text style={styles.nextStopLabel}>Next</Text>
            <Text style={styles.nextStopName} numberOfLines={1}>
              {nextStop.name}
            </Text>
          </View>
        ) : null}

        {/* MID — driver */}
        {trip?.driverName ? (
          <View style={styles.driverRow}>
            <View style={styles.driverAvatar}>
              <Text style={styles.driverInitial}>{driverInitial}</Text>
            </View>
            <View style={styles.driverInfo}>
              <Text style={styles.driverName} numberOfLines={1}>
                {trip.driverName}
              </Text>
              <Text style={styles.driverRole}>Driver</Text>
            </View>
          </View>
        ) : null}

        {(stopName || trip?.driverName) && <View style={styles.divider} />}

        {/* EXPANDED — quick actions */}
        <View style={styles.quickActionsRow}>
          <QuickAction icon={<NotifyIcon />} label="Notify Late" onPress={handleNotifyLate} />
          <QuickAction icon={<ReportIcon />} label="Self-Report" onPress={handleSelfReport} />
          <QuickAction icon={<ShareIcon />} label="Share" onPress={handleShare} />
        </View>

        {/* EXPANDED — boarded count */}
        {trip && trip.expectedCount > 0 ? (
          <View style={styles.boardedRow}>
            <Text style={styles.boardedLabel}>Boarded</Text>
            <Text style={styles.boardedValue}>
              {trip.boardedCount} / {trip.expectedCount}
            </Text>
          </View>
        ) : null}

        {/* EXPANDED — trip timeline */}
        {stops && stops.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Trip Timeline</Text>
            <View style={styles.timeline}>
              {stops.map((stop, idx) => {
                const isLast = idx === stops.length - 1;
                return (
                  <View key={stop.id} style={styles.timelineRow}>
                    <View style={styles.timelineLeft}>
                      <View
                        style={[
                          styles.timelineDot,
                          stop.passed && styles.timelineDotPassed,
                          stop.isMyStop && styles.timelineDotMyStop,
                        ]}
                      />
                      {!isLast ? (
                        <View
                          style={[
                            styles.timelineLine,
                            stop.passed && styles.timelineLinePassed,
                          ]}
                        />
                      ) : null}
                    </View>
                    <Text
                      style={[
                        styles.timelineStopName,
                        stop.passed && styles.timelineStopNamePassed,
                        stop.isMyStop && styles.timelineStopNameMyStop,
                      ]}
                      numberOfLines={1}
                    >
                      {stop.name}
                      {stop.isMyStop ? '  ·  Your Stop' : ''}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        {/* EXPANDED — messages */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Trip Messages</Text>
          <View style={styles.messagesEmpty}>
            <Text style={styles.messagesEmptyText}>No messages from the driver yet.</Text>
          </View>
        </View>

        {/* EXPANDED — trip metadata footer */}
        {trip ? (
          <Text style={styles.metaFooter}>
            {trip.type === 'MORNING' ? 'Morning trip' : 'Return trip'}
            {scheduledLabel ? ` · scheduled ${scheduledLabel}` : ''}
            {trip.minutesLate != null && trip.minutesLate !== 0
              ? ` · ${trip.minutesLate > 0 ? 'late' : 'early'} ${Math.abs(trip.minutesLate)} min`
              : ''}
          </Text>
        ) : null}
      </BottomSheetScrollView>
    </BottomSheet>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function QuickAction({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.actionButton,
        disabled && { opacity: 0.4 },
        pressed && { transform: [{ scale: 0.96 }] },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={styles.actionIcon}>{icon}</View>
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

function CheckIcon() {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5 12l5 5 9-9"
        stroke={brand.success.fg}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function NotifyIcon() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"
        stroke={brand.blue[700]}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <Path d="M13.7 21a2 2 0 01-3.4 0" stroke={brand.blue[700]} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

function ReportIcon() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Rect x="4" y="3" width="16" height="18" rx="2" stroke={brand.blue[700]} strokeWidth={1.8} />
      <Path d="M9 9h6M9 13h6M9 17h4" stroke={brand.blue[700]} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

function ShareIcon() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3v12M12 3l-4 4M12 3l4 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"
        stroke={brand.blue[700]}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: brand.neutral[0],
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    ...elevation.card,
  },
  handleIndicator: {
    backgroundColor: brand.neutral[400],
    width: 40,
    height: 4,
  },
  scroll: {
    paddingHorizontal: space.lg,
    paddingTop: space.xs,
    paddingBottom: space['3xl'],
  },

  // Peek row
  peekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: space.xs,
    paddingBottom: space.sm,
  },
  peekLeft: {
    flex: 1,
    gap: 6,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    ...type.body.xs,
    letterSpacing: 0.6,
  },
  etaLine: {},
  etaValue: {
    ...type.body.lg,
    fontSize: 22,
    fontWeight: '700',
    color: brand.success.fg,
  },
  etaDist: {
    ...type.body.md,
    color: brand.ink[700],
    fontWeight: '500',
  },
  checkinPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: space.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: brand.success.bg,
  },
  checkinPillDisabled: {
    backgroundColor: brand.neutral[200],
  },
  checkinText: {
    ...type.body.md,
    color: brand.ink[900],
    fontWeight: '700',
    fontSize: 15,
  },

  divider: {
    height: 1,
    backgroundColor: brand.neutral[200],
    marginVertical: space.sm,
  },

  // Banners
  banner: {
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    marginBottom: space.sm,
  },
  bannerCoral: {
    backgroundColor: brand.accent.warmTint,
  },
  bannerAmber: {
    backgroundColor: brand.neutral[100],
  },
  bannerText: {
    ...type.body.sm,
    color: brand.ink[800],
  },

  // Your stop card
  yourStopCard: {
    backgroundColor: brand.blue[50],
    borderRadius: radius.md,
    padding: space.md,
    marginBottom: space.sm,
  },
  yourStopLabel: {
    ...type.body.xs,
    color: brand.blue[700],
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  yourStopName: {
    ...type.body.lg,
    fontSize: 20,
    fontWeight: '700',
    color: brand.blue[900],
  },
  yourStopMeta: {
    ...type.body.sm,
    color: brand.blue[700],
    marginTop: 4,
  },

  // Next stop chip
  nextStopRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    paddingHorizontal: space.sm,
    marginBottom: space.sm,
  },
  nextStopLabel: {
    ...type.body.xs,
    color: brand.ink[500],
    letterSpacing: 0.6,
  },
  nextStopName: {
    ...type.body.md,
    color: brand.ink[900],
    fontWeight: '600',
    flex: 1,
  },

  // Driver row
  driverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
  driverAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: brand.blue[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  driverInitial: {
    ...type.body.md,
    color: brand.blue[900],
    fontWeight: '700',
  },
  driverInfo: {
    flex: 1,
  },
  driverName: {
    ...type.body.md,
    color: brand.ink[900],
    fontWeight: '600',
  },
  driverRole: {
    ...type.body.xs,
    color: brand.ink[500],
  },

  // Quick actions
  quickActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: space.md,
    marginBottom: space.sm,
  },
  actionButton: {
    alignItems: 'center',
    gap: 6,
    minWidth: 72,
  },
  actionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: brand.blue[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: {
    ...type.body.xs,
    color: brand.ink[700],
    fontWeight: '500',
  },

  // Boarded
  boardedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
    marginBottom: space.sm,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: brand.neutral[200],
  },
  boardedLabel: {
    ...type.body.sm,
    color: brand.ink[500],
    letterSpacing: 0.5,
  },
  boardedValue: {
    ...type.body.md,
    color: brand.ink[900],
    fontWeight: '700',
  },

  // Sections
  section: {
    marginBottom: space.md,
  },
  sectionTitle: {
    ...type.body.md,
    fontWeight: '600',
    color: brand.ink[900],
    marginBottom: space.sm,
  },

  // Timeline
  timeline: {
    paddingLeft: 4,
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 36,
  },
  timelineLeft: {
    width: 20,
    alignItems: 'center',
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: brand.neutral[400],
    backgroundColor: brand.neutral[0],
    zIndex: 1,
  },
  timelineDotPassed: {
    backgroundColor: brand.neutral[500],
    borderColor: brand.neutral[500],
  },
  timelineDotMyStop: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: brand.blue[600],
    borderColor: brand.blue[200],
    borderWidth: 3,
  },
  timelineLine: {
    position: 'absolute',
    top: 10,
    width: 2,
    height: 30,
    backgroundColor: brand.neutral[300],
  },
  timelineLinePassed: {
    backgroundColor: brand.neutral[500],
  },
  timelineStopName: {
    ...type.body.sm,
    color: brand.ink[800],
    marginLeft: space.sm,
    flex: 1,
  },
  timelineStopNamePassed: {
    color: brand.neutral[500],
    textDecorationLine: 'line-through',
  },
  timelineStopNameMyStop: {
    color: brand.blue[700],
    fontWeight: '600',
  },

  // Messages
  messagesEmpty: {
    padding: space.md,
    backgroundColor: brand.neutral[50],
    borderRadius: radius.md,
    alignItems: 'center',
  },
  messagesEmptyText: {
    ...type.body.sm,
    color: brand.ink[500],
  },

  // Footer
  metaFooter: {
    ...type.body.xs,
    color: brand.ink[500],
    textAlign: 'center',
    marginTop: space.sm,
    letterSpacing: 0.3,
  },
});
