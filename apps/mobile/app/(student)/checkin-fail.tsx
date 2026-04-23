// app/(student)/checkin-fail.tsx — Error screen with human-readable messages per reason
// HARDENED v3:
//   - All hardcoded '#FFF' → colors.button.primary.text (LAW 2)
//   - Added missing errorConfig entries: ALREADY_CHECKED_IN, WINDOW_CLOSED, ALREADY_SKIPPED
//   - params.reason coerced from string | string[] safely
//   - ScreenErrorBoundary wrapping
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing, radii } from '../../constants/theme';
import { t } from '../../i18n';
import { ScreenErrorBoundary } from '../../components/shared/ScreenErrorBoundary';

interface FailAction {
  label: string;
  route?: string;
  ghost?: boolean;
}

interface FailConfig {
  icon: string;
  message: string;
  hint?: string;
  actions: FailAction[];
}

const errorConfig: Record<string, FailConfig> = {
  TOO_FAR: {
    icon: '📍',
    message: 'errors.tooFar',
    hint: 'Make sure you are at your stop and try again.',
    actions: [
      { label: 'errors.tryAgain' },
      { label: 'home.requestCorrection', route: '/(student)/history', ghost: true },
    ],
  },
  QR_EXPIRED: {
    icon: '⏱',
    message: 'errors.qrExpired',
    hint: 'The driver will generate a new QR code automatically.',
    actions: [{ label: 'errors.tryAgain' }],
  },
  QR_ALREADY_USED: {
    icon: '🔒',
    message: 'errors.qrUsed',
    hint: 'Each QR code can only be scanned once.',
    actions: [{ label: 'errors.tryAgain' }],
  },
  WRONG_BUS: {
    icon: '🚌',
    message: 'errors.wrongBus',
    hint: 'Please scan the QR code on your assigned bus.',
    actions: [{ label: 'errors.close' }],
  },
  TRIP_NOT_ACTIVE: {
    icon: '⏳',
    message: 'errors.tripNotActive',
    hint: 'The bus has not started its route yet. Please wait.',
    actions: [{ label: 'errors.goBack' }],
  },
  DEVICE_MISMATCH: {
    icon: '📱',
    message: 'errors.deviceMismatch',
    hint: 'Contact your college admin to re-register your device.',
    actions: [{ label: 'errors.reRegister' }],
  },
  RATE_LIMITED: {
    icon: '⚡',
    message: 'errors.rateLimited',
    hint: 'Too many scan attempts. Wait a moment and try again.',
    actions: [{ label: 'errors.goBack' }],
  },
  // --- Previously missing cases that caused confusing "common.error" fallthrough ---
  ALREADY_CHECKED_IN: {
    icon: '✓',
    message: 'errors.alreadyCheckedIn',
    hint: 'You have already been marked present for today.',
    actions: [{ label: 'errors.goHome', route: '/(student)/' }],
  },
  WINDOW_CLOSED: {
    icon: '🚫',
    message: 'errors.windowClosed',
    hint: 'The check-in window for this trip has ended.',
    actions: [
      { label: 'errors.goHome', route: '/(student)/' },
      { label: 'home.requestCorrection', route: '/(student)/history', ghost: true },
    ],
  },
  ALREADY_SKIPPED: {
    icon: '⏩',
    message: 'errors.alreadySkipped',
    hint: 'You marked yourself as not travelling today.',
    actions: [{ label: 'errors.goHome', route: '/(student)/' }],
  },
};

const fallbackConfig: FailConfig = {
  icon: '⚠',
  message: 'common.error',
  actions: [{ label: 'errors.goBack' }],
};

export default function CheckinFailScreen() {
  return (
    <ScreenErrorBoundary screenName="CheckinFail">
      <CheckinFailContent />
    </ScreenErrorBoundary>
  );
}

function CheckinFailContent() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    reason: string; distance?: string; seconds?: string;
    wrong?: string; correct?: string;
    distanceToBus?: string; distanceToStop?: string;
  }>();

  // Coerce reason: expo-router can return string | string[] for dynamic segments
  const reason = Array.isArray(params.reason) ? params.reason[0] : params.reason;
  const config = (reason && errorConfig[reason]) ? errorConfig[reason] : fallbackConfig;

  const message = t(config.message, {
    distance: params.distance ?? params.distanceToStop ?? params.distanceToBus ?? '0',
    seconds: params.seconds ?? '30',
    wrong: params.wrong ?? '?',
    correct: params.correct ?? '?',
  });

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.errorCard}>
          <Text style={styles.errorIcon}>{config.icon}</Text>
          <Text style={styles.errorMessage}>{message}</Text>
          {config.hint && (
            <Text style={styles.errorHint}>{config.hint}</Text>
          )}
        </View>

        <View style={styles.actions}>
          {config.actions.map((action, i) => (
            <TouchableOpacity
              key={i}
              style={action.ghost ? styles.ghostButton : styles.primaryButton}
              onPress={() => {
                if (action.route) {
                  router.replace(action.route as any);
                } else {
                  router.back();
                }
              }}
              activeOpacity={0.8}
            >
              <Text style={action.ghost ? styles.ghostText : styles.primaryText}>
                {t(action.label)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  content: {
    flex: 1, justifyContent: 'center', paddingHorizontal: spacing.xl,
  },
  errorCard: {
    backgroundColor: colors.error.bg, borderWidth: 1, borderColor: colors.error.border,
    borderRadius: radii.md, padding: spacing.xl, alignItems: 'center',
  },
  errorIcon: {
    fontSize: 36, marginBottom: spacing.md,
  },
  errorMessage: {
    fontFamily: typography.family, fontSize: typography.sizes.h3,
    fontWeight: typography.weights.medium, color: colors.text.primary,
    textAlign: 'center', lineHeight: 24,
  },
  errorHint: {
    fontFamily: typography.family, fontSize: typography.sizes.body,
    color: colors.text.secondary, textAlign: 'center',
    marginTop: spacing.sm, lineHeight: 20,
  },
  actions: { marginTop: spacing.xl, gap: spacing.sm },
  primaryButton: {
    backgroundColor: colors.button.primary.bg, paddingVertical: 15,
    borderRadius: radii.button, alignItems: 'center',
  },
  primaryText: {
    fontFamily: typography.family, fontSize: 15,
    fontWeight: typography.weights.semibold, color: colors.button.primary.text,
  },
  ghostButton: { paddingVertical: spacing.sm, alignItems: 'center' },
  ghostText: {
    fontFamily: typography.family, fontSize: typography.sizes.small,
    fontWeight: typography.weights.medium, color: colors.brand.primary,
  },
});
