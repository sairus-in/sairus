import React, { Suspense, startTransition, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { HomeLoadingSkeleton, SkeletonBlock } from '../../components/shared/LoadingState';
import { ErrorState } from '../../components/shared/ErrorState';
import { ScreenErrorBoundary } from '../../components/shared/ScreenErrorBoundary';
import { StatCards, StatCardsSkeleton } from '../../components/student/StatCards';
import { colors, radii, spacing, statusPill, typography } from '../../constants/theme';
import { useOfflineQueueCount } from '../../hooks/useOfflineQueueCount';
import { useLiveBus } from '../../hooks/useLiveBus';
import { useStudentHome, useStudentHomeSecondary } from '../../hooks/useStudentHome';
import { useStudentSocket } from '../../hooks/useStudentSocket';
import { useStudentAuth } from '../../hooks/useOptimizedAuth';
import type { StudentHomeResponseV3 } from '../../lib/schemas';

function formatDisplayDate(date = new Date()) {
  return date.toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDisplayTime(value?: string | null) {
  if (!value) {
    return 'TBD';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getHeaderGreeting(date: Date) {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function getStatusBadge(status: StudentHomeResponseV3['screenState']['status'], gpsStatus: string) {
  if (status === 'checked_in') {
    return {
      label: 'Checked in',
      backgroundColor: statusPill.PRESENT.bg,
      color: statusPill.PRESENT.text,
    };
  }

  if (status === 'trip_active' && (gpsStatus === 'OFFLINE' || gpsStatus === 'STALE')) {
    return {
      label: `GPS ${gpsStatus.toLowerCase()}`,
      backgroundColor: statusPill.OFFLINE.bg,
      color: statusPill.OFFLINE.text,
    };
  }

  if (status === 'trip_active') {
    return {
      label: 'Live',
      backgroundColor: statusPill.PRESENT.bg,
      color: statusPill.PRESENT.text,
    };
  }

  if (status === 'trip_upcoming') {
    return {
      label: 'Upcoming',
      backgroundColor: statusPill.NOT_STARTED.bg,
      color: statusPill.NOT_STARTED.text,
    };
  }

  if (status === 'trip_completed') {
    return {
      label: 'Completed',
      backgroundColor: statusPill.NOT_STARTED.bg,
      color: statusPill.NOT_STARTED.text,
    };
  }

  return {
    label: 'No trip',
    backgroundColor: statusPill.NOT_STARTED.bg,
    color: statusPill.NOT_STARTED.text,
  };
}

function getStatusTitle(home: StudentHomeResponseV3) {
  if (!home.features.hasAssignment) {
    return 'Route assignment pending';
  }

  switch (home.screenState.status) {
    case 'trip_upcoming':
      return 'Trip scheduled';
    case 'trip_active':
      return 'Trip active';
    case 'checked_in':
      return 'Attendance recorded';
    case 'trip_completed':
      return 'Trip completed';
    default:
      return 'No trip today';
  }
}

function getStatusMessage(home: StudentHomeResponseV3, gpsStatus: string) {
  const stopName = home.student.stopName;

  switch (home.screenState.status) {
    case 'trip_upcoming':
      return `Bus ${home.screenState.busNumber} is scheduled to depart at ${home.screenState.departureAt}.`;
    case 'trip_active':
      return home.screenState.canCheckIn
        ? `Your bus is active${stopName ? ` near ${stopName}` : ''}. GPS is ${gpsStatus.toLowerCase()}.`
        : 'Trip is active, but check-in is not currently available.';
    case 'checked_in':
      return `Your attendance was recorded at ${formatDisplayTime(home.screenState.checkedInAt)}.`;
    case 'trip_completed':
      return 'Today\'s trip window has closed.';
    default:
      return home.features.hasAssignment
        ? 'You do not have an active trip right now.'
        : 'Your transport assignment is still being processed.';
  }
}

const FactCard = React.memo(function FactCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.factCard}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
});

const AlertCard = React.memo(function AlertCard({ label, tone }: { label: string; tone: 'warning' | 'info' }) {
  const palette = tone === 'warning' ? colors.warning : colors.info;

  return (
    <View style={[styles.alertCard, { backgroundColor: palette.bg, borderColor: palette.border }]}>
      <Text style={[styles.alertText, { color: palette.text }]}>{label}</Text>
    </View>
  );
});

function StudentHomeSecondaryFallback() {
  return (
    <>
      <View style={styles.statsWrap}>
        <StatCardsSkeleton />
      </View>
      <View style={styles.section}>
        <SkeletonBlock width={96} height={18} />
        <SkeletonBlock width="100%" height={56} style={{ marginTop: spacing.md }} />
      </View>
    </>
  );
}

function StudentHomeSecondaryContent() {
  const { data } = useStudentHomeSecondary();

  return (
    <>
      <View style={styles.statsWrap}>
        <StatCards
          percentage={data.history.percentage}
          presentCount={data.history.presentCount}
          absentCount={data.history.absentCount}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Alerts</Text>
        {data.alerts.yesterdayAbsent ? (
          <AlertCard
            tone="warning"
            label={`You were absent on ${data.alerts.yesterdayDate ?? 'the previous trip day'}.`}
          />
        ) : null}
        {data.alerts.substituteAssigned ? (
          <AlertCard tone="info" label="A substitute or delegate is currently assigned to this service." />
        ) : null}
        {!data.alerts.yesterdayAbsent && !data.alerts.substituteAssigned ? (
          <Text style={styles.sectionEmpty}>No active alerts.</Text>
        ) : null}
      </View>
    </>
  );
}

function StudentHomeContent() {
  const router = useRouter();
  const { user } = useStudentAuth();
  const { data, isLoading, isError, error, isFetching, isStale, refetch } = useStudentHome();
  const pendingCount = useOfflineQueueCount();
  const trip = data?.transport.trip ?? null;
  const { busLocation, gpsStatus } = useLiveBus(trip?.busId ?? null);
  const [clock, setClock] = useState(() => new Date());
  const [showDeferredSections, setShowDeferredSections] = useState(false);

  useEffect(() => {
    const updateClock = () => setClock(new Date());
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const timeoutId = setTimeout(() => {
      updateClock();
      intervalId = setInterval(updateClock, 60_000);
    }, 60_000 - (Date.now() % 60_000));

    return () => {
      clearTimeout(timeoutId);
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, []);

  useEffect(() => {
    if (!data) {
      setShowDeferredSections(false);
      return;
    }

    startTransition(() => {
      setShowDeferredSections(true);
    });
  }, [data]);

  useStudentSocket({
    tripId: trip?.id ?? null,
    busId: data?.student.busId ?? trip?.busId ?? null,
    routeId: data?.student.routeId ?? user?.routeAssignment?.routeId ?? null,
  });

  const greeting = useMemo(() => getHeaderGreeting(clock), [clock]);
  const displayDate = useMemo(() => formatDisplayDate(clock), [clock]);
  const badge = useMemo(
    () => (data ? getStatusBadge(data.screenState.status, gpsStatus) : null),
    [data, gpsStatus],
  );
  const statusTitle = useMemo(() => (data ? getStatusTitle(data) : ''), [data]);
  const statusMessage = useMemo(
    () => (data ? getStatusMessage(data, gpsStatus) : ''),
    [data, gpsStatus],
  );
  const departureValue = useMemo(
    () => formatDisplayTime(trip?.scheduledDeparture),
    [trip?.scheduledDeparture],
  );

  if (isLoading && !data) {
    return <HomeLoadingSkeleton />;
  }

  if (isError) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ErrorState
          message={error instanceof Error ? error.message : 'Unable to load student home.'}
          onRetry={() => void refetch()}
        />
      </SafeAreaView>
    );
  }

  if (!data) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ErrorState message="Student home payload is unavailable." onRetry={() => void refetch()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(data.meta.studentName || user?.name || 'S').charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.headerCopy}>
            <Text style={styles.greetingText}>{greeting}</Text>
            <Text style={styles.nameText}>{data.meta.studentName || user?.name || 'Student'}</Text>
            <Text style={styles.dateText}>{displayDate}</Text>
          </View>
        </View>

        {pendingCount > 0 ? (
          <View style={styles.pendingBanner}>
            <Text style={styles.pendingText}>
              {pendingCount} pending check-in{pendingCount > 1 ? 's' : ''} waiting to sync
            </Text>
            <Text style={styles.pendingHint}>They will replay automatically when the network is back.</Text>
          </View>
        ) : null}

        {isStale ? (
          <TouchableOpacity style={styles.infoBanner} onPress={() => void refetch()}>
            <Text style={styles.infoBannerText}>Showing cached data. Tap to refresh.</Text>
          </TouchableOpacity>
        ) : null}

        {isFetching ? (
          <View style={styles.fetchingWrap}>
            <Text style={styles.fetchingText}>Refreshing live state...</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>{statusTitle}</Text>
            <View style={[styles.badge, { backgroundColor: badge?.backgroundColor ?? statusPill.NOT_STARTED.bg }]}>
              <Text style={[styles.badgeText, { color: badge?.color ?? statusPill.NOT_STARTED.text }]}>
                {badge?.label ?? 'No trip'}
              </Text>
            </View>
          </View>

          <Text style={styles.cardBody}>{statusMessage}</Text>

          {trip ? (
            <View style={styles.factGrid}>
              <FactCard label="Bus" value={trip.busNumber} />
              <FactCard label="Route" value={trip.routeName} />
              <FactCard label="Departure" value={departureValue} />
            </View>
          ) : null}

          {busLocation ? (
            <Text style={styles.liveHint}>
              Last bus position: {busLocation.lat.toFixed(4)}, {busLocation.lon.toFixed(4)}
            </Text>
          ) : null}

          {data.screenState.status === 'trip_active' && data.screenState.canCheckIn ? (
            <TouchableOpacity style={styles.primaryButton} onPress={() => router.push('/(student)/scanner')}>
              <Text style={styles.primaryButtonText}>Open scanner</Text>
            </TouchableOpacity>
          ) : null}

          {data.features.canUseLiveMap ? (
            <TouchableOpacity style={styles.secondaryButton} onPress={() => router.push('/(student)/map')}>
              <Text style={styles.secondaryButtonText}>Open live map</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {showDeferredSections ? (
          <Suspense fallback={<StudentHomeSecondaryFallback />}>
            <StudentHomeSecondaryContent />
          </Suspense>
        ) : (
          <StudentHomeSecondaryFallback />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

export default function StudentHome() {
  return (
    <ScreenErrorBoundary screenName="StudentHome">
      <StudentHomeContent />
    </ScreenErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  scrollContent: {
    paddingBottom: spacing.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.brand.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: colors.white,
    fontFamily: typography.family,
    fontSize: typography.sizes.h2,
    fontWeight: typography.weights.bold,
  },
  headerCopy: {
    flex: 1,
  },
  greetingText: {
    fontFamily: typography.family,
    fontSize: typography.sizes.small,
    color: colors.text.secondary,
  },
  nameText: {
    fontFamily: typography.family,
    fontSize: typography.sizes.h1,
    fontWeight: typography.weights.bold,
    color: colors.text.primary,
  },
  dateText: {
    fontFamily: typography.family,
    fontSize: typography.sizes.small,
    color: colors.text.muted,
    marginTop: spacing.micro,
  },
  pendingBanner: {
    backgroundColor: colors.warning.bg,
    borderColor: colors.warning.border,
    borderWidth: 1,
    borderRadius: radii.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  pendingText: {
    fontFamily: typography.family,
    fontSize: typography.sizes.small,
    fontWeight: typography.weights.semibold,
    color: colors.warning.text,
  },
  pendingHint: {
    fontFamily: typography.family,
    fontSize: typography.sizes.caption,
    color: colors.warning.text,
    marginTop: spacing.micro,
  },
  infoBanner: {
    backgroundColor: colors.info.bg,
    borderColor: colors.info.border,
    borderWidth: 1,
    borderRadius: radii.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  infoBannerText: {
    fontFamily: typography.family,
    fontSize: typography.sizes.small,
    color: colors.info.text,
    textAlign: 'center',
  },
  fetchingWrap: {
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  fetchingText: {
    fontFamily: typography.family,
    fontSize: typography.sizes.caption,
    color: colors.text.secondary,
  },
  card: {
    backgroundColor: colors.card.bg,
    borderColor: colors.card.border,
    borderWidth: 1,
    borderRadius: radii.md,
    marginHorizontal: spacing.lg,
    padding: spacing.lg,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cardTitle: {
    flex: 1,
    fontFamily: typography.family,
    fontSize: typography.sizes.h2,
    fontWeight: typography.weights.bold,
    color: colors.text.primary,
  },
  badge: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  badgeText: {
    fontFamily: typography.family,
    fontSize: typography.sizes.micro,
    fontWeight: typography.weights.semibold,
  },
  cardBody: {
    fontFamily: typography.family,
    fontSize: typography.sizes.body,
    color: colors.text.secondary,
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  factGrid: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  factCard: {
    flex: 1,
    backgroundColor: colors.neutral.bg,
    borderRadius: radii.sm,
    padding: spacing.sm,
  },
  factLabel: {
    fontFamily: typography.family,
    fontSize: typography.sizes.micro,
    color: colors.text.muted,
    textTransform: 'uppercase',
  },
  factValue: {
    fontFamily: typography.family,
    fontSize: typography.sizes.small,
    fontWeight: typography.weights.semibold,
    color: colors.text.primary,
    marginTop: spacing.micro,
  },
  liveHint: {
    fontFamily: typography.family,
    fontSize: typography.sizes.caption,
    color: colors.text.secondary,
    marginTop: spacing.sm,
  },
  primaryButton: {
    backgroundColor: colors.button.brand.bg,
    borderRadius: radii.button,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  primaryButtonText: {
    fontFamily: typography.family,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
    color: colors.button.brand.text,
  },
  secondaryButton: {
    borderColor: colors.card.border,
    borderRadius: radii.button,
    borderWidth: 1,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  secondaryButtonText: {
    fontFamily: typography.family,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.medium,
    color: colors.text.primary,
  },
  statsWrap: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  section: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  sectionTitle: {
    fontFamily: typography.family,
    fontSize: typography.sizes.h3,
    fontWeight: typography.weights.semibold,
    color: colors.text.primary,
    marginBottom: spacing.md,
  },
  sectionEmpty: {
    fontFamily: typography.family,
    fontSize: typography.sizes.body,
    color: colors.text.secondary,
  },
  alertCard: {
    borderWidth: 1,
    borderRadius: radii.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  alertText: {
    fontFamily: typography.family,
    fontSize: typography.sizes.body,
  },
});
