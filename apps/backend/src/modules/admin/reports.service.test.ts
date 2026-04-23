import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockTripFindMany = vi.fn();
const mockAttendanceGroupBy = vi.fn();
const mockRouteFindUnique = vi.fn();

const redisStore = new Map<string, string>();
const mockRedisSet = vi.fn(async (key: string, value: string) => {
  redisStore.set(key, value);
  return 'OK';
});
const mockRedisGet = vi.fn(async (key: string) => redisStore.get(key) ?? null);

vi.mock('../../lib/prisma', () => ({
  prisma: {
    trip: {
      findMany: mockTripFindMany,
    },
    attendanceLog: {
      groupBy: mockAttendanceGroupBy,
    },
    route: {
      findUnique: mockRouteFindUnique,
    },
  },
}));

vi.mock('../../lib/redis', () => ({
  redis: {
    set: mockRedisSet,
    get: mockRedisGet,
  },
}));

const buildCoordinatorAccess = (routeIds: string[], adminId = 'admin_coord') => ({
  adminId,
  email: `${adminId}@example.com`,
  role: 'COORDINATOR' as const,
  department: null,
  linkedUserId: null,
  scope: {
    routeIds,
    departmentIds: [],
  },
});

const buildOfficerAccess = (adminId = 'admin_officer') => ({
  adminId,
  email: `${adminId}@example.com`,
  role: 'TRANSPORT_OFFICER' as const,
  department: null,
  linkedUserId: null,
  scope: {
    routeIds: [],
    departmentIds: [],
  },
});

describe('reports service scope enforcement', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    redisStore.clear();

    mockTripFindMany.mockResolvedValue([
      {
        id: 'trip_1',
        date: '2026-04-01',
        expectedCount: 10,
        boardedCount: 8,
        absentCount: 2,
        status: 'COMPLETED',
        route: { id: 'route_A', name: 'Route A' },
        bus: { number: 'BUS-01' },
        driver: { name: 'Driver One' },
      },
    ]);
    mockAttendanceGroupBy.mockResolvedValue([
      {
        dateKey: '2026-04-01',
        status: 'PRESENT',
        _count: { _all: 8 },
      },
    ]);
    mockRouteFindUnique.mockImplementation(async ({ where: { id } }: { where: { id: string } }) => ({
      id,
      name: id === 'route_A' ? 'Route A' : 'Route B',
    }));
  });

  it('rejects a coordinator report request outside their route scope', async () => {
    const { reportsService } = await import('./reports.service');

    await expect(
      reportsService.getAttendanceOverview(buildCoordinatorAccess(['route_A']), '2026-04-01', '2026-04-02', 'route_B'),
    ).rejects.toMatchObject({ code: 'REPORT_OUTSIDE_SCOPE' });
  });

  it('limits a coordinator unscoped report to their allowed routes only', async () => {
    const { reportsService } = await import('./reports.service');

    const overview = await reportsService.getAttendanceOverview(
      buildCoordinatorAccess(['route_A']),
      '2026-04-01',
      '2026-04-02',
    );

    expect(overview.routeId).toBe('route_A');
    expect(mockTripFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          routeId: { in: ['route_A'] },
        }),
      }),
    );
  });

  it('allows a transport officer to request any route explicitly', async () => {
    const { reportsService } = await import('./reports.service');

    const overview = await reportsService.getAttendanceOverview(
      buildOfficerAccess(),
      '2026-04-01',
      '2026-04-02',
      'route_B',
    );

    expect(overview.routeId).toBe('route_B');
    expect(mockTripFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          routeId: { in: ['route_B'] },
        }),
      }),
    );
  });
});

describe('reports service job access protection', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    redisStore.clear();
    mockTripFindMany.mockResolvedValue([]);
    mockAttendanceGroupBy.mockResolvedValue([]);
    mockRouteFindUnique.mockResolvedValue(null);
  });

  it('prevents a coordinator from reading another coordinator report job status', async () => {
    const { reportsService } = await import('./reports.service');

    const owner = buildCoordinatorAccess(['route_A'], 'admin_owner');
    const intruder = buildCoordinatorAccess(['route_A'], 'admin_intruder');
    const job = await reportsService.enqueueAttendanceReport(owner, '2026-04-01', '2026-04-02', 'route_A');

    await expect(reportsService.getJobStatus(intruder, job.jobId)).rejects.toMatchObject({
      code: 'REPORT_OWNERSHIP_REQUIRED',
    });
  });

  it('prevents a coordinator from downloading another coordinator report artifact', async () => {
    const { reportsService } = await import('./reports.service');

    const owner = buildCoordinatorAccess(['route_A'], 'admin_owner');
    const intruder = buildCoordinatorAccess(['route_B'], 'admin_intruder');
    const job = await reportsService.enqueueAttendanceReport(owner, '2026-04-01', '2026-04-02', 'route_A');

    await expect(reportsService.downloadAttendanceReport(intruder, job.jobId)).rejects.toMatchObject({
      code: 'REPORT_OWNERSHIP_REQUIRED',
    });
  });

  it('allows the coordinator who created the job to read its status', async () => {
    const { reportsService } = await import('./reports.service');

    const owner = buildCoordinatorAccess(['route_A'], 'admin_owner');
    const job = await reportsService.enqueueAttendanceReport(owner, '2026-04-01', '2026-04-02', 'route_A');

    await expect(reportsService.getJobStatus(owner, job.jobId)).resolves.toMatchObject({
      status: expect.any(String),
    });
  });
});
