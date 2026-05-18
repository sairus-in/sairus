import { AdminRole, AuthStatus } from '../schemas/common';
import type { Pagination } from '../lib/response';
import { AttendanceStatus } from './attendance.types';
import { EscalationLevel, IncidentStatus, IncidentType } from './incident.types';
import { NotificationType } from './notification.types';
import { TripDirection, TripStatus } from './trip.types';
import { Role } from './user.types';
export type ImportSessionStatus =
  | 'VALIDATING'
  | 'VALIDATED_WITH_ERRORS'
  | 'READY_TO_IMPORT'
  | 'IMPORTING'
  | 'DONE'
  | 'DONE_WITH_ERRORS'
  | 'FAILED'
  | 'CANCELLED';
export type ImportRowStatus = 'PENDING' | 'IMPORTED' | 'FAILED';

export type AdminMessageType = 'DIRECT' | 'BROADCAST_ALL' | 'BROADCAST_ROUTE' | 'BROADCAST_BUS' | 'SYSTEM_EVENT';
export type AdminMessagePriority = 'NORMAL' | 'URGENT';
export type AdminActionContextType = 'TRIP' | 'INCIDENT' | 'GPS_OUTAGE' | 'ROUTE' | 'BROADCAST';
export type AdminPriorityLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type AdminSuggestedActionType =
  | 'CONTACT_DRIVER'
  | 'NOTIFY_AFFECTED_USERS'
  | 'ASSIGN_SUBSTITUTE'
  | 'REQUEST_DELEGATE'
  | 'RESOLVE_INCIDENT'
  | 'ESCALATE_INCIDENT'
  | 'COORDINATOR_OVERRIDE'
  | 'OPEN_TRIP'
  | 'WATCH_ONLY';
export type AdminFocusModeState = 'ALL' | 'URGENT_ONLY';

export interface AdminActionContext {
  contextType: AdminActionContextType;
  contextId: string;
  tripId?: string;
  incidentId?: string;
  busId?: string;
  routeId?: string;
  title?: string;
  subtitle?: string;
}

export interface AdminSuggestedAction {
  id: string;
  type: AdminSuggestedActionType;
  label: string;
  reason: string;
  priority: AdminPriorityLevel;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  impactedUsers: number;
  payload: Record<string, string | number | boolean | null | undefined>;
  disabled?: boolean;
}

export interface AdminCommandEntity {
  id: string;
  kind: 'INCIDENT' | 'GPS_OUTAGE' | 'TRIP_RISK' | 'LATE_START' | 'CORRECTION_RISK';
  priority: AdminPriorityLevel;
  title: string;
  summary: string;
  busNumber?: string;
  routeName?: string;
  driverName?: string | null;
  statusLabel: string;
  ageMinutes?: number | null;
  impactedUsers: number;
  badges: string[];
  context: AdminActionContext;
  actions: AdminSuggestedAction[];
}

export interface AdminCommandCenterStats {
  activeTrips: number;
  criticalCount: number;
  highCount: number;
  unresolvedIncidents: number;
  gpsOffline: number;
  impactedUsers: number;
}

export interface AdminCommandCenterPayload {
  generatedAt: string;
  stats: AdminCommandCenterStats;
  entities: AdminCommandEntity[];
}

export interface AdminActionExecutionResult {
  success: boolean;
  message: string;
  context?: AdminActionContext;
}

export interface AdminSessionUser {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  mfaEnabled?: boolean;
  routeIds?: string[];
  department?: string | null;
  capabilities: string[];
}

export interface AdminLoginMfaChallengeResponse {
  mfaRequired: true;
  challengeToken: string;
  expiresInSeconds: number;
}

export interface AdminLoginSuccessResponse {
  user: AdminSessionUser;
}

export interface AdminLoginResponse {
  success: true;
  data: AdminLoginSuccessResponse | AdminLoginMfaChallengeResponse;
}

export interface AdminMfaStatusResponse {
  enabled: boolean;
  pendingSetup: boolean;
}

export interface AdminMfaSetupResponse {
  manualEntryKey: string;
  otpauthUrl: string;
}

export interface AdminActionResponse {
  success: boolean;
  message?: string;
  requiresReauth?: boolean;
}

export interface AdminStepUpResponse {
  stepUpToken: string;
  expiresInSeconds: number;
}

export interface AdminMfaEnableResponse extends AdminActionResponse {
  backupCodes?: string[];
}

export interface AdminMfaBackupCodeSummary {
  totalCount: number;
  remainingCount: number;
  lastUsedAt: string | null;
}

export interface AdminMfaBackupCodesResponse {
  backupCodes: string[];
  totalCount: number;
}

