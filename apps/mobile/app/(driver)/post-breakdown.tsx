// app/(driver)/post-breakdown.tsx — Post-breakdown status screen
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { typography } from '../../constants/theme';
import { t } from '../../i18n';
import { ScreenErrorBoundary } from '../../components/shared/ScreenErrorBoundary';

// ── Local tokens ──────────────────────────────────────────────────
const C = {
  bg: '#BFE6FF',
  ink: '#1A1A1C',
  muted: '#565656',
  surface: '#FFFFFF',
  pill: '#FFFFFF',
  pillText: '#1A1A1C',
  link: '#356C8F',
};

const STATUS_OPTIONS = [
  { key: 'ack',        labelKey: 'breakdown.ack' },
  { key: 'onTheWay',  labelKey: 'breakdown.onTheWay' },
  { key: 'needHelp',  labelKey: 'breakdown.needHelp' },
  { key: 'willBeLate', labelKey: 'breakdown.willBeLate' },
] as const;

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
  const incidentLabel = t(`breakdown.types.${params.type}` as any) || params.type;

  return (
    <SafeAreaView style={s.container}>
      <View style={s.layout}>

        {/* Status */}
        <View style={s.statusBlock}>
          <Text style={s.statusLabel}>{t('breakdown.reported')}</Text>
          <Text style={s.incidentType}>{incidentLabel}</Text>
          <Text style={s.statusNote}>
            Transport operations have been notified and support is on the way.
          </Text>
        </View>

        {/* What next */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>{t('breakdown.whatToDoNow')}</Text>
          <View style={s.pills}>
            {STATUS_OPTIONS.map(({ key, labelKey }) => (
              <TouchableOpacity key={key} style={s.pill} activeOpacity={0.75}>
                <Text style={s.pillText}>{t(labelKey)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Return */}
        <TouchableOpacity
          style={s.returnWrap}
          onPress={() => router.replace({ pathname: '/(driver)/kiosk', params: { tripId: params.tripId } })}
          activeOpacity={0.7}
        >
          <Text style={s.returnText}>Return to kiosk</Text>
        </TouchableOpacity>

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
    paddingTop: 60,
    paddingBottom: 48,
    justifyContent: 'center',
    gap: 32,
  },

  // Status
  statusBlock: {
    gap: 8,
  },
  statusLabel: {
    fontFamily: typography.family,
    fontSize: 13,
    color: C.muted,
  },
  incidentType: {
    fontFamily: typography.family,
    fontSize: 28,
    fontWeight: '700',
    color: C.ink,
    letterSpacing: -0.5,
  },
  statusNote: {
    fontFamily: typography.family,
    fontSize: 15,
    color: C.muted,
    lineHeight: 22,
    marginTop: 2,
  },

  // Section
  section: {
    gap: 12,
  },
  sectionTitle: {
    fontFamily: typography.family,
    fontSize: 13,
    fontWeight: '600',
    color: C.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    backgroundColor: C.pill,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  pillText: {
    fontFamily: typography.family,
    fontSize: 14,
    fontWeight: '500',
    color: C.pillText,
  },

  // Return link
  returnWrap: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  returnText: {
    fontFamily: typography.family,
    fontSize: 15,
    fontWeight: '500',
    color: C.link,
  },
});
