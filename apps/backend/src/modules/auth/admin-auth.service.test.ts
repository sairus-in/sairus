import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockWriteAuthAdminCache = vi.fn();
const mockWriteAuthAuditEvent = vi.fn();
const mockBuildAdminTrustedDeviceHash = vi.fn();
const mockEvaluateAdminGeoVelocity = vi.fn();
const mockCreateAdminMfaChallenge = vi.fn();
const mockGetAdminMfaChallenge = vi.fn();
const mockValidateAdminMfaChallenge = vi.fn();
const mockDeleteAdminMfaChallenge = vi.fn();
const mockDecryptAdminMfaSecret = vi.fn();
const mockEncryptAdminMfaSecret = vi.fn();
const mockGenerateAdminMfaSecret = vi.fn();
const mockBuildAdminMfaOtpAuthUrl = vi.fn();
const mockVerifyAdminTotpCode = vi.fn();
const mockSetAdminSessionCookies = vi.fn();
const mockClearAdminSessionCookies = vi.fn();
const mockRedisSetex = vi.fn();
const mockCheckAdminLoginRateLimit = vi.fn();
const mockCheckAdminMfaRateLimit = vi.fn();
const mockCheckAdminStepUpRateLimit = vi.fn();
const mockResetAdminLoginRateLimit = vi.fn();
const mockRevokeAdminAuthState = vi.fn();
const mockClearAdminAnomalyTracking = vi.fn();
const mockClearAdminStepUpFailures = vi.fn();
const mockRecordAdminStepUpFailure = vi.fn();
const mockSyncAdminFingerprint = vi.fn();

const mockRepository = {
  getUserByEmailForAuth: vi.fn(),
  verifyPasswordHash: vi.fn(),
  countTrustedDevices: vi.fn(),
  findTrustedDeviceByHash: vi.fn(),
  getLatestAdminLoginSuccess: vi.fn(),
  updateLoginInfo: vi.fn(),
  upsertTrustedDevice: vi.fn(),
  getUserByIdForAuth: vi.fn(),
  consumeAdminBackupCode: vi.fn(),
  getMfaConfig: vi.fn(),
  replaceAdminBackupCodes: vi.fn(),
  clearAdminBackupCodes: vi.fn(),
  getPasswordHashForAdmin: vi.fn(),
  getAdminBackupCodeSummary: vi.fn(),
};

vi.mock('../../lib/auth-cache', () => ({
  writeAuthAdminCache: mockWriteAuthAdminCache,
}));

vi.mock('../../lib/auth-audit', () => ({
  writeAuthAuditEvent: mockWriteAuthAuditEvent,
}));

vi.mock('../../lib/admin-security', () => ({
  buildAdminTrustedDeviceHash: mockBuildAdminTrustedDeviceHash,
  evaluateAdminGeoVelocity: mockEvaluateAdminGeoVelocity,
}));

vi.mock('../../lib/admin-mfa', () => ({
  adminMfaChallengeTtlSeconds: 300,
  buildAdminMfaOtpAuthUrl: mockBuildAdminMfaOtpAuthUrl,
  createAdminMfaChallenge: mockCreateAdminMfaChallenge,
  decryptAdminMfaSecret: mockDecryptAdminMfaSecret,
  deleteAdminMfaChallenge: mockDeleteAdminMfaChallenge,
  encryptAdminMfaSecret: mockEncryptAdminMfaSecret,
  generateAdminMfaSecret: mockGenerateAdminMfaSecret,
  getAdminMfaChallenge: mockGetAdminMfaChallenge,
  validateAdminMfaChallenge: mockValidateAdminMfaChallenge,
  verifyAdminTotpCode: mockVerifyAdminTotpCode,
}));

vi.mock('../../lib/admin-session', () => ({
  setAdminSessionCookies: mockSetAdminSessionCookies,
  clearAdminSessionCookies: mockClearAdminSessionCookies,
}));

vi.mock('../../lib/auth-config', () => ({
  jwtConfig: {
    secret: 'a'.repeat(32),
    issuer: 'college-bus-system',
    adminAudience: 'college-bus-admin',
    algorithm: 'HS256',
  },
}));

vi.mock('../../lib/redis', () => ({
  redis: {
    setex: mockRedisSetex,
  },
}));

