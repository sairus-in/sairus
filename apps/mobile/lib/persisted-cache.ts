import AsyncStorage from '@react-native-async-storage/async-storage';

export const STUDENT_HOME_CACHE_PREFIX = 'student-home-cache:';
export const LEGACY_HOME_CACHE_KEY = 'home-cache';
export const STUDENT_HOME_CACHE_TTL_MS = 60_000;
export const CHECKIN_QUEUE_KEY = 'checkin_queue_v4';
export const GPS_CONTEXT_KEY = 'gps-context';
export const GPS_LAST_POS_KEY = 'gps-last-pos';
export const GPS_HEARTBEAT_PREFIX = 'gps:heartbeat:';

type CacheEnvelope<T> = {
  userId: string;
  cachedAt: number;
  data: T;
};

export function getStudentHomeCacheKey(userId: string): string {
  return `${STUDENT_HOME_CACHE_PREFIX}${userId}`;
}

export async function writeStudentHomeCache<T>(userId: string, data: T): Promise<void> {
  const envelope: CacheEnvelope<T> = {
    userId,
    cachedAt: Date.now(),
    data,
  };

  await AsyncStorage.setItem(getStudentHomeCacheKey(userId), JSON.stringify(envelope));
}

export async function readStudentHomeCache<T>(userId: string, ttlMs = STUDENT_HOME_CACHE_TTL_MS): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(getStudentHomeCacheKey(userId));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as CacheEnvelope<T>;
    if (parsed.userId !== userId || Date.now() - parsed.cachedAt > ttlMs) {
      await AsyncStorage.removeItem(getStudentHomeCacheKey(userId));
      return null;
    }

    return parsed.data;
  } catch {
    return null;
  }
}

export async function clearPersistedMobileCaches(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const keysToRemove = keys.filter((key) => (
    key === CHECKIN_QUEUE_KEY
    || key === GPS_CONTEXT_KEY
    || key === GPS_LAST_POS_KEY
    || key === LEGACY_HOME_CACHE_KEY
    || key.startsWith(STUDENT_HOME_CACHE_PREFIX)
    || key.startsWith(GPS_HEARTBEAT_PREFIX)
  ));

  if (keysToRemove.length > 0) {
    await AsyncStorage.multiRemove(keysToRemove);
  }
}
