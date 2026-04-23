import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadAdminSessionModule = async () => import('./admin-session');

describe('admin session helpers', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/test?schema=public');
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    vi.stubEnv('JWT_SECRET', 'a'.repeat(32));
    vi.stubEnv('JWT_ISSUER', 'college-bus-system');
    vi.stubEnv('JWT_MOBILE_AUDIENCE', 'college-bus-mobile');
    vi.stubEnv('JWT_ADMIN_AUDIENCE', 'college-bus-admin');
    vi.stubEnv('BACKEND_URL', 'http://localhost:3000');
    vi.stubEnv('ADMIN_MFA_ISSUER', 'College Bus Admin');
    vi.stubEnv('ADMIN_MFA_ENCRYPTION_KEY', 'b'.repeat(32));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('treats only unsafe HTTP methods as CSRF-protected', async () => {
    const { requiresAdminCsrfProtection } = await loadAdminSessionModule();

    expect(requiresAdminCsrfProtection({ method: 'GET' } as any)).toBe(false);
    expect(requiresAdminCsrfProtection({ method: 'HEAD' } as any)).toBe(false);
    expect(requiresAdminCsrfProtection({ method: 'POST' } as any)).toBe(true);
    expect(requiresAdminCsrfProtection({ method: 'PATCH' } as any)).toBe(true);
    expect(requiresAdminCsrfProtection({ method: 'DELETE' } as any)).toBe(true);
  });

  it('validates double-submit csrf token matches', async () => {
    const { hasValidAdminCsrfToken } = await loadAdminSessionModule();

    expect(
      hasValidAdminCsrfToken({
        cookies: { admin_csrf: 'csrf-token' },
        headers: { 'x-csrf-token': 'csrf-token' },
      } as any)
    ).toBe(true);

    expect(
      hasValidAdminCsrfToken({
        cookies: { admin_csrf: 'csrf-token' },
        headers: { 'x-csrf-token': 'wrong-token' },
      } as any)
    ).toBe(false);

    expect(
      hasValidAdminCsrfToken({
        cookies: {},
        headers: { 'x-csrf-token': 'csrf-token' },
      } as any)
    ).toBe(false);
  });
});
