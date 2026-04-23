// hooks/useOptimizedAuth.ts — Optimized auth hook with memoized selectors
// Prevents unnecessary re-renders when auth state changes

import { useMemo, useCallback } from 'react';
import { useAuth, authSelectors } from '../store/auth.store';
import { User } from '../store/auth.store';

interface UseOptimizedAuthReturn {
  user: User | null;
  token: string | null;
  isLoaded: boolean;
  isAuthenticated: boolean;
  deviceId: string | null;
  fcmToken: string | null;
  // Actions
  actions: {
    getAuthHeaders: () => Record<string, string>;
    requireAuth: () => boolean;
  };
}

export function useOptimizedAuth(): UseOptimizedAuthReturn {
  // Use individual selectors to prevent re-renders on unrelated changes
  const user = useAuth(authSelectors.selectUser);
  const token = useAuth(authSelectors.selectToken);
  const isLoaded = useAuth(authSelectors.selectIsLoaded);
  const deviceId = useAuth(authSelectors.selectDeviceId);
  const fcmToken = useAuth(authSelectors.selectFcmToken);

  // Memoized derived state
  const isAuthenticated = useMemo(() => {
    return !!user && !!token;
  }, [user, token]);

  // Memoized actions
  const actions = useMemo(() => ({
    getAuthHeaders: () => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      if (deviceId) {
        headers['X-Device-Id'] = deviceId;
      }
      return headers;
    },
    requireAuth: () => {
      if (!isAuthenticated) {
        console.warn('[Auth] Required auth but not authenticated');
        return false;
      }
      return true;
    },
  }), [token, deviceId, isAuthenticated]);

  return {
    user,
    token,
    isLoaded,
    isAuthenticated,
    deviceId,
    fcmToken,
    actions,
  };
}

// Specialized hook for student-only data
export function useStudentAuth() {
  const { user, ...rest } = useOptimizedAuth();

  const isStudent = useMemo(() => {
    return user?.role === 'STUDENT';
  }, [user?.role]);

  const routeAssignment = useMemo(() => {
    return user?.routeAssignment;
  }, [user?.routeAssignment]);

  return {
    ...rest,
    user,
    isStudent,
    routeAssignment,
    hasRouteAssignment: !!routeAssignment,
  };
}

// Specialized hook for driver-only data
export function useDriverAuth() {
  const { user, ...rest } = useOptimizedAuth();

  const isDriver = useMemo(() => {
    return user?.role === 'DRIVER';
  }, [user?.role]);

  return {
    ...rest,
    user,
    isDriver,
  };
}
