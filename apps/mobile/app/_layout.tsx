// app/_layout.tsx — The BRAIN: auth guard + role routing + FCM deep link handler
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, StyleSheet, Text } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useFonts } from 'expo-font';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
} from '@expo-google-fonts/inter';
import { UbuntuMono_400Regular, UbuntuMono_700Bold } from '@expo-google-fonts/ubuntu-mono';
import { queryClient } from '../lib/query-client';
import { useAuth, useAuthStore } from '../store/auth.store';
import { ApiError } from '../lib/api.client';
import { setupNotifications } from '../lib/notifications';
import { fetchMobileProfile } from '../lib/mobile-profile';
import { clearMobileSession } from '../lib/session';
import { OfflineBanner } from '../components/shared/OfflineBanner';
import { DevRoleOverlay } from '../components/dev/DevRoleOverlay';
import { colors } from '../constants/theme';
import { localFontAssets } from '../constants/local-fonts';

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

    // DEV MODE: Skip profile fetch, trust the user set via dev-bypass
    // Also guard: if we have a dev_token_*, bypass the profile fetch even if user is still being set
    if (__DEV__ && token && token.startsWith('dev_token_')) {
      syncedTokenRef.current = token;
      setIsProfileSyncing(false);
      setPhase('authenticated');
      return;
    }

    if (!user || !token) {
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
          
          if (__DEV__) {
            router.replace('/(auth)/dev-bypass');
          } else {
            router.replace('/(auth)/login');
          }
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

  // DEV MODE: Guard against navigating to auth screens when we have a dev session
  useEffect(() => {
    if (!__DEV__ || !isLoaded) return;
    if (!user && token?.startsWith('dev_token_')) {
      // We have a dev token but no user yet - wait for user to be set
      return;
    }
    if (user && token?.startsWith('dev_token_')) {
      // DEV SESSION ACTIVE - prevent any navigation to login/verify-otp/pending
      const isAtAuthScreen = segments.some(s => s === 'login' || s === 'verify-otp' || s === 'pending');
      if (isAtAuthScreen) {
        // Redirect based on role
        if (user.role === 'DRIVER') {
          router.replace('/(driver)/');
        } else if (user.role === 'STUDENT' && user.routeAssignment) {
          router.replace('/(student)/');
        }
      }
    }
  }, [user, token, isLoaded, segments, router]);

  // --- Role-based routing ---
  useEffect(() => {
    if (!isLoaded || isProfileSyncing) return;

    const inAuthGroup = segments[0] === '(auth)';
    const inDriverGroup = segments[0] === '(driver)';
    const inStudentGroup = segments[0] === '(student)';

    if (!user || !token) {
      // Not authenticated
      if (__DEV__) {
        // In dev, if not on dev-bypass, go there
        if (!segments.some(s => s === 'dev-bypass')) {
          router.replace('/(auth)/dev-bypass');
        }
      } else if (!inAuthGroup) {
        // In prod, if not in auth group, go to login
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

  return (
    <View style={{ flex: 1 }}>
      <Slot />

      {(!isLoaded || isProfileSyncing) && (
        <View style={[StyleSheet.absoluteFill, styles.splash, { zIndex: 999 }]}>
          <ActivityIndicator size="large" color="#356C8F" />
        </View>
      )}

      {profileSyncFailed && profileSyncErrorMessage && (
        <View style={[styles.warningBanner, { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1000 }]}>
          <Text style={styles.warningText}>{profileSyncErrorMessage}</Text>
        </View>
      )}
    </View>
  );
}

function FontGate({ children }: { children: React.ReactNode }) {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    UbuntuMono_400Regular,
    UbuntuMono_700Bold,
    ...localFontAssets,
  });

  if (!fontsLoaded && !fontError) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.splash]}>
        <ActivityIndicator size="large" color="#356C8F" />
      </View>
    );
  }

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="auto" />
      <FontGate>
        <OfflineBanner />
        <AuthGate />
        {__DEV__ && <DevRoleOverlay />}
      </FontGate>
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
