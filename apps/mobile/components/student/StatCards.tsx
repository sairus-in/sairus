// components/student/StatCards.tsx — Three-column attendance stat cards
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, typography, spacing, radii } from '../../constants/theme';
import { t } from '../../i18n';

interface StatCardsProps {
  percentage: number | null;
  presentCount: number | null;
  absentCount: number | null;
}

function getPercentageColor(pct: number): string {
  if (pct >= 85) return colors.success.text;
  if (pct >= 70) return colors.warning.text;
  return colors.error.text;
}

export const StatCardsSkeleton = React.memo(function StatCardsSkeleton() {
  return (
    <View style={styles.row}>
      {[1, 2, 3].map((key) => (
        <View key={key} style={[styles.card, { opacity: 0.5, backgroundColor: colors.neutral.bg }]}>
          <Text style={[styles.number, { color: 'transparent' }]}>-</Text>
          <Text style={[styles.label, { color: 'transparent' }]}>-</Text>
        </View>
      ))}
    </View>
  );
});

export const StatCards = React.memo(function StatCards({
  percentage,
  presentCount,
  absentCount,
}: StatCardsProps) {
  if (percentage === null || presentCount === null || absentCount === null) {
    return <StatCardsSkeleton />;
  }

  return (
    <View style={styles.row}>
      <View style={styles.card}>
        <Text style={[styles.number, { color: getPercentageColor(percentage) }]}>
          {percentage}%
        </Text>
        <Text style={styles.label}>{t('home.attendance')}</Text>
      </View>
      <View style={styles.card}>
        <Text style={[styles.number, { color: colors.success.text }]}>
          {presentCount}
        </Text>
        <Text style={styles.label}>{t('home.present')}</Text>
      </View>
      <View style={styles.card}>
        <Text style={[styles.number, { color: colors.error.text }]}>
          {absentCount}
        </Text>
        <Text style={styles.label}>{t('home.absent')}</Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  card: {
    flex: 1,
    backgroundColor: colors.card.bg,
    borderWidth: 1,
    borderColor: colors.card.border,
    borderRadius: radii.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
  },
  number: {
    fontFamily: typography.family,
    fontSize: 20,
    fontWeight: typography.weights.bold,
    letterSpacing: -0.5,
  },
  label: {
    fontFamily: typography.family,
    fontSize: 9,
    fontWeight: typography.weights.medium,
    color: colors.text.muted,
    marginTop: 2,
    textTransform: 'uppercase',
  },
});
