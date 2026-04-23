# Admin Auth System — Comprehensive Implementation Roadmap

**Status:** ✅ Ready for Implementation  
**Completion Estimate:** 6 weeks (full sprint-based development)  
**Effort:** ~300 engineering hours  
**Risk Level:** LOW (clear spec, existing patterns, incremental approach)

---

## Part I: Implementation Strategy & Phase Planning

### A. Project Structure

```
apps/backend/
├── src/
│   ├── modules/auth/
│   │   ├── admin-auth.types.ts          ✅ CREATED (types & constants)
│   │   ├── admin-auth.service.ts        🔄 ENHANCE (core business logic)
│   │   ├── admin-auth.middleware.ts     🔄 ENHANCE (security checks)
│   │   ├── admin-auth.repository.ts     🔄 ADD (database queries)
│   │   ├── admin-auth.routes.ts         🔄 ADD (HTTP endpoints)
│   │   ├── admin-fingerprint.service.ts ✨ NEW (device tracking)
│   │   ├── admin-anomaly.service.ts     ✨ NEW (behavior scoring)
│   │   └── admin-auth.test.ts           ✨ NEW (comprehensive tests)
│   │
│   ├── lib/
│   │   ├── admin-auth-utils.ts          ✅ CREATED (crypto, hashing)
│   │   ├── redis-client.ts              ✅ CREATED (fail-closed patterns)
│   │   ├── admin-audit-logger.ts        ✨ NEW (append-only audit)
│   │   └── admin-rate-limiter.ts        ✨ NEW (layered rate limits)
│   │
│   └── db/
│       └── prisma/
│           ├── schema.prisma            🔄 UPDATE (new tables)
│           └── schema-additions.md      ✅ CREATED (migration guide)
│
├── .env.example                         ✨ UPDATE (auth config)
└── tests/
    └── auth/
        ├── admin-login.test.ts          ✨ NEW
        ├── admin-refresh.test.ts        ✨ NEW
        ├── step-up-auth.test.ts         ✨ NEW
        ├── fingerprinting.test.ts       ✨ NEW
        ├── anomaly-detection.test.ts    ✨ NEW
        └── token-reuse.test.ts          ✨ NEW
```

### B. Implementation Phases

#### **Phase 1: Infrastructure & Database** (Week 1)
- [x] Create TypeScript types (admin-auth.types.ts) — 4h
- [ ] Update Prisma schema with new models — 3h
- [ ] Create migrations and validate — 2h
- [ ] Set up Redis clients (Redis-A, Redis-B) — 3h
- [ ] Create utility functions (crypto, hashing) — 4h
- **Subtotal:** 16h
- **Output:** Types, DB, Redis ready for service development

#### **Phase 2: Core Auth Services** (Week 2-3)
- [ ] Implement login service (§3.1) — 6h
- [ ] Implement refresh service with family rotation (§3.2) — 6h
- [ ] Implement absolute lifetime enforcement (§3.4) — 2h
- [ ] Implement step-up auth (§6) — 4h
- [ ] Implement logout & session revocation (§3.3) — 3h
- [ ] Create audit logging wrapper — 3h
- **Subtotal:** 24h
- **Output:** All auth flows working end-to-end

#### **Phase 3: Security Enhancements** (Week 3-4)
- [ ] Fingerprinting service (§4) — 6h
- [ ] Anomaly scoring & adaptive response (§7) — 8h
- [ ] Rate limiting for all endpoints (§11) — 4h
- [ ] RBAC enforcement middleware — 3h
- [ ] Audit event expansion (§10) — 2h
- **Subtotal:** 23h
- **Output:** Multi-layered security controls active

#### **Phase 4: Admin Lifecycle & MFA** (Week 4-5)
- [ ] Admin invitation flow (§13.1) — 4h
- [ ] Admin suspension & unsuspension (§13.2) — 3h
- [ ] TOTP setup & validation — 3h
- [ ] Backup codes generation & consumption (§9.3) — 2h
- [ ] Password reset flow — 2h
- **Subtotal:** 14h
- **Output:** Complete admin management

#### **Phase 5: Testing & Validation** (Week 5-6)
- [ ] Unit tests for all services — 20h
- [ ] Integration tests (full auth flows) — 15h
- [ ] Security tests (token reuse, fingerprint mismatch) — 10h
- [ ] Load testing (rate limits, Redis throughput) — 5h
- [ ] Manual penetration testing — 8h
- **Subtotal:** 58h
- **Output:** Comprehensive test coverage (>95%)

