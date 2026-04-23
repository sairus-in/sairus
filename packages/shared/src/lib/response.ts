/**
 * RESPONSE CONTRACT — THE ONLY VALID API SHAPES
 * 
 * Every endpoint must return one of exactly three shapes:
 *   1. ok(data)                    → single resource or action result
 *   2. okList(data, pagination)    → paginated list
 *   3. fail(code, message)         → all errors (all status codes)
 * 
 * No raw arrays. No flat pagination. No data.data nesting. No exceptions.
 */

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface SuccessResponse<T = unknown> {
  success: true;
  data: T;
  pagination?: Pagination;
  requestId?: string;
  timestamp: string;
}

export interface ErrorResponse {
  success: false;
  error: string;       // machine-readable error code, e.g. "VALIDATION_ERROR"
  message: string;     // human-readable description
  details?: unknown;   // only for validation errors (zod issues array)
  retryable: boolean;  // should the client retry this request?
  requestId?: string;
  timestamp: string;
}

export type ApiResponse<T = unknown> = SuccessResponse<T> | ErrorResponse;

/**
 * Single resource or action result.
 *
 * Status codes:
 *   reply.code(201) — new DB row created
 *   reply.code(200) — GET, PATCH, PUT, action commands (default)
 *   reply.code(204) — DELETE with no content
 */
export function ok<T>(data: T, requestId?: string): SuccessResponse<T> {
  return {
    success: true,
    data,
    requestId,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Paginated list. Pagination is always flat at the top level — never nested.
 *
 * Status code: 200 (always — list endpoints never create resources)
 */
export function okList<T>(
  data: T[],
  pagination: Pagination,
  requestId?: string,
): SuccessResponse<T[]> {
  return {
    success: true,
    data,
    pagination,
    requestId,
    timestamp: new Date().toISOString(),
  };
}

/**
 * All error responses. Called by the global error handler automatically.
 * Route handlers should throw AppError — not call this directly.
 */
export function fail(
  code: string,
  message: string,
  options?: {
    details?: unknown;
    retryable?: boolean;
    requestId?: string;
  },
): ErrorResponse {
  return {
    success: false,
    error: code,
    message,
    details: options?.details,
    retryable: options?.retryable ?? false,
    requestId: options?.requestId,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Helper to compute pagination metadata.
 * Pass directly to okList().
 * 
 * @param page 1-based page number
 * @param limit items per page
 * @param total total items in result set
 */
export function buildPagination(
  page: number,
  limit: number,
  total: number,
): Pagination {
  return {
    page,
    limit,
    total,
    hasMore: total > page * limit,
  };
}
