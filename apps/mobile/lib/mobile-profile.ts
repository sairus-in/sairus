import type { AxiosRequestConfig } from 'axios';
import {
  MobileUserSchema,
  type MobileAuthUser,
  type MobileBootstrapUser,
} from 'shared';
import { api } from './api.client';

type ProfileRequestOptions = {
  token?: string;
  deviceId?: string | null;
};

const buildHeaders = (options?: ProfileRequestOptions) => {
  if (!options?.token && !options?.deviceId) {
    return undefined;
  }

  return {
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    ...(options.deviceId ? { 'x-device-id': options.deviceId } : {}),
  };
};

export function normalizeMobileProfile(data: MobileBootstrapUser | MobileAuthUser): MobileAuthUser {
  return MobileUserSchema.parse({
    id: data.id,
    name: data.name,
    phone: data.phone,
    email: data.email ?? null,
    role: data.role,
    isActive: data.isActive ?? true,
    rollNumber: data.rollNumber ?? undefined,
    department: data.department ?? undefined,
    year: data.year ?? undefined,
    routeAssignment: data.routeAssignment ?? null,
    busNumber: data.busNumber ?? undefined,
  });
}

export async function fetchMobileProfile(options?: ProfileRequestOptions): Promise<MobileAuthUser> {
  const requestConfig: AxiosRequestConfig & { skipBootstrapLock?: boolean } = {
    headers: buildHeaders(options),
    skipBootstrapLock: true,
  };

  const profile = await api.getParsed('/v1/auth/me', MobileUserSchema, requestConfig);
  return normalizeMobileProfile(profile);
}
