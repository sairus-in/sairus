import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
const mockSet = vi.fn();
const mockSetex = vi.fn();
const mockDel = vi.fn();
const mockAdminScopeFindMany = vi.fn();

vi.mock('../../lib/redis', () => ({
  redis: {
    get: (...args: unknown[]) => mockGet(...args),
    set: (...args: unknown[]) => mockSet(...args),
    setex: (...args: unknown[]) => mockSetex(...args),
    del: (...args: unknown[]) => mockDel(...args),
  },
}));

vi.mock('../../lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock('../../lib/prisma', () => ({
  prisma: {
    adminScope: {
      findMany: (...args: unknown[]) => mockAdminScopeFindMany(...args),
    },
  },
}));

import { resolveActor, __buildActorForTests } from './resolve-actor';
import { actorCache, ACTOR_CACHE_TTL_SECONDS } from './actor-cache';
import type { FastifyRequest } from 'fastify';

const baseMobile = {
  sub: 'user-1',
  userId: 'user-1',
  deviceId: 'dev-1',
  sv: 1,
  type: 'MOBILE' as const,
  iat: 0,
  exp: 0,
};

const baseAdmin = {
  sub: 'admin-1',
  userId: 'admin-1',
  email: 'a@example.com',
  sv: 1,
  type: 'ADMIN' as const,
  iat: 0,
  exp: 0,
};

const makeReq = (id = 'req-1'): FastifyRequest =>
  ({ id } as unknown as FastifyRequest);

beforeEach(() => {
  mockGet.mockReset();
  mockSetex.mockReset();
  mockDel.mockReset();
  mockAdminScopeFindMany.mockReset();
  mockAdminScopeFindMany.mockResolvedValue([]);
});

describe('buildActor', () => {
  it('produces mobile_student actor with STUDENT capabilities', async () => {
    const actor = await __buildActorForTests(
      { ...baseMobile, role: 'STUDENT' },
      'mobile',
      'req-1',
    );
    expect(actor.actorType).toBe('mobile_student');
    expect(actor.actorId).toBe('user-1');
    expect(actor.capabilities.has('student.attendance.checkin')).toBe(true);
    expect(actor.capabilities.has('admin.dashboard.view')).toBe(false);
    expect(actor.sessionContext.deviceId).toBe('dev-1');
    expect(actor.sessionContext.requestId).toBe('req-1');
  });

  it('produces mobile_driver actor with DRIVER capabilities', async () => {
    const actor = await __buildActorForTests(
      { ...baseMobile, role: 'DRIVER' },
      'mobile',
      'req-1',
    );
    expect(actor.actorType).toBe('mobile_driver');
    expect(actor.capabilities.has('driver.trip.start')).toBe(true);
    expect(actor.capabilities.has('student.attendance.checkin')).toBe(false);
  });

  it('produces admin actor with role-specific capabilities', async () => {
    const actor = await __buildActorForTests(
      { ...baseAdmin, role: 'TRANSPORT_OFFICER' },
      'admin',
      'req-1',
    );
    expect(actor.actorType).toBe('admin');
    expect(actor.capabilities.has('admin.dashboard.view')).toBe(true);
    expect(actor.capabilities.has('admin.fleet_map.view')).toBe(true);
    expect((actor.sessionContext as { deviceId?: string }).deviceId).toBeUndefined();
  });

  it('produces empty capability set for unknown admin role', async () => {
    const actor = await __buildActorForTests(
      { ...baseAdmin, role: 'STAFF' as never },
      'admin',
      'req-1',
    );
    expect(actor.capabilities.size).toBe(0);
  });

  it('hydrates admin scope from AdminScope rows', async () => {
    mockAdminScopeFindMany.mockResolvedValueOnce([
      { routeId: 'route-1', department: null },
      { routeId: 'route-2', department: null },
      { routeId: null, department: 'CSE' },
    ]);
    const actor = await __buildActorForTests(
      { ...baseAdmin, role: 'COORDINATOR' },
      'admin',
      'req-1',
    );
    expect(actor.scope.routeIds).toEqual(['route-1', 'route-2']);
    expect(actor.scope.departmentIds).toEqual(['CSE']);
  });

  it('returns empty scope when AdminScope rows are missing', async () => {
    mockAdminScopeFindMany.mockResolvedValueOnce([]);
    const actor = await __buildActorForTests(
      { ...baseAdmin, role: 'COORDINATOR' },
      'admin',
      'req-1',
    );
    expect(actor.scope.routeIds).toEqual([]);
    expect(actor.scope.departmentIds).toEqual([]);
  });
});

