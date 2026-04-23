/**
 * Admin Authentication Type Definitions & Constants
 * Single source of truth for all auth types and constants
 */

// ─── ROLES ────────────────────────────────────────────────

export enum AdminRole {
  SUPER_ADMIN = 'super_admin',
  ADMIN = 'admin',
  SUPPORT = 'support',
  ANALYST = 'analyst',
  VIEWER = 'viewer',
}

// ─── PERMISSIONS ──────────────────────────────────────────

export enum AdminPermission {
  // User management
  MANAGE_ADMINS = 'manage_admins',
  CREATE_ADMIN = 'create_admin',
  EDIT_ADMIN = 'edit_admin',
  DELETE_ADMIN = 'delete_admin',
  VIEW_ADMIN_LOGS = 'view_admin_logs',

  // Driver management
  MANAGE_DRIVERS = 'manage_drivers',
  VIEW_DRIVERS = 'view_drivers',
  EDIT_DRIVERS = 'edit_drivers',
  DELETE_DRIVERS = 'delete_drivers',

  // Bus management
  MANAGE_BUSES = 'manage_buses',
  VIEW_BUSES = 'view_buses',
  EDIT_BUSES = 'edit_buses',

  // Route management
  MANAGE_ROUTES = 'manage_routes',
  VIEW_ROUTES = 'view_routes',
  EDIT_ROUTES = 'edit_routes',

  // Attendance
  VIEW_ATTENDANCE = 'view_attendance',
  EDIT_ATTENDANCE = 'edit_attendance',
  EXPORT_ATTENDANCE = 'export_attendance',

  // Reports
  VIEW_REPORTS = 'view_reports',
  EXPORT_REPORTS = 'export_reports',

  // Settings
  MANAGE_SETTINGS = 'manage_settings',
  MANAGE_MFA = 'manage_mfa',
  CHANGE_PASSWORD = 'change_password',
  VIEW_SECURITY_LOGS = 'view_security_logs',
}

// ─── PERMISSION MAPPING ───────────────────────────────────

export const PERMISSION_MAP: Record<AdminRole, AdminPermission[]> = {
  [AdminRole.SUPER_ADMIN]: [
    // All permissions
    AdminPermission.MANAGE_ADMINS,
    AdminPermission.CREATE_ADMIN,
    AdminPermission.EDIT_ADMIN,
    AdminPermission.DELETE_ADMIN,
    AdminPermission.VIEW_ADMIN_LOGS,
    AdminPermission.MANAGE_DRIVERS,
    AdminPermission.VIEW_DRIVERS,
    AdminPermission.EDIT_DRIVERS,
    AdminPermission.DELETE_DRIVERS,
    AdminPermission.MANAGE_BUSES,
    AdminPermission.VIEW_BUSES,
    AdminPermission.EDIT_BUSES,
    AdminPermission.MANAGE_ROUTES,
    AdminPermission.VIEW_ROUTES,
    AdminPermission.EDIT_ROUTES,
    AdminPermission.VIEW_ATTENDANCE,
    AdminPermission.EDIT_ATTENDANCE,
    AdminPermission.EXPORT_ATTENDANCE,
    AdminPermission.VIEW_REPORTS,
    AdminPermission.EXPORT_REPORTS,
    AdminPermission.MANAGE_SETTINGS,
    AdminPermission.MANAGE_MFA,
    AdminPermission.CHANGE_PASSWORD,
    AdminPermission.VIEW_SECURITY_LOGS,
  ],

  [AdminRole.ADMIN]: [
    AdminPermission.MANAGE_DRIVERS,
    AdminPermission.VIEW_DRIVERS,
    AdminPermission.EDIT_DRIVERS,
    AdminPermission.MANAGE_BUSES,
    AdminPermission.VIEW_BUSES,
    AdminPermission.EDIT_BUSES,
    AdminPermission.MANAGE_ROUTES,
    AdminPermission.VIEW_ROUTES,
    AdminPermission.EDIT_ROUTES,
    AdminPermission.VIEW_ATTENDANCE,
    AdminPermission.EDIT_ATTENDANCE,
    AdminPermission.EXPORT_ATTENDANCE,
    AdminPermission.VIEW_REPORTS,
    AdminPermission.EXPORT_REPORTS,
    AdminPermission.CHANGE_PASSWORD,
    AdminPermission.VIEW_SECURITY_LOGS,
  ],

  [AdminRole.SUPPORT]: [
    AdminPermission.VIEW_DRIVERS,
    AdminPermission.VIEW_BUSES,
    AdminPermission.VIEW_ROUTES,
    AdminPermission.VIEW_ATTENDANCE,
    AdminPermission.EDIT_ATTENDANCE,
    AdminPermission.VIEW_REPORTS,
    AdminPermission.CHANGE_PASSWORD,
    AdminPermission.VIEW_SECURITY_LOGS,
  ],

  [AdminRole.ANALYST]: [
    AdminPermission.VIEW_DRIVERS,
    AdminPermission.VIEW_BUSES,
    AdminPermission.VIEW_ROUTES,
    AdminPermission.VIEW_ATTENDANCE,
    AdminPermission.VIEW_REPORTS,
    AdminPermission.EXPORT_ATTENDANCE,
    AdminPermission.EXPORT_REPORTS,
    AdminPermission.CHANGE_PASSWORD,
  ],

  [AdminRole.VIEWER]: [
    AdminPermission.VIEW_DRIVERS,
    AdminPermission.VIEW_BUSES,
    AdminPermission.VIEW_ROUTES,
    AdminPermission.VIEW_ATTENDANCE,
    AdminPermission.VIEW_REPORTS,
  ],
};

