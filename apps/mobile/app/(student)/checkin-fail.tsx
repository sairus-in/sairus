import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInDown, FadeIn, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import * as Haptics from 'expo-haptics';

import { typography, spacingExtended } from '../../constants/theme';
import { t } from '../../i18n';
import { ScreenErrorBoundary } from '../../components/shared/ScreenErrorBoundary';

// ── Design Tokens ──
const ds = {
  bg: '#BFE6FF',
  cardBg: '#FFFFFF',
  textInk: '#1A1A1C',
  textMuted: '#565656',
  dangerBg: '#FCE4EC',
  dangerText: '#C62828',
  primary: '#356C8F',
  ghostText: '#565656',
  warningBg: '#FFF3E0',
  warningText: '#E65100',
  successBg: '#E8F5E9',
  successText: '#2E7D32',
};

// ── Icons ──
const LocationIcon = ({ color = ds.dangerText }) => (
  <Svg width={32} height={32} viewBox="0 0 24 24" fill="none">
    <Path d="M12 13a3 3 0 100-6 3 3 0 000 6z" stroke={color} strokeWidth={2.5} />
    <Path d="M12 2C7.58 2 4 5.58 4 10c0 5.25 8 12 8 12s8-6.75 8-12c0-4.42-3.58-8-8-8z" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const ClockIcon = ({ color = ds.warningText }) => (
  <Svg width={32} height={32} viewBox="0 0 24 24" fill="none">
    <Circle cx="12" cy="12" r="10" stroke={color} strokeWidth={2.5} />
    <Path d="M12 6v6l4 2" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const LockIcon = ({ color = ds.dangerText }) => (
  <Svg width={32} height={32} viewBox="0 0 24 24" fill="none">
    <Rect x="3" y="11" width="18" height="11" rx="2" ry="2" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M7 11V7a5 5 0 0110 0v4" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const BusIcon = ({ color = ds.dangerText }) => (
  <Svg width={32} height={32} viewBox="0 0 24 24" fill="none">
    <Rect x="4" y="3" width="16" height="18" rx="2" ry="2" stroke={color} strokeWidth={2.5} />
    <Path d="M4 11h16M8 17h.01M16 17h.01" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const DeviceIcon = ({ color = ds.dangerText }) => (
  <Svg width={32} height={32} viewBox="0 0 24 24" fill="none">
    <Rect x="5" y="2" width="14" height="20" rx="2" ry="2" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M12 18h.01" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const AlertIcon = ({ color = ds.dangerText }) => (
  <Svg width={32} height={32} viewBox="0 0 24 24" fill="none">
    <Path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M12 9v4M12 17h.01" stroke={color} strokeWidth={2.5} strokeLinecap="round" />
  </Svg>
);

const CheckIcon = ({ color = ds.successText }) => (
  <Svg width={32} height={32} viewBox="0 0 24 24" fill="none">
    <Path d="M20 6L9 17l-5-5" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const SkipIcon = ({ color = ds.warningText }) => (
  <Svg width={32} height={32} viewBox="0 0 24 24" fill="none">
    <Path d="M5 4L15 12L5 20V4Z" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M19 5V19" stroke={color} strokeWidth={2.5} strokeLinecap="round" />
  </Svg>
);


interface FailAction {
  label: string;
  route?: string;
  ghost?: boolean;
}

interface FailConfig {
  iconType: 'LOCATION' | 'CLOCK' | 'LOCK' | 'BUS' | 'DEVICE' | 'ALERT' | 'CHECK' | 'SKIP';
  colorType: 'DANGER' | 'WARNING' | 'SUCCESS';
  message: string;
  hint?: string;
  actions: FailAction[];
}

const errorConfig: Record<string, FailConfig> = {
  TOO_FAR: {
    iconType: 'LOCATION',
    colorType: 'DANGER',
    message: 'errors.tooFar',
    hint: 'Make sure you are at your stop and try again.',
    actions: [
      { label: 'errors.tryAgain' },
      { label: 'home.requestCorrection', route: '/(student)/history', ghost: true },
    ],
  },
  QR_EXPIRED: {
    iconType: 'CLOCK',
    colorType: 'WARNING',
    message: 'errors.qrExpired',
    hint: 'The driver will generate a new QR code automatically.',
    actions: [{ label: 'errors.tryAgain' }],
  },
  QR_ALREADY_USED: {
    iconType: 'LOCK',
    colorType: 'DANGER',
    message: 'errors.qrUsed',
    hint: 'Each QR code can only be scanned once.',
    actions: [{ label: 'errors.tryAgain' }],
  },
  WRONG_BUS: {
    iconType: 'BUS',
    colorType: 'DANGER',
    message: 'errors.wrongBus',
    hint: 'Please scan the QR code on your assigned bus.',
    actions: [{ label: 'errors.close' }],
  },
  TRIP_NOT_ACTIVE: {
    iconType: 'CLOCK',
    colorType: 'WARNING',
    message: 'errors.tripNotActive',
    hint: 'The bus has not started its route yet. Please wait.',
    actions: [{ label: 'errors.goBack' }],
  },
  DEVICE_MISMATCH: {
    iconType: 'DEVICE',
    colorType: 'DANGER',
    message: 'errors.deviceMismatch',
    hint: 'Contact your college admin to re-register your device.',
    actions: [{ label: 'errors.reRegister' }],
  },
  RATE_LIMITED: {
    iconType: 'ALERT',
    colorType: 'DANGER',
    message: 'errors.rateLimited',
    hint: 'Too many scan attempts. Wait a moment and try again.',
    actions: [{ label: 'errors.goBack' }],
  },
  ALREADY_CHECKED_IN: {
    iconType: 'CHECK',
    colorType: 'SUCCESS',
    message: 'errors.alreadyCheckedIn',
    hint: 'You have already been marked present for today.',
    actions: [{ label: 'errors.goHome', route: '/(student)/' }],
  },
  WINDOW_CLOSED: {
    iconType: 'ALERT',
    colorType: 'DANGER',
    message: 'errors.windowClosed',
    hint: 'The check-in window for this trip has ended.',
    actions: [
      { label: 'errors.goHome', route: '/(student)/' },
      { label: 'home.requestCorrection', route: '/(student)/history', ghost: true },
    ],
  },
  ALREADY_SKIPPED: {
    iconType: 'SKIP',
    colorType: 'WARNING',
    message: 'errors.alreadySkipped',
    hint: 'You marked yourself as not travelling today.',
    actions: [{ label: 'errors.goHome', route: '/(student)/' }],
  },
};

const fallbackConfig: FailConfig = {
  iconType: 'ALERT',
  colorType: 'DANGER',
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

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  }, []);

  const reason = Array.isArray(params.reason) ? params.reason[0] : params.reason;
  const config = (reason && errorConfig[reason]) ? errorConfig[reason] : fallbackConfig;

  const message = t(config.message, {
    distance: params.distance ?? params.distanceToStop ?? params.distanceToBus ?? '0',
    seconds: params.seconds ?? '30',
    wrong: params.wrong ?? '?',
    correct: params.correct ?? '?',
  });

  const iconScale = useSharedValue(0.5);
  useEffect(() => {
    iconScale.value = withSpring(1, { damping: 10, stiffness: 80 });
  }, []);
  const animatedIconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: iconScale.value }]
  }));

  // Resolve Colors
  let bgCol = ds.dangerBg;
  let textCol = ds.dangerText;
  if (config.colorType === 'WARNING') {
    bgCol = ds.warningBg;
    textCol = ds.warningText;
  } else if (config.colorType === 'SUCCESS') {
    bgCol = ds.successBg;
    textCol = ds.successText;
  }

  // Resolve Icon
  let IconComponent = AlertIcon;
  if (config.iconType === 'LOCATION') IconComponent = LocationIcon;
  if (config.iconType === 'CLOCK') IconComponent = ClockIcon;
  if (config.iconType === 'LOCK') IconComponent = LockIcon;
  if (config.iconType === 'BUS') IconComponent = BusIcon;
  if (config.iconType === 'DEVICE') IconComponent = DeviceIcon;
  if (config.iconType === 'CHECK') IconComponent = CheckIcon;
  if (config.iconType === 'SKIP') IconComponent = SkipIcon;

  return (
    <SafeAreaView style={s.container}>
      <Animated.View entering={FadeIn.duration(400)} style={s.centerWrap}>

        <Animated.View entering={FadeInDown.duration(500).springify()} style={s.card}>

          {/* Icon — outer: entering, inner: animated scale */}
          <Animated.View entering={FadeInDown.duration(400)}>
            <Animated.View style={[s.iconCircle, { backgroundColor: bgCol }, animatedIconStyle]}>
              <IconComponent color={textCol} />
            </Animated.View>
          </Animated.View>

          <Text style={s.title}>{config.colorType === 'SUCCESS' ? 'Success' : 'Scan Failed'}</Text>
          <Text style={[s.errorMessage, { color: textCol }]}>{message}</Text>
          {config.hint && <Text style={s.errorHint}>{config.hint}</Text>}

          <View style={s.actions}>
            {config.actions.map((action, i) => {
              if (action.ghost) {
                return (
                  <TouchableOpacity
                    key={i}
                    style={s.ghostButton}
                    onPress={() => action.route ? router.replace(action.route as any) : router.back()}
                    activeOpacity={0.7}
                  >
                    <Text style={s.ghostText}>{t(action.label)}</Text>
                  </TouchableOpacity>
                );
              }
              return (
                <TouchableOpacity
                  key={i}
                  style={s.primaryButton}
                  onPress={() => action.route ? router.replace(action.route as any) : router.back()}
                  activeOpacity={0.8}
                >
                  <Text style={s.primaryText}>{t(action.label)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

        </Animated.View>

      </Animated.View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: ds.bg,
  },
  centerWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacingExtended.screen,
  },
  card: {
    backgroundColor: ds.cardBg,
    width: '100%',
    borderRadius: 32,
    paddingVertical: 40,
    paddingHorizontal: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontFamily: typography.family,
    fontSize: 24,
    fontWeight: typography.weights.bold,
    color: ds.textInk,
    marginBottom: 12,
  },
  errorMessage: {
    fontFamily: typography.family,
    fontSize: 16,
    fontWeight: typography.weights.medium,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 8,
  },
  errorHint: {
    fontFamily: typography.family,
    fontSize: 14,
    color: ds.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  actions: {
    width: '100%',
    gap: 12,
  },
  primaryButton: {
    backgroundColor: ds.primary,
    paddingVertical: 16,
    borderRadius: 24,
    alignItems: 'center',
    width: '100%',
  },
  primaryText: {
    fontFamily: typography.family,
    fontSize: 15,
    fontWeight: typography.weights.bold,
    color: '#FFFFFF',
  },
  ghostButton: {
    paddingVertical: 16,
    alignItems: 'center',
    width: '100%',
  },
  ghostText: {
    fontFamily: typography.family,
    fontSize: 14,
    fontWeight: typography.weights.bold,
    color: ds.ghostText,
  },
});
