// app/(student)/profile.tsx — Profile & Settings
// HARDENED v3:
//   - All hardcoded hex → theme tokens (LAW 2)
//   - Switch thumbColor hardcoded hex replaced with colors.white
//   - analytics.error on logout fail
//   - analytics.track on logout success
//   - ScreenErrorBoundary wrapping
import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, Switch, StyleSheet, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../store/auth.store';
import { useLanguage } from '../../i18n';
import { colors, typography, spacing, radii } from '../../constants/theme';
import { analytics } from '../../lib/analytics';
import { ScreenErrorBoundary } from '../../components/shared/ScreenErrorBoundary';
import { performLogout } from '../../lib/logout';

export default function ProfileScreen() {
  return (
    <ScreenErrorBoundary screenName="StudentProfile">
      <ProfileContent />
    </ScreenErrorBoundary>
  );
}

function ProfileContent() {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const { lang, toggleLanguage, t } = useLanguage();
  const [busAlerts, setBusAlerts] = useState(true);
  const [arrivalVerify, setArrivalVerify] = useState(true);

  const handleSignOut = () => {
    Alert.alert(
      t('profile.signOut'),
      t('profile.signOutConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('profile.signOut'),
          style: 'destructive',
          onPress: async () => {
            try {
              await performLogout();
              analytics.track('user_logout', { role: 'STUDENT' });
              router.replace('/(auth)/login');
            } catch (err) {
              analytics.error(err as Error, { context: 'logout_failed' });
              await performLogout().catch(() => {});
              router.replace('/(auth)/login');
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Indigo header with avatar */}
      <View style={styles.header}>
        <View style={styles.avatarLarge}>
          <Text style={styles.avatarText}>{user?.name?.charAt(0) || 'U'}</Text>
        </View>
        <Text style={styles.name}>{user?.name}</Text>
        {user?.rollNumber && <Text style={styles.sub}>{user.rollNumber} · {user.department}</Text>}
      </View>

      <View style={styles.body}>
        {/* Route assignment card */}
        {user?.routeAssignment && (
          <View style={styles.card}>
            <SettingRow label={t('profile.route')} value={user.routeAssignment.route.name} />
            <SettingRow label={t('profile.stop')} value={user.routeAssignment.stop.name} />
          </View>
        )}

        {/* Settings card */}
        <View style={[styles.card, { marginTop: spacing.md }]}>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>{t('profile.language')}</Text>
            <Text style={styles.settingValue}>{lang === 'en' ? 'English' : 'தமிழ்'}</Text>
          </View>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>{t('profile.tamil')}</Text>
            <Switch
              value={lang === 'ta'}
              onValueChange={toggleLanguage}
              trackColor={{ false: colors.neutral.bg, true: colors.success.bg }}
              thumbColor={lang === 'ta' ? colors.success.text : colors.white}
            />
          </View>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>{t('profile.busAlerts')}</Text>
            <Switch
              value={busAlerts}
              onValueChange={setBusAlerts}
              trackColor={{ false: colors.neutral.bg, true: colors.success.bg }}
              thumbColor={busAlerts ? colors.success.text : colors.white}
            />
          </View>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>{t('profile.arrivalVerify')}</Text>
            <Switch
              value={arrivalVerify}
              onValueChange={setArrivalVerify}
              trackColor={{ false: colors.neutral.bg, true: colors.success.bg }}
              thumbColor={arrivalVerify ? colors.success.text : colors.white}
            />
          </View>
        </View>

        {/* Sign out */}
        <TouchableOpacity onPress={handleSignOut} style={styles.signOut}>
          <Text style={styles.signOutText}>{t('profile.signOut')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={settingStyles.row}>
      <Text style={settingStyles.label}>{label}</Text>
      <Text style={settingStyles.value}>{value}</Text>
    </View>
  );
}

const settingStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.card.border,
  },
  label: {
    fontFamily: typography.family, fontSize: typography.sizes.body,
    color: colors.text.secondary,
  },
  value: {
    fontFamily: typography.family, fontSize: typography.sizes.body,
    fontWeight: typography.weights.medium, color: colors.text.primary,
  },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    backgroundColor: colors.brand.primary,
    paddingHorizontal: spacing.xl, paddingTop: spacing.xl,
    paddingBottom: spacing.xl, alignItems: 'center',
  },
  avatarLarge: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)', // keep rgba for transparent overlay on primary brand
    justifyContent: 'center', alignItems: 'center',
  },
  avatarText: {
    fontFamily: typography.family, fontSize: typography.sizes.h2,
    fontWeight: typography.weights.bold, color: colors.white,
  },
  name: {
    fontFamily: typography.family, fontSize: typography.sizes.h1,
    fontWeight: typography.weights.bold, color: colors.white, marginTop: spacing.xs,
  },
  sub: {
    fontFamily: typography.family, fontSize: typography.sizes.small,
    color: 'rgba(255,255,255,0.7)', marginTop: 2,
  },
  body: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  card: {
    backgroundColor: colors.card.bg, borderWidth: 1, borderColor: colors.card.border,
    borderRadius: radii.md, padding: spacing.md,
  },
  settingRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.card.border,
  },
  settingLabel: {
    fontFamily: typography.family, fontSize: typography.sizes.body,
    color: colors.text.primary,
  },
  settingValue: {
    fontFamily: typography.family, fontSize: typography.sizes.body,
    color: colors.text.secondary,
  },
  signOut: {
    marginTop: spacing.xl, paddingVertical: spacing.sm,
  },
  signOutText: {
    fontFamily: typography.family, fontSize: typography.sizes.body,
    color: colors.error.text, textAlign: 'center',
  },
});
