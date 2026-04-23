import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';

const mockGetAuthAdminState = vi.fn();
const mockConsumeAdminStepUpToken = vi.fn();
const mockCheckAdminAuthenticatedRateLimit = vi.fn();
const mockIsAdminReauthRequired = vi.fn();
const mockRecordAdminApiBurst = vi.fn();
const mockRecordAdminFingerprintAnomaly = vi.fn();
const mockRecordAdminUnusualHour = vi.fn();
const mockExtractAdminFingerprintFromHeaders = vi.fn();
const mockSyncAdminFingerprint = vi.fn();

vi.mock('../../lib/auth-cache', () => ({
  getAuthAdminState: mockGetAuthAdminState,
}));

vi.mock('../../lib/rate-limit', () => ({
  checkAdminAuthenticatedRateLimit: mockCheckAdminAuthenticatedRateLimit,
}));

vi.mock('./admin-anomaly.service', () => ({
  isAdminReauthRequired: mockIsAdminReauthRequired,
  recordAdminApiBurst: mockRecordAdminApiBurst,
  recordAdminFingerprintAnomaly: mockRecordAdminFingerprintAnomaly,
  recordAdminUnusualHour: mockRecordAdminUnusualHour,
}));

vi.mock('./admin-fingerprint.service', () => ({
  extractAdminFingerprintFromHeaders: mockExtractAdminFingerprintFromHeaders,
  syncAdminFingerprint: mockSyncAdminFingerprint,
}));

vi.mock('./admin-auth.service', () => ({
  consumeAdminStepUpToken: mockConsumeAdminStepUpToken,
}));

const buildReply = () => {
  const reply: any = {
    statusCode: 200,
    payload: null,
    cookies: [] as Array<{ name: string; value: string; options: Record<string, unknown> }>,
    code(statusCode: number) {
      this.statusCode = statusCode;
      return this;
    },
    send(payload: unknown) {
      this.payload = payload;
      return this;
    },
    setCookie(name: string, value: string, options: Record<string, unknown>) {
      this.cookies.push({ name, value, options });
      return this;
    },
  };

  return reply;
};

const buildAdminJwt = () =>
  jwt.sign(
    {
      sub: 'admin_123',
      type: 'ADMIN',
      role: 'TRANSPORT_OFFICER',
      email: 'admin@example.com',
      sv: 3,
    },
    'a'.repeat(32),
    {
      expiresIn: '8h',
      issuer: 'college-bus-system',
      audience: 'college-bus-admin',
      algorithm: 'HS256',
    }
  );

