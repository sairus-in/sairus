import {
  MobileLoginDataSchema,
  MobileLoginPayloadSchema,
  MobileUserSchema,
  type MobileAuthUser,
  type MobileLoginData,
  type MobileLoginPayload,
} from 'shared';
import { api } from '../lib/api.client';

export const authService = {
  login: async (payload: MobileLoginPayload): Promise<MobileLoginData> => {
    const parsedPayload = MobileLoginPayloadSchema.parse(payload);
    return api.postParsed('/v1/auth/login', parsedPayload, MobileLoginDataSchema);
  },

  logout: async (): Promise<void> => {
    await api.fire('/v1/auth/logout').catch(() => {});
  },

  getMe: async (signal?: AbortSignal): Promise<MobileAuthUser> => {
    return api.getParsed('/v1/auth/me', MobileUserSchema, { signal });
  },

  registerFcmToken: async (fcmToken: string): Promise<void> => {
    await api.patch('/v1/users/fcm-token', { fcmToken }).catch(() => {});
  },
};
