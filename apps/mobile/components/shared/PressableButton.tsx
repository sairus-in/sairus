import React, { useRef } from 'react';
import { Text, StyleSheet, Pressable, PressableProps, ActivityIndicator, ViewStyle, TextStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { typography, radii, spacing, student, touch, colors } from '../../constants/theme';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';

interface PressableButtonProps extends Omit<PressableProps, 'style'> {
  title: string;
  variant?: ButtonVariant;
  loading?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  fullWidth?: boolean;
}

// Animated Pressable wrapper
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const variantStyles: Record<ButtonVariant, { bg: string; text: string; border?: string }> = {
  primary: { bg: student.primary, text: student.primaryText },
  secondary: { bg: colors.button.brand.bg, text: colors.button.brand.text },
  outline: { bg: 'transparent', text: student.textInk, border: student.border },
  ghost: { bg: 'transparent', text: colors.button.ghost.text },
  danger: { bg: colors.error.text, text: colors.white },
};

export function PressableButton({
  title,
  variant = 'primary',
  loading = false,
  disabled,
  style,
  textStyle,
  fullWidth = false,
  ...pressableProps
}: PressableButtonProps) {
  const scale = useSharedValue(1);
  const variantConfig = variantStyles[variant];

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(touch.feedbackScale, { damping: 15, stiffness: 400 });
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 15, stiffness: 400 });
  };

  return (
    <AnimatedPressable
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled || loading}
      style={[
        styles.button,
        { backgroundColor: variantConfig.bg },
        variantConfig.border && { borderWidth: 1, borderColor: variantConfig.border },
        fullWidth && styles.fullWidth,
        disabled && styles.disabled,
        animatedStyle,
        style,
      ]}
      {...pressableProps}
    >
      {loading ? (
        <ActivityIndicator color={variantConfig.text} size="small" />
      ) : (
        <Text style={[styles.text, { color: variantConfig.text }, textStyle]}>
          {title}
        </Text>
      )}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: touch.minSize,
  },
  fullWidth: {
    width: '100%',
  },
  disabled: {
    opacity: 0.35,
  },
  text: {
    fontFamily: typography.family,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
  },
});