import React, { useMemo, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { studentService } from '../../services/student.service';
import { colors, typography, spacing, radii, statusPill } from '../../constants/theme';
import { t } from '../../i18n';
import { AttendanceHistoryLoadingSkeleton } from '../../components/shared/LoadingState';
import { EmptyState } from '../../components/shared/EmptyState';
import { ScreenErrorBoundary } from '../../components/shared/ScreenErrorBoundary';
import { ScreenErrorState } from '../../components/shared/ScreenErrorState';
import type { AttendanceHistoryResponseV3 } from '../../lib/schemas';

type AttendanceRecord = AttendanceHistoryResponseV3['data'][number];
type FilterType = 'ALL' | 'ABSENT' | 'CORRECTIONS';

export default function HistoryScreen() {
  return (
    <ScreenErrorBoundary screenName="StudentHistory">
      <HistoryContent />
    </ScreenErrorBoundary>
  );
}

function HistoryContent() {
  const router = useRouter();
  const [filter, setFilter] = useState<FilterType>('ALL');

  // USER_DATA: attendance history is user-scoped and should stay warm briefly without pretending to be static.
  const {
    data,
    isLoading,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['attendance-history', filter],
    queryFn: async ({ pageParam = 1 }) => {
      return studentService.getHistory({
        page: pageParam as number,
        limit: 20,
        filter: filter === 'ALL' ? undefined : filter,
      });
    },
    getNextPageParam: (lastPage: AttendanceHistoryResponseV3) => (
      lastPage.pagination.hasMore ? lastPage.pagination.page + 1 : undefined
    ),
    initialPageParam: 1,
    networkMode: 'offlineFirst',
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  });

  const records = useMemo<AttendanceRecord[]>(
    () => data?.pages.flatMap((page) => page.data) ?? [],
    [data],
  );

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const renderItem = useCallback(({ item }: { item: AttendanceRecord }) => {
    const isAbsent = item.status === 'ABSENT';
    const pill = statusPill[item.status as keyof typeof statusPill] || statusPill.NOT_STARTED;

    return (
      <View style={[styles.row, isAbsent && styles.absentRow]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowDate}>{item.date}</Text>
          <Text style={styles.rowMeta}>
            Bus {item.busNumber || '-'} {item.checkedInAt ? `- ${item.checkedInAt}` : ''}
          </Text>
          {isAbsent && (
            <TouchableOpacity
              onPress={() => router.push(`/(student)/correction/${item.id}` as any)}
            >
              <Text style={styles.correctionLink}>{t('history.correction')}</Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={[styles.statusPill, { backgroundColor: pill.bg }]}>
          <Text style={[styles.statusText, { color: pill.text }]}>
            {item.status === 'LATE_BOARD' ? 'Late board' : item.status}
          </Text>
        </View>
      </View>
    );
  }, [router]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('history.title')}</Text>
      </View>

      <View style={styles.filterRow}>
        {(['ALL', 'ABSENT', 'CORRECTIONS'] as FilterType[]).map((value) => (
          <TouchableOpacity
            key={value}
            style={[styles.filterPill, filter === value && styles.filterActive]}
            onPress={() => setFilter(value)}
          >
            <Text style={[styles.filterText, filter === value && styles.filterTextActive]}>
              {t(`history.${value === 'ALL' ? 'all' : value === 'ABSENT' ? 'absentOnly' : 'corrections'}`)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {isLoading ? (
        <AttendanceHistoryLoadingSkeleton />
      ) : error ? (
        <ScreenErrorState
          title="History unavailable"
          message={error instanceof Error ? error.message : 'Unable to load attendance history.'}
          onRetry={() => void refetch()}
        />
      ) : records.length === 0 ? (
        <EmptyState title={t('history.noRecords')} />
      ) : (
        <FlashList
          key={filter}
          data={records}
          estimatedItemSize={84}
          renderItem={renderItem}
          getItemType={(item) => (item.status === 'ABSENT' ? 'absent' : 'default')}
          keyExtractor={(item) => item.id}
          removeClippedSubviews={records.length > 20}
          contentContainerStyle={styles.list}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            isFetchingNextPage
              ? <ActivityIndicator style={{ padding: 20 }} color={colors.brand.primary} />
              : null
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    backgroundColor: colors.brand.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  title: {
    fontFamily: typography.family,
    fontSize: typography.sizes.h1,
    fontWeight: typography.weights.bold,
    color: colors.white,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  filterPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.neutral.bg,
  },
  filterActive: { backgroundColor: colors.brand.primary },
  filterText: {
    fontFamily: typography.family,
    fontSize: typography.sizes.small,
    fontWeight: typography.weights.medium,
    color: colors.text.secondary,
  },
  filterTextActive: { color: colors.white },
  list: { paddingHorizontal: spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.card.border,
  },
  absentRow: {
    borderLeftWidth: 3,
    borderLeftColor: colors.error.text,
    paddingLeft: spacing.sm,
  },
  rowDate: {
    fontFamily: typography.family,
    fontSize: typography.sizes.small,
    fontWeight: typography.weights.medium,
    color: colors.text.primary,
  },
  rowMeta: {
    fontFamily: typography.family,
    fontSize: typography.sizes.micro,
    color: colors.text.muted,
    marginTop: 2,
  },
  correctionLink: {
    fontFamily: typography.family,
    fontSize: typography.sizes.small,
    fontWeight: typography.weights.medium,
    color: colors.brand.primary,
    marginTop: spacing.micro,
  },
  statusPill: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 3,
    borderRadius: radii.pill,
  },
  statusText: {
    fontFamily: typography.family,
    fontSize: typography.sizes.micro,
    fontWeight: typography.weights.semibold,
  },
});
