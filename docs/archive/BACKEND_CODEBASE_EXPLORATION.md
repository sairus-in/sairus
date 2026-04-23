# Backend Codebase Structure — Comprehensive Exploration

**Date:** April 7, 2026  
**Backend Root:** `apps/backend/`

---

## 1. Directory Structure

```
apps/backend/
├── src/
│   ├── app.ts                    # Fastify app initialization w/ plugin registration
│   ├── server.ts                 # Server startup, signal handling, graceful shutdown
│   ├── db/
│   │   └── prisma/
│   │       └── schema.prisma     # Prisma schema (User, AdminUser, Bus, Trip, auth models)
│   ├── lib/                      # Shared utilities & infrastructure
│   │   ├── auth-*.ts             # Auth utilities (cache, config, revocation, etc.)
│   │   ├── admin-*.ts            # Admin-specific utilities (MFA, session, access)
│   │   ├── *.ts                  # Error handling, Redis, JWT, logger, email, etc.
│   ├── middleware/
│   │   ├── route-guards.ts       # mobileRoute(), adminRoute() helpers
│   │   └── cloud-task.middleware.ts
│   ├── modules/                  # Feature modules (each has routes/service/repository layers)
│   │   ├── auth/
│   │   │   ├── auth.middleware.ts
│   │   │   ├── auth.routes.ts
│   │   │   ├── mobile-auth.service.ts
│   │   │   ├── mobile-auth.repository.ts
│   │   │   ├── admin-auth.middleware.ts
│   │   │   ├── admin-auth.routes.ts
│   │   │   ├── admin-auth.service.ts
│   │   │   ├── admin-auth.repository.ts
│   │   │   ├── admin-auth.middleware.test.ts
│   │   │   └── scopeCoordinator.ts
│   │   ├── student/              # Student routes, services, repositories
│   │   ├── gps/
│   │   ├── trips/
│   │   ├── attendance/
│   │   ├── incidents/
│   │   ├── users/
│   │   ├── admin/                # Admin dashboard features
│   │   ├── fleet/
│   │   ├── driver/
│   │   ├── routes/
│   │   ├── import/
│   │   ├── notifications/
│   │   ├── qr/
│   │   ├── rag/
│   │   ├── jobs/
│   │   └── drivers/
│   ├── plugins/
│   │   ├── idempotency.ts        # Idempotency middleware
│   │   └── request-context.ts    # Request context plugin
│   ├── websocket/
│   │   ├── socket.ts             # Socket.io setup
│   │   └── cleanup.manager.ts
│   ├── jobs/                     # Background job workers
│   │   ├── notification.worker.ts
│   │   ├── reconcile-redis.job.ts
│   │   ├── gps-delegate-heartbeat.job.ts
│   │   ├── mark-absent.job.ts
│   │   ├── late-start-alert.job.ts
│   │   └── (additional job files)
│   ├── scripts/
│   │   ├── seed-admin.ts
│   │   ├── verify-phase4.ts
│   │   ├── e2e-smoke.ts
│   │   ├── load-test.ts
│   │   └── backfill-admin-scope.ts
│   ├── types/
│   │   └── fastify.d.ts          # Fastify module augmentation
│   └── dist/                     # Compiled output (generated)
├── package.json                  # Dependencies & scripts
├── tsconfig.json                 # TypeScript configuration
├── Dockerfile
├── .env                          # Local environment variables
├── .turbo/                       # Turbo build cache
├── node_modules/
└── errors.txt / log-ts.js        # Dev logs

```

---

## 2. Current Authentication Implementation

### 2.1 Mobile User Authentication Flow

**Location:** `src/modules/auth/auth.middleware.ts`, `auth.routes.ts`, `mobile-auth.service.ts`

#### Key Components:

- **Middleware:** `requireMobileAuth`
  - Validates Bearer token from `Authorization` header
  - Checks JWT signature, expiration, and issuer/audience
  - Validates token type (must be `MOBILE`)
  - Verifies token structure (sub, deviceId, sv, role)
  - **7-point security checks:**
    1. Token present
    2. JWT signature valid & not expired
    3. Token type validation
    4. Required fields present
    5. User exists & active status
    6. Session version match (prevents old JWTs)
    7. Forced relogin cutoff (emergency revocation)

