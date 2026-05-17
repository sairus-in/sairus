/**
 * Capability vocabulary for the policy layer.
 *
 * Closed set — new capability requires a packages/shared PR.
 * Naming convention: `domain.resource.action`.
 *
 * See docs/PHASE_1A_IMPLEMENTATION.md for the rationale behind each entry,
 * the migration mapping from the legacy AdminAction enum, and the rules
 * governing scope-self enforcement (encoded in policy predicates, not names).
 */

export type Capability =
  // ── Admin (31) — ports existing AdminAction values ────────────────────────
  | 'admin.command_center.view'
  | 'admin.dashboard.view'
  | 'admin.fleet_map.view'
  | 'admin.trip.view'
  | 'admin.trip.override'              // renamed from COORDINATOR_OVERRIDE
  | 'admin.trip.end_manually'
  | 'admin.trip.assign_substitute'
  | 'admin.incident.view'
  | 'admin.incident.resolve'
  | 'admin.incident.escalate'
  | 'admin.message.view'
  | 'admin.message.send_to_driver'
  | 'admin.correction.review'
  | 'admin.gps_outage.review'
  | 'admin.attendance.manual_mark'
  | 'admin.attendance.export'
  | 'admin.attendance_report.view'
  | 'admin.defaulter.view'
  | 'admin.defaulter.notify'
  | 'admin.student.manage'
  | 'admin.student.bulk_import'
  | 'admin.route.manage'
  | 'admin.route.bulk_assign'
  | 'admin.bus.manage'
  | 'admin.driver.manage'
  | 'admin.import.view'
  | 'admin.import.retry'
  | 'admin.auth_provisioning.view'     // renamed from VIEW_PENDING_AUTH
  | 'admin.admin_user.invite'
  | 'admin.audit_log.view'
  | 'admin.security.view'
  // ── Mobile student (7) — scope-self enforced in policy predicate ──────────
  // Note: GET /student/home is actor-type guarded (mobile_student), no capability.
  | 'student.attendance.checkin'
  | 'student.attendance.verify_arrival'
  | 'student.attendance.skip_today'
  | 'student.wait_request.create'
  | 'student.correction.submit'
  | 'student.history.view'
  | 'student.self_report.submit'
  // ── Mobile driver (8) ─────────────────────────────────────────────────────
  | 'driver.assignment.view'
  | 'driver.trip.start'
  | 'driver.trip.end'
  | 'driver.trip.roster.view'
  | 'driver.attendance.manual_mark'    // distinct from admin.attendance.manual_mark
  | 'driver.gps.ping'
  | 'driver.delegate.manage'
  | 'driver.kiosk.operate';

/**
 * Frozen enumeration of every Capability. Used for runtime validation,
 * test coverage assertions, and policy-matrix exhaustiveness checks.
 *
 * Order is not load-bearing — checks are membership-based.
 */
export const ALL_CAPABILITIES = Object.freeze([
  'admin.command_center.view',
  'admin.dashboard.view',
  'admin.fleet_map.view',
  'admin.trip.view',
  'admin.trip.override',
  'admin.trip.end_manually',
  'admin.trip.assign_substitute',
  'admin.incident.view',
  'admin.incident.resolve',
  'admin.incident.escalate',
  'admin.message.view',
  'admin.message.send_to_driver',
  'admin.correction.review',
  'admin.gps_outage.review',
  'admin.attendance.manual_mark',
  'admin.attendance.export',
  'admin.attendance_report.view',
  'admin.defaulter.view',
  'admin.defaulter.notify',
  'admin.student.manage',
  'admin.student.bulk_import',
  'admin.route.manage',
  'admin.route.bulk_assign',
  'admin.bus.manage',
  'admin.driver.manage',
  'admin.import.view',
  'admin.import.retry',
  'admin.auth_provisioning.view',
  'admin.admin_user.invite',
  'admin.audit_log.view',
  'admin.security.view',
  'student.attendance.checkin',
  'student.attendance.verify_arrival',
  'student.attendance.skip_today',
  'student.wait_request.create',
  'student.correction.submit',
  'student.history.view',
  'student.self_report.submit',
  'driver.assignment.view',
  'driver.trip.start',
  'driver.trip.end',
  'driver.trip.roster.view',
  'driver.attendance.manual_mark',
  'driver.gps.ping',
  'driver.delegate.manage',
  'driver.kiosk.operate',
] as const satisfies readonly Capability[]);

export type CapabilityDomain = 'admin' | 'student' | 'driver';

/**
 * Runtime type guard. Use at trust boundaries (e.g. when reading a capability
 * string from a cache, DB row, or external system) before treating it as
 * a typed Capability.
 */
export const isCapability = (value: unknown): value is Capability => {
  return typeof value === 'string'
    && (ALL_CAPABILITIES as readonly string[]).includes(value);
};

/**
 * Extract the domain prefix from a capability. Useful for grouping in
 * audit logs and dashboards.
 */
export const capabilityDomain = (capability: Capability): CapabilityDomain => {
  const prefix = capability.split('.', 1)[0];
  if (prefix === 'admin' || prefix === 'student' || prefix === 'driver') {
    return prefix;
  }
  // Unreachable given the Capability union; the type check guards us at compile time.
  throw new Error(`unknown capability domain: ${capability}`);
};
