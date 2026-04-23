// app/(student)/verify-arrival.tsx — Auto-fires GPS verification on mount
import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Location from 'expo-location';
import { studentService } from '../../services/student.service';
import { colors, typography, spacing } from '../../constants/theme';
import { t } from '../../i18n';
import { ErrorState } from '../../components/shared/ErrorState';

type VerifyState = 'loading' | 'success' | 'error';

export default function VerifyArrivalScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tripId: string }>();
  const [state, setState] = useState<VerifyState>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const verify = async () => {
      try {
        setState('loading');
        setError(null);
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        await studentService.verifyArrival({
          tripId: params.tripId!,
          lat: location.coords.latitude,
          lon: location.coords.longitude,
          method: 'PUSH_NOTIFICATION',
        });
        if (cancelled) {
          return;
        }
        setState('success');
        timeoutId = setTimeout(() => {
          router.back();
        }, 1500);
      } catch (err) {
        if (cancelled) {
          return;
        }
        setState('error');
        setError(err instanceof Error ? err.message : 'Arrival verification failed.');
      }
    };
    void verify();

    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [params.tripId, router]);

  if (state === 'error') {
    return <ErrorState message={error ?? t('common.error')} onRetry={() => router.replace(`/(student)/verify-arrival?tripId=${params.tripId}`)} />;
  }

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={colors.brand.primary} />
      <Text style={styles.text}>{state === 'success' ? 'Arrival verified.' : t('arrival.verifying')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: colors.surface,
  },
  text: {
    fontFamily: typography.family, fontSize: typography.sizes.h3,
    color: colors.text.secondary, marginTop: spacing.lg,
  },
});
