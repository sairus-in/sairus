import { AdminAccessContext, AdminRole, canAdmin } from 'shared';

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

const buildAdminContext = (role: AdminRole, routeIds: string[] = [], department?: string): AdminAccessContext => ({
  role,
  scope: {
    routeIds,
    departmentIds: department ? [department] : [],
  },
});

export const getCapabilities = (role: AdminRole, routeIds: string[] = [], department?: string): Capabilities => {
  const admin = buildAdminContext(role, routeIds, department);

  return {
    canViewDashboard: canAdmin(admin, 'VIEW_DASHBOARD'),
    canViewCommandCenter: canAdmin(admin, 'VIEW_COMMAND_CENTER'),
    canViewFleetMap: canAdmin(admin, 'VIEW_FLEET_MAP'),
    canViewTripDetail: canAdmin(admin, 'VIEW_TRIP_DETAIL'),
    canViewIncidents: canAdmin(admin, 'VIEW_INCIDENTS'),
    canViewMessages: canAdmin(admin, 'VIEW_MESSAGES'),
    canMessageDrivers: canAdmin(admin, 'SEND_MESSAGE_TO_DRIVER'),

    canReviewCorrections: canAdmin(admin, 'REVIEW_CORRECTIONS'),
    canReviewGPSOutage: canAdmin(admin, 'REVIEW_GPS_OUTAGE'),
    canCoordinatorOverride: canAdmin(admin, 'COORDINATOR_OVERRIDE'),

    canManageStudents: canAdmin(admin, 'MANAGE_STUDENTS'),
    canBulkImportStudents: canAdmin(admin, 'BULK_IMPORT_STUDENTS'),
    canManageRoutes: canAdmin(admin, 'MANAGE_ROUTES'),
    canManageBuses: canAdmin(admin, 'MANAGE_BUSES'),
    canManageDrivers: canAdmin(admin, 'MANAGE_DRIVERS'),
    canBulkAssignRoutes: canAdmin(admin, 'BULK_ASSIGN_ROUTES'),

    canViewAttendanceReports: canAdmin(admin, 'VIEW_ATTENDANCE_REPORTS'),
    canViewAuditLog: canAdmin(admin, 'VIEW_AUDIT_LOG'),
    canViewSecuritySettings: canAdmin(admin, 'VIEW_SECURITY_SETTINGS'),
    canViewImportSessions: canAdmin(admin, 'VIEW_IMPORT_SESSIONS'),
    canRetryImportRows: canAdmin(admin, 'RETRY_IMPORT_ROWS'),
    canViewPendingAuth: canAdmin(admin, 'VIEW_PENDING_AUTH'),
    canInviteAdmin: canAdmin(admin, 'INVITE_ADMIN'),
    canViewDefaulters: canAdmin(admin, 'VIEW_DEFAULTERS'),
    canNotifyDefaulters: canAdmin(admin, 'NOTIFY_DEFAULTERS'),
    canExportAttendance: canAdmin(admin, 'EXPORT_ATTENDANCE'),

    canEndTripManually: canAdmin(admin, 'END_TRIP_MANUALLY'),
    canAssignSubstitute: canAdmin(admin, 'ASSIGN_SUBSTITUTE'),
    canManualMarkPresent: canAdmin(admin, 'MANUAL_MARK_PRESENT'),
    canResolveIncidents: canAdmin(admin, 'RESOLVE_INCIDENTS'),
    canEscalateIncidents: canAdmin(admin, 'ESCALATE_INCIDENTS'),

    routeScope: role === 'TRANSPORT_OFFICER' ? 'ALL' : routeIds,
    departmentScope: role === 'FACULTY' && department ? department : 'ALL',
    dataScope: role === 'MANAGEMENT' ? 'AGGREGATE_ONLY' : 'FULL',
  };
};
