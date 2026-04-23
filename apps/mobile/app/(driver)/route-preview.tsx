import React from 'react';
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { colors, spacing, typography } from '../../constants/theme';
import { EmptyState } from '../../components/shared/EmptyState';
import { RouteStopsLoadingSkeleton } from '../../components/shared/LoadingState';
import { ScreenErrorState } from '../../components/shared/ScreenErrorState';
import { driverService } from '../../services/driver.service';

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
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.back}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Route Stops</Text>
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
          contentContainerStyle={{ padding: spacing.xl }}
          renderItem={({ item, index }) => (
            <View style={styles.row}>
              <View style={styles.orderBadge}>
                <Text style={styles.orderText}>{index + 1}</Text>
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.stopName}>{item.name}</Text>
                <Text style={styles.stopStudents}>{item.studentCount} students</Text>
              </View>
            </View>
          )}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  back: {
    fontFamily: typography.family,
    fontSize: typography.sizes.body,
    color: colors.brand.primary,
    marginBottom: spacing.md,
  },
  title: {
    fontFamily: typography.family,
    fontSize: typography.sizes.h1,
    fontWeight: typography.weights.bold,
    color: colors.text.primary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.card.border,
  },
  rowBody: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  orderBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.brand.light,
    justifyContent: 'center',
    alignItems: 'center',
  },
  orderText: {
    fontFamily: typography.family,
    fontSize: typography.sizes.small,
    fontWeight: typography.weights.bold,
    color: colors.brand.primary,
  },
  stopName: {
    fontFamily: typography.family,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.medium,
    color: colors.text.primary,
  },
  stopStudents: {
    fontFamily: typography.family,
    fontSize: typography.sizes.micro,
    color: colors.text.muted,
    marginTop: 2,
  },
});
