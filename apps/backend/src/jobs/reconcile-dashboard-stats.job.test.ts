import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockTripCount = vi.fn();
const mockTripFindMany = vi.fn();
const mockAttendanceCount = vi.fn();
const mockCorrectionCount = vi.fn();
const mockRedisHGet = vi.fn();
const mockRedisSMembers = vi.fn();
const mockPipelineExec = vi.fn();
const mockWithLock = vi.fn();

const pipelineState = {
  hset: vi.fn(),
  del: vi.fn(),
  sadd: vi.fn(),
  zadd: vi.fn(),
  exec: mockPipelineExec,
};

const mockRedisPipeline = vi.fn(() => pipelineState);
const mockLoggerInfo = vi.fn();

vi.mock('../lib/prisma', () => ({
  prisma: {
    trip: {
      count: mockTripCount,
      findMany: mockTripFindMany,
    },
    attendanceLog: {
      count: mockAttendanceCount,
    },
    attendanceCorrection: {
      count: mockCorrectionCount,
    },
  },
}));

vi.mock('../lib/redis', () => ({
  redis: {
    hget: mockRedisHGet,
    smembers: mockRedisSMembers,
    pipeline: mockRedisPipeline,
  },
}));

vi.mock('../lib/logger', () => ({
  logger: {
    info: mockLoggerInfo,
  },
}));

vi.mock('../lib/distributed-lock', () => ({
  withLock: mockWithLock,
}));

describe('reconcileDashboardStats', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    mockTripCount.mockResolvedValue(2);
    mockAttendanceCount.mockResolvedValue(7);
    mockCorrectionCount.mockResolvedValue(3);
    mockTripFindMany.mockResolvedValue([
      { id: 'trip_live_1', routeId: 'route_1', startedAt: new Date('2026-04-28T05:00:00.000Z') },
      { id: 'trip_live_2', routeId: 'route_2', startedAt: new Date('2026-04-28T05:05:00.000Z') },
    ]);
    mockRedisHGet.mockResolvedValue('4');
    mockRedisSMembers.mockResolvedValue(['stale']);
    mockPipelineExec.mockResolvedValue([]);
    pipelineState.hset.mockReturnValue(pipelineState);
    pipelineState.del.mockReturnValue(pipelineState);
    pipelineState.sadd.mockReturnValue(pipelineState);
    pipelineState.zadd.mockReturnValue(pipelineState);
    mockWithLock.mockImplementation(async (_resource: string, _ttlMs: number, work: () => Promise<void>) => {
      await work();
      return true;
    });
  });

  it('rewrites stale dashboard counters and active-trips set from DB truth', async () => {
    const { reconcileDashboardStats } = await import('./reconcile-dashboard-stats.job');

    await reconcileDashboardStats();

    expect(mockWithLock).toHaveBeenCalledWith(
      'dashboard:stats:reconcile',
      30_000,
      expect.any(Function),
    );
    expect(mockRedisPipeline).toHaveBeenCalledTimes(1);
    expect(pipelineState.hset).toHaveBeenCalledWith('dashboard:stats', {
      activeTrips: 2,
      checkedIn: 7,
      openCorrections: 3,
      gpsOffline: '4',
    });
    expect(pipelineState.del).toHaveBeenCalledWith('active-trips');
    expect(pipelineState.del).toHaveBeenCalledWith('active-trips:z');
    expect(pipelineState.del).toHaveBeenCalledWith('active-trips:route-ids');
    expect(pipelineState.del).toHaveBeenCalledWith('active-trips:z:route:stale');
    expect(pipelineState.sadd).toHaveBeenCalledWith('active-trips', 'trip_live_1', 'trip_live_2');
    expect(pipelineState.sadd).toHaveBeenCalledWith('active-trips:route-ids', 'route_1', 'route_2');
    expect(pipelineState.zadd).toHaveBeenCalledWith('active-trips:z', Date.parse('2026-04-28T05:00:00.000Z'), 'trip_live_1');
    expect(pipelineState.zadd).toHaveBeenCalledWith('active-trips:z:route:route_1', Date.parse('2026-04-28T05:00:00.000Z'), 'trip_live_1');
    expect(pipelineState.zadd).toHaveBeenCalledWith('active-trips:z', Date.parse('2026-04-28T05:05:00.000Z'), 'trip_live_2');
    expect(pipelineState.zadd).toHaveBeenCalledWith('active-trips:z:route:route_2', Date.parse('2026-04-28T05:05:00.000Z'), 'trip_live_2');
    expect(mockPipelineExec).toHaveBeenCalledTimes(1);
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'dashboard_stats_reconciled',
        meta: expect.objectContaining({
          activeTrips: 2,
          checkedIn: 7,
          openCorrections: 3,
          activeTripIds: ['trip_live_1', 'trip_live_2'],
        }),
      }),
    );
  });

  it('handles zero active trips by clearing the set without re-adding members', async () => {
    mockTripCount.mockResolvedValue(0);
    mockAttendanceCount.mockResolvedValue(0);
    mockCorrectionCount.mockResolvedValue(1);
    mockTripFindMany.mockResolvedValue([]);

    const { reconcileDashboardStats } = await import('./reconcile-dashboard-stats.job');

    await reconcileDashboardStats();

    expect(pipelineState.hset).toHaveBeenCalledWith('dashboard:stats', {
      activeTrips: 0,
      checkedIn: 0,
      openCorrections: 1,
      gpsOffline: '4',
    });
    expect(pipelineState.del).toHaveBeenCalledWith('active-trips');
    expect(pipelineState.del).toHaveBeenCalledWith('active-trips:z');
    expect(pipelineState.del).toHaveBeenCalledWith('active-trips:route-ids');
    expect(pipelineState.sadd).not.toHaveBeenCalled();
    expect(pipelineState.zadd).not.toHaveBeenCalled();
    expect(mockPipelineExec).toHaveBeenCalledTimes(1);
  });

  it('logs a skip when another instance holds the lock', async () => {
    mockWithLock.mockResolvedValue(false);

    const { reconcileDashboardStats } = await import('./reconcile-dashboard-stats.job');

    await reconcileDashboardStats();

    expect(mockRedisPipeline).not.toHaveBeenCalled();
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'dashboard_stats_reconcile_skipped_lock_held',
      }),
    );
  });
});
