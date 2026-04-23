import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from './errors';
import { logger } from './logger';
import { fail } from 'shared';
import { ERROR_STATUS_CODES, ERROR_MESSAGES, RETRYABLE_CODES, type ErrorCode } from 'shared';

const isDev = process.env.NODE_ENV === 'development';

/**
 * PRODUCTION-GRADE ERROR HANDLER
 *
 * Handles all error types in the system with structured logging, audit context,
 * and idempotency awareness. Architecture:
 *
 * Error Classification:
 *   1. AppError (typed business logic errors)
 *   2. Zod validation errors
 *   3. Prisma DB errors
 *   4. Fastify schema validation errors
 *   5. Rate limit errors
 *   6. Auth errors
 *   7. Unhandled errors
 *
 * Logging Strategy:
 *   - 5xx errors: always logged as ERROR
 *   - 4xx errors: logged only in dev as WARN (except certain sensitive cases)
 *   - Includes: requestId, user, method, url, duration, audit context
 *   - Sanitizes: strips sensitive data, limits stack traces in production
 *
 * Retryability:
 *   - Explicitly declared per error code via RETRYABLE_CODES
 *   - Idempotent operations are protected via idempotency-key header
 */

interface RequestContext {
  requestId: string;
  userId: string | null;
  userRole: string | null;
  coordinatorScope: string | null;
  method: string;
  url: string;
  startTime: number;
  duration: number;
}

/**
 * Build structured request context from Fastify request.
 * This is used in all error logs to provide consistent audit trail.
 */
function buildRequestContext(request: FastifyRequest): RequestContext {
  const user = (request as any).user;
  const requestId = request.id ?? (request as any).requestId;
  const startTime = (request as any).startTime ?? Date.now();

  return {
    requestId,
    userId: user?.sub ?? null,
    userRole: user?.role ?? null,
    coordinatorScope: user?.coordinatorScope ?? null,
    method: request.method,
    url: request.url,
    startTime,
    duration: Date.now() - startTime,
  };
}

/**
 * Log a business error (AppError) with full context.
 * Decides whether to log based on HTTP status and environment.
 */
function logAppError(
  requestLog: any,
  error: AppError,
  context: RequestContext,
  isDevelopment: boolean,
): void {
  const statusCode = error.statusCode || ERROR_STATUS_CODES[error.code] || 500;

  const logContext = {
    requestId: context.requestId,
    userId: context.userId,
    userRole: context.userRole,
    coordinatorScope: context.coordinatorScope,
    method: context.method,
    url: context.url,
    duration: context.duration,
    errorCode: error.code,
    statusCode,
    details: error.details,
    err: error,
    msg: `${error.code} [${statusCode}]`,
  };

  // Log strategy: 5xx always, 4xx only in dev, except sensitive auth/security errors
  if (statusCode >= 500) {
    requestLog.error(logContext);
  } else if (isDevelopment) {
    requestLog.warn(logContext);
  } else if (statusCode === 401 || statusCode === 403) {
    // Always log auth/security errors in production for security auditing
    requestLog.warn(logContext);
  }
}

/**
 * Log a validation error from Zod or Fastify schema validation.
 */
function logValidationError(
  requestLog: any,
  issuesCount: number,
  context: RequestContext,
): void {
  requestLog.warn({
    requestId: context.requestId,
    userId: context.userId,
    method: context.method,
    url: context.url,
    duration: context.duration,
    errorCode: 'VALIDATION_ERROR',
    statusCode: 400,
    issueCount: issuesCount,
    msg: `Validation failed (${issuesCount} issues)`,
  });
}

/**
 * Log a database error from Prisma with classification.
 */
