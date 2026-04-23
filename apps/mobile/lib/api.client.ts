import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios';
import { router } from 'expo-router';
import {
  ApiErrorSchema,
  ApiSuccessSchema,
  MobileRefreshDataSchema,
  type ErrorCode,
  type MobileRefreshPayload,
} from 'shared';
import { z } from 'zod';
import { useAuthStore } from '../store/auth.store';
import { getFreshFirebaseToken } from './phone-auth';
import { clearMobileSession } from './session';
import { config } from './config';
import { getAccessToken, getDeviceId } from './session-storage';

type MobileRequestConfig = InternalAxiosRequestConfig & {
  skipBootstrapLock?: boolean;
  _retried?: boolean;
};

type ParsedSchema<T> = z.ZodType<T>;

type ApiClient = AxiosInstance & {
  getParsed<T>(url: string, schema: ParsedSchema<T>, config?: AxiosRequestConfig): Promise<T>;
  postParsed<T>(url: string, body: unknown, schema: ParsedSchema<T>, config?: AxiosRequestConfig): Promise<T>;
  putParsed<T>(url: string, body: unknown, schema: ParsedSchema<T>, config?: AxiosRequestConfig): Promise<T>;
  patchParsed<T>(url: string, body: unknown, schema: ParsedSchema<T>, config?: AxiosRequestConfig): Promise<T>;
  deleteParsed<T>(url: string, schema: ParsedSchema<T>, config?: AxiosRequestConfig): Promise<T>;
  fire(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<void>;
};

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode | string,
    public readonly status: number,
    public readonly details?: unknown,
    public readonly responseMessage?: string,
  ) {
    super(responseMessage ?? `[${code}] HTTP ${status}`);
    this.name = 'ApiError';
  }
}

export class ApiValidationError extends Error {
  constructor(
    public readonly url: string,
    public readonly issues: z.ZodIssue[],
  ) {
    super(`Response validation failed for ${url}`);
    this.name = 'ApiValidationError';
  }
}

export class NetworkError extends Error {
  constructor(message = 'Network unavailable') {
    super(message);
    this.name = 'NetworkError';
  }
}

export const api = axios.create({
  baseURL: config.apiUrl,
  timeout: 10_000,
  headers: { 'Content-Type': 'application/json' },
}) as ApiClient;

api.interceptors.request.use(async (reqConfig) => {
  const requestConfig = reqConfig as MobileRequestConfig;
  const {
    token: storeToken,
    deviceId: storeDeviceId,
    phase,
    bootstrapPromise,
  } = useAuthStore.getState();

  if (!requestConfig.skipBootstrapLock && phase === 'bootstrapping' && bootstrapPromise) {
    await bootstrapPromise;
  }

  const token = storeToken ?? await getAccessToken();
  const deviceId = storeDeviceId ?? await getDeviceId();

  if (token) {
    requestConfig.headers.Authorization = `Bearer ${token}`;
  }

  if (deviceId) {
    requestConfig.headers['x-device-id'] = deviceId;
  }

  return requestConfig;
});

let refreshPromise: Promise<string> | null = null;

async function refreshToken(): Promise<string> {
  if (refreshPromise) {
    return refreshPromise;
  }

  const deviceId = useAuthStore.getState().deviceId ?? await getDeviceId();
  if (!deviceId) {
    throw new Error('No deviceId available for refresh');
  }

  refreshPromise = (async () => {
    const firebaseToken = await getFreshFirebaseToken();
    const payload: MobileRefreshPayload = {
      firebaseToken,
      deviceId,
    };

    const { data } = await axios.post(`${config.apiUrl}/v1/auth/refresh`, payload);
    const parsed = ApiSuccessSchema(MobileRefreshDataSchema).parse(data);
    const newToken = parsed.data.token;
    await useAuthStore.getState().setToken(newToken);
    return newToken;
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

api.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (!axios.isAxiosError(error)) {
      return Promise.reject(error);
    }

    const originalConfig = error.config as MobileRequestConfig | undefined;
    const status = error.response?.status;

    if (!error.response) {
      return Promise.reject(new NetworkError(error.message));
    }

    const isAuthEndpoint = originalConfig?.url?.includes('/v1/auth/');
    if (status === 401 && originalConfig && !originalConfig._retried && !isAuthEndpoint) {
      originalConfig._retried = true;

      try {
        const newToken = await refreshToken();
        originalConfig.headers = originalConfig.headers ?? {};
        originalConfig.headers.Authorization = `Bearer ${newToken}`;
        return api(originalConfig);
      } catch {
        await clearMobileSession();
        router.replace('/(auth)/login');
        return Promise.reject(new ApiError('TOKEN_EXPIRED', 401));
      }
    }

    if (status === 403 || (status === 401 && originalConfig?._retried)) {
      await clearMobileSession();
      router.replace('/(auth)/login');
    }

    const parsedError = ApiErrorSchema.safeParse(error.response.data);
    if (parsedError.success) {
      return Promise.reject(new ApiError(
        parsedError.data.error,
        status ?? 500,
        parsedError.data.details,
        parsedError.data.message,
      ));
    }

    return Promise.reject(new ApiError(
      'INTERNAL_SERVER_ERROR',
      status ?? 500,
      error.response.data,
      error.message,
    ));
  },
);

async function parseEnvelope<T>(url: string, raw: unknown, schema: ParsedSchema<T>): Promise<T> {
  const parsed = ApiSuccessSchema(schema).safeParse(raw);
  if (!parsed.success) {
    throw new ApiValidationError(url, parsed.error.issues);
  }

  return parsed.data.data as T;
}

api.getParsed = async <T>(url: string, schema: ParsedSchema<T>, requestConfig?: AxiosRequestConfig): Promise<T> => {
  const response = await api.get(url, requestConfig);
  return parseEnvelope(url, response.data, schema);
};

api.postParsed = async <T>(
  url: string,
  body: unknown,
  schema: ParsedSchema<T>,
  requestConfig?: AxiosRequestConfig,
): Promise<T> => {
  const response = await api.post(url, body, requestConfig);
  return parseEnvelope(url, response.data, schema);
};

api.putParsed = async <T>(
  url: string,
  body: unknown,
  schema: ParsedSchema<T>,
  requestConfig?: AxiosRequestConfig,
): Promise<T> => {
  const response = await api.put(url, body, requestConfig);
  return parseEnvelope(url, response.data, schema);
};

api.patchParsed = async <T>(
  url: string,
  body: unknown,
  schema: ParsedSchema<T>,
  requestConfig?: AxiosRequestConfig,
): Promise<T> => {
  const response = await api.patch(url, body, requestConfig);
  return parseEnvelope(url, response.data, schema);
};

api.deleteParsed = async <T>(url: string, schema: ParsedSchema<T>, requestConfig?: AxiosRequestConfig): Promise<T> => {
  const response = await api.delete(url, requestConfig);
  return parseEnvelope(url, response.data, schema);
};

api.fire = async (url: string, body?: unknown, requestConfig?: AxiosRequestConfig): Promise<void> => {
  await api.post(url, body, requestConfig);
};
