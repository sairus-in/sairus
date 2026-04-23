# University Bus System — Admin Panel Authentication System
**Version:** 2.0 | **Classification:** Internal Engineering Spec | **Audience:** Senior Dev Team
07-04-26
---

## 0. Design Philosophy

This system is built around three axioms:

1. **Trust nothing implicitly** — every token, session, and action is validated at multiple layers.
2. **Fail closed, not open** — when infrastructure is uncertain, deny access rather than allow it.
3. **Reduce blast radius** — an attacker who gets in should gain as little as possible before being stopped.

This is not a generic auth guide. Every decision here directly addresses the six holes identified in the v1 review.

---

## 1. Architecture Overview

```
Browser (Admin)
    │
    ▼
┌─────────────────────────────────────────────────┐
│              API Gateway / Load Balancer         │
│  • TLS termination                               │
│  • Rate limiting (first line)                    │
│  • IP allowlist enforcement                      │
└───────────────────────┬─────────────────────────┘
                        │
    ┌───────────────────▼───────────────────┐
    │           Auth Middleware              │
    │  • JWT verification                    │
    │  • Session validation (Redis)          │
    │  • Fingerprint check                   │
    │  • Anomaly scoring                     │
    └───────────────────┬───────────────────┘
                        │
    ┌───────────────────▼───────────────────┐
    │         Route / Action Handler         │
    │  • RBAC enforcement                    │
    │  • Step-Up gate (sensitive actions)    │
    │  • Audit log writer                    │
    └───────────────────┬───────────────────┘
                        │
    ┌───────────────────▼───────────────────┐
    │           Redis Security Cluster       │
    │  Redis-A: Blocklist + Sessions         │
    │  Redis-B: Rate limits + Anomaly scores │
    └────────────────────────────────────────┘
```

---

## 2. Identity & Token Model

### 2.1 Token Types

| Token | Lifetime | Storage | Purpose |
|---|---|---|---|
| Access Token (JWT) | 15 minutes | Memory only (no localStorage) | API authorization |
| Refresh Token | 24 hours (hard) | HttpOnly cookie, Secure, SameSite=Strict | Access token rotation |
| Step-Up Token | 5 minutes | Memory only | Sensitive action gate |

> **Why 24h hard refresh limit?** This directly closes Hole #2. An attacker who steals a refresh token on Day 1 cannot silently persist past Day 1. Users re-authenticate daily — acceptable for an internal admin panel.

### 2.2 Access Token (JWT) Payload

```typescript
interface AdminJWTPayload {
  sub: string;           // admin user ID (UUID v4)
  sessionId: string;     // links to Redis session record
  role: AdminRole;       // SUPER_ADMIN | ROUTE_MANAGER | VIEWER
  permissions: string[]; // fine-grained e.g. ["routes:write", "admins:suspend"]
  fpHash: string;        // device fingerprint hash (see Section 4)
  iat: number;           // issued at
  exp: number;           // expires at (iat + 15 min)
  jti: string;           // unique token ID for blocklisting
}
```

### 2.3 Refresh Token Schema (DB)

```sql
CREATE TABLE admin_refresh_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id        UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL UNIQUE,   -- bcrypt hash of the raw token
  family_id       UUID NOT NULL,           -- token rotation family (detect reuse)
  session_id      UUID NOT NULL,
  absolute_exp    TIMESTAMPTZ NOT NULL,    -- HARD cutoff (created_at + 24h)
  created_at      TIMESTAMPTZ DEFAULT now(),
  last_used_at    TIMESTAMPTZ,
  is_revoked      BOOLEAN DEFAULT false,
  revoke_reason   TEXT,
  device_fp_hash  TEXT NOT NULL,
  ip_at_creation  INET
);
```

**Family-based rotation:** Every refresh generates a new token in the same `family_id`. If an old token from the same family is ever seen again (already rotated), the entire family is invalidated immediately. This detects refresh token theft.