function logDatabaseError(
  requestLog: any,
  error: any,
  context: RequestContext,
  isDevelopment: boolean,
): void {
  const prismaCode = error.code;
  let mappedCode: ErrorCode | null = null;
  let statusCode = 500;

  // Map Prisma error codes to our ErrorCode space
  if (prismaCode === 'P2002') {
    mappedCode = 'RESOURCE_CONFLICT';
    statusCode = 409;
  } else if (prismaCode === 'P2025') {
    mappedCode = 'RESOURCE_NOT_FOUND';
    statusCode = 404;
  } else if (prismaCode === 'P2003') {
    // Foreign key constraint
    mappedCode = 'OPERATION_FAILED';
    statusCode = 422;
  } else if (prismaCode === 'P2014') {
    // Required relation violation
    mappedCode = 'OPERATION_FAILED';
    statusCode = 422;
  } else {
    // Generic DB error
    mappedCode = 'INTERNAL_SERVER_ERROR';
    statusCode = 500;
  }

  requestLog.error({
    requestId: context.requestId,
    userId: context.userId,
    method: context.method,
    url: context.url,
    duration: context.duration,
    errorCode: mappedCode,
    statusCode,
    prismaCode,
    target: error.meta?.target,
    err: isDevelopment ? error : { message: error.message },
    msg: `Database error: ${prismaCode}`,
  });
}

/**
 * Log an unhandled error (catch-all).
 */
function logUnhandledError(
  requestLog: any,
  error: unknown,
  context: RequestContext,
  isDevelopment: boolean,
): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;

  requestLog.error({
    requestId: context.requestId,
    userId: context.userId,
    method: context.method,
    url: context.url,
    duration: context.duration,
    errorCode: 'INTERNAL_SERVER_ERROR',
    statusCode: 500,
    errorType: error?.constructor?.name ?? typeof error,
    message: errorMessage,
    err: isDevelopment ? error : undefined,
    stack: isDevelopment ? errorStack : undefined,
    msg: 'Unhandled error',
  });
}

