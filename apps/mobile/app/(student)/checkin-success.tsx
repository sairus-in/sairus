import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import Svg, { Path, Circle } from 'react-native-svg';

import { typography, spacingExtended } from '../../constants/theme';
import { useAuth } from '../../store/auth.store';
import { useStudentHome } from '../../hooks/useStudentHome';

// ── Design Tokens ──
const ds = {
  bg: '#BFE6FF',
  cardBg: '#FFFFFF',
  textInk: '#1A1A1C',
  textMuted: '#565656',
  successBg: '#E8F5E9',
  successText: '#2E7D32',
  warningBg: '#FFF3E0',
  warningText: '#E65100',
  primary: '#356C8F',
};

// ── Icons ──
const CheckIcon = ({ color = ds.successText, size = 32 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M20 6L9 17l-5-5" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const CloudIcon = ({ color = ds.warningText, size = 32 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M17.5 19C19.985 19 22 16.985 22 14.5c0-2.336-1.78-4.25-4.05-4.47A8.001 8.001 0 002.83 13.29 4.5 4.5 0 002.5 22h15z" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

// Formatter
function formatCheckedInAt(raw: string | undefined): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function CheckinSuccessScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    offline?: string; status?: string; checkedInAt?: string; distanceToStop?: string;
  }>();

  const user = useAuth((s) => s.user);
  const { data } = useStudentHome();

  const isOffline = params.offline === 'true';
  const isLateBoard = params.status === 'LATE_BOARD';

  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    if (!isOffline) {
      const timer = setTimeout(() => {
        if (isMounted.current) router.replace('/(student)/');
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, []);

  const checkedInAt = formatCheckedInAt(params.checkedInAt) || 'Just now';
  const busNumber = data?.transport?.trip?.busNumber || data?.student?.busNumber || '—';
  const userName = user?.name?.split(' ')[0] || 'Student'; // First name

  const iconScale = useSharedValue(0.5);
  useEffect(() => {
    iconScale.value = withSpring(1, { damping: 12, stiffness: 90 });
  }, []);

  const animatedIconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: iconScale.value }]
  }));

  // --- Render ---
  return (
    <SafeAreaView style={s.container}>
      <Animated.View entering={FadeIn.duration(400)} style={s.centerWrap}>

        <Animated.View entering={FadeInDown.duration(500).springify()} style={s.card}>

          {/* Icon Circle — outer: entering, inner: animated scale */}
          <Animated.View entering={FadeInDown.duration(400)}>
            <Animated.View style={[s.iconCircle, { backgroundColor: isOffline ? ds.warningBg : ds.successBg }, animatedIconStyle]}>
              {isOffline ? <CloudIcon /> : <CheckIcon />}
            </Animated.View>
          </Animated.View>

          {/* Title */}
          <Text style={s.title}>{isOffline ? 'Saved offline' : 'Checked in'}</Text>

          {/* Subtitle */}
          <Text style={s.subtitle}>{userName} · {busNumber}</Text>

          {/* Time & Status Pill */}
          <View style={[s.pill, { backgroundColor: isOffline ? ds.warningBg : ds.successBg }]}>
            <Text style={[s.pillText, { color: isOffline ? ds.warningText : ds.successText }]}>
              {isLateBoard ? 'Late board' : isOffline ? 'Pending sync' : 'On time'} · {checkedInAt}
            </Text>
          </View>

          {/* Secondary Pill (Seat/Distance) */}
          {params.distanceToStop && !isOffline ? (
            <View style={s.secondaryPill}>
              <Text style={s.secondaryPillText}>{params.distanceToStop}m from stop</Text>
            </View>
          ) : (
            <View style={s.secondaryPill}>
              <Text style={s.secondaryPillText}>Seat unassigned</Text>
            </View>
          )}

          {isOffline && (
            <TouchableOpacity
              style={s.button}
              onPress={() => router.replace('/(student)/')}
              activeOpacity={0.8}
            >
              <Text style={s.buttonText}>Got it</Text>
            </TouchableOpacity>
          )}

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
    fontSize: 28,
    fontWeight: typography.weights.bold,
    color: ds.textInk,
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: typography.family,
    fontSize: 14,
    color: ds.textMuted,
    marginBottom: 24,
  },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginBottom: 12,
  },
  pillText: {
    fontFamily: typography.family,
    fontSize: 13,
    fontWeight: typography.weights.bold,
  },
  secondaryPill: {
    backgroundColor: ds.bg,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginBottom: 8,
  },
  secondaryPillText: {
    fontFamily: typography.family,
    fontSize: 13,
    fontWeight: typography.weights.medium,
    color: ds.primary,
  },
  button: {
    marginTop: 24,
    backgroundColor: ds.primary,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 24,
    width: '100%',
    alignItems: 'center',
  },
  buttonText: {
    fontFamily: typography.family,
    fontSize: 15,
    fontWeight: typography.weights.bold,
    color: '#FFFFFF',
  },
});
