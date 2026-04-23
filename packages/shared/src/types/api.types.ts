// DEPRECATED: Use lib/response.ts instead for ApiResponse, SuccessResponse, and ErrorResponse
// Kept only for legacy PaginatedResponse until migration is complete

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface ApiError {
  success: false;
  code: string;
  message?: string;
  requestId?: string;
  details?: unknown;
}