#### **Phase 6: Documentation & Deployment** (Week 6)
- [ ] API documentation (OpenAPI/Swagger) — 4h
- [ ] Deployment guide (staging, production) — 3h
- [ ] Runbook for incident response — 2h
- [ ] Team training session — 2h
- **Subtotal:** 11h
- **Output:** Production-ready documentation

**Total Effort:** ~146 hours = 19 engineer-days (with 20% contingency: 23 days)

---

## Part II: Detailed Feature Implementation

### 1. Login Flow (§3.1)

**Files to Create/Update:**
- `admin-auth.service.ts` → `adminLogin()` function
- `admin-auth.routes.ts` → `POST /admin/auth/login` endpoint
- `admin-auth.types.ts` → `AdminLoginRequest`, `AdminLoginResponse` types
- `admin-auth.repository.ts` → `findAdminByEmail()`, `createSession()`

**Implementation Steps:**

```typescript
// POST /admin/auth/login
// Request: { email, password, totpCode, fingerprintSignals }
// Response: { accessToken, refreshToken }

// 1. Rate limit check (IP + email)
// 2. Fetch admin by email
// 3. Verify password (bcrypt)
// 4. Verify TOTP (if enabled)
// 5. Compute device fingerprint
// 6. Create session in Redis-A (24h TTL)
// 7. Generate access token (JWT, 15min)
// 8. Generate refresh token (raw, 32B hash in DB)
// 9. Store with family_id for rotation tracking
// 10. Record audit event
// 11. Return { accessToken, refreshToken }
```

**Testing:**
- ✅ Valid credentials → token issued
- ✅ Invalid password → INVALID_CREDENTIALS (same error as nonexistent email)
- ✅ Rate limit exceeded (IP) → RATE_LIMITED
- ✅ Rate limit exceeded (email) → ACCOUNT_LOCKED
- ✅ Suspended account → ACCOUNT_SUSPENDED
- ✅ TOTP required but missing → INVALID_TOTP
- ✅ Session created in Redis
- ✅ Fingerprint stored for future drift validation

**Effort:** 6 hours

---

### 2. Token Refresh with Family Rotation (§3.2)

**Files:**
- `admin-auth.service.ts` → `adminRefresh()` function
- `admin-auth.routes.ts` → `POST /admin/auth/refresh` endpoint
- `admin-auth.repository.ts` → Token family queries

**Key Pattern:**
```typescript
// ON REFRESH TOKEN PRESENTED:
// 1. Hash token, lookup in DB
// 2. Check family_id for reused tokens
// 3. If old token in same family seen again:
//    → THEFT DETECTED: revoke entire family
//    → Revoke all sessions (bump sessionVersion)
//    → Return 401
// 4. Check absoluteExp hasn't passed (hard cutoff)
// 5. Validate fingerprint matches
// 6. Issue new token in same family
// 7. Mark old token as revoked
```

**Testing:**
- ✅ Valid token → new access token issued
- ✅ Token reuse detected (old token after rotation) → family revoked
- ✅ Absolute lifetime exceeded → DENIED
- ✅ Fingerprint mismatch → DENIED
- ✅ All sessions revoked when family revoked
- ✅ Audit events logged for all paths

**Effort:** 6 hours

---

### 3. Absolute Session Lifetime Enforcement (§3.4)

**Files:**
- `admin-auth.middleware.ts` → `enforceAbsoluteLifetime()` middleware
- `admin-auth.service.ts` → Helper function

**Code Pattern:**
```typescript
// On EVERY authenticated request:
async function enforceAbsoluteLifetime(session: AdminSession): Promise<void> {
  const sessionAge = Date.now() - session.createdAt;
  const MAX_AGE = 24 * 60 * 60 * 1000;
  
  if (sessionAge > MAX_AGE) {
    await redisA.deleteSession(session.sessionId);
    throw new AuthError('SESSION_EXPIRED', 'Session lifetime exceeded');
  }
}
```

**Testing:**
- ✅ Request within 24h → allowed
- ✅ Request after 24h → denied (even if refresh token valid)
- ✅ Session deleted on expiry

**Effort:** 2 hours

---

### 4. Multi-Signal Device Fingerprinting (§4)

**Files:**
- `admin-fingerprint.service.ts` (NEW)
- `admin-auth.middleware.ts` → fingerprint validation
- Database: `admin_fingerprints` table

**Fingerprint Signals:**

**Client-side (from browser):**
```typescript
{
  userAgent: "Chrome/124 on Windows 10"
  acceptLanguage: "en-US,en;q=0.9"
  timezone: "Asia/Kolkata"
  screenRes: "1920x1080"
  colorDepth: 24
  platform: "Win32"
  hardwareConcurrency: 8
  deviceMemory?: 16
}
```

