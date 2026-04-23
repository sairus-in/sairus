// app/_layout.tsx — The BRAIN: auth guard + role routing + FCM deep link handler
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, StyleSheet, Text } from 'react-native';
import * as Notifications from 'expo-notifications';
import { queryClient } from '../lib/query-client';
import { useAuth, useAuthStore } from '../store/auth.store';
import { ApiError } from '../lib/api.client';
import { setupNotifications } from '../lib/notifications';
import { fetchMobileProfile } from '../lib/mobile-profile';
import { clearMobileSession } from '../lib/session';
import { OfflineBanner } from '../components/shared/OfflineBanner';
import { colors } from '../constants/theme';

const notificationScreenMap: Record<string, string> = {
  '/transport/verify-arrival': '/(student)/verify-arrival',
  '/(student)/verify-arrival': '/(student)/verify-arrival',
  '/(student)/self-report-prompt': '/(student)/self-report-prompt',
};

function AuthGate() {
  const router = useRouter();
  const segments = useSegments();
  const user = useAuth(s => s.user);
  const isLoaded = useAuth(s => s.isLoaded);
  const token = useAuth(s => s.token);
  const setUser = useAuth(s => s.setUser);
  const setPhase = useAuth(s => s.setPhase);
  const setBootstrapPromise = useAuth(s => s.setBootstrapPromise);
  const [isProfileSyncing, setIsProfileSyncing] = useState(false);
  const [profileSyncFailed, setProfileSyncFailed] = useState(false);
  const [profileSyncErrorMessage, setProfileSyncErrorMessage] = useState<string | null>(null);
  const syncedTokenRef = useRef<string | null>(null);
  const [profileSyncRetryTick, setProfileSyncRetryTick] = useState(0);
  const profileSyncRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const profileSyncRetryCountRef = useRef(0);

  const clearProfileSyncRetry = useCallback(() => {
    if (profileSyncRetryRef.current) {
      clearTimeout(profileSyncRetryRef.current);
      profileSyncRetryRef.current = null;
    }
  }, []);

  const scheduleProfileSyncRetry = useCallback(() => {
    clearProfileSyncRetry();
    const delay = Math.min(30_000, 2_000 * 2 ** profileSyncRetryCountRef.current);
    profileSyncRetryCountRef.current += 1;

    profileSyncRetryRef.current = setTimeout(() => {
      profileSyncRetryRef.current = null;
      setProfileSyncRetryTick((value) => value + 1);
    }, delay);
  }, [clearProfileSyncRetry]);

  useEffect(() => () => clearProfileSyncRetry(), [clearProfileSyncRetry]);

  useEffect(() => {
    if (!isLoaded) return;

    if (!token) {
      clearProfileSyncRetry();
      syncedTokenRef.current = null;
      profileSyncRetryCountRef.current = 0;
      setIsProfileSyncing(false);
      setProfileSyncFailed(false);
      setProfileSyncErrorMessage(null);
      setPhase('unauthenticated');
      setBootstrapPromise(null);
      return;
    }

    if (syncedTokenRef.current === token) {
      return;
    }

    let cancelled = false;
    let resolveBootstrap: (() => void) | null = null;
    const bootstrapPromise = new Promise<void>((resolve) => {
      resolveBootstrap = resolve;
    });
    clearProfileSyncRetry();
    profileSyncRetryCountRef.current = 0;
    setIsProfileSyncing(true);
    setPhase('bootstrapping');
    setBootstrapPromise(bootstrapPromise);

    void fetchMobileProfile()
      .then((profile) => {
        if (cancelled) return;
        setUser(profile);
        syncedTokenRef.current = token;
        profileSyncRetryCountRef.current = 0;
        setProfileSyncFailed(false);
        setProfileSyncErrorMessage(null);
      })
      .catch((error) => {
        if (cancelled) return;

        const status = error instanceof ApiError ? error.status : undefined;
        if (status === 401 || status === 403) {
          syncedTokenRef.current = null;
          profileSyncRetryCountRef.current = 0;
          clearProfileSyncRetry();
          void clearMobileSession();
          setProfileSyncFailed(false);
          setProfileSyncErrorMessage(null);
          router.replace('/(auth)/login');
          return;
        }

        setProfileSyncFailed(true);
        setProfileSyncErrorMessage('Unable to refresh your profile. Retrying in the background.');
        setPhase(useAuthStore.getState().user ? 'unverified' : 'bootstrapping');
        scheduleProfileSyncRetry();
      })
      .finally(() => {
        setBootstrapPromise(null);
        resolveBootstrap?.();
        if (!cancelled) {
          setIsProfileSyncing(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    isLoaded,
    token,
    profileSyncRetryTick,
    setUser,
    setPhase,
    setBootstrapPromise,
    scheduleProfileSyncRetry,
    clearProfileSyncRetry,
    router,
  ]);

  // --- Role-based routing ---
  useEffect(() => {
    if (!isLoaded || isProfileSyncing) return;

    const inAuthGroup = segments[0] === '(auth)';
    const inDriverGroup = segments[0] === '(driver)';
    const inStudentGroup = segments[0] === '(student)';

    if (!user || !token) {
      // Not authenticated → go to login
      if (!inAuthGroup) {
        router.replace('/(auth)/login');
      }
    } else {
      switch (user.role) {
        case 'DRIVER':
          if (!inDriverGroup) {
            router.replace('/(driver)/');
          }
          break;
        case 'STUDENT':
          if (!user.routeAssignment) {
            if (segments[1] !== 'pending') {
              router.replace('/(auth)/pending');
            }
          } else if (!inStudentGroup) {
            router.replace('/(student)/');
          }
          break;
        case 'STAFF':
        case 'NCC_OFFICER':
        case 'COORDINATOR':
        case 'TRANSPORT_OFFICER':
        case 'FACULTY':
        case 'MANAGEMENT':
          if (segments[0] !== 'unsupported-role') {
            router.replace('/unsupported-role');
          }
          break;
        default:
          void clearMobileSession();
          router.replace('/(auth)/login');
      }
    }
  }, [user, isLoaded, token, segments, isProfileSyncing, router]);

  // --- FCM deep link handler ---
  useEffect(() => {
    if (!user) return;

    // Setup notifications on every app launch
    setupNotifications();

    // App opened from notification (background/killed)
    const sub1 = Notifications.addNotificationResponseReceivedListener((response: any) => {
      const data = response.notification.request.content.data as Record<string, string>;
      if (data?.screen) {
        const { screen, type, ...restParams } = data;
        const pathname = notificationScreenMap[screen];
        if (!pathname) {
          return;
        }

        const params = data.params ? JSON.parse(data.params) : restParams;
        router.push({ pathname: pathname as any, params });
      }
    });

    // Notification received while app is open (foreground) — refresh relevant queries
    const sub2 = Notifications.addNotificationReceivedListener((notification: any) => {
      const data = notification.request.content.data as Record<string, string>;
      if (data?.type === 'SUBSTITUTE_ASSIGNED') {
        queryClient.invalidateQueries({ queryKey: ['student-home'] });
      }
      if (data?.type === 'CORRECTION_REVIEWED') {
        queryClient.invalidateQueries({ queryKey: ['attendance-history'] });
      }
      if (data?.type === 'CHECKIN_CONFIRMED') {
        queryClient.invalidateQueries({ queryKey: ['student-home'] });
      }
    });

    return () => {
      sub1.remove();
      sub2.remove();
    };
  }, [user]);

  // --- Splash while hydrating ---
  if (!isLoaded || isProfileSyncing) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color={colors.brand.primary} />
      </View>
    );
  }

  return (
    <>
      {profileSyncFailed && profileSyncErrorMessage ? (
        <View style={styles.warningBanner}>
          <Text style={styles.warningText}>{profileSyncErrorMessage}</Text>
        </View>
      ) : null}
      <Slot />
    </>
  );
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="auto" />
      <OfflineBanner />
      <AuthGate />
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  warningBanner: {
    backgroundColor: '#92400E',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  warningText: {
    color: '#FEF3C7',
    fontSize: 13,
    textAlign: 'center',
  },
});
