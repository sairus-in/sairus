import { describe, expect, it } from 'vitest';
import { AppError, ForbiddenError } from './errors';

describe('errors', () => {
  it('preserves typed app error metadata', () => {
    const error = new AppError('Validation failed', 400, 'VALIDATION_ERROR', { field: 'email' });

    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details).toEqual({ field: 'email' });
  });

  it('supports the route-friendly constructor shape', () => {
    const error = new AppError(400, 'VALIDATION_ERROR', { field: 'email' });

    expect(error.message).toBe('Request validation failed.');
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details).toEqual({ field: 'email' });
  });

  it('builds derived error types with the expected status', () => {
    const error = new ForbiddenError('SCOPE_VIOLATION');

    expect(error.statusCode).toBe(403);
    expect(error.code).toBe('SCOPE_VIOLATION');
  });
});
