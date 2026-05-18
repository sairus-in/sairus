import { create } from 'zustand';
import { adminRoleSchema, AdminSessionUser } from 'shared';
import { getCapabilities, Capabilities, AdminRole } from '../lib/capabilities';

export type User = AdminSessionUser & { role: AdminRole };

interface AuthState {
  user: User | null;
  capabilities: Capabilities | null;
  isAuthenticated: boolean;
  login: (user: User) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  capabilities: null,
  isAuthenticated: false,

  login: (user) => {
    const parsedRole = adminRoleSchema.safeParse(user.role);
    if (!parsedRole.success) {
      set({
        user: null,
        capabilities: null,
        isAuthenticated: false,
      });
      throw new Error(`Admin session returned an invalid role: ${String(user.role)}`);
    }

    const routeIds = Array.isArray(user.routeIds) ? user.routeIds : [];
    const sessionCapabilities = Array.isArray(user.capabilities) ? user.capabilities : [];
    const capabilities = getCapabilities(sessionCapabilities, parsedRole.data, routeIds, user.department);
    set({
      user: { ...user, role: parsedRole.data },
      capabilities,
      isAuthenticated: true,
    });
  },

  logout: () => {
    set({
      user: null,
      capabilities: null,
      isAuthenticated: false,
    });
  },
}));