// ─── TOKENS & SESSIONS ────────────────────────────────────

export interface AdminJWTPayload {
  sub: string; // adminId
  sessionId: string;
  aud: string; // "admin-api"
  role: AdminRole;
  permissions: AdminPermission[];
  fpHash: string; // Device fingerprint hash
  iss: string;
  iat: number;
  exp: number;
  jti: string; // Token ID for revocation tracking
  type: 'access'; // vs 'step-up'
}

export interface AdminStepUpToken {
  sub: string; // adminId
  sessionId: string;
  type: 'step_up';
  iss: string;
  iat: number;
  exp: number; // 5 minutes
  jti: string;
}

export interface AdminSession {
  adminId: string;
  sessionId: string;
  role: AdminRole;
  permissions: AdminPermission[];
  fpHash: string; // Stored fingerprint hash for origin verification
  createdAt: number; // Absolute: session cannot exceed 24 hours
  absoluteDeadline: number;
  lastActivity: number; // Rolling: activity extends session up to absolute deadline
  needsReauth: boolean; // Flag: whether admin needs to step-up
  ip: string;
  ipCountry: string;
}

export interface AdminRefreshTokenRecord {
  id: string;
  adminId: string;
  tokenHash: string;
  familyId: string; // For rotation & reuse detection
  sessionId: string;
  absoluteExp: bigint;
  createdAt: Date;
  isRevoked: boolean;
  revokeReason?: string | null;
  lastUsedAt?: Date | null;
  deviceFpHash: string;
  ipAtCreation: string;
}

// ─── DEVICE FINGERPRINTING ────────────────────────────────

export interface FingerprintSignalsClient {
  userAgent: string;
  acceptLanguage: string;
  timezone: string;
  screenRes: string; // "1920x1080"
  colorDepth: number; // 24 or 32
  platform: string; // "MacIntel", "Win32", etc.
  hardwareConcurrency: number; // CPU cores
  deviceMemory?: number; // GB (optional, not all browsers)
}

export interface FingerprintSignalsServer {
  ip: string;
  ipCountry: string; // 2-letter code
  ipASN: string; // AS number
}

export type FingerprintSignals = FingerprintSignalsClient & FingerprintSignalsServer;

export interface FingerprintDriftResult {
  verdict: 'low' | 'medium' | 'high'; // Risk level
  driftScore: number; // 0-100
  changes: Record<string, string | number>; // What changed
  requiresStepUp: boolean; // Should trigger re-auth
}

// ─── ERRORS ───────────────────────────────────────────────

export class AuthError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

// ─── AUDIT EVENTS ─────────────────────────────────────────

export enum AdminAuthEventType {
  LOGIN = 'login',
  LOGIN_FAILED = 'login_failed',
  LOGIN_FAILED_RATE_LIMIT = 'login_failed_rate_limit',
  LOGOUT = 'logout',
  LOGOUT_ALL = 'logout_all',
  MFA_VERIFIED = 'mfa_verified',
  MFA_FAILED = 'mfa_failed',
  STEP_UP = 'step_up',
  STEP_UP_FAILED = 'step_up_failed',
  TOKEN_REFRESH = 'token_refresh',
  TOKEN_REVOKED = 'token_revoked',
  TOKEN_REUSE_DETECTED = 'token_reuse_detected',
  ACCOUNT_SUSPENDED = 'account_suspended',
  PASSWORD_CHANGED = 'password_changed',
  PASSWORD_RESET = 'password_reset',
  MFA_ENABLED = 'mfa_enabled',
  MFA_DISABLED = 'mfa_disabled',
  DEVICE_ADDED = 'device_added',
  DEVICE_REMOVED = 'device_removed',
  PERMISSION_CHANGED = 'permission_changed',
  FINGERPRINT_MISMATCH = 'fingerprint_mismatch',
  SESSION_EXPIRED = 'session_expired',
  ACCOUNT_LOCKED = 'account_locked',
  ACCOUNT_UNLOCKED = 'account_unlocked',
}

