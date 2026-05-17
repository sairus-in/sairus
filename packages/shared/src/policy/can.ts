/**
 * policy.can() — the single authorization decision point.
 *
 * Three-step evaluation:
 *   1. Capability holding: actor.capabilities.has(capability)
 *   2. Admin scope: route + department checks for capabilities in
 *      ROUTE_SCOPED_CAPABILITIES (preserves canAdmin parity).
 *   3. Mobile scope-self: for student capabilities, resource.ownerId must
 *      equal actor.actorId when present.
 *
 * Returns Decision { allowed, reason, auditPayload } — never throws on
 * authz denial. Throws only on malformed inputs.
 */

import type { Actor } from '../auth/actor';
import type { Capability } from '../auth/capabilities';
import type { Decision } from './decision';
import { makeAllowed, makeDenied } from './decision';
import { ROUTE_SCOPED_CAPABILITIES } from './matrix';

/**
 * Optional resource the action is performed upon. Fields are optional so
 * route handlers can pass partial knowledge; the predicate only triggers
 * checks for fields that are actually populated.
 */
export interface PolicyResource {
  readonly kind?: string;
  readonly id?: string;
  readonly routeId?: string | null;
  readonly departmentId?: string | null;
  readonly ownerId?: string | null;
  readonly tripId?: string | null;
}

const can = (
  actor: Actor,
  capability: Capability,
  resource?: PolicyResource,
): Decision => {
  const baseAudit = {
    actorId: actor.actorId,
    actorType: actor.actorType,
    capability,
    resourceKind: resource?.kind,
    resourceId: resource?.id,
  };

  // ── Step 1: capability holding ────────────────────────────────────────────
  if (!actor.capabilities.has(capability)) {
    return makeDenied('missing_capability', baseAudit);
  }

  // ── Step 2: admin scope (route + department) ──────────────────────────────
  // Only applies when the capability is route-scoped per the legacy matrix.
  // Department check applies whenever resource.departmentId is set AND the
  // actor has departmentIds populated (FACULTY-shaped actors) — preserves
  // canAdmin behavior where FACULTY department scope applies to all faculty
  // actions, not just route-scoped ones.
  if (capability.startsWith('admin.')) {
    if (ROUTE_SCOPED_CAPABILITIES.has(capability)
        && resource?.routeId
        && actor.scope.routeIds.length > 0
        && !actor.scope.routeIds.includes(resource.routeId)) {
      return makeDenied('out_of_scope', { ...baseAudit, scopeMatch: 'route' });
    }

    if (resource?.departmentId
        && actor.scope.departmentIds.length > 0
        && !actor.scope.departmentIds.includes(resource.departmentId)) {
      return makeDenied('out_of_scope', { ...baseAudit, scopeMatch: 'department' });
    }
  }

  // ── Step 3: mobile student scope-self ─────────────────────────────────────
  // Student capabilities check resource.ownerId against actor.actorId.
  // If resource.ownerId is not set, the route handler is responsible for
  // ensuring the resource being acted on belongs to the actor (legacy pattern).
  if (capability.startsWith('student.')
      && resource?.ownerId
      && actor.actorId !== resource.ownerId) {
    return makeDenied('out_of_scope', { ...baseAudit, scopeMatch: 'self' });
  }

  // ── Step 4: driver trip ownership ─────────────────────────────────────────
  // TODO Commit 5b: implement driver trip ownership check via actor.scope.tripId.
  // Currently a no-op; the service layer enforces trip ownership today.

  return makeAllowed(baseAudit);
};

/**
 * Default-exported policy facade. Prefer `import { policy } from 'shared'`
 * over importing `can` directly — keeps call sites looking authoritative.
 */
export const policy = { can } as const;

// Re-export the bare function for tests and the shim, which want it without
// going through the facade.
export { can };
