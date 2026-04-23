/**
 * Admin Authentication System — Complete Type Definitions
 * Implements all 16 sections of admin-auth-system.md specification
 * 
 * This file is the single source of truth for all auth-related types.
 * Never duplicate types across modules.
 */

// ─── TOKEN TYPES & PAYLOADS (§2) ──────────────────────

export enum TokenType {
  ACCESS = 'ACCESS',
  REFRESH = 'REFRESH',
  STEP_UP = 'STEP_UP',
  INVITE = 'INVITE',
}

/**
 * Access Token JWT Payload (15 minute lifetime)
 * §2.2 specification compliance
 */
export interface AdminJWTPayload {
  sub: string;           // admin user ID (UUID)
  sessionId: string;     // links to Redis session record
  role: AdminRole;       // SUPER_ADMIN | ROUTE_MANAGER | VIEWER
  permissions: string[]; // fine-grained e.g. ["routes:write", "admins:suspend"]
  fpHash: string;        // device fingerprint hash (§4.2)
  iat: number;           // issued at (UNIX timestamp)
  exp: number;           // expires at (iat + 15 min)
  jti: string;           // unique token ID for blocklisting
  type: TokenType.ACCESS;
}

/**
 * Step-Up Token Payload (5 minute lifetime)
 * Used for sensitive operations requiring recent password confirmation
 * §6.2 specification
 */
export interface StepUpTokenPayload {
  sub: string;           // admin user ID
  sessionId: string;     // must match current session
  type: TokenType.STEP_UP;
  iat: number;
  exp: number;           // iat + 5 minutes
  jti: string;           // unique for blocklisting
}

/**
 * Invite Token Payload (48 hour lifetime)
 * §13.1 Admin invite flow
 */
export interface InviteTokenPayload {
  email: string;
  role: AdminRole;
  invitedBy: string;     // admin user ID who sent invite
  type: TokenType.INVITE;
  iat: number;
  exp: number;           // iat + 48 hours
  jti: string;
}

// ─── ROLE & PERMISSION MODEL (§5) ──────────────────────

export enum AdminRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ROUTE_MANAGER = 'ROUTE_MANAGER',
  VIEWER = 'VIEWER',
}

/**
 * Permission strings for fine-grained access control
 * Used in permission matrix (§5.2)
 */
export const PERMISSION_MAP: Record<AdminRole, string[]> = {
  [AdminRole.SUPER_ADMIN]: [
    'routes:read',
    'routes:write',
    'routes:delete',
    'schedules:read',
    'schedules:write',
    'schedules:delete',
    'admins:read',
    'admins:invite',
    'admins:suspend',
    'admins:unsuspend',
    'audit_logs:read',
    'config:read',
    'config:write',
    'bulk_operations:execute',
  ],
  [AdminRole.ROUTE_MANAGER]: [
    'routes:read',
    'routes:write',
    'routes:delete',
    'schedules:read',
    'schedules:write',
    'schedules:delete',
    'bulk_operations:execute',
  ],
  [AdminRole.VIEWER]: [
    'routes:read',
    'schedules:read',
  ],
};

/**
 * Actions requiring step-up authentication (§6)
 */
export const STEP_UP_REQUIRED_ACTIONS = new Set([
  'routes:delete',
  'admins:invite',
  'admins:suspend',
  'admins:unsuspend',
  'config:write',
  'bulk_operations:execute',
]);

// ─── SESSION MANAGEMENT (§3) ──────────────────────

/**
 * Admin session record stored in Redis-A
 * §3.1 Session lifecycle
 */
export interface AdminSession {
  adminId: string;
  sessionId: string;
  role: AdminRole;
  permissions: string[];
  fpHash: string;
  createdAt: number;                // UNIX timestamp
  absoluteDeadline: number;         // createdAt + 24 hours (§3.4)
  lastActivity: number;
  needsReauth: boolean;             // Set to true if anomaly score >= 30 (§7.3)
  ip: string;                       // IP at session creation
  ipCountry: string;               // Country at session creation
}

// ─── DEVICE FINGERPRINTING (§4) ──────────────────────

/**
 * Client-side signals collected on login and refresh
 * §4.1 Signal collection - client side
 */
export interface FingerprintSignalsClient {
  userAgent: string;              // "Chrome/124 Windows"
  acceptLanguage: string;         // "en-US,en;q=0.9"
  timezone: string;               // "Asia/Kolkata"
  screenRes: string;              // "1920x1080"
  colorDepth: number;             // 24
  platform: string;               // "Win32"
  hardwareConcurrency: number;    // 8
  deviceMemory?: number;          // 16 (optional)
}

/**
 * Server-side signals computed from request
 * §4.1 Signal collection - server side
 */