// ─── ERROR RESPONSES (STANDARDIZED MESSAGES) ──────────────

export const AUTH_ERROR_RESPONSES = {
  INVALID_CREDENTIALS: {
    code: 'INVALID_CREDENTIALS',
    message: 'Invalid email or password.',
  },
  INVALID_TOTP: {
    code: 'INVALID_TOTP',
    message: 'Invalid or expired MFA code.',
  },
  ACCOUNT_SUSPENDED: {
    code: 'ACCOUNT_SUSPENDED',
    message: 'This account has been suspended.',
  },
  UNAUTHORIZED: {
    code: 'UNAUTHORIZED',
    message: 'Unauthorized. Please log in.',
  },
  SESSION_EXPIRED: {
    code: 'SESSION_EXPIRED',
    message: 'Session has expired. Please log in again.',
  },
  RATE_LIMITED: {
    code: 'RATE_LIMITED',
    message: 'Too many attempts. Please try again later.',
  },
  ACCOUNT_LOCKED: {
    code: 'ACCOUNT_LOCKED',
    message: 'Account temporarily locked. Try again later.',
  },
  PERMISSION_DENIED: {
    code: 'PERMISSION_DENIED',
    message: 'You do not have permission to perform this action.',
  },
  MFA_NOT_ENABLED: {
    code: 'MFA_NOT_ENABLED',
    message: 'MFA is not enabled on this account.',
  },
  WEAK_PASSWORD: {
    code: 'WEAK_PASSWORD',
    message: 'Password does not meet security requirements.',
  },
};

// ─── CONSTANTS ────────────────────────────────────────────

export const CONSTANTS = {
  // Token lifetimes
  ACCESS_TOKEN_TTL_MINUTES: 15,
  STEP_UP_TOKEN_TTL_MINUTES: 5,
  REFRESH_TOKEN_FAMILY_TTL_HOURS: 24,
  SESSION_ABSOLUTE_TTL_HOURS: 24,
  SESSION_IDLE_TTL_MINUTES: 60,

  // Rate limits (§11.1)
  LOGIN_ATTEMPTS_LIMIT: 10,
  LOGIN_ATTEMPTS_WINDOW_MINUTES: 60,
  LOGIN_LOCKOUT_DURATION_MINUTES: 30,

  REFRESH_ATTEMPTS_LIMIT: 30,
  REFRESH_ATTEMPTS_WINDOW_MINUTES: 60,

  STEPUP_ATTEMPTS_LIMIT: 5,
  STEPUP_ATTEMPTS_WINDOW_MINUTES: 15,

  // MFA
  TOTP_WINDOW: 1, // Allow 1 time window (±30s)
  BACKUP_CODE_COUNT: 10,

  // Fingerprinting thresholds (§4.2)
  FP_DRIFT_LOW: 20, // score < 20: low risk
  FP_DRIFT_MEDIUM: 50, // 20-50: medium risk
  FP_DRIFT_HIGH_THRESHOLD: 50, // > 50: high risk, requires step-up

  // Password
  PASSWORD_MIN_LENGTH: 12,
  PASSWORD_MAX_LENGTH: 128,
  PASSWORD_REQUIRE_UPPERCASE: true,
  PASSWORD_REQUIRE_LOWERCASE: true,
  PASSWORD_REQUIRE_NUMBERS: true,
  PASSWORD_REQUIRE_SPECIAL: true,

  // Crypto
  ITERATIONS: 100000, // Argon2 or PBKDF2 iterations
  COST_FACTOR: 3, // Argon2 cost
  TIME_COST: 4, // Argon2 time cost
  MEMORY_COST: 65536, // Argon2 memory (64MB)
};

// ─── MFA SETUP ────────────────────────────────────────────

export interface MFASetupState {
  secret: string; // Unencrypted (TOTP secret)
  qrCode: string; // Data URL
  backupCodes: string[]; // Plaintext (shown once)
  expiresAt: Date; // Setup code expires after 10 minutes
}

export interface AdminUser {
  id: string;
  email: string;
  passwordHash: string;
  role: AdminRole;
  mfaEnabled: boolean;
  mfaSecretEncrypted?: string; // Encrypted only if enabled
  backupCodesHash?: string[];
  isActive: boolean;
  isSuspended: boolean;
  deactivatedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt?: Date;
  lastLoginIp?: string;
  lastLoginUserAgent?: string;
  failedLoginAttempts: number;
  lastFailedLoginAt?: Date;
  sessionVersion: number; // Bumped on password change / logout-all
}
