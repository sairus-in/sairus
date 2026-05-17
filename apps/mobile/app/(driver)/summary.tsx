// app/(driver)/summary.tsx - Trip summary with boarding stats and absent list
import React, { useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation } from '@tanstack/react-query';
import { driverService } from '../../services/driver.service';
import { typography } from '../../constants/theme';
import { t } from '../../i18n';
import { useTrip } from '../../store/trip.store';
import { analytics } from '../../lib/analytics';
import { ScreenErrorBoundary } from '../../components/shared/ScreenErrorBoundary';
import { ScreenErrorState } from '../../components/shared/ScreenErrorState';
import { SkeletonBlock } from '../../components/shared/LoadingState';

// ── Local tokens ──────────────────────────────────────────────────
const C = {
  bg: '#BFE6FF',
  ink: '#1A1A1C',
  muted: '#565656',
  ghost: '#C9C9C9',
  surface: '#FFFFFF',
  card: '#356C8F',
  cardText: '#FFFFFF',
  cardMuted: 'rgba(255, 255, 255, 0.7)',
  cardSep: 'rgba(255, 255, 255, 0.15)',
  sep: 'rgba(26, 26, 28, 0.07)',
  btnBg: '#356C8F',
  btnText: '#FFFFFF',
  absentText: '#991B1B',
};

interface AbsentStudent {
  id: string;
  name: string;
  rollNumber: string;
  reason: string;
}

export default function SummaryScreen() {
  return (
    <ScreenErrorBoundary screenName="DriverTripSummary">
      <SummaryContent />
    </ScreenErrorBoundary>
  );
}

