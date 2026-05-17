/**
 * Trip serializer — explicit per-actor field lists (no tier composition).
 *
 * Mobile actors receive a denormalized `driverName` derived field
 * instead of a nested `trip.driver: SerializedUser`. Nesting tempts
 * call sites to grow the nested serializer to CONTACT tier; a single
 * derived primitive cannot.
 *
 * Residual risk (accepted, see SECURITY_DEBT.md): mobile_student can
 * infer classmate absence from `expectedCount - boardedCount` after
 * the trip ends. Acceptable under current threat model.
 */

import { makeSerializer } from './serialize';
import type { SafeActorFieldSet } from './types';

export interface SerializableTrip {
  id: string;
  busAssignmentId?: string | null;
  busId: string;
  routeId: string;
  driverId?: string | null;
  type?: string | null;
  status: string;
  date: string;
  expectedCount: number;
  boardedCount: number;
  absentCount: number;
  startedAt?: string | Date | null;
  endedAt?: string | Date | null;
  delegateId?: string | null;
  gpsOutageStart?: string | Date | null;
  gpsStatus?: string | null;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

const ADMIN_FIELDS: ReadonlyArray<keyof SerializableTrip> = [
  'id',
  'busAssignmentId',
  'busId',
  'routeId',
  'driverId',
  'type',
  'status',
  'date',
  'expectedCount',
  'boardedCount',
  'absentCount',
  'startedAt',
  'endedAt',
  'delegateId',
  'gpsOutageStart',
  'gpsStatus',
  'createdAt',
  'updatedAt',
] as const;

export const tripVisibleFields: SafeActorFieldSet<SerializableTrip> = {
  mobile_student: [
    'id', 'busId', 'routeId', 'status', 'startedAt', 'endedAt', 'gpsStatus',
  ] as const,
  mobile_driver: [
    'id', 'busId', 'routeId', 'type', 'status', 'date',
    'expectedCount', 'boardedCount', 'absentCount',
    'startedAt', 'endedAt', 'gpsStatus', 'gpsOutageStart',
  ] as const,
  admin:  ADMIN_FIELDS,
  system: ADMIN_FIELDS,
};

export interface TripSerializerContext {
  driverName: string;
}

export const serializeTrip = makeSerializer<SerializableTrip, TripSerializerContext>(
  tripVisibleFields,
  {
    derived: (actor, _row, ctx) =>
      actor.actorType === 'admin' || actor.actorType === 'system'
        ? {}
        : { driverName: ctx?.driverName ?? '' },
  },
);