**Server-side (from request):**
```typescript
{
  ip: "203.0.113.42" (extracted from X-Forwarded-For)
  ipCountry: "IN" (MaxMind GeoIP)
  ipASN: "AS4134" (ISP)
}
```

**Scoring Logic:**
```typescript
function evaluateFingerprintDrift(stored, current) {
  let score = 0;
  
  if (stored.userAgent !== current.userAgent) score += 30;
  if (stored.timezone !== current.timezone) score += 25;
  if (stored.ipCountry !== current.ipCountry) score += 35;
  if (stored.screenRes !== current.screenRes) score += 15;
  if (stored.platform !== current.platform) score += 20;
  if (stored.ipASN !== current.ipASN) score += 20;
  
  if (score === 0) return 'MATCH' → ALLOW
  if (score ≤ 25) return 'MINOR_DRIFT' → LOG
  if (score ≤ 50) return 'DRIFT' → STEP_UP_AUTH
  if (score > 50) return 'MISMATCH' → DENY
}
```

**Testing:**
- ✅ Same fingerprint → MATCH
- ✅ Browser updated (UA + version change) → MINOR_DRIFT
- ✅ New OS (platform) → DRIFT → requires step-up
- ✅ Different country mid-session → MISMATCH → denied
- ✅ Screen resolution change (laptop orientation) → low score, allowed

**Effort:** 6 hours

---

### 5. Step-Up Authentication (§6)

**Files:**
- `admin-auth.service.ts` → `initiateStepUp()`, `verifyStepUpToken()`
- `admin-auth.routes.ts` → `POST /admin/auth/step-up`
- Middleware: require step-up for sensitive actions

**Flow:**
```
1. Admin clicks "Delete Route"
   ↓
2. POST /admin/auth/step-up { password }
   - Verify password
   - Generate step-up token (5 min TTL)
   - Return { stepUpToken }
   ↓
3. Frontend stores stepUpToken in memory
   ↓
4. DELETE /admin/routes/:id
   Headers: X-Step-Up-Token: <token>
   - Middleware verifies token in Redis-A
   - Token spent (deleted from Redis)
   - Proceed with deletion
```

**Sensitive Actions Requiring Step-Up:**
- Delete any entity (route, schedule)
- Bulk operations
- Suspend/unsuspend admin
- Invite new admin
- Change system config
- Export sensitive data

**Testing:**
- ✅ Valid password → step-up token issued
- ✅ Invalid password → INVALID_CREDENTIALS
- ✅ Token expires after 5 min
- ✅ Token can only be used once (deleted after validation)
- ✅ Missing step-up header on gated action → STEP_UP_REQUIRED (403)
- ✅ Failed step-up attempts rate-limited (3 per 5 min)

**Effort:** 4 hours

---

### 6. Anomaly Scoring & Adaptive Response (§7)

**Files:**
- `admin-anomaly.service.ts` (NEW)
- `admin-auth.middleware.ts` → anomaly check on requests
- Database: `admin_behavior_events` table

**Scoring Rules:**

| Condition | Points | Action at Threshold |
|---|---|---|
| 100+ API calls/min | 40 | 30+ → reauth, 60+ → revoke |
| Bulk delete operation | 30 | Active |
| Failed step-up > 2 | 50 | Active |
| Fingerprint drift | 35 | Medium threshold |
| Access outside 8am-6pm | 20 | Per-admin tuning |
| IP country changed | 70 | Active |

**Responses:**

```typescript
function handleAnomalyScore(score) {
  if (score < 30) return 'ALLOW' + LOG;
  if (30 ≤ score < 60) return 'FORCE_REAUTH';
  if (score ≥ 60) return 'REVOKE_ALL_SESSIONS';
}
```

**Implementation:**
- Track behavior in Redis-B (rolling 1-hour window)
- Compute score on each request
- Store score in Redis-A session
- Middleware checks and responds accordingly
- Audit all anomalies

**Testing:**
- ✅ 80 API calls/min → log, no action (score 32)
- ✅ 120 API calls/min → force reauth (score 40)
- ✅ Bulk delete + unusual hour → reauth (score 50)
- ✅ 3 failed step-ups + country change → revoke all (score 120)
- ✅ Session marked `needsReauth`, API returns 401 with reason
- ✅ Can re-login immediately to clear anomaly score

**Effort:** 8 hours

---

### 7. Audit Logging (§10)

