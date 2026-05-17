// app/(auth)/dev-bypass.tsx
// ─────────────────────────────────────────────────────────────
// DEV ONLY — temporary login bypass for local testing.
// Lets you jump straight into any role without backend auth.
// Remove this file (and the reference in _layout.tsx) for production.
// ─────────────────────────────────────────────────────────────
import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import Svg, { Path, Rect, Circle } from 'react-native-svg';
import { useAuth } from '../../store/auth.store';
import { DEV_STUDENT, DEV_DRIVER } from '../../lib/dev-fixtures';

// ── Icons ──────────────────────────────────────────────────────
const StudentIcon = () => (
  <Svg width={32} height={32} viewBox="0 0 24 24" fill="none">
    <Circle cx="12" cy="8" r="4" stroke="#356C8F" strokeWidth={2} strokeLinecap="round" />
    <Path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="#356C8F" strokeWidth={2} strokeLinecap="round" />
    <Path d="M12 12l6-3-6-3-6 3 6 3z" stroke="#356C8F" strokeWidth={1.5} strokeLinejoin="round" />
  </Svg>
);

const DriverIcon = () => (
  <Svg width={32} height={32} viewBox="0 0 24 24" fill="none">
    <Rect x="3" y="6" width="18" height="13" rx="2" stroke="#356C8F" strokeWidth={2} />
    <Path d="M3 11h18" stroke="#356C8F" strokeWidth={2} strokeLinecap="round" />
    <Circle cx="7.5" cy="17.5" r="1.5" stroke="#356C8F" strokeWidth={1.5} />
    <Circle cx="16.5" cy="17.5" r="1.5" stroke="#356C8F" strokeWidth={1.5} />
    <Path d="M7 6V4M17 6V4" stroke="#356C8F" strokeWidth={2} strokeLinecap="round" />
  </Svg>
);

// ── Component ──────────────────────────────────────────────────
export default function DevBypassScreen() {
  const router = useRouter();
  const setAuthenticatedSession = useAuth(s => s.setAuthenticatedSession);
  const [loading, setLoading] = useState<'student' | 'driver' | null>(null);

  // Hard-block in production — hooks must come first to satisfy Rules of Hooks.
  if (!__DEV__) {
    return <Redirect href="/(auth)/login" />;
  }

  const login = async (role: 'student' | 'driver') => {
    setLoading(role);
    const user = role === 'student' ? DEV_STUDENT : DEV_DRIVER;
    await setAuthenticatedSession(user, {
      token: `dev_token_${role}_${Date.now()}`,
      deviceId: 'dev_device_001',
    });
    router.replace(role === 'driver' ? '/(driver)/' : '/(student)/');
  };

  return (
    <View style={s.container}>

      {/* Header */}
      <Animated.View entering={FadeInDown.duration(500).springify()} style={s.header}>
        <View style={s.devBadge}>
          <Text style={s.devBadgeText}>⚡ DEV BYPASS</Text>
        </View>
        <Text style={s.title}>Select a Role</Text>
        <Text style={s.subtitle}>
          Skip authentication for local development.{'\n'}
          Remove before production.
        </Text>
      </Animated.View>

      {/* Role Cards */}
      <View style={s.cardsRow}>

        {/* Student Card */}
        <Animated.View entering={FadeInDown.duration(500).delay(100).springify()} style={s.cardWrap}>
          <TouchableOpacity
            style={[s.card, loading === 'student' && s.cardActive]}
            onPress={() => login('student')}
            disabled={!!loading}
            activeOpacity={0.8}
          >
            <View style={s.iconWrap}>
              {loading === 'student'
                ? <ActivityIndicator size="small" color="#356C8F" />
                : <StudentIcon />
              }
            </View>
            <Text style={s.cardTitle}>Student</Text>
            <Text style={s.cardSub}>Home · Scanner · Map</Text>
            <View style={s.cardFooter}>
              <Text style={s.cardFooterText}>Route A · Main Gate</Text>
            </View>
          </TouchableOpacity>
        </Animated.View>

        {/* Driver Card */}
        <Animated.View entering={FadeInDown.duration(500).delay(200).springify()} style={s.cardWrap}>
          <TouchableOpacity
            style={[s.card, loading === 'driver' && s.cardActive]}
            onPress={() => login('driver')}
            disabled={!!loading}
            activeOpacity={0.8}
          >
            <View style={s.iconWrap}>
              {loading === 'driver'
                ? <ActivityIndicator size="small" color="#356C8F" />
                : <DriverIcon />
              }
            </View>
            <Text style={s.cardTitle}>Driver</Text>
            <Text style={s.cardSub}>Kiosk · Trip · QR</Text>
            <View style={s.cardFooter}>
              <Text style={s.cardFooterText}>Bus KA-01-DEV-42</Text>
            </View>
          </TouchableOpacity>
        </Animated.View>

      </View>

      {/* Footer warning */}
      <Animated.View entering={FadeInUp.duration(400).delay(300)} style={s.warning}>
        <Text style={s.warningText}>
          🚨 This screen is only visible in <Text style={s.warningBold}>__DEV__</Text> mode.
          It bypasses Firebase auth entirely.
        </Text>
      </Animated.View>

    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#BFE6FF',
    paddingHorizontal: 24,
    paddingTop: 80,
    paddingBottom: 40,
    justifyContent: 'space-between',
  },
  header: {
    alignItems: 'center',
    gap: 12,
  },
  devBadge: {
    backgroundColor: '#356C8F',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
  },
  devBadgeText: {
    color: '#BFE6FF',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1A1A1C',
    letterSpacing: -0.5,
    marginTop: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#565656',
    textAlign: 'center',
    lineHeight: 20,
  },
  cardsRow: {
    flexDirection: 'row',
    gap: 16,
  },
  cardWrap: {
    flex: 1,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  cardActive: {
    borderColor: '#356C8F',
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: '#BFE6FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A1A1C',
  },
  cardSub: {
    fontSize: 12,
    color: '#565656',
    textAlign: 'center',
  },
  cardFooter: {
    marginTop: 8,
    backgroundColor: '#BFE6FF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  cardFooterText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#356C8F',
  },
  warning: {
    backgroundColor: '#FFF3E0',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#FFE0B2',
  },
  warningText: {
    fontSize: 12,
    color: '#E65100',
    textAlign: 'center',
    lineHeight: 18,
  },
  warningBold: {
    fontWeight: '700',
  },
});
