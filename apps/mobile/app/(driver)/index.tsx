// app/(driver)/index.tsx — Driver pre-trip home screen
import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { useQuery } from '@tanstack/react-query';
import { driverService } from '../../services/driver.service';
import { useAuth } from '../../store/auth.store';
import { useTrip } from '../../store/trip.store';
import { typography } from '../../constants/theme';
import { t } from '../../i18n';
import { EmptyState } from '../../components/shared/EmptyState';
import { HomeLoadingSkeleton } from '../../components/shared/LoadingState';
import { ScreenErrorBoundary } from '../../components/shared/ScreenErrorBoundary';
import { analytics } from '../../lib/analytics';

// ── Local tokens — warm palette ───────────────────────────────────
const C = {
  bg: '#BFE6FF',
  ink: '#1A1A1C',
  muted: '#565656',
  ghost: '#C9C9C9',
  card: '#356C8F',
  cardText: '#FFFFFF',
  cardMuted: 'rgba(255, 255, 255, 0.7)',
  cardSep: 'rgba(255, 255, 255, 0.15)',
  btnBg: '#356C8F',
  btnText: '#FFFFFF',
  link: '#356C8F',
  lateBg: '#FEF3C7',
  lateText: '#78350F',
  errorBg: '#FEE2E2',
  errorText: '#991B1B',
};

export default function DriverHome() {
  return (
    <ScreenErrorBoundary screenName="DriverHome">
      <DriverHomeContent />
    </ScreenErrorBoundary>
  );
}

