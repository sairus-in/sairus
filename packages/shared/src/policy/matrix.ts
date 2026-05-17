/**
 * Capability matrix.
 *
 * - ADMIN_ACTION_TO_CAPABILITY — translation table from legacy AdminAction
 *   string enum to new Capability strings. The shim canAdmin() reads from this.
 * - capabilitiesForAdminRole / capabilitiesForMobileRole — capability defaults
 *   per role. The resolver (Commit 3) reads these when building an Actor.
 * - ROUTE_SCOPED_CAPABILITIES — capabilities whose authorization additionally
 *   depends on a route scope check. Mirrors the legacy ROUTE_SCOPED_ACTIONS set.
 */

import type { AdminRole } from '../schemas/common';
import type { Capability } from '../auth/capabilities';

/**
 * Legacy AdminAction → new Capability. Identity-style mapping preserving the
 * locked vocabulary in docs/PHASE_1A_IMPLEMENTATION.md.
 */
export const ADMIN_ACTION_TO_CAPABILITY = {
  VIEW_COMMAND_CENTER: 'admin.command_center.view',
  VIEW_DASHBOARD: 'admin.dashboard.view',
  VIEW_FLEET_MAP: 'admin.fleet_map.view',
  VIEW_TRIP_DETAIL: 'admin.trip.view',
  VIEW_INCIDENTS: 'admin.incident.view',
  VIEW_MESSAGES: 'admin.message.view',
  SEND_MESSAGE_TO_DRIVER: 'admin.message.send_to_driver',
  REVIEW_CORRECTIONS: 'admin.correction.review',
  REVIEW_GPS_OUTAGE: 'admin.gps_outage.review',
  COORDINATOR_OVERRIDE: 'admin.trip.override',
  MANAGE_STUDENTS: 'admin.student.manage',
  BULK_IMPORT_STUDENTS: 'admin.student.bulk_import',
  MANAGE_ROUTES: 'admin.route.manage',
  MANAGE_BUSES: 'admin.bus.manage',
  MANAGE_DRIVERS: 'admin.driver.manage',
  BULK_ASSIGN_ROUTES: 'admin.route.bulk_assign',
  VIEW_ATTENDANCE_REPORTS: 'admin.attendance_report.view',
  VIEW_DEFAULTERS: 'admin.defaulter.view',
  NOTIFY_DEFAULTERS: 'admin.defaulter.notify',
  EXPORT_ATTENDANCE: 'admin.attendance.export',
  END_TRIP_MANUALLY: 'admin.trip.end_manually',
  ASSIGN_SUBSTITUTE: 'admin.trip.assign_substitute',
  MANUAL_MARK_PRESENT: 'admin.attendance.manual_mark',
  RESOLVE_INCIDENTS: 'admin.incident.resolve',
  ESCALATE_INCIDENTS: 'admin.incident.escalate',
  VIEW_SECURITY_SETTINGS: 'admin.security.view',
  VIEW_IMPORT_SESSIONS: 'admin.import.view',
  RETRY_IMPORT_ROWS: 'admin.import.retry',
  VIEW_PENDING_AUTH: 'admin.auth_provisioning.view',
  INVITE_ADMIN: 'admin.admin_user.invite',
  VIEW_AUDIT_LOG: 'admin.audit_log.view',
} as const satisfies Record<string, Capability>;

// ── Per-role capability sets (ports getAllowedActions from legacy) ────────────

const TRANSPORT_OFFICER_CAPS: readonly Capability[] = [
  'admin.command_center.view',
  'admin.dashboard.view',
  'admin.fleet_map.view',
  'admin.trip.view',
  'admin.incident.view',
  'admin.message.view',
  'admin.message.send_to_driver',
  'admin.correction.review',
  'admin.gps_outage.review',
  'admin.trip.override',
  'admin.student.manage',
  'admin.student.bulk_import',
  'admin.route.manage',
  'admin.bus.manage',
  'admin.driver.manage',
  'admin.route.bulk_assign',
  'admin.attendance_report.view',
  'admin.defaulter.view',
  'admin.defaulter.notify',
  'admin.attendance.export',
  'admin.trip.end_manually',
  'admin.trip.assign_substitute',
  'admin.attendance.manual_mark',
  'admin.incident.resolve',
  'admin.incident.escalate',
  'admin.security.view',
  'admin.admin_user.invite',
  'admin.audit_log.view',
];

