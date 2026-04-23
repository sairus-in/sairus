/**
 * SHARED VALIDATION SCHEMAS
 *
 * All modules must import from here instead of redefining.
 * This is the enforcement mechanism against coordinate field naming inconsistencies,
 * CUID vs UUID mismatches, and pagination shape variations.
 */

import { z } from 'zod';
import { ROLES } from '../types/user.types';

// ─── ID Types ──────────────────────────────────────────────────────────────────

/**
 * CUID string — matches Prisma @default(cuid()) on ALL model IDs.
 * NEVER use z.string().uuid() for Prisma entity IDs.
 * The UUID/CUID mismatch is what caused the incidents.routes.ts bug.
 */
export const cuidSchema = z.string().cuid({
  message: 'ID must be a valid CUID (all entity IDs in this system use CUID format)',
});

// ─── GPS Coordinates ───────────────────────────────────────────────────────────

/**
 * Standard GPS coordinate pair.
 *
 * Rejects [0,0] and [-1,-1] which are sentinel/test values that cause
 * haversine distance to calculate thousands of kilometers and reject
 * legitimate check-ins with a confusing error message.
 *
 * Field names are lat/lon (not lat/lng, not latitude/longitude).
 * Any route currently using different names must be migrated.
 */
export const coordinatesSchema = z
  .object({
    lat: z.number().min(-90).max(90, 'Latitude must be between -90 and 90'),
    lon: z.number().min(-180).max(180, 'Longitude must be between -180 and 180'),
  })
  .refine(({ lat, lon }) => !(lat === 0 && lon === 0), {
    message: 'Coordinates [0,0] are invalid — GPS fix not yet acquired',
  })
  .refine(({ lat, lon }) => !(lat === -1 && lon === -1), {
    message: 'Coordinates [-1,-1] are test data — not valid in production',
  });

export type Coordinates = z.infer<typeof coordinatesSchema>;

// ─── Pagination ────────────────────────────────────────────────────────────────

/**
 * Standard pagination query parameters.
 *
 * page: 1-based. Coerced from string (query params arrive as strings).
 * limit: 1–100. Never more than 100 in a single request.
 *
 * z.coerce handles ?page=2&limit=50 from query strings automatically.
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type PaginationParams = z.infer<typeof paginationSchema>;

// ─── Date Range ────────────────────────────────────────────────────────────────

export const dateRangeSchema = z.object({
  from: z.string().datetime({ message: 'from must be ISO 8601 datetime' }),
  to: z.string().datetime({ message: 'to must be ISO 8601 datetime' }),
});

// ─── Idempotency Key ────────────────────────────────────────────────────────────

/**
 * Optional client-provided idempotency key.
 * Client must send this in the Idempotency-Key header (not body).
 * Any non-empty string up to 100 characters. Typically a UUID from the client.
 */
export const idempotencyKeySchema = z.string().min(1).max(100);

// ─── Role Enums ────────────────────────────────────────────────────────────────

export const mobileRoleSchema = z.enum([
  ROLES.STUDENT,
  ROLES.DRIVER,
  ROLES.STAFF,
  ROLES.COORDINATOR,
  ROLES.TRANSPORT_OFFICER,
  ROLES.FACULTY,
  ROLES.MANAGEMENT,
  ROLES.NCC_OFFICER,
]);

export const adminRoleSchema = z.enum([
  ROLES.TRANSPORT_OFFICER,
  ROLES.COORDINATOR,
  ROLES.MANAGEMENT,
  ROLES.FACULTY,
  ROLES.STAFF,
  ROLES.NCC_OFFICER,
]);

export type MobileRole = z.infer<typeof mobileRoleSchema>;
export type AdminRole = z.infer<typeof adminRoleSchema>;
export type AnyRole = MobileRole | AdminRole;

// ─── User Status Enums ─────────────────────────────────────────────────────────

export const userStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);
export type UserStatus = z.infer<typeof userStatusSchema>;

export const authStatusSchema = z.enum([
  'ACTIVE',
  'PENDING_PROVISIONING',
  'AUTH_PROVISION_FAILED',
  'DISABLED',
]);
export type AuthStatus = z.infer<typeof authStatusSchema>;

// ─── Bulk Operations ───────────────────────────────────────────────────────────

/**
 * Array of CUIDs for bulk operations.
 * Hard cap at 1000 to prevent DoS via enormous payloads.
 */
export const cuidArraySchema = z
  .array(cuidSchema)
  .min(1, 'At least one item is required')
  .max(1000, 'Maximum 1000 items allowed per request');

// ─── Query Parameter Helpers ────────────────────────────────────────────────────

/**
 * Boolean coercion for query params (query strings are always strings).
 */
export const booleanQuerySchema = z.enum(['true', 'false']).transform(v => v === 'true');
