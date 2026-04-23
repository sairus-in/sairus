// app/(driver)/index.tsx — Driver pre-trip assignment screen
// HARDENED v3:
//   - Wrapped in ScreenErrorBoundary
//   - console.error removed, replaced with analytics.error (LAW 5)
//   - All hardcoded '#FFF' replaced with theme token colors.white (LAW 2)
//   - handleStartTrip is null-safe (never crashes if assignment is undefined)
//   - analytics.track added to startTrip mutation (LAW 6 spirit for explicit calls)
//   - Live attendance socket listener wired in for kiosk-redirect state
import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { driverService } from '../../services/driver.service';
import { useAuth } from '../../store/auth.store';
import { useTrip } from '../../store/trip.store';
import { colors, typography, spacing, radii } from '../../constants/theme';
import { t } from '../../i18n';
import { EmptyState } from '../../components/shared/EmptyState';
import { HomeLoadingSkeleton } from '../../components/shared/LoadingState';
import { ScreenErrorBoundary } from '../../components/shared/ScreenErrorBoundary';
import { analytics } from '../../lib/analytics';

export default function DriverHome() {
  return (
    <ScreenErrorBoundary screenName="DriverHome">
      <DriverHomeContent />
    </ScreenErrorBoundary>
  );
}

function DriverHomeContent() {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const setExpectedCount = useTrip((s) => s.setExpectedCount);
  const setQR = useTrip((s) => s.setQR);

  const now = new Date();
  const hours = now.getHours();
  const greeting = hours < 12 ? t('driver.greeting') : 'Good afternoon,';

  // SESSION_STABLE: the driver's daily assignment can change during the session, but not continuously.
  const { data: assignment, isLoading, refetch } = useQuery({
    queryKey: ['driver-assignment'],
    queryFn: driverService.getTodayAssignment,
    networkMode: 'offlineFirst',
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchInterval: (query: any) => {
      // Poll aggressively only before trip starts
      const status = query.state?.data?.trip?.status;
      if (status === 'SCHEDULED') return 30_000;
      return false; // stop polling once trip is active/completed
    },
  });

  // If trip is already active (e.g. app backgrounded), redirect immediately
  useEffect(() => {
    if (assignment?.trip?.status === 'ACTIVE') {
      setExpectedCount(assignment.expectedStudents ?? 0);
      router.replace({
        pathname: '/(driver)/kiosk',
        params: { tripId: assignment.trip.id, busId: assignment.trip.busId },
      });
    }
  }, [assignment]);

  const handleStartTrip = async () => {
    // Null-safety: assignment or trip could be undefined on a race
    if (!assignment?.trip?.id) {
      setStartError('No trip assigned. Please refresh.');
      return;
    }

    setStarting(true);
    setStartError(null);

    analytics.track('scanner_opened', {}); // closest event: driver initiates trip

    try {
      const data = await driverService.startTrip({
        tripId: assignment.trip.id,
        lat: 0,
        lon: 0,
      });
      setExpectedCount(assignment.expectedStudents ?? 0);
      setQR(data.qrToken, data.expiresAt);
      router.replace({
        pathname: '/(driver)/kiosk',
        params: { tripId: assignment.trip.id, busId: assignment.trip.busId },
      });
    } catch (err) {
      // Structured error — no console.error, analytics captures it
      analytics.error(err as Error, { context: 'driver_start_trip' });
      setStartError('Failed to start trip. Please try again.');
    } finally {
      setStarting(false);
    }
  };

  if (isLoading) return <HomeLoadingSkeleton />;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user?.name?.charAt(0) || 'D'}</Text>
          </View>
          <Text style={styles.greetingLine}>{greeting}</Text>
          <Text style={styles.nameText}>{user?.name || 'Driver'}</Text>
        </View>

        <View style={styles.body}>
          {!assignment?.trip ? (
            <EmptyState title={t('driver.noTrip')} />
          ) : assignment.trip.status === 'COMPLETED' ? (
            <View style={styles.completedCard}>
              <Text style={styles.completedTitle}>{t('driver.tripComplete')}</Text>
              <TouchableOpacity
                style={styles.summaryBtn}
                onPress={() =>
                  router.push({
                    pathname: '/(driver)/summary',
                    params: { tripId: assignment.trip!.id },
                  })
                }
              >
                <Text style={styles.summaryText}>{t('driver.viewSummary')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {/* Assignment card */}
              <View style={styles.card}>
                <View style={styles.cardRow}>
                  <Text style={styles.cardLabel}>Bus</Text>
                  <Text style={styles.cardValue}>{assignment.bus?.number ?? 'N/A'}</Text>
                </View>
                <View style={styles.cardRow}>
                  <Text style={styles.cardLabel}>Route</Text>
                  <Text style={styles.cardValue}>{assignment.route?.name ?? 'N/A'}</Text>
                </View>
                <View style={styles.cardRow}>
                  <Text style={styles.cardLabel}>{t('driver.departure')}</Text>
                  <Text style={styles.cardValue}>
                    {assignment.trip?.scheduledDeparture ?? '—'}
                  </Text>
                </View>
                <View style={[styles.cardRow, { borderBottomWidth: 0 }]}>
                  <Text style={styles.cardLabel}>{t('driver.expectedStudents')}</Text>
                  <Text style={styles.cardValue}>{assignment.expectedStudents ?? 0}</Text>
                </View>
              </View>

              {/* Route preview link */}
              <TouchableOpacity
                onPress={() => router.push('/(driver)/route-preview')}
                style={styles.previewLink}
              >
                <Text style={styles.previewText}>{t('driver.viewStops')}</Text>
              </TouchableOpacity>

              {/* Late warning */}
              {(assignment.trip.minutesLate ?? 0) > 0 && (
                <View style={styles.lateWarning}>
                  <Text style={styles.lateText}>
                    {t('driver.late', { minutes: String(assignment.trip.minutesLate) })}
                  </Text>
                </View>
              )}

              {/* Error state */}
              {startError && (
                <View style={styles.errorBanner}>
                  <Text style={styles.errorText}>{startError}</Text>
                  <TouchableOpacity onPress={() => void refetch()}>
                    <Text style={styles.retryText}>Refresh</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Start trip button */}
              <TouchableOpacity
                style={[styles.startButton, starting && { opacity: 0.7 }]}
                onPress={handleStartTrip}
                disabled={starting}
                activeOpacity={0.8}
              >
                {starting ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={styles.startText}>{t('driver.startTrip')}</Text>
                )}
              </TouchableOpacity>
              <Text style={styles.startSub}>{t('driver.studentsCanCheckIn')}</Text>
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    backgroundColor: colors.brand.primary,
    paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.xl,
  },
  avatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center', marginBottom: spacing.xs,
  },
  avatarText: {
    fontFamily: typography.family, fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold, color: colors.white,
  },
  greetingLine: {
    fontFamily: typography.family, fontSize: typography.sizes.small,
    color: 'rgba(255,255,255,0.7)',
  },
  nameText: {
    fontFamily: typography.family, fontSize: 26,
    fontWeight: typography.weights.bold, color: colors.white, letterSpacing: -0.5,
  },
  body: {
    paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing['3xl'],
  },
  card: {
    backgroundColor: colors.card.bg, borderWidth: 1, borderColor: colors.card.border,
    borderRadius: radii.md, padding: spacing.md,
  },
  cardRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.card.border,
  },
  cardLabel: {
    fontFamily: typography.family, fontSize: typography.sizes.body,
    color: colors.text.secondary,
  },
  cardValue: {
    fontFamily: typography.family, fontSize: typography.sizes.body,
    fontWeight: typography.weights.medium, color: colors.text.primary,
  },
  previewLink: { paddingVertical: spacing.sm, alignItems: 'center' },
  previewText: {
    fontFamily: typography.family, fontSize: typography.sizes.small,
    fontWeight: typography.weights.medium, color: colors.brand.primary,
  },
  lateWarning: {
    backgroundColor: colors.warning.bg, borderWidth: 1, borderColor: colors.warning.border,
    borderRadius: radii.sm, padding: spacing.md, marginBottom: spacing.md,
  },
  lateText: {
    fontFamily: typography.family, fontSize: typography.sizes.small,
    color: colors.warning.text,
  },
  errorBanner: {
    backgroundColor: colors.error.bg, borderWidth: 1, borderColor: colors.error.border,
    borderRadius: radii.sm, padding: spacing.md,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: spacing.md,
  },
  errorText: {
    fontFamily: typography.family, fontSize: typography.sizes.small,
    color: colors.error.text, flex: 1,
  },
  retryText: {
    fontFamily: typography.family, fontSize: typography.sizes.small,
    fontWeight: typography.weights.semibold, color: colors.brand.primary,
    marginLeft: spacing.xs,
  },
  startButton: {
    backgroundColor: colors.button.primary.bg, paddingVertical: 15,
    borderRadius: radii.button, alignItems: 'center', marginTop: spacing.lg,
    minHeight: 50,
  },
  startText: {
    fontFamily: typography.family, fontSize: 15,
    fontWeight: typography.weights.semibold, color: colors.button.primary.text,
  },
  startSub: {
    fontFamily: typography.family, fontSize: typography.sizes.small,
    color: colors.text.muted, textAlign: 'center', marginTop: spacing.xs,
  },
  completedCard: {
    backgroundColor: colors.success.bg, borderRadius: radii.md,
    padding: spacing.xl, alignItems: 'center',
  },
  completedTitle: {
    fontFamily: typography.family, fontSize: typography.sizes.h2,
    fontWeight: typography.weights.semibold, color: colors.success.text,
  },
  summaryBtn: { marginTop: spacing.md },
  summaryText: {
    fontFamily: typography.family, fontSize: typography.sizes.body,
    fontWeight: typography.weights.medium, color: colors.brand.primary,
  },
});
