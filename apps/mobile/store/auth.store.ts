import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { MobileAuthUser } from 'shared';
import {
  clearSessionStorage,
  getSessionSnapshot,
  persistAccessToken,
  persistDeviceId,
  persistFcmToken,
} from '../lib/session-storage';

export type User = MobileAuthUser;
export type AuthPhase = 'idle' | 'bootstrapping' | 'authenticated' | 'unverified' | 'unauthenticated';

interface AuthStore {
  user: User | null;
  token: string | null;
  deviceId: string | null;
  fcmToken: string | null;
  isLoaded: boolean;
  phase: AuthPhase;
  bootstrapPromise: Promise<void> | null;
  hydrateSession: () => Promise<void>;
  setUser: (user: User) => void;
  setAuthenticatedSession: (user: User, session: {
    token: string;
    deviceId?: string | null;
    fcmToken?: string | null;
  }) => Promise<void>;
  clearUser: () => Promise<void>;
  setToken: (token: string | null) => Promise<void>;
  setDeviceId: (deviceId: string | null) => Promise<void>;
  setFcmToken: (fcmToken: string | null) => Promise<void>;
  setPhase: (phase: AuthPhase) => void;
  setBootstrapPromise: (promise: Promise<void> | null) => void;
  isAuthenticated: () => boolean;
  isStudent: () => boolean;
  isDriver: () => boolean;
  hasRouteAssignment: () => boolean;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      deviceId: null,
      fcmToken: null,
      isLoaded: false,
      phase: 'idle',
      bootstrapPromise: null,

      hydrateSession: async () => {
        const snapshot = await getSessionSnapshot();
        set({
          token: snapshot.token,
          deviceId: snapshot.deviceId,
          fcmToken: snapshot.fcmToken,
          isLoaded: true,
          phase: snapshot.token ? 'bootstrapping' : 'unauthenticated',
        });
      },

      setUser: (user) => set((state) => ({
        user,
        phase: state.token ? 'authenticated' : state.phase,
      })),

      setAuthenticatedSession: async (user, session) => {
        const nextDeviceId = session.deviceId ?? get().deviceId ?? null;
        const nextFcmToken = session.fcmToken ?? get().fcmToken ?? null;

        await Promise.all([
          persistAccessToken(session.token),
          session.deviceId !== undefined ? persistDeviceId(session.deviceId) : Promise.resolve(),
          session.fcmToken !== undefined ? persistFcmToken(session.fcmToken) : Promise.resolve(),
        ]);

        set({
          user,
          token: session.token,
          deviceId: nextDeviceId,
          fcmToken: nextFcmToken,
          isLoaded: true,
          phase: 'authenticated',
        });
      },

      clearUser: async () => {
        const currentDeviceId = get().deviceId;
        await clearSessionStorage({ preserveDeviceId: true });
        set({
          user: null,
          token: null,
          deviceId: currentDeviceId,
          fcmToken: null,
          isLoaded: true,
          phase: 'unauthenticated',
          bootstrapPromise: null,
        });
      },

      setToken: async (token) => {
        await persistAccessToken(token);
        set((state) => ({
          token,
          phase: token
            ? (state.user ? 'authenticated' : 'bootstrapping')
            : 'unauthenticated',
        }));
      },

      setDeviceId: async (deviceId) => {
        await persistDeviceId(deviceId);
        set({ deviceId });
      },

      setFcmToken: async (fcmToken) => {
        await persistFcmToken(fcmToken);
        set({ fcmToken });
      },

      setPhase: (phase) => set({ phase }),
      setBootstrapPromise: (bootstrapPromise) => set({ bootstrapPromise }),

      isAuthenticated: () => {
        const state = get();
        return !!state.user && !!state.token;
      },

      isStudent: () => get().user?.role === 'STUDENT',
      isDriver: () => get().user?.role === 'DRIVER',
      hasRouteAssignment: () => Boolean(get().user?.routeAssignment),
    }),
    {
      name: 'auth-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        user: state.user,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          useAuthStore.setState({
            isLoaded: true,
            phase: 'unauthenticated',
          });
          return;
        }

        void state?.hydrateSession();
      },
    },
  ),
);

export function useAuth<T>(selector: (state: AuthStore) => T): T {
  return useAuthStore(selector);
}

export const authSelectors = {
  selectUser: (state: AuthStore) => state.user,
  selectToken: (state: AuthStore) => state.token,
  selectIsLoaded: (state: AuthStore) => state.isLoaded,
  selectPhase: (state: AuthStore) => state.phase,
  selectIsAuthenticated: (state: AuthStore) => !!state.user && !!state.token,
  selectDeviceId: (state: AuthStore) => state.deviceId,
  selectFcmToken: (state: AuthStore) => state.fcmToken,
} as const;
