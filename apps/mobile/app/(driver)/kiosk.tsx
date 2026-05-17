import React, { useEffect, useRef, useState } from 'react';
import {
  AppState,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Brightness from 'expo-brightness';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Location from 'expo-location';
import QRCode from 'react-native-qrcode-svg';
import Animated, {
  FadeIn,
  FadeInUp,
  FadeOutDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  withSpring,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { ScreenErrorBoundary } from '../../components/shared/ScreenErrorBoundary';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { useKioskSocket } from '../../hooks/useKioskSocket';
import { t } from '../../i18n';
import { analytics } from '../../lib/analytics';
import { useTrip } from '../../store/trip.store';
import { GPS_TASK_NAME, startGPSTask } from '../../tasks/gps.task';

const SOCKET_DEAD_THRESHOLD_MS = 10_000;

export default function KioskScreen() {
  return (
    <ScreenErrorBoundary screenName="DriverKiosk">
      <KioskContent />
    </ScreenErrorBoundary>
  );
}

function KioskContent() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tripId: string; busId: string }>();
  const tripId = params.tripId || '';
  const busId = params.busId || '';

  const qrToken = useTrip((s) => s.qrToken);
  const qrExpiresAt = useTrip((s) => s.qrExpiresAt);
  const boardedCount = useTrip((s) => s.boardedCount);
  const expectedCount = useTrip((s) => s.expectedCount);
  const lastToast = useTrip((s) => s.lastToast);
  const waitRequests = useTrip((s) => s.waitRequests);
  const adminMessages = useTrip((s) => s.adminMessages);
  const socketStatus = useTrip((s) => s.socketStatus);

  const [gpsStatus, setGPSStatus] = useState<'LIVE' | 'DEAD' | 'UNKNOWN'>('UNKNOWN');
  const [socketDeadBanner, setSocketDeadBanner] = useState(false);
  const socketDeadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [countdown, setCountdown] = useState(0);
  const qrExpiredFired = useRef(false);

  // Animation values
  const buttonScale = useSharedValue(1);
  const countdownPulse = useSharedValue(1);

  // Countdown pulse animation
  useEffect(() => {
    if (countdown <= 10 && countdown > 0) {
      countdownPulse.value = withRepeat(
        withSequence(
          withTiming(1.1, { duration: 300 }),
          withTiming(1, { duration: 300 })
        ),
        -1,
        true
      );
    } else {
      countdownPulse.value = 1;
    }
  }, [countdown]);

  useEffect(() => {
    activateKeepAwakeAsync('kiosk');
    Brightness.setBrightnessAsync(1);
    return () => {
      deactivateKeepAwake('kiosk');
      Brightness.setBrightnessAsync(0.5);
    };
  }, []);

  useKioskSocket(tripId, busId);

  useEffect(() => {
    if (socketStatus === 'connected') {
      setSocketDeadBanner(false);
      if (socketDeadTimer.current) {
        clearTimeout(socketDeadTimer.current);
        socketDeadTimer.current = null;
      }
    } else if (!socketDeadTimer.current) {
      socketDeadTimer.current = setTimeout(() => {
        setSocketDeadBanner(true);
        analytics.track('kiosk_socket_dead_polling_started', {});
      }, SOCKET_DEAD_THRESHOLD_MS);
    }

    return () => {
      if (socketDeadTimer.current) {
        clearTimeout(socketDeadTimer.current);
        socketDeadTimer.current = null;
      }
    };
  }, [socketStatus]);

  useEffect(() => {
    if (!busId) {
      return;
    }

    const check = setInterval(async () => {
      const lastWrite = await AsyncStorage.getItem(`gps:heartbeat:${busId}`);
      const isGPSAlive = Boolean(lastWrite) && (Date.now() - Number(lastWrite)) < 15_000;

      setGPSStatus((prev) => {
        if (prev === 'LIVE' && !isGPSAlive) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        }
        return isGPSAlive ? 'LIVE' : 'DEAD';
      });
    }, 10_000);

    return () => clearInterval(check);
  }, [busId]);

  useEffect(() => {
    if (!tripId || !busId) {
      return;
    }

    const subscription = AppState.addEventListener('change', async (state) => {
      if (state === 'active') {
        const isRunning = await Location.hasStartedLocationUpdatesAsync(GPS_TASK_NAME);
        if (!isRunning) {
          await startGPSTask(tripId, busId);
          setGPSStatus('LIVE');
        }
      }
    });

    return () => subscription.remove();
  }, [tripId, busId]);

  useEffect(() => {
    if (!qrExpiresAt) {
      return;
    }

    qrExpiredFired.current = false;

    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((qrExpiresAt - Date.now()) / 1000));
      setCountdown(remaining);

      if (remaining === 0 && !qrExpiredFired.current) {
        qrExpiredFired.current = true;
        analytics.track('kiosk_qr_refresh_missed', {});
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [qrExpiresAt]);

  // Animated styles
  const countdownAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: countdownPulse.value }],
  }));

  const handleButtonPressIn = () => {
    buttonScale.value = withSpring(0.95, { damping: 15, stiffness: 400 });
  };

  const handleButtonPressOut = () => {
    buttonScale.value = withSpring(1, { damping: 15, stiffness: 400 });
  };

  const gpsDotColor =
    gpsStatus === 'LIVE'
      ? colors.success.text
      : gpsStatus === 'DEAD'
        ? colors.warning.text
        : colors.neutral.text;

  const socketDotColor = socketStatus === 'connected' ? colors.success.text : colors.error.text;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <View style={styles.statusGroup}>
          <View style={[styles.statusDot, { backgroundColor: socketDotColor }]} />
          <Text style={styles.statusLabel}>Net</Text>
        </View>
        <View style={styles.statusGroup}>
          <View style={[styles.statusDot, { backgroundColor: gpsDotColor }]} />
          <Text style={styles.statusLabel}>GPS</Text>
        </View>
        <Text style={styles.topText}>
          {boardedCount}/{expectedCount}
        </Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          style={styles.breakdownBtn}
          onPress={() => router.push({ pathname: '/(driver)/breakdown', params: { tripId } })}
        >
          <Text style={styles.breakdownText}>{t('kiosk.breakdown')}</Text>
        </TouchableOpacity>
      </View>

      {socketDeadBanner ? (
        <View style={styles.socketDeadBanner}>
          <Text style={styles.socketDeadText}>
            Warning: connection lost - attendance counts may be delayed
          </Text>
        </View>
      ) : null}

      {gpsStatus === 'DEAD' ? (
        <View style={styles.gpsDeadBanner}>
          <Text style={styles.gpsDeadText}>
            GPS signal lost - student locations may not update
          </Text>
        </View>
      ) : null}

      <View style={styles.qrArea}>
        {qrToken ? (
          <>
            <View style={[styles.qrContainer, countdown === 0 && { opacity: 0.4 }]}>
              <QRCode
                value={qrToken}
                size={220}
                backgroundColor={colors.white}
                color={colors.black}
              />
            </View>
            <Text
              style={[
                styles.countdownText,
                countdown <= 10 && countdown > 0 && { color: colors.warning.text },
                countdown === 0 && { color: colors.error.text },
              ]}
            >
              {countdown > 0 ? `${countdown}s` : 'Expired - refreshing...'}
            </Text>
          </>
        ) : (
          <View style={styles.qrContainer}>
            <Text style={styles.loadingQr}>{t('kiosk.gettingNewCode')}</Text>
          </View>
        )}
      </View>

      {adminMessages.length > 0 ? (
        <View
          style={[
            styles.messageBanner,
            adminMessages[adminMessages.length - 1].isUrgent && styles.urgentBanner,
          ]}
        >
          <Text style={styles.messageText}>
            {adminMessages[adminMessages.length - 1].body}
          </Text>
        </View>
      ) : null}

      {waitRequests.length > 0 ? (
        <View style={styles.waitBanner}>
          <Text style={styles.waitText}>
            Wait request: {waitRequests[waitRequests.length - 1].studentName} - ~{waitRequests[waitRequests.length - 1].etaMinutes} min
          </Text>
        </View>
      ) : null}

      {lastToast ? (
        <Animated.View
          entering={FadeInUp.duration(300)}
          exiting={FadeOutDown.duration(300)}
          style={styles.toast}
        >
          <Text
            style={[
              styles.toastIcon,
              { color: lastToast.status === 'PRESENT' ? colors.success.text : colors.warning.text },
            ]}
          >
            {lastToast.status === 'PRESENT' ? 'OK' : '~'}
          </Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.toastName}>{lastToast.name}</Text>
            <Text style={styles.toastMeta}>
              {lastToast.status === 'PRESENT' ? 'Checked in' : 'Late board'} - {t('kiosk.justNow')}
            </Text>
          </View>
        </Animated.View>
      ) : null}

      <Animated.View style={styles.bottomBar}>
        <Animated.View style={{ transform: [{ scale: buttonScale.value }], flex: 1 }}>
          <TouchableOpacity
            style={styles.bottomBtn}
            onPress={() => {}}
            onPressIn={handleButtonPressIn}
            onPressOut={handleButtonPressOut}
            activeOpacity={0.8}
          >
            <Text style={styles.bottomBtnText}>{t('kiosk.nextStopBtn')}</Text>
          </TouchableOpacity>
        </Animated.View>
        <Animated.View style={{ transform: [{ scale: buttonScale.value }], flex: 1 }}>
          <TouchableOpacity
            style={styles.bottomBtn}
            onPress={() => {}}
            onPressIn={handleButtonPressIn}
            onPressOut={handleButtonPressOut}
            activeOpacity={0.8}
          >
            <Text style={styles.bottomBtnText}>{t('kiosk.manual')}</Text>
          </TouchableOpacity>
        </Animated.View>
        <Animated.View style={{ transform: [{ scale: buttonScale.value }], flex: 1 }}>
          <TouchableOpacity
            style={[styles.bottomBtn, styles.endBtn]}
            onPress={() => router.push({ pathname: '/(driver)/summary', params: { tripId } })}
            onPressIn={handleButtonPressIn}
            onPressOut={handleButtonPressOut}
            activeOpacity={0.8}
          >
            <Text style={styles.endBtnText}>End trip</Text>
          </TouchableOpacity>
        </Animated.View>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.kiosk.bg,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
  },
  statusGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing.xs,
  },
  statusLabel: {
    fontFamily: typography.family,
    fontSize: typography.sizes.micro,
    color: colors.kiosk.textMuted,
  },
  topText: {
    fontFamily: typography.family,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
    color: colors.kiosk.textPrimary,
  },
  breakdownBtn: {
    borderWidth: 1,
    borderColor: colors.error.text,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.micro,
    borderRadius: radii.pill,
  },
  breakdownText: {
    fontFamily: typography.family,
    fontSize: typography.sizes.micro,
    color: colors.error.text,
  },
  socketDeadBanner: {
    backgroundColor: colors.error.bg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.error.border,
  },
  socketDeadText: {
    fontFamily: typography.family,
    fontSize: typography.sizes.small,
    color: colors.error.text,
    textAlign: 'center',
  },
  gpsDeadBanner: {
    backgroundColor: colors.warning.bg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.warning.border,
  },
  gpsDeadText: {
    fontFamily: typography.family,
    fontSize: typography.sizes.small,
    color: colors.warning.text,
    textAlign: 'center',
  },
  qrArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  qrContainer: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 260,
    minHeight: 260,
  },
  loadingQr: {
    fontFamily: typography.family,
    fontSize: typography.sizes.body,
    color: colors.kiosk.textMuted,
  },
  countdownText: {
    fontFamily: typography.family,
    fontSize: typography.sizes.h2,
    fontWeight: typography.weights.bold,
    color: colors.kiosk.textPrimary,
    marginTop: spacing.md,
  },
  messageBanner: {
    backgroundColor: colors.kiosk.card,
    marginHorizontal: spacing.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
    marginBottom: spacing.xs,
  },
  urgentBanner: {
    backgroundColor: 'rgba(220, 38, 38, 0.18)',
  },
  messageText: {
    fontFamily: typography.family,
    fontSize: typography.sizes.small,
    color: colors.kiosk.textPrimary,
  },
  waitBanner: {
    backgroundColor: colors.kiosk.card,
    marginHorizontal: spacing.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.warning.text,
    marginBottom: spacing.xs,
  },
  waitText: {
    fontFamily: typography.family,
    fontSize: typography.sizes.small,
    color: colors.warning.text,
  },
  toast: {
    position: 'absolute',
    bottom: 80,
    left: spacing.xl,
    right: spacing.xl,
    backgroundColor: colors.kiosk.card,
    borderWidth: 1,
    borderColor: colors.success.text,
    borderRadius: radii.toast,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
  },
  toastIcon: {
    fontSize: 20,
    marginRight: spacing.sm,
  },
  toastName: {
    fontFamily: typography.family,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
    color: colors.kiosk.textPrimary,
  },
  toastMeta: {
    fontFamily: typography.family,
    fontSize: typography.sizes.micro,
    color: colors.kiosk.textMuted,
  },
  bottomBar: {
    flexDirection: 'row',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    gap: spacing.xs,
  },
  bottomBtn: {
    flex: 1,
    backgroundColor: colors.kiosk.card,
    borderWidth: 1,
    borderColor: colors.kiosk.border,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
    alignItems: 'center',
  },
  bottomBtnText: {
    fontFamily: typography.family,
    fontSize: typography.sizes.small,
    fontWeight: typography.weights.medium,
    color: colors.kiosk.textPrimary,
  },
  endBtn: {
    backgroundColor: colors.error.text,
    borderColor: colors.error.text,
  },
  endBtnText: {
    fontFamily: typography.family,
    fontSize: typography.sizes.small,
    fontWeight: typography.weights.semibold,
    color: colors.white,
  },
});
