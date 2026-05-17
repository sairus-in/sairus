/**
 * COMPLETE ERROR CODE REGISTRY
 *
 * Every error code used anywhere in the system must be listed here.
 * Adding a new error = adding a line here + a message below + correct HTTP status.
 * This makes the error surface visible and auditable.
 */

export type ErrorCode =
  // ─── Authentication (401) ──────────────────────────────────────────────────
  | 'UNAUTHORIZED'
  | 'TOKEN_EXPIRED'
  | 'INVALID_TOKEN'
  | 'INVALID_TOKEN_STRUCTURE'
  | 'WRONG_TOKEN_TYPE'
  | 'SESSION_REVOKED'
  | 'STALE_SESSION'
  | 'DEVICE_MISMATCH'
  | 'FORCED_RELOGIN_REQUIRED'
  | 'INVALID_DEVICE_ID'
  // ─── Authorization (403) ───────────────────────────────────────────────────
  | 'FORBIDDEN'
  | 'ACCOUNT_DISABLED'
  | 'ACCOUNT_SUSPENDED'
  | 'MFA_REQUIRED'
  | 'STEP_UP_REQUIRED'
  | 'TRIP_ACCESS_DENIED'
  | 'SCOPE_VIOLATION'
  | 'ROUTE_ACCESS_DENIED'
  | 'DEVICE_ID_REQUIRED'
  | 'NO_COORDINATOR_SCOPE'
  | 'REPORT_OWNERSHIP_REQUIRED'
  | 'NOT_YOUR_TRIP'
  | 'ROLE_NOT_AUTHORIZED'
  | 'NOT_NEAR_BUS'
  | 'NO_POSITION_AND_NO_ROUTE_ASSOCIATION'
  | 'CSRF_VALIDATION_FAILED'
  // ─── Validation (400) ──────────────────────────────────────────────────────
  | 'VALIDATION_ERROR'
  | 'INVALID_IDEMPOTENCY_KEY'
  | 'INVALID_MFA_CODE'
  | 'INVALID_PASSWORD'
  | 'MISSING_CLOUD_TASKS_HEADER'
  | 'INVALID_COORDINATES'
  | 'INVALID_QR_CODE'
  | 'QR_INVALID'
  | 'QR_EXPIRED'
  | 'INVALID_MESSAGE_PAYLOAD'
  | 'INVALID_TRIP_ID'
  | 'MISSING_TRIP_ID'
  | 'MISSING_BUS_ID'
  | 'INVALID_DATA'
  | 'TRIP_CANNOT_START'
  | 'ROUTE_CONTEXT_REQUIRED'
  | 'ENDPOINT_DEPRECATED'
  // ─── Not Found (404) ───────────────────────────────────────────────────────
  | 'USER_NOT_FOUND'
  | 'TRIP_NOT_FOUND'
  | 'ROUTE_NOT_FOUND'
  | 'STOP_NOT_FOUND'
  | 'BUS_NOT_FOUND'
  | 'DRIVER_NOT_FOUND'
  | 'ATTENDANCE_NOT_FOUND'
  | 'CORRECTION_NOT_FOUND'
  | 'INCIDENT_NOT_FOUND'
  | 'IMPORT_SESSION_NOT_FOUND'
  | 'REPORT_NOT_FOUND'
  | 'RESOURCE_NOT_FOUND'
  // ─── Conflict (409) ────────────────────────────────────────────────────────
  | 'ALREADY_CHECKED_IN'
  | 'ROUTE_MODIFIED_CONCURRENTLY'
  | 'DUPLICATE_REQUEST'
  | 'RESOURCE_CONFLICT'
  | 'QR_ALREADY_USED'
  | 'PROCESSING'
  | 'CORRECTION_ALREADY_RESOLVED'
  | 'DELEGATE_ALREADY_ACTIVE'
  | 'ACTIVATION_IN_PROGRESS'
  // ─── Rate Limiting (429) ───────────────────────────────────────────────────
  | 'RATE_LIMITED'
  | 'TOO_MANY_ATTEMPTS'
  // ─── Business Logic (422) ──────────────────────────────────────────────────
  | 'INCIDENT_REPORT_FAILED'
  | 'GPS_PING_REJECTED'
  | 'STUDENT_ASSIGNMENT_FAILED'
  | 'BULK_ASSIGN_FAILED'
  | 'IMPORT_VALIDATION_FAILED'
  | 'REPORT_ARTIFACT_NOT_FOUND'
  | 'JOB_ALREADY_PROCESSED'
  | 'OPERATION_FAILED'
  | 'TRIP_NOT_ACTIVE'
  | 'TRIP_MISMATCH'
  | 'NO_ROUTE_ASSIGNMENT'
  | 'WRONG_BUS'
  | 'TOO_FAR'
  | 'TRIP_NOT_ELIGIBLE'
  | 'WINDOW_CLOSED'
  | 'ALREADY_RESOLVED'
  | 'INCIDENT_NOT_ACTIVE'
  | 'ALTERNATE_BUS_NOT_AVAILABLE'
  | 'ALTERNATE_BUS_MATCHES_CURRENT_BUS'
  | 'ALTERNATE_BUS_BUSY'
  | 'REPORT_OUTSIDE_SCOPE'
  | 'ADMIN_NOT_FOUND'
  | 'BUS_GPS_NOT_OFFLINE'
  | 'BULK_IMPORT_FAILED'
  | 'STUDENT_UPDATE_FAILED'
  // ─── Attendance Errors (404) ──────────────────────────────────────────────
  | 'ATTENDANCE_LOG_NOT_FOUND'
  | 'LOG_OR_TRIP_NOT_FOUND'
  | 'LOG_NOT_FOUND'
  | 'TRIP_OR_ASSIGNMENT_NOT_FOUND'
  // ─── Database Errors (500) ─────────────────────────────────────────────────
  | 'DATABASE_ERROR'
  // ─── General Errors ─────────────────────────────────────────────────────────
  | 'NOT_FOUND'
  | 'INVALID_REFERENCE'
  | 'MISSING_INCIDENT_ID'
  | 'MISSING_EXPECTED_STATUS'
  | 'CONFLICT'
  // ─── Server (500) ──────────────────────────────────────────────────────────
  | 'ACTOR_NOT_RESOLVED'
  | 'INTERNAL_SERVER_ERROR';