export interface AdminTrustedDeviceItem {
  id: string;
  label: string | null;
  userAgent: string;
  acceptLanguage?: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  lastIpCountry: string | null;
}

export interface AdminTrustedDeviceListResponse {
  devices: AdminTrustedDeviceItem[];
}

export interface AdminUserManagementItem {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  isActive: boolean;
  isSuspended: boolean;
  mfaEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  deactivatedAt: string | null;
  suspendedAt: string | null;
  suspendReason: string | null;
  routeIds: string[];
  department: string | null;
  trustedDeviceCount: number;
  lastTrustedDeviceCountry: string | null;
}

export interface AdminTokenVerificationResponse {
  valid: true;
  emailHint: string;
  name: string;
}

export interface AdminDashboardStats {
  activeTrips: number;
  checkedIn: number;
  gpsOffline: number;
  openCorrections: number;
}

export interface AdminLiveTripState {
  id: string;
  status: TripStatus;
  gpsStatus: 'LIVE' | 'STALE' | 'OFFLINE';
  busId: string;
  busNumber: string;
  routeName: string;
  driverName?: string;
  boardedCount: number;
  expectedCount: number;
  startedAt: number;
}

export interface AdminTripStudent {
  id: string;
  status: 'PRESENT' | 'ABSENT' | 'LATE_BOARD' | 'PENDING' | 'EXCUSED' | 'MANUAL';
  checkedInAt: string | null;
  user: {
    id: string;
    name: string;
    rollNumber: string | null;
    department: string | null;
  };
}

export interface AdminTripTimelineEvent {
  id: string;
  timestamp: string;
  type: string;
  message: string;
  actor: string;
  metadata: Record<string, unknown> | null;
}

export interface AdminCorrection {
  id: string;
  attendanceId: string;
  requestedById: string;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  metadata: Record<string, unknown> | null;
  createdAt: string;
  attendance: {
    id: string;
    lat: number | null;
    lon: number | null;
    distanceToBus: number | null;
    distanceToStop: number | null;
    geofenceMethod: string | null;
    failReason: string | null;
    user: {
      name: string;
      rollNumber: string | null;
      department: string | null;
    };
    trip: {
      busId: string;
      routeId: string;
      date: string;
    };
  };
  requestedBy: {
    name: string;
    role: Role;
  };
}

export interface AdminIncident {
  id: string;
  tripId: string;
  busId: string;
  type: IncidentType;
  status: IncidentStatus | 'CANCELLED';
  description: string;
  escalationLevel: EscalationLevel;
  reportedAt: string;
  trip: {
    routeId: string;
    date: string;
  };
  bus: {
    number: string;
    plateNumber: string;
  };
  reportedBy: {
    name: string;
    role: Role;
  };
}

export interface AdminMessage {
  id: string;
  senderId: string;
  busId?: string | null;
  routeId?: string | null;
  tripId?: string | null;
  incidentId?: string | null;
  contextType?: AdminActionContextType | null;
  contextId?: string | null;
  type: AdminMessageType;
  body: string;
  isRead: boolean;
  priority: AdminMessagePriority;
  createdAt: string;
  sender: {
    name: string;
    role: string;
  };
}

export interface AdminMessageInput {
  body: string;
  priority?: AdminMessagePriority;
  type?: AdminMessageType;
  busId?: string;
  routeId?: string;
  context?: AdminActionContext;
}

export interface AdminLiveAlert {
  type: NotificationType;
  priority: number;
  summary: string;
  timestamp: number;
  tripId?: string;
  busId?: string;
  busNumber?: string;
  routeName?: string;
  metadata?: Record<string, unknown>;
}

export interface AdminAttendanceTrendPoint {
  date: string;
  label: string;
  expected: number;
  checkedIn: number;
  absent: number;
  attendanceRate: number;
}

export interface AdminAttendanceReportOverview {
  startDate: string;
  endDate: string;
  routeId?: string;
  routeName?: string | null;
  totalTrips: number;
  totalExpected: number;
  totalCheckedIn: number;
  totalAbsent: number;
  attendanceRate: number;
  trends: AdminAttendanceTrendPoint[];
}

export interface AdminReportStatus {
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  progress?: number;
  resultUrl?: string;
  error?: string;
  totalTripsAnalyzed?: number;
  summary?: AdminAttendanceReportOverview;
}

export interface AdminReportEnqueueResponse {
  jobId: string;
}

export interface AdminImportSessionSummary {
  id: string;
  type: string;
  totalRows: number;
  importedCount: number;
  failedCount: number;
  status: ImportSessionStatus;
  startedAt: string;
  completedAt: string | null;
}

