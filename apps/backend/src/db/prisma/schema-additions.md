/**
 * PRISMA SCHEMA ADDITIONS FOR ADMIN-AUTH-SYSTEM.MD SPECIFICATION
 * 
 * This file contains all new database models required for sections §2-13
 * To apply: Append this content to apps/backend/src/db/prisma/schema.prisma
 * 
 * Then run: pnpm exec prisma migrate dev --name admin_auth_specification_tables
 */

// ─── ENUMS (Add these) ──────────────────────────────────────────────

// Add to existing enums section:

enum AdminAuthEventType {
  // Login/Logout
  LOGIN_SUCCESS
  LOGIN_FAILURE
  LOGOUT
  SESSION_EXPIRED
  SESSION_REVOKED

  // MFA
  MFA_SETUP
  MFA_SUCCESS
  MFA_FAILURE
  BACKUP_CODE_GENERATED
  BACKUP_CODE_USED

  // Step-Up
  STEP_UP_SUCCESS
  STEP_UP_FAILURE

  // Token management
  TOKEN_REFRESH
  TOKEN_FAMILY_REVOKED
  TOKEN_REUSE_DETECTED

  // Access control
  PERMISSION_DENIED
  SENSITIVE_DATA_READ

  // Admin lifecycle
  ADMIN_INVITED
  ADMIN_SUSPENDED
  ADMIN_UNSUSPENDED
  PASSWORD_CHANGED

  // Security
  ANOMALY_DETECTED
  BRUTE_FORCE_BLOCKED
  FINGERPRINT_MISMATCH
  SESSION_HIJACK_SUSPECTED
}

enum FingerprintVerdict {
  MATCH
  MINOR_DRIFT
  DRIFT
  MISMATCH
}

enum BehaviorEventType {
  API_CALL
  FAILED_AUTH
  FAILED_STEP_UP
  BULK_OPERATION
  SENSITIVE_READ
  ADMIN_MANAGEMENT
  UNUSUAL_HOUR
  FINGERPRINT_DRIFT
}

// ─── NEW TABLES ────────────────────────────────────────────────────

/**
 * Admin Refresh Token — Family-based rotation for attack detection
 * §3.2 Refresh token schema + §14 Token reuse attack mitigation
 * 
 * When a refresh token is used:
 * 1. Check if this token_hash exists in DB
 * 2. If token already in table and family_id matches a newer revoked token
 *    → THEFT DETECTED: revoke entire family_id
 * 3. Otherwise: issue new refresh token, store it, mark old one as revoked
 */
model AdminRefreshToken {
  id              String   @id @default(cuid())
  adminId         String
  tokenHash       String   @unique // bcrypt hash of raw token (§2.3)
  familyId        String   // UUID to group token lineage for theft detection
  sessionId       String   // links to session in Redis-A
  absoluteExp     BigInt   // UNIX timestamp milliseconds (§3.4 hard cutoff)
  createdAt       DateTime @default(now())
  lastUsedAt      DateTime?
  isRevoked       Boolean  @default(false)
  revokeReason    String?  // 'family_revocation' | 'logout' | 'password_changed' | 'admin_suspended'
  deviceFpHash    String   // fingerprint hash at token creation (§4.2)
  ipAtCreation    String   // IP at token creation
  
  adminUser       AdminUser @relation(fields: [adminId], references: [id], onDelete: Cascade)

  @@index([adminId, createdAt])
  @@index([familyId]) // For finding all tokens in family on attack detection
  @@index([isRevoked, absoluteExp]) // For cleanup job: find expired revoked tokens
  @@map("admin_refresh_tokens")
}

/**
 * Admin Backup Codes — Single-use codes for MFA recovery
 * §9.3 Backup codes specification
 * 
 * Generated at MFA enrollment (8 codes).
 * Each code is stored as bcrypt hash.
 * When used, mark as consumed.
 */
model AdminBackupCode {
  id        String   @id @default(cuid())
  adminId   String
  codeHash  String   // bcrypt hash of backup code
  isUsed    Boolean  @default(false)
  usedAt    DateTime?
  createdAt DateTime @default(now())

  adminUser AdminUser @relation(fields: [adminId], references: [id], onDelete: Cascade)

  @@index([adminId])
  @@map("admin_backup_codes")
}

