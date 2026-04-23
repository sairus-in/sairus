import * as crypto from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadAdminMfaModule = async () => import('./admin-mfa');

describe('admin MFA helpers', () => {
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

  it('encrypts and decrypts MFA secrets symmetrically', async () => {
    const { encryptAdminMfaSecret, decryptAdminMfaSecret } = await loadAdminMfaModule();
    const secret = 'JBSWY3DPEHPK3PXP';

    const encrypted = encryptAdminMfaSecret(secret);

    expect(encrypted).not.toContain(secret);
    expect(decryptAdminMfaSecret(encrypted)).toBe(secret);
  });

  it('verifies a known RFC6238-compatible TOTP code', async () => {
    const { generateAdminMfaSecret, verifyAdminTotpCode } = await loadAdminMfaModule();
    const { generateSync } = await import('otplib');
    const secret = generateAdminMfaSecret();
    const code = generateSync({
      secret,
      digits: 6,
      period: 30,
      epoch: 59,
    });

    expect(verifyAdminTotpCode(secret, code, 59_000, 0)).toBe(true);
    expect(verifyAdminTotpCode(secret, '000000', 59_000, 0)).toBe(false);
  });

  it('builds a standards-compatible otpauth url', async () => {
    const { buildAdminMfaOtpAuthUrl } = await loadAdminMfaModule();
    const url = buildAdminMfaOtpAuthUrl('admin@example.com', 'JBSWY3DPEHPK3PXP');

    expect(url).toContain('otpauth://totp/');
    expect(url).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(url).toContain('issuer=College%20Bus%20Admin');
  });

  it('binds MFA challenges to the originating ip and user agent context', async () => {
    const { validateAdminMfaChallenge } = await loadAdminMfaModule();
    const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
    const challenge = {
      adminId: 'admin_123',
      ipHash: hash('10.0.0.1'),
      userAgentHash: hash('smoke-browser'),
    };

    expect(validateAdminMfaChallenge(challenge, '10.0.0.1', 'smoke-browser')).toBe(true);
    expect(validateAdminMfaChallenge(challenge, '10.0.0.2', 'smoke-browser')).toBe(false);
    expect(validateAdminMfaChallenge(challenge, '10.0.0.1', 'other-browser')).toBe(false);
  });
});