export interface AdminImportSessionRow {
  id: string;
  rowNumber: number;
  status: ImportRowStatus;
  errorField: string | null;
  errorReason: string | null;
  rowData: Record<string, unknown>;
  userId: string | null;
}

export interface AdminImportSessionDetail extends AdminImportSessionSummary {
  rows: AdminImportSessionRow[];
}

export interface AdminPendingAuthUser {
  id: string;
  name: string;
  phone: string;
  authStatus: AuthStatus;
  authProvisionError: string | null;
}

export interface AdminStudentListItem {
  id: string;
  name: string;
  rollNumber: string | null;
  phone?: string;
  department: string | null;
  year: number | null;
  routeId?: string;
  stopId?: string;
  busNumber?: string;
  isActive: boolean;
  authStatus?: AuthStatus;
}

export interface AdminListResponse<T> {
  data: T[];
  pagination: Pagination;
}

export interface AdminRouteStopOption {
  stop: {
    id: string;
    name: string;
  };
}

export interface AdminRouteStopDetail {
  id: string;
  stopId: string;
  sequence: number;
  scheduledTimeMorning: number;
  scheduledTimeReturn: number;
  isActive: boolean;
  stop: {
    id: string;
    name: string;
    lat: number;
    lon: number;
  };
}

export interface AdminRouteSummary {
  id: string;
  name: string;
  area: string;
  isActive: boolean;
  updatedAt: string;
  activeDays?: string[];
  stops: AdminRouteStopDetail[];
}

export interface AdminStopCatalogItem {
  id: string;
  name: string;
  area: string | null;
  lat: number;
  lon: number;
  isActive: boolean;
}

export interface AdminBusListItem {
  id: string;
  number: string;
  plateNumber: string;
  capacity: number;
  isActive: boolean;
  assignments?: Array<{
    route: { name: string };
    driver: { name: string };
  }>;
}

export interface AdminDriverListItem {
  id: string;
  name: string;
  phone: string;
  licenseNumber: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface AdminSubstituteCandidate {
  busId: string;
  busNumber: string;
  plateNumber: string;
  driverId: string | null;
  driverName: string | null;
  routeId: string | null;
  routeName: string | null;
  isCurrentlyActive: boolean;
}

export interface AdminImportPreviewError {
  rowNumber: number;
  rowData: Record<string, unknown>;
  status: string;
  errorReason: string | null;
}

export interface AdminImportPreviewResponse {
  sessionId: string;
  validCount: number;
  errorCount: number;
  newStudents: number;
  updatedStudents: number;
  errors: AdminImportPreviewError[];
}

export interface AdminImportExecuteResponse {
  success: boolean;
  imported: number;
  failed: number;
}

export interface AdminGpsOutageItem {
  tripId: string;
  tripStatus: 'ACTIVE' | 'COMPLETED';
  queueStatus: 'ACTIVE_OUTAGE' | 'OUTAGE_REVIEW';
  gpsStatus: 'OFFLINE' | 'RECOVERED';
  busId: string;
  busNumber: string;
  routeId: string;
  routeName: string;
  startedAt: string | null;
  endedAt: string | null;
  outageSince: string | null;
  outageDurationMinutes: number | null;
  expectedCount: number;
  boardedCount: number;
  pendingStudents: number;
  pendingOutageCorrections: number;
  delegateActive: boolean;
  escalationScheduled: boolean;
  outageWindowOpen: boolean;
}

export interface AdminGpsOutageQueueResponse {
  activeOutages: AdminGpsOutageItem[];
  reviewQueue: AdminGpsOutageItem[];
  generatedAt: string;
}

export interface AdminCoordinatorOverrideResponse {
  success: boolean;
  count: number;
}

export interface AdminGpsOutageCorrection {
  id: string;
  reason: string;
  createdAt: string;
  requestedBy: {
    id: string;
    name: string;
    rollNumber: string | null;
    department: string | null;
  };
  attendance: {
    id: string;
    trip: {
      id: string;
      routeId: string;
      bus: {
        number: string;
        plateNumber: string;
      };
    };
  };
  metadata: Record<string, unknown> | null;
}

export interface AdminAuditLogEntry {
  id: string;
  actorType: string;
  actorId: string;
  action: string;
  routeIds: string[];
  entityType: string | null;
  entityId: string | null;
  before: unknown;
  after: unknown;
  meta: unknown;
  ip: string | null;
  createdAt: string;
}

export interface AdminAuditLogResponse {
  total: number;
  page: number;
  limit: number;
  entries: AdminAuditLogEntry[];
}
