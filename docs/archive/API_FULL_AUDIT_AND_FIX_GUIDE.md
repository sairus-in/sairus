# API Full Audit & Fix Guide
**College Bus Management System — Definitive Senior Dev Assessment**
**Date:** April 3, 2026 | **Scope:** 119 Endpoints, 14 Route Modules, ~8,000 Lines Audited**

---

## Table of Contents

1. [Honest Overall Assessment](#1-honest-overall-assessment)
2. [What the New Audit Changes](#2-what-the-new-audit-changes)
3. [The Real Blocking Issues](#3-the-real-blocking-issues)
4. [Security Vulnerabilities — Ranked and Explained](#4-security-vulnerabilities--ranked-and-explained)
5. [Response Contract — The Full Fix](#5-response-contract--the-full-fix)
6. [Authentication & Authorization — What's Actually Good](#6-authentication--authorization--whats-actually-good)
7. [Type Safety & Validation](#7-type-safety--validation)
8. [Idempotency — Still Missing, Still Critical](#8-idempotency--still-missing-still-critical)
9. [Performance & Query Analysis](#9-performance--query-analysis)
10. [Implementation Order — Revised](#10-implementation-order--revised)
11. [Testing Strategy](#11-testing-strategy)
12. [What Not to Touch](#12-what-not-to-touch)

---

## 1. Honest Overall Assessment

The first audit (the executive summary document) painted a bleak picture — F grades, "do not deploy," fundamental architectural failures. The comprehensive line-by-line audit tells a more accurate story: **this API is actually well-built**. Someone put real thought into it.

The graded assessment is:

| Category | Grade | Reasoning |
|---|---|---|
| Authentication | A | 8-point JWT verification, device binding, session versioning, blacklist — genuinely excellent |
| Authorization | A | RBAC with coordinator scoping, role-based serializers, well-enforced |
| Input Validation | A | 100% Zod coverage across all 119 endpoints |
| Error Handling | A | Consistent `AppError` pattern, proper envelopes |
| HTTP Contracts | A | Mostly correct — pagination inconsistency is real but minor in scope |
| Security Posture | A- | Strong across the board; CSRF gap and audit log exposure are the only genuine issues |
| Performance | B | Nested includes are heavy but not N+1; missing bulk limits is the real risk |
| Documentation | C | Nothing external, undocumented features (device binding, session versioning) |

The original first audit was written without seeing the full codebase. It flagged things as missing that are actually implemented. The comprehensive audit corrects this — authorization scoping works, coordinator limits are enforced, serializers are role-based. What remains to fix is smaller in scope than the first audit implied, but still real.

**Deployment verdict:** Ready to deploy after 5 specific fixes. Estimated total fix time: 8–10 hours.

---

## 2. What the New Audit Changes

Several issues from the first audit document are not actually problems. This matters because chasing false issues wastes time and risks introducing regressions.

**Not actually broken:**

- **Coordinator scoping** — the first audit said `POST /:studentId/assign` was missing `scopeCoordinator`. The comprehensive audit shows the coordinator scope logic is implemented correctly in the `whereClause` building. The `BANNED` sentinel value defense against scope escalation is actually a smart pattern. Verify before touching.

- **Authorization pattern consolidation** — the four patterns exist but they are not security gaps. `requireAdminRole` correctly bundles `authenticate`. The inconsistency is aesthetic, not dangerous. It is a refactor, not a fix.

- **Device binding** — already enforced on sensitive operations. Not universally applied everywhere, but the coverage matches the threat model.

- **Error handling** — the `AppError` pattern is consistent across all modules. The "Pattern B" uncaught errors flagged in the first audit are the standard Fastify behavior for unhandled exceptions, not a design flaw.

- **Deprecated endpoints** — 410 Gone is actually a reasonable choice here since these endpoints are broken stubs that return no data. Using Deprecation headers (as recommended earlier) is better practice, but 410 is not actively harmful.

**Still real issues:**

The five issues below are confirmed across all four documents and are genuinely blocking or high-risk.

---

## 3. The Real Blocking Issues

### Blocker 1: UUID/CUID Mismatch in Incidents (5 minutes to fix)

**Confirmed across all documents. This is the only true production blocker.**

Every trip ID in the database is a CUID (`@default(cuid())` in Prisma schema). The incidents route validates `tripId` as UUID format. A CUID will never pass UUID validation. This means `POST /v1/incidents/report` returns 400 for every valid request. Drivers cannot report incidents. It has been broken since the endpoint was written.

```typescript
// apps/backend/src/modules/incidents/incidents.routes.ts line 14
// CURRENT — rejects every valid tripId in the database
tripId: z.string().uuid(),

// FIXED — matches Trip.id @default(cuid())
tripId: z.string().cuid(),
```

Deploy this first, before anything else. It takes five minutes and unblocks a broken feature.

### Blocker 2: Pagination Response Format Inconsistency (2 hours)

**Confirmed across all documents. Twelve endpoints affected.**

The mobile SDK breaks when it receives unexpected shapes from list endpoints. There are three different shapes currently in production:

```typescript
// Shape 1 — users list (flat, no success key)
{ data: [...], total: 150, page: 1, limit: 50 }

// Shape 2 — attendance history (double-wrapped data)
{ success: true, data: { data: [...], pagination: { page, limit, total, hasMore } } }

// Shape 3 — audit log (different key name)
{ total: 150, page: 1, limit: 50, entries: [...] }
```

The target is one shape everywhere:

```typescript
// ALL list endpoints, standardized
{
  success: true,
  data: T[],
  pagination: {
    page: number,
    limit: number,
    total: number,
    hasMore: boolean
  }
}
```

The attendance history double-nesting (`data.data`) is the worst offender — the mobile client has to write `response.data.data` to get the actual array, which is fragile and hard to type.

Affected endpoints to migrate:
- `GET /v1/users/` — flatten pagination to top level
- `GET /v1/attendance/history` — remove double-nesting
- `GET /v1/admin/audit-log` — rename `entries` to `data`, add `success` key
- `GET /v1/routes/` — add pagination wrapper (currently raw array)
- `GET /v1/fleet/buses` — add pagination wrapper (currently raw array)
- `GET /v1/admin/corrections` — add pagination wrapper (currently raw array)
- `GET /v1/admin/messages` — standardize
- `GET /v1/admin/incidents` — standardize

Use the shared helpers from `packages/shared/src/lib/response.ts`:

```typescript
// Create once, use everywhere
export function ok<T>(data: T) {
  return { success: true as const, data };
}

export function okList<T>(data: T[], pagination: Pagination) {
  return { success: true as const, data, pagination };
}

export function fail(code: string, message: string, details?: unknown) {
  return { success: false as const, error: code, message, ...(details ? { details } : {}) };
}

// Then in every list route:
return reply.send(okList(items, { page, limit, total, hasMore: total > page * limit }));
```

### Blocker 3: CSRF Token Validation Missing (1 hour)

**Confirmed in security vulnerabilities report. CVSS 7.1.**

The API declares support for `X-CSRF-Token` in CORS headers but never validates the token. The `allowedHeaders` declaration in `app.ts` is misleading — it signals to browsers that CSRF protection exists, but the middleware to enforce it was never added.

The attack path: an attacker hosts a form on `evil.com` that auto-submits to `POST /v1/admin/corrections/:id/resolve`. If an admin is logged in (cookie is set), the request succeeds because the browser includes the session cookie and the server does not check origin. The `credentials: true` CORS setting makes this worse, not better, because it explicitly allows cookie credentials across origins.

```typescript
// Install the official Fastify plugin
// npm install @fastify/csrf-protection

// apps/backend/src/app.ts
import fastifyCsrf from '@fastify/csrf-protection';

// Register BEFORE routes
await app.register(fastifyCsrf, {
  sessionPlugin: '@fastify/cookie', // or your session plugin
});
```

This protects all state-changing endpoints (POST, PATCH, PUT, DELETE) automatically without per-route work.

### Blocker 4: Audit Log Exposes Sensitive Data (1 hour)

**Confirmed in security vulnerabilities report. CVSS 6.5.**

The `GET /v1/admin/audit-log` endpoint returns `before` and `after` fields containing the raw entity state before and after each change. If an admin's password was changed, the `before` field contains the old bcrypt hash. If Firebase tokens were ever stored on the entity, they appear in the log. If the audit logs are ever breached (backup exposed, developer access, third-party log aggregator), those fields become a data dump.

```typescript
// The fix is a sanitization function applied to before/after before sending

const SENSITIVE_KEYS = [
  'password', 'passwordHash', 'firebaseToken', 'fcmToken',
  'refreshToken', 'apiKey', 'secret', 'token', 'inviteToken',
];

function sanitizeAuditFields(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data;
  const copy = { ...(data as Record<string, unknown>) };
  for (const key of SENSITIVE_KEYS) {
    if (key in copy && copy[key]) {
      copy[key] = '[REDACTED]';
    }
  }
  return copy;
}

// In the audit-log endpoint response:
entries: entries.map((entry) => ({
  id: entry.id,
  actor: entry.actor,
  action: entry.action,
  entityType: entry.entityType,
  entityId: entry.entityId,
  before: sanitizeAuditFields(entry.before),  // sanitized
  after: sanitizeAuditFields(entry.after),    // sanitized
  createdAt: entry.createdAt,
})),
```

### Blocker 5: Missing Bulk Operation Limits (15 minutes)

**Confirmed. DOS vector, low effort to fix.**

Two endpoints accept arrays with no maximum size:

```typescript
// users.routes.ts — no upper bound
studentIds: z.array(z.string().cuid()).min(1),  // can be 1,000,000

// import.routes.ts — no upper bound
rows: z.array(importRowSchema),  // can be 100,000+
```

A coordinator who accidentally selects all students will send thousands of IDs. The Prisma transaction will try to process all of them at once, exhausting the connection pool and timing out. It does not require malicious intent — it is a usability bug that becomes a reliability bug at scale.

```typescript
// Add max() — these are the right limits for this domain
studentIds: z.array(z.string().cuid()).min(1).max(1000),
rows: z.array(importRowSchema).min(1).max(5000),
```

---

## 4. Security Vulnerabilities — Ranked and Explained

Below is the complete security picture, ranked by real-world risk rather than CVSS scores (which tend to rate theoretical severity, not likelihood).

### High Risk — Fix Before Production

**VULN-001: CSRF (covered in Section 3)**
The only genuine web security gap. The admin panel is the attack surface. See above for the fix.

**VULN-003: Audit Log Data Exposure (covered in Section 3)**
Sensitive fields in before/after change records. See above for the fix.

### Medium Risk — Fix This Sprint

**VULN-002: Rate Limiting Race Condition**

The `INCR` → `EXPIRE` two-step Redis pattern has a race window. Two requests hitting simultaneously can both increment before the TTL is set, meaning the key could theoretically live forever.

In practice, this race closes in under a millisecond in a single-server Redis deployment. The risk is real but requires parallel requests arriving within microseconds. It is not exploitable in typical usage. The fix is a Lua script that makes the operation atomic:

```typescript
// Replace the two-step with a Lua script
const rateLimitScript = `
  local current = redis.call('INCR', KEYS[1])
  if current == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
  end
  return current
`;

const count = await redis.eval(rateLimitScript, 1, ipKey, windowSeconds.toString());
if (Number(count) > limit) {
  throw new AppError(429, 'RATE_LIMITED', 'Too many requests');
}
```

**VULN-006: CORS Origin Header Not Enforced in Production**

`app.ts` allows requests with no `Origin` header in all environments. In production, this should be restricted. The fix is a one-line environment check:

```typescript
origin: (origin, callback) => {
  if (!origin) {
    // Allow in development (curl, Postman), block in production
    if (process.env.NODE_ENV === 'production') {
      return callback(new Error('Origin header required'), false);
    }
    return callback(null, true);
  }
  if (allowedOrigins.includes(origin)) {
    return callback(null, true);
  }
  callback(new Error('Origin not in allowlist'), false);
},
```

**VULN-008: Verbose Error Messages in Production**

The global error handler includes `error.details` (Zod validation issues) in all environments. In development this is useful. In production it leaks internal schema structure.

```typescript
// apps/backend/src/app.ts — error handler
return reply.code(error.statusCode).send({
  success: false,
  code: error.code,
  message: error.message,
  // Only include details in development
  ...(process.env.NODE_ENV !== 'production' && error.details
    ? { details: error.details }
    : {}),
});
```

### Lower Risk — Post-Launch

**VULN-004: Timing Attack on Password Reset**

The `/forgot-password` endpoint responds faster for invalid emails (~50ms) than valid ones (~150ms, including email send). An attacker with network access and enough requests can statistically identify valid admin email addresses by measuring response times.

The risk is low in practice — admin emails are not highly sensitive, the endpoint is rate-limited, and timing attacks against modern CDN infrastructure are noisy. But the fix is two lines and costs nothing:

```typescript
app.post('/forgot-password', async (req, reply) => {
  const start = Date.now();
  // ... existing logic ...
  
  // Constant-time response — always wait at least 200ms regardless of email validity
  const elapsed = Date.now() - start;
  await new Promise(r => setTimeout(r, Math.max(0, 200 - elapsed)));
  
  reply.send({ message: 'If this email is registered, a reset link has been sent.' });
});
```

**Rate limit headers missing**

Clients that hit rate limits get a 429 with no information about when they can retry. Add three headers to the rate limit logic:

```typescript
reply.header('X-RateLimit-Limit', limit);
reply.header('X-RateLimit-Remaining', Math.max(0, limit - count));
reply.header('X-RateLimit-Reset', Math.floor(Date.now() / 1000) + windowSeconds);
reply.header('Retry-After', windowSeconds); // on 429 responses only
```

**MFA not enforced for admin roles**

MFA is implemented and works, but it is optional. `TRANSPORT_OFFICER` and `MANAGEMENT` users can operate without it. This is a policy decision, not a code bug. Before launch, decide whether to enforce MFA at the middleware level or handle it as an onboarding policy.

---

## 5. Response Contract — The Full Fix

### What Is Actually Inconsistent

The comprehensive audit confirms the inconsistency is specifically in list endpoints, not in error handling or single-resource endpoints. The `AppError` pattern is consistent everywhere. Single-resource responses (`{ success: true, data: {...} }`) are consistent. The problem is confined to pagination.

The inconsistency matrix:

| Endpoint | Current Shape | Problem |
|---|---|---|
| `GET /v1/users/` | `{ data, total, page, limit }` | Missing `success` key, flat pagination |
| `GET /v1/attendance/history` | `{ success: true, data: { data: [], pagination: {} } }` | Double-wrapped data |
| `GET /v1/admin/audit-log` | `{ total, page, limit, entries }` | Wrong key name, missing `success` |
| `GET /v1/routes/` | `Route[]` | Raw array, no wrapper at all |
| `GET /v1/fleet/buses` | `Bus[]` | Raw array, no wrapper at all |
| `GET /v1/admin/corrections` | `Correction[]` | Raw array, no pagination |

### The Migration Approach

Do not rewrite all 12 endpoints at once. That PR will be impossible to review. Instead, migrate in three passes:

**Pass 1 (Day 1):** Fix the two that mobile SDK hits most — `attendance/history` (double-nesting causes parsing errors) and `users/` (missing `success` key causes SDK type errors).

**Pass 2 (Day 2):** Fix raw array returns in `routes/`, `fleet/buses`, `admin/corrections`, `admin/messages`. These are safe to batch because the change is additive (wrapping, not restructuring).

**Pass 3 (Day 3):** Fix `admin/audit-log` and remaining admin list endpoints. These touch audit-sensitive data so deserve their own review.

### HTTP Status Code Cleanup

The comprehensive audit confirms most status codes are already correct. The specific fixes needed:

```typescript
// Fleet DELETE — currently returns 200 with serialized bus body
// Change to 204 with no body
app.delete('/buses/:id', ..., async (request, reply) => {
  await prisma.bus.update({ where: { id }, data: { isActive: false, ... } });
  return reply.code(204).send();  // No body. 204 is the confirmation.
});

// Routes concurrent modification — currently throws custom error without 409
// Add explicit 409 status
throw new AppError(409, 'ROUTE_MODIFIED_CONCURRENTLY', 'Route was modified by another admin');
```

Everything else is correct. `checkin` returning 201 for new and 200 for idempotent is a good pattern. `corrections` returning 201 is correct. All GETs returning 200 is correct.

---

## 6. Authentication & Authorization — What's Actually Good

This section documents what is working well, because the first audit misrepresented the auth layer and you should not reflexively "fix" things that are not broken.

### The 8-Point JWT Verification Chain

Every mobile request goes through all eight checks in sequence:

1. Token present in Authorization header
2. JWT signature valid and not expired
3. Token type is `MOBILE` (not `ADMIN`) — prevents admin tokens being used on mobile endpoints
4. Required claims present (`sub`, `role`, `sv`, `deviceId`)
5. User exists in database and is active
6. Session version (`sv`) matches the stored version — this is the key revocation mechanism
7. `forcedReloginAt` check — allows immediate invalidation of all sessions for a user
8. Device binding — `deviceId` in token matches the registered device ID in Redis

This is genuinely strong. Session versioning means that if an admin disables a student account, that student's existing JWTs become invalid on the next request, without needing to maintain a blacklist for every token. The blacklist is a secondary layer, not the primary mechanism.

### Coordinator Scoping — The BANNED Pattern

The coordinator scoping in `users.routes.ts` uses a clever sentinel value:

```typescript
if (request.coordinatorRouteIds) {
  const intersected = request.coordinatorRouteIds.includes(routeId)
    ? routeId
    : undefined;
  whereClause.routeAssignment.routeId = intersected || 'BANNED';
  // 'BANNED' is not a real CUID — Prisma query returns 0 results
}
```

If a coordinator tries to filter by a route they do not manage, the `routeId` in the where clause becomes the literal string `'BANNED'`, which will never match any real route ID, so Prisma returns zero results. This is a defense-in-depth pattern — even if the scoping logic has an edge case, the coordinator cannot see data outside their routes.

Do not refactor this pattern without careful testing. It is doing exactly what it should.

### What Needs Attention in Auth

**MFA is optional** — `mfaEnabled` is a user preference, not a policy enforcement. For `TRANSPORT_OFFICER` and `MANAGEMENT` roles in production, MFA should be required. The enforcement point would be in the admin auth middleware after successful login:

```typescript
// After successful password + token verification:
if (['TRANSPORT_OFFICER', 'MANAGEMENT'].includes(admin.role) && !admin.mfaEnabled) {
  throw new AppError(403, 'MFA_REQUIRED', 'Administrative roles must enable MFA before accessing the system');
}
```

**Rate limits are not aligned** — Login is 10/min, refresh is 15/min. There is no reason for refresh to be more permissive than login. Align both to 10/min.

---

## 7. Type Safety & Validation

### What Is Genuinely Good

Zod coverage is 100% across all 119 endpoints. Every POST and PATCH has input validation. The error reporting format is consistent — `{ code: 'VALIDATION_ERROR', details: zod_issues[] }`. This is not trivial — many APIs at this scale have uncovered edge cases in validation. This one does not.

### The Specific Gaps

**Incident tripId** — covered in Section 3.

**Search query schemas** — `users.routes.ts` accepts arbitrary strings for fields that should be enums. The symptom is confusing: passing `status: "WRONG"` returns a 200 with zero results, making callers think no users exist rather than telling them the input was wrong.

```typescript
// Before
const querySchema = z.object({
  search: z.string().optional(),
  status: z.string().optional(),
  authStatus: z.string().optional(),
  routeId: z.string().optional(),
});

// After — fail fast with useful error messages
const querySchema = z.object({
  search: z.string().max(100).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  authStatus: z.enum(['ACTIVE', 'PENDING_PROVISIONING', 'AUTH_PROVISION_FAILED', 'DISABLED']).optional(),
  routeId: z.string().cuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
```

**GPS coordinate validation** — the schemas correctly validate range (`min(-90).max(90)`) but do not reject `[0,0]`. This is a real operational problem. When a student's phone fails to acquire a GPS fix, it sometimes returns `[0,0]` as a default. The haversine calculation then computes the distance between the null island coordinate and your bus stop in Chennai, returning ~8,000km. The check-in fails with `TOO_FAR` and the student has no idea why.

```typescript
// packages/shared/src/schemas/common.ts
export const coordinatesSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
}).refine(
  ({ lat, lon }) => !(lat === 0 && lon === 0),
  { message: 'GPS fix not acquired — coordinates [0,0] are invalid' }
).refine(
  ({ lat, lon }) => !(lat === -1 && lon === -1),
  { message: 'Test coordinates [-1,-1] are not valid in production' }
);
```

Import this schema in every route that handles GPS rather than redefining the lat/lon validation per-file.

**Coordinate field name inconsistency** — some routes use `lat/lon`, some use `studentLat/studentLng`. Pick one pair (`lat`/`lon`) and use the shared schema everywhere. The inconsistency is in internal processing code, not the external API contract, but it creates confusion when reading the code.

---

## 8. Idempotency — Still Missing, Still Critical

The comprehensive audit confirms there is zero idempotency support anywhere. This is unchanged from the first audit.

### Why This Is More Urgent Than It Appears

Chennai has variable 4G coverage. A student checks in near a bus stop with intermittent signal. The request reaches the server and creates an attendance record. The response is lost in transit. The Expo SDK retries automatically. The server receives an identical request and creates a second attendance record. The student now has two check-ins for the same day, one or both of which may have incorrect GPS data attached. Your attendance reports are corrupted.

This happens without any user error. It is a structural reliability problem that will occur at scale.

### The Implementation

Build this as a Fastify plugin so it is reusable across all endpoints:

```typescript
// apps/backend/src/plugins/idempotency.ts
import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyRequest {
    idempotencyKey?: string;
  }
}

export default fp(async (app) => {
  app.addHook('preHandler', async (request, reply) => {
    const key = request.headers['idempotency-key'];
    if (!key || typeof key !== 'string' || key.length > 100) return;

    const cached = await app.redis.get(`idem:${key}`);
    if (cached) {
      const { statusCode, body } = JSON.parse(cached);
      return reply.code(statusCode).send(body);
    }

    request.idempotencyKey = key;
  });
}, { name: 'idempotency' });
```

```typescript
// apps/backend/src/lib/idempotency.ts
export async function cacheResponse(
  request: FastifyRequest,
  statusCode: number,
  body: unknown,
  ttlSeconds: number
): Promise<void> {
  if (!request.idempotencyKey) return;
  await request.server.redis.setex(
    `idem:${request.idempotencyKey}`,
    ttlSeconds,
    JSON.stringify({ statusCode, body })
  );
}
```

Apply to these ten endpoints with the specified TTLs:

| Endpoint | TTL | Reason |
|---|---|---|
| `POST /attendance/checkin` | 86400 (24h) | One check-in per student per day |
| `POST /attendance/skip-today` | 86400 (24h) | One skip per student per day |
| `POST /attendance/wait-for-me` | 1800 (30min) | Short-lived momentary request |
| `POST /attendance/corrections` | 3600 (1h) | Correction per session |
| `POST /incidents/report` | 21600 (6h) | Bounded by trip duration |
| `POST /users/:id/assign` | 3600 (1h) | Admin retry window |
| `POST /admin/corrections/:id/resolve` | 3600 (1h) | Resolution is naturally idempotent |
| `POST /import/:id/execute` | 172800 (48h) | Imports are expensive and must never run twice |
| `POST /trips/:id/delegate/activate` | 3600 (1h) | One delegation per trip |
| `POST /trips/:id/delegate/end` | 3600 (1h) | One end-delegation per trip |

### Mobile Client Integration

The mobile client generates the key once per logical action and stores it:

```typescript
// apps/mobile/src/lib/idempotency.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

export async function getKey(actionId: string): Promise<string> {
  const existing = await AsyncStorage.getItem(`idem:${actionId}`);
  if (existing) return existing;
  const key = Crypto.randomUUID();
  await AsyncStorage.setItem(`idem:${actionId}`, key);
  return key;
}

export async function clearKey(actionId: string): Promise<void> {
  await AsyncStorage.removeItem(`idem:${actionId}`);
}
```

Usage — the key is tied to the action identity (user + date for check-in), not the request:

```typescript
const today = new Date().toISOString().slice(0, 10);
const key = await getKey(`checkin-${userId}-${today}`);

try {
  const response = await api.post('/attendance/checkin', payload, {
    headers: { 'Idempotency-Key': key },
  });
  if (response.ok) {
    await clearKey(`checkin-${userId}-${today}`); // Only clear on confirmed success
  }
} catch (err) {
  // Key is retained in storage — next retry will resend the same key
}
```

---

## 9. Performance & Query Analysis

### What the Comprehensive Audit Confirms

The deep include chains in `users.routes.ts` are not N+1 queries. Prisma resolves `include` chains using JOIN operations, not sequential SELECT queries. The chain `routeAssignment → route → assignments → bus` is executed as a single query plan. It is heavy, but it is not an N+1.

The actual performance concern is the combined result size. For `GET /v1/users/` with `limit=50`, you are loading 50 users with their full route tree including bus assignments. This is expensive at the database level even with JOINs. Adding composite indexes is the right mitigation:

```sql
-- Add these to your Prisma schema as @@index annotations
-- RouteAssignment: common filter is (routeId, isActive)
@@index([routeId, isActive])

-- AttendanceLog: common filter is (userId, date) with descending sort
@@index([userId, date(sort: Desc)])

-- Trip: common filter is (date, status)
@@index([date, status])
```

In `schema.prisma`:

```prisma
model RouteAssignment {
  // ... existing fields ...
  @@index([routeId, isActive])
}

model AttendanceLog {
  // ... existing fields ...
  @@index([userId, date(sort: Desc)])
}
```

### The Attendance History Corrections Sub-Query

The attendance history endpoint loads all corrections for each log entry with no limit:

```typescript
corrections: {
  select: { id: true, status: true },
  orderBy: { createdAt: 'desc' },
  // No take() limit — if a student has 50 corrections on one log, all 50 load
},
```

Add a practical limit:

```typescript
corrections: {
  select: { id: true, status: true, reason: true },
  orderBy: { createdAt: 'desc' },
  take: 5,  // Show the 5 most recent; UI can load more if needed
},
```

### Import Validation Memory Risk

The import validation endpoint has no row limit and no body size limit enforced at the route level. The Zod schema parses the entire payload in memory before any processing begins. A 100,000-row import payload (~50MB JSON) will spike Node.js heap significantly.

At the Fastify level:

```typescript
// apps/backend/src/app.ts
app.addContentTypeParser('application/json', {
  parseAs: 'string',
  bodyLimit: 10 * 1024 * 1024, // 10MB hard limit
}, (req, body, done) => {
  try {
    done(null, JSON.parse(body));
  } catch (err) {
    done(err, undefined);
  }
});
```

At the Zod level:

```typescript
rows: z.array(importRowSchema).min(1).max(5000),
```

Both limits together mean: requests above 10MB are rejected before parsing, and payloads with more than 5,000 rows are rejected after parsing but before any database work.

---

## 10. Implementation Order — Revised

This order is based on the actual severity from all four documents combined. The comprehensive audit changed the priority of several items — authorization consolidation and deprecated endpoint handling dropped significantly because they were not real problems; CSRF and audit log masking moved up because they are confirmed issues.

### Today (Must deploy before any real traffic)

These five things take about 3 hours total.

**Step 1 (5 min):** Fix `incidents.routes.ts` — `z.string().uuid()` → `z.string().cuid()`. Deploy immediately. This unblocks a broken feature.

**Step 2 (30 min):** Add bulk operation limits. `studentIds.max(1000)`, `rows.max(5000)`. Low risk change, high protection value.

**Step 3 (1 hour):** Add CSRF protection via `@fastify/csrf-protection`. One plugin registration in `app.ts`. This is a pre-launch requirement.

**Step 4 (30 min):** Add `sanitizeAuditFields` to the audit-log endpoint. Protect `before`/`after` fields from exposing password hashes and tokens.

**Step 5 (30 min):** Add search query enum validation in `users.routes.ts`. Changes `z.string()` to `z.enum([...])` for `status` and `authStatus`.

### This Week (Before real user load)

These take about 6–8 hours spread across two or three developers.

**Step 6 (2 hours):** Migrate list endpoints to the standardized pagination shape. Do it in the three-pass sequence described in Section 5. Start with `attendance/history` and `users/` since those directly affect the mobile SDK.

**Step 7 (1 hour):** Add the shared `coordinatesSchema` and `cuidSchema` to `packages/shared`. Update GPS-touching routes to import it. Remove the duplicated lat/lon validation in each module.

**Step 8 (4 hours):** Implement the idempotency plugin and apply to the ten endpoints in the TTL table in Section 8. This is the most impactful reliability improvement.

**Step 9 (30 min):** Fix rate limiting race condition with the Lua script. Also align refresh limit to 10/min to match login.

**Step 10 (1 hour):** Add rate limit response headers to all rate-limited endpoints.

### Before Launch (Infrastructure hardening)

**Step 11 (30 min):** Enforce `Origin` header in production CORS config.

**Step 12 (30 min):** Strip verbose error details from production error responses.

**Step 13 (30 min):** Add composite indexes to Prisma schema (`RouteAssignment`, `AttendanceLog`, `Trip`). Run migration.

**Step 14 (30 min):** Add `take: 5` limit on corrections sub-query in attendance history.

**Step 15 (2 hours):** Add constant-time response to password reset. Enforce MFA for `TRANSPORT_OFFICER` and `MANAGEMENT` roles (or document as policy decision).

### Post-Launch (Sprint 2)

**Step 16:** Add `fastify-swagger` + `fastify-swagger-ui`. Wire Zod schemas to generate OpenAPI spec automatically. This becomes the source of truth for the mobile SDK.

**Step 17:** Add structured request logging with request IDs. Hook into `onRequest` and `onResponse`. Log `{requestId, method, routerPath, userId, statusCode, durationMs}`.

**Step 18:** Document device binding, session versioning, and delegation in an internal API reference. These are non-obvious features that new developers will misunderstand.

---

## 11. Testing Strategy

### The Regression Test You Must Write First

Before touching anything, write this test. It will catch any accidental breakage during the migration work:

```typescript
// apps/backend/src/tests/api-contract.test.ts

const LIST_ENDPOINTS = [
  { method: 'GET', path: '/v1/users/', roles: ['TRANSPORT_OFFICER'] },
  { method: 'GET', path: '/v1/attendance/history', roles: ['STUDENT'] },
  { method: 'GET', path: '/v1/admin/audit-log', roles: ['TRANSPORT_OFFICER'] },
  // ... add all list endpoints
];

describe('API contract — all list endpoints', () => {
  for (const endpoint of LIST_ENDPOINTS) {
    it(`${endpoint.method} ${endpoint.path} returns standard pagination shape`, async () => {
      const response = await app.inject({
        method: endpoint.method,
        url: endpoint.path,
        headers: { Authorization: `Bearer ${generateToken(endpoint.roles[0])}` },
      });

      const body = response.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.pagination).toBeDefined();
      expect(body.pagination.page).toBeDefined();
      expect(body.pagination.total).toBeDefined();
      expect(body.pagination.hasMore).toBeDefined();

      // These keys must NOT exist at top level anymore
      expect(body.total).toBeUndefined();
      expect(body.entries).toBeUndefined();
      expect(body.data?.data).toBeUndefined(); // No double-nesting
    });
  }
});
```

This test fails on every unresolved endpoint and passes as you migrate them. It is your progress tracker.

### The UUID/CUID Regression Test

```typescript
describe('POST /v1/incidents/report', () => {
  it('accepts CUID format tripId', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/incidents/report',
      payload: {
        tripId: 'clxyz123abcdef456ghij', // valid CUID
        type: 'BREAKDOWN',
        description: 'Engine failure on route 5 near main gate',
      },
      headers: { Authorization: `Bearer ${driverToken}` },
    });
    expect(response.statusCode).not.toBe(400);
  });

  it('rejects UUID format tripId', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/incidents/report',
      payload: {
        tripId: '550e8400-e29b-41d4-a716-446655440000', // UUID format
        type: 'BREAKDOWN',
        description: 'Engine failure on route 5 near main gate',
      },
      headers: { Authorization: `Bearer ${driverToken}` },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('VALIDATION_ERROR');
  });
});
```

### Idempotency Test

```typescript
describe('POST /v1/attendance/checkin — idempotency', () => {
  it('returns identical response for duplicate key', async () => {
    const key = `test-idem-${Date.now()}`;
    const payload = { qrToken: 'valid-token', lat: 13.0827, lon: 80.2707, accuracy: 10, clientTimestamp: Date.now() };

    const first = await app.inject({
      method: 'POST',
      url: '/v1/attendance/checkin',
      headers: { Authorization: `Bearer ${studentToken}`, 'Idempotency-Key': key },
      payload,
    });

    const second = await app.inject({
      method: 'POST',
      url: '/v1/attendance/checkin',
      headers: { Authorization: `Bearer ${studentToken}`, 'Idempotency-Key': key },
      payload,
    });

    expect(second.statusCode).toBe(first.statusCode);
    expect(second.json()).toEqual(first.json());

    // Only one record created despite two requests
    const records = await prisma.attendanceLog.count({ where: { userId: testStudent.id, date: new Date() } });
    expect(records).toBe(1);
  });
});
```

### Audit Log Sanitization Test

```typescript
describe('GET /v1/admin/audit-log', () => {
  it('does not expose password hash in before/after fields', async () => {
    // Create a change event that modifies a password field
    await createAuditEvent({ entityType: 'AdminUser', before: { passwordHash: '$2b$12$abc...' }, after: { passwordHash: '$2b$12$xyz...' } });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/audit-log',
      headers: { Authorization: `Bearer ${transportOfficerToken}` },
    });

    const entries = response.json().data;
    for (const entry of entries) {
      expect(JSON.stringify(entry.before)).not.toContain('$2b$');
      expect(JSON.stringify(entry.after)).not.toContain('$2b$');
      if (entry.before?.passwordHash) {
        expect(entry.before.passwordHash).toBe('[REDACTED]');
      }
    }
  });
});
```

---

## 12. What Not to Touch

Based on the comprehensive audit, these things are correctly implemented and should not be refactored without a specific functional reason.

**The `BANNED` sentinel in coordinator scoping** — it is an unusual pattern but it works correctly and is actually clever defense-in-depth. Do not refactor it.

**410 responses on deprecated endpoints** — the first audit said to use Deprecation headers instead. This is better practice, but the current 410 responses are functional and the deprecated endpoints serve no real data. Not worth touching before launch.

**The `requireAdminRole` vs `requireRole` pattern** — different functions for mobile vs admin auth is not a bug, it reflects the different token types and verification paths. The naming is slightly inconsistent but the security is correct.

**Session versioning and blacklist together** — the comprehensive audit flags this as two Redis calls with a potential race window. But the session version check (call 1) is the primary mechanism and is sufficient. The blacklist (call 2) is a secondary defense. The window between two async Redis calls is not a real attack surface here.

**GPS delegation endpoints (Phase 2 Hardening)** — complex feature, not fully documented, but the audit shows it is correctly guarded with role checks. Do not modify without understanding the full delegation flow.

**QR token burning** — the audit confirmed this is correctly implemented at the service layer using Redis `SET NX`. The route does not need to verify it because the service handles it atomically.

---

## Summary

The API layer is fundamentally sound. The authentication is genuinely strong — better than most systems at this scale. The validation is comprehensive. The error handling is consistent.

The five things that need fixing before production are: the UUID blocker (5 minutes), bulk limits (15 minutes), CSRF protection (1 hour), audit log masking (1 hour), and search enum validation (30 minutes). That is a total of about 3 hours, not the 24-hour estimate from the first audit.

Idempotency is the biggest reliability gap and should be the first thing built after go-live, before student volume ramps up. Pagination standardization is real but affects developer experience more than end users — tackle it systematically as you touch each module.

The documentation gap is the only genuinely poor area. Device binding, session versioning, and the delegation flow are implemented but not explained anywhere. Any new developer joining will need to reverse-engineer them from the code. Writing an internal reference for these three features before the team grows is worth more than any technical fix on this list.
