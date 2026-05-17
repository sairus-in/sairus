// app/(auth)/pending.tsx — Registered, awaiting route assignment
import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { typography, spacingExtended } from '../../constants/theme';
import { t } from '../../i18n';
import { config } from '../../lib/config';
import { fetchMobileProfile } from '../../lib/mobile-profile';
import { useAuth } from '../../store/auth.store';
import { ErrorState } from '../../components/shared/ErrorState';

// ── Local tokens — warm palette, consistent with auth screens ──
const C = {
  bg: '#BFE6FF',
  ink: '#1A1A1C',
  muted: '#565656',
  ghost: '#C9C9C9',
  border: '#E9E9E9',
  surface: '#FFFFFF',
  btnBg: '#356C8F',
  btnText: '#FFFFFF',
  link: '#356C8F',
};

export default function PendingScreen() {
  const reduceMotion = useReducedMotion();
  const user = useAuth(s => s.user);
  const setUser = useAuth(s => s.setUser);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const firstName = user?.name?.split(' ')[0] || '';

  // Auto-poll every 2 minutes
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const profile = await fetchMobileProfile();
        if (profile.routeAssignment) {
          setUser(profile);
        }
      } catch {}
    }, 120_000);

    return () => clearInterval(interval);
  }, [setUser]);

  const handleCheckAgain = async () => {
    setChecking(true);
    setError(null);
    try {
      const profile = await fetchMobileProfile();
      if (profile.routeAssignment) {
        setUser(profile);
      } else {
        setLastChecked(new Date());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to refresh assignment status.');
    }
    setChecking(false);
  };

  const handleContact = () => {
    Linking.openURL(`tel:${config.supportPhone}`);
  };

  const identityParts = [
    user?.department,
    user?.year ? `Year ${user.year}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <SafeAreaView style={s.container}>
      <View style={s.layout}>

        {/* ── Identity block ── */}
        <Animated.View
          entering={reduceMotion ? undefined : FadeInDown.duration(500).springify().damping(18)}
          style={s.identityBlock}
        >
          <Text style={s.welcomeLabel}>{t('auth.welcome', { name: '' }).trim()}</Text>
          <Text style={s.nameText}>{firstName || user?.name || 'Welcome'}</Text>

          {(identityParts || user?.rollNumber) ? (
            <View style={s.identityMeta}>
              {!!identityParts && (
                <Text style={s.identityText}>{identityParts}</Text>
              )}
              {!!user?.rollNumber && (
                <Text style={s.identityText}>Roll {user.rollNumber}</Text>
              )}
            </View>
          ) : null}
        </Animated.View>

        {/* ── Status card ── */}
        <Animated.View
          entering={reduceMotion ? undefined : FadeInDown.duration(500).delay(100).springify().damping(18)}
          style={s.statusCard}
        >
          <Text style={s.statusTitle}>{t('auth.pendingAssignment')}</Text>
          <Text style={s.statusBody}>
            The transport office assigns routes before the semester starts.
            Your profile is registered and your route will appear here automatically.
          </Text>
          <View style={s.statusFooter}>
            <View style={s.pulseDot} />
            <Text style={s.statusFooterText}>
              {lastChecked
                ? `Last checked ${lastChecked.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                : 'Checking automatically every 2 minutes'}
            </Text>
          </View>
        </Animated.View>

        {/* ── Actions ── */}
        <Animated.View
          entering={reduceMotion ? undefined : FadeInDown.duration(500).delay(200).springify().damping(18)}
          style={s.actions}
        >
          {error && (
            <View style={s.errorWrap}>
              <ErrorState message={error} onRetry={handleCheckAgain} />
            </View>
          )}

          <TouchableOpacity
            style={[s.btn, checking && s.btnChecking]}
            onPress={handleCheckAgain}
            disabled={checking}
            activeOpacity={0.85}
            accessibilityLabel={checking ? 'Checking assignment status' : t('auth.checkAgain')}
            accessibilityRole="button"
            accessibilityState={{ busy: checking }}
          >
            {checking
              ? <ActivityIndicator color={C.btnText} />
              : <Text style={s.btnText}>{t('auth.checkAgain')}</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity
            style={s.linkBtn}
            onPress={handleContact}
            activeOpacity={0.7}
            accessibilityLabel={t('auth.contactOffice')}
            accessibilityRole="button"
          >
            <Text style={s.linkBtnText}>{t('auth.contactOffice')}</Text>
          </TouchableOpacity>
        </Animated.View>

      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  layout: {
    flex: 1,
    paddingHorizontal: spacingExtended.screen + 8,
    justifyContent: 'center',
    gap: 24,
  },

  // Identity
  identityBlock: {
    gap: 4,
  },
  welcomeLabel: {
    fontFamily: typography.family,
    fontSize: 13,
    color: C.muted,
  },
  nameText: {
    fontFamily: typography.family,
    fontSize: 30,
    fontWeight: '700',
    color: C.ink,
    letterSpacing: -0.6,
  },
  identityMeta: {
    marginTop: 6,
    gap: 2,
  },
  identityText: {
    fontFamily: typography.family,
    fontSize: 14,
    color: C.muted,
  },

  // Status card
  statusCard: {
    backgroundColor: C.surface,
    borderRadius: 18,
    padding: 20,
    gap: 10,
  },
  statusTitle: {
    fontFamily: typography.family,
    fontSize: 15,
    fontWeight: '600',
    color: C.ink,
  },
  statusBody: {
    fontFamily: typography.family,
    fontSize: 14,
    color: C.muted,
    lineHeight: 21,
  },
  statusFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  pulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#A3D977',
  },
  statusFooterText: {
    fontFamily: typography.family,
    fontSize: 12,
    color: C.ghost,
  },

  // Actions
  actions: {
    gap: 10,
  },
  errorWrap: {
    minHeight: 120,
  },
  btn: {
    backgroundColor: C.btnBg,
    height: 54,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnChecking: {
    opacity: 0.6,
  },
  btnText: {
    fontFamily: typography.family,
    fontSize: 16,
    fontWeight: '600',
    color: C.btnText,
  },
  linkBtn: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  linkBtnText: {
    fontFamily: typography.family,
    fontSize: 15,
    fontWeight: '500',
    color: C.link,
  },
});
