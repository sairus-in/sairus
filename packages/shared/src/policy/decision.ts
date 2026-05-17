/**
 * Decision — the envelope returned by policy.can().
 *
 * A boolean would have been simpler, but losing the reason and audit payload
 * makes incident investigation slow. The shim canAdmin() reduces this to a
 * boolean for backward compatibility.
 */

import type { ActorType } from '../auth/actor';
import type { Capability } from '../auth/capabilities';

export type DecisionReason =
  | 'ok'
  | 'missing_capability'
  | 'out_of_scope'
  | 'resource_not_found'
  | 'forbidden';

export type ScopeMatch = 'route' | 'department' | 'self' | 'none';

export interface DecisionAuditPayload {
  readonly actorId: string;
  readonly actorType: ActorType;
  readonly capability: Capability;
  readonly resourceKind?: string;
  readonly resourceId?: string;
  readonly scopeMatch?: ScopeMatch;
}

export interface Decision {
  readonly allowed: boolean;
  readonly reason: DecisionReason;
  readonly auditPayload: DecisionAuditPayload;
}

export const makeAllowed = (audit: DecisionAuditPayload): Decision => ({
  allowed: true,
  reason: 'ok',
  auditPayload: audit,
});

export const makeDenied = (
  reason: Exclude<DecisionReason, 'ok'>,
  audit: DecisionAuditPayload,
): Decision => ({
  allowed: false,
  reason,
  auditPayload: audit,
});
