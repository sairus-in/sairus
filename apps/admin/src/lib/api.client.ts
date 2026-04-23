import axios, { AxiosHeaders, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';
import type { AdminListResponse, SuccessResponse } from 'shared';
import { redirectToAdminLogin } from './session';

const readCookie = (name: string): string | null => {
  if (typeof document === 'undefined') {
    return null;
  }

  const prefix = `${name}=`;
  const match = document.cookie.split('; ').find((cookie) => cookie.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : null;
};

const buildAdminFingerprintHeaders = (): Record<string, string> => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {};
  }

  const navigatorWithMemory = navigator as Navigator & { deviceMemory?: number };
  const screenRes =
    typeof window.screen?.width === 'number' && typeof window.screen?.height === 'number'
      ? `${window.screen.width}x${window.screen.height}`
      : '';
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';

  return {
    ...(timezone ? { 'X-Admin-Timezone': timezone } : {}),
    ...(screenRes ? { 'X-Admin-Screen-Res': screenRes } : {}),
    ...(typeof window.screen?.colorDepth === 'number'
      ? { 'X-Admin-Color-Depth': String(window.screen.colorDepth) }
      : {}),
    ...(navigator.platform ? { 'X-Admin-Platform': navigator.platform } : {}),
    ...(typeof navigator.hardwareConcurrency === 'number'
      ? { 'X-Admin-Hardware-Concurrency': String(navigator.hardwareConcurrency) }
      : {}),
    ...(typeof navigatorWithMemory.deviceMemory === 'number'
      ? { 'X-Admin-Device-Memory': String(navigatorWithMemory.deviceMemory) }
      : {}),
  };
};

const baseClientConfig = {
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000',
  timeout: 10_000,
  withCredentials: true,
};

const axiosClient = axios.create(baseClientConfig);
const rawAxiosClient = axios.create(baseClientConfig);

const attachAdminRequestHeaders = (config: InternalAxiosRequestConfig) => {
  const headers = AxiosHeaders.from(config.headers);
  const method = config.method?.toUpperCase();
  if (method && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const csrfToken = readCookie('admin_csrf');
    if (csrfToken) {
      headers.set('X-CSRF-Token', csrfToken);
    }
  }

  Object.entries(buildAdminFingerprintHeaders()).forEach(([key, value]) => {
    headers.set(key, value);
  });

  config.headers = headers;

  return config;
};

const handleAdminResponseError = (error: any) => {
  const status = error.response?.status;
  const code =
    typeof error.response?.data?.code === 'string'
      ? error.response.data.code
      : typeof error.response?.data?.error === 'string'
        ? error.response.data.error
        : null;

  if (status === 401) {
    if (code === 'FORCED_RELOGIN_REQUIRED') {
      redirectToAdminLogin('forced-reauth');
    } else {
      redirectToAdminLogin('session-expired');
    }
  } else if (status === 403 && code === 'ACCOUNT_SUSPENDED') {
    redirectToAdminLogin('account-suspended');
  }
  return Promise.reject(error);
};

axiosClient.interceptors.request.use(attachAdminRequestHeaders);
rawAxiosClient.interceptors.request.use(attachAdminRequestHeaders);

axiosClient.interceptors.response.use(
  (response) => {
    if (response.data && typeof response.data === 'object' && response.data.success === true && 'data' in response.data) {
      return response.data.data;
    }
    return response.data;
  },
  handleAdminResponseError,
);

rawAxiosClient.interceptors.response.use(
  (response) => response,
  handleAdminResponseError,
);

export const api = {
  get<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return axiosClient.get(url, config) as unknown as Promise<T>;
  },
  post<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    return axiosClient.post(url, data, config) as unknown as Promise<T>;
  },
  put<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    return axiosClient.put(url, data, config) as unknown as Promise<T>;
  },
  patch<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    return axiosClient.patch(url, data, config) as unknown as Promise<T>;
  },
  delete<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return axiosClient.delete(url, config) as unknown as Promise<T>;
  },
  async getList<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<AdminListResponse<T>> {
    const response = await rawAxiosClient.get<SuccessResponse<T[]>>(url, config);
    const payload = response.data;

    if (!payload || payload.success !== true || !Array.isArray(payload.data) || !payload.pagination) {
      throw new Error(`Expected paginated response envelope from ${url}`);
    }

    return {
      data: payload.data,
      pagination: payload.pagination,
    };
  },
};
