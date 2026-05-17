import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { brand, elevation, radius, space } from '../../../constants/brand';
import { type } from '../../../constants/typography';

interface WaitNotifyPillProps {
  onPress: () => void;
  disabled?: boolean;
  label?: string;
  ctaLabel?: string;
}

// Single horizontal pill: left label "WaitForME / Leave :" + right coral CTA "notify".
// One button, one action — pressing fires the parent handler.
export function WaitNotifyPill({
  onPress,
  disabled,
  label = 'WaitForME / Leave :',
  ctaLabel = 'notify',
}: WaitNotifyPillProps) {
  const reducedMotion = useReducedMotion();

  return (
    <Animated.View
      entering={reducedMotion ? undefined : FadeInDown.duration(420).delay(160)}
      style={styles.wrapper}
    >
      <View style={styles.labelHalf}>
        <Text style={styles.labelText}>{label}</Text>
      </View>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        style={({ pressed }) => [styles.cta, disabled && styles.ctaDisabled, pressed && styles.ctaPressed]}
        accessibilityRole="button"
        accessibilityLabel="Notify driver of leave or wait"
        accessibilityState={{ disabled: !!disabled }}
      >
        <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
          <Path
            d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"
            stroke={brand.neutral[0]}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M13.73 21a2 2 0 01-3.46 0"
            stroke={brand.neutral[0]}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
        <Text style={styles.ctaText}>{ctaLabel}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: brand.neutral[0],
    borderRadius: radius.pill,
    marginHorizontal: space.md,
    paddingLeft: space.lg,
    paddingRight: 6,
    paddingVertical: 6,
    height: 56,
    ...elevation.card,
  },
  labelHalf: {
    flex: 1,
  },
  labelText: {
    ...type.body.md,
    color: brand.ink[500],
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: brand.accent.warm,
    paddingHorizontal: space.lg,
    paddingVertical: 12,
    borderRadius: radius.pill,
    minHeight: 44,
  },
  ctaDisabled: {
    backgroundColor: brand.accent.warmTint,
  },
  ctaPressed: {
    transform: [{ scale: 0.96 }],
    backgroundColor: brand.accent.warmSoft,
  },
  ctaText: {
    ...type.body.md,
    color: brand.neutral[0],
  },
});
