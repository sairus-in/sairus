/**
 * Serializer type machinery.
 *
 * Universal mechanism for safely projecting an entity row down to the subset
 * of fields a given actor is allowed to see.
 *
 * Two compile-time guarantees:
 *
 *  1. Default-deny — `makeSerializer` reads fields from the declared
 *     `SafeActorFieldSet<T>` map; anything not listed is dropped at runtime.
 *
 *  2. Credential safety — `SafeActorFieldSet<T>` excludes the union
 *     `CredentialField`. Declaring `passwordHash` (or any other listed
 *     credential field) in an actor's field array is a TS error before
 *     the code ever runs.
 *
 * `CredentialField` is intentionally a string union, not a per-entity list.
 * It registers every sensitive field name across every entity in the system.
 * If an entity has no field by that name, the exclusion is a no-op for it;
 * if it does, the exclusion is enforced.
 */

import type { ActorType } from '../../auth/actor';

/**
 * Credential material — never serialized to any actor under any condition.
 * Add new entries here when introducing a new sensitive field on any entity.
 * Removing an entry weakens the compile-time guarantee — don't.
 */
export type CredentialField =
  | 'passwordHash'
  | 'mfaSecretEncrypted'
  | 'passwordResetTokenHash'
  | 'inviteTokenHash'
  | 'fcmToken'
  | 'firebaseUid'
  | 'registeredDeviceId'
  | 'sessionVersion'
  | 'deviceBoundAt'
  | 'forcedReloginAt';

/**
 * Field names on T that are NOT credentials. Used by `SafeActorFieldSet<T>`
 * to constrain what may appear in an actor's allowed-field array.
 */
export type SafeFields<T> = Exclude<keyof T, CredentialField>;

/**
 * Map from actor type to the array of fields they may see on T.
 * Use `as const satisfies SafeActorFieldSet<T>` at declaration sites to
 * lock in literal types for the field arrays.
 */
export type SafeActorFieldSet<T> = Readonly<
  Record<ActorType, ReadonlyArray<SafeFields<T>>>
>;