/**
 * Admin Behavior Event — Tracks actions for anomaly scoring
 * §7.1 Behavior tracking
 * stored in Redis-B in production, can persist to DB for analytics
 * 
 * On every auth action (login, API call, failed step-up, etc.),
 * record event and compute anomaly score against thresholds.
 */
model AdminBehaviorEvent {
  id        String   @id @default(cuid())
  adminId   String
  sessionId String?
  eventType BehaviorEventType
  timestamp DateTime @default(now())
  metadata  Json?    // Additional context: api_path, response_code, etc.

  adminUser AdminUser? @relation(fields: [adminId], references: [id], onDelete: SetNull)

  @@index([adminId, timestamp])
  @@index([sessionId, timestamp])
  @@index([eventType, timestamp])
  @@map("admin_behavior_events")
}

/**
 * Admin Fingerprint — Device fingerprint history for anomaly detection
 * §4 Device fingerprinting
 * 
 * Stores latest fingerprint per admin.
 * When new signals arrive, compute score (§4.3).
 * If score >= threshold, mark as DRIFT and trigger response.
 */
model AdminFingerprint {
  id                    String   @id @default(cuid())
  adminId               String   @unique
  // Client signals (§4.1)
  userAgent             String
  acceptLanguage        String
  timezone              String
  screenRes             String
  colorDepth            Int
  platform              String
  hardwareConcurrency   Int
  deviceMemory          Int?
  // Server signals (§4.1)
  ipCountry             String
  ipASN                 String
  // Computed hash
  fpHash                String   // SHA256 of canonical signal string (§4.2)
  // Scoring state
  lastVerdict           FingerprintVerdict @default(MATCH)
  lastDriftScore        Int
  lastSeenAt            DateTime @default(now())
  updatedAt             DateTime @updatedAt

  adminUser             AdminUser @relation(fields: [adminId], references: [id], onDelete: Cascade)

  @@index([adminId])
  @@map("admin_fingerprints")
}

/**
 * Admin Invite Token — Track pending admin invitations
 * §13.1 Invite flow
 * 
 * When SUPER_ADMIN invites new admin:
 * 1. Generate random token, hash, store record with role + exp (48h)
 * 2. Send invite email with raw token
 * 3. Invitee clicks link, exchanges token for password + TOTP setup
 * 4. Mark as accepted, create AdminUser
 */
model AdminInviteToken {
  id              String   @id @default(cuid())
  email           String
  tokenHash       String   @unique   // bcrypt hash of raw token
  role            String   // AdminRole enum as string (SUPER_ADMIN | ROUTE_MANAGER | VIEWER)
  department      String?  // Optional scoping
  invitedById     String   // AdminUser ID of inviter
  expiresAt       DateTime // 48 hours from creation
  acceptedAt      DateTime?
  acceptedBy      String?  // AdminUser ID of accepter (once created)
  createdAt       DateTime @default(now())

  invitedByUser   AdminUser? @relation("invitedInvitees", fields: [invitedById], references: [id], onDelete: SetNull)
  acceptedByUser  AdminUser? @relation("acceptedInvites", fields: [acceptedBy], references: [id], onDelete: SetNull)

  @@index([email])
  @@index([expiresAt]) // For cleanup: delete expired invites
  @@map("admin_invite_tokens")
}

/**
 * Admin Session Suspension — Track admin accounts pending suspension
 * §13.2 Admin suspension
 * 
 * When an admin is suspended:
 * 1. Set AdminUser.deactivatedAt
 * 2. Create AdminSuspension record with reason
 * 3. Revoke all sessions immediately via Redis
 * 4. Future logins check deactivatedAt → denied
 */
model AdminSuspension {
  id              String   @id @default(cuid())
  adminId         String
  suspendedAt     DateTime @default(now())
  suspendedBy     String   // AdminUser ID of suspender
  reason          String   // "SECURITY_BREACH" | "POLICY_VIOLATION" | "TERMINATION" | etc.
  unsuspendedAt   DateTime?
  unsuspendedBy   String?  // AdminUser ID of person who unsuspended
  unsuspendReason String?

  adminUser       AdminUser @relation(fields: [adminId], references: [id], onDelete: Cascade)
  suspender       AdminUser @relation("suspension_creator", fields: [suspendedBy], references: [id])
  unsuspender     AdminUser? @relation("suspension_remover", fields: [unsuspendedBy], references: [id])

  @@index([adminId])
  @@index([suspendedAt])
  @@map("admin_suspensions")
}

