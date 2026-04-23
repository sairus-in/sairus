// apps/backend/src/lib/errors.ts
// Typed HTTP error classes thrown by services and routes, then normalized by Fastify.
// Uses error codes from shared package for centralized error management.

import { ErrorCode, ERROR_STATUS_CODES, ERROR_MESSAGES, RETRYABLE_CODES } from 'shared';

/**
 * Main application error class.
 * All business logic errors should be thrown as AppError instances.
 * The global error handler catches and normalizes these to API responses.
 * 
 * Supports three call signatures:
 * @example
 * new AppError(statusCode, code, details?)           // Primary
 * new AppError(code, statusCode, code)               // Legacy widely used
 * new AppError(message, statusCode, code, details)   // Legacy with details
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details?: unknown;
  readonly retryable: boolean;

  constructor(
    statusCodeOrMessage: number | string,
    codeOrStatusCode: ErrorCode | number,
    detailsOrCode?: unknown | ErrorCode,
    maybeDetails?: unknown,
  ) {
    // Handle multiple signatures:
    // 1. new AppError(statusCode: number, code: ErrorCode, details?: unknown) - primary
    // 2. new AppError(message: string, statusCode: number, code: ErrorCode) - legacy
    // 3. new AppError(message: string, statusCode: number, code: ErrorCode, details: unknown) - legacy with details
    let statusCode: number;
    let code: ErrorCode;
    let details: unknown;
    let message: string;

    if (typeof statusCodeOrMessage === 'number' && typeof codeOrStatusCode === 'string') {
      // Primary signature: (statusCode, code, details?)
      statusCode = statusCodeOrMessage;
      code = codeOrStatusCode as ErrorCode;
      details = detailsOrCode;
      message = ERROR_MESSAGES[code] ?? code;
    } else if (typeof statusCodeOrMessage === 'string' && typeof codeOrStatusCode === 'number') {
      // Legacy signature: (message, statusCode, code, details?)
      message = statusCodeOrMessage;
      statusCode = codeOrStatusCode;
      code = detailsOrCode as ErrorCode;
      details = maybeDetails;
    } else {
      // Fallback - shouldn't happen with proper typing
      throw new Error(`Invalid AppError arguments`);
    }

    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
    this.name = 'AppError';
    this.statusCode = statusCode || ERROR_STATUS_CODES[code] || 500;
    this.code = code;
    this.details = details;
    this.retryable = RETRYABLE_CODES.has(code);
  }
}

// Convenience subclasses for common status codes
export class BadRequestError extends AppError {
  constructor(code: ErrorCode, details?: unknown) {
    super(400, code, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(code: ErrorCode = 'UNAUTHORIZED') {
    super(401, code);
  }
}

export class ForbiddenError extends AppError {
  constructor(code: ErrorCode = 'FORBIDDEN', details?: unknown) {
    super(403, code, details);
  }
}

export class NotFoundError extends AppError {
  constructor(code: ErrorCode = 'RESOURCE_NOT_FOUND') {
    super(404, code);
  }
}

export class ConflictError extends AppError {
  constructor(code: ErrorCode = 'RESOURCE_CONFLICT', details?: unknown) {
    super(409, code, details);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(code: ErrorCode = 'RATE_LIMITED') {
    super(429, code);
  }
}