/**
 * Human-readable messages for every error code.
 * These are the messages returned to API consumers.
 * Keep them helpful but do not leak internal details.
 */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  // Auth
  UNAUTHORIZED: 'Authentication required.',
  TOKEN_EXPIRED: 'Your session has expired. Please log in again.',
  INVALID_TOKEN: 'Invalid authentication token.',
  INVALID_TOKEN_STRUCTURE: 'Token structure is malformed.',
  WRONG_TOKEN_TYPE: 'This token cannot be used for this endpoint.',
  SESSION_REVOKED: 'Your session has been revoked. Please log in again.',
  STALE_SESSION: 'Session version mismatch. Please log in again.',
  DEVICE_MISMATCH: 'This request must come from your registered device.',
  FORCED_RELOGIN_REQUIRED: 'An administrator has required you to log in again.',
  INVALID_DEVICE_ID: 'Device ID is invalid or missing.',
  // Authorization
  FORBIDDEN: 'You do not have permission to perform this action.',
  ACCOUNT_DISABLED: 'This account has been disabled.',
  ACCOUNT_SUSPENDED: 'This account has been suspended. Contact another administrator if you need access restored.',
  MFA_REQUIRED: 'Multi-factor authentication is required. Please enable MFA to continue.',
  STEP_UP_REQUIRED: 'Recent step-up authentication is required for this action.',
  TRIP_ACCESS_DENIED: 'You do not have access to this trip.',
  SCOPE_VIOLATION: 'This resource is outside your assigned scope.',
  ROUTE_ACCESS_DENIED: 'You do not have access to this route.',
  // Validation
  VALIDATION_ERROR: 'Request validation failed.',
  INVALID_IDEMPOTENCY_KEY: 'Idempotency-Key header is invalid.',
  INVALID_MFA_CODE: 'MFA code is incorrect.',
  INVALID_PASSWORD: 'Password is incorrect.',
  MISSING_CLOUD_TASKS_HEADER: 'Required Cloud Tasks header is missing.',
  INVALID_COORDINATES: 'GPS coordinates are invalid or not yet acquired.',
  INVALID_QR_CODE: 'QR code is invalid or expired.',
  // Not Found
  USER_NOT_FOUND: 'User not found.',
  TRIP_NOT_FOUND: 'Trip not found.',
  ROUTE_NOT_FOUND: 'Route not found.',
  STOP_NOT_FOUND: 'Stop not found.',
  BUS_NOT_FOUND: 'Bus not found.',
  DRIVER_NOT_FOUND: 'Driver not found.',
  ATTENDANCE_NOT_FOUND: 'Attendance record not found.',
  CORRECTION_NOT_FOUND: 'Correction request not found.',
  INCIDENT_NOT_FOUND: 'Incident not found.',
  IMPORT_SESSION_NOT_FOUND: 'Import session not found.',
  REPORT_NOT_FOUND: 'Report not found.',
  RESOURCE_NOT_FOUND: 'Resource not found.',
  // Conflict
  ALREADY_CHECKED_IN: 'You have already checked in for this trip.',
  ROUTE_MODIFIED_CONCURRENTLY: 'This route was modified by another user. Please refresh and try again.',
  DUPLICATE_REQUEST: 'This request has already been processed.',
  RESOURCE_CONFLICT: 'Resource conflict. Please try again.',
  QR_ALREADY_USED: 'This QR code has already been used.',
  PROCESSING: 'This request is still being processed. Please try again.',
  CORRECTION_ALREADY_RESOLVED: 'This correction has already been resolved.',
  DELEGATE_ALREADY_ACTIVE: 'A delegate is already active for this trip.',
  ACTIVATION_IN_PROGRESS: 'Activation is already in progress.',
  // Rate Limiting
  RATE_LIMITED: 'Too many requests. Please wait before trying again.',
  TOO_MANY_ATTEMPTS: 'Too many failed attempts. Please wait before trying again.',
  // Business Logic
  INCIDENT_REPORT_FAILED: 'Failed to submit incident report.',
  GPS_PING_REJECTED: 'GPS ping rejected.',
  STUDENT_ASSIGNMENT_FAILED: 'Failed to assign student to route.',
  BULK_ASSIGN_FAILED: 'Bulk assignment failed.',
  IMPORT_VALIDATION_FAILED: 'Import validation failed.',
  REPORT_ARTIFACT_NOT_FOUND: 'Report file not found or has expired.',
  JOB_ALREADY_PROCESSED: 'This job has already been processed.',
  OPERATION_FAILED: 'Operation failed. Please try again.',
  TRIP_NOT_ACTIVE: 'This trip is not currently active.',
  TRIP_MISMATCH: 'The QR code does not match this trip.',
  NO_ROUTE_ASSIGNMENT: 'No route assignment found for this student.',
  WRONG_BUS: 'You are not assigned to this bus for this trip.',
  TOO_FAR: 'You are too far from the bus location.',
  TRIP_NOT_ELIGIBLE: 'This trip is not eligible for this operation.',
  WINDOW_CLOSED: 'The operation window for this trip has closed.',
  ALREADY_RESOLVED: 'This item has already been resolved.',
  INCIDENT_NOT_ACTIVE: 'This incident is not active.',
  ALTERNATE_BUS_NOT_AVAILABLE: 'The alternate bus is not available.',
  ALTERNATE_BUS_MATCHES_CURRENT_BUS: 'The alternate bus cannot be the same as the current bus.',
  ALTERNATE_BUS_BUSY: 'The alternate bus is currently busy.',
  REPORT_OUTSIDE_SCOPE: 'This report is outside your assigned scope.',
  ADMIN_NOT_FOUND: 'Administrator not found.',
  BUS_GPS_NOT_OFFLINE: 'The bus GPS is not in offline mode.',
  BULK_IMPORT_FAILED: 'Bulk import operation failed.',
  STUDENT_UPDATE_FAILED: 'Failed to update student information.',
  QR_INVALID: 'The QR code is invalid.',
  QR_EXPIRED: 'The QR code is expired.',
  // Attendance
  ATTENDANCE_LOG_NOT_FOUND: 'Attendance log not found.',
  LOG_OR_TRIP_NOT_FOUND: 'Log or trip not found.',
  LOG_NOT_FOUND: 'Log not found.',
  TRIP_OR_ASSIGNMENT_NOT_FOUND: 'Trip or assignment not found.',
  // Database
  DATABASE_ERROR: 'Database operation failed.',
  // General
  NOT_FOUND: 'Resource not found.',
  INVALID_REFERENCE: 'Invalid reference provided.',
  MISSING_INCIDENT_ID: 'Incident ID is required.',
  MISSING_EXPECTED_STATUS: 'Expected status is required.',
  CONFLICT: 'Resource conflict occurred.',
  INVALID_MESSAGE_PAYLOAD: 'The message payload is invalid.',
  INVALID_TRIP_ID: 'The trip ID is invalid.',
  MISSING_TRIP_ID: 'Trip ID is required.',
  MISSING_BUS_ID: 'Bus ID is required.',
  INVALID_DATA: 'The provided data is invalid.',
  TRIP_CANNOT_START: 'This trip cannot be started.',
  ROUTE_CONTEXT_REQUIRED: 'Route context is required for this operation.',
  ENDPOINT_DEPRECATED: 'This endpoint is deprecated and no longer supported.',
  DEVICE_ID_REQUIRED: 'Device ID is required.',
  NO_COORDINATOR_SCOPE: 'No coordinator scope assigned.',
  REPORT_OWNERSHIP_REQUIRED: 'You do not own this report.',
  NOT_YOUR_TRIP: 'This trip does not belong to you.',
  ROLE_NOT_AUTHORIZED: 'Your role is not authorized for this operation.',
  NOT_NEAR_BUS: 'You are not near the bus location.',
  NO_POSITION_AND_NO_ROUTE_ASSOCIATION: 'No location data and no route association found.',
  CSRF_VALIDATION_FAILED: 'CSRF validation failed.',
  // Server
  ACTOR_NOT_RESOLVED: 'Authenticated actor was not resolved for this request.',
  INTERNAL_SERVER_ERROR: 'An unexpected error occurred.',
};

