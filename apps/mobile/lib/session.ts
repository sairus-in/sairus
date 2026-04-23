import { queryClient } from './query-client';
import { clearPhoneAuthSession } from './phone-auth';
import { clearPersistedMobileCaches } from './persisted-cache';
import { useAuthStore } from '../store/auth.store';
import { disconnectSocket } from './socket';

let sessionResetPromise: Promise<void> | null = null;

export async function clearMobileSession(): Promise<void> {
  if (sessionResetPromise) {
    return sessionResetPromise;
  }

  sessionResetPromise = (async () => {
    await clearPhoneAuthSession().catch(() => {});
    disconnectSocket();
    queryClient.clear();
    await useAuthStore.getState().clearUser();
    await clearPersistedMobileCaches().catch(() => {});
  })().finally(() => {
    sessionResetPromise = null;
  });

  return sessionResetPromise;
}