vi.mock('../../lib/rate-limit', () => ({
  checkAdminLoginRateLimit: mockCheckAdminLoginRateLimit,
  checkAdminMfaRateLimit: mockCheckAdminMfaRateLimit,
  checkAdminStepUpRateLimit: mockCheckAdminStepUpRateLimit,
  resetAdminLoginRateLimit: mockResetAdminLoginRateLimit,
}));

vi.mock('../../lib/auth-state-change', () => ({
  revokeAdminAuthState: mockRevokeAdminAuthState,
}));

vi.mock('./admin-anomaly.service', () => ({
  clearAdminAnomalyTracking: mockClearAdminAnomalyTracking,
  clearAdminStepUpFailures: mockClearAdminStepUpFailures,
  recordAdminStepUpFailure: mockRecordAdminStepUpFailure,
}));

vi.mock('./admin-fingerprint.service', () => ({
  syncAdminFingerprint: mockSyncAdminFingerprint,
}));

vi.mock('./admin-auth.repository', () => mockRepository);

const replyStub = {} as any;

describe('admin auth service', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    mockBuildAdminTrustedDeviceHash.mockReturnValue('device-hash');
    mockEvaluateAdminGeoVelocity.mockReturnValue({
      decision: 'ALLOW',
      previousCountry: 'IN',
      currentCountry: 'IN',
      elapsedHours: null,
      reason: null,
    });
    mockValidateAdminMfaChallenge.mockReturnValue(true);
    mockDecryptAdminMfaSecret.mockReturnValue('SECRET');
    mockVerifyAdminTotpCode.mockReturnValue(true);
    mockCheckAdminLoginRateLimit.mockResolvedValue(undefined);
    mockCheckAdminMfaRateLimit.mockResolvedValue(undefined);
    mockCheckAdminStepUpRateLimit.mockResolvedValue(undefined);
    mockResetAdminLoginRateLimit.mockResolvedValue(undefined);
    mockWriteAuthAdminCache.mockResolvedValue(undefined);
    mockRepository.updateLoginInfo.mockResolvedValue(undefined);
    mockRepository.upsertTrustedDevice.mockResolvedValue(undefined);
    mockRepository.replaceAdminBackupCodes.mockResolvedValue(undefined);
    mockRepository.clearAdminBackupCodes.mockResolvedValue(undefined);
    mockRevokeAdminAuthState.mockResolvedValue(undefined);
    mockClearAdminAnomalyTracking.mockResolvedValue(undefined);
    mockClearAdminStepUpFailures.mockResolvedValue(undefined);
    mockRecordAdminStepUpFailure.mockResolvedValue({
      action: 'ALLOW',
      score: 0,
      failureCount: 1,
    });
    mockSyncAdminFingerprint.mockResolvedValue({
      isNewFingerprint: true,
      verdict: 'MATCH',
      action: 'ALLOW',
      score: 0,
      changedSignals: [],
      fingerprintHash: 'fp-hash',
    });
    mockRedisSetex.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('enables MFA and generates backup codes', async () => {
    mockRepository.getMfaConfig.mockResolvedValue({
      id: 'admin_1',
      email: 'admin@example.com',
      mfaEnabled: false,
      mfaSecretEncrypted: 'encrypted-secret',
    });

    const { enableAdminMfa } = await import('./admin-auth.service');
    const result = await enableAdminMfa('admin_1', '123456', replyStub);

    expect(result.success).toBe(true);
    expect(result.requiresReauth).toBe(true);
    expect(result.backupCodes).toHaveLength(8);
    expect(mockRepository.replaceAdminBackupCodes).toHaveBeenCalledTimes(1);
    expect(mockClearAdminSessionCookies).toHaveBeenCalledWith(replyStub);
    const [adminId, codeHashes] = mockRepository.replaceAdminBackupCodes.mock.calls[0];
    expect(adminId).toBe('admin_1');
    expect(codeHashes).toHaveLength(8);
  });

  it('accepts a valid backup code during MFA login verification', async () => {
    mockGetAdminMfaChallenge.mockResolvedValue({
      adminId: 'admin_1',
      ipHash: 'ip-hash',
      userAgentHash: 'ua-hash',
    });
    mockRepository.getUserByIdForAuth.mockResolvedValue({
      id: 'admin_1',
      name: 'Admin',
      email: 'admin@example.com',
      role: 'TRANSPORT_OFFICER',
      isActive: true,
      passwordHash: 'hash',
      sessionVersion: 3,
      mfaEnabled: true,
      mfaSecretEncrypted: 'encrypted-secret',
      createdById: null,
      lastLoginAt: null,
    });
    mockRepository.consumeAdminBackupCode.mockResolvedValue(true);

    const { verifyAdminLoginMfa } = await import('./admin-auth.service');
    const result = await verifyAdminLoginMfa(
      'challenge-token',
      { backupCode: 'ABCD1234' },
      '127.0.0.1',
      'Mozilla/5.0',
      'en-US',
      'IN',
      replyStub,
    );

    expect(result.success).toBe(true);
    expect(mockRepository.consumeAdminBackupCode).toHaveBeenCalledWith('admin_1', 'ABCD1234');
    expect(mockDeleteAdminMfaChallenge).toHaveBeenCalledWith('challenge-token');
    expect(mockSetAdminSessionCookies).toHaveBeenCalled();
  });

  it('blocks login when geo velocity policy says block', async () => {
    mockRepository.getUserByEmailForAuth.mockResolvedValue({
      id: 'admin_1',
      name: 'Admin',
      email: 'admin@example.com',
      role: 'TRANSPORT_OFFICER',
      isActive: true,
      isSuspended: false,
      passwordHash: 'hash',
      sessionVersion: 3,
      mfaEnabled: false,
      mfaSecretEncrypted: null,
      createdById: null,
      lastLoginAt: new Date('2026-04-07T00:00:00.000Z'),
    });
    mockRepository.verifyPasswordHash.mockResolvedValue(true);
    mockRepository.findTrustedDeviceByHash.mockResolvedValue(null);
    mockRepository.countTrustedDevices.mockResolvedValue(0);
    mockRepository.getLatestAdminLoginSuccess.mockResolvedValue({
      createdAt: new Date('2026-04-07T00:00:00.000Z'),
      metadata: { country: 'IN' },
    });
    mockEvaluateAdminGeoVelocity.mockReturnValue({
      decision: 'BLOCK',
      previousCountry: 'IN',
      currentCountry: 'US',
      elapsedHours: 2,
      reason: 'country_changed_too_quickly',
    });

    const { adminLogin } = await import('./admin-auth.service');

    await expect(
      adminLogin(
        'admin@example.com',
        'password',
        '127.0.0.1',
        'Mozilla/5.0',
        'en-US',
        'US',
        replyStub,
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN',
    });
  });

  it('blocks suspended administrators from logging in', async () => {
    mockRepository.getUserByEmailForAuth.mockResolvedValue({
      id: 'admin_1',
      name: 'Admin',
      email: 'admin@example.com',
      role: 'TRANSPORT_OFFICER',
      isActive: false,
      isSuspended: true,
      suspendedAt: new Date('2026-04-07T08:00:00.000Z'),
      suspendReason: 'Repeated policy violations',
      passwordHash: 'hash',
      sessionVersion: 3,
      mfaEnabled: false,
      mfaSecretEncrypted: null,
      createdById: null,
      lastLoginAt: new Date('2026-04-07T00:00:00.000Z'),
    });
    mockRepository.verifyPasswordHash.mockResolvedValue(true);

    const { adminLogin } = await import('./admin-auth.service');

    await expect(
      adminLogin(
        'admin@example.com',
        'password',
        '127.0.0.1',
        'Mozilla/5.0',
        'en-US',
        'IN',
        replyStub,
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'ACCOUNT_SUSPENDED',
    });
  });

  it('creates a step-up token bound to session and request context', async () => {
    mockRepository.getPasswordHashForAdmin.mockResolvedValue('stored-hash');
    mockRepository.verifyPasswordHash.mockResolvedValue(true);

    const { initiateAdminStepUp } = await import('./admin-auth.service');
    const result = await initiateAdminStepUp(
      'admin_1',
      7,
      'password',
      '127.0.0.1',
      'Mozilla/5.0',
    );

    expect(result.expiresInSeconds).toBe(300);
    expect(result.stepUpToken.length).toBeGreaterThan(20);
    expect(mockCheckAdminStepUpRateLimit).toHaveBeenCalledWith('admin_1', '127.0.0.1');
    expect(mockRedisSetex).toHaveBeenCalledTimes(1);
    expect(mockClearAdminStepUpFailures).toHaveBeenCalledWith('admin_1', 7);
  });
});
