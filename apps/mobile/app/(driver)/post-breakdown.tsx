// app/(driver)/post-breakdown.tsx — Post-breakdown status screen
// HARDENED v3:
//   - All hex colors removed
//   - ScreenErrorBoundary wrapping
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing, radii } from '../../constants/theme';
import { t } from '../../i18n';
import { ScreenErrorBoundary } from '../../components/shared/ScreenErrorBoundary';

export default function PostBreakdownScreen() {
  return (
    <ScreenErrorBoundary screenName="DriverPostBreakdown">
      <PostBreakdownContent />
    </ScreenErrorBoundary>
  );
}

function PostBreakdownContent() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tripId: string; type: string }>();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.icon}>⚠️</Text>
          <Text style={styles.title}>{t('breakdown.reported')}</Text>
          <Text style={styles.type}>
            {t(`breakdown.types.${params.type}` as any) || params.type}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('breakdown.whatToDoNow')}</Text>
          <View style={styles.optionsRow}>
            {[
              { key: 'ack', label: t('breakdown.ack') },
              { key: 'onTheWay', label: t('breakdown.onTheWay') },
              { key: 'needHelp', label: t('breakdown.needHelp') },
              { key: 'willBeLate', label: t('breakdown.willBeLate') },
            ].map((opt) => (
              <TouchableOpacity key={opt.key} style={styles.optionPill} activeOpacity={0.7}>
                <Text style={styles.optionText}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.replace({ pathname: '/(driver)/kiosk', params: { tripId: params.tripId } })}
        >
          <Text style={styles.backText}>Return to kiosk</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  content: {
    flex: 1, justifyContent: 'center', paddingHorizontal: spacing.xl,
  },
  card: {
    backgroundColor: colors.error.bg, borderWidth: 1, borderColor: colors.error.border,
    borderRadius: radii.md, padding: spacing.xl, alignItems: 'center',
  },
  icon: { fontSize: 40, marginBottom: spacing.md },
  title: {
    fontFamily: typography.family, fontSize: typography.sizes.h2,
    fontWeight: typography.weights.semibold, color: colors.error.text,
    textAlign: 'center',
  },
  type: {
    fontFamily: typography.family, fontSize: typography.sizes.body,
    color: colors.text.secondary, marginTop: spacing.micro,
  },
  section: { marginTop: spacing.xl },
  sectionTitle: {
    fontFamily: typography.family, fontSize: typography.sizes.h3,
    fontWeight: typography.weights.semibold, color: colors.text.primary,
    marginBottom: spacing.sm,
  },
  optionsRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs,
  },
  optionPill: {
    backgroundColor: colors.card.bg, borderWidth: 1, borderColor: colors.card.border,
    borderRadius: radii.pill, paddingVertical: spacing.xs, paddingHorizontal: spacing.md,
  },
  optionText: {
    fontFamily: typography.family, fontSize: typography.sizes.small,
    fontWeight: typography.weights.medium, color: colors.text.primary,
  },
  backBtn: {
    marginTop: spacing.xl, paddingVertical: spacing.sm, alignItems: 'center',
  },
  backText: {
    fontFamily: typography.family, fontSize: typography.sizes.body,
    fontWeight: typography.weights.medium, color: colors.brand.primary,
  },
});
