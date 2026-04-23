// components/shared/LoadingState.tsx — Skeleton shimmer placeholders
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, ViewStyle } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { colors, radii, spacing } from '../../constants/theme';

interface SkeletonProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

function SkeletonBlock({ width = '100%', height = 16, borderRadius = 8, style }: SkeletonProps) {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 800, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, []);

  return (
    <Animated.View
      style={[
        { width: width as any, height, borderRadius, backgroundColor: colors.neutral.bg, opacity },
        style,
      ]}
    />
  );
}

/**
 * Loading skeleton for the Student Home screen.
 */
export function HomeLoadingSkeleton() {
  return (
    <View style={styles.container}>
      {/* Header skeleton */}
      <View style={styles.header}>
        <SkeletonBlock width={36} height={36} borderRadius={18} />
        <View style={{ marginLeft: spacing.sm, flex: 1 }}>
          <SkeletonBlock width={120} height={12} />
          <SkeletonBlock width={80} height={20} style={{ marginTop: spacing.micro }} />
        </View>
      </View>

      {/* Bus status card skeleton */}
      <View style={styles.card}>
        <SkeletonBlock width={160} height={16} />
        <SkeletonBlock width={'100%'} height={80} borderRadius={radii.sm} style={{ marginTop: spacing.sm }} />
        <SkeletonBlock width={200} height={12} style={{ marginTop: spacing.xs }} />
      </View>

      {/* Button skeleton */}
      <SkeletonBlock width={'100%'} height={50} borderRadius={radii.button} style={{ marginTop: spacing.md }} />

      {/* Stat cards */}
      <View style={styles.statsRow}>
        <SkeletonBlock width={'31%'} height={70} borderRadius={radii.sm} />
        <SkeletonBlock width={'31%'} height={70} borderRadius={radii.sm} />
        <SkeletonBlock width={'31%'} height={70} borderRadius={radii.sm} />
      </View>
    </View>
  );
}

/**
 * Generic loading skeleton for list screens.
 */
export function ListLoadingSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <View style={styles.container}>
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={styles.listRow}>
          <SkeletonBlock width={'60%'} height={14} />
          <SkeletonBlock width={'30%'} height={12} style={{ marginTop: spacing.micro }} />
        </View>
      ))}
    </View>
  );
}

export function RouteStopsLoadingSkeleton() {
  const rows = Array.from({ length: 8 }, (_, index) => index);

  return (
    <FlashList
      data={rows}
      estimatedItemSize={64}
      keyExtractor={(item) => String(item)}
      contentContainerStyle={styles.routeStopsSkeletonContent}
      renderItem={() => (
        <View style={styles.routeStopRow}>
          <SkeletonBlock width={28} height={28} borderRadius={14} />
          <View style={styles.routeStopBody}>
            <SkeletonBlock width="55%" height={16} />
            <SkeletonBlock width="30%" height={12} style={{ marginTop: spacing.micro }} />
          </View>
        </View>
      )}
    />
  );
}

export function AttendanceHistoryLoadingSkeleton() {
  const rows = Array.from({ length: 8 }, (_, index) => index);

  return (
    <FlashList
      data={rows}
      estimatedItemSize={84}
      keyExtractor={(item) => String(item)}
      contentContainerStyle={styles.attendanceSkeletonContent}
      renderItem={() => (
        <View style={styles.attendanceRow}>
          <View style={styles.attendanceBody}>
            <SkeletonBlock width="35%" height={14} />
            <SkeletonBlock width="55%" height={12} style={{ marginTop: spacing.micro }} />
            <SkeletonBlock width="28%" height={12} style={{ marginTop: spacing.xs }} />
          </View>
          <SkeletonBlock width={72} height={24} borderRadius={radii.pill} />
        </View>
      )}
    />
  );
}

export { SkeletonBlock };

const styles = StyleSheet.create({
  container: {
    padding: spacing.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  card: {
    backgroundColor: colors.card.bg,
    borderWidth: 1,
    borderColor: colors.card.border,
    borderRadius: radii.lg,
    padding: spacing.md,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  listRow: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.card.border,
  },
  routeStopsSkeletonContent: {
    padding: spacing.xl,
  },
  routeStopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 64,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.card.border,
  },
  routeStopBody: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  attendanceSkeletonContent: {
    paddingHorizontal: spacing.xl,
  },
  attendanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 84,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.card.border,
  },
  attendanceBody: {
    flex: 1,
  },
});