/**
 * Codes where the client should automatically retry after a delay.
 */
export const RETRYABLE_CODES = new Set<ErrorCode>([
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'OPERATION_FAILED',
]);

/**
 * Map error codes to their canonical HTTP status code.
 * Used by the global error handler.
 */
export const ERROR_STATUS_CODES: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  TOKEN_EXPIRED: 401,
  INVALID_TOKEN: 401,
  INVALID_TOKEN_STRUCTURE: 401,
  WRONG_TOKEN_TYPE: 401,
  SESSION_REVOKED: 401,
  STALE_SESSION: 401,
  DEVICE_MISMATCH: 403,
  FORCED_RELOGIN_REQUIRED: 401,
  INVALID_DEVICE_ID: 400,
  FORBIDDEN: 403,
  ACCOUNT_DISABLED: 403,
  ACCOUNT_SUSPENDED: 403,
  MFA_REQUIRED: 403,
  STEP_UP_REQUIRED: 403,
  TRIP_ACCESS_DENIED: 403,
  SCOPE_VIOLATION: 403,
  ROUTE_ACCESS_DENIED: 403,
  DEVICE_ID_REQUIRED: 403,
  NO_COORDINATOR_SCOPE: 403,
  REPORT_OWNERSHIP_REQUIRED: 403,
  NOT_YOUR_TRIP: 403,
  ROLE_NOT_AUTHORIZED: 403,
  NOT_NEAR_BUS: 403,
  NO_POSITION_AND_NO_ROUTE_ASSOCIATION: 403,
  CSRF_VALIDATION_FAILED: 403,
  VALIDATION_ERROR: 400,
  INVALID_IDEMPOTENCY_KEY: 400,
  INVALID_MFA_CODE: 400,
  INVALID_PASSWORD: 401,
  MISSING_CLOUD_TASKS_HEADER: 403,
  INVALID_COORDINATES: 400,
  INVALID_QR_CODE: 400,
  QR_INVALID: 400,
  QR_EXPIRED: 400,
  INVALID_MESSAGE_PAYLOAD: 400,
  INVALID_TRIP_ID: 400,
  MISSING_TRIP_ID: 400,
  MISSING_BUS_ID: 400,
  INVALID_DATA: 400,
  TRIP_CANNOT_START: 400,
  ROUTE_CONTEXT_REQUIRED: 400,
  ENDPOINT_DEPRECATED: 410,
  USER_NOT_FOUND: 404,
  TRIP_NOT_FOUND: 404,
  ROUTE_NOT_FOUND: 404,
  STOP_NOT_FOUND: 404,
  BUS_NOT_FOUND: 404,
  DRIVER_NOT_FOUND: 404,
  ATTENDANCE_NOT_FOUND: 404,
  CORRECTION_NOT_FOUND: 404,
  INCIDENT_NOT_FOUND: 404,
  IMPORT_SESSION_NOT_FOUND: 404,
  REPORT_NOT_FOUND: 404,
  RESOURCE_NOT_FOUND: 404,
  ALREADY_CHECKED_IN: 409,
  ROUTE_MODIFIED_CONCURRENTLY: 409,
  DUPLICATE_REQUEST: 409,
  RESOURCE_CONFLICT: 409,
  QR_ALREADY_USED: 409,
  PROCESSING: 409,
  CORRECTION_ALREADY_RESOLVED: 409,
  DELEGATE_ALREADY_ACTIVE: 409,
  ACTIVATION_IN_PROGRESS: 409,
  RATE_LIMITED: 429,
  TOO_MANY_ATTEMPTS: 429,
  INCIDENT_REPORT_FAILED: 422,
  GPS_PING_REJECTED: 422,
  STUDENT_ASSIGNMENT_FAILED: 422,
  BULK_ASSIGN_FAILED: 422,
  IMPORT_VALIDATION_FAILED: 422,
  REPORT_ARTIFACT_NOT_FOUND: 404,
  JOB_ALREADY_PROCESSED: 200,
  OPERATION_FAILED: 422,
  TRIP_NOT_ACTIVE: 422,
  TRIP_MISMATCH: 422,
  NO_ROUTE_ASSIGNMENT: 422,
  WRONG_BUS: 422,
  TOO_FAR: 422,
  TRIP_NOT_ELIGIBLE: 422,
  WINDOW_CLOSED: 422,
  ALREADY_RESOLVED: 422,
  INCIDENT_NOT_ACTIVE: 422,
  ALTERNATE_BUS_NOT_AVAILABLE: 422,
  ALTERNATE_BUS_MATCHES_CURRENT_BUS: 422,
  ALTERNATE_BUS_BUSY: 422,
  REPORT_OUTSIDE_SCOPE: 422,
  ADMIN_NOT_FOUND: 404,
  BUS_GPS_NOT_OFFLINE: 422,
  BULK_IMPORT_FAILED: 422,
  STUDENT_UPDATE_FAILED: 422,
  // Attendance
  ATTENDANCE_LOG_NOT_FOUND: 404,
  LOG_OR_TRIP_NOT_FOUND: 404,
  LOG_NOT_FOUND: 404,
  TRIP_OR_ASSIGNMENT_NOT_FOUND: 404,
  // Database
  DATABASE_ERROR: 500,
  // General
  NOT_FOUND: 404,
  INVALID_REFERENCE: 400,
  MISSING_INCIDENT_ID: 400,
  MISSING_EXPECTED_STATUS: 400,
  CONFLICT: 409,
  ACTOR_NOT_RESOLVED: 500,
  INTERNAL_SERVER_ERROR: 500,
};