---

## 3. Session Lifecycle

### 3.1 Login Flow

```
POST /admin/auth/login
  Body: { email, password, totpCode }

1. Validate email/password (bcrypt, constant-time compare)
2. Validate TOTP (30s window, ±1 step tolerance)
3. Compute device fingerprint (Section 4)
4. Generate:
   - sessionId = crypto.randomUUID()           ← single UUID, no dual-ID bug
   - accessToken (JWT, 15min)
   - refreshToken (raw random bytes, 32 bytes, base64url)
5. Store session in Redis-A:
   {
     adminId, role, fpHash,
     createdAt: now(),               ← absolute session start
     absoluteDeadline: now() + 24h,  ← hard cutoff stored server-side
     lastActivity: now()
   }
   TTL = 24h
6. Store refresh token in DB (hash only, not raw)
7. Set cookie: refresh_token=<raw>; HttpOnly; Secure; SameSite=Strict; Path=/admin/auth
8. Return: { accessToken } in response body
```

> **Single UUID fix:** Step 4 uses one `sessionId` for everything. The v1 `tempSessionId` / `sessionId` dual-variable bug is eliminated.

### 3.2 Token Refresh Flow

```
POST /admin/auth/refresh
  Cookie: refresh_token=<raw>

1. Hash the incoming token, look up in DB
2. If token is_revoked → DENY, log incident
3. If token already has a newer sibling in same family_id → THEFT DETECTED
   → Revoke entire family, log high-severity alert, force re-login
4. Check absolute_exp: if now() > absolute_exp → DENY (hard cutoff, Hole #2)
5. Validate device fingerprint matches token's device_fp_hash
6. Issue new accessToken + new refreshToken (rotate)
7. Mark old refresh token as revoked in DB
8. Update session lastActivity in Redis
```

### 3.3 Logout Flow

```
POST /admin/auth/logout

1. Revoke refresh token in DB
2. Add JWT jti to Redis-A blocklist (TTL = remaining JWT lifetime)
3. Destroy session record in Redis-A
4. Clear cookie
5. Write audit log
```

### 3.4 Absolute Session Enforcement (Hole #2 Fix)

This check runs on **every authenticated request**, not just refresh:

```typescript
async function enforceAbsoluteLifetime(session: AdminSession): Promise<void> {
  const sessionAge = Date.now() - session.createdAt.getTime();
  const MAX_SESSION_AGE = 24 * 60 * 60 * 1000; // 24 hours in ms

  if (sessionAge > MAX_SESSION_AGE) {
    await revokeSession(session.id, 'absolute_lifetime_exceeded');
    throw new AuthError('SESSION_EXPIRED', 'Session lifetime exceeded. Please log in again.');
  }
}
```

No exceptions. No bypass. Even a valid JWT gets denied if its parent session is too old.

---

## 4. Device Fingerprinting (Hole #1 Fix)

### 4.1 Signal Collection

Replace single `hash(user-agent)` with a probabilistic multi-signal fingerprint:

**From the frontend (sent at login and on each access token request):**

```typescript
interface FingerprintSignals {
  userAgent: string;        // "Chrome/124 Windows"
  acceptLanguage: string;   // "en-US,en;q=0.9"
  timezone: string;         // "Asia/Kolkata"
  screenRes: string;        // "1920x1080"
  colorDepth: number;       // 24
  platform: string;         // "Win32"
  hardwareConcurrency: number; // 8
  deviceMemory?: number;    // 16 (not available in all browsers)
}
```

**From the server side (do not trust client claims):**

```typescript
interface ServerSideSignals {
  ip: string;               // parsed from X-Forwarded-For (validate proxy chain)
  ipCountry: string;        // from MaxMind GeoIP (free DB, run locally)
  ipASN: string;            // ISN org — useful for detecting VPN/datacenter IPs
  tlsFingerprint?: string;  // JA3 hash if your gateway supports it
}
```

