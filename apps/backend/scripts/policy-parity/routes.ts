/**
 * Route sweep spec — the 15 endpoints the parity script exercises.
 *
 * Each entry targets a specific capability / requireAction call site so that
 * a status-code diff between baseline and post-migration immediately surfaces
 * any regressions.
 *
 * GET requests only — avoids CSRF complications and is sufficient for
 * authorization parity checks (the capability check is the same regardless
 * of HTTP verb).
 */

export interface RouteSpec {
  /** Short label used as the column key in baseline JSON. */
  label: string;
  method: 'GET';
  /** Absolute path including query string, relative to BACKEND_URL. */
  path: string;
  /** Human-readable note about which capability / action this exercises. */
  capability: string;
}

// Keep the report query stable across days so baseline diffs only reflect
// behavior changes. Override in local runs when deliberately testing a new
// fixture date range.
const reportStartDate = process.env.PARITY_REPORT_START_DATE ?? '2026-05-10';
const reportEndDate = process.env.PARITY_REPORT_END_DATE ?? '2026-05-17';

export const routeSpecs: RouteSpec[] = [
  // ── Admin live-ops ────────────────────────────────────────────────────────
  {
    label: 'admin.dashboard',
    method: 'GET',
    path: '/v1/admin/live/dashboard',
    capability: 'VIEW_DASHBOARD → admin.dashboard.view',
  },
  {
    label: 'admin.command_center',
    method: 'GET',
    path: '/v1/admin/live/command-center',
    capability: 'VIEW_COMMAND_CENTER → admin.command_center.view',
  },
  {
    label: 'admin.active_trips',
    method: 'GET',
    path: '/v1/admin/live/trips/active',
    capability: 'VIEW_TRIP_DETAIL → admin.trip.view',
  },
  {
    label: 'admin.corrections',
    method: 'GET',
    path: '/v1/admin/corrections',
    capability: 'REVIEW_CORRECTIONS → admin.correction.review',
  },
  {
    label: 'admin.incidents',
    method: 'GET',
    path: '/v1/admin/incidents',
    capability: 'VIEW_INCIDENTS → admin.incident.view',
  },
  {
    label: 'admin.messages',
    method: 'GET',
    path: '/v1/admin/messages',
    capability: 'VIEW_MESSAGES → admin.message.view',
  },
  {
    label: 'admin.gps_outages',
    method: 'GET',
    path: '/v1/admin/ops/gps-outages',
    capability: 'REVIEW_GPS_OUTAGE → admin.gps_outage.review',
  },

  // ── Reports & data ────────────────────────────────────────────────────────
  {
    label: 'admin.attendance_overview',
    method: 'GET',
    path: `/v1/admin/reports/attendance/overview?startDate=${reportStartDate}&endDate=${reportEndDate}`,
    capability: 'VIEW_ATTENDANCE_REPORTS → admin.attendance_report.view',
  },

  // ── Management-gated ────────────────────────────────────────────────────
  {
    label: 'admin.audit_log',
    method: 'GET',
    path: '/v1/admin/audit-log',
    capability: 'VIEW_AUDIT_LOG → admin.audit_log.view',
  },
  {
    label: 'admin.pending_auth',
    method: 'GET',
    path: '/v1/admin/ops/pending-auth',
    capability: 'VIEW_PENDING_AUTH → admin.auth_provisioning.view',
  },
  {
    label: 'admin.admin_users',
    method: 'GET',
    path: '/v1/admin/admin-users',
    capability: 'INVITE_ADMIN → admin.admin_user.invite',
  },
  {
    label: 'admin.import_sessions',
    method: 'GET',
    path: '/v1/admin/ops/import-sessions',
    capability: 'VIEW_IMPORT_SESSIONS → admin.import.view',
  },

  // ── Alerts (VIEW_INCIDENTS — distinct from the incidents list itself) ───────
  {
    label: 'admin.live_alerts',
    method: 'GET',
    path: '/v1/admin/live/alerts',
    capability: 'VIEW_COMMAND_CENTER → admin.command_center.view (alerts feed)',
  },

  // ── Users module (student list — coordinator-scoped) ─────────────────────
  {
    label: 'users.student_list',
    method: 'GET',
    path: '/v1/users',
    capability: 'MANAGE_STUDENTS → admin.student.manage (coordinator gets scoped view)',
  },

  // ── Stats endpoint (no requireAction, direct role-gate) ──────────────────
  {
    label: 'admin.stats',
    method: 'GET',
    path: '/v1/admin/stats',
    capability: 'VIEW_DASHBOARD → admin.dashboard.view (stats endpoint)',
  },
];