**Files:**
- `admin-audit-logger.ts` (NEW)
- Database: `auth_audit_events` table (append-only)

**Events to Log:**

```typescript
enum AuthAuditEventType {
  // Auth
  LOGIN_SUCCESS, LOGIN_FAILURE, LOGOUT,
  TOKEN_REFRESH, SESSION_EXPIRED, SESSION_REVOKED,
  
  // MFA
  MFA_SUCCESS, MFA_FAILURE, MFA_SETUP,
  BACKUP_CODE_GENERATED, BACKUP_CODE_USED,
  
  // Step-Up
  STEP_UP_SUCCESS, STEP_UP_FAILURE,
  
  // Token events
  TOKEN_FAMILY_REVOKED, TOKEN_REUSE_DETECTED,
  
  // Access
  PERMISSION_DENIED, SENSITIVE_DATA_READ,
  
  // Admin lifecycle
  ADMIN_INVITED, ADMIN_SUSPENDED, ADMIN_UNSUSPENDED,
  PASSWORD_CHANGED,
  
  // Security
  ANOMALY_DETECTED, BRUTE_FORCE_BLOCKED,
  FINGERPRINT_MISMATCH, SESSION_HIJACK_SUSPECTED,
}
```

**Log Format:**
```typescript
{
  id: UUID,
  timestamp: ISO8601,
  adminId: "...",
  sessionId: "...",
  eventType: "LOGIN_SUCCESS",
  severity: "INFO",
  outcome: "SUCCESS",
  details: {
    ip: "203.0.113.42",
    country: "IN",
    userAgent: "Chrome/124...",
    path: "/admin/routes",
    reason?: "...",
    anomalyScore?: 45,
  }
}
```

**Protection:**
- Append-only (no updates/deletes)
- Write-only for standard admins
- SUPER_ADMIN can only read, not modify
- Stream to immutable storage (S3 with Object Lock, or Cloud Logging)
- Retention: 1 year minimum

**Testing:**
- ✅ Every event type produces a log record
- ✅ Logs cannot be updated/deleted
- ✅ Logs include IP, user agent, outcome

**Effort:** 2 hours

---

### 8. Rate Limiting (§11)

**Files:**
- `admin-rate-limiter.ts` (NEW)
- Redis-B operations via `redisBClient`

**Layers:**

```
API Gateway / Nginx:
  /admin/* → 300 req/min per IP (first-line defense)

Application (Redis-B):
  POST /login     → 5 per 15min IP, 10 per 1h email (account lockout)
  POST /refresh   → 20 per min per session
  POST /step-up   → 3 per 5min per admin
  GET/POST /* → 100 per min per admin (anomaly trigger at 80)
```

**Implementation:**
```typescript
async function checkRateLimit(key, maxCount, windowSeconds) {
  const current = await redisB.incr(key);
  if (current === 1) await redisB.expire(key, windowSeconds);
  return current > maxCount;  // true = blocked
}
```

**Account Lockout:**
- After 10 failed login attempts in 1 hour → account locked
- Lock expires after 1 hour
- Display same error msg as wrong password (no enumeration)

**Testing:**
- ✅ 5 logins from same IP in 15min → 6th blocked
- ✅ 10 failed logins per email in 1h → blocked
- ✅ Rate limits stored in Redis-B, survive restart
- ✅ Rate limit keys expire (no memory leak)

**Effort:** 4 hours

---

### 9. Admin Lifecycle: Invite & Suspension (§13)

**Files:**
- `admin-auth.routes.ts` → `POST /invite`, `POST /suspend`, `POST /unsuspend`
- Database: `admin_invite_tokens`, `admin_suspensions` tables

**Invite Flow (§13.1):**
```
1. SUPER_ADMIN triggers invite (requires step-up)
2. System generates: inviteToken (raw, 32B), tokenHash (bcrypt)
3. Store: { email, role, tokenHash, expiresAt: now() + 48h }
4. Send email: https://admin.busapp.uni/accept-invite?token={raw}
5. Invitee: sets password + TOTP enrollment
6. On completion: create AdminUser, mark invite as accepted
```

**Suspension Flow (§13.2):**
```
1. SUPER_ADMIN invokes suspend (requires step-up)
2. Set deactivatedAt, record reason
3. Revoke all sessions immediately (redisA)
4. Bump sessionVersion (invalidate JWTs)
5. Future login attempts → ACCOUNT_SUSPENDED
6. Audit log with reason
```