### 4.2 Fingerprint Hash

```typescript
function computeFingerprintHash(signals: FingerprintSignals & ServerSideSignals): string {
  const canonical = [
    signals.userAgent,
    signals.acceptLanguage,
    signals.timezone,
    signals.screenRes,
    signals.colorDepth,
    signals.platform,
    signals.hardwareConcurrency,
    signals.ipCountry,   // country, not IP (VPNs change city, rarely change country for same user)
  ].join('||');

  return createHash('sha256').update(canonical).digest('hex');
}
```

### 4.3 Fingerprint Validation (Probabilistic, Not Binary)

```typescript
function evaluateFingerprintDrift(
  stored: FingerprintSignals,
  current: FingerprintSignals
): FingerprintDriftResult {
  let score = 0;

  if (stored.userAgent !== current.userAgent)         score += 30;
  if (stored.timezone !== current.timezone)            score += 25;
  if (stored.ipCountry !== current.ipCountry)          score += 35;
  if (stored.screenRes !== current.screenRes)          score += 15;
  if (stored.platform !== current.platform)            score += 20;
  if (stored.ipASN !== current.ipASN)                  score += 20;

  // Score interpretation
  if (score === 0)   return { verdict: 'MATCH',     action: 'ALLOW' };
  if (score <= 25)   return { verdict: 'MINOR_DRIFT', action: 'LOG' };        // e.g. browser updated
  if (score <= 50)   return { verdict: 'DRIFT',      action: 'STEP_UP_AUTH' }; // e.g. new device
  return             { verdict: 'MISMATCH',           action: 'DENY' };         // e.g. stolen token
}
```

> **Key insight:** We treat fingerprint as a signal, not identity. Minor drift (browser update) → log. Major drift (different country + different UA) → deny.

---

## 5. Role-Based Access Control

### 5.1 Role Hierarchy

```
SUPER_ADMIN
  └─ Full system access + admin management + audit logs
  
ROUTE_MANAGER  
  └─ Routes CRUD + schedule management
  └─ Cannot: manage admins, access audit logs, system config
  
VIEWER
  └─ Read-only access to all non-sensitive data
  └─ Cannot: write anything
```

### 5.2 Permission Matrix

| Action | VIEWER | ROUTE_MANAGER | SUPER_ADMIN |
|---|---|---|---|
| View routes | ✓ | ✓ | ✓ |
| Create/edit routes | ✗ | ✓ | ✓ |
| Delete routes | ✗ | Step-Up | Step-Up |
| View admins list | ✗ | ✗ | ✓ |
| Invite admin | ✗ | ✗ | Step-Up |
| Suspend admin | ✗ | ✗ | Step-Up |
| View audit logs | ✗ | ✗ | ✓ |
| System config | ✗ | ✗ | Step-Up |
| Bulk operations | ✗ | Step-Up | Step-Up |

### 5.3 RBAC Middleware

```typescript
function requirePermission(permission: string, options?: { stepUp?: boolean }) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const { payload } = req.auth; // from JWT verification middleware

    // Check permission
    if (!payload.permissions.includes(permission)) {
      await writeAuditLog({
        event: 'PERMISSION_DENIED',
        adminId: payload.sub,
        permission,
        path: req.path,
      });
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // Step-up gate
    if (options?.stepUp) {
      const stepUpToken = req.headers['x-step-up-token'];
      if (!stepUpToken || !(await verifyStepUpToken(stepUpToken, payload.sub))) {
        return res.status(403).json({
          error: 'STEP_UP_REQUIRED',
          message: 'This action requires recent password confirmation',
        });
      }
    }

    next();
  };
}

// Usage:
router.delete('/routes/:id',
  requirePermission('routes:delete', { stepUp: true }),
  deleteRouteHandler
);
```

---

## 6. Step-Up Authentication (Hole #3 Fix)