describe('requireAdminAuth', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
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

    mockGetAuthAdminState.mockResolvedValue({
      isActive: true,
      role: 'TRANSPORT_OFFICER',
      sessionVersion: 3,
    });
    mockConsumeAdminStepUpToken.mockResolvedValue(true);
    mockCheckAdminAuthenticatedRateLimit.mockResolvedValue({
      adminCount: 1,
      ipCount: 1,
      anomalyTriggered: false,
    });
    mockIsAdminReauthRequired.mockResolvedValue(false);
    mockRecordAdminApiBurst.mockResolvedValue({ action: 'ALLOW', score: 0 });
    mockRecordAdminFingerprintAnomaly.mockResolvedValue({ action: 'ALLOW', score: 0 });
    mockRecordAdminUnusualHour.mockResolvedValue({ action: 'ALLOW', score: 0 });
    mockExtractAdminFingerprintFromHeaders.mockReturnValue({
      userAgent: 'mozilla/5.0',
      acceptLanguage: 'en-us',
      timezone: 'asia/kolkata',
      screenRes: '1920x1080',
      colorDepth: 24,
      platform: 'win32',
      hardwareConcurrency: 8,
      deviceMemory: 16,
      ipCountry: 'IN',
      ipASN: 'as4134',
    });
    mockSyncAdminFingerprint.mockResolvedValue({
      isNewFingerprint: false,
      verdict: 'MATCH',
      action: 'ALLOW',
      score: 0,
      changedSignals: [],
      fingerprintHash: 'fp-hash',
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('authenticates safe requests and restores the csrf cookie when missing', async () => {
    const { requireAdminAuth } = await import('./admin-auth.middleware');
    const req: any = {
      method: 'GET',
      id: 'req_1',
      cookies: {
        admin_jwt: buildAdminJwt(),
      },
      headers: {},
    };
    const reply = buildReply();

    await requireAdminAuth(req, reply);

    expect(req.user?.sub).toBe('admin_123');
    expect(mockCheckAdminAuthenticatedRateLimit).toHaveBeenCalledWith('admin_123', undefined);
    expect(reply.statusCode).toBe(200);
    expect(reply.payload).toBeNull();
    expect(
      reply.cookies.some(
        (cookie: { name: string; value: string; options: Record<string, unknown> }) =>
          cookie.name === 'admin_csrf'
      )
    ).toBe(true);
  });

  it('rejects unsafe requests when csrf tokens do not match', async () => {
    const { requireAdminAuth } = await import('./admin-auth.middleware');
    const req: any = {
      method: 'POST',
      id: 'req_2',
      cookies: {
        admin_jwt: buildAdminJwt(),
        admin_csrf: 'cookie-token',
      },
      headers: {},
    };
    const reply = buildReply();

    await expect(requireAdminAuth(req, reply)).rejects.toMatchObject({
      statusCode: 403,
      code: 'CSRF_VALIDATION_FAILED',
      details: 'req_2',
    });
  });

  it('allows unsafe requests with a matching csrf header', async () => {
    const { requireAdminAuth } = await import('./admin-auth.middleware');
    const req: any = {
      method: 'POST',
      id: 'req_3',
      cookies: {
        admin_jwt: buildAdminJwt(),
        admin_csrf: 'cookie-token',
      },
      headers: {
        'x-csrf-token': 'cookie-token',
      },
    };
    const reply = buildReply();

    await requireAdminAuth(req, reply);

    expect(req.user?.sub).toBe('admin_123');
    expect(reply.statusCode).toBe(200);
    expect(reply.payload).toBeNull();
  });

  it('enforces authenticated admin API rate limits', async () => {
    mockCheckAdminAuthenticatedRateLimit.mockRejectedValueOnce({
      statusCode: 429,
      code: 'RATE_LIMITED',
    });

    const { requireAdminAuth } = await import('./admin-auth.middleware');
    const req: any = {
      method: 'GET',
      id: 'req_6',
      ip: '127.0.0.1',
      cookies: {
        admin_jwt: buildAdminJwt(),
      },
      headers: {},
    };
    const reply = buildReply();

    await expect(requireAdminAuth(req, reply)).rejects.toMatchObject({
      statusCode: 429,
      code: 'RATE_LIMITED',
    });
  });

  it('forces reauthentication when the session is already flagged', async () => {
    mockIsAdminReauthRequired.mockResolvedValueOnce(true);

    const { requireAdminAuth } = await import('./admin-auth.middleware');
    const req: any = {
      method: 'GET',
      id: 'req_7',
      ip: '127.0.0.1',
      url: '/v1/admin/live/dashboard',
      cookies: {
        admin_jwt: buildAdminJwt(),
      },
      headers: {},
    };
    const reply = buildReply();

    await expect(requireAdminAuth(req, reply)).rejects.toMatchObject({
      statusCode: 401,
      code: 'FORCED_RELOGIN_REQUIRED',
    });
  });

  it('forces reauthentication on fingerprint drift risk', async () => {
    mockSyncAdminFingerprint.mockResolvedValueOnce({
      isNewFingerprint: false,
      verdict: 'DRIFT',
      action: 'FORCE_REAUTH',
      score: 35,
      changedSignals: ['timezone'],
      fingerprintHash: 'fp-hash',
    });
    mockRecordAdminFingerprintAnomaly.mockResolvedValueOnce({
      action: 'FORCE_REAUTH',
      score: 35,
    });

    const { requireAdminAuth } = await import('./admin-auth.middleware');
    const req: any = {
      method: 'GET',
      id: 'req_8',
      ip: '127.0.0.1',
      url: '/v1/admin/live/dashboard',
      cookies: {
        admin_jwt: buildAdminJwt(),
      },
      headers: {},
    };
    const reply = buildReply();

    await expect(requireAdminAuth(req, reply)).rejects.toMatchObject({
      statusCode: 401,
      code: 'FORCED_RELOGIN_REQUIRED',
    });
  });

  it('requires a step-up token header on sensitive actions', async () => {
    const { requireAdminStepUp } = await import('./admin-auth.middleware');
    const req: any = {
      method: 'POST',
      id: 'req_4',
      ip: '127.0.0.1',
      headers: {},
      user: {
        sub: 'admin_123',
        sv: 3,
        type: 'ADMIN',
      },
    };
    const reply = buildReply();

    await expect(requireAdminStepUp(req, reply)).rejects.toMatchObject({
      statusCode: 403,
      code: 'STEP_UP_REQUIRED',
    });
  });

  it('consumes a valid step-up token', async () => {
    const { requireAdminStepUp } = await import('./admin-auth.middleware');
    const req: any = {
      method: 'POST',
      id: 'req_5',
      ip: '127.0.0.1',
      headers: {
        'x-admin-step-up': 'step-up-token',
        'user-agent': 'Mozilla/5.0',
      },
      user: {
        sub: 'admin_123',
        sv: 3,
        type: 'ADMIN',
      },
    };
    const reply = buildReply();

    await requireAdminStepUp(req, reply);

    expect(mockConsumeAdminStepUpToken).toHaveBeenCalledWith(
      'step-up-token',
      'admin_123',
      3,
      '127.0.0.1',
      'Mozilla/5.0',
    );
  });
});