export interface FingerprintSignalsServer {
  ip: string;                     // Extracted from X-Forwarded-For
  ipCountry: string;             // From MaxMind GeoIP or IP2Location
  ipASN: string;                 // ISP Autonomous System Number
  tlsFingerprint?: string;       // JA3 hash (if available from proxy)
}

/**
 * Combined fingerprint for hashing
 * §4.2 Fingerprint hash implementation
 */
export interface FingerprintSignals extends FingerprintSignalsClient, FingerprintSignalsServer {}

/**
 * Result of fingerprint validation
 * §4.3 Probabilistic evaluation
 */
export enum FingerprintVerdict {
  MATCH = 'MATCH',              // Score 0: device unchanged
  MINOR_DRIFT = 'MINOR_DRIFT',  // Score ≤ 25: browser update, etc.
  DRIFT = 'DRIFT',              // Score 26-50: new device/OS
  MISMATCH = 'MISMATCH',        // Score > 50: likely hijack
}

export interface FingerprintDriftResult {
  verdict: FingerprintVerdict;
  action: 'ALLOW' | 'LOG' | 'STEP_UP_AUTH' | 'DENY';
  score: number;
  details?: {
    changedSignals: string[];
  };
}

// ─── REFRESH TOKEN FAMILY (§3.2) ──────────────────────

/**
 * Refresh token record in database
 * Implements family-based rotation for theft detection
 * §3.2 Token refresh flow and token reuse detection (§14)
 */
export interface AdminRefreshTokenRecord {
  id: string;
  adminId: string;
  tokenHash: string;              // bcrypt hash of raw token (stored, not raw)
  familyId: string;               // UUID to group token lineage
  sessionId: string;
  absoluteExp: number;            // UNIX timestamp (hard cutoff at +24h)
  createdAt: number;
  lastUsedAt?: number;
  isRevoked: boolean;
  revokeReason?: string;          // 'family_revocation' | 'logout' | 'password_changed' | etc
  deviceFpHash: string;           // device fingerprint at token creation
  ipAtCreation: string;
}

// ─── ANOMALY DETECTION (§7) ──────────────────────

export enum BehaviorEventType {
  API_CALL = 'API_CALL',
  FAILED_AUTH = 'FAILED_AUTH',
  FAILED_STEP_UP = 'FAILED_STEP_UP',
  BULK_OPERATION = 'BULK_OPERATION',
  SENSITIVE_READ = 'SENSITIVE_READ',
  ADMIN_MANAGEMENT = 'ADMIN_MANAGEMENT',
  UNUSUAL_HOUR = 'UNUSUAL_HOUR',
  FINGERPRINT_DRIFT = 'FINGERPRINT_DRIFT',
}

/**
 * Behavior event for anomaly scoring
 * §7.1 Behavior tracking
 */
export interface BehaviorEvent {
  adminId: string;
  sessionId: string;
  eventType: BehaviorEventType;
  timestamp: number;              // UNIX timestamp
  metadata: Record<string, unknown>;
}

/**
 * Anomaly scoring rule
 * §7.2 Anomaly scoring rules
 */
export interface AnomalyRule {
  condition: string;
  score: number;                  // Points added if triggered
  description: string;
}

export enum AnomalySeverity {
  LOW = 'LOW',                    // Score < 30: log only
  MEDIUM = 'MEDIUM',             // Score 30-60: force reauth
  HIGH = 'HIGH',                 // Score >= 60: revoke all sessions
}

/**
 * Result of anomaly evaluation
 * §7.2 Anomaly scoring
 */
export interface AnomalyResult {
  score: number;
  severity: AnomalySeverity;
  triggeredRules: Array<{
    rule: string;
    score: number;
  }>;
  recommendedAction: 'ALLOW' | 'LOG' | 'FORCE_REAUTH' | 'REVOKE_ALL';
}

// ─── AUDIT LOGGING (§10) ──────────────────────

export enum AuthAuditEventType {
  // Auth events
  LOGIN_SUCCESS = 'LOGIN_SUCCESS',
  LOGIN_FAILURE = 'LOGIN_FAILURE',
  LOGOUT = 'LOGOUT',
  TOKEN_REFRESH = 'TOKEN_REFRESH',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  SESSION_REVOKED = 'SESSION_REVOKED',

  // MFA events
  MFA_SETUP = 'MFA_SETUP',
  MFA_SUCCESS = 'MFA_SUCCESS',
  MFA_FAILURE = 'MFA_FAILURE',
  MFA_DISABLED = 'MFA_DISABLED',
  BACKUP_CODE_GENERATED = 'BACKUP_CODE_GENERATED',
  BACKUP_CODE_USED = 'BACKUP_CODE_USED',

