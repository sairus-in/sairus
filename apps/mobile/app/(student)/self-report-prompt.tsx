// app/(student)/self-report-prompt.tsx — Self Report Attendance
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { studentService } from '../../services/student.service';
import { typography } from '../../constants/theme';
import { queryClient } from '../../lib/query-client';
import { analytics } from '../../lib/analytics';
import { ScreenErrorBoundary } from '../../components/shared/ScreenErrorBoundary';
import { ApiError } from '../../lib/api.client';

// ── Local tokens ──────────────────────────────────────────────────
const C = {
  bg: '#BFE6FF',
  ink: '#1A1A1C',
  muted: '#565656',
  ghost: '#C9C9C9',
  surface: '#FFFFFF',
  btnBg: '#356C8F',
  btnText: '#FFFFFF',
  btnSecBg: '#FFFFFF',
  btnSecText: '#1A1A1C',
  link: '#356C8F',
};

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
    if (!tripId) setState('EXPIRED');
  }, [tripId]);

  const scheduleNavigation = (destination: '/(student)/' | '/(student)/history') => {
    if (navigationTimerRef.current) clearTimeout(navigationTimerRef.current);
    navigationTimerRef.current = setTimeout(() => {
      router.replace(destination);
      navigationTimerRef.current = null;
    }, 2500);
  };

  const handleResponse = async (wasOnBus: boolean) => {
    if (!tripId) return;
    setState('SUBMITTING');
    try {
      const result = await studentService.selfReport({ tripId, wasOnBus });
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
      <SafeAreaView style={s.container}>
        <View style={s.centerLayout}>
          <ActivityIndicator size="large" color={C.btnBg} />
          <Text style={s.stateBody}>Verifying trip status…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'EXPIRED') {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.centerLayout}>
          <Text style={s.stateTitle}>Window Closed</Text>
          <Text style={s.stateBody}>
            The review window for this trip has already closed or your attendance is already resolved.
          </Text>
          <TouchableOpacity
            style={s.btn}
            onPress={() => router.replace('/(student)/')}
            activeOpacity={0.85}
          >
            <Text style={s.btnLabel}>Go Home</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'DONE_YES') {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.centerLayout}>
          <Text style={s.stateTitle}>Report Submitted</Text>
          <Text style={s.stateBody}>
            Correction request submitted. Your coordinator will review it shortly.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'DONE_NO') {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.centerLayout}>
          <Text style={s.stateTitle}>Absence Recorded</Text>
          <Text style={s.stateBody}>
            Got it. Your absence has been safely recorded for this trip.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'ERROR') {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.centerLayout}>
          <Text style={s.stateTitle}>Something went wrong</Text>
          <Text style={s.stateBody}>
            We couldn't submit your response. Check your connection and try again.
          </Text>
          <TouchableOpacity
            style={s.btn}
            onPress={() => setState('READY')}
            activeOpacity={0.85}
          >
            <Text style={s.btnLabel}>Try Again</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.linkWrap}
            onPress={() => router.replace('/(student)/')}
            activeOpacity={0.7}
          >
            <Text style={s.linkText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container}>
      <View style={s.layout}>

        {/* Question */}
        <View style={s.questionBlock}>
          <Text style={s.questionLabel}>Attendance check</Text>
          <Text style={s.questionTitle}>Were you on Bus {busNumber} today?</Text>
          <Text style={s.questionBody}>
            The driver's app encountered an offline issue. Let us know if you were on board so we can update your attendance.
          </Text>
        </View>

        {/* Actions */}
        <View style={s.actionBlock}>
          {state === 'SUBMITTING' ? (
            <ActivityIndicator size="large" color={C.btnBg} />
          ) : (
            <>
              <TouchableOpacity
                style={s.btn}
                onPress={() => handleResponse(true)}
                activeOpacity={0.85}
                accessibilityRole="button"
              >
                <Text style={s.btnLabel}>Yes, I was on the bus</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={s.btnSecondary}
                onPress={() => handleResponse(false)}
                activeOpacity={0.8}
                accessibilityRole="button"
              >
                <Text style={s.btnSecondaryLabel}>No, I wasn't</Text>
              </TouchableOpacity>
            </>
          )}
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

  // Main layout
  layout: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 60,
    paddingBottom: 48,
    justifyContent: 'space-between',
  },

  // State layouts (loading, expired, done, error)
  centerLayout: {
    flex: 1,
    paddingHorizontal: 28,
    paddingVertical: 60,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  stateTitle: {
    fontFamily: typography.family,
    fontSize: 24,
    fontWeight: '700',
    color: C.ink,
    textAlign: 'center',
    letterSpacing: -0.4,
  },
  stateBody: {
    fontFamily: typography.family,
    fontSize: 15,
    color: C.muted,
    textAlign: 'center',
    lineHeight: 23,
  },

  // Question block
  questionBlock: {
    gap: 10,
  },
  questionLabel: {
    fontFamily: typography.family,
    fontSize: 13,
    color: C.muted,
  },
  questionTitle: {
    fontFamily: typography.family,
    fontSize: 26,
    fontWeight: '700',
    color: C.ink,
    letterSpacing: -0.5,
    lineHeight: 34,
  },
  questionBody: {
    fontFamily: typography.family,
    fontSize: 15,
    color: C.muted,
    lineHeight: 23,
    marginTop: 4,
  },

  // Action block
  actionBlock: {
    gap: 10,
    minHeight: 140,
    justifyContent: 'flex-end',
  },

  // Buttons
  btn: {
    backgroundColor: C.btnBg,
    height: 54,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnLabel: {
    fontFamily: typography.family,
    fontSize: 16,
    fontWeight: '600',
    color: C.btnText,
  },
  btnSecondary: {
    backgroundColor: C.btnSecBg,
    height: 54,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSecondaryLabel: {
    fontFamily: typography.family,
    fontSize: 16,
    fontWeight: '500',
    color: C.btnSecText,
  },
  linkWrap: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  linkText: {
    fontFamily: typography.family,
    fontSize: 14,
    color: C.ghost,
  },
});