const COORDINATOR_CAPS: readonly Capability[] = [
  'admin.command_center.view',
  'admin.dashboard.view',
  'admin.trip.view',
  'admin.incident.view',
  'admin.message.view',
  'admin.message.send_to_driver',
  'admin.correction.review',
  'admin.gps_outage.review',
  'admin.trip.override',
  'admin.attendance_report.view',
  'admin.defaulter.view',
  'admin.defaulter.notify',
  'admin.attendance.export',
  'admin.trip.end_manually',
  'admin.trip.assign_substitute',
  'admin.attendance.manual_mark',
  'admin.incident.resolve',
  'admin.incident.escalate',
  'admin.security.view',
];

const MANAGEMENT_CAPS: readonly Capability[] = [
  'admin.command_center.view',
  'admin.dashboard.view',
  'admin.fleet_map.view',
  'admin.trip.view',
  'admin.incident.view',
  'admin.message.view',
  'admin.attendance_report.view',
  'admin.security.view',
  'admin.student.bulk_import',
  'admin.import.view',
  'admin.import.retry',
  'admin.auth_provisioning.view',
  'admin.admin_user.invite',
  'admin.audit_log.view',
];

const FACULTY_CAPS: readonly Capability[] = [
  'admin.attendance_report.view',
  'admin.defaulter.view',
  'admin.security.view',
];

export const capabilitiesForAdminRole = (
  role: AdminRole | string | null | undefined,
): ReadonlySet<Capability> => {
  switch (role) {
    case 'TRANSPORT_OFFICER': return new Set(TRANSPORT_OFFICER_CAPS);
    case 'COORDINATOR':       return new Set(COORDINATOR_CAPS);
    case 'MANAGEMENT':        return new Set(MANAGEMENT_CAPS);
    case 'FACULTY':           return new Set(FACULTY_CAPS);
    // STAFF / NCC have no defined capabilities — match legacy behavior.
    default:                  return new Set<Capability>();
  }
};

// ── Mobile capability sets ────────────────────────────────────────────────────

const STUDENT_CAPS: readonly Capability[] = [
  'student.attendance.checkin',
  'student.attendance.verify_arrival',
  'student.attendance.skip_today',
  'student.wait_request.create',
  'student.correction.submit',
  'student.history.view',
  'student.self_report.submit',
];

const DRIVER_CAPS: readonly Capability[] = [
  'driver.assignment.view',
  'driver.trip.start',
  'driver.trip.end',
  'driver.trip.roster.view',
  'driver.attendance.manual_mark',
  'driver.gps.ping',
  'driver.delegate.manage',
  'driver.kiosk.operate',
];

export const capabilitiesForMobileRole = (
  role: string | null | undefined,
): ReadonlySet<Capability> => {
  switch (role) {
    case 'STUDENT': return new Set(STUDENT_CAPS);
    case 'DRIVER':  return new Set(DRIVER_CAPS);
    default:        return new Set<Capability>();
  }
};

// ── Route-scoped capability set (mirrors legacy ROUTE_SCOPED_ACTIONS) ─────────

/**
 * Capabilities whose authorization depends on a route scope check when the
 * resource carries a routeId AND the actor's scope.routeIds is non-empty.
 *
 * Match legacy ROUTE_SCOPED_ACTIONS exactly to preserve canAdmin() parity.
 */
export const ROUTE_SCOPED_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  'admin.command_center.view',
  'admin.dashboard.view',
  'admin.trip.view',
  'admin.incident.view',
  'admin.message.view',
  'admin.message.send_to_driver',
  'admin.correction.review',
  'admin.gps_outage.review',
  'admin.trip.override',
  'admin.attendance_report.view',
  'admin.defaulter.view',
  'admin.defaulter.notify',
  'admin.attendance.export',
  'admin.trip.end_manually',
  'admin.trip.assign_substitute',
  'admin.attendance.manual_mark',
  'admin.incident.resolve',
  'admin.incident.escalate',
]);