### 6.1 When Step-Up is Required

Any action that is irreversible or affects access control requires step-up:

- Delete any entity (route, schedule, admin)
- Bulk operations (bulk delete, bulk update)
- Suspend or unsuspend an admin account
- Invite a new admin
- Change system configuration
- Export sensitive data

### 6.2 Step-Up Token Flow

```
POST /admin/auth/step-up
  Headers: Authorization: Bearer <accessToken>
  Body: { password }

1. Verify the access token (standard JWT check)
2. Verify the password against stored bcrypt hash
3. If valid, issue step-up token:
   {
     sub: adminId,
     sessionId,
     type: "STEP_UP",
     iat, exp: iat + 5 minutes,
     jti: randomUUID()
   }
4. Return: { stepUpToken }

Client stores stepUpToken in memory.
Client includes it as: X-Step-Up-Token: <token>
```

### 6.3 Step-Up UX Pattern

```
Admin clicks "Delete Route"
    │
    ▼
Modal: "Confirm your password to proceed"
[Password input] [Confirm]
    │
    ▼ (POST /admin/auth/step-up)
    │
    ├─ Success → store stepUpToken in memory (5 min TTL)
    │            → proceed with delete action
    │
    └─ Failure → show error, increment failed_step_up counter
                 → after 3 failures: force full re-login
```

---

## 7. Anomaly Detection & Adaptive Response (Hole #4 Fix)

### 7.1 Behavior Tracking

The system tracks behavior continuously, not just at login:

```typescript
interface BehaviorEvent {
  adminId: string;
  sessionId: string;
  eventType: BehaviorEventType;
  timestamp: number;
  metadata: Record<string, unknown>;
}

enum BehaviorEventType {
  API_CALL = 'API_CALL',
  FAILED_AUTH = 'FAILED_AUTH',
  FAILED_STEP_UP = 'FAILED_STEP_UP',
  BULK_OPERATION = 'BULK_OPERATION',
  SENSITIVE_READ = 'SENSITIVE_READ',
  ADMIN_MANAGEMENT = 'ADMIN_MANAGEMENT',
  UNUSUAL_HOUR = 'UNUSUAL_HOUR',
  FINGERPRINT_DRIFT = 'FINGERPRINT_DRIFT',
}
```

### 7.2 Anomaly Scoring Rules (Redis-B)

```typescript
const ANOMALY_RULES: AnomalyRule[] = [
  {
    condition: 'api_calls > 100 in 60s',
    score: 40,
    description: 'Unusually high API call rate',
  },
  {
    condition: 'bulk_deletes > 0 in session',
    score: 30,
    description: 'Bulk delete operations detected',
  },
  {
    condition: 'failed_step_up > 2',
    score: 50,
    description: 'Multiple failed step-up attempts',
  },
  {
    condition: 'fingerprint_drift = DRIFT',
    score: 35,
    description: 'Device fingerprint changed mid-session',
  },
  {
    condition: 'hour_of_day NOT IN admin.typical_hours',
    score: 20,
    description: 'Access outside typical working hours',
  },
  {
    condition: 'ip_country changed mid-session',
    score: 70,
    description: 'Country changed during active session',
  },
  {
    condition: 'accessing admin_management + new_session',
    score: 25,
    description: 'Immediate access to privileged area',
  },
];
```

### 7.3 Response Levels (Active, Not Passive)

```typescript
async function handleAnomalyScore(
  score: number,
  session: AdminSession,
  event: BehaviorEvent
): Promise<void> {

  if (score < 30) {
    // LOW: log only
    await auditLog({ level: 'INFO', ...event });
    return;
  }

  if (score >= 30 && score < 60) {
    // MEDIUM: force re-authentication
    await auditLog({ level: 'WARN', ...event });
    await markSessionNeedsReauth(session.id);
    // Next request by this session returns 401 with reason: 'REAUTH_REQUIRED'
    return;
  }

  if (score >= 60) {
    // HIGH: revoke everything immediately
    await auditLog({ level: 'CRITICAL', ...event });
    await revokeAllSessionsForAdmin(session.adminId);
    await notifySecurityTeam({
      reason: 'High anomaly score',
      score,
      event,
      admin: session.adminId,
    });
    // All subsequent requests → 401, force full re-login
  }
}
```

