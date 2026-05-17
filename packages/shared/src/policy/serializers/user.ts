/**
 * User serializer — covers every Role via the discriminator on `role`.
 *
 * There is no separate Student serializer. `User` carries the role
 * discriminator; the scope-self predicate handles "mobile_student can
 * only see own row" (returns null otherwise).
 *
 * Field tiers are organizational only — composed into each actor's
 * allowed-field array at declaration time. They are NOT a runtime concept.
 *
 *   PUBLIC     ⊂ ROSTER ⊂ CONTACT ⊂ RESTRICTED
 *
 * `SerializableUser` is the view-type the backend repositories shape
 * Prisma rows into before calling serializeUser. Defined here (not
 * imported from Prisma) so packages/shared has no Prisma dependency.
 * Optional fields tolerate rows assembled from partial selects.
 */

import { makeSerializer } from './serialize';
import type { SafeActorFieldSet } from './types';

export interface SerializableUser {
  id: string;
  name: string;
  role: string;
  rollNumber: string | null;
  department: string | null;
  year: string | number | null;
  isActive: boolean;
  createdAt: string | Date;
  phone?: string | null;
  email?: string | null;
  lastLoginAt?: string | Date | null;
  licenseNumber?: string | null;
  authStatus?: string | null;
  updatedAt?: string | Date;
  authProvisionError?: string | null;
  authProvisionFailedAt?: string | Date | null;
  importSessionId?: string | null;
  deactivatedAt?: string | Date | null;
  deactivatedById?: string | null;
  deactivationReason?: string | null;
}

// Composable tiers — read top-to-bottom, each tier is the previous + more.
const PUBLIC: ReadonlyArray<keyof SerializableUser> = ['id'] as const;

const ROSTER: ReadonlyArray<keyof SerializableUser> = [
  ...PUBLIC,
  'name',
  'role',
  'rollNumber',
  'department',
  'year',
  'isActive',
  'createdAt',
] as const;

const CONTACT: ReadonlyArray<keyof SerializableUser> = [
  ...ROSTER,
  'phone',
  'email',
  'lastLoginAt',
] as const;

const RESTRICTED: ReadonlyArray<keyof SerializableUser> = [
  ...CONTACT,
  'licenseNumber',
  'authStatus',
  'updatedAt',
  'authProvisionError',
  'authProvisionFailedAt',
  'importSessionId',
  'deactivatedAt',
  'deactivatedById',
  'deactivationReason',
] as const;

export const userVisibleFields: SafeActorFieldSet<SerializableUser> = {
  mobile_student: PUBLIC,    // scope-self enforced in serializer
  mobile_driver:  ROSTER,
  admin:          RESTRICTED,
  system:         RESTRICTED,
};

export const serializeUser = makeSerializer<SerializableUser>(userVisibleFields, {
  // A mobile_student may only see their own User row.
  // Cross-student reads return null (caller treats as 404 / filter out).
  scopeSelf: (actor, row) =>
    actor.actorType !== 'mobile_student' || actor.actorId === row.id,
});
