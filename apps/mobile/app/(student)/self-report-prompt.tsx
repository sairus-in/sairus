// app/(student)/self-report-prompt.tsx — Self Report Attendance
// HARDENED v3:
//   - All hardcoded hex → theme tokens (LAW 2)
//   - console.error → analytics.error (LAW 5)
//   - analytics.track on self-report submit (LAW 6)
//   - isMounted ref added for setTimeout navigations
//   - ScreenErrorBoundary wrapping
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { studentService } from '../../services/student.service';
import { colors, typography, spacing, radii } from '../../constants/theme';
import { Ionicons } from '@expo/vector-icons';
import { queryClient } from '../../lib/query-client';
import { analytics } from '../../lib/analytics';
import { ScreenErrorBoundary } from '../../components/shared/ScreenErrorBoundary';
import { ApiError } from '../../lib/api.client';

// States: LOADING -> EXPIRED | READY -> SUBMITTING -> DONE_YES | DONE_NO | ERROR
type ScreenState = 'LOADING' | 'EXPIRED' | 'READY' | 'SUBMITTING' | 'DONE_YES' | 'DONE_NO' | 'ERROR';

export default function SelfReportPromptScreen() {
  return (
    <ScreenErrorBoundary screenName="SelfReportPrompt">
      <SelfReportPromptContent />
    </ScreenErrorBoundary>
  );
}

function SelfReportPromptContent() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tripId: string; busNumber: string }>();
  const tripId = params.tripId;
  const busNumber = params.busNumber || 'your bus';

  const [state, setState] = useState<ScreenState>('READY');
  const navigationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (navigationTimerRef.current) {
      clearTimeout(navigationTimerRef.current);
      navigationTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!tripId) {
      setState('EXPIRED');
    }
  }, [tripId]);

  const scheduleNavigation = (destination: '/(student)/' | '/(student)/history') => {
    if (navigationTimerRef.current) {
      clearTimeout(navigationTimerRef.current);
    }

    navigationTimerRef.current = setTimeout(() => {
      router.replace(destination);
      navigationTimerRef.current = null;
    }, 2500);
  };

  const handleResponse = async (wasOnBus: boolean) => {
    if (!tripId) return;

    setState('SUBMITTING');

    try {
      const result = await studentService.selfReport({
        tripId,
        wasOnBus,
      });

      if (result.success || result.status) {
        setState(wasOnBus ? 'DONE_YES' : 'DONE_NO');
        analytics.track('self_report_submitted', { tripId, wasOnBus });

        queryClient.invalidateQueries({ queryKey: ['attendance-history'] });
        queryClient.invalidateQueries({ queryKey: ['student-home'] });

        scheduleNavigation(wasOnBus ? '/(student)/history' : '/(student)/');
      } else {
        setState('ERROR');
        analytics.track('self_report_failed', { tripId, reason: 'unknown_status' });
      }
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'isOfflineQueued' in error && (error as { isOfflineQueued?: boolean }).isOfflineQueued) {
        setState(wasOnBus ? 'DONE_YES' : 'DONE_NO');
        analytics.track('self_report_queued_offline', { tripId, wasOnBus });
        scheduleNavigation('/(student)/');
      } else if (error instanceof ApiError && (error.code === 'WINDOW_CLOSED' || error.code === 'ALREADY_RESOLVED')) {
        setState('EXPIRED');
        analytics.track('self_report_failed_expired', { tripId });
      } else {
        setState('ERROR');
        analytics.error(error as Error, { context: 'self_report_submit', tripId });
      }
    }
  };

  if (state === 'LOADING') {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.brand.primary} />
        <Text style={styles.loadingText}>Verifying trip status…</Text>
      </View>
    );
  }

  if (state === 'EXPIRED') {
    return (
      <View style={styles.centerContainer}>
        <Ionicons name="time-outline" size={64} color={colors.text.secondary} />
        <Text style={styles.title}>Window Closed</Text>
        <Text style={styles.subtitle}>The review window for this trip has already closed or your attendance is already resolved.</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={() => router.replace('/(student)/')}>
          <Text style={styles.primaryButtonText}>Go Home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (state === 'DONE_YES') {
    return (
      <View style={styles.centerContainer}>
        <Ionicons name="checkmark-circle" size={64} color={colors.success.text} />
        <Text style={styles.title}>Report Submitted</Text>
        <Text style={styles.subtitle}>Correction request submitted. Your coordinator will review it shortly.</Text>
      </View>
    );
  }

  if (state === 'DONE_NO') {
    return (
      <View style={styles.centerContainer}>
        <Ionicons name="close-circle" size={64} color={colors.text.secondary} />
        <Text style={styles.title}>Absence Recorded</Text>
        <Text style={styles.subtitle}>Got it. Your absence has been safely recorded for this trip.</Text>
      </View>
    );
  }

  if (state === 'ERROR') {
    return (
      <View style={styles.centerContainer}>
        <Ionicons name="alert-circle" size={64} color={colors.error.text} />
        <Text style={styles.title}>Connection Error</Text>
        <Text style={styles.subtitle}>Something went wrong while submitting your response. Please ensure you have an active internet connection.</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={() => setState('READY')}>
          <Text style={styles.primaryButtonText}>Try Again</Text>
        </TouchableOpacity>
        <TouchableOpacity style={{ marginTop: spacing.md }} onPress={() => router.replace('/(student)/')}>
          <Text style={[styles.subtitle, { color: colors.brand.primary }]}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="bus" size={48} color={colors.brand.primary} />
        <Text style={styles.title}>Were you on Bus {busNumber} today?</Text>
        <Text style={styles.subtitle}>
          The driver's app on your bus encountered an offline issue today. Let us know if you were on board so we can securely update your attendance.
        </Text>
      </View>

      <View style={styles.actionContainer}>
        {state === 'SUBMITTING' ? (
          <ActivityIndicator size="large" color={colors.brand.primary} />
        ) : (
          <>
            <TouchableOpacity style={styles.primaryButton} onPress={() => handleResponse(true)}>
              <Text style={styles.primaryButtonText}>Yes, I was on the bus</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.secondaryButton} onPress={() => handleResponse(false)}>
              <Text style={styles.secondaryButtonText}>No, I wasn't</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
    padding: spacing.xl,
    justifyContent: 'center',
  },
  centerContainer: {
    flex: 1,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing['2xl'],
  },
  title: {
    fontFamily: typography.family,
    fontSize: typography.sizes.h2,
    fontWeight: typography.weights.bold,
    color: colors.text.primary,
    textAlign: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontFamily: typography.family,
    fontSize: typography.sizes.body,
    color: colors.text.secondary,
    textAlign: 'center',
    lineHeight: 24,
  },
  actionContainer: {
    width: '100%',
    gap: spacing.md,
  },
  primaryButton: {
    backgroundColor: colors.brand.primary,
    paddingVertical: spacing.md,
    borderRadius: radii.button,
    alignItems: 'center',
    width: '100%',
  },
  primaryButtonText: {
    fontFamily: typography.family,
    color: colors.white,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
  },
  secondaryButton: {
    backgroundColor: colors.neutral.bg,
    paddingVertical: spacing.md,
    borderRadius: radii.button,
    alignItems: 'center',
    width: '100%',
  },
  secondaryButtonText: {
    fontFamily: typography.family,
    color: colors.text.primary,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
  },
  loadingText: {
    fontFamily: typography.family,
    marginTop: spacing.md,
    fontSize: typography.sizes.body,
    color: colors.text.secondary,
  },
});
