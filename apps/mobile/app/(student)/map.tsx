import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useStudentHome } from '../../hooks/useStudentHome';
import { useLiveBus } from '../../hooks/useLiveBus';
import { EmptyState } from '../../components/shared/EmptyState';
import { colors, typography, spacing, radii, statusPill } from '../../constants/theme';
import { t } from '../../i18n';

export default function MapScreen() {
  const { data } = useStudentHome();
  const trip = data?.transport?.trip ?? null;
  const busId = trip?.busId || null;
  const { busLocation, studentUI } = useLiveBus(busId);

  if (!busId) {
    return (
      <SafeAreaView style={styles.container}>
        <EmptyState title={t('map.noTrip')} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {studentUI.showBanner && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>{studentUI.bannerText}</Text>
        </View>
      )}

      <View style={[styles.mapPlaceholder, { opacity: studentUI.markerOpacity || 0.1 }]}>
        <Text style={styles.mapPlaceholderText}>
          Live Map{'\n'}
          {busLocation
            ? `Bus: ${busLocation.lat.toFixed(4)}, ${busLocation.lon.toFixed(4)}${studentUI.etaVisible ? `\nSpeed: ${busLocation.speed.toFixed(0)} km/h` : ''}`
            : 'Waiting for GPS data...'}
        </Text>
      </View>

      {busLocation && (
        <View style={styles.overlayCard}>
          <View style={styles.overlayHeader}>
            <Text style={styles.overlayBus}>Bus {trip?.busNumber || data?.student?.busNumber || '-'}</Text>
            {studentUI.etaVisible && (
              <View style={[styles.speedPill, { backgroundColor: statusPill.PRESENT.bg }]}>
                <Text style={[styles.speedText, { color: statusPill.PRESENT.text }]}>
                  {t('map.speed', { speed: String(Math.round(busLocation.speed)) })}
                </Text>
              </View>
            )}
          </View>
          <Text style={styles.overlayStop}>
            {t('map.nextStop', { stop: data?.student?.stopName || '' })}
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  offlineBanner: {
    backgroundColor: colors.warning.bg,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
  },
  offlineText: {
    fontFamily: typography.family,
    fontSize: typography.sizes.micro,
    color: colors.warning.text,
  },
  mapPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#E5E7EB',
  },
  mapPlaceholderText: {
    fontFamily: typography.family,
    fontSize: typography.sizes.body,
    color: colors.text.secondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  overlayCard: {
    position: 'absolute',
    bottom: spacing['2xl'],
    left: spacing.xl,
    right: spacing.xl,
    backgroundColor: colors.card.bg,
    borderWidth: 1,
    borderColor: colors.card.border,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  overlayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  overlayBus: {
    fontFamily: typography.family,
    fontSize: typography.sizes.h3,
    fontWeight: typography.weights.semibold,
    color: colors.text.primary,
  },
  speedPill: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 3,
    borderRadius: radii.pill,
  },
  speedText: {
    fontFamily: typography.family,
    fontSize: typography.sizes.micro,
    fontWeight: typography.weights.semibold,
  },
  overlayStop: {
    fontFamily: typography.family,
    fontSize: typography.sizes.small,
    color: colors.text.secondary,
    marginTop: spacing.micro,
  },
});