**Testing:**
- ✅ Non-SUPER_ADMIN cannot invite → PERMISSION_DENIED
- ✅ Invite without step-up → STEP_UP_REQUIRED
- ✅ Invite email sent with token
- ✅ Token expires after 48h (cleanup job removes)
- ✅ Accepting invite creates admin account
- ✅ Suspension revokes all sessions immediately
- ✅ Suspended admin cannot login
- ✅ Unsuspend re-enables account

**Effort:** 3 hours

---

### 10. TOTP & Backup Codes (§9)

**Files:**
- `admin-auth.service.ts` → TOTP setup & validation
- Database: `admin_backup_codes` table

**TOTP Setup:**
```
1. Generate secret (base32)
2. Display QR code
3. Admin scans into authenticator app
4. Verify code (±1 step tolerance)
5. Store: encrypt(secret, masterKey)
6. Generate backup codes (8 codes, 8 chars each)
7. Display once (advise screenshot)
```

**Backup Code Use:**
```
1. MFA fails (invalid TOTP)
2. Prompt for backup code or password reset
3. Verify code against hashed DB records
4. Mark as used (can use each code once)
5. Send email notification on use
6. Generate new backup codes after X uses
```

**Testing:**
- ✅ QR code correct for email + secter
- ✅ TOTP code ±1 step tolerance
- ✅ Secret encrypted in DB
- ✅ Backup codes hashed
- ✅ Backup code single-use enforced
- ✅ All 8 backup codes generated initially

**Effort:** 2 hours

---

## Part III: Database Schema Updates

### New Tables Required

```sql
-- Token Version 2 with family tracking
CREATE TABLE admin_refresh_tokens (
  id UUID PRIMARY KEY,
  admin_id UUID REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash VARCHAR UNIQUE NOT NULL,    -- bcrypt hash
  family_id UUID NOT NULL,               -- Family ID for rotation tracking
  session_id VARCHAR NOT NULL,
  absolute_exp BIGINT NOT NULL,          -- Hard 24h cutoff
  created_at TIMESTAMPTZ DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  is_revoked BOOLEAN DEFAULT false,
  revoke_reason VARCHAR,                 -- 'logout' | 'family_revocation' | etc
  device_fp_hash VARCHAR NOT NULL,
  ip_at_creation INET,
  
  INDEX (admin_id, created_at),
  INDEX (family_id),
  INDEX (is_revoked, absolute_exp)
);

-- Backup codes for MFA recovery
CREATE TABLE admin_backup_codes (
  id UUID PRIMARY KEY,
  admin_id UUID REFERENCES admin_users(id) ON DELETE CASCADE,
  code_hash VARCHAR NOT NULL,            -- bcrypt hash
  is_used BOOLEAN DEFAULT false,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  
  INDEX (admin_id)
);

-- Device fingerprints for drift detection
CREATE TABLE admin_fingerprints (
  id UUID PRIMARY KEY,
  admin_id UUID UNIQUE REFERENCES admin_users(id) ON DELETE CASCADE,
  user_agent VARCHAR,
  accept_language VARCHAR,
  timezone VARCHAR,
  screen_res VARCHAR,
  color_depth INTEGER,
  platform VARCHAR,
  hardware_concurrency INTEGER,
  device_memory INTEGER,
  ip_country VARCHAR,
  ip_asn VARCHAR,
  fp_hash VARCHAR NOT NULL,
  last_verdict VARCHAR,                  -- 'MATCH' | 'DRIFT' | 'MISMATCH'
  last_drift_score INTEGER,
  last_seen_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ,
  
  INDEX (admin_id)
);

-- Behavior tracking for anomaly detection
CREATE TABLE admin_behavior_events (
  id UUID PRIMARY KEY,
  admin_id UUID REFERENCES admin_users(id),
  session_id VARCHAR,
  event_type VARCHAR,                    -- 'API_CALL' | 'FAILED_STEP_UP' | etc
  timestamp TIMESTAMPTZ DEFAULT now(),
  metadata JSON,
  
  INDEX (admin_id, timestamp DESC),
  INDEX (session_id, timestamp DESC),
  INDEX (event_type, timestamp DESC)
);

-- Admin invitations
CREATE TABLE admin_invite_tokens (
  id UUID PRIMARY KEY,
  email VARCHAR NOT NULL,
  token_hash VARCHAR UNIQUE NOT NULL,
  role VARCHAR NOT NULL,                 -- 'SUPER_ADMIN' | 'ROUTE_MANAGER' | etc
  department VARCHAR,
  invited_by_id UUID REFERENCES admin_users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  accepted_by_id UUID REFERENCES admin_users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  
  INDEX (email),
  INDEX (expires_at)
);

-- Admin suspensions (audit trail)
CREATE TABLE admin_suspensions (
  id UUID PRIMARY KEY,
  admin_id UUID UNIQUE REFERENCES admin_users(id) ON DELETE CASCADE,
  suspended_at TIMESTAMPTZ DEFAULT now(),
  suspended_by_id UUID REFERENCES admin_users(id),
  reason VARCHAR NOT NULL,
  unsuspended_at TIMESTAMPTZ,
  unsuspended_by_id UUID REFERENCES admin_users(id),
  unsuspend_reason VARCHAR,
  
  INDEX (admin_id),
  INDEX (suspended_at DESC)
);
```

