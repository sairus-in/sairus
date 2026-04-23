import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAdminFindUnique = vi.fn();
const mockUserFindFirst = vi.fn();
const mockRouteCoordinatorFindMany = vi.fn();

vi.mock('./prisma', () => ({
  prisma: {
    adminUser: {
      findUnique: mockAdminFindUnique,
    },
    user: {
      findFirst: mockUserFindFirst,
    },
    routeCoordinator: {
      findMany: mockRouteCoordinatorFindMany,
    },
  },
}));

describe('admin access context', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('uses admin scope as the primary source of truth', async () => {
    mockAdminFindUnique.mockResolvedValue({
      id: 'admin_1',
      email: 'coord@example.com',
      role: 'COORDINATOR',
      scopes: [
        { routeId: 'route_a', department: null },
        { routeId: 'route_b', department: null },
      ],
    });

    const { getAdminAccessContext } = await import('./admin-access');
    const context = await getAdminAccessContext('admin_1');

    expect(context.scope.routeIds).toEqual(['route_a', 'route_b']);
    expect(context.scope.departmentIds).toEqual([]);
    expect(context.linkedUserId).toBeNull();
    expect(mockUserFindFirst).not.toHaveBeenCalled();
  });

  it('falls back to the legacy email bridge only when admin scope is absent', async () => {
    mockAdminFindUnique.mockResolvedValue({
      id: 'admin_2',
      email: 'faculty@example.com',
      role: 'FACULTY',
      scopes: [],
    });
    mockUserFindFirst.mockResolvedValue({
      id: 'user_2',
      department: 'CSE',
    });
    mockRouteCoordinatorFindMany.mockResolvedValue([]);

    const { getAdminAccessContext } = await import('./admin-access');
    const context = await getAdminAccessContext('admin_2');

    expect(context.department).toBe('CSE');
    expect(context.scope.departmentIds).toEqual(['CSE']);
    expect(context.linkedUserId).toBe('user_2');
  });
});
