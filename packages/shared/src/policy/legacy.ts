/**
 * Legacy canAdmin / AdminAction shim.
 *
 * @deprecated Use `policy.can(actor, capability, resource)` from this module.
 * This shim exists to keep existing call sites compiling and behaviorally
 * identical during the Phase 1a auth/policy migration. It is removed in
 * Commit 8 once all call sites have migrated.
 *
 * Behavior guarantee: every test in packages/shared/src/policy.test.ts that
 * passed before this refactor must continue to pass against the shim with no
 * code change in the test file.
 */

import type { AdminRole } from '../schemas/common';
import type { Actor } from '../auth/actor';
import {
  ADMIN_ACTION_TO_CAPABILITY,
  capabilitiesForAdminRole,
} from './matrix';
import { can } from './can';

/** @deprecated Use Capability from 'shared/auth' instead. */
export type AdminAction = keyof typeof ADMIN_ACTION_TO_CAPABILITY;

/** @deprecated Use Actor.scope from 'shared/auth' instead. */
export interface AdminPolicyScope {
  routeIds: string[];
  departmentIds: string[];
}

/** @deprecated Use Actor from 'shared/auth' instead. */
export interface AdminAccessContext {
  role: AdminRole;
  scope: AdminPolicyScope;
}

/** @deprecated Use PolicyResource from './can' instead. */
export interface AdminPolicyResource {
  routeId?: string | null;
  departmentId?: string | null;
}

/**
 * @deprecated Use `policy.can(actor, capability, resource).allowed` directly.
 *
 * Internally translates the legacy action enum to the new capability vocabulary,
 * constructs a synthetic admin Actor, and delegates to `policy.can()`. The
 * boolean return matches the legacy contract.
 */
export const canAdmin = (
  admin: AdminAccessContext,
  action: AdminAction,
  resource?: AdminPolicyResource,
): boolean => {
  const capability = ADMIN_ACTION_TO_CAPABILITY[action];
  if (!capability) {
    return false;
  }

  const syntheticActor: Actor = {
    actorId: '__legacy_canAdmin__',
    actorType: 'admin',
    capabilities: capabilitiesForAdminRole(admin.role),
    scope: {
      routeIds: Array.isArray(admin.scope?.routeIds) ? admin.scope.routeIds : [],
      departmentIds: Array.isArray(admin.scope?.departmentIds) ? admin.scope.departmentIds : [],
      busId: null,
      tripId: null,
    },
    sessionContext: { requestId: '__legacy__' },
  };

  return can(syntheticActor, capability, resource ?? undefined).allowed;
};
