import React from 'react';
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { typography } from '../../constants/theme';
import { EmptyState } from '../../components/shared/EmptyState';
import { RouteStopsLoadingSkeleton } from '../../components/shared/LoadingState';
import { ScreenErrorState } from '../../components/shared/ScreenErrorState';
import { driverService } from '../../services/driver.service';

const C = {
  bg: '#BFE6FF',
  ink: '#1A1A1C',
  muted: '#565656',
  ghost: '#C9C9C9',
  sep: 'rgba(26, 26, 28, 0.07)',
  badge: '#356C8F',
  badgeText: '#FFFFFF',
  link: '#356C8F',
};

export default function RoutePreviewScreen() {
  const router = useRouter();
  // SESSION_STABLE: route stops stay stable for the active assignment and only refresh on assignment changes.
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['route-stops'],
    queryFn: () => driverService.getRouteStops(),
    networkMode: 'offlineFirst',
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: keepPreviousData,
  });

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7}>
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>Route Stops</Text>
      </View>

      {isLoading ? <RouteStopsLoadingSkeleton /> : null}

      {!isLoading && error ? (
        <ScreenErrorState
          title="Route preview unavailable"
          message={error instanceof Error ? error.message : 'Unable to load route stops.'}
          onRetry={() => void refetch()}
        />
      ) : null}

      {!isLoading && !error && (!data || data.length === 0) ? (
        <EmptyState
          title="No stops available"
          subtitle="This trip does not have any active route stops assigned yet."
        />
      ) : null}

      {!isLoading && !error && data && data.length > 0 ? (
        <FlashList
          data={data}
          estimatedItemSize={64}
          keyExtractor={(item) => item.id}
          removeClippedSubviews={data.length > 20}
          contentContainerStyle={{ paddingHorizontal: 28, paddingTop: 16, paddingBottom: 40 }}
          renderItem={({ item, index }) => (
            <View style={s.row}>
              <View style={s.badgeCol}>
                <View style={s.badge}>
                  <Text style={s.badgeText}>{index + 1}</Text>
                </View>
                {index < data.length - 1 && <View style={s.connector} />}
              </View>
              <View style={s.rowBody}>
                <Text style={s.stopName}>{item.name}</Text>
                <Text style={s.stopMeta}>{item.studentCount} students</Text>
              </View>
            </View>
          )}
        />
      ) : null}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  header: {
    paddingHorizontal: 28,
    paddingTop: 20,
    paddingBottom: 16,
    gap: 10,
  },
  back: {
    fontFamily: typography.family,
    fontSize: 15,
    fontWeight: '500',
    color: C.link,
  },
  title: {
    fontFamily: typography.family,
    fontSize: 26,
    fontWeight: '700',
    color: C.ink,
    letterSpacing: -0.5,
  },

  // Timeline row
  row: {
    flexDirection: 'row',
    paddingBottom: 0,
    minHeight: 64,
  },
  badgeCol: {
    alignItems: 'center',
    width: 36,
    marginRight: 14,
  },
  badge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: C.badge,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    fontFamily: typography.family,
    fontSize: 12,
    fontWeight: '700',
    color: C.badgeText,
  },
  connector: {
    flex: 1,
    width: 1,
    backgroundColor: C.sep,
    marginTop: 4,
    marginBottom: 4,
    minHeight: 24,
  },
  rowBody: {
    flex: 1,
    paddingBottom: 20,
    paddingTop: 4,
  },
  stopName: {
    fontFamily: typography.family,
    fontSize: 15,
    fontWeight: '500',
    color: C.ink,
  },
  stopMeta: {
    fontFamily: typography.family,
    fontSize: 12,
    color: C.muted,
    marginTop: 2,
  },
});