describe('resolveActor cache flow', () => {
  it('on cache miss, builds actor and writes to cache', async () => {
    mockGet.mockResolvedValue(null);
    mockSetex.mockResolvedValue('OK');
    const actor = await resolveActor(
      makeReq('req-99'),
      { ...baseMobile, role: 'STUDENT' },
      'mobile',
    );
    expect(actor.actorId).toBe('user-1');
    expect(mockGet).toHaveBeenCalledWith('actor:mobile:user-1');
    expect(mockSetex).toHaveBeenCalledWith(
      'actor:mobile:user-1',
      ACTOR_CACHE_TTL_SECONDS,
      expect.any(String),
    );
    const [, , body] = mockSetex.mock.calls[0]!;
    expect(JSON.parse(body as string).capabilities).toContain('student.attendance.checkin');
  });

  it('on cache hit, deserializes and refreshes requestId', async () => {
    const cached = JSON.stringify({
      actorId: 'admin-1',
      actorType: 'admin',
      capabilities: ['admin.dashboard.view'],
      scope: { routeIds: [], departmentIds: [], busId: null, tripId: null },
      sessionContext: { requestId: 'old-req' },
    });
    mockGet.mockResolvedValue(cached);
    const actor = await resolveActor(
      makeReq('new-req'),
      { ...baseAdmin, role: 'TRANSPORT_OFFICER' },
      'admin',
    );
    expect(actor.capabilities.has('admin.dashboard.view')).toBe(true);
    expect(actor.sessionContext.requestId).toBe('new-req');
    expect(mockSetex).not.toHaveBeenCalled();
  });

  it('namespaces mobile vs admin in cache key to avoid id collisions', async () => {
    mockGet.mockResolvedValue(null);
    mockSetex.mockResolvedValue('OK');
    await resolveActor(makeReq(), { ...baseMobile, userId: '42', sub: '42', role: 'STUDENT' }, 'mobile');
    await resolveActor(makeReq(), { ...baseAdmin, userId: '42', sub: '42', role: 'TRANSPORT_OFFICER' }, 'admin');
    expect(mockSetex.mock.calls.map((c) => c[0])).toEqual([
      'actor:mobile:42',
      'actor:admin:42',
    ]);
  });

  it('survives a Redis read failure by falling back to build', async () => {
    mockGet.mockRejectedValue(new Error('redis down'));
    mockSetex.mockResolvedValue('OK');
    const actor = await resolveActor(
      makeReq(),
      { ...baseMobile, role: 'STUDENT' },
      'mobile',
    );
    expect(actor.actorType).toBe('mobile_student');
  });

  it('survives a Redis write failure without throwing', async () => {
    mockGet.mockResolvedValue(null);
    mockSetex.mockRejectedValue(new Error('redis down'));
    await expect(
      resolveActor(makeReq(), { ...baseMobile, role: 'STUDENT' }, 'mobile'),
    ).resolves.toBeDefined();
  });
});

describe('actorCache.invalidate', () => {
  it('deletes the namespaced key', async () => {
    mockDel.mockResolvedValue(1);
    await actorCache.invalidate('admin', 'admin-1');
    expect(mockDel).toHaveBeenCalledWith('actor:admin:admin-1');
  });

  it('swallows redis errors', async () => {
    mockDel.mockRejectedValue(new Error('boom'));
    await expect(actorCache.invalidate('mobile', 'u-1')).resolves.toBeUndefined();
  });
});
