/**
 * ROUTES MODULE — SHARED TYPES
 *
 * Interfaces shared between routes.routes.ts, routes.service.ts, and routes.repository.ts.
 * Keeping types in a dedicated file prevents circular imports and makes
 * the data contract between layers explicit and inspectable.
 */

// ─── Audit Context ────────────────────────────────────────────────────────────

/**
 * AuditContext — structured audit trail information.
 *
 * Passed from route handler → service → repository so every DB mutation
 * can record who initiated it, from what IP, and what type of actor.
 */
export interface AuditContext {
  actorType: 'ADMIN_USER' | 'SYSTEM' | 'CLOUD_TASK';
  actorId: string;   // admin user ID or system identifier
  ip?: string;       // request IP for the audit trail
}

// ─── Route Types ──────────────────────────────────────────────────────────────

/**
 * Input for creating a route.
 */
export interface CreateRouteInput {
  name: string;
  area: string;
  activeDays: ActiveDay[];
}

/**
 * Input for updating route metadata (not stops).
 */
export interface UpdateRouteInput {
  name?: string;
  area?: string;
  activeDays?: ActiveDay[];
  isActive?: boolean;
}

/**
 * Day of the week enum.
 */
export type ActiveDay = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';

/**
 * Complete route with all stop details included.
 * Returned by all route queries.
 */
export interface RouteWithStops {
  id: string;
  name: string;
  area: string;
  activeDays: ActiveDay[];
  isActive: boolean;
  stops: RouteStop[];
  updatedAt: string; // ISO timestamp — used for optimistic locking
  createdAt: string;
}

// ─── Stop Types ───────────────────────────────────────────────────────────────

/**
 * Physical bus stop in the stop catalog.
 */
export interface Stop {
  id: string;
  name: string;
  area?: string;
  lat: number;
  lon: number;
  isActive: boolean;
  createdAt: string;
}

/**
 * Stop assigned to a route with sequence and timing.
 */
export interface RouteStop {
  id: string;            // RouteStop join table ID
  stopId: string;        // Reference to Stop
  stop: Stop;            // Full stop details
  sequence: number;      // 1-based order along the route
  morningTime?: string;  // HH:MM expected arrival time
  returnTime?: string;   // HH:MM expected return time
}

/**
 * Input for creating a physical stop.
 */
export interface CreateStopInput {
  name: string;
  area?: string;
  lat: number;
  lon: number;
}

/**
 * Input for updating route stop assignments.
 */
export interface UpdateRouteStopsInput {
  stopId: string;
  sequence: number;
  morningTime?: string; // HH:MM
  returnTime?: string;  // HH:MM
}
