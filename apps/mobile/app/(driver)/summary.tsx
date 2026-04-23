// app/(driver)/summary.tsx - Trip summary with boarding stats and absent list
// HARDENED v3:
//   - All hardcoded hex -> theme tokens (LAW 2)
//   - analytics.track / analytics.error added to endTrip mutation (LAW 6)
//   - ScreenErrorBoundary wrapping
import React, { useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation } from '@tanstack/react-query';
import { driverService } from '../../services/driver.service';
import { colors, typography, spacing, radii } from '../../constants/theme';
import { t } from '../../i18n';
import { useTrip } from '../../store/trip.store';
import { analytics } from '../../lib/analytics';
import { ScreenErrorBoundary } from '../../components/shared/ScreenErrorBoundary';
import { ScreenErrorState } from '../../components/shared/ScreenErrorState';
import { SkeletonBlock } from '../../components/shared/LoadingState';

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
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('summary.title')}</Text>
        </View>
        <View style={styles.loadingContainer}>
          <View style={styles.loadingStatsGrid}>
            {[0, 1, 2].map((index) => (
              <View key={index} style={styles.loadingCard}>
                <SkeletonBlock width={48} height={28} />
                <SkeletonBlock width={72} height={12} style={{ marginTop: spacing.xs }} />
              </View>
            ))}
          </View>
          <View style={styles.loadingTimesRow}>
            {[0, 1, 2, 3].map((index) => (
              <View key={index} style={styles.loadingTimeItem}>
                <SkeletonBlock width={52} height={10} />
                <SkeletonBlock width={64} height={16} style={{ marginTop: spacing.xs }} />
              </View>
            ))}
          </View>
          <ActivityIndicator size="large" color={colors.brand.primary} style={{ marginTop: spacing.xl }} />
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    const message = error instanceof Error ? error.message : 'Unable to load trip summary.';
    return (
      <ScreenErrorState
        title="Trip summary unavailable"
        message={message}
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('summary.title')}</Text>
      </View>

      <View style={styles.statsGrid}>
        <View style={[styles.statCard, { backgroundColor: colors.success.bg }]}>
          <Text style={[styles.statNumber, { color: colors.success.text }]}>{boarded}</Text>
          <Text style={styles.statLabel}>{t('summary.boarded')}</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: colors.error.bg }]}>
          <Text style={[styles.statNumber, { color: colors.error.text }]}>{expected - boarded}</Text>
          <Text style={styles.statLabel}>{t('summary.absent')}</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: colors.neutral.bg }]}>
          <Text style={[styles.statNumber, { color: colors.text.primary }]}>{expected}</Text>
          <Text style={styles.statLabel}>{t('summary.expected')}</Text>
        </View>
      </View>

      {data && (
        <View style={styles.timesRow}>
          <View style={styles.timeItem}>
            <Text style={styles.timeLabel}>Date</Text>
            <Text style={styles.timeValue}>{data.date}</Text>
          </View>
          <View style={styles.timeItem}>
            <Text style={styles.timeLabel}>{t('summary.started')}</Text>
            <Text style={styles.timeValue}>{data.startedAt || '--'}</Text>
          </View>
          <View style={styles.timeItem}>
            <Text style={styles.timeLabel}>{t('summary.arrived')}</Text>
            <Text style={styles.timeValue}>{data.arrivedAt || '--'}</Text>
          </View>
          <View style={styles.timeItem}>
            <Text style={styles.timeLabel}>{t('summary.duration')}</Text>
            <Text style={styles.timeValue}>{data.duration || '--'}</Text>
          </View>
        </View>
      )}

      {absent.length > 0 && (
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>{t('summary.absentStudents')}</Text>
          <FlashList
            data={absent}
            estimatedItemSize={60}
            keyExtractor={(item: AbsentStudent) => item.id}
            removeClippedSubviews={absent.length > 20}
            contentContainerStyle={{ paddingHorizontal: spacing.xl }}
            renderItem={({ item }: { item: AbsentStudent }) => (
              <View style={styles.absentRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.studentName}>{item.name}</Text>
                  <Text style={styles.studentRoll}>{item.rollNumber}</Text>
                </View>
                <Text style={styles.absentReason}>{item.reason || t('summary.noCheckIn')}</Text>
              </View>
            )}
          />
        </View>
      )}

      <View style={styles.bottomActions}>
        <TouchableOpacity
          style={styles.endBtn}
          onPress={handleEndTrip}
          disabled={endTrip.isPending}
          activeOpacity={0.8}
        >
          <Text style={styles.endText}>{t('summary.endTrip')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    backgroundColor: colors.brand.primary,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.lg,
  },
  title: {
    fontFamily: typography.family, fontSize: typography.sizes.h1,
    fontWeight: typography.weights.bold, color: colors.white,
  },
  statsGrid: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: spacing.xl, paddingTop: spacing.lg, gap: spacing.xs,
  },
  loadingContainer: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
  },
  loadingStatsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  loadingCard: {
    flex: 1,
    borderRadius: radii.sm,
    backgroundColor: colors.card.bg,
    borderWidth: 1,
    borderColor: colors.card.border,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  loadingTimesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.card.border,
  },
  loadingTimeItem: {
    alignItems: 'center',
  },
  statCard: {
    flex: 1, borderRadius: radii.sm,
    paddingVertical: spacing.md, alignItems: 'center',
  },
  statNumber: {
    fontFamily: typography.family, fontSize: 24,
    fontWeight: typography.weights.bold,
  },
  statLabel: {
    fontFamily: typography.family, fontSize: 9,
    fontWeight: typography.weights.medium, color: colors.text.muted,
    marginTop: 2, textTransform: 'uppercase',
  },
  timesRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.card.border,
  },
  timeItem: { alignItems: 'center' },
  timeLabel: {
    fontFamily: typography.family, fontSize: typography.sizes.micro,
    color: colors.text.muted, textTransform: 'uppercase',
  },
  timeValue: {
    fontFamily: typography.family, fontSize: typography.sizes.body,
    fontWeight: typography.weights.medium, color: colors.text.primary,
    marginTop: 2,
  },
  sectionTitle: {
    fontFamily: typography.family, fontSize: typography.sizes.h3,
    fontWeight: typography.weights.semibold, color: colors.text.primary,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.sm,
  },
  absentRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: spacing.sm, borderBottomWidth: 1,
    borderBottomColor: colors.card.border,
  },
  studentName: {
    fontFamily: typography.family, fontSize: typography.sizes.body,
    fontWeight: typography.weights.medium, color: colors.text.primary,
  },
  studentRoll: {
    fontFamily: typography.family, fontSize: typography.sizes.micro,
    color: colors.text.muted, marginTop: 1,
  },
  absentReason: {
    fontFamily: typography.family, fontSize: typography.sizes.micro,
    color: colors.error.text,
  },
  bottomActions: {
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
  },
  endBtn: {
    backgroundColor: colors.error.text, paddingVertical: 15,
    borderRadius: radii.button, alignItems: 'center',
  },
  endText: {
    fontFamily: typography.family, fontSize: 15,
    fontWeight: typography.weights.semibold, color: colors.white,
  },
});
