// app/(driver)/breakdown.tsx — Report breakdown with incident type selection
import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { driverService } from '../../services/driver.service';
import { typography } from '../../constants/theme';
import { t } from '../../i18n';
import * as Haptics from 'expo-haptics';
import { analytics } from '../../lib/analytics';
import { ScreenErrorBoundary } from '../../components/shared/ScreenErrorBoundary';

// ── Local tokens ──────────────────────────────────────────────────
const C = {
  bg: '#BFE6FF',
  ink: '#1A1A1C',
  muted: '#565656',
  surface: '#FFFFFF',
  optionSelected: '#356C8F',
  optionSelectedText: '#FFFFFF',
  optionText: '#1A1A1C',
  btnBg: '#356C8F',
  btnText: '#FFFFFF',
  btnDisabled: 'rgba(53, 108, 143, 0.25)',
  link: '#356C8F',
  linkMuted: '#565656',
};

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
    <SafeAreaView style={s.container}>
      <View style={s.layout}>

        {/* Back */}
        <TouchableOpacity onPress={() => router.back()} style={s.backWrap} activeOpacity={0.7}>
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>

        {/* Heading */}
        <View style={s.headingBlock}>
          <Text style={s.title}>{t('breakdown.title')}</Text>
          <Text style={s.subtitle}>{t('breakdown.subtitle')}</Text>
        </View>

        {/* Incident type options */}
        <View style={s.options}>
          {incidentTypes.map((type) => (
            <TouchableOpacity
              key={type}
              style={[s.option, selected === type && s.optionSelected]}
              onPress={() => setSelected(type)}
              activeOpacity={0.75}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected === type }}
            >
              <Text style={[s.optionText, selected === type && s.optionTextSelected]}>
                {t(`breakdown.types.${type}`)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Actions */}
        <View style={s.actions}>
          <TouchableOpacity
            style={[s.btn, (!selected || submitting) && s.btnDisabled]}
            onPress={handleReport}
            disabled={!selected || submitting}
            activeOpacity={0.85}
            accessibilityLabel={submitting ? 'Submitting breakdown report' : t('breakdown.reportNow')}
            accessibilityRole="button"
            accessibilityState={{ disabled: !selected || submitting, busy: submitting }}
          >
            {submitting
              ? <ActivityIndicator color={C.btnText} />
              : <Text style={s.btnText}>{t('breakdown.reportNow')}</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.back()} style={s.cancelWrap} activeOpacity={0.7}>
            <Text style={s.cancelText}>{t('breakdown.cancel')}</Text>
          </TouchableOpacity>
        </View>

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
    paddingHorizontal: 28,
    paddingTop: 20,
    paddingBottom: 36,
    gap: 24,
  },

  // Back
  backWrap: {
    alignSelf: 'flex-start',
  },
  back: {
    fontFamily: typography.family,
    fontSize: 15,
    fontWeight: '500',
    color: C.link,
  },

  // Heading
  headingBlock: {
    gap: 6,
  },
  title: {
    fontFamily: typography.family,
    fontSize: 26,
    fontWeight: '700',
    color: C.ink,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontFamily: typography.family,
    fontSize: 15,
    color: C.muted,
    lineHeight: 22,
  },

  // Options
  options: {
    gap: 8,
    flex: 1,
  },
  option: {
    backgroundColor: C.surface,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 18,
  },
  optionSelected: {
    backgroundColor: C.optionSelected,
  },
  optionText: {
    fontFamily: typography.family,
    fontSize: 15,
    fontWeight: '500',
    color: C.optionText,
  },
  optionTextSelected: {
    color: C.optionSelectedText,
  },

  // Actions
  actions: {
    gap: 10,
  },
  btn: {
    backgroundColor: C.btnBg,
    height: 54,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisabled: {
    opacity: 0.35,
  },
  btnText: {
    fontFamily: typography.family,
    fontSize: 16,
    fontWeight: '600',
    color: C.btnText,
  },
  cancelWrap: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  cancelText: {
    fontFamily: typography.family,
    fontSize: 14,
    color: C.linkMuted,
  },
});
