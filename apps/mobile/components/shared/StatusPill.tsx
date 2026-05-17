import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { colors, typography, radii, statusPill } from '../../constants/theme';

type StatusVariant = 'PRESENT' | 'ABSENT' | 'LATE_BOARD' | 'EXCUSED' | 'OFFLINE' | 'NOT_STARTED' | 'CHECKED_IN' | 'GPS_WEAK' | 'SCHEDULED' | 'LIVE';

interface Props {
  variant: StatusVariant;
  label?: string;
  style?: ViewStyle;
}

// Map variants to colors - using semantic tokens from theme
const variantMap: Record<StatusVariant, { bg: string; text: string; label?: string }> = {
  PRESENT: { ...statusPill.PRESENT, label: '+ CHECKED IN' },
  ABSENT: { ...statusPill.ABSENT, label: 'ABSENT' },
  LATE_BOARD: { ...statusPill.LATE_BOARD, label: 'LATE BOARD' },
  EXCUSED: { ...statusPill.EXCUSED, label: 'EXCUSED' },
  OFFLINE: { ...statusPill.OFFLINE, label: 'GPS OFFLINE' },
  NOT_STARTED: { ...statusPill.NOT_STARTED, label: 'NOT STARTED' },
  CHECKED_IN: { ...statusPill.PRESENT, label: '+ CHECKED IN' },
  GPS_WEAK: { ...statusPill.OFFLINE, label: 'GPS WEAK' },
  SCHEDULED: { bg: colors.warning.bg, text: colors.warning.text, label: 'SCHEDULED' },
  LIVE: { ...statusPill.PRESENT, label: '+ LIVE' },
};

export function StatusPill({ variant, label, style }: Props) {
  const config = variantMap[variant] || variantMap.NOT_STARTED;
  const displayLabel = label || config.label || variant;

  return (
    <View style={[styles.pill, { backgroundColor: config.bg }, style]} accessible accessibilityLabel={displayLabel}>
      <Text style={[styles.text, { color: config.text }]}>{displayLabel}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  text: {
    fontFamily: typography.family,
    fontSize: 11,
    fontWeight: typography.weights.bold,
    letterSpacing: 0.5,
  },
});
