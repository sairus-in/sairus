/**
 * The Actor model — single representation of an authenticated principal
 * across mobile and admin surfaces.
 *
 * Built once per request by the resolver in apps/backend/src/spine/auth/resolve-actor.ts
 * (Commit 3) and read by policy.can() (Commit 2) and serializers (Commit 4).
 *
 * See docs/PHASE_1A_IMPLEMENTATION.md for design rationale.
 */

import type { Capability } from './capabilities';

/**
 * Type of authenticated principal. Drives capability defaults and serializer
 * behavior. `system` is reserved for Cloud Tasks handlers and is not used in
 * Phase 1a — those routes still authenticate via X-CloudTasks-Secret middleware.
 */
export type ActorType =
  | 'mobile_student'
  | 'mobile_driver'
  | 'admin'
  | 'system';

/**
 * Scope-typed restrictions on what an actor can act upon. Predicates in
 * policy.can() intersect these with the resource being acted on.
 *
 * Empty arrays mean "no restriction" only for actor types whose default is
 * unrestricted (admin TRANSPORT_OFFICER, MANAGEMENT). For scoped roles
 * (COORDINATOR, FACULTY), empty arrays mean "denied everywhere" — the
 * policy predicate must distinguish these two cases.
 */
export interface ScopeContext {
  readonly routeIds: readonly string[];
  readonly departmentIds: readonly string[];
  readonly busId?: string | null;
  readonly tripId?: string | null;
}

/**
 * Request-scoped metadata about how the actor was authenticated. Used for
 * audit logging and session-bound checks. Optional fields are populated when
 * available; requestId is always set by the request-context plugin.
 */
export interface SessionContext {
  readonly sessionId?: string;
  readonly deviceId?: string;
  readonly requestId: string;
}

/**
 * Authenticated principal. Construct via resolveActor() in the backend;
 * never construct ad-hoc in route handlers.
 */
export interface Actor {
  readonly actorId: string;
  readonly actorType: ActorType;
  readonly capabilities: ReadonlySet<Capability>;
  readonly scope: ScopeContext;
  readonly sessionContext: SessionContext;
}

/**
 * Frozen list of every ActorType, for exhaustiveness checks and test fixtures.
 */
export const ALL_ACTOR_TYPES = Object.freeze([
  'mobile_student',
  'mobile_driver',
  'admin',
  'system',
] as const satisfies readonly ActorType[]);

export const isActorType = (value: unknown): value is ActorType => {
  return typeof value === 'string'
    && (ALL_ACTOR_TYPES as readonly string[]).includes(value);
};

/**
 * Construct an empty scope context. Use as a starting point in tests and
 * the resolver; callers fill in actual scope from DB.
 */
export const emptyScope = (): ScopeContext => ({
  routeIds: [],
  departmentIds: [],
  busId: null,
  tripId: null,
});

/**
 * Type guard for Actor. Performs structural validation only — does not
 * verify that capabilities are a known set (use isCapability per-element
 * for that). Useful at trust boundaries (cache deserialization, test setup).
 */
export const isActor = (value: unknown): value is Actor => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.actorId === 'string'
    && isActorType(v.actorType)
    && v.capabilities instanceof Set
    && typeof v.scope === 'object' && v.scope !== null
    && typeof v.sessionContext === 'object' && v.sessionContext !== null
  );
};

/**
 * Convenience predicates for grouping actor types. Prefer these over inline
 * comparisons in policy predicates — easier to extend if a new mobile actor
 * type appears.
 */
export const isMobileActor = (actor: Actor): boolean =>
  actor.actorType === 'mobile_student' || actor.actorType === 'mobile_driver';

export const isAdminActor = (actor: Actor): boolean =>
  actor.actorType === 'admin';

export const isSystemActor = (actor: Actor): boolean =>
  actor.actorType === 'system';
