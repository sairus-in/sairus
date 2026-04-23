import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, ActivityIndicator } from 'react-native';
import { colors, typography, spacing, radii } from '../../constants/theme';
import { t } from '../../i18n';
import type { TripScreenState } from '../../lib/trip-state';

interface Props {
  state: TripScreenState;
  uiState?: 'idle' | 'processing' | 'confirmed' | 'failed' | 'offline-queued';
  checkedInAt?: string;
  onPress: () => void;
}

function formatTime(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

const ActiveButton = ({ onPress, animate }: { onPress: () => void; animate: boolean }) => {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (animate) {
      const animation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.02, duration: 1000, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1.0, duration: 1000, useNativeDriver: true }),
        ])
      );
      animation.start();
      return () => animation.stop();
    }
  }, [animate]);

  return (
    <Animated.View style={{ transform: [{ scale: pulseAnim }], width: '100%' }}>
      <TouchableOpacity style={styles.activeBtn} onPress={onPress} activeOpacity={0.8}>
        <Text style={styles.activeText}>{t('home.checkIn')}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

const InactiveButton = ({ screenState }: { screenState: TripScreenState }) => {
  let label = t('home.waitingDriver');
  if (screenState.type === 'WINDOW_CLOSED') label = t('home.windowClosed');
  if (screenState.type === 'SKIPPED') label = t('home.skipDone');
  if (screenState.type === 'LATE_START') label = t('home.waitingDriver');

  return (
    <View style={styles.inactiveBtn}>
      <Text style={styles.inactiveText}>{label}</Text>
    </View>
  );
};

export const CheckInButton = ({ state, uiState, checkedInAt, onPress }: Props) => {
  if (state.type === 'ACTIVE') {
    return <ActiveButton onPress={onPress} animate={true} />;
  }

  if (state.type === 'CHECKED_IN') {
    // Phase 1: optimistic — processing indicator (not confirmed)
    if (state.isOptimistic || uiState === 'processing') {
      return (
        <View style={styles.processingButton}>
          <ActivityIndicator size="small" color={colors.success.text} />
          <Text style={styles.processingText}>Checking in…</Text>
        </View>
      );
    }
    // Phase 2: confirmed — API has returned success
    return (
      <View style={styles.confirmedButton}>
        <Text style={styles.confirmedText}>✓ Checked in · {formatTime(checkedInAt)}</Text>
      </View>
    );
  }

  return <InactiveButton screenState={state} />;
};

const styles = StyleSheet.create({
  activeBtn: {
    backgroundColor: colors.button.primary.bg,
    paddingVertical: 15,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    minHeight: 50,
  },
  activeText: {
    fontFamily: typography.family,
    fontSize: 15,
    fontWeight: typography.weights.semibold,
    color: colors.button.primary.text,
  },
  inactiveBtn: {
    backgroundColor: colors.neutral.bg,
    paddingVertical: 15,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    minHeight: 50,
    opacity: 0.7,
  },
  inactiveText: {
    fontFamily: typography.family,
    fontSize: 15,
    fontWeight: typography.weights.semibold,
    color: colors.neutral.text,
  },
  processingButton: {
    flexDirection: 'row',
    backgroundColor: colors.success.bg,
    paddingVertical: 15,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    minHeight: 50,
    gap: 8,
  },
  processingText: {
    fontFamily: typography.family,
    fontSize: 15,
    fontWeight: typography.weights.semibold,
    color: colors.success.text,
  },
  confirmedButton: {
    backgroundColor: colors.success.bg,
    paddingVertical: 15,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    minHeight: 50,
  },
  confirmedText: {
    fontFamily: typography.family,
    fontSize: 15,
    fontWeight: typography.weights.semibold,
    color: colors.success.text,
  },
});
