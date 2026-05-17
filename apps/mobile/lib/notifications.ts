import * as Notifications from 'expo-notifications';
import { getMessaging } from '@react-native-firebase/messaging';
import { Platform } from 'react-native';
import { PUSH_TOKEN_PROVIDER } from 'shared';
import { api } from './api.client';
import { features } from './config';

// Configure how notifications display when app is in foreground.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

async function registerPushToken(pushToken: string): Promise<void> {
  await api.patch('/v1/users/fcm-token', {
    pushToken,
    pushTokenProvider: PUSH_TOKEN_PROVIDER.FCM,
  }).catch(() => {
    console.warn('[Notifications] Failed to register FCM token with backend');
  });
}

// Permission + listener setup runs once per app process.
// Token registration still happens on every call (handles re-login / user switch).
let messagingSetupDone = false;
let tokenRefreshUnsub: (() => void) | null = null;

/**
 * Request permissions + register FCM token with backend.
 * Called on every user session to keep the backend token fresh.
 * Permission request and token-refresh listener are wired only once.
 *
 * Requires native google-services.json / GoogleService-Info.plist —
 * @react-native-firebase/messaging is a native module and cannot be
 * initialised purely from a JS config object.
 */
export async function setupNotifications(): Promise<string | null> {
  try {
    if (!features.pushNotifications) {
      return null;
    }

    const messaging = getMessaging();

    if (!messagingSetupDone) {
      const authStatus = await messaging.requestPermission();
      const enabled =
        authStatus === 1 || // AUTHORIZED
        authStatus === 2;   // PROVISIONAL

      if (!enabled) {
        console.log('[Notifications] Permission not granted');
        return null;
      }

      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'Default',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#356C8F',
        });
      }

      // Clean up any stale listener before registering a fresh one.
      tokenRefreshUnsub?.();
      tokenRefreshUnsub = messaging.onTokenRefresh((newToken) => {
        void registerPushToken(newToken);
      });

      messagingSetupDone = true;
    }

    const token = await messaging.getToken();
    if (token) {
      await registerPushToken(token);
    }

    return token;
  } catch (error) {
    console.error('[Notifications] Setup failed:', error);
    return null;
  }
}