- **Routes:** `POST /login`, `POST /refresh`, `POST /logout`, `POST /logout-all`, `GET /me`

- **Service:** `mobile-auth.service.ts`
  - `mobileLogin(firebaseToken, deviceId, ipAddress)`
  - `mobileRefresh(firebaseToken, deviceId)`
  - `mobileLogout(userId, deviceId)`
  - `revokeAllSessionsForUser(userId, deviceId)`
  - `getMobileUserProfile(userId)`

- **Repository:** `mobile-auth.repository.ts`
  - `findUserByPhoneWithRouteAssignment(phone)`
  - `findUserByPhoneForRefresh(phone)`
  - Database queries only — no business logic

#### Rate Limiting:
- **Login (IP-based):** 10 attempts / 60 seconds
- **Login (Phone-based):** 5 attempts / 300 seconds
- **Refresh (IP-based):** 15 attempts / 60 seconds

#### Device Binding:
- One device per user (stored in `User.registeredDeviceId`)
- Device ID is hashed in JWT payload (`deviceId` field)
- Mismatch rejection with audit logging

#### Session Management:
- `sessionVersion` field enforces invalidation
- Can bump version to instantly revoke all sessions
- Firebase Authentication integration for mobile

---

### 2.2 Admin Authentication Flow

**Location:** `src/modules/auth/admin-auth.middleware.ts`, `admin-auth.routes.ts`, `admin-auth.service.ts`

#### Key Components:

- **Middleware:** `requireAdminAuth`
  - JWT from **httpOnly cookie** (`admin_jwt`)
  - Same 7-point validation as mobile (adapted for admin)
  - CSRF protection (validates X-CSRF-Token header)
  - MFA enforcement (optional pending production blocker comment)

- **Routes:** 
  - `POST /login` — email/password authentication
  - `POST /verify-mfa` — MFA code verification
  - `GET /me` — current user profile
  - `POST /logout` — clear session
  - `POST /password-reset` — request reset
  - `POST /password-reset-confirm` — confirm reset
  - `POST /mfa/setup` — enable MFA
  - `POST /invite` — invite new admin

- **Service:** `admin-auth.service.ts`
  - `adminLogin(email, password, ip, userAgent, reply)`
  - `verifyAdminLoginMfa(challengeToken, code, ip, userAgent, reply)`
  - MFA enforcement (TOTP-based using otplib)
  - Session cookie setup

- **Repository:** `admin-auth.repository.ts`
  - `getUserByEmailForAuth(email)`
  - `getUserById(adminId)`
  - `findAdminByEmail(email)`
  - `verifyPasswordHash(hash, plainPassword)`
  - `hashPassword(plainPassword)`
  - `createAdminInvite(...)`
  - Password reset operations

#### Rate Limiting:
- **Login:** IP-based with account lockout
- **Forgot Password:** Rate limited per email
- **Invite:** Rate limited to prevent enumeration

#### MFA (Multi-Factor Authentication):
- **Library:** otplib v13.4.0 (TOTP-based)
- **Issuer:** "College Bus Admin" (configurable)
- **Encryption:** AES for storing MFA secrets
- **Challenge Tokens:** Short-lived (5 min) tokens for flow
- **Status:** Currently bypassed for local dev (see TODO comment in middleware)

---

### 2.3 Database Models

**Location:** `src/db/prisma/schema.prisma`

#### User Model (Mobile Users):
```prisma
model User {
  id: String @id                        // cuid()
  phone: String @unique                 // Primary identifier
  name: String
  email: String?
  role: Role (STUDENT, DRIVER, etc.)
  firebaseUid: String? @unique          // Firebase authentication
  registeredDeviceId: String?           // Device binding
  sessionVersion: Int @default(1)       // Session invalidation
  authStatus: AuthStatus                // PENDING_PROVISIONING, ACTIVE, DISABLED
  forcedReloginAt: DateTime?            // Emergency revocation cutoff
  lastLoginAt: DateTime?
  deviceBoundAt: DateTime?
  isActive: Boolean @default(true)
  // ... other fields
}

@@index([phone])
@@index([role])
```

