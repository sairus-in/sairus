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
 * Scope in Phase 1a:
 *   The Actor's scope.routeIds / departmentIds are EMPTY here. Coordinator
 *   route scope is populated by the `scopeCoordinator` preHandler, which
 *   runs later in the per-route chain and writes to req.coordinatorRouteIds.
 *   Commit 5 will reconcile: the migrated authz call sites will either
 *   re-resolve the actor post-scope or read scope from the request directly.
 *   Until then, downstream policy checks must not depend on actor.scope.
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

const buildActor = (user: AuthUser, source: ActorSource, requestId: string): Actor => {
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
    };
  }

  const admin = user as AdminAuthUser;
  const capabilities: ReadonlySet<Capability> = capabilitiesForAdminRole(admin.role);
  return {
    actorId: admin.userId,
    actorType: 'admin',
    capabilities,
    scope: emptyScope(),
    sessionContext: {
      requestId,
    },
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
  const actor = buildActor(user, source, req.id);
  await actorCache.set(source, actor);
  return actor;
};

// Exported for tests; the production path goes through resolveActor.
export const __buildActorForTests = buildActor;
