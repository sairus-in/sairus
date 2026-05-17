import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { colors, typography, radii, spacing, student } from '../../constants/theme';

interface StatCardProps {
  label: string;
  value: string | number;
  style?: ViewStyle;
}

export function StatCard({ label, value, style }: StatCardProps) {
  return (
    <View style={[styles.card, style]} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: student.cardBg,
    borderRadius: radii.lg,
    padding: spacing.md,
    shadowColor: colors.black,
    shadowOpacity: 0.03,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  label: {
    fontFamily: typography.family,
    fontSize: typography.sizes.micro, // 11
    fontWeight: typography.weights.bold,
    color: student.textMuted,
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  value: {
    fontFamily: typography.family,
    fontSize: typography.sizes.h2,
    fontWeight: typography.weights.bold,
    color: student.textInk,
  },
});