/**
 * EXTEND AdminUser MODEL WITH NEW FIELDS
 * 
 * Add these fields to the AdminUser model (insert before closing brace):
 * 
 *   // New for admin-auth-system.md specification
 *   isSuspended              Boolean     @default(false)
 *   suspendedAt              DateTime?
 *   suspendedBy              String?
 *   suspendReason            String?
 *   mfaBackupCodesUsedCount  Int         @default(0)
 *   lastMfaBackupCodeUsedAt  DateTime?
 *   passwordChangedAt        DateTime?
 *   failedLoginAttempts      Int         @default(0)
 *   lastFailedLoginAt        DateTime?
 *   isLockedOut              Boolean     @default(false)
 *   lockedOutUntil           DateTime?
 * 
 *   // Relations
 *   refreshTokens            AdminRefreshToken[]
 *   backupCodes              AdminBackupCode[]
 *   behaviorEvents           AdminBehaviorEvent[]
 *   fingerprint              AdminFingerprint?
 *   sentInvites              AdminInviteToken[]  @relation("invitedInvitees")
 *   acceptedInvites          AdminInviteToken[]  @relation("acceptedInvites")
 *   suspensions              AdminSuspension[]
 *   createdSuspensions       AdminSuspension[]   @relation("suspension_creator")
 *   removedSuspensions       AdminSuspension[]   @relation("suspension_remover")
 */

// ─── INDEX HINTS FOR PERFORMANCE ───────────────────────────────────

// After migration, create these database indexes manually if Prisma doesn't auto-create them:
// CREATE INDEX idx_admin_refresh_tokens_family_id ON admin_refresh_tokens(family_id);
// CREATE INDEX idx_admin_refresh_tokens_revoked_exp ON admin_refresh_tokens(is_revoked, absolute_exp);
// CREATE INDEX idx_admin_behavior_events_admin_type ON admin_behavior_events(admin_id, event_type, timestamp DESC);
// CREATE INDEX idx_admin_fingerprints_admin ON admin_fingerprints(admin_id) UNIQUE;

// ─── REDIS KEY PATTERNS ────────────────────────────────────────────

/**
 * Redis-A (Security-Critical, noeviction)
 * 
 * admin:session:{sessionId}->{AdminSession JSON}
 *   TTL: 24 hours
 *   Use: Fetch session state on every authenticated request
 * 
 * jwt:blocklist:{jti}->{timestamp}
 *   TTL: remaining JWT lifetime (max 15min)
 *   Use: Check if JWT is revoked (on logout)
 * 
 * step_up:{stepUpTokenId}->{timestamp}
 *   TTL: 5 minutes
 *   Use: Validate step-up token on sensitive actions
 * 
 * csrf:admin:{adminId}->{tokenHash}
 *   TTL: 24 hours
 *   Use: CSRF protection for cookie-based sessions
 */

/**
 * Redis-B (Rate-limiting & Behavior, allkeys-lru)
 * 
 * ratelimit:login:ip:{ip}->{counter}
 *   TTL: 15 minutes
 *   Max: 5 per 15 min (brute force hardening)
 * 
 * ratelimit:login:email:{emailSha256}->{counter}
 *   TTL: 1 hour
 *   Max: 10 per hour (account lockout)
 * 
 * ratelimit:refresh:session:{sessionId}->{counter}
 *   TTL: 1 minute
 *   Max: 20 per min
 * 
 * ratelimit:step_up:admin:{adminId}->{counter}
 *   TTL: 5 minutes
 *   Max: 3 per 5 min (password confirmation failures)
 * 
 * ratelimit:api:admin:{adminId}->{counter}
 *   TTL: 1 minute
 *   Max: 100 per min (anomaly trigger at 80)
 * 
 * anomaly:session:{sessionId}->{score}
 *   TTL: session lifetime
 *   Use: Track cumulative anomaly score for session
 * 
 * behavior_window:{adminId}->{JSON array of events}
 *   TTL: 1 hour
 *   Use: Rolling window for anomaly rule evaluation
 */

// ─── MIGRATION COMMAND ──────────────────────────────────────────────

/**
 * After updating schema.prisma with these models:
 * 
 * pnpm exec prisma migrate dev --name add_admin_auth_specification_tables
 * 
 * Then generate Prisma client:
 * pnpm exec prisma generate
 */