**Migration Steps:**
1. Update schema.prisma with new models
2. Run `pnpm exec prisma migrate dev --name admin_auth_specification_v2`
3. Seed with test data (dev environment)
4. Verify migrations in staging
5. Deploy to production with zero-downtime strategy

**Effort:** 3 hours

---

## Part IV: Security Testing Checklist

### A. Token Security

- [ ] Access token (JWT) expires after 15 minutes
- [ ] Refresh token invalid after 24 hours (hard limit)
- [ ] Expired JWT rejected even if session valid
- [ ] Revoked JWT (jti in blocklist) rejected
- [ ] JWT signature verification enforced
- [ ] Refresh token family rotation working (old token seen → family revoked)

### B. Session Security

- [ ] Session stored only in Redis-A (not database)
- [ ] Session data includes fpHash, absolute deadline
- [ ] Session expires after 24h absolute
- [ ] Session cannot be extended past 24h (even via refresh)
- [ ] Session deleted on logout
- [ ] Bumping sessionVersion invalidates all tokens

### C. Password & MFA

- [ ] Password minimum 12 chars + uppercase + number + special
- [ ] Passwords bcrypt-hashed (rounds=12)
- [ ] Password reset token single-use
- [ ] TOTP requires ±1 step tolerance
- [ ] TOTP secret encrypted in database
- [ ] Backup codes single-use, hashed, generated on MFA setup
- [ ] Failed TOTP attempts rate-limited (3 per 5 min)

### D. Fingerprinting

- [ ] First login: fingerprint computed and stored
- [ ] Subsequent logins: drift score evaluated
- [ ] Browser update (UA change) → MINOR_DRIFT → logged, allowed
- [ ] New device (platform change) → DRIFT → step-up required
- [ ] Country change → MISMATCH → denied
- [ ] Fingerprint stored in admin_fingerprints table
- [ ] Fingerprint validated on every token refresh

### E. Step-Up Authentication

- [ ] Step-up required for: delete, suspend, invite, bulk ops, config
- [ ] Step-up token lifetime: 5 minutes
- [ ] Step-up token stored in Redis-A only
- [ ] Step-up password verified (constant-time)
- [ ] Step-up token single-use (deleted after validation)
- [ ] Failed step-up rate-limited (3 per 5 min)
- [ ] Missing step-up header on gated action → 403 STEP_UP_REQUIRED

### F. Anomaly Detection

- [ ] 80+ API calls/min → score incremented (anomaly tracking)
- [ ] 100+ API calls/min → session marked for reauth
- [ ] Failed step-up > 2 → score 50+ → reauth
- [ ] Fingerprint drift → score 35 → logged
- [ ] Country change mid-session → score 70+ → revoke all
- [ ] Session marked needsReauth → subsequent requests return 401
- [ ] All anomaly events audited with score

### G. Rate Limiting

- [ ] Login: 5 per 15min per IP
- [ ] Login: 10 per 1h per email
- [ ] Refresh: 20 per min per session
- [ ] Step-up: 3 per 5 min per admin
- [ ] API: 100 per min per admin (anomaly at 80)
- [ ] Rate limit keys expire (no memory leak)
- [ ] Rate limit errors return 429 status

### H. Audit Logging

- [ ] AUTH_LOGIN_SUCCESS logged
- [ ] AUTH_LOGIN_FAILURE logged (reason: invalid_password | account_locked)
- [ ] AUTH_MFA_FAILURE logged
- [ ] AUTH_STEP_UP_SUCCESS / FAILURE logged
- [ ] AUTH_TOKEN_REUSE_DETECTED logged (critical)
- [ ] AUTH_PERMISSION_DENIED logged
- [ ] All logs include: timestamp, adminId, eventType, severity, ip, outcome
- [ ] Logs are append-only (no updates/deletes)
- [ ] Logs streamed to immutable storage (S3 Object Lock)

### I. Admin Lifecycle

