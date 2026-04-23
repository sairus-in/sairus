// app/(driver)/breakdown.tsx — Report breakdown with incident type selection
// HARDENED v3:
//   - All hardcoded hex → theme tokens (LAW 2)
//   - console.error → analytics.error (LAW 5)
//   - analytics.track on report submission (critical safety action) (LAW 6)
//   - ScreenErrorBoundary wrapping
import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { driverService } from '../../services/driver.service';
import { colors, typography, spacing, radii } from '../../constants/theme';
import { t } from '../../i18n';
import * as Haptics from 'expo-haptics';
import { analytics } from '../../lib/analytics';
import { ScreenErrorBoundary } from '../../components/shared/ScreenErrorBoundary';

const incidentTypes = ['FLAT_TYRE', 'ENGINE_FAILURE', 'ACCIDENT', 'FUEL_ISSUE', 'OTHER'] as const;

export default function BreakdownScreen() {
  return (
    <ScreenErrorBoundary screenName="DriverBreakdown">
      <BreakdownContent />
    </ScreenErrorBoundary>
  );
}

function BreakdownContent() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tripId: string }>();
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleReport = async () => {
    if (!selected || !params.tripId) return;
    setSubmitting(true);
    try {
      await driverService.reportBreakdown({
        tripId: params.tripId,
        incidentType: selected,
        lat: 0,
        lon: 0,
      });
      analytics.track('breakdown_reported', { tripId: params.tripId, incidentType: selected });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace({ pathname: '/(driver)/post-breakdown', params: { tripId: params.tripId, type: selected } });
    } catch (err: any) {
      analytics.error(err as Error, { context: 'breakdown_report_submit', tripId: params.tripId });
      Alert.alert(t('common.error'), err.message || 'Failed to submit breakdown report.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('breakdown.title')}</Text>
        <Text style={styles.subtitle}>{t('breakdown.subtitle')}</Text>
      </View>

      <View style={styles.body}>
        {incidentTypes.map((type) => (
          <TouchableOpacity
            key={type}
            style={[styles.option, selected === type && styles.optionSelected]}
            onPress={() => setSelected(type)}
            activeOpacity={0.7}
          >
            <Text style={[styles.optionText, selected === type && styles.optionTextSelected]}>
              {t(`breakdown.types.${type}`)}
            </Text>
          </TouchableOpacity>
        ))}

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.reportBtn, !selected && styles.reportDisabled]}
            onPress={handleReport}
            disabled={!selected || submitting}
            activeOpacity={0.8}
          >
            {submitting ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.reportText}>{t('breakdown.reportNow')}</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.back()} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>{t('breakdown.cancel')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.xl, paddingTop: spacing.md },
  back: {
    fontFamily: typography.family, fontSize: typography.sizes.body,
    color: colors.brand.primary, marginBottom: spacing.md,
  },
  title: {
    fontFamily: typography.family, fontSize: typography.sizes.h1,
    fontWeight: typography.weights.bold, color: colors.text.primary,
  },
  subtitle: {
    fontFamily: typography.family, fontSize: typography.sizes.body,
    color: colors.text.secondary, marginTop: 2,
  },
  body: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl },
  option: {
    backgroundColor: colors.card.bg, borderWidth: 1.5, borderColor: colors.card.border,
    borderRadius: radii.sm, paddingVertical: spacing.md, paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
  },
  optionSelected: { borderColor: colors.error.border, backgroundColor: colors.error.bg },
  optionText: {
    fontFamily: typography.family, fontSize: typography.sizes.body,
    fontWeight: typography.weights.medium, color: colors.text.primary,
  },
  optionTextSelected: { color: colors.error.text },
  actions: { marginTop: spacing.xl },
  reportBtn: {
    backgroundColor: colors.error.text, paddingVertical: 15,
    borderRadius: radii.button, alignItems: 'center', minHeight: 50,
  },
  reportDisabled: { opacity: 0.4 },
  reportText: {
    fontFamily: typography.family, fontSize: 15,
    fontWeight: typography.weights.semibold, color: colors.white,
  },
  cancelBtn: { marginTop: spacing.sm, alignItems: 'center' },
  cancelText: {
    fontFamily: typography.family, fontSize: typography.sizes.small,
    color: colors.text.muted,
  },
});
