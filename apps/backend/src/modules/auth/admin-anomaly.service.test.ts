import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockWriteAuthAuditEvent = vi.fn();
const mockRevokeAdminAuthState = vi.fn();
const mockCreateAdminBehaviorEvent = vi.fn();
const mockRedisSet = vi.fn();
const mockRedisExists = vi.fn();
const mockRedisIncrBy = vi.fn();
const mockRedisIncr = vi.fn();
const mockRedisExpire = vi.fn();
const mockRedisDel = vi.fn();

vi.mock('../../lib/auth-audit', () => ({
  writeAuthAuditEvent: mockWriteAuthAuditEvent,
}));

vi.mock('../../lib/auth-state-change', () => ({
  revokeAdminAuthState: mockRevokeAdminAuthState,
}));

vi.mock('../../lib/redis', () => ({
  redis: {
    set: mockRedisSet,
    exists: mockRedisExists,
    incrby: mockRedisIncrBy,
    incr: mockRedisIncr,
    expire: mockRedisExpire,
    del: mockRedisDel,
  },
}));

vi.mock('./admin-auth.repository', () => ({
  createAdminBehaviorEvent: mockCreateAdminBehaviorEvent,
}));

describe('admin anomaly service', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    mockRedisSet.mockResolvedValue('OK');
    mockRedisExists.mockResolvedValue(0);
    mockRedisIncrBy.mockResolvedValue(35);
    mockRedisIncr.mockResolvedValue(1);
    mockRedisExpire.mockResolvedValue(1);
    mockRedisDel.mockResolvedValue(1);
    mockCreateAdminBehaviorEvent.mockResolvedValue({ id: 'evt_1' });
    mockRevokeAdminAuthState.mockResolvedValue({ id: 'admin_1', sessionVersion: 4 });
  });

  it('marks the current admin session for reauthentication when the score crosses 30', async () => {
    const { applyAdminAnomalyScore, isAdminReauthRequired } = await import('./admin-anomaly.service');

    const result = await applyAdminAnomalyScore({
      adminId: 'admin_1',
      sessionVersion: 3,
      points: 35,
      reason: 'fingerprint_drift',
      eventType: 'FINGERPRINT_DRIFT',
      ipAddress: '127.0.0.1',
    });

    expect(result.action).toBe('FORCE_REAUTH');
    expect(mockRedisSet).toHaveBeenCalled();
    mockRedisExists.mockResolvedValueOnce(1);
    await expect(isAdminReauthRequired('admin_1', 3)).resolves.toBe(true);
    expect(mockWriteAuthAuditEvent).toHaveBeenCalled();
  });

  it('revokes all sessions when the anomaly score crosses 60', async () => {
    mockRedisIncrBy.mockResolvedValueOnce(70);

    const { applyAdminAnomalyScore } = await import('./admin-anomaly.service');
    const result = await applyAdminAnomalyScore({
      adminId: 'admin_1',
      sessionVersion: 3,
      points: 70,
      reason: 'fingerprint_mismatch',
      eventType: 'FINGERPRINT_MISMATCH',
      ipAddress: '127.0.0.1',
    });

    expect(result.action).toBe('REVOKE_ALL');
    expect(mockRevokeAdminAuthState).toHaveBeenCalledWith('admin_1');
  });

  it('turns repeated failed step-up attempts into a reauth signal', async () => {
    mockRedisIncr.mockResolvedValueOnce(3);
    mockRedisIncrBy.mockResolvedValueOnce(50);

    const { recordAdminStepUpFailure } = await import('./admin-anomaly.service');
    const result = await recordAdminStepUpFailure({
      adminId: 'admin_1',
      sessionVersion: 3,
      ipAddress: '127.0.0.1',
    });

    expect(result.failureCount).toBe(3);
    expect(result.action).toBe('FORCE_REAUTH');
    expect(mockCreateAdminBehaviorEvent).toHaveBeenCalled();
  });
});
