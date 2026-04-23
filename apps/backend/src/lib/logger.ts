/**
 * Phase 3.3: Distributed Tracing & Structured Correlation
 * Standardized logger for cross-boundary tracing.
 */

import { getRequestId } from './correlation';

export interface LogContext {
  requestId?: string;
  operationId?: string;
  tripId?: string;
  busId?: string;
  userId?: string;
  source?: 'DRIVER' | 'DELEGATE' | 'SYSTEM' | 'STUDENT' | 'ADMIN';
  event: string;
  meta?: Record<string, unknown>;
}

type LogInput = LogContext | string;

class Logger {
  info(ctx: LogInput, meta?: Record<string, unknown>) {
    console.info(JSON.stringify(this.normalizeContext(ctx, meta, undefined, 'info')));
  }

  warn(ctx: LogInput, meta?: Record<string, unknown>) {
    console.warn(JSON.stringify(this.normalizeContext(ctx, meta, undefined, 'warn')));
  }

  error(ctx: LogInput, errorOrMeta?: unknown, maybeError?: unknown) {
    const meta = this.isPlainObject(errorOrMeta) ? errorOrMeta : undefined;
    const error = this.isPlainObject(errorOrMeta) ? maybeError : errorOrMeta;
    console.error(JSON.stringify(this.normalizeContext(ctx, meta, error, 'error')));
  }

  private normalizeContext(
    ctx: LogInput,
    meta: Record<string, unknown> | undefined,
    error: unknown,
    level: 'info' | 'warn' | 'error',
  ) {
    const requestId = getRequestId() ?? 'no-context';

    if (typeof ctx === 'string') {
      return {
        ts: new Date().toISOString(),
        level,
        event: 'log_message',
        requestId,
        message: ctx,
        meta,
        ...(error === undefined ? {} : { error: this.serializeError(error) }),
      };
    }

    return {
      ts: new Date().toISOString(),
      level,
      ...ctx,
      requestId: ctx.requestId ?? requestId,
      meta: meta ? { ...(ctx.meta ?? {}), ...meta } : ctx.meta,
      ...(error === undefined ? {} : { error: this.serializeError(error) }),
    };
  }

  private serializeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}

export const logger = new Logger();
