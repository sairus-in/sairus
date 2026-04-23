import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { StateStorage } from 'zustand/middleware';

// Sensitive fields stored in SecureStore (encrypted, not accessible without device unlock)
const SECURE_FIELDS = new Set(['token', 'deviceId', 'fcmToken']);
const SECURE_KEY = 'auth-secure';
const PUBLIC_KEY = 'auth-public';

// SecureStore has a 2048-byte value limit on iOS. JWTs (~600B), deviceId (~36B),
// fcmToken (~150B) are all safely under that limit.
export const splitSecureStorage: StateStorage = {
  getItem: async (_name: string): Promise<string | null> => {
    const [secureRaw, publicRaw] = await Promise.all([
      SecureStore.getItemAsync(SECURE_KEY).catch(() => null),
      AsyncStorage.getItem(PUBLIC_KEY).catch(() => null),
    ]);

    if (!secureRaw && !publicRaw) return null;

    const secure: { state?: Record<string, unknown> } = secureRaw ? JSON.parse(secureRaw) : {};
    const pub: { state?: Record<string, unknown>; version?: number } = publicRaw
      ? JSON.parse(publicRaw)
      : {};

    return JSON.stringify({
      state: { ...pub.state, ...secure.state },
      version: pub.version ?? 0,
    });
  },

  setItem: async (_name: string, value: string): Promise<void> => {
    const { state, version } = JSON.parse(value) as {
      state: Record<string, unknown>;
      version?: number;
    };

    const secureState: Record<string, unknown> = {};
    const publicState: Record<string, unknown> = {};

    for (const [k, v] of Object.entries(state)) {
      if (SECURE_FIELDS.has(k)) {
        secureState[k] = v;
      } else {
        publicState[k] = v;
      }
    }

    await Promise.all([
      SecureStore.setItemAsync(SECURE_KEY, JSON.stringify({ state: secureState })),
      AsyncStorage.setItem(PUBLIC_KEY, JSON.stringify({ state: publicState, version: version ?? 0 })),
    ]);
  },

  removeItem: async (_name: string): Promise<void> => {
    await Promise.all([
      SecureStore.deleteItemAsync(SECURE_KEY).catch(() => {}),
      AsyncStorage.removeItem(PUBLIC_KEY).catch(() => {}),
    ]);
  },
};