export function setupErrorHandler(app: FastifyInstance) {
  app.setErrorHandler(async (error: unknown, request: FastifyRequest, reply: FastifyReply) => {
    const context = buildRequestContext(request);

    // ─────────────────────────────────────────────────────────────────────────
    // 1. TYPED BUSINESS LOGIC ERRORS (AppError)
    // ─────────────────────────────────────────────────────────────────────────
    if (error instanceof AppError) {
      const statusCode = error.statusCode || ERROR_STATUS_CODES[error.code] || 500;

      logAppError(request.log, error, context, isDev);

      return reply.code(statusCode).send(
        fail(error.code, ERROR_MESSAGES[error.code] ?? error.message, {
          details: error.details,
          retryable: RETRYABLE_CODES.has(error.code),
          requestId: context.requestId,
        }),
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. ZOD VALIDATION ERRORS
    // ─────────────────────────────────────────────────────────────────────────
    if (error instanceof ZodError) {
      logValidationError(request.log, error.issues.length, context);

      return reply.code(400).send(
        fail('VALIDATION_ERROR', ERROR_MESSAGES.VALIDATION_ERROR, {
          details: error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
            code: i.code,
          })),
          retryable: false,
          requestId: context.requestId,
        }),
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. PRISMA DATABASE ERRORS
    // ─────────────────────────────────────────────────────────────────────────
    if ((error as any)?.code?.startsWith('P')) {
      logDatabaseError(request.log, error as any, context, isDev);

      const prismaError = error as any;

      if (prismaError.code === 'P2002') {
        // Unique constraint violation → RESOURCE_CONFLICT
        return reply.code(409).send(
          fail('RESOURCE_CONFLICT', 'This record already exists.', {
            details: prismaError?.meta?.target,
            retryable: false,
            requestId: context.requestId,
          }),
        );
      }

      if (prismaError.code === 'P2025') {
        // Record not found
        return reply.code(404).send(
          fail('RESOURCE_NOT_FOUND', 'Record not found.', {
            retryable: false,
            requestId: context.requestId,
          }),
        );
      }

      if (prismaError.code === 'P2003' || prismaError.code === 'P2014') {
        // Foreign key or relation violation
        return reply.code(422).send(
          fail('OPERATION_FAILED', ERROR_MESSAGES.OPERATION_FAILED, {
            details: { prismaCode: prismaError.code },
            retryable: false,
            requestId: context.requestId,
          }),
        );
      }

      // Other Prisma errors → INTERNAL_SERVER_ERROR
      return reply.code(500).send(
        fail('INTERNAL_SERVER_ERROR', ERROR_MESSAGES.INTERNAL_SERVER_ERROR, {
          details: isDev ? { prismaCode: prismaError.code } : undefined,
          retryable: true,
          requestId: context.requestId,
        }),
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. FASTIFY SCHEMA VALIDATION ERRORS
    // ─────────────────────────────────────────────────────────────────────────
    if ((error as any)?.validation) {
      const validationErrors = (error as any).validation;
      logValidationError(request.log, Array.isArray(validationErrors) ? validationErrors.length : 1, context);

      return reply.code(400).send(
        fail('VALIDATION_ERROR', ERROR_MESSAGES.VALIDATION_ERROR, {
          details: validationErrors,
          retryable: false,
          requestId: context.requestId,
        }),
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 5. RATE LIMIT ERRORS (@fastify/rate-limit)
    // ─────────────────────────────────────────────────────────────────────────
    if ((error as any)?.statusCode === 429) {
      request.log.warn({
        requestId: context.requestId,
        userId: context.userId,
        method: context.method,
        url: context.url,
        duration: context.duration,
        errorCode: 'RATE_LIMITED',
        statusCode: 429,
        msg: 'Rate limit exceeded',
      });

      return reply.code(429).send(
        fail('RATE_LIMITED', ERROR_MESSAGES.RATE_LIMITED, {
          retryable: true,
          requestId: context.requestId,
        }),
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 6. AUTH/SECURITY ERRORS (JWT, unauthorized, etc.)
    // ─────────────────────────────────────────────────────────────────────────
    const errorMsg = (error as any)?.message ?? '';
    if (
      errorMsg.includes('Unauthorized') ||
      errorMsg.includes('UNAUTHORIZED') ||
      (error as any)?.statusCode === 401
    ) {
      request.log.warn({
        requestId: context.requestId,
        method: context.method,
        url: context.url,
        duration: context.duration,
        errorCode: 'UNAUTHORIZED',
        statusCode: 401,
        msg: 'Authentication failed',
      });

      return reply.code(401).send(
        fail('UNAUTHORIZED', ERROR_MESSAGES.UNAUTHORIZED, {
          retryable: false,
          requestId: context.requestId,
        }),
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 7. UNHANDLED / FALLBACK (catch-all)
    // ─────────────────────────────────────────────────────────────────────────
    logUnhandledError(request.log, error, context, isDev);

    return reply.code(500).send(
      fail('INTERNAL_SERVER_ERROR', ERROR_MESSAGES.INTERNAL_SERVER_ERROR, {
        details: isDev && typeof error === 'object' ? (error as any)?.stack : undefined,
        retryable: true,
        requestId: context.requestId,
      }),
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 404 / NOT FOUND HANDLER
  // ───────────────────────────────────────────────────────────────────────────
  app.setNotFoundHandler((request, reply) => {
    const context = buildRequestContext(request);

    request.log.warn({
      requestId: context.requestId,
      userId: context.userId,
      method: context.method,
      url: context.url,
      duration: context.duration,
      errorCode: 'RESOURCE_NOT_FOUND',
      statusCode: 404,
      msg: `Route not found: ${request.method} ${request.url}`,
    });

    return reply.code(404).send(
      fail('RESOURCE_NOT_FOUND', `Route ${request.method} ${request.url} not found.`, {
        retryable: false,
        requestId: context.requestId,
      }),
    );
  });
}