  // Step-up events
  STEP_UP_SUCCESS = 'STEP_UP_SUCCESS',
  STEP_UP_FAILURE = 'STEP_UP_FAILURE',

  // Token events
  TOKEN_FAMILY_REVOKED = 'TOKEN_FAMILY_REVOKED',
  TOKEN_REUSE_DETECTED = 'TOKEN_REUSE_DETECTED',

  // Access events
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  SENSITIVE_DATA_READ = 'SENSITIVE_DATA_READ',

  // Admin lifecycle
  ADMIN_INVITED = 'ADMIN_INVITED',
  ADMIN_SUSPENDED = 'ADMIN_SUSPENDED',
  ADMIN_UNSUSPENDED = 'ADMIN_UNSUSPENDED',
  PASSWORD_CHANGED = 'PASSWORD_CHANGED',

  // Security events
  ANOMALY_DETECTED = 'ANOMALY_DETECTED',
  BRUTE_FORCE_BLOCKED = 'BRUTE_FORCE_BLOCKED',
  FINGERPRINT_MISMATCH = 'FINGERPRINT_MISMATCH',
  SESSION_HIJACK_SUSPECTED = 'SESSION_HIJACK_SUSPECTED',

  // Entity changes
  ROUTE_CREATED = 'ROUTE_CREATED',
  ROUTE_UPDATED = 'ROUTE_UPDATED',
  ROUTE_DELETED = 'ROUTE_DELETED',
  CONFIG_CHANGED = 'CONFIG_CHANGED',
}

/**
 * Audit log record (append-only)
 * §10.1 Log schema
 */
export interface AuditLogRecord {
  id: string;
  timestamp: number;              // UNIX timestamp
  adminId: string;
  sessionId?: string;
  eventType: AuthAuditEventType;
  severity: 'INFO' | 'WARN' | 'CRITICAL';
  outcome: 'SUCCESS' | 'FAILURE' | 'BLOCKED';
  details: {
    action?: string;
    resourceType?: string;
    resourceId?: string;
    reason?: string;
    anomalyScore?: number;
    [key: string]: unknown;
  };
  requestMeta: {
    ip: string;
    country?: string;
    userAgent: string;
    path: string;
    method: string;
  };
}

// ─── RATE LIMITING (§11) ──────────────────────

export enum RateLimitKey {
  LOGIN_BY_IP = 'ratelimit:login:ip:{ip}',
  LOGIN_BY_EMAIL = 'ratelimit:login:email:{emailHash}',
  REFRESH_BY_SESSION = 'ratelimit:refresh:session:{sessionId}',
  STEP_UP_BY_ADMIN = 'ratelimit:step_up:admin:{adminId}',
  LOGIN_ATTEMPTS_BY_EMAIL = 'ratelimit:login_attempts:email:{emailHash}',
  API_CALLS_BY_ADMIN = 'ratelimit:api:admin:{adminId}',
}

export interface RateLimitConfig {
  window: number;                 // TTL in seconds
  max: number;                    // Maximum requests
  action: 'DENY' | 'CAPTCHA' | 'LOCK_ACCOUNT';
}

// ─── ERROR TYPES ──────────────────────

export class AuthError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 401,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

// ─── LOGIN & RESPONSE TYPES ──────────────────────

export interface AdminLoginRequest {
  email: string;
  password: string;
  totpCode: string;               // OAuth challenge or 6-digit TOTP
  fingerprintSignals: FingerprintSignalsClient;
}

export interface AdminLoginResponse {
  accessToken: string;             // JWT
  refreshToken?: string;          // Only on initial login (set as cookie)
  stepUpToken?: string;           // Only after step-up auth
}

export interface AdminSessionInfo {
  id: string;
  adminId: string;
  role: AdminRole;
  email: string;
  permissions: string[];
  createdAt: number;
  expiresAt: number;
  needsReauth: boolean;
}

// ─── INVITE FLOW (§13.1) ──────────────────────

export interface AdminInviteRequest {
  email: string;
  role: AdminRole;
  department?: string;            // For scoped admins
}

export interface AdminInviteResponse {
  inviteId: string;
  expiresAt: number;              // 48 hours from now
  inviteUrl: string;              // https://admin.busapp.uni/accept-invite?token=...
}

export interface AdminInviteAcceptRequest {
  token: string;                  // Raw invite token from URL
  password: string;               // Minimum 12 chars
  name: string;
  totpSecret?: string;            // User provides, or we generate
}

// ─── BACKUP CODES (§9.3) ──────────────────────

