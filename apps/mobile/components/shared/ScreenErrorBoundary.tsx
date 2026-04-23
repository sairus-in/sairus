import React, { useCallback, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ErrorBoundary } from 'react-error-boundary';
import { queryClient as _queryClient } from '../../lib/query-client';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const queryClient = _queryClient as any;
import { useRouter } from 'expo-router';
import { analytics } from '../../lib/analytics';
import { colors, typography, spacing, radii } from '../../constants/theme';
import { TouchableOpacity } from 'react-native-gesture-handler';
import { t } from '../../i18n';

interface ScreenErrorBoundaryProps {
  children: React.ReactNode;
  screenName: string;
}

export function ScreenErrorBoundary({ children, screenName }: ScreenErrorBoundaryProps) {
  return (
    <ErrorBoundary
      FallbackComponent={(props: any) => <ScreenFallback {...props} screenName={screenName} />}
      onError={(error: any, info: any) => analytics.error(error, { screen: screenName })}
    >
      {children}
    </ErrorBoundary>
  );
}

function ScreenFallback({ error, resetErrorBoundary, screenName }: { error: any; resetErrorBoundary: () => void; screenName: string }) {
  const router = useRouter();
  const retryCount = useRef(0);

  const handleReset = useCallback(async () => {
    retryCount.current++;

    if (retryCount.current > 2) {
      if (screenName !== 'StudentHome' && screenName !== 'DriverHome') {
        router.replace('/(student)/'); // or back to auth if needed
      } else {
        // We are already at home, clearing queries is our best bet, or logout
      }
      return;
    }

    // Nuclear option (safe here) over broad target
    queryClient.removeQueries();

    analytics.track('error_boundary_state_cleared', { screen: screenName });

    resetErrorBoundary();
  }, [queryClient, resetErrorBoundary, screenName, router]);

  return (
    <View style={styles.fallback}>
      <Text style={styles.icon}>⚠</Text>
      <Text style={styles.title}>{t('common.error')}</Text>
      <Text style={styles.body}>Something went wrong. Pull down to refresh or tap below.</Text>
      <TouchableOpacity style={styles.button} onPress={handleReset} activeOpacity={0.7}>
        <Text style={styles.buttonText}>{t('common.retry')}</Text>
      </TouchableOpacity>
      {retryCount.current > 1 && (
        <TouchableOpacity style={[styles.button, styles.linkButton]} onPress={() => router.replace('/(student)/')} activeOpacity={0.7}>
          <Text style={styles.linkText}>Go to home</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing['2xl'],
    backgroundColor: colors.surface,
  },
  icon: {
    fontSize: 40,
    opacity: 0.5,
    marginBottom: spacing.md,
  },
  title: {
    fontFamily: typography.family,
    fontSize: typography.sizes.h3,
    fontWeight: typography.weights.bold,
    color: colors.text.primary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  body: {
    fontFamily: typography.family,
    fontSize: typography.sizes.body,
    color: colors.text.secondary,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  button: {
    backgroundColor: colors.brand.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.button,
    marginBottom: spacing.md,
  },
  buttonText: {
    fontFamily: typography.family,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
    color: colors.white,
  },
  linkButton: {
    backgroundColor: 'transparent',
    paddingVertical: spacing.xs,
  },
  linkText: {
    fontFamily: typography.family,
    fontSize: typography.sizes.small,
    color: colors.brand.primary,
  },
});