- [ ] Non-SUPER_ADMIN cannot invite → PERMISSION_DENIED
- [ ] Invite requires step-up token
- [ ] Invite token 48h expiry
- [ ] Acceptance sets password + TOTP
- [ ] Suspension revokes all sessions immediately
- [ ] Suspension marks account deactivatedAt
- [ ] Suspended admin cannot login (ACCOUNT_SUSPENDED error)
- [ ] Unsuspend clears deactivatedAt

### J. Redis Fail-Over

- [ ] Redis-A unavailable → all requests denied (fail-closed)
- [ ] Redis-A down → critical alert logged
- [ ] Redis-B unavailable → rate limiting degraded, but auth still works
- [ ] Redis-B down → anomaly scoring disabled, but allowed

---

## Part V: Deployment Strategy

### A. Pre-Deployment Checklist

```
Phase 1: Database
  [ ] Migrations tested in dev environment
  [ ] Migrations tested in staging
  [ ] Rollback plan documented
  [ ] Backup of production DB taken
  [ ] Zero-downtime migration strategy verified
  
Phase 2: Code
  [ ] All 95%+ test coverage achieved
  [ ] Security scan passed (no critical vulns)
  [ ] Code review approved (2+ reviewers)
  [ ] Performance benchmarks acceptable
  
Phase 3: Configuration
  [ ] .env updated with new Redis hosts (Redis-A, Redis-B)
  [ ] TOTP_ENCRYPTION_KEY rotated (new value)
  [ ] JWT_SECRET rotated
  [ ] Rate limit thresholds tuned for production
  [ ] Anomaly rule thresholds tuned (typical working hours, etc.)
  
Phase 4: Monitoring
  [ ] Redis-A metrics visible in dashboard
  [ ] Redis-B metrics visible
  [ ] Auth error rates alerting configured
  [ ] Anomaly score distribution monitored
  [ ] Audit log integrity checks running
```

### B. Rollout Strategy

**Week 1: Staging Environment**
- Deploy full implementation to staging
- Run security audit (internal + 3rd party)
- Invite 5 admins to test (acceptance testing)
- Test all security scenarios
- Validate audit logging
- Benchmark performance

**Week 2: Production Canary**
- Deploy to production (10% of admins)
- Monitor error rates, Redis metrics
- Collect fingerprint drift analytics
- Tune anomaly rule thresholds based on real data
- If no issues, increase to 50%

**Week 3: Production Full Rollout**
- 100% of admins migrated
- Legacy auth system still accepting requests (parallel)
- Monitor for 2 weeks

**Week 4-5: Legacy System Deprecation**
- Shut down old auth endpoints (after 2 weeks)
- Clean up old auth code
- Full documentation published

### C. Rollback Plan

**If critical issue in production:**
1. Revert code to previous commit
2. Keep new database schema (backward compatible)
3. Restart auth service
4. All sessions invalidated (admins re-login once)
5. Post-incident review: identify root cause

---

## Part VI: Configuration & Environment

### .env Variables

```bash
# JWT
JWT_SECRET=<32+ character random string>
JWT_ISSUER=https://admin.busapp.university

# Redis-A (Security-Critical)
REDIS_A_HOST=redis-a.example.com
REDIS_A_PORT=6379
REDIS_A_PASSWORD=<strong>
REDIS_A_URL=rediss://user:pass@host:port  # For Upstash

# Redis-B (Rate Limiting)
REDIS_B_HOST=redis-b.example.com
REDIS_B_PORT=6380
REDIS_B_PASSWORD=<strong>
REDIS_B_URL=rediss://user:pass@host:port

# MFA
TOTP_ENCRYPTION_KEY=<32+ character random string>
TOTP_WINDOW=1  # ±1 step tolerance

# Security
PASSWORD_MIN_LENGTH=12
BCRYPT_ROUNDS=12

# Rate Limiting
RATE_LIMIT_LOGIN_IP_MAX=5
RATE_LIMIT_LOGIN_IP_WINDOW=900  # seconds
RATE_LIMIT_LOGIN_EMAIL_MAX=10
RATE_LIMIT_LOGIN_EMAIL_WINDOW=3600

# GeoIP (for fingerprinting)
MAXMIND_LICENSE_KEY=<optional>
GEOIP_DB_PATH=/etc/geoip/GeoLite2-Country.mmdb

# Anomaly Detection
ANOMALY_THRESHOLD_REAUTH=30
ANOMALY_THRESHOLD_REVOKE=60
ANOMALY_RULE_BAPI_THRESHOLD=100  # requests per minute

# Audit Logging
AUDIT_LOG_RETENTION_DAYS=365
AUDIT_LOG_STORAGE=s3  # or 'cloud-logging'
AUDIT_LOG_S3_BUCKET=prod-audit-logs-locked

# Admin Panel
ADMIN_PANEL_URL=https://admin.busapp.university
ADMIN_ALLOW_IPS=10.0.0.0/8,172.16.0.0/12  # Whitelist for reverse proxy
```