#### AdminUser Model:
```prisma
model AdminUser {
  id: String @id
  email: String @unique
  name: String
  passwordHash: String                  // bcrypt(12) cost
  role: AdminRole (COORDINATOR, TRANSPORT_OFFICER, FACULTY, MANAGEMENT)
  sessionVersion: Int @default(1)
  mfaEnabled: Boolean @default(false)
  mfaSecretEncrypted: String?          // AES encrypted
  passwordResetTokenHash: String?
  passwordResetExpiresAt: DateTime?
  inviteTokenHash: String?
  inviteTokenExpiresAt: DateTime?
  lastLoginAt: DateTime?
  lastLoginIp: String?
  lastLoginUserAgent: String?
  isActive: Boolean @default(true)
  createdById: String?
  deactivatedAt: DateTime?
  deactivatedById: String?
  
  scopes: AdminScope[]
  authAuditEvents: AuthAuditEvent[] @relation("AdminAuditEvents")
}

@@map("admin_users")
```

#### AdminScope Model (Coordinator Scoping):
```prisma
model AdminScope {
  id: String @id
  adminUserId: String
  routeId: String?                      // Route-scoped access
  department: String?                   // Department-scoped access
  
  adminUser: AdminUser @relation(...)
  route: Route? @relation(...)
  
  @@unique([adminUserId, routeId])
  @@unique([adminUserId, department])
}
```

#### AuthAuditEvent Model (Immutable Audit Log):
```prisma
model AuthAuditEvent {
  id: String @id
  actorType: String (MOBILE_USER, ADMIN)
  actorId: String?
  targetType: String?
  targetId: String?
  eventType: AuthAuditEventType
  ipAddress: String?
  deviceId: String?
  metadata: Json?
  createdAt: DateTime @default(now())
  
  mobileUser: User? @relation("SubjectAuditEvents", ...)
  adminUser: AdminUser? @relation("AdminAuditEvents", ...)
  
  @@index([actorId, createdAt])
  @@index([eventType, createdAt])
}
```

#### Enums:
- **Role:** STUDENT, STAFF, DRIVER, COORDINATOR, TRANSPORT_OFFICER, FACULTY, MANAGEMENT, NCC_OFFICER
- **AdminRole:** COORDINATOR, TRANSPORT_OFFICER, FACULTY, MANAGEMENT
- **AuthStatus:** ACTIVE, PENDING_PROVISIONING, AUTH_PROVISION_FAILED, DISABLED
- **AuthAuditEventType:** 30+ event types (LOGIN_SUCCESS, MFA_VERIFIED, SESSION_REVOKED, etc.)

---

## 3. Middleware Structure

### 3.1 Route Guards

**Location:** `src/middleware/route-guards.ts`

Two primary authorization helpers (all routes must use exactly one):

```typescript
// Mobile app routes
mobileRoute(roles: ('STUDENT' | 'DRIVER' | 'PARENT')[]): preHandlerHookHandler[]
  - Applies requireMobileAuth + requireRole(roles)

// Admin panel routes
adminRoute(roles: AdminRole[], scoped?: boolean): preHandlerHookHandler[]
  - Applies requireAdminAuth + requireAdminRole(roles)
  - If scoped=true: injects coordinatorRouteIds for scope enforcement
```

### 3.2 Cloud Task Middleware

**Location:** `src/middleware/cloud-task.middleware.ts`

- Validates GCP Cloud Tasks headers
- Used for background job handlers

### 3.3 Additional Middleware (in app.ts)

- **CORS:** Origins validated at request time in prod
- **Cookie:** @fastify/cookie for session management
- **Request ID:** From header or generated UUID
- **Idempotency:** Custom plugin for request deduplication
- **Request Context:** Structured logging context

---

## 4. Error Handling Patterns

**Location:** `src/lib/errors.ts`

### AppError Class

All business logic errors thrown as `AppError` instances:

```typescript
class AppError extends Error {
  statusCode: number
  code: ErrorCode                    // From 'shared' package
  details?: unknown
  retryable: boolean
}

// Three supported signatures:
new AppError(statusCode, code, details?)           // Primary
new AppError(message, statusCode, code)            // Legacy
new AppError(message, statusCode, code, details)   // Legacy with details
```

### Global Error Handler