> **This directly closes Hole #4.** Detection now *causes action*, not just log entries. Attackers who blend in partially still hit the medium threshold. Those who try bulk deletes or anomalous access patterns hit the high threshold immediately.

---

## 8. Redis Infrastructure (Hole #5 Fix)

### 8.1 Separation of Concerns

Run two Redis instances with distinct purposes:

**Redis-A (Security-Critical):**
- Active session records
- JWT blocklist (jti → exp)
- Step-up token records
- Config: `maxmemory-policy = noeviction` (never silently drop security data)

**Redis-B (Rate & Behavior):**
- Rate limit counters
- Anomaly scores
- Behavior event windows
- Config: `maxmemory-policy = allkeys-lru` (acceptable to lose behavior data under pressure)

### 8.2 Fail-Closed Behavior

```typescript
class RedisSecurityClient {
  async isTokenRevoked(jti: string): Promise<boolean> {
    try {
      const result = await this.redisA.get(`blocklist:${jti}`);
      return result !== null;
    } catch (error) {
      // Redis-A is down. Fail CLOSED: treat all tokens as potentially revoked.
      // Log critical alert immediately.
      logger.critical('Redis-A unavailable during token check. Denying all requests.');
      throw new ServiceUnavailableError('AUTH_UNAVAILABLE');
    }
  }

  async isRateLimited(key: string): Promise<boolean> {
    try {
      return await this.redisB.isRateLimited(key);
    } catch (error) {
      // Redis-B is down. Rate limiting unavailable.
      // Fail OPEN for rate limits (degraded, but not a complete outage).
      // Fail CLOSED for anomaly scores (assume worst case).
      logger.error('Redis-B unavailable. Rate limits degraded.');
      return false; // Allow request but log
    }
  }
}
```

### 8.3 Redis Monitoring Requirements

Production must alert on:

| Metric | Threshold | Action |
|---|---|---|
| Redis-A memory > 80% | Immediate | Page on-call |
| Redis-A connection failure | Any | Page on-call, circuit breaker |
| Redis-B memory > 90% | 5 minutes | Alert team |
| Key eviction on Redis-A | Any (should be zero) | Page on-call |

---

## 9. Multi-Factor Authentication

### 9.1 TOTP Setup

All admin accounts require TOTP (Time-based One-Time Password). No exceptions.

```typescript
// Enrollment (one time, during invite acceptance)
const secret = authenticator.generateSecret(); // 20 bytes, base32
const otpauthUrl = authenticator.keyuri(adminEmail, 'UniverBusAdmin', secret);
// Display QR code to admin → they scan with Google Authenticator / Authy

// Store encrypted in DB
const encryptedSecret = encrypt(secret, process.env.TOTP_ENCRYPTION_KEY);
await db.admin.update({ id, totpSecret: encryptedSecret, totpEnabled: true });
```

### 9.2 TOTP Verification

```typescript
function verifyTOTP(inputCode: string, storedEncryptedSecret: string): boolean {
  const secret = decrypt(storedEncryptedSecret, process.env.TOTP_ENCRYPTION_KEY);
  
  // Allow ±1 step tolerance (accounts for slight clock skew)
  return authenticator.verify({
    token: inputCode,
    secret,
    window: 1,
  });
}
```

### 9.3 Backup Codes

Generate 8 single-use backup codes at enrollment. Store as bcrypt hashes. When a backup code is used, mark it consumed and notify admin via email.

---

## 10. Audit Logging

### 10.1 Log Schema

