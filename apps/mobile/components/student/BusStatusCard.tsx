import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, typography, spacing, radii, statusPill } from '../../constants/theme';
import { t } from '../../i18n';
import type { BusLocation } from '../../hooks/useLiveBus';
import type { TripScreenState } from '../../lib/trip-state';
import type { StudentHomeResponseV3 } from '../../lib/schemas';

interface BusStatusCardProps {
  state: TripScreenState;
  trip: StudentHomeResponseV3['transport']['trip'];
  stopName?: string | null;
  busLocation: BusLocation | null;
}

function StatusPill({ label, type }: { label: string; type: keyof typeof statusPill }) {
  const preset = statusPill[type] || statusPill.NOT_STARTED;
  return (
    <View style={[styles.pill, { backgroundColor: preset.bg }]}>
      <Text style={[styles.pillText, { color: preset.text }]}>{label}</Text>
    </View>
  );
}

export function BusStatusCard({ state, trip, stopName, busLocation }: BusStatusCardProps) {
  if (state.type === 'NO_TRIP' || state.type === 'UNKNOWN') {
    return (
      <View style={styles.card}>
        <Text style={styles.noTripTitle}>{t('home.noTrip')}</Text>
        <Text style={styles.noTripSub}>{t('home.noTripSub')}</Text>
      </View>
    );
  }

  const busNumber = trip?.busNumber || '';
  const destinationLabel = stopName || trip?.routeName || '';

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.busNumber}>Bus {busNumber}</Text>
          <Text style={styles.routeName}>{destinationLabel}</Text>
        </View>

        {state.type === 'ACTIVE' && (
          <StatusPill label={t('home.approaching', { minutes: '...' })} type="PRESENT" />
        )}
        {state.type === 'ACTIVE' && state.gpsStatus === 'OFFLINE' && (
          <StatusPill label={t('home.gpsOffline')} type="OFFLINE" />
        )}
        {state.type === 'NOT_STARTED' && (
          <StatusPill label={t('home.notStarted')} type="NOT_STARTED" />
        )}
        {state.type === 'CHECKED_IN' && (
          <StatusPill label="Checked in" type="PRESENT" />
        )}
        {state.type === 'WINDOW_CLOSED' && (
          <StatusPill label={t('home.windowClosed')} type="NOT_STARTED" />
        )}
      </View>

      {state.type === 'ACTIVE' && (
        <View style={styles.infoRow}>
          <View style={[styles.dot, { backgroundColor: colors.success.text }]} />
          <Text style={styles.infoText}>
            {t('home.pickingUp', { stop: destinationLabel })}
          </Text>
        </View>
      )}

      {state.type === 'ACTIVE' && state.gpsStatus === 'OFFLINE' && (
        <View style={styles.infoRow}>
          <View style={[styles.dot, { backgroundColor: colors.warning.text }]} />
          <Text style={[styles.infoText, { color: colors.warning.text }]}>
            {busLocation
              ? t('home.lastSeen', { minutes: String(Math.floor((Date.now() - busLocation.lastUpdated) / 60000)) })
              : t('home.gpsOffline')}
          </Text>
        </View>
      )}

      {(state.type === 'NOT_STARTED' || state.type === 'LATE_START') && trip && (
        <View style={styles.infoRow}>
          <View style={[styles.dot, { backgroundColor: colors.neutral.text }]} />
          <Text style={styles.infoText}>
            {trip.scheduledDeparture
              ? t('home.scheduled', { time: trip.scheduledDeparture })
              : t('home.notStarted')}
            {state.type === 'LATE_START' && (
              <Text style={{ color: colors.error.text }}>
                {' - '}{t('home.minutesLate', { minutes: String(state.minutesLate) })}
              </Text>
            )}
          </Text>
        </View>
      )}

      {state.type === 'WINDOW_CLOSED' && (
        <Text style={[styles.infoText, { marginTop: spacing.xs }]}>
          {t('home.checkInEnded')}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card.bg,
    borderWidth: 1,
    borderColor: colors.card.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  busNumber: {
    fontFamily: typography.family,
    fontSize: typography.sizes.h3,
    fontWeight: typography.weights.semibold,
    color: colors.text.primary,
  },
  routeName: {
    fontFamily: typography.family,
    fontSize: typography.sizes.micro,
    fontWeight: typography.weights.regular,
    color: colors.text.muted,
    marginTop: 2,
  },
  pill: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 3,
    borderRadius: radii.pill,
  },
  pillText: {
    fontFamily: typography.family,
    fontSize: typography.sizes.micro,
    fontWeight: typography.weights.semibold,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing.xs,
  },
  infoText: {
    fontFamily: typography.family,
    fontSize: typography.sizes.small,
    color: colors.text.secondary,
    flex: 1,
  },
  noTripTitle: {
    fontFamily: typography.family,
    fontSize: typography.sizes.h3,
    fontWeight: typography.weights.semibold,
    color: colors.text.primary,
    textAlign: 'center',
  },
  noTripSub: {
    fontFamily: typography.family,
    fontSize: typography.sizes.body,
    color: colors.text.muted,
    textAlign: 'center',
    marginTop: spacing.micro,
  },
});