function SummaryContent() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tripId: string }>();
  const boardedCount = useTrip((s) => s.boardedCount);
  const expectedCount = useTrip((s) => s.expectedCount);
  const reset = useTrip((s) => s.reset);

  // SESSION_STABLE: trip summary changes only around trip completion and short post-trip reconciliation.
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['trip-summary', params.tripId],
    queryFn: () => driverService.getTripSummary(params.tripId!),
    networkMode: 'offlineFirst',
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });

  const endTrip = useMutation({
    mutationFn: () => {
      analytics.track('driver_end_trip_initiated', { tripId: params.tripId });
      return driverService.endTrip(params.tripId!);
    },
    onSuccess: () => {
      analytics.track('driver_end_trip_success', { tripId: params.tripId });
      reset();
      router.replace('/(driver)/');
    },
    onError: (err: any) => {
      analytics.error(err as Error, { context: 'endTrip_mutation', tripId: params.tripId });
      Alert.alert(t('common.error'), 'Could not end trip. ' + (err.message || ''));
    },
  });

  const handleEndTrip = () => {
    Alert.alert(
      t('summary.endTrip'),
      t('summary.endConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('summary.confirm'), style: 'destructive', onPress: () => endTrip.mutate() },
      ],
    );
  };

  const boarded = data?.boardedCount ?? boardedCount;
  const expected = data?.expectedCount ?? expectedCount;
  const absent = useMemo(() => data?.absentStudents ?? [], [data?.absentStudents]);

  if (isLoading) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.layout}>
          <View style={s.headingBlock}>
            <Text style={s.headingLabel}>Today's trip</Text>
            <Text style={s.headingTitle}>{t('summary.title')}</Text>
          </View>
          <View style={s.statsCard}>
            <SkeletonBlock width={80} height={40} />
            <SkeletonBlock width={140} height={14} style={{ marginTop: 8 }} />
          </View>
          <View style={s.timesBlock}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={s.timeRow}>
                <SkeletonBlock width={60} height={12} />
                <SkeletonBlock width={80} height={14} />
              </View>
            ))}
          </View>
          <ActivityIndicator size="small" color={C.btnBg} style={{ marginTop: 8 }} />
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <ScreenErrorState
        title="Trip summary unavailable"
        message={error instanceof Error ? error.message : 'Unable to load trip summary.'}
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <SafeAreaView style={s.container}>
      <FlashList
        data={absent}
        estimatedItemSize={60}
        keyExtractor={(item: AbsentStudent) => item.id}
        removeClippedSubviews={absent.length > 20}
        contentContainerStyle={{ paddingBottom: 40 }}
        ListHeaderComponent={
          <View style={s.layout}>

            {/* Heading */}
            <View style={s.headingBlock}>
              <Text style={s.headingLabel}>Today's trip</Text>
              <Text style={s.headingTitle}>{t('summary.title')}</Text>
            </View>

            {/* Stats card */}
            <View style={s.statsCard}>
              <Text style={s.boardedNumber}>{boarded}</Text>
              <Text style={s.boardedLabel}>{t('summary.boarded')} this trip</Text>
              <View style={s.statsMeta}>
                <Text style={s.statsMetaText}>
                  {expected} expected  ·  {expected - boarded} absent
                </Text>
              </View>
            </View>

            {/* Times */}
            {data && (
              <View style={s.timesBlock}>
                {[
                  { label: 'Date',                value: data.date || '—' },
                  { label: t('summary.started'),  value: data.startedAt || '—' },
                  { label: t('summary.arrived'),  value: data.arrivedAt || '—' },
                  { label: t('summary.duration'), value: data.duration || '—' },
                ].map(({ label, value }) => (
                  <View key={label} style={s.timeRow}>
                    <Text style={s.timeLabel}>{label}</Text>
                    <Text style={s.timeValue}>{value}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Absent students header */}
            {absent.length > 0 && (
              <Text style={s.sectionTitle}>{t('summary.absentStudents')}</Text>
            )}
          </View>
        }
        ListFooterComponent={
          <View style={s.footer}>
            <TouchableOpacity
              style={[s.btn, endTrip.isPending && s.btnPending]}
              onPress={handleEndTrip}
              disabled={endTrip.isPending}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={t('summary.endTrip')}
              accessibilityState={{ busy: endTrip.isPending }}
            >
              {endTrip.isPending
                ? <ActivityIndicator color={C.btnText} />
                : <Text style={s.btnLabel}>{t('summary.endTrip')}</Text>
              }
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item, index }: { item: AbsentStudent; index: number }) => (
          <View style={[s.absentRow, index === 0 && s.absentRowFirst]}>
            <View style={{ flex: 1 }}>
              <Text style={s.studentName}>{item.name}</Text>
              <Text style={s.studentRoll}>{item.rollNumber}</Text>
            </View>
            <Text style={s.absentReason}>{item.reason || t('summary.noCheckIn')}</Text>
          </View>
        )}
      />
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
    gap: 20,
  },

  // Heading
  headingBlock: {
    gap: 4,
  },
  headingLabel: {
    fontFamily: typography.family,
    fontSize: 13,
    color: C.muted,
  },
  headingTitle: {
    fontFamily: typography.family,
    fontSize: 28,
    fontWeight: '700',
    color: C.ink,
    letterSpacing: -0.5,
  },

  // Stats — one dark card, editorial
  statsCard: {
    backgroundColor: C.card,
    borderRadius: 20,
    padding: 22,
    gap: 4,
  },
  boardedNumber: {
    fontFamily: typography.family,
    fontSize: 52,
    fontWeight: '300',
    color: C.cardText,
    letterSpacing: -3,
    lineHeight: 56,
  },
  boardedLabel: {
    fontFamily: typography.family,
    fontSize: 15,
    color: C.cardMuted,
  },
  statsMeta: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: C.cardSep,
  },
  statsMetaText: {
    fontFamily: typography.family,
    fontSize: 13,
    color: C.cardMuted,
  },

  // Times
  timesBlock: {
    backgroundColor: C.surface,
    borderRadius: 16,
    paddingVertical: 4,
    paddingHorizontal: 16,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(26, 26, 28, 0.06)',
  },
  timeLabel: {
    fontFamily: typography.family,
    fontSize: 14,
    color: C.muted,
  },
  timeValue: {
    fontFamily: typography.family,
    fontSize: 14,
    fontWeight: '500',
    color: C.ink,
  },

  // Section title
  sectionTitle: {
    fontFamily: typography.family,
    fontSize: 13,
    fontWeight: '600',
    color: C.muted,
    marginTop: 4,
    marginBottom: -4,
  },

  // Absent students
  absentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: C.sep,
  },
  absentRowFirst: {
    borderTopWidth: 0,
  },
  studentName: {
    fontFamily: typography.family,
    fontSize: 14,
    fontWeight: '500',
    color: C.ink,
  },
  studentRoll: {
    fontFamily: typography.family,
    fontSize: 12,
    color: C.ghost,
    marginTop: 1,
  },
  absentReason: {
    fontFamily: typography.family,
    fontSize: 12,
    color: C.absentText,
    textAlign: 'right',
    maxWidth: 100,
  },

  // Footer
  footer: {
    paddingHorizontal: 28,
    paddingTop: 24,
    paddingBottom: 8,
  },
  btn: {
    backgroundColor: C.btnBg,
    height: 54,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPending: {
    opacity: 0.6,
  },
  btnLabel: {
    fontFamily: typography.family,
    fontSize: 16,
    fontWeight: '600',
    color: C.btnText,
  },
});