- Catches AppError in Fastify
- Normalizes to JSON response
- Returns: `{ ok: false, error: { code, message, statusCode, details, retryable }, requestId }`

### Error Codes (from shared package)
- Centralized in `packages/shared/` for cross-platform consistency
- Examples: `UNAUTHORIZED`, `TOKEN_EXPIRED`, `USER_NOT_FOUND`, `SESSION_REVOKED`, `RATE_LIMITED`, etc.

---

## 5. Module Organization

Each feature module follows strict layering:

```
modules/<feature>/
├── <feature>.middleware.ts         # HTTP-only validation & auth checks
├── <feature>.routes.ts             # Route handlers (thin, coordinate)
├── <feature>.service.ts            # Business logic & coordination
├── <feature>.repository.ts         # Database queries (Prisma only)
└── <feature>.test.ts               # Unit tests
```

### Auth Module Example

**`auth.middleware.ts`** (HTTP layer)
```typescript
requireMobileAuth(req, reply)
- Validates JWT
- Checks auth state
- Attaches user to req.user
```

**`auth.routes.ts`** (HTTP layer)
```typescript
POST /login(firebaseToken, deviceId)
POST /refresh(firebaseToken, deviceId)
POST /logout()
GET /me()
POST /logout-all()
```

**`mobile-auth.service.ts`** (Business logic)
```typescript
mobileLogin(firebaseToken, deviceId, ip)
  - Verify Firebase token
  - Rate limit checks
  - Device binding logic
  - JWT issuance
  - Audit logging
  
mobileRefresh(firebaseToken, deviceId)
  - Minimal re-validation
  - New JWT with same session

mobileLogout(userId, deviceId)
  - Revoke device binding or session
```

**`mobile-auth.repository.ts`** (Database)
```typescript
findUserByPhoneWithRouteAssignment(phone)
findUserByPhoneForRefresh(phone)
// Prisma queries only — no logic
```

---

## 6. JWT Implementation

**Location:** `src/lib/jwt.ts`, `src/lib/auth-config.ts`

### Configuration:
```typescript
jwtConfig = {
  secret: env.JWT_SECRET              // 32+ char required
  issuer: 'college-bus-system'
  mobileAudience: 'college-bus-mobile'
  adminAudience: 'college-bus-admin'
  algorithm: 'HS256'
}
```

### Mobile JWT Payload:
```typescript
interface MobileJWTPayload {
  sub: string                         // user ID
  type: 'MOBILE'
  role: Role
  deviceId: string                    // device hash
  sv: number                          // session version
  iat: number                         // issued at
  exp: number                         // expiration (24 hours)
}
```

### Admin JWT Payload:
```typescript
interface AdminJWTPayload {
  sub: string
  type: 'ADMIN'
  role: AdminRole
  email: string
  sv: number                          // session version
  iat: number
  exp: number                         // 8 hours
}
```

### Token Validation Layers:
1. **Signature:** HS256 verification
2. **Expiration:** JWT.verify checks `exp` claim
3. **Issuer/Audience:** Cross-checked in middleware
4. **Device Binding:** Matches JWT deviceId vs registered
5. **Session Version:** sv field prevents old tokens
6. **Blacklist:** Optional Redis check for forced logouts
7. **Forced Relogin:** Cutoff timestamp prevents pre-cutoff tokens

---

## 7. Redis Setup

**Location:** `src/lib/redis.ts`

### Client Configuration:
```typescript
const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3
  retryStrategy: exponential backoff (max 2s)
  enableReadyCheck: true
  lazyConnect: false
})
```

