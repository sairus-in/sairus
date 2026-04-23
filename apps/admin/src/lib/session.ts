import { queryClient } from './query-client';
import { disconnectAdminSocket } from './socket';
import { useAuthStore } from '../store/auth.store';

export const clearAdminSessionState = () => {
  disconnectAdminSocket();
  queryClient.clear();
  useAuthStore.getState().logout();
};

export type AdminLoginRedirectReason =
  | 'forced-reauth'
  | 'session-expired'
  | 'account-suspended';

export const redirectToAdminLogin = (reason?: AdminLoginRedirectReason) => {
  clearAdminSessionState();

  if (typeof window === 'undefined') {
    return;
  }

  const search = reason ? `?reason=${encodeURIComponent(reason)}` : '';
  const target = `/login${search}`;
  if (`${window.location.pathname}${window.location.search}` === target) {
    return;
  }

  window.location.replace(target);
};
