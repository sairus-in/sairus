import React, { useMemo, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Dimensions } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Svg, { Path, Circle } from 'react-native-svg';

import { studentService } from '../../services/student.service';
import { typography, spacingExtended, colors } from '../../constants/theme';
import { AttendanceHistoryLoadingSkeleton } from '../../components/shared/LoadingState';
import { ScreenErrorBoundary } from '../../components/shared/ScreenErrorBoundary';
import { ScreenErrorState } from '../../components/shared/ScreenErrorState';
import type { AttendanceHistoryResponseV3 } from '../../lib/schemas';

const { width } = Dimensions.get('window');

type AttendanceRecord = AttendanceHistoryResponseV3['data'][number];
type FilterType = 'ALL' | 'PRESENT' | 'ABSENT';

// ── Design Tokens ──
const ds = {
  bg: '#BFE6FF',
  cardBg: '#FFFFFF',
  textInk: '#1A1A1C',
  textMuted: '#565656',
  textGhost: '#C9C9C9',
  primary: '#356C8F',
  successBg: '#E8F5E9',
  successText: '#2E7D32',
  dangerBg: '#FCE4EC',
  dangerText: '#C62828',
  warningBg: '#FFF3E0',
  warningText: '#E65100',
  border: '#E9E9E9',
  graphEmpty: '#F3EFE6',
  graphGreen: '#4CAF50',
  graphAmber: '#FFA000',
  graphRed: '#E53935',
  link: '#356C8F',
};

