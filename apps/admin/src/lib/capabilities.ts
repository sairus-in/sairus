import type { AdminRole, Capability } from 'shared';

export type { AdminRole };

export interface Capabilities {
  canViewDashboard: boolean;
  canViewCommandCenter: boolean;
  canViewFleetMap: boolean;
  canViewTripDetail: boolean;
  canViewIncidents: boolean;
  canViewMessages: boolean;
  canMessageDrivers: boolean;

  canReviewCorrections: boolean;
  canReviewGPSOutage: boolean;
  canCoordinatorOverride: boolean;

  canManageStudents: boolean;
  canBulkImportStudents: boolean;
  canManageRoutes: boolean;
  canManageBuses: boolean;
  canManageDrivers: boolean;
  canBulkAssignRoutes: boolean;

  canViewAttendanceReports: boolean;
  canViewAuditLog: boolean;
  canViewSecuritySettings: boolean;
  canViewImportSessions: boolean;
  canRetryImportRows: boolean;
  canViewPendingAuth: boolean;
  canInviteAdmin: boolean;
  canViewDefaulters: boolean;
  canNotifyDefaulters: boolean;
  canExportAttendance: boolean;

  canEndTripManually: boolean;
  canAssignSubstitute: boolean;
  canManualMarkPresent: boolean;
  canResolveIncidents: boolean;
  canEscalateIncidents: boolean;

  routeScope: 'ALL' | string[];
  departmentScope: 'ALL' | string;
  dataScope: 'FULL' | 'AGGREGATE_ONLY';
}

export const getCapabilities = (
  capabilities: string[],
  role: AdminRole,
  routeIds: string[] = [],
  department?: string | null,
): Capabilities => {
  const has = (cap: Capability) => capabilities.includes(cap);

  return {
    canViewDashboard: has('admin.dashboard.view'),
    canViewCommandCenter: has('admin.command_center.view'),
    canViewFleetMap: has('admin.fleet_map.view'),
    canViewTripDetail: has('admin.trip.view'),
    canViewIncidents: has('admin.incident.view'),
    canViewMessages: has('admin.message.view'),
    canMessageDrivers: has('admin.message.send_to_driver'),

    canReviewCorrections: has('admin.correction.review'),
    canReviewGPSOutage: has('admin.gps_outage.review'),
    canCoordinatorOverride: has('admin.trip.override'),

    canManageStudents: has('admin.student.manage'),
    canBulkImportStudents: has('admin.student.bulk_import'),
    canManageRoutes: has('admin.route.manage'),
    canManageBuses: has('admin.bus.manage'),
    canManageDrivers: has('admin.driver.manage'),
    canBulkAssignRoutes: has('admin.route.bulk_assign'),

    canViewAttendanceReports: has('admin.attendance_report.view'),
    canViewAuditLog: has('admin.audit_log.view'),
    canViewSecuritySettings: has('admin.security.view'),
    canViewImportSessions: has('admin.import.view'),
    canRetryImportRows: has('admin.import.retry'),
    canViewPendingAuth: has('admin.auth_provisioning.view'),
    canInviteAdmin: has('admin.admin_user.invite'),
    canViewDefaulters: has('admin.defaulter.view'),
    canNotifyDefaulters: has('admin.defaulter.notify'),
    canExportAttendance: has('admin.attendance.export'),

    canEndTripManually: has('admin.trip.end_manually'),
    canAssignSubstitute: has('admin.trip.assign_substitute'),
    canManualMarkPresent: has('admin.attendance.manual_mark'),
    canResolveIncidents: has('admin.incident.resolve'),
    canEscalateIncidents: has('admin.incident.escalate'),

    routeScope: role === 'TRANSPORT_OFFICER' ? 'ALL' : routeIds,
    departmentScope: role === 'FACULTY' && department ? department : 'ALL',
    dataScope: role === 'MANAGEMENT' ? 'AGGREGATE_ONLY' : 'FULL',
  };
};
