import { isAxiosError } from 'axios';

export interface ApiError {
  message: string;
  code: string;
  details?: unknown;
  status?: number;
}

const getValidationMessage = (details: unknown): string | null => {
  if (!Array.isArray(details) || details.length === 0) {
    return null;
  }

  const firstIssue = details[0] as { message?: unknown } | undefined;
  return typeof firstIssue?.message === 'string' ? firstIssue.message : null;
};

export function extractApiError(err: unknown): ApiError {
  if (isAxiosError(err)) {
    const data = err.response?.data;
    const status = err.response?.status;
    const detailsMessage = getValidationMessage(data?.details)
      ?? (typeof data?.details === 'string' ? data.details : null)
      ?? (typeof data?.message === 'string' ? data.message : null);

    if (data?.code) {
      return {
        message: detailsMessage ?? String(data.code),
        code: String(data.code),
        details: data.details,
        status,
      };
    }

    if (typeof data?.error === 'string') {
      return {
        message: typeof data?.message === 'string' ? data.message : data.error,
        code: data.error,
        details: data,
        status,
      };
    }

    if (Array.isArray(data?.issues)) {
      return {
        message: data.issues[0]?.message ?? 'Validation error',
        code: 'VALIDATION_ERROR',
        details: data.issues,
        status,
      };
    }

    if (!status) {
      return {
        message: 'Network error - check your connection',
        code: 'NETWORK_ERROR',
      };
    }

    return {
      message: err.message ?? 'Request failed',
      code: `HTTP_${status}`,
      status,
    };
  }

  if (err instanceof Error) {
    return { message: err.message, code: 'CLIENT_ERROR' };
  }

  return { message: 'Unknown error', code: 'UNKNOWN' };
}

export function isAuthError(err: unknown): boolean {
  if (isAxiosError(err)) {
    const status = err.response?.status;
    if (status === 401 || status === 403) {
      return true;
    }
  }

  const { code } = extractApiError(err);
  return code === 'HTTP_401' || code === 'HTTP_403' || code === 'UNAUTHORIZED' || code === 'FORBIDDEN';
}
