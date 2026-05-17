/**
 * makeSerializer — universal entity serializer factory.
 *
 * Given a `SafeActorFieldSet<T>` (per-actor allowed-field whitelist) and
 * optional `scopeSelf` / `derived` hooks, returns a function:
 *
 *     (actor: Actor, row: T, ctx?: Ctx) => Partial<T> & Derived | null
 *
 * Behavior:
 *  - `scopeSelf` runs first. Returning false → the serializer yields `null`
 *    (caller treats as "no access" / 404 / filter-out). Use for ownership
 *    checks like "mobile_student can only see own row".
 *  - The actor's allowed field list is looked up by `actor.actorType`. Any
 *    field not in the list is dropped. Unknown actor type → empty list → {}.
 *  - `derived` may add computed fields (e.g. `driverName` denormalized onto
 *    a trip for non-admin actors). Derived fields are merged AFTER the
 *    whitelist projection, so they're never affected by the whitelist
 *    (caller is responsible for not leaking via derived).
 *
 * The factory is intentionally pure: no I/O, no Prisma, no logging.
 * Cache-friendly, test-friendly, safe to call per-row in hot loops.
 */

import type { Actor } from '../../auth/actor';
import type { SafeActorFieldSet, SafeFields } from './types';

export interface MakeSerializerOptions<T, Ctx> {
  /**
   * Return false to deny access entirely (serializer yields null).
   * Used for scope-self / ownership predicates that don't depend on
   * the field whitelist (e.g. row belongs to a different student).
   */
  scopeSelf?: (actor: Actor, row: T) => boolean;

  /**
   * Computed fields merged onto the projected output. Use sparingly —
   * keep denormalization shallow (single derived primitive like
   * `driverName: string`, not nested objects that re-introduce join
   * temptation).
   */
  derived?: (actor: Actor, row: T, ctx: Ctx) => Record<string, unknown>;
}

/**
 * Output type: the projected whitelist subset of T, plus any derived
 * fields the caller declares. Generic over the derived shape so call
 * sites get strong types on `.driverName` etc. when consumed.
 */
export type SerializedRow<T, Derived = Record<string, never>> =
  Partial<T> & Derived;

export function makeSerializer<T extends object, Ctx = undefined>(
  fields: SafeActorFieldSet<T>,
  options?: MakeSerializerOptions<T, Ctx>,
) {
  return (
    actor: Actor,
    row: T,
    ctx?: Ctx,
  ): SerializedRow<T> | null => {
    if (options?.scopeSelf && !options.scopeSelf(actor, row)) {
      return null;
    }
    const allowed: ReadonlyArray<SafeFields<T>> = fields[actor.actorType] ?? [];
    const out: Partial<T> = {};
    for (const key of allowed) {
      // `key` is constrained to SafeFields<T>, so `row[key]` is safe.
      out[key as keyof T] = row[key as keyof T];
    }
    const derived = options?.derived?.(actor, row, ctx as Ctx);
    if (derived) {
      return { ...out, ...derived } as SerializedRow<T>;
    }
    return out as SerializedRow<T>;
  };
}