// ── Icons ──
const FilterIcon = ({ color = ds.primary }) => (
  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
    <Path d="M4 6h16M7 12h10M10 18h4" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const ChevronRight = () => (
  <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
    <Path d="M9 18l6-6-6-6" stroke={ds.textGhost} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

import { useStudentHome } from '../../hooks/useStudentHome';

// ── Attendance Visualization ──
// Since backend provides only aggregate counts, we show a meaningful
// attendance rate visualization instead of a daily contribution graph
function AttendanceVisualization({ percentage }: { percentage: number }) {
  // Create a simple visual representation of attendance
  const filledBars = Math.round((percentage / 100) * 10);
  const bars = Array.from({ length: 10 }, (_, i) => i < filledBars);

  return (
    <View style={s.visualContainer}>
      <View style={s.barsRow}>
        {bars.map((filled, index) => (
          <View
            key={index}
            style={[
              s.bar,
              filled ? s.barFilled : s.barEmpty,
            ]}
          />
        ))}
      </View>
      <Text style={s.visualLabel}>
        {percentage}% attendance rate
      </Text>
    </View>
  );
}

function HistorySummaryCards() {
  const { data } = useStudentHome();
  const history = data?.transport.history;

  if (!history) return null;

  return (
    <>
      <Animated.View entering={FadeInDown.duration(400)} style={s.graphCard}>
        <View style={s.graphHeader}>
          <Text style={s.graphTitle}>ATTENDANCE OVERVIEW</Text>
          <Text style={s.graphMeta}>
            {history.presentCount} present · {history.absentCount} absent
          </Text>
        </View>
        <AttendanceVisualization percentage={history.percentage} />
        <View style={s.legendRow}>
          <View style={s.legendItem}>
            <View style={[s.legendDot, { backgroundColor: colors.success.text }]} />
            <Text style={s.legendText}>Present</Text>
          </View>
          <View style={s.legendItem}>
            <View style={[s.legendDot, { backgroundColor: colors.error.text }]} />
            <Text style={s.legendText}>Absent</Text>
          </View>
        </View>
      </Animated.View>

      <Animated.View entering={FadeInDown.duration(400).delay(100)} style={s.monthCard}>
        <Text style={s.monthTitle}>CURRENT SUMMARY</Text>
        <View style={s.monthStatsRow}>
          <View style={s.monthStat}>
            <Text style={s.monthStatBig}>{history.percentage}%</Text>
            <Text style={s.monthStatLabel}>Attendance</Text>
          </View>
          <View style={s.monthStat}>
            <Text style={s.monthStatBig}>{history.absentCount}</Text>
            <Text style={s.monthStatLabel}>Absences</Text>
          </View>
          <View style={s.monthStat}>
            <Text style={s.monthStatBig}>{history.pendingCorrections}</Text>
            <Text style={s.monthStatLabel}>Pending</Text>
          </View>
        </View>
      </Animated.View>
    </>
  );
}

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

  // Real data integration
  const apiFilter = filter === 'ALL' ? undefined : (filter === 'PRESENT' ? 'ALL' : 'ABSENT'); // Adapt filter types safely

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
        filter: apiFilter as any,
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

  // Render List Item
  const renderItem = useCallback(({ item }: { item: AttendanceRecord }) => {
    const isAbsent = item.status === 'ABSENT';
    const isLate = item.status === 'LATE_BOARD';

    let pillBg = ds.successBg;
    let pillText = ds.successText;
    let label = 'ON TIME';

    if (isAbsent) {
      pillBg = ds.dangerBg;
      pillText = ds.dangerText;
      label = 'MISSED';
    } else if (isLate) {
      pillBg = ds.warningBg;
      pillText = ds.warningText;
      label = 'LATE';
    } else if (item.status === 'PENDING') {
      pillBg = '#F5F5F5';
      pillText = '#9E9E9E';
      label = 'PENDING';
    }

    // Format Date (Assume "2026-01-14")
    const d = new Date(item.date);
    const day = isNaN(d.getDate()) ? '--' : d.getDate().toString();
    const month = isNaN(d.getMonth()) ? '---' : d.toLocaleString('en-US', { month: 'short' }).toUpperCase();

    return (
      <View style={s.listItem}>
        <View style={s.dateBox}>
          <Text style={s.dateDay}>{day}</Text>
          <Text style={s.dateMonth}>{month}</Text>
        </View>
        <View style={s.itemContent}>
          <View style={[s.pill, { backgroundColor: pillBg }]}>
            <View style={[s.pillDot, { backgroundColor: pillText }]} />
            <Text style={[s.pillLabel, { color: pillText }]}>{label}</Text>
          </View>
          {isAbsent ? (
            <TouchableOpacity onPress={() => router.push(`/(student)/correction/${item.id}` as any)} activeOpacity={0.7}>
              <Text style={s.correctionText}>Request correction</Text>
            </TouchableOpacity>
          ) : (
            <Text style={s.subText}>
              {item.busNumber ? `TN-01 · Bus ${item.busNumber}` : 'Recorded'}
            </Text>
          )}
        </View>
        <ChevronRight />
      </View>
    );
  }, [router]);

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.headerTitle}>Attendance</Text>
        <TouchableOpacity style={s.filterBtn} activeOpacity={0.8}>
          <FilterIcon />
        </TouchableOpacity>
      </View>

      <FlashList
        ListHeaderComponent={
          <View style={s.listHeaderContainer}>
            <HistorySummaryCards />

            {/* Tabs */}
            <View style={s.tabsWrap}>
              <View style={s.tabsContainer}>
                {['All', 'Present', 'Absent'].map((tab) => {
                  const val = tab.toUpperCase() as FilterType;
                  return (
                    <TouchableOpacity
                      key={tab}
                      style={[s.tab, filter === val && s.activeTab]}
                      onPress={() => setFilter(val)}
                      activeOpacity={0.8}
                    >
                      <Text style={[s.tabText, filter === val && s.activeTabText]}>{tab}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </View>
        }
        data={records}
        estimatedItemSize={84}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={s.list}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.5}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          isLoading ? <AttendanceHistoryLoadingSkeleton /> :
          error ? (
            <ScreenErrorState
              title="History unavailable"
              message={error instanceof Error ? error.message : 'Unable to load attendance history.'}
              onRetry={() => void refetch()}
            />
          ) : (
            <View style={s.emptyWrap}>
              <Text style={s.emptyText}>No attendance records found.</Text>
            </View>
          )
        }
        ListFooterComponent={
          isFetchingNextPage
            ? <ActivityIndicator style={{ padding: 20 }} color={ds.primary} />
            : <View style={{ height: 40 }} />
        }
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: ds.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacingExtended.screen,
    paddingVertical: 16,
  },
  headerTitle: {
    fontFamily: typography.family,
    fontSize: 28,
    fontWeight: typography.weights.bold,
    color: ds.textInk,
  },
  filterBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: ds.cardBg,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },

  listHeaderContainer: {
    paddingBottom: 16,
  },
  list: {
    paddingHorizontal: spacingExtended.screen,
    paddingBottom: 40,
  },

  // Graph Card
  graphCard: {
    backgroundColor: ds.cardBg,
    borderRadius: 28,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  graphHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  graphTitle: {
    fontFamily: typography.family,
    fontSize: 10,
    fontWeight: typography.weights.bold,
    color: ds.textMuted,
    letterSpacing: 1.2,
  },
  graphMeta: {
    fontFamily: typography.family,
    fontSize: 11,
    fontWeight: typography.weights.bold,
    color: ds.textMuted,
  },
  visualContainer: {
    marginBottom: 16,
  },
  barsRow: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 8,
  },
  bar: {
    flex: 1,
    height: 12,
    borderRadius: 6,
  },
  barFilled: {
    backgroundColor: colors.success.text,
  },
  barEmpty: {
    backgroundColor: ds.graphEmpty,
  },
  visualLabel: {
    fontFamily: typography.family,
    fontSize: 12,
    fontWeight: typography.weights.medium,
    color: ds.textInk,
  },
  legendRow: {
    flexDirection: 'row',
    gap: 16,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 2,
  },
  legendText: {
    fontFamily: typography.family,
    fontSize: 11,
    fontWeight: typography.weights.medium,
    color: ds.textMuted,
  },

  // Month Card
  monthCard: {
    backgroundColor: ds.primary,
    borderRadius: 28,
    padding: 24,
    marginBottom: 24,
  },
  monthTitle: {
    fontFamily: typography.family,
    fontSize: 10,
    fontWeight: typography.weights.bold,
    color: 'rgba(255,255,255,0.6)',
    letterSpacing: 1.2,
    marginBottom: 16,
  },
  monthStatsRow: {
    flexDirection: 'row',
    gap: 32,
  },
  monthStat: {
    alignItems: 'flex-start',
  },
  monthStatBig: {
    fontFamily: typography.family,
    fontSize: 28,
    fontWeight: typography.weights.bold,
    color: '#FFFFFF',
    marginBottom: 2,
  },
  monthStatLabel: {
    fontFamily: typography.family,
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
  },

  // Tabs
  tabsWrap: {
    alignItems: 'center',
    marginBottom: 16,
  },
  tabsContainer: {
    flexDirection: 'row',
    backgroundColor: '#F3EFE6',
    borderRadius: 24,
    padding: 4,
  },
  tab: {
    paddingHorizontal: spacingExtended.screen,
    paddingVertical: 8,
    borderRadius: 20,
  },
  activeTab: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  tabText: {
    fontFamily: typography.family,
    fontSize: 13,
    fontWeight: typography.weights.medium,
    color: ds.textMuted,
  },
  activeTabText: {
    color: ds.textInk,
    fontWeight: typography.weights.bold,
  },

  // List Items
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: ds.cardBg,
    borderRadius: 24,
    padding: 16,
    marginBottom: 12,
  },
  dateBox: {
    backgroundColor: ds.bg,
    borderRadius: 16,
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  dateDay: {
    fontFamily: typography.family,
    fontSize: 15,
    fontWeight: typography.weights.bold,
    color: ds.textInk,
  },
  dateMonth: {
    fontFamily: typography.family,
    fontSize: 10,
    fontWeight: typography.weights.bold,
    color: ds.textMuted,
  },
  itemContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 4,
  },
  pillDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginRight: 6,
  },
  pillLabel: {
    fontFamily: typography.family,
    fontSize: 10,
    fontWeight: typography.weights.bold,
    letterSpacing: 0.5,
  },
  subText: {
    fontFamily: typography.family,
    fontSize: 13,
    color: ds.textMuted,
    marginLeft: 2,
  },
  correctionText: {
    fontFamily: typography.family,
    fontSize: 13,
    fontWeight: typography.weights.bold,
    color: ds.link,
    marginLeft: 2,
  },

  emptyWrap: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: typography.family,
    fontSize: 14,
    color: ds.textMuted,
  },
});
