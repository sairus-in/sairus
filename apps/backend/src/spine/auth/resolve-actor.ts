/**
 * resolveActor — turn a resolved req.user into an Actor.
 *
 * Called from inside requireMobileAuth and requireAdminAuth (the only two
 * paths that populate req.user). NOT a Fastify preHandler — global hooks
 * run before route-level preHandlers, so it cannot see req.user there.
 *
 * Cache flow:
 *   1. Look up `actor:{source}:{actorId}` in Redis-A.
 *   2. Cache miss → buildActor() (pure, no DB) → write-through.
 *
 * Scope in Phase 1a (Commit 8):
 *   For admin actors, scope.routeIds / departmentIds are populated from the
 *   AdminScope table on every cache miss. Missing rows = empty scope, and
 *   policy.can() denies route-scoped actions for actors whose role normally
 *   requires scope (COORDINATOR, FACULTY). No legacy bridge fallback.
 *
 *   Cache TTL is 5 minutes — scope mutations through admin-auth flows are
 *   eventually consistent. Acceptable for Phase 1a; invalidation hooks may
 *   be added in a follow-up.
 *
 * Socket auth in websocket/socket.ts (lines 64, 202) is the third place
 * a principal is established and currently does NOT call resolveActor.
 * That migration lands in Commit 5b alongside the socket-side policy work.
 */

import type { FastifyRequest } from 'fastify';
import type {
  Actor,
  ActorType,
  Capability,
  AdminJWTPayload,
  MobileJWTPayload,
  AdminRole,
  Role,
} from 'shared';
import {
  capabilitiesForAdminRole,
  capabilitiesForMobileRole,
  emptyScope,
} from 'shared';
import { actorCache, type ActorSource } from './actor-cache';
import { prisma } from '../../lib/prisma';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Set by requireMobileAuth / requireAdminAuth after a successful auth.
     * Routes guarded by either middleware can rely on this being present.
     * Public routes must check for `undefined`.
     */
    actor?: Actor;
  }
}

type MobileAuthUser = MobileJWTPayload & { userId: string; role: Role };
type AdminAuthUser = AdminJWTPayload & { userId: string; role: AdminRole };
type AuthUser = MobileAuthUser | AdminAuthUser;

const mobileActorType = (role: Role): ActorType => {
  switch (role) {
    case 'STUDENT': return 'mobile_student';
    case 'DRIVER':  return 'mobile_driver';
    default:        return 'mobile_student'; // unsupported mobile roles surface upstream as 403
  }
};

const buildActor = async (user: AuthUser, source: ActorSource, requestId: string): Promise<Actor> => {
  if (source === 'mobile') {
    const mobile = user as MobileAuthUser;
    const capabilities: ReadonlySet<Capability> = capabilitiesForMobileRole(mobile.role);
    return {
      actorId: mobile.userId,
      actorType: mobileActorType(mobile.role),
      capabilities,
      scope: emptyScope(),
      sessionContext: {
        deviceId: mobile.deviceId,
        requestId,
      },
      role: mobile.role,
    };
  }

  const admin = user as AdminAuthUser;
  const capabilities: ReadonlySet<Capability> = capabilitiesForAdminRole(admin.role);

  // Phase 1A: scope is the AdminScope table. Missing rows = empty scope =
  // policy.can() denies route-scoped actions naturally. No legacy fallback.
  const dbScopes = await prisma.adminScope.findMany({
    where: { adminUserId: admin.userId },
    select: { routeId: true, department: true },
  });

  const routeIds = Array.from(new Set(
    dbScopes.map((s) => s.routeId).filter((r): r is string => Boolean(r)),
  ));
  const departmentIds = Array.from(new Set(
    dbScopes.map((s) => s.department).filter((d): d is string => Boolean(d)),
  ));

  return {
    actorId: admin.userId,
    actorType: 'admin',
    capabilities,
    scope: {
      routeIds,
      departmentIds,
      busId: null,
      tripId: null,
    },
    sessionContext: {
      requestId,
    },
    role: admin.role,
  };
};

export const resolveActor = async (
  req: FastifyRequest,
  user: AuthUser,
  source: ActorSource,
): Promise<Actor> => {
  const actorId = user.userId;
  const cached = await actorCache.get(source, actorId);
  if (cached) {
    return {
      ...cached,
      sessionContext: {
        ...cached.sessionContext,
        requestId: req.id,
      },
    };
  }
  const actor = await buildActor(user, source, req.id);
  await actorCache.set(source, actor);
  return actor;
};

// Exported for tests; the production path goes through resolveActor.
export const __buildActorForTests = buildActor;