Every auth event and admin action writes an immutable audit record:

```typescript
interface AuditLog {
  id: string;              // UUID
  timestamp: Date;
  adminId: string;
  sessionId: string;
  eventType: AuditEventType;
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
    country: string;
    userAgent: string;
    path: string;
    method: string;
  };
}
```

### 10.2 Audited Events

```
AUTH: LOGIN_SUCCESS, LOGIN_FAILURE, LOGOUT, TOKEN_REFRESH
      MFA_SUCCESS, MFA_FAILURE, STEP_UP_SUCCESS, STEP_UP_FAILURE
      SESSION_EXPIRED, SESSION_REVOKED, TOKEN_FAMILY_REVOKED

ACCESS: PERMISSION_DENIED, SENSITIVE_DATA_READ, EXPORT

CHANGES: ROUTE_CREATED, ROUTE_UPDATED, ROUTE_DELETED
         ADMIN_INVITED, ADMIN_SUSPENDED, ADMIN_UNSUSPENDED
         CONFIG_CHANGED

SECURITY: ANOMALY_DETECTED, BRUTE_FORCE_BLOCKED, FINGERPRINT_MISMATCH
          TOKEN_REUSE_DETECTED, SESSION_HIJACK_SUSPECTED
```

### 10.3 Log Protection

- Audit logs are write-only to standard admins. Even `SUPER_ADMIN` cannot delete or edit logs.
- Logs are streamed to an append-only store (S3/MinIO with Object Lock, or a dedicated log service).
- Retention: minimum 1 year for a university internal system.

---

## 11. Rate Limiting Strategy

### 11.1 Layered Rate Limits

```
Layer 1 (API Gateway / Nginx):
  All /admin/* routes: 300 req/min per IP

Layer 2 (Application, Redis-B):
  POST /admin/auth/login:    5 attempts / 15 min per IP
                             10 attempts / 1 hour per email (account lockout)
  POST /admin/auth/refresh:  20 req/min per sessionId
  POST /admin/auth/step-up:  3 attempts / 5 min per adminId
  Authenticated endpoints:   100 req/min per adminId (anomaly trigger at 80)
```

### 11.2 Account Lockout

```typescript
async function checkLoginRateLimit(email: string, ip: string): Promise<void> {
  const ipKey = `ratelimit:login:ip:${ip}`;
  const emailKey = `ratelimit:login:email:${sha256(email)}`; // hash email in key

  const [ipCount, emailCount] = await Promise.all([
    redisB.incr(ipKey),
    redisB.incr(emailKey),
  ]);

  // Set TTLs on first increment
  if (ipCount === 1) await redisB.expire(ipKey, 900);         // 15 min
  if (emailCount === 1) await redisB.expire(emailKey, 3600);  // 1 hour

  if (ipCount > 5 || emailCount > 10) {
    // Always return same error as wrong password (no enumeration)
    throw new AuthError('INVALID_CREDENTIALS', 'Invalid email or password');
  }
}
```

---

## 12. Security Headers & Transport

### 12.1 Required HTTP Security Headers

```typescript
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],         // No inline scripts
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],    // No embedding
    },
  },
  hsts: {
    maxAge: 63072000,                // 2 years
    includeSubDomains: true,
    preload: true,
  },
  referrerPolicy: { policy: 'no-referrer' },
  permissionsPolicy: { features: { geolocation: [] } },
}));
```

### 12.2 Admin Panel Access Restrictions

For a university internal system, restrict the admin panel to known IP ranges:

```nginx
# nginx.conf — admin panel IP allowlist
location /admin {
    # Allow university network ranges
    allow 10.0.0.0/8;        # Internal university network
    allow 172.16.0.0/12;     # VPN range
    deny all;

    proxy_pass http://app_server;
}
```

---

## 13. Admin Lifecycle Management

### 13.1 Invite Flow (Not Self-Registration)

