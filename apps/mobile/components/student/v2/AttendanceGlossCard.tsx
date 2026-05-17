import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { brand, space } from '../../../constants/brand';
import { type } from '../../../constants/typography';
import { GlossCard } from '../../v2/GlossCard';
import { GradientText } from '../../v2/GradientText';

interface AttendanceGlossCardProps {
  name: string;
  /** Section / roll code, e.g. "SEC25IT291" */
  sectionCode: string;
  /** Attendance percentage 0-100. null while loading. */
  attendancePercent: number | null;
  /** Leave days remaining. null if backend hasn't shipped the field yet. */
  leaveRemaining: number | null;
  /** OD days left. null if backend hasn't shipped the field yet. */
  odLeft: number | null;
  /** Layout width; the gloss SVG needs an explicit size. */
  width: number;
}

const CARD_HEIGHT = 196;

function formatStat(value: number | null, suffix = ''): string {
  if (value == null) return '—';
  return `${value}${suffix}`;
}

// Personal attendance card — dark gloss surface with three big stats.
// Name + gradient section code at the top; "Attendance / leave remaining / OD left" below.
export function AttendanceGlossCard({
  name,
  sectionCode,
  attendancePercent,
  leaveRemaining,
  odLeft,
  width,
}: AttendanceGlossCardProps) {
  const reducedMotion = useReducedMotion();

  return (
    <Animated.View
      entering={reducedMotion ? undefined : FadeInDown.duration(440).delay(260)}
      style={styles.wrap}
    >
      <GlossCard width={width} height={CARD_HEIGHT}>
        <View style={styles.inner}>
          <View style={styles.topRow}>
            <Text style={styles.name} numberOfLines={1}>
              {name}
            </Text>
            <GradientText
              gradient="softPastel"
              width={120}
              height={20}
              style={{ ...type.code.md, fontSize: 14 }}
              anchor="end"
            >
              {sectionCode}
            </GradientText>
          </View>

          <View style={styles.statsRow}>
            <Stat label="Attendance" value={formatStat(attendancePercent, '%')} />
            <Stat label="leave remaining" value={formatStat(leaveRemaining)} />
            <Stat label="OD left" value={formatStat(odLeft)} />
          </View>
        </View>
      </GlossCard>
    </Animated.View>
  );
}

interface StatProps {
  label: string;
  value: string;
}

function Stat({ label, value }: StatProps) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: space.md,
  },
  inner: {
    flex: 1,
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
    paddingBottom: space.lg,
    justifyContent: 'space-between',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  name: {
    ...type.body.md,
    color: brand.neutral[0],
    flex: 1,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingTop: space.sm,
  },
  stat: {
    alignItems: 'flex-start',
    flex: 1,
  },
  statValue: {
    ...type.stat.value,
    color: brand.neutral[0],
    marginBottom: 4,
  },
  statLabel: {
    ...type.body.xs,
    color: brand.neutral[400],
    letterSpacing: 0.4,
  },
});
