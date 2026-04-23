// app/(auth)/pending.tsx — Authenticated but no route assigned
import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing, radii } from '../../constants/theme';
import { t } from '../../i18n';
import { config } from '../../lib/config';
import { fetchMobileProfile } from '../../lib/mobile-profile';
import { useAuth } from '../../store/auth.store';
import { ErrorState } from '../../components/shared/ErrorState';

export default function PendingScreen() {
  const router = useRouter();
  const user = useAuth(s => s.user);
  const setUser = useAuth(s => s.setUser);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-poll every 2 minutes
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const profile = await fetchMobileProfile();
        if (profile.routeAssignment) {
          setUser(profile);
          // Root layout will auto-redirect to student home
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
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to refresh assignment status.');
    }
    setChecking(false);
  };

  const handleContact = () => {
    Linking.openURL(`tel:${config.supportPhone}`);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.greeting}>
          {t('auth.welcome', { name: user?.name || '' })}
        </Text>
      </View>

      <View style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('auth.pendingAssignment')}</Text>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Name</Text>
            <Text style={styles.infoValue}>{user?.name}</Text>
          </View>
          {user?.rollNumber && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Roll No.</Text>
              <Text style={styles.infoValue}>{user.rollNumber}</Text>
            </View>
          )}
          {user?.department && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Department</Text>
              <Text style={styles.infoValue}>{user.department}</Text>
            </View>
          )}
          {user?.year && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Year</Text>
              <Text style={styles.infoValue}>{String(user.year)}</Text>
            </View>
          )}
        </View>

        <TouchableOpacity
          style={styles.primaryButton}
          onPress={handleCheckAgain}
          disabled={checking}
          activeOpacity={0.8}
        >
          {checking ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.primaryButtonText}>{t('auth.checkAgain')}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.outlineButton} onPress={handleContact} activeOpacity={0.7}>
          <Text style={styles.outlineButtonText}>{t('auth.contactOffice')}</Text>
        </TouchableOpacity>

        {error && (
          <View style={styles.errorWrap}>
            <ErrorState message={error} onRetry={handleCheckAgain} />
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    backgroundColor: colors.brand.primary,
    paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xl,
  },
  greeting: {
    fontFamily: typography.family, fontSize: typography.sizes.h1,
    fontWeight: typography.weights.bold, color: '#FFFFFF',
  },
  content: {
    flex: 1, paddingHorizontal: spacing.xl, paddingTop: spacing.xl,
  },
  card: {
    backgroundColor: colors.card.bg, borderWidth: 1, borderColor: colors.card.border,
    borderRadius: radii.md, padding: spacing.md,
  },
  cardTitle: {
    fontFamily: typography.family, fontSize: typography.sizes.h3,
    fontWeight: typography.weights.semibold, color: colors.text.primary,
    marginBottom: spacing.md,
  },
  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    borderTopWidth: 1, borderTopColor: colors.card.border,
  },
  infoLabel: {
    fontFamily: typography.family, fontSize: typography.sizes.body,
    color: colors.text.secondary,
  },
  infoValue: {
    fontFamily: typography.family, fontSize: typography.sizes.body,
    fontWeight: typography.weights.medium, color: colors.text.primary,
  },
  primaryButton: {
    backgroundColor: colors.button.primary.bg, paddingVertical: 15,
    borderRadius: radii.button, alignItems: 'center',
    marginTop: spacing.xl, minHeight: 50,
  },
  primaryButtonText: {
    fontFamily: typography.family, fontSize: 15,
    fontWeight: typography.weights.semibold, color: colors.button.primary.text,
  },
  outlineButton: {
    borderWidth: 1.5, borderColor: colors.button.outline.border,
    paddingVertical: 15, borderRadius: radii.button,
    alignItems: 'center', marginTop: spacing.sm,
  },
  outlineButtonText: {
    fontFamily: typography.family, fontSize: 15,
    fontWeight: typography.weights.semibold, color: colors.button.outline.text,
  },
  errorWrap: {
    marginTop: spacing.lg,
    minHeight: 180,
  },
});