Admins cannot self-register. Only `SUPER_ADMIN` can invite:

```
1. SUPER_ADMIN triggers invite (requires step-up token)
2. System generates: inviteToken = randomBytes(32).toString('hex')
3. Store in DB: { email, role, inviteTokenHash, expiresAt: now() + 48h }
4. Send email with link: https://admin.busapp.uni/accept-invite?token=<raw>
5. Invitee visits link → sets password + enrolls TOTP
6. On completion: create admin account, invalidate invite token
```

### 13.2 Admin Suspension

```typescript
async function suspendAdmin(
  targetAdminId: string,
  suspendedBy: string,
  reason: string
): Promise<void> {
  await db.transaction(async (trx) => {
    // Mark suspended
    await trx.admin.update({
      id: targetAdminId,
      isSuspended: true,
      suspendedAt: new Date(),
      suspendedBy,
      suspendReason: reason,
    });

    // Revoke all active sessions immediately
    await revokeAllSessionsForAdmin(targetAdminId);

    // Write audit log inside transaction
    await trx.auditLog.create({
      eventType: 'ADMIN_SUSPENDED',
      adminId: suspendedBy,
      details: { targetAdminId, reason },
    });
  });
}
```

---

## 14. Threat Model Summary

| Threat | Mitigation |
|---|---|
| Stolen refresh token | Family rotation + 24h hard expiry + fingerprint check |
| Stolen access token | 15-min TTL + blocklist on logout + session validation |
| Credential stuffing | Rate limiting per IP + per email + CAPTCHA after N failures |
| Session hijacking | Fingerprint drift detection + anomaly scoring + step-up |
| Privilege escalation | RBAC enforced server-side + step-up for sensitive actions |
| Insider threat | Audit logs + anomaly detection on bulk operations |
| Brute force (login) | Account lockout + rate limiting + constant-time comparison |
| Brute force (TOTP) | Rate limiting on MFA endpoint + lockout |
| Redis compromise | Security data split across instances + fail-closed |
| Token reuse attack | Family-based revocation on reuse detection |
| Replay attack | Short JWT TTL + jti blocklist |
| Enumeration | Identical error messages for invalid email vs. wrong password |

---

## 15. Implementation Priority Order

This is the order to build:

1. **Core login + JWT + TOTP** (foundation — nothing works without this)
2. **Session management in Redis-A** (blocklist, session record, fail-closed)
3. **Refresh token rotation with family tracking** (closes stolen-token hole)
4. **Absolute session lifetime enforcement** (closes Hole #2)
5. **Multi-signal fingerprinting** (closes Hole #1)
6. **RBAC middleware + permission matrix** (access control)
7. **Step-up authentication** (closes Hole #3)
8. **Audit logging** (immutable, all events)
9. **Anomaly scoring + adaptive response** (closes Hole #4)
10. **Redis-B separation + monitoring** (closes Hole #5)
11. **Rate limiting (layered)** (brute force hardening)
12. **Security headers + IP allowlist** (transport security)

---

## 16. Testing Requirements

Every security control needs a corresponding test:

- Token expiry: verify access is denied after 15 min, refresh after 24h
- Fingerprint mismatch: verify different-country IP triggers DENY
- Token family reuse: verify all sessions revoked on old token reuse
- Step-up expiry: verify sensitive action denied after 5 min
- Anomaly response: simulate 150 req/min, verify session force-reauth at medium score
- Redis failure: mock Redis-A unavailable, verify all requests denied (fail-closed)
- Suspended admin: verify immediate session termination on suspension
- TOTP bypass attempt: verify no TOTP = no access regardless of valid password
- Audit log: verify every event in Section 10.2 produces a log record
- Enumeration: verify login returns identical response for unknown email vs. wrong password

---

*This document represents the full auth specification for the university bus admin panel. Implementation questions should reference the section numbers above. Any deviation from this spec requires a security review.*
