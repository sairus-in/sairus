import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const SESSION_KEYS = {
  accessToken: 'bus.access_token',
  deviceId: 'bus.device_id',
  fcmToken: 'bus.fcm_token',
} as const;

export type SessionSnapshot = {
  token: string | null;
  deviceId: string | null;
  fcmToken: string | null;
};

async function setSecureItem(key: string, value: string | null): Promise<void> {
  if (value === null) {
    await SecureStore.deleteItemAsync(key).catch(() => {});
    return;
  }

  await SecureStore.setItemAsync(key, value);
}

export async function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(SESSION_KEYS.accessToken);
}

export async function persistAccessToken(token: string | null): Promise<void> {
  await setSecureItem(SESSION_KEYS.accessToken, token);
}

export async function getDeviceId(): Promise<string | null> {
  return SecureStore.getItemAsync(SESSION_KEYS.deviceId);
}

export async function persistDeviceId(deviceId: string | null): Promise<void> {
  await setSecureItem(SESSION_KEYS.deviceId, deviceId);
}

export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await getDeviceId();
  if (existing) {
    return existing;
  }

  const nextDeviceId = Crypto.randomUUID();
  await persistDeviceId(nextDeviceId);
  return nextDeviceId;
}

export async function getFcmToken(): Promise<string | null> {
  return SecureStore.getItemAsync(SESSION_KEYS.fcmToken);
}

export async function persistFcmToken(fcmToken: string | null): Promise<void> {
  await setSecureItem(SESSION_KEYS.fcmToken, fcmToken);
}

export async function getSessionSnapshot(): Promise<SessionSnapshot> {
  const [token, deviceId, fcmToken] = await Promise.all([
    getAccessToken(),
    getDeviceId(),
    getFcmToken(),
  ]);

  return {
    token,
    deviceId,
    fcmToken,
  };
}

export async function clearSessionStorage(options?: { preserveDeviceId?: boolean }): Promise<void> {
  const preserveDeviceId = options?.preserveDeviceId ?? true;
  const tasks: Promise<void>[] = [
    SecureStore.deleteItemAsync(SESSION_KEYS.accessToken).catch(() => {}),
    SecureStore.deleteItemAsync(SESSION_KEYS.fcmToken).catch(() => {}),
  ];

  if (!preserveDeviceId) {
    tasks.push(SecureStore.deleteItemAsync(SESSION_KEYS.deviceId).catch(() => {}));
  }

  await Promise.all(tasks);
}
