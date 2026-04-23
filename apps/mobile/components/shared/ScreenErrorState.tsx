import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, radii, spacing, typography } from '../../constants/theme';

interface ScreenErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}

export function ScreenErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  retryLabel = 'Retry',
}: ScreenErrorStateProps) {
  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message}>{message}</Text>
        {onRetry ? (
          <TouchableOpacity style={styles.button} onPress={onRetry} activeOpacity={0.8}>
            <Text style={styles.buttonText}>{retryLabel}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.surface,
  },
  card: {
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.error.border,
    backgroundColor: colors.error.bg,
    padding: spacing.xl,
    gap: spacing.md,
  },
  title: {
    fontFamily: typography.family,
    fontSize: typography.sizes.h2,
    fontWeight: typography.weights.bold,
    color: colors.error.text,
    textAlign: 'center',
  },
  message: {
    fontFamily: typography.family,
    fontSize: typography.sizes.body,
    color: colors.text.secondary,
    lineHeight: 22,
    textAlign: 'center',
  },
  button: {
    alignSelf: 'center',
    marginTop: spacing.xs,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: radii.button,
    backgroundColor: colors.button.primary.bg,
  },
  buttonText: {
    fontFamily: typography.family,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
    color: colors.button.primary.text,
  },
});
