import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { PUSH_TOKEN_PROVIDER } from 'shared';
import { api } from './api.client';
import { config, features } from './config';

let pushTokenListener: { remove: () => void } | null = null;

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
    pushTokenProvider: PUSH_TOKEN_PROVIDER.EXPO,
  }).catch(() => {
    console.warn('[Notifications] Failed to register push token with backend');
  });
}

/**
 * Request permissions + register push token with backend.
 * Called on every app launch to keep token fresh.
 */
export async function setupNotifications(): Promise<string | null> {
  try {
    if (!features.pushNotifications || !config.projectId) {
      console.warn('[Notifications] Push notifications disabled by configuration');
      return null;
    }

    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;

    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('[Notifications] Permission not granted');
      return null;
    }

    // Android needs a notification channel.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#1E3A8A',
      });
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId: config.projectId });
    const token = tokenData.data;

    await registerPushToken(token);

    if (pushTokenListener) {
      pushTokenListener.remove();
    }

    pushTokenListener = Notifications.addPushTokenListener(({ data }) => {
      void registerPushToken(data);
    });

    return token;
  } catch (error) {
    console.error('[Notifications] Setup failed:', error);
    return null;
  }
}
