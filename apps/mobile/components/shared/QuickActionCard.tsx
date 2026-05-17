import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ViewStyle } from 'react-native';
import { colors, typography, radii, spacing, student, touch } from '../../constants/theme';

interface QuickActionCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  onPress?: () => void;
  disabled?: boolean;
  iconBg?: string;
  style?: ViewStyle;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

export function QuickActionCard({
  icon,
  label,
  value,
  onPress,
  disabled = false,
  iconBg = student.iconWrapBg,
  style,
  accessibilityLabel,
  accessibilityHint,
}: QuickActionCardProps) {
  const content = (
    <View style={[styles.card, disabled && styles.disabled, style]}>
      <View style={[styles.iconWrap, { backgroundColor: iconBg }]}>
        {icon}
      </View>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, disabled && styles.valueDisabled]}>{value}</Text>
    </View>
  );

  if (onPress && !disabled) {
    return (
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={touch.feedbackOpacity}
        accessibilityLabel={accessibilityLabel ?? `${label}: ${value}`}
        accessibilityHint={accessibilityHint}
        accessibilityRole="button"
        style={styles.touchable}
      >
        {content}
      </TouchableOpacity>
    );
  }

  return content;
}

const styles = StyleSheet.create({
  touchable: {
    flex: 1,
  },
  card: {
    flex: 1,
    backgroundColor: student.cardBg,
    borderRadius: radii.lg,
    padding: spacing.md,
    alignItems: 'flex-start',
    shadowColor: colors.black,
    shadowOpacity: 0.03,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  disabled: {
    opacity: 0.5,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  label: {
    fontFamily: typography.family,
    fontSize: typography.sizes.caption,
    color: student.textMuted,
    marginBottom: spacing.xs,
  },
  value: {
    fontFamily: typography.family,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: student.textInk,
  },
  valueDisabled: {
    color: student.textGhost,
  },
});
