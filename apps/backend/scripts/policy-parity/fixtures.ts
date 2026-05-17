/**
 * Parity fixture actors and JWT generation.
 *
 * Each fixture produces an HTTP Authorization header (mobile) or a signed
 * admin_jwt cookie value (admin). The token claims match the seeded DB rows.
 *
 * Token signing uses PARITY_JWT_SECRET when set, otherwise falls back to
 * JWT_SECRET (safe for local dev where both point to the same secret).
 */

import * as jwt from 'jsonwebtoken';

// ── Fixed seed IDs (must match seed.ts) ──────────────────────────────────────

export const PARITY_ROUTE_1_ID = 'parity-route-1-000000000000';
export const PARITY_ROUTE_2_ID = 'parity-route-2-000000000000';

export const PARITY_ADMIN_TO_ID     = 'parity-admin-to-000000000000';
export const PARITY_ADMIN_COORD_ID  = 'parity-admin-coord-00000000000';
export const PARITY_ADMIN_FACULTY_ID = 'parity-admin-faculty-000000000';
export const PARITY_ADMIN_MGMT_ID   = 'parity-admin-mgmt-0000000000000';

export const PARITY_STUDENT_ID = 'parity-student-1-000000000000';
export const PARITY_DRIVER_ID  = 'parity-driver-1-0000000000000';

export const SESSION_VERSION = 1;

// ── Token signing ─────────────────────────────────────────────────────────────

const signingSecret = (): string => {
  const secret = process.env.PARITY_JWT_SECRET ?? process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('Set PARITY_JWT_SECRET or JWT_SECRET before running the parity script.');
  }
  return secret;
};

const issuer  = process.env.JWT_ISSUER          ?? 'college-bus-system';
const mobileAud = process.env.JWT_MOBILE_AUDIENCE ?? 'college-bus-mobile';
const adminAud  = process.env.JWT_ADMIN_AUDIENCE  ?? 'college-bus-admin';

const HOUR = 60 * 60;

function signAdmin(sub: string, role: string, extra?: Record<string, unknown>): string {
  return jwt.sign(
    { sub, type: 'ADMIN', role, email: `${sub}@parity.test`, sv: SESSION_VERSION, ...extra },
    signingSecret(),
    { issuer, audience: adminAud, algorithm: 'HS256', expiresIn: HOUR },
  );
}

function signMobile(sub: string, role: string, deviceId: string): string {
  return jwt.sign(
    { sub, type: 'MOBILE', role, deviceId, sv: SESSION_VERSION },
    signingSecret(),
    { issuer, audience: mobileAud, algorithm: 'HS256', expiresIn: HOUR },
  );
}

// ── Fixture definitions ───────────────────────────────────────────────────────

export type FixtureName =
  | 'transport_officer'
  | 'coordinator_route1'
  | 'faculty_dept'
  | 'management'
  | 'student'
  | 'driver'
  | 'unauthenticated'
  | 'invalid_token';

export interface Fixture {
  name: FixtureName;
  description: string;
  /** Build headers to attach to the request. */
  headers: () => Record<string, string>;
}

export const fixtures: Fixture[] = [
  {
    name: 'transport_officer',
    description: 'TRANSPORT_OFFICER — full capability set',
    headers: () => ({
      Cookie: `admin_jwt=${signAdmin(PARITY_ADMIN_TO_ID, 'TRANSPORT_OFFICER')}`,
    }),
  },
  {
    name: 'coordinator_route1',
    description: 'COORDINATOR — scoped to route-1 only',
    headers: () => ({
      Cookie: `admin_jwt=${signAdmin(PARITY_ADMIN_COORD_ID, 'COORDINATOR', {
        coordinatorRouteIds: [PARITY_ROUTE_1_ID],
      })}`,
    }),
  },
  {
    name: 'faculty_dept',
    description: 'FACULTY — limited read-only caps, dept-scoped',
    headers: () => ({
      Cookie: `admin_jwt=${signAdmin(PARITY_ADMIN_FACULTY_ID, 'FACULTY')}`,
    }),
  },
  {
    name: 'management',
    description: 'MANAGEMENT — oversight caps, no live-ops writes',
    headers: () => ({
      Cookie: `admin_jwt=${signAdmin(PARITY_ADMIN_MGMT_ID, 'MANAGEMENT')}`,
    }),
  },
  {
    name: 'student',
    description: 'STUDENT mobile token — should get 403 on all admin routes',
    headers: () => ({
      Authorization: `Bearer ${signMobile(PARITY_STUDENT_ID, 'STUDENT', 'parity-device-student-1')}`,
    }),
  },
  {
    name: 'driver',
    description: 'DRIVER mobile token — should get 403 on all admin routes',
    headers: () => ({
      Authorization: `Bearer ${signMobile(PARITY_DRIVER_ID, 'DRIVER', 'parity-device-driver-1')}`,
    }),
  },
  {
    name: 'unauthenticated',
    description: 'No token — should get 401',
    headers: () => ({}),
  },
  {
    name: 'invalid_token',
    description: 'Malformed JWT — should get 401',
    headers: () => ({ Cookie: 'admin_jwt=this.is.not.a.real.jwt' }),
  },
];