export interface BackupCode {
  id: string;
  adminId: string;
  codeHash: string;               // bcrypt hash of code
  isUsed: boolean;
  usedAt?: number;
  createdAt: number;
}

// ─── CONSTANTS ──────────────────────

export const CONSTANTS = {
  // Token lifetimes (seconds)
  ACCESS_TOKEN_LIFETIME: 15 * 60,           // 15 minutes
  REFRESH_TOKEN_LIFETIME: 24 * 60 * 60,     // 24 hours
  STEP_UP_TOKEN_LIFETIME: 5 * 60,           // 5 minutes
  INVITE_TOKEN_LIFETIME: 48 * 60 * 60,      // 48 hours
  SESSION_ABSOLUTE_LIFETIME: 24 * 60 * 60, // 24 hours (hard cutoff)

  // Password policy
  PASSWORD_MIN_LENGTH: 12,
  PASSWORD_REQUIRE_UPPERCASE: true,
  PASSWORD_REQUIRE_NUMBER: true,
  PASSWORD_REQUIRE_SPECIAL: true,

  // MFA policy
  TOTP_WINDOW: 1,                            // ±1 step tolerance
  BACKUP_CODE_COUNT: 8,
  BACKUP_CODE_LENGTH: 8,

  // Rate limiting (§11)
  RATE_LIMIT_LOGIN_IP: { window: 900, max: 5 },              // 5 per 15 min per IP
  RATE_LIMIT_LOGIN_EMAIL: { window: 3600, max: 10 },         // 10 per 1 hour per email
  RATE_LIMIT_REFRESH: { window: 60, max: 20 },               // 20 per min per session
  RATE_LIMIT_STEP_UP: { window: 300, max: 3 },               // 3 per 5 min per admin
  RATE_LIMIT_API: { window: 60, max: 100 },                  // 100 per min per admin

  // Anomaly scoring thresholds (§7.2)
  ANOMALY_THRESHOLD_REAUTH: 30,              // Force reauth at this score
  ANOMALY_THRESHOLD_REVOKE: 60,              // Revoke all sessions at this score
  ANOMALY_RULE_HIGHAPI: 40,                  // 100+ requests in 60s
  ANOMALY_RULE_BULKDELETE: 30,               // Bulk delete operation
  ANOMALY_RULE_FAILED_STEPUP: 50,            // Multiple failed step-up attempts
  ANOMALY_RULE_FINGERPRINT_DRIFT: 35,        // Device changed
  ANOMALY_RULE_UNUSUAL_HOUR: 20,             // Access outside 8am-6pm
  ANOMALY_RULE_COUNTRY_CHANGE: 70,           // IP country changed mid-session

  // Fingerprinting scoring (§4.3)
  FINGERPRINT_SCORE_UA: 30,                  // User agent changed
  FINGERPRINT_SCORE_TIMEZONE: 25,            // Timezone changed
  FINGERPRINT_SCORE_COUNTRY: 35,             // IP country changed
  FINGERPRINT_SCORE_SCREENRES: 15,           // Screen resolution changed
  FINGERPRINT_SCORE_PLATFORM: 20,            // Platform changed
  FINGERPRINT_SCORE_ASN: 20,                 // ISP changed
  FINGERPRINT_THRESHOLD_DRIFT: 25,           // Trigger STEP_UP_AUTH at this
  FINGERPRINT_THRESHOLD_DENY: 50,            // DENY access at this

  // Database constants
  BCRYPT_ROUNDS: 12,                         // Password hashing strength
};

// ─── HELPERS ──────────────────────

export function isStepUpRequired(permission: string): boolean {
  return STEP_UP_REQUIRED_ACTIONS.has(permission);
}

export function getPermissionsForRole(role: AdminRole): string[] {
  return PERMISSION_MAP[role] || [];
}

export function isValidPassword(password: string): { valid: boolean; reason?: string } {
  if (password.length < CONSTANTS.PASSWORD_MIN_LENGTH) {
    return { valid: false, reason: `Password must be at least ${CONSTANTS.PASSWORD_MIN_LENGTH} characters` };
  }
  if (CONSTANTS.PASSWORD_REQUIRE_UPPERCASE && !/[A-Z]/.test(password)) {
    return { valid: false, reason: 'Password must contain at least one uppercase letter' };
  }
  if (CONSTANTS.PASSWORD_REQUIRE_NUMBER && !/\d/.test(password)) {
    return { valid: false, reason: 'Password must contain at least one number' };
  }
  if (CONSTANTS.PASSWORD_REQUIRE_SPECIAL && !/[!@#$%^&*()_\-+=[\]{};:'",.<>?/\\|`~]/.test(password)) {
    return { valid: false, reason: 'Password must contain at least one special character' };
  }
  return { valid: true };
}
