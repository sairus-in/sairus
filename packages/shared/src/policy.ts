import { AdminRole } from './schemas/common';

export type AdminAction =
  | 'VIEW_COMMAND_CENTER'
  | 'VIEW_DASHBOARD'
  | 'VIEW_FLEET_MAP'
  | 'VIEW_TRIP_DETAIL'
  | 'VIEW_INCIDENTS'
  | 'VIEW_MESSAGES'
  | 'SEND_MESSAGE_TO_DRIVER'
  | 'REVIEW_CORRECTIONS'
  | 'REVIEW_GPS_OUTAGE'
  | 'COORDINATOR_OVERRIDE'
  | 'MANAGE_STUDENTS'
  | 'BULK_IMPORT_STUDENTS'
  | 'MANAGE_ROUTES'
  | 'MANAGE_BUSES'
  | 'MANAGE_DRIVERS'
  | 'BULK_ASSIGN_ROUTES'
  | 'VIEW_ATTENDANCE_REPORTS'
  | 'VIEW_DEFAULTERS'
  | 'NOTIFY_DEFAULTERS'
  | 'EXPORT_ATTENDANCE'
  | 'END_TRIP_MANUALLY'
  | 'ASSIGN_SUBSTITUTE'
  | 'MANUAL_MARK_PRESENT'
  | 'RESOLVE_INCIDENTS'
  | 'ESCALATE_INCIDENTS'
  | 'VIEW_SECURITY_SETTINGS'
  | 'VIEW_IMPORT_SESSIONS'
  | 'RETRY_IMPORT_ROWS'
  | 'VIEW_PENDING_AUTH'
  | 'INVITE_ADMIN'
  | 'VIEW_AUDIT_LOG';

export interface AdminPolicyScope {
  routeIds: string[];
  departmentIds: string[];
}

export interface AdminAccessContext {
  role: AdminRole;
  scope: AdminPolicyScope;
}

export interface AdminPolicyResource {
  routeId?: string | null;
  departmentId?: string | null;
}

const TRANSPORT_OFFICER_ACTIONS: readonly AdminAction[] = [
  'VIEW_COMMAND_CENTER',
  'VIEW_DASHBOARD',
  'VIEW_FLEET_MAP',
  'VIEW_TRIP_DETAIL',
  'VIEW_INCIDENTS',
  'VIEW_MESSAGES',
  'SEND_MESSAGE_TO_DRIVER',
  'REVIEW_CORRECTIONS',
  'REVIEW_GPS_OUTAGE',
  'COORDINATOR_OVERRIDE',
  'MANAGE_STUDENTS',
  'BULK_IMPORT_STUDENTS',
  'MANAGE_ROUTES',
  'MANAGE_BUSES',
  'MANAGE_DRIVERS',
  'BULK_ASSIGN_ROUTES',
  'VIEW_ATTENDANCE_REPORTS',
  'VIEW_DEFAULTERS',
  'NOTIFY_DEFAULTERS',
  'EXPORT_ATTENDANCE',
  'END_TRIP_MANUALLY',
  'ASSIGN_SUBSTITUTE',
  'MANUAL_MARK_PRESENT',
  'RESOLVE_INCIDENTS',
  'ESCALATE_INCIDENTS',
  'VIEW_SECURITY_SETTINGS',
  'INVITE_ADMIN',
  'VIEW_AUDIT_LOG',
];

const COORDINATOR_ACTIONS: readonly AdminAction[] = [
  'VIEW_COMMAND_CENTER',
  'VIEW_DASHBOARD',
  'VIEW_TRIP_DETAIL',
  'VIEW_INCIDENTS',
  'VIEW_MESSAGES',
  'SEND_MESSAGE_TO_DRIVER',
  'REVIEW_CORRECTIONS',
  'REVIEW_GPS_OUTAGE',
  'COORDINATOR_OVERRIDE',
  'VIEW_ATTENDANCE_REPORTS',
  'VIEW_DEFAULTERS',
  'NOTIFY_DEFAULTERS',
  'EXPORT_ATTENDANCE',
  'END_TRIP_MANUALLY',
  'ASSIGN_SUBSTITUTE',
  'MANUAL_MARK_PRESENT',
  'RESOLVE_INCIDENTS',
  'ESCALATE_INCIDENTS',
  'VIEW_SECURITY_SETTINGS',
];

const MANAGEMENT_ACTIONS: readonly AdminAction[] = [
  'VIEW_COMMAND_CENTER',
  'VIEW_DASHBOARD',
  'VIEW_FLEET_MAP',
  'VIEW_TRIP_DETAIL',
  'VIEW_INCIDENTS',
  'VIEW_MESSAGES',
  'VIEW_ATTENDANCE_REPORTS',
  'VIEW_SECURITY_SETTINGS',
  'BULK_IMPORT_STUDENTS',
  'VIEW_IMPORT_SESSIONS',
  'RETRY_IMPORT_ROWS',
  'VIEW_PENDING_AUTH',
  'INVITE_ADMIN',
  'VIEW_AUDIT_LOG',
];

const FACULTY_ACTIONS: readonly AdminAction[] = [
  'VIEW_ATTENDANCE_REPORTS',
  'VIEW_DEFAULTERS',
  'VIEW_SECURITY_SETTINGS',
];

const ROUTE_SCOPED_ACTIONS = new Set<AdminAction>([
  'VIEW_COMMAND_CENTER',
  'VIEW_DASHBOARD',
  'VIEW_TRIP_DETAIL',
  'VIEW_INCIDENTS',
  'VIEW_MESSAGES',
  'SEND_MESSAGE_TO_DRIVER',
  'REVIEW_CORRECTIONS',
  'REVIEW_GPS_OUTAGE',
  'COORDINATOR_OVERRIDE',
  'VIEW_ATTENDANCE_REPORTS',
  'VIEW_DEFAULTERS',
  'NOTIFY_DEFAULTERS',
  'EXPORT_ATTENDANCE',
  'END_TRIP_MANUALLY',
  'ASSIGN_SUBSTITUTE',
  'MANUAL_MARK_PRESENT',
  'RESOLVE_INCIDENTS',
  'ESCALATE_INCIDENTS',
]);

const getAllowedActions = (role: AdminRole | string | null | undefined): readonly AdminAction[] => {
  switch (role) {
    case 'TRANSPORT_OFFICER':
      return TRANSPORT_OFFICER_ACTIONS;
    case 'COORDINATOR':
      return COORDINATOR_ACTIONS;
    case 'MANAGEMENT':
      return MANAGEMENT_ACTIONS;
    case 'FACULTY':
      return FACULTY_ACTIONS;
    case 'STAFF':
      // STAFF role doesn't have specific actions defined yet
      return [];
    case 'NCC':
      // NCC role doesn't have specific actions defined yet
      return [];
    default:
      return [];
  }
};

export const canAdmin = (
  admin: AdminAccessContext,
  action: AdminAction,
  resource?: AdminPolicyResource,
): boolean => {
  const allowedActions = getAllowedActions(admin.role);
  const routeIds = Array.isArray(admin.scope?.routeIds) ? admin.scope.routeIds : [];
  const departmentIds = Array.isArray(admin.scope?.departmentIds) ? admin.scope.departmentIds : [];

  if (!allowedActions.includes(action)) {
    return false;
  }

  if (admin.role === 'COORDINATOR' && ROUTE_SCOPED_ACTIONS.has(action) && resource?.routeId) {
    return routeIds.includes(resource.routeId);
  }

  if (admin.role === 'FACULTY' && resource?.departmentId) {
    return departmentIds.includes(resource.departmentId);
  }

  return true;
};