### Connection Targets:
- **Development:** Local Docker Redis (redis://localhost:6379)
- **Production:** Upstash Redis (rediss://) with auto TLS or GCP Memorystore

### Key Patterns Used:

**Auth Caching:**
- `auth:user:{userId}` → MobileAuthState (TTL: 24h)
- `auth:admin:{adminId}` → AdminAuthState (TTL: 24h)

**Rate Limiting:**
- `ratelimit:mobile:login:{ip}` (60s window)
- `ratelimit:mobile:login:phone:{phone}` (300s window)
- `ratelimit:admin:login:{email}` (with account lockout)

**Session Management:**
- `jwt:blacklist:{userId}` (immediate logout, TTL: 24h)
- `admin:csrf:{adminId}` (CSRF tokens)

**QR Operations:**
- `qr:nonce:{nonce}` (one-time use, SET NX)
- `qr:jwt:{tokenId}` (temporary JWT storage)

**Realtime GPS:**
- `gps:live:{busId}` (continuous overwrite, realtime DB)

---

## 8. Configuration & Environment Setup

**Location:** `src/lib/env.ts`

### Required Environment Variables (Production):

```typescript
NODE_ENV: 'production'
PORT: number (default 3000)
HOST: string (default '0.0.0.0')
DATABASE_URL: string (PostgreSQL connection)
REDIS_URL: string (Upstash or Memorystore)
JWT_SECRET: string (min 16 chars, 32+ recommended)
JWT_ISSUER: string (default 'college-bus-system')
JWT_MOBILE_AUDIENCE: string
JWT_ADMIN_AUDIENCE: string
CORS_ALLOWED_ORIGINS: string (comma-separated, REQUIRED in prod)
BACKEND_URL: string (public URL, NO localhost in prod)
GOOGLE_CLOUD_PROJECT: string (REQUIRED in prod)
CLOUD_TASKS_QUEUE: string (GCP Cloud Tasks queue name)
ADMIN_MFA_ISSUER: string (TOTP issuer name)
ADMIN_MFA_ENCRYPTION_KEY: string (32+ char, for MFA secret encryption)
FIREBASE_PROJECT_ID: string
FIREBASE_DATABASE_URL: string
FIREBASE_SERVICE_ACCOUNT_JSON: string
MSG91_AUTH_KEY: string (SMS provider)
MSG91_ALERT_TEMPLATE_ID: string
```

### Optional:
- `ADMIN_COOKIE_DOMAIN` (for subdomain cookies)
- `CLOUD_TASKS_SA_EMAIL`, `CLOUD_TASKS_SECRET`

### Validation:
- Zod schema enforces required fields and formats
- Production mode adds stricter checks (CORS, BACKEND_URL, etc.)
- Fails fast on startup if invalid

---

## 9. Testing Structure

**Location:** `src/**/*.test.ts` (8 test files found)

### Test Files Present:

1. **`src/modules/auth/admin-auth.middleware.test.ts`**
   - Tests requireAdminAuth middleware
   - Mocks getAuthAdminState
   - Validates JWT parsing, CSRF cookie setup

2. **`src/lib/admin-mfa.test.ts`**
   - MFA secret generation & verification
   - TOTP code validation

3. **`src/lib/admin-session.test.ts`**
   - CSRF token validation
   - Cookie handling

4. **`src/lib/admin-access.test.ts`**
   - Coordinator scoping logic
   - Route/department access checks

5. **`src/lib/errors.test.ts`**
   - AppError constructor signatures
   - Error code mapping

6. **`src/modules/admin/reports.service.test.ts`**
   - Admin reporting functionality

7. **`src/jobs/reconcile-dashboard-stats.job.test.ts`**
   - Background job logic

8. **`src/modules/student/student-home.contract.test.ts`**
   - Student API contract testing

### Test Framework:
- **Vitest** v.latest (modern, Vite-native)
- Environment mocking with `vi.stubEnv()`
- Promise-based async/await patterns

### Test Patterns:
```typescript
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubEnv('NODE_ENV', 'test')
  // ... stub all env vars
})

afterEach(() => {
  vi.unstubAllEnvs()
})

it('test case', async () => {
  const imported = await import('./module')
  expect(imported.fn()).toBe(expected)
})
```

---

## 10. Shared Libraries & Utilities

### Auth-Related Files in `lib/`:

| File | Purpose |
|------|---------|
| `auth-cache.ts` | Redis caching for user auth state (mobile & admin) |
| `auth-config.ts` | JWT config object & CORS origin resolution |
| `auth-audit.ts` | Write auth events to AuthAuditEvent table |
| `auth-revocation.ts` | Bump session version, blacklist tokens, force relogin |
| `auth-state-change.ts` | Transactional auth state updates |
| `admin-mfa.ts` | TOTP generation, secret encryption, challenge tokens |
| `admin-session.ts` | httpOnly cookie setup, CSRF token validation |
| `admin-access.ts` | Coordinator scope resolution & route filtering |
| `admin-alerts.ts` | Admin notification logic |
| `errors.ts` | AppError class & global error handler integration |
| `logger.ts` | Structured JSON logging (JSON in prod, pretty in dev) |
| `jwt.ts` | JWT decoding helpers (QR tokens, etc.) |
| `password-policy.ts` | Admin password strength validation |
| `redis.ts` | Redis client initialization |
| `email.ts` | Email sending stubs (ready for Resend/SendGrid) |
| `firebase.ts` | Firebase Admin SDK initialization |
| `prisma.ts` | Prisma Client singleton |
| `cache.ts` | Generic caching utilities |
| `rate-limit.ts` | Rate limit helpers |
| `metrics.ts` | Prometheus metrics (optional) |
| `cloud-tasks.ts` | GCP Cloud Tasks client |

---

## 11. Key Architectural Decisions

### 1. **Layer Separation (Routes → Service → Repository)**
   - Routes: HTTP only, req/res validation
   - Service: Business logic, coordination, transactions
   - Repository: Database queries via Prisma only

### 2. **Auth Cache Strategy**
   - Redis: 24-hour TTL (matches JWT lifetime)
   - Fallback: Database hit if cache miss
   - Invalidated on password reset, MFA toggle, account disable

### 3. **Session Management**
   - Mobile: sessionVersion-based invalidation (can revoke all instantly)
   - Admin: httpOnly cookie + CSRF protection
   - Both: Optional Redis blacklist for forced logout

### 4. **Device Binding**
   - One device per user (registered at first login)
   - Device ID hashed in JWT (prevents token sharing)
   - Mismatch = immediate rejection

### 5. **Error Handling**
   - Centralized AppError class
   - Shared error codes across mobile/web/api
   - Structured logging to Cloud Logging in prod

### 6. **Idempotency**
   - Custom Fastify plugin (checks Idempotency-Key header)
   - Prevents duplicate check-ins, corrections, notifications
   - Critical for mobile retry scenarios

### 7. **Background Jobs**
   - Google Cloud Tasks (not node-cron)
   - Ensures jobs survive Cloud Run restarts
   - HTTP-triggered from Cloud Scheduler or queue

### 8. **Coordinator Scoping**
   - AdminScope model defines per-admin access
   - Route-based or department-based isolation
   - Enforced at service layer per request

---

## 12. Startup & Graceful Shutdown

**Location:** `src/server.ts`

### Server Initialization Order:
1. Load `.env` with dotenv
2. Initialize Fastify app
3. Register plugins (CORS, cookie, idempotency, etc.)
4. Mount routes
5. Connect to Prisma, Redis, Firebase
6. Setup WebSocket with Socket.io
7. Start background jobs (delegate monitor, notification worker)
8. Listen on host:port

### Graceful Shutdown (SIGTERM/SIGINT):
```
Signal → shuttingDown flag → Stop delegate monitor
        → app.close() (drain requests)
        → closeWebsocket()
        → closeNotificationWorker()
        → prisma.$disconnect()
        → redis.quit()
        → Exit with code 0 or 1
```

---

## 13. Key Files Reference

| Path | Lines | Purpose |
|------|-------|---------|
| [src/modules/auth/auth.middleware.ts](src/modules/auth/auth.middleware.ts) | ~130 | Mobile JWT validation (7-point check) |
| [src/modules/auth/auth.routes.ts](src/modules/auth/auth.routes.ts) | ~80 | Mobile auth endpoints (/login, /refresh, /logout, /me) |
| [src/modules/auth/mobile-auth.service.ts](src/modules/auth/mobile-auth.service.ts) | ~200+ | Mobile login/logout logic, Firebase integration |
| [src/modules/auth/mobile-auth.repository.ts](src/modules/auth/mobile-auth.repository.ts) | ~100+ | Prisma queries for mobile auth |
| [src/modules/auth/admin-auth.middleware.ts](src/modules/auth/admin-auth.middleware.ts) | ~80 | Admin JWT validation, CSRF check |
| [src/modules/auth/admin-auth.routes.ts](src/modules/auth/admin-auth.routes.ts) | ~150+ | Admin endpoints (/login, /verify-mfa, /me, /logout, etc.) |
| [src/modules/auth/admin-auth.service.ts](src/modules/auth/admin-auth.service.ts) | ~200+ | Admin login, MFA flow, password reset |
| [src/modules/auth/admin-auth.repository.ts](src/modules/auth/admin-auth.repository.ts) | ~120+ | Prisma queries for admin, bcrypt operations |
| [src/lib/auth-cache.ts](src/lib/auth-cache.ts) | ~80+ | Redis caching for auth state |
| [src/lib/admin-mfa.ts](src/lib/admin-mfa.ts) | ~150+ | TOTP generation, secret encryption |
| [src/lib/admin-session.ts](src/lib/admin-session.ts) | ~100+ | httpOnly cookie & CSRF token setup |
| [src/lib/errors.ts](src/lib/errors.ts) | ~80+ | AppError class definition |
| [src/lib/redis.ts](src/lib/redis.ts) | ~50 | Redis client with retry strategy |
| [src/lib/env.ts](src/lib/env.ts) | ~60 | Environment validation with Zod |
| [src/middleware/route-guards.ts](src/middleware/route-guards.ts) | ~50 | mobileRoute() & adminRoute() helpers |
| [src/app.ts](src/app.ts) | ~200+ | Fastify app setup, plugin registration |
| [src/server.ts](src/server.ts) | ~80+ | Server startup & shutdown |
| [src/db/prisma/schema.prisma](src/db/prisma/schema.prisma) | ~900 | Complete database schema |

---

## 14. Current State Summary

### ✅ Implemented:
- Mobile Firebase + JWT authentication
- Admin email/password + MFA (TOTP)
- Session management with version-based invalidation
- Device binding for mobile
- Coordinator scope isolation
- Rate limiting (IP & phone-based for mobile, email-based for admin)
- Auth audit event logging (immutable append-only)
- Redis caching for fast auth checks
- CSRF protection on admin routes
- Graceful shutdown with connection cleanup
- Environment validation & secrets management
- Password hashing (bcrypt-12)
- Structured error handling & logging

### ⚠️ In Progress / Pending:
- MFA enforcement for admin (bypassed in local dev, needs re-enable for production)
- Email service integration (currently logs only, ready for Resend/SendGrid)
- Password reset email sending
- Admin invite email sending
- Complete test coverage (8 tests present, more needed)

### 🔌 External Integrations:
- **Firebase Admin SDK:** Mobile user authentication (email/password)
- **Upstash Redis:** Caching, rate limiting, session management
- **Google Cloud Tasks:** Background job queue
- **PostgreSQL:** Data persistence
- **Socket.io:** Real-time communication (GPS, events)
- **MSG91:** SMS notifications
- **otplib:** TOTP generation

---

## 15. Development vs Production Differences

| Aspect | Development | Production |
|--------|-------------|-----------|
| CORS Origins | Auto-allow localhost:5173, :3000, etc. | Require CORS_ALLOWED_ORIGINS env var |
| Logging | Pretty-printed console | Structured JSON (Cloud Logging) |
| Error Details | Full stack traces returned | Limited details in response |
| Redis | Local Docker (no TLS) | Upstash (rediss://) or Memorystore |
| MFA Enforcement | Bypassed (TODO) | Required for TRANSPORT_OFFICER, MANAGEMENT |
| Email | Logged only | Actually sent via Resend/SendGrid |
| Cloud Tasks | Simulated locally | Real GCP Cloud Tasks |
| JWT Secret | Can be short (dev only) | Must be 32+ chars |

---

## 16. Next Steps for Implementation

If you're building new features:

1. **Create new module** in `src/modules/<feature>/`
2. **Define routes** in `<feature>.routes.ts`
3. **Add middleware** in `<feature>.middleware.ts` (if auth needed)
4. **Write service** in `<feature>.service.ts` (business logic)
5. **Write repository** in `<feature>.repository.ts` (Prisma queries)
6. **Register routes** in `src/app.ts`
7. **Add tests** in `<feature>.test.ts`
8. **Update Prisma schema** if new models needed (`prisma db push`)

---

**End of Exploration Report**
