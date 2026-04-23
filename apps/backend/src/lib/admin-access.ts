import { AppError } from './errors';
import { logger } from './logger';
import { prisma } from './prisma';
import { AdminAccessContext, AdminAction, AdminPolicyResource, AdminRole, canAdmin } from 'shared';

export interface ResolvedAdminAccessContext extends AdminAccessContext {
  adminId: string;
  email: string;
  department: string | null;
  linkedUserId: string | null;
}

const dedupe = (values: Array<string | null | undefined>): string[] =>
  Array.from(new Set(values.filter((value): value is string => Boolean(value))));

export const getAdminAccessContext = async (adminId: string): Promise<ResolvedAdminAccessContext> => {
  const admin = await prisma.adminUser.findUnique({
    where: { id: adminId },
    select: {
      id: true,
      email: true,
      role: true,
      scopes: {
        select: {
          routeId: true,
          department: true,
        },
      },
    },
  });

  if (!admin) {
    throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
  }

  let linkedUserId: string | null = null;
  let department: string | null = null;
  let routeIds = dedupe(admin.scopes.map((scope) => scope.routeId));
  let departmentIds = dedupe(admin.scopes.map((scope) => scope.department));
  department = departmentIds[0] ?? null;
  let usedLegacyBridge = false;

  // Transitional fallback while existing dev data is migrated onto AdminScope.
  if (routeIds.length === 0 && departmentIds.length === 0 && (admin.role === 'COORDINATOR' || admin.role === 'FACULTY')) {
    usedLegacyBridge = true;
    const linkedUser = await prisma.user.findFirst({
      where: { email: admin.email },
      select: {
        id: true,
        department: true,
      },
    });

    if (linkedUser) {
      linkedUserId = linkedUser.id;
      department = linkedUser.department ?? null;
      departmentIds = department ? [department] : [];

      if (admin.role === 'COORDINATOR') {
        const coordinators = await prisma.routeCoordinator.findMany({
          where: { userId: linkedUser.id },
          select: { routeId: true },
        });
        routeIds = coordinators.map((item) => item.routeId);
      }
    }
  }

  if (usedLegacyBridge) {
    logger.warn({
      event: 'admin_scope_fallback_used',
      userId: admin.id,
      source: 'ADMIN',
      meta: {
        email: admin.email,
        role: admin.role,
      },
    });
  }

  return {
    adminId: admin.id,
    email: admin.email,
    role: admin.role as AdminRole,
    department,
    linkedUserId,
    scope: {
      routeIds,
      departmentIds,
    },
  };
};

export const assertAdminAction = (
  admin: AdminAccessContext,
  action: AdminAction,
  resource?: AdminPolicyResource,
): void => {
  if (!canAdmin(admin, action, resource)) {
    throw new AppError('Forbidden', 403, 'FORBIDDEN');
  }
};
