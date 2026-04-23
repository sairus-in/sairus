/**
 * AUTHORIZATION HELPERS
 *
 * THE RULE: Every route must use exactly one of these two functions.
 * No other authentication/authorization pattern is permitted.
 *
 * mobileRoute(roles)         — routes accessed from the mobile app
 * adminRoute(roles, scoped?) — routes accessed from the admin panel
 *
 * This replaces four inconsistent patterns found across the codebase:
 *   ❌ [authenticate, requireRole(['COORDINATOR'])]      — inconsistent
 *   ❌ [requireAdminRole(['TRANSPORT_OFFICER'])]         — different pattern
 *   ❌ Manual auth checks in route handlers              — wrong layer
 *
 * COORDINATOR SCOPING:
 *   Coordinators can only see/modify resources in their assigned routes.
 *   Any route that accepts COORDINATOR in its roles AND allows mutation
 *   MUST pass scoped=true. This middleware reads coordinatorRouteIds from
 *   the JWT and injects it into the request for the service layer to use.
 *
 * @example
 *   // Mobile-only, students
 *   preHandler: mobileRoute(['STUDENT'])
 *
 *   // Admin, coordinator with scoping
 *   preHandler: adminRoute(['COORDINATOR', 'TRANSPORT_OFFICER'], true)
 */

import type { preHandlerHookHandler } from 'fastify';
import { requireMobileAuth, requireRole } from '../modules/auth/auth.middleware';
import { requireAdminAuth, requireAdminRole, scopeCoordinator } from '../modules/auth/admin-auth.middleware';

type MobileRole = 'STUDENT' | 'DRIVER' | 'PARENT';

type AdminRole =
  | 'TRANSPORT_OFFICER'
  | 'COORDINATOR'
  | 'MANAGEMENT'
  | 'FACULTY'
  | 'STAFF'
  | 'NCC';

/**
 * For routes accessed from the mobile app.
 * Always requires JWT authentication + role check.
 */
export function mobileRoute(roles: MobileRole[]): preHandlerHookHandler[] {
  return [requireMobileAuth, requireRole(roles as any)];
}

/**
 * For routes accessed from the admin panel.
 *
 * @param roles   Which admin roles can access this endpoint
 * @param scoped  When true, coordinators are restricted to their assigned routes.
 *                Set true on any mutation endpoint that accepts COORDINATOR.
 */
export function adminRoute(
  roles: AdminRole[],
  scoped = false,
): preHandlerHookHandler[] {
  const handlers: preHandlerHookHandler[] = [requireAdminAuth, requireAdminRole(roles as any)];
  if (scoped) {
    handlers.push(scopeCoordinator);
  }
  return handlers;
}
