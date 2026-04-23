import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRepository = {
  getAdminFingerprint: vi.fn(),
  upsertAdminFingerprint: vi.fn(),
};

vi.mock('./admin-auth.repository', () => mockRepository);

describe('admin fingerprint service', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockRepository.upsertAdminFingerprint.mockResolvedValue(undefined);
  });

  it('stores the first fingerprint as a trusted baseline', async () => {
    mockRepository.getAdminFingerprint.mockResolvedValue(null);

    const { syncAdminFingerprint } = await import('./admin-fingerprint.service');
    const result = await syncAdminFingerprint('admin_1', {
      userAgent: 'Mozilla/5.0',
      acceptLanguage: 'en-US',
      ipCountry: 'IN',
    });

    expect(result.isNewFingerprint).toBe(true);
    expect(result.verdict).toBe('MATCH');
    expect(mockRepository.upsertAdminFingerprint).toHaveBeenCalledTimes(1);
  });

  it('treats browser-version drift as a reauth signal', async () => {
    const { evaluateAdminFingerprintDrift } = await import('./admin-fingerprint.service');

    const result = evaluateAdminFingerprintDrift(
      {
        userAgent: 'chrome/124',
        acceptLanguage: 'en-us',
        timezone: 'asia/kolkata',
        screenRes: '1920x1080',
        colorDepth: 24,
        platform: 'win32',
        hardwareConcurrency: 8,
        deviceMemory: 16,
        ipCountry: 'IN',
        ipASN: 'as4134',
      },
      {
        userAgent: 'chrome/125',
        acceptLanguage: 'en-us',
        timezone: 'asia/kolkata',
        screenRes: '1920x1080',
        colorDepth: 24,
        platform: 'win32',
        hardwareConcurrency: 8,
        deviceMemory: 16,
        ipCountry: 'US',
        ipASN: 'as4134',
      },
    );

    expect(result.verdict).toBe('MISMATCH');
    expect(result.action).toBe('REVOKE');
    expect(result.changedSignals).toContain('ipCountry');
  });

  it('does not overwrite the stored baseline on a hard mismatch', async () => {
    mockRepository.getAdminFingerprint.mockResolvedValue({
      adminId: 'admin_1',
      userAgent: 'chrome/124',
      acceptLanguage: 'en-us',
      timezone: 'asia/kolkata',
      screenRes: '1920x1080',
      colorDepth: 24,
      platform: 'win32',
      hardwareConcurrency: 8,
      deviceMemory: 16,
      ipCountry: 'IN',
      ipASN: 'as4134',
      fpHash: 'stored-hash',
      lastVerdict: 'MATCH',
      lastDriftScore: 0,
      lastSeenAt: new Date('2026-04-07T00:00:00.000Z'),
    });

    const { syncAdminFingerprint } = await import('./admin-fingerprint.service');
    const result = await syncAdminFingerprint('admin_1', {
      userAgent: 'safari/17',
      acceptLanguage: 'fr-FR',
      timezone: 'europe/paris',
      screenRes: '1440x900',
      platform: 'macintel',
      hardwareConcurrency: 10,
      ipCountry: 'FR',
      ipASN: 'as3215',
    });

    expect(result.verdict).toBe('MISMATCH');
    expect(mockRepository.upsertAdminFingerprint).not.toHaveBeenCalled();
  });
});