function DriverHomeContent() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const user = useAuth((s) => s.user);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const setExpectedCount = useTrip((s) => s.setExpectedCount);
  const setQR = useTrip((s) => s.setQR);

  const hours = new Date().getHours();
  const greeting = hours < 12 ? t('driver.greeting') : 'Good afternoon';
  const firstName = user?.name?.split(' ')[0] || 'Driver';

  // SESSION_STABLE: the driver's daily assignment can change during the session, but not continuously.
  const { data: assignment, isLoading, refetch } = useQuery({
    queryKey: ['driver-assignment'],
    queryFn: driverService.getTodayAssignment,
    networkMode: 'offlineFirst',
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchInterval: (query: any) => {
      const status = query.state?.data?.trip?.status;
      if (status === 'SCHEDULED') return 30_000;
      return false;
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
    if (!assignment?.trip?.id) {
      setStartError('No trip assigned. Please refresh.');
      return;
    }
    setStarting(true);
    setStartError(null);
    analytics.track('scanner_opened', {});
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
      analytics.error(err as Error, { context: 'driver_start_trip' });
      setStartError('Failed to start trip. Please try again.');
    } finally {
      setStarting(false);
    }
  };

  if (isLoading) return <HomeLoadingSkeleton />;

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={s.layout}>

          {/* ── Identity ── */}
          <Animated.View
            entering={reduceMotion ? undefined : FadeInDown.duration(500).springify().damping(18)}
            style={s.identityBlock}
          >
            <Text style={s.greetingText}>{greeting}</Text>
            <Text style={s.nameText}>{firstName}</Text>
          </Animated.View>

          {/* ── Content ── */}
          {!assignment?.trip ? (
            <EmptyState title={t('driver.noTrip')} />
          ) : assignment.trip.status === 'COMPLETED' ? (
            <Animated.View
              entering={reduceMotion ? undefined : FadeInDown.duration(500).delay(100).springify().damping(18)}
              style={s.completedSection}
            >
              <Text style={s.completedTitle}>{t('driver.tripComplete')}</Text>
              <TouchableOpacity
                style={s.summaryLinkWrap}
                onPress={() => router.push({
                  pathname: '/(driver)/summary',
                  params: { tripId: assignment.trip!.id },
                })}
              >
                <Text style={s.summaryLink}>{t('driver.viewSummary')}</Text>
              </TouchableOpacity>
            </Animated.View>
          ) : (
            <>
              {/* ── Assignment card ── */}
              <Animated.View
                entering={reduceMotion ? undefined : FadeInDown.duration(500).delay(100).springify().damping(18)}
                style={s.assignmentCard}
              >
                <Text style={s.routeName}>{assignment.route?.name ?? '—'}</Text>
                {!!assignment.route?.area && (
                  <Text style={s.routeArea}>{assignment.route.area}</Text>
                )}
                <View style={s.metaRow}>
                  <Text style={s.metaText}>
                    {assignment.bus?.number ?? '—'}
                    {'  ·  '}
                    {assignment.trip?.scheduledDeparture ?? '—'}
                    {'  ·  '}
                    {assignment.expectedStudents ?? 0} students
                  </Text>
                </View>
              </Animated.View>

              {/* ── Route preview ── */}
              <TouchableOpacity
                style={s.previewLink}
                onPress={() => router.push('/(driver)/route-preview')}
                activeOpacity={0.7}
              >
                <Text style={s.previewText}>{t('driver.viewStops')} →</Text>
              </TouchableOpacity>

              {/* ── Late warning ── */}
              {(assignment.trip.minutesLate ?? 0) > 0 && (
                <Animated.View
                  entering={reduceMotion ? undefined : FadeInDown.duration(400).delay(150).springify().damping(18)}
                  style={s.lateWarning}
                >
                  <Text style={s.lateText}>
                    {t('driver.late', { minutes: String(assignment.trip.minutesLate) })}
                  </Text>
                </Animated.View>
              )}

              {/* ── Error ── */}
              {startError && (
                <View style={s.errorBanner}>
                  <Text style={s.errorText}>{startError}</Text>
                  <TouchableOpacity onPress={() => void refetch()}>
                    <Text style={s.retryText}>Refresh</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* ── Start trip ── */}
              <Animated.View
                entering={reduceMotion ? undefined : FadeInDown.duration(500).delay(200).springify().damping(18)}
                style={s.btnSection}
              >
                <TouchableOpacity
                  style={[s.btn, starting && s.btnStarting]}
                  onPress={handleStartTrip}
                  disabled={starting}
                  activeOpacity={0.85}
                  accessibilityLabel={starting ? 'Starting trip' : t('driver.startTrip')}
                  accessibilityRole="button"
                  accessibilityState={{ busy: starting }}
                >
                  {starting
                    ? <ActivityIndicator color={C.btnText} />
                    : <Text style={s.btnLabel}>{t('driver.startTrip')}</Text>
                  }
                </TouchableOpacity>
                <Text style={s.btnSub}>{t('driver.studentsCanCheckIn')}</Text>
              </Animated.View>
            </>
          )}

        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  layout: {
    paddingHorizontal: 28,
    paddingTop: 36,
    paddingBottom: 48,
    gap: 20,
  },

  // Identity
  identityBlock: {
    gap: 4,
  },
  greetingText: {
    fontFamily: typography.family,
    fontSize: 13,
    color: C.muted,
  },
  nameText: {
    fontFamily: typography.family,
    fontSize: 30,
    fontWeight: '700',
    color: C.ink,
    letterSpacing: -0.6,
  },

  // Assignment card
  assignmentCard: {
    backgroundColor: C.card,
    borderRadius: 20,
    padding: 22,
  },
  routeName: {
    fontFamily: typography.family,
    fontSize: 22,
    fontWeight: '700',
    color: C.cardText,
    letterSpacing: -0.4,
  },
  routeArea: {
    fontFamily: typography.family,
    fontSize: 14,
    color: C.cardMuted,
    marginTop: 3,
  },
  metaRow: {
    marginTop: 18,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: C.cardSep,
  },
  metaText: {
    fontFamily: typography.family,
    fontSize: 13,
    color: C.cardMuted,
    lineHeight: 20,
  },

  // Route preview link
  previewLink: {
    alignItems: 'center',
    paddingVertical: 2,
  },
  previewText: {
    fontFamily: typography.family,
    fontSize: 14,
    fontWeight: '500',
    color: C.link,
  },

  // Late warning — background tint, no border
  lateWarning: {
    backgroundColor: C.lateBg,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  lateText: {
    fontFamily: typography.family,
    fontSize: 13,
    color: C.lateText,
    textAlign: 'center',
  },

  // Error banner — background tint, no border
  errorBanner: {
    backgroundColor: C.errorBg,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  errorText: {
    fontFamily: typography.family,
    fontSize: 13,
    color: C.errorText,
    flex: 1,
  },
  retryText: {
    fontFamily: typography.family,
    fontSize: 13,
    fontWeight: '600',
    color: C.link,
    marginLeft: 8,
  },

  // Start trip
  btnSection: {
    gap: 10,
  },
  btn: {
    backgroundColor: C.btnBg,
    height: 54,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnStarting: {
    opacity: 0.6,
  },
  btnLabel: {
    fontFamily: typography.family,
    fontSize: 16,
    fontWeight: '600',
    color: C.btnText,
  },
  btnSub: {
    fontFamily: typography.family,
    fontSize: 13,
    color: C.muted,
    textAlign: 'center',
  },

  // Completed state
  completedSection: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 40,
  },
  completedTitle: {
    fontFamily: typography.family,
    fontSize: 20,
    fontWeight: '600',
    color: C.ink,
  },
  summaryLinkWrap: {
    paddingVertical: 6,
  },
  summaryLink: {
    fontFamily: typography.family,
    fontSize: 15,
    fontWeight: '500',
    color: C.link,
  },
});
