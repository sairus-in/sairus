// app/(student)/checkin-success.tsx — Check-in success screen (3 states)
// HARDENED v3:
//   - All hardcoded hex colors → theme tokens (LAW 2)
//   - checkedInAt ISO string formatted to human time before display
//   - Auto-navigate timer is mount-safe (no router.replace if unmounted)
//   - Distinct offline copy clearly distinct from online success
import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { colors, typography, spacing, radii } from '../../constants/theme';
import { t } from '../../i18n';
import { useAuth } from '../../store/auth.store';

/** Safe ISO timestamp formatter — returns 'HH:MM AM/PM' or raw string if unparseable */
function formatCheckedInAt(raw: string | undefined): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw; // fallback: show whatever server gave us
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function CheckinSuccessScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    offline?: string; status?: string; checkedInAt?: string; distanceToStop?: string;
  }>();
  const user = useAuth((s) => s.user);
  const isOffline = params.offline === 'true';
  const isLateBoard = params.status === 'LATE_BOARD';

  // Mount-safe ref — don't navigate if screen unmounted before timer fires
  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // Auto-navigate home — only for confirmed online check-in (offline needs explicit tap)
    if (!isOffline) {
      const timer = setTimeout(() => {
        if (isMounted.current) router.replace('/(student)/');
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, []);

  const checkedInAt = formatCheckedInAt(params.checkedInAt);

  // --- OFFLINE SUCCESS ---
  if (isOffline) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.warning.bg }]}>
        <View style={styles.content}>
          <Text style={styles.icon}>☁️</Text>
          <Text style={[styles.title, { color: colors.warning.text }]}>
            {t('checkinSuccess.savedOffline')}
          </Text>
          <Text style={styles.subtitle}>
            {t('checkinSuccess.willSync')}
          </Text>
          <View style={styles.offlineInfoCard}>
            <Text style={styles.offlineInfoText}>
              Your check-in is securely stored on this device and will sync automatically when connection is restored.
            </Text>
          </View>
          <TouchableOpacity
            style={styles.button}
            onPress={() => router.replace('/(student)/')}
            activeOpacity={0.8}
          >
            <Text style={styles.buttonText}>{t('checkinSuccess.gotIt')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // --- ONLINE SUCCESS (PRESENT or LATE_BOARD) ---
  const bgColor = isLateBoard ? colors.warning.bg : colors.success.bg;
  const textColor = isLateBoard ? colors.warning.text : colors.success.text;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bgColor }]}>
      <View style={styles.content}>
        <Text style={styles.checkIcon}>{isLateBoard ? '~' : '✓'}</Text>
        <Text style={[styles.title, { color: textColor }]}>
          {isLateBoard ? t('checkinSuccess.checkedInLate') : t('checkinSuccess.checkedIn')}
        </Text>
        {isLateBoard ? (
          <Text style={styles.subtitle}>{t('checkinSuccess.bitFar')}</Text>
        ) : (
          <Text style={styles.subtitle}>
            {t('checkinSuccess.haveGreatDay', { name: user?.name || '' })}
          </Text>
        )}

        {(checkedInAt || params.distanceToStop) && (
          <View style={styles.detailCard}>
            <Text style={styles.detailText}>
              {checkedInAt ?? ''}
              {params.distanceToStop ? ` · ${params.distanceToStop}m from stop` : ''}
            </Text>
          </View>
        )}

        <Text style={styles.returning}>{t('checkinSuccess.returning')}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  checkIcon: { fontSize: 48, marginBottom: spacing.md },
  icon: { fontSize: 40, marginBottom: spacing.md },
  title: {
    fontFamily: typography.family, fontSize: typography.sizes.h1,
    fontWeight: typography.weights.bold, textAlign: 'center',
  },
  subtitle: {
    fontFamily: typography.family, fontSize: typography.sizes.h3,
    fontWeight: typography.weights.regular, color: colors.text.secondary,
    marginTop: spacing.xs, textAlign: 'center',
  },
  detailCard: {
    backgroundColor: colors.card.bg, borderRadius: radii.sm,
    padding: spacing.md, marginTop: spacing.xl,
    borderWidth: 1, borderColor: colors.card.border,
  },
  detailText: {
    fontFamily: typography.family, fontSize: typography.sizes.body,
    color: colors.text.secondary,
  },
  returning: {
    fontFamily: typography.family, fontSize: typography.sizes.small,
    color: colors.text.muted, marginTop: spacing['2xl'],
  },
  offlineInfoCard: {
    backgroundColor: colors.card.bg, borderRadius: radii.sm,
    padding: spacing.md, marginTop: spacing.lg, marginBottom: spacing.lg,
    borderWidth: 1, borderColor: colors.warning.border,
  },
  offlineInfoText: {
    fontFamily: typography.family, fontSize: typography.sizes.body,
    color: colors.text.secondary, textAlign: 'center', lineHeight: 22,
  },
  button: {
    backgroundColor: colors.button.primary.bg, paddingVertical: 15,
    paddingHorizontal: spacing['2xl'], borderRadius: radii.button,
    marginTop: spacing.xl,
  },
  buttonText: {
    fontFamily: typography.family, fontSize: 15,
    fontWeight: typography.weights.semibold, color: colors.button.primary.text,
  },
});