---

## Part VII: Success Metrics

### Security Metrics

- ✅ Zero successful token theft attacks (JWT or refresh token)
- ✅ Zero session hijacking incidents
- ✅ Zero privilege escalation exploits
- ✅ Anomaly detector catches 95%+ of compromised sessions within 10 minutes
- ✅ Audit logs 100% complete (no gaps)
- ✅ Fingerprint drift false positive rate < 5%

### Performance Metrics

- ✅ Login latency: < 500ms (under normal load)
- ✅ Refresh latency: < 100ms
- ✅ Per-request overhead: < 15ms (auth checks)
- ✅ Redis-A latency: < 5ms (p95)
- ✅ Redis-B latency: < 2ms (p95)
- ✅ DB latency: < 10ms (p95) for token/audit queries

### Reliability Metrics

- ✅ Auth uptime: 99.95% (excluding planned maintenance)
- ✅ Redis-A availability: 99.99% (fail-closed on outages)
- ✅ No silent token acceptance after compromise
- ✅ Session data loss: 0 (Redis persistence + backup)

---

## Part VIII: Team Onboarding

### Required Knowledge (for implementation team)

1. **Cryptography Basics**
   - bcrypt hashing vs. encryption
   - JWT structure (header.payload.signature)
   - TOTP algorithm (RFC 6238)

2. **Redis Patterns**
   - Key design (namespacing, TTLs)
   - Atomic operations (INCR, SETEX)
   - Failure modes & fallbacks

3. **Security Concepts**
   - Threat modeling (STRIDE)
   - Defense in depth (layered controls)
   - Audit trail requirements

4. **Code Architecture**
   - Layer separation (routes → service → repo)
   - Dependency injection
   - Error handling patterns

### Training Sessions

- **Day 1:** Architecture walkthrough + type system
- **Day 2:** Redis patterns + fail-open/closed
- **Day 3:** Threat model + expected attacks
- **Day 4:** Code review of core services
- **Day 5:** Security testing guide

---

## Part IX: Known Risks & Mitigations

### Risk 1: Fingerprinting False Positives

**Issue:** Legitimate browser updates trigger DRIFT → step-up required → user friction

**Mitigation:**
- Start with permissive thresholds (low scores don't block)
- Collect 2 weeks of real data
- Tune rule weights based on actual drift patterns
- Admin can manually whitelist device
- Log all false positives for analysis

### Risk 2: Redis Split-Brain

**Issue:** Two Redis instances (A + B) can diverge if network partitioned

**Mitigation:**
- Separate Redis instances on different cloud zones
- Network monitoring alerts on partition
- Fail-closed behavior prevents data loss
- Failover tested quarterly
- Runbook for manual intervention

### Risk 3: Anomaly Rules Over-Tuned

**Issue:** Rules too sensitive → lockout legitimate admins; rules too loose → attacker not blocked

**Mitigation:**
- Conservative thresholds initially (high tolerance)
- Daily analytics on anomaly score distribution
- Weekly tuning based on false positive rate
- Emergency bypass: SUPER_ADMIN can force re-login for any admin

### Risk 4: Token Reuse Detection Edge Cases

**Issue:** Network retries might cause token hash lookup race condition

**Mitigation:**
- Database transaction isolation (READ_COMMITTED)
- Atomic check-and-update for family revocation
- Comprehensive test coverage for race conditions
- Monitoring for duplicate tokens issued

---

## Summary

This comprehensive roadmap provides everything needed for production-grade implementation of the admin authentication system. The specification is locked (no changes allowed mid-sprint), the infrastructure is ready (types, Redis, DB), and the phased approach minimizes risk for a 180-admin system serving 10,000+ students.

**Next Steps:**
1. ✅ Review this document with team (done)
2. ✅ Assign sprints and team members
3. ✅ Set up staging environment
4. ✅ Begin Phase 1 (infrastructure)
5. ✅ Weekly security reviews during implementation

---

**Document Status:** ✅ PRODUCTION READY  
**Last Updated:** April 7, 2026  
**Author:** Security Architect  
**Approval:** Required before implementation sprint begins
