# API Layer — Complete Fix Guide
**College Bus Management System**
**Date:** April 3, 2026 | **Scope:** Backend, Shared Types, Mobile Client Contract

---

## Table of Contents

1. [What Is Actually Wrong (Honest Assessment)](#1-what-is-actually-wrong)
2. [Layer 1 — Response Contract](#2-layer-1--response-contract)
3. [Layer 2 — Type Safety & Validation](#3-layer-2--type-safety--validation)
4. [Layer 3 — Idempotency](#4-layer-3--idempotency)
5. [Layer 4 — Authorization](#5-layer-4--authorization)
6. [Layer 5 — Reliability & Performance](#6-layer-5--reliability--performance)
7. [Security Hardening](#7-security-hardening)
8. [Implementation Order](#8-implementation-order)
9. [Testing Strategy](#9-testing-strategy)
10. [Future-Proofing Checklist](#10-future-proofing-checklist)

---

## 1. What Is Actually Wrong

Before writing a single line of code, you need to understand *why* these problems exist. They are not random. They follow a pattern almost universal in fast-moving codebases: **the system was built feature-by-feature without a shared contract layer**. Each module was written by someone focused on that module's logic, not on how the response would be consumed. The result is 5 different response shapes, 4 different auth patterns, and 0 idempotency — not because anyone was careless, but because there was no enforced standard.

The fix strategy is therefore not "go fix all 80 endpoints." It is: **create the contract first, then migrate endpoints to it one by one.** Any endpoint you touch for a feature fix is also a migration opportunity.

### The Three Production Blockers Right Now

**Blocker 1: Incident reporting is completely broken.**
`incidents.routes.ts` uses `z.string().uuid()` to validate `tripId`. But your Prisma schema generates CUIDs via `@default(cuid())`. A CUID looks like `cjxyz123abc...` — it will never pass UUID format validation. This means every single call to `POST /v1/incidents/report` returns a 400 validation error in production, silently, right now. Drivers cannot report incidents. The fix is one word: change `.uuid()` to `.cuid()`.

**Blocker 2: Mobile SDK is parsing wrong shapes from wrong endpoints.**
Your mobile client was built expecting `{ success: true, data: {...} }`. But fleet endpoints return raw arrays. Admin endpoints return `{ data, total, page, limit }` flat. Attendance history returns `{ success: true, data: { data: [...], pagination: {...} } }` — a `data.data` double-nesting. The client code has to branch on what shape it received, which means any endpoint that returns an unexpected shape silently breaks parsing. You do not always see these as errors — you see them as empty UI states and confused users.

**Blocker 3: No idempotency means retries create duplicates.**
Mobile networks are unreliable. When a check-in request times out, Expo retries it. When an admin double-clicks resolve, it fires twice. There is currently zero protection against this. The `attendanceService.checkIn()` call will create two attendance records if called twice within the same session. This will corrupt your attendance data in production under real-world conditions.

---

## 2. Layer 1 — Response Contract

This is the most important layer. Everything else in this guide assumes it is done first.

### 2.1 The Core Problem Explained

HTTP APIs are a contract between server and client. When the server is inconsistent about what it returns, the client has to be defensive about what it receives. Defensive client code means `if (response.data) ... else if (response.success && response.data) ... else if (Array.isArray(response)) ...`. This is fragile, hard to test, and impossible to type correctly in TypeScript.

The five patterns currently in your codebase are:

```
Pattern A: { success: true, data: {...} }                    ← users, attendance
Pattern B: { data: [...], total: 100, page: 1, limit: 50 }   ← users list (flat pagination)
Pattern C: [{...}, {...}]                                     ← fleet, routes (raw array)
Pattern D: { success: true, data: { data: [...], pagination: {...} } }  ← attendance history
Pattern E: { success: false, code: "ENDPOINT_DEPRECATED", canonical: "/path" }  ← admin deprecated
```

Every one of these except Pattern A is wrong — not because the data is wrong, but because the shape is unpredictable.

### 2.2 The Target Contract

All endpoints must return one of exactly three shapes:

```typescript
// Single resource or action result
{
  "success": true,
  "data": { ...resource }
}

// List with pagination
{
  "success": true,
  "data": [ ...items ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 150,
    "hasMore": true
  }
}

// Error (all errors, all status codes)
{
  "success": false,
  "error": "ERROR_CODE",
  "message": "Human readable description",
  "details": [...]   // optional, for validation errors only
}
```

Notice: no `data.data` nesting. No flat `total` at the top level. No raw arrays. The client only ever needs to check `response.success` to know which branch it is in.

### 2.3 The Implementation

Create this file in your shared package first. Nothing else goes in before this.

```typescript
// packages/shared/src/lib/response.ts

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface SuccessResponse<T> {
  success: true;
  data: T;
  pagination?: Pagination;
}

export interface ErrorResponse {
  success: false;
  error: string;
  message: string;
  details?: unknown;
}

export type ApiResponse<T> = SuccessResponse<T> | ErrorResponse;

/**
 * Use for single resources and action results.
 * Reply with .code(201) when a new DB row was created.
 * Reply with .code(200) for everything else.
 */
export function ok<T>(data: T): SuccessResponse<T> {
  return { success: true, data };
}

/**
 * Use for list endpoints. Pagination is flat, not nested.
 */
export function okList<T>(
  data: T[],
  pagination: Pagination
): SuccessResponse<T[]> {
  return { success: true, data, pagination };
}

/**
 * Use for all error cases. AppError will call this automatically
 * via the global error handler.
 */
export function fail(
  code: string,
  message: string,
  details?: unknown
): ErrorResponse {
  return {
    success: false,
    error: code,
    message,
    ...(details !== undefined ? { details } : {}),
  };
}
```

Now update your global Fastify error handler to use `fail()`:

```typescript
// apps/backend/src/plugins/error-handler.ts
app.setErrorHandler((error, request, reply) => {
  if (error instanceof AppError) {
    return reply.code(error.statusCode).send(
      fail(error.code, error.message, error.details)
    );
  }

  // Zod validation errors from Fastify schema parsing
  if (error.validation) {
    return reply.code(400).send(
      fail('VALIDATION_ERROR', 'Request validation failed', error.validation)
    );
  }

  // Unhandled — log it and return a safe message
  request.log.error({ err: error, requestId: request.id });
  return reply.code(500).send(
    fail('INTERNAL_ERROR', 'An unexpected error occurred')
  );
});
```

### 2.4 Migrating Existing Routes

Every route that currently uses a raw `reply.send()` call needs to be updated. Do this one module at a time. The safest approach is to pick the module you are already touching for a feature and migrate it while you are in there.

```typescript
// BEFORE — fleet.routes.ts
return buses.map(serializeBus);  // Raw array, breaks mobile parsing

// AFTER
return reply.send(ok(buses.map(serializeBus)));


// BEFORE — users.routes.ts list endpoint
return reply.send({ data, total, page, limit });

// AFTER
return reply.send(okList(data, {
  page,
  limit,
  total,
  hasMore: total > page * limit,
}));


// BEFORE — attendance.routes.ts history (the double-nested one)
return reply.send({
  success: true,
  data: {
    data: logs.map(serializeLog),
    pagination: { page, limit, total, hasMore },
  },
});

// AFTER
return reply.send(okList(logs.map(serializeLog), { page, limit, total, hasMore }));
```

### 2.5 HTTP Status Codes — The Correct Rules

This is not academic. The mobile client uses status codes to decide whether to add or update items in its local state. Getting these wrong causes UI glitches that are very hard to debug.

```
201 Created       → POST that created a new database row
200 OK            → GET, PATCH, PUT, and POST for action commands (skip, resolve, assign-existing)
204 No Content    → DELETE (no body — the 204 is the confirmation)
400 Bad Request   → Schema validation failed
401 Unauthorized  → JWT missing or expired
403 Forbidden     → JWT valid but wrong role or scope
404 Not Found     → Resource does not exist
409 Conflict      → Duplicate creation or concurrent modification
429 Too Many      → Rate limited
500 Server Error  → Unhandled exception
```

The boundary between 201 and 200 for POSTs is: **did a new row get inserted into the database?** If yes, 201. If the POST ran logic on existing data, 200.

```typescript
// 201 — new row created
app.post('/checkin', ..., async (request, reply) => {
  const result = await attendanceService.checkIn(...);
  if (result.alreadyCheckedIn) {
    return reply.code(200).send(ok(result));  // idempotent — already existed
  }
  return reply.code(201).send(ok(result));    // new record
});

// 200 — action command, no new row
app.post('/skip-today', ..., async (request, reply) => {
  const result = await attendanceService.skipToday(...);
  return reply.send(ok(result));  // 200 implicit
});

// 204 — delete
app.delete('/buses/:id', ..., async (request, reply) => {
  await fleetService.deactivateBus(request.params.id);
  return reply.code(204).send();  // no body
});
```

### 2.6 Deprecated Endpoints — Do Not Use 410

410 means "permanently gone, stop trying." That is a very strong signal and it actively breaks clients. What you actually want is "this still works but please migrate." Use deprecation headers instead:

```typescript
// admin.routes.ts — deprecated endpoint
app.get('/stats', ..., async (request, reply) => {
  reply.header('Deprecation', 'true');
  reply.header('Sunset', new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toUTCString());
  reply.header('Link', '</v1/admin/live/dashboard>; rel="successor-version"');

  // Still return real data — don't break existing clients during migration
  const data = await adminService.getLiveDashboard(...);
  return reply.send(ok(data));
});
```

The `Sunset` header tells the client *when* it will stop working. The `Link` header tells it where to go instead. The endpoint keeps working until you actually remove it, giving all clients time to migrate.

---

## 3. Layer 2 — Type Safety & Validation

### 3.1 The One-Line Production Fix

Open `apps/backend/src/modules/incidents/incidents.routes.ts`, find line 8, and change this:

```typescript
// BROKEN — rejects every valid tripId in your database
tripId: z.string().uuid(),
```

To this:

```typescript
// CORRECT — matches Trip.id @default(cuid()) in schema.prisma
tripId: z.string().cuid(),
```

That is it. That is the entire fix. Deploy this before anything else.

### 3.2 Shared Validation Schemas

The coordinate field naming inconsistency (`lat/lon` vs `studentLat/studentLng`) is a symptom of modules being written in isolation. Fix it by creating shared schemas that all modules import:

```typescript
// packages/shared/src/schemas/common.ts
import { z } from 'zod';

/**
 * Standard GPS coordinates. Rejects [0,0] and [-1,-1] which are
 * placeholder/test values that break haversine distance calculations.
 */
export const coordinatesSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
}).refine(
  ({ lat, lon }) => !(lat === 0 && lon === 0),
  { message: 'Coordinates [0,0] are invalid — GPS fix not acquired' }
).refine(
  ({ lat, lon }) => !(lat === -1 && lon === -1),
  { message: 'Coordinates [-1,-1] are test data — not valid for production' }
);

/**
 * Standard pagination. page starts at 1. limit capped at 100.
 */
export const paginationSchema = z.object({
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(50),
});

/**
 * CUID string — matches Prisma @default(cuid()) for all model IDs.
 * Never use z.string().uuid() for Prisma entity IDs.
 */
export const cuidSchema = z.string().cuid();

/**
 * Idempotency key — any non-empty string, typically a UUID from the client.
 */
export const idempotencyKeySchema = z.string().min(1).max(100).optional();
```

Now import these in every route that touches GPS or pagination instead of redefining:

```typescript
// gps.routes.ts
import { coordinatesSchema } from 'packages/shared/src/schemas/common';

const pingSchema = z.object({
  busId: cuidSchema,
  tripId: cuidSchema,
  speed: z.number().min(0).max(200).optional(),
  heading: z.number().min(0).max(360).optional(),
}).merge(coordinatesSchema);
// No more duplicated lat/lon validation, no more inconsistent field names
```

### 3.3 Search Query Hardening

The current search schemas accept arbitrary strings for fields that should be enums. This causes two problems: slow queries (Prisma builds a WHERE clause with an invalid enum value and returns 0 rows instead of an error) and confusing behavior for callers who get empty results with a 200.

```typescript
// BEFORE — users.routes.ts
const querySchema = z.object({
  search: z.string().optional(),        // can be 100,000 characters
  routeId: z.string().optional(),       // can be "not-a-cuid"
  status: z.string().optional(),        // can be "ASDFGH" — gets 0 results
  authStatus: z.string().optional(),    // same problem
});

// AFTER
const querySchema = z.object({
  search: z.string().max(100).optional(),
  routeId: z.string().cuid().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  authStatus: z.enum([
    'ACTIVE',
    'PENDING_PROVISIONING',
    'AUTH_PROVISION_FAILED',
    'DISABLED',
  ]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
```

### 3.4 Bulk Operation Limits

Both `bulkAssignStudents` and the import validation endpoint accept arrays with no upper bound. This is a denial-of-service vector — not necessarily malicious, but a coordinator who accidentally selects all students and hits submit will send 5,000 IDs to your server, which will try to update them all in a single Prisma transaction.

```typescript
// users.routes.ts
const bulkAssignStudentsSchema = z.object({
  studentIds: z.array(cuidSchema).min(1).max(1000),
  routeId: cuidSchema,
  stopId: cuidSchema,
});

// import.routes.ts
const validateBodySchema = z.object({
  rows: z.array(importRowSchema).min(1).max(10000),
  sessionId: cuidSchema,
});
```

The limits (1000 for bulk assign, 10000 for import) are reasonable but adjust to your system's capacity. The important thing is that any limit is better than no limit.

---

## 4. Layer 3 — Idempotency

### 4.1 Why This Matters More Than You Think

Idempotency is not just about duplicate data. It is about **trust**. When a driver submits an incident report on a bad connection and the app says "failed, retry?" — what does the driver do? They tap retry. If your server processed the first request but the response was lost in transit, you now have two incident records for the same event. Multiply this across 500 students checking in every morning on 4G connections and you have a corrupted dataset within a week.

The idempotency pattern is: the client generates a unique key per logical operation (not per HTTP request), sends it in a header, and the server stores the result under that key. Retries with the same key get the cached result instantly — no second database write.

### 4.2 Redis-Based Idempotency Plugin

```typescript
// apps/backend/src/plugins/idempotency.ts
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    idempotencyKey?: string;
  }
}

const idempotencyPlugin: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (request, reply) => {
    const key = request.headers['idempotency-key'];
    if (!key || typeof key !== 'string') return;

    // Validate key format (client should send a UUID)
    if (key.length < 1 || key.length > 100) {
      return reply.code(400).send(
        fail('INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must be 1–100 characters')
      );
    }

    const cacheKey = `idem:${key}`;
    const cached = await app.redis.get(cacheKey);

    if (cached) {
      const { statusCode, body } = JSON.parse(cached);
      request.log.info({ idempotencyKey: key, cacheHit: true });
      return reply.code(statusCode).send(body);
    }

    // Store key on request so the route handler can cache its result
    request.idempotencyKey = key;
  });
};

export default fp(idempotencyPlugin, { name: 'idempotency' });
```

Then create a helper that route handlers call after their operation succeeds:

```typescript
// apps/backend/src/lib/cache-idempotent-response.ts
import type { FastifyRequest } from 'fastify';

export async function cacheIdempotentResponse(
  request: FastifyRequest,
  statusCode: number,
  body: unknown,
  ttlSeconds = 3600
): Promise<void> {
  if (!request.idempotencyKey) return;

  await request.server.redis.setex(
    `idem:${request.idempotencyKey}`,
    ttlSeconds,
    JSON.stringify({ statusCode, body })
  );
}
```

Using it in a route:

```typescript
// attendance.routes.ts
app.post('/checkin', {
  preHandler: [authenticate, requireRole(['STUDENT'])],
}, async (request, reply) => {
  const { lat, lon } = checkInSchema.parse(request.body);
  const result = await attendanceService.checkIn(request.user!.sub, lat, lon);

  const responseBody = ok(result);
  const statusCode = result.alreadyCheckedIn ? 200 : 201;

  await cacheIdempotentResponse(request, statusCode, responseBody, 86400); // 24h TTL

  return reply.code(statusCode).send(responseBody);
});
```

### 4.3 Which Endpoints Need Idempotency and What TTL

| Endpoint | TTL | Why |
|---|---|---|
| `POST /attendance/checkin` | 24 hours | Student checks in once per day — same-day retry must be safe |
| `POST /users/:id/assign` | 1 hour | Admin retries on timeout should not double-assign |
| `POST /attendance/skip-today` | 24 hours | Skip is a one-time daily action |
| `POST /attendance/wait-for-me` | 30 minutes | Short window, action is momentary |
| `POST /attendance/corrections` | 1 hour | Correction request per session |
| `POST /incidents/report` | 6 hours | Incident is tied to a trip; trip window is bounded |
| `POST /admin/corrections/:id/resolve` | 1 hour | Resolution is idempotent by nature |
| `POST /import/sessions/:id/execute` | 48 hours | Import is expensive; never run twice |
| `POST /trips/:id/delegate` | 1 hour | Delegation per trip |
| `POST /trips/:id/end-delegation` | 1 hour | End delegation per trip |

### 4.4 Mobile Client Side

The mobile client is responsible for generating and storing the idempotency key per logical action:

```typescript
// apps/mobile/src/lib/api.client.ts

import * as Crypto from 'expo-crypto';

/**
 * Generate and persist an idempotency key for a specific user action.
 * The same key must be reused on retries.
 * @param actionId - a stable string describing the action, e.g. "checkin-2026-04-03"
 */
export async function getIdempotencyKey(actionId: string): Promise<string> {
  const storageKey = `idem_key_${actionId}`;
  const existing = await AsyncStorage.getItem(storageKey);
  if (existing) return existing;

  const key = await Crypto.randomUUID();
  await AsyncStorage.setItem(storageKey, key);
  return key;
}

/**
 * Clear the key after the action fully succeeds.
 */
export async function clearIdempotencyKey(actionId: string): Promise<void> {
  await AsyncStorage.removeItem(`idem_key_${actionId}`);
}
```

Usage in a check-in flow:

```typescript
const today = new Date().toISOString().slice(0, 10); // "2026-04-03"
const key = await getIdempotencyKey(`checkin-${userId}-${today}`);

const response = await apiClient.post('/attendance/checkin', payload, {
  headers: { 'Idempotency-Key': key },
});

if (response.ok) {
  await clearIdempotencyKey(`checkin-${userId}-${today}`);
}
```

The key is tied to the user and the date. If the app restarts mid-retry, the same key is recovered from storage and the server returns the cached result.

---

## 5. Layer 4 — Authorization

### 5.1 The Four Patterns Problem

Your codebase has four different ways to authorize requests:

```typescript
// Pattern A — mobile routes (correct structure, used inconsistently)
preHandler: [authenticate, requireRole(['STUDENT'])]

// Pattern B — admin routes (separate function with different internals)
preHandler: [requireAdminRole(['TRANSPORT_OFFICER'])]
// Note: missing authenticate call! requireAdminRole bundles it — hidden coupling.

// Pattern C — async inline check (breaks the preHandler chain)
const access = await requireAction(request, 'VIEW_DASHBOARD');
// This runs inside the handler body, not as middleware. 
// If it throws, Fastify's error handler catches it, but the log context is wrong.

// Pattern D — bare enum reference
preHandler: [authenticate, requireRole([ROLES.DRIVER])]
// Different import path from Pattern A — same outcome but harder to grep.
```

The problem with multiple patterns is not just aesthetics. It means **you cannot answer the question "which endpoints are protected?"** without reading every route file individually. One pattern means one grep.

### 5.2 The Consolidated Pattern

Pick Pattern A and make everything conform to it. Create two explicit helper functions that make misuse a compile error:

```typescript
// apps/backend/src/middleware/auth.helpers.ts
import { authenticate, requireRole, scopeCoordinator } from './auth';
import type { preHandlerHookHandler } from 'fastify';

type MobileRole = 'STUDENT' | 'DRIVER' | 'PARENT';
type AdminRole = 'TRANSPORT_OFFICER' | 'COORDINATOR' | 'MANAGEMENT' | 'FACULTY';

/**
 * For routes accessed from the mobile app.
 * Always requires JWT authentication.
 */
export function mobileRoute(
  roles: MobileRole[]
): preHandlerHookHandler[] {
  return [authenticate, requireRole(roles)];
}

/**
 * For routes accessed from the admin panel.
 * scoped=true enforces coordinator route scoping.
 * Always requires JWT authentication.
 */
export function adminRoute(
  roles: AdminRole[],
  scoped = false
): preHandlerHookHandler[] {
  return scoped
    ? [authenticate, requireRole(roles), scopeCoordinator]
    : [authenticate, requireRole(roles)];
}
```

Usage is now self-documenting and impossible to misconfigure:

```typescript
// Before — easy to forget scopeCoordinator
app.post('/:studentId/assign', {
  preHandler: [authenticate, requireRole(['COORDINATOR', 'TRANSPORT_OFFICER'])]
  // scopeCoordinator is missing — coordinator can assign to any route!
}, handler);

// After — scoped=true is the only way to express coordinator scope
app.post('/:studentId/assign', {
  preHandler: adminRoute(['COORDINATOR', 'TRANSPORT_OFFICER'], true),
}, handler);
```

### 5.3 The Coordinator Scope Gap

The most significant security issue is `POST /:studentId/assign` missing `scopeCoordinator`. A coordinator is supposed to manage only the routes assigned to them. Without scope enforcement, a coordinator can assign any student to any route — including routes managed by other coordinators or in other campuses.

Audit every endpoint that accepts `COORDINATOR` in its role array and verify `scoped=true` is set. As a quick grep:

```bash
# Find all coordinator endpoints
grep -r "COORDINATOR" apps/backend/src --include="*.ts" -l

# For each file, check if scopeCoordinator appears on the same endpoint
grep -A5 "COORDINATOR" apps/backend/src/modules/users/users.routes.ts | grep -c "scopeCoordinator"
# Should be 1 for every POST/PATCH that coordinators can access
```

### 5.4 Device Binding Propagation

Device binding already works on check-in. It needs to be on assign too:

```typescript
// apps/backend/src/middleware/auth.ts — existing guard
export async function requireDeviceBinding(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user!;
  if (!user.registeredDeviceId) return; // user has no device bound — skip check

  const deviceId = request.headers['x-device-id'];
  if (deviceId !== user.registeredDeviceId) {
    throw new AppError(403, 'DEVICE_MISMATCH', 'Request must come from the registered device');
  }
}

// Add to assign endpoint
app.post('/:studentId/assign', {
  preHandler: adminRoute(['COORDINATOR', 'TRANSPORT_OFFICER'], true),
  // Note: device binding is for mobile users. Admin panel routes don't have device binding.
  // Only add requireDeviceBinding to routes accessed from the mobile app.
}, handler);
```

### 5.5 Authorization Test Matrix

Write this test. It will catch every future regression automatically:

```typescript
// apps/backend/src/tests/auth.matrix.test.ts

const endpoints = [
  { method: 'POST', path: '/v1/attendance/checkin', allowedRoles: ['STUDENT'], deniedRoles: ['DRIVER', 'COORDINATOR'] },
  { method: 'POST', path: '/v1/users/:id/assign', allowedRoles: ['TRANSPORT_OFFICER', 'COORDINATOR'], deniedRoles: ['STUDENT', 'DRIVER'] },
  { method: 'POST', path: '/v1/incidents/report', allowedRoles: ['DRIVER'], deniedRoles: ['STUDENT', 'COORDINATOR'] },
  // ... add every endpoint
];

describe('Authorization Matrix', () => {
  for (const endpoint of endpoints) {
    for (const role of endpoint.deniedRoles) {
      it(`${endpoint.method} ${endpoint.path} returns 403 for role ${role}`, async () => {
        const token = generateTestToken({ role });
        const response = await app.inject({
          method: endpoint.method,
          url: endpoint.path,
          headers: { Authorization: `Bearer ${token}` },
        });
        expect(response.statusCode).toBe(403);
      });
    }
  }
});
```

---

## 6. Layer 5 — Reliability & Performance

### 6.1 Request Context and Structured Logging

Without request IDs, debugging a production error means searching logs by timestamp and guessing. With request IDs, you search for one string and see the complete lifecycle of that request.

```typescript
// apps/backend/src/plugins/request-context.ts
declare module 'fastify' {
  interface FastifyRequest {
    startTime: number;
    requestId: string;
  }
}

app.addHook('onRequest', async (request) => {
  request.requestId = (request.headers['x-request-id'] as string) ?? crypto.randomUUID();
  request.startTime = Date.now();
  reply.header('X-Request-Id', request.requestId); // Echo back to client
});

app.addHook('onResponse', async (request, reply) => {
  request.log.info({
    requestId: request.requestId,
    method: request.method,
    routerPath: request.routerPath,      // /v1/users/:id — not the actual ID value
    userId: request.user?.sub ?? null,
    role: request.user?.role ?? null,
    statusCode: reply.statusCode,
    durationMs: Date.now() - request.startTime,
  });
});
```

Every error log should include the `requestId`:

```typescript
// In AppError handler
request.log.error({
  requestId: request.id,
  error: error.code,
  message: error.message,
  stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
});
```

When a driver reports "it didn't work at 9:15," you search your log aggregator for their `userId` and `durationMs > 5000` in that time window and immediately see what happened.

### 6.2 Rate Limiting — Standardized

The current rate limiting has three different windows (1 minute for login, 1 minute for refresh, 1 hour for logout-all) and no rate limit headers. The headers are what make rate limiting useful to clients — without them, a client that is being throttled has no idea when it can retry.

```typescript
// apps/backend/src/lib/rate-limit.ts
interface RateLimitOptions {
  key: string;
  max: number;
  windowSeconds: number;
  reply: FastifyReply;
}

export async function checkRateLimit(
  redis: Redis,
  options: RateLimitOptions
): Promise<void> {
  const { key, max, windowSeconds, reply } = options;

  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSeconds);

  const remaining = Math.max(0, max - count);
  const resetAt = Math.floor(Date.now() / 1000) + windowSeconds;

  // Always set headers — on both allowed and rejected requests
  reply.header('X-RateLimit-Limit', max);
  reply.header('X-RateLimit-Remaining', remaining);
  reply.header('X-RateLimit-Reset', resetAt);

  if (count > max) {
    reply.header('Retry-After', windowSeconds);
    throw new AppError(429, 'RATE_LIMITED', `Too many requests — try again in ${windowSeconds}s`);
  }
}
```

Standardized limits to apply consistently:

```
Login:            10 per minute per IP
Token refresh:    10 per minute per IP       (was 15 — align with login)
Logout-all:       3 per hour per user        (keep — this is intentionally strict)
Check-in:         5 per minute per user      (students can't hammer this)
GPS ping:         30 per minute per bus      (bus sends every 2 seconds normally)
Incident report:  10 per hour per driver     (generous — incidents are rare but need to work)
```

### 6.3 N+1 Query Audit

The deep include chain in users routes (`routeAssignment → route → assignments → bus`) is not dangerous as written because Prisma uses JOINs for `include`, not separate queries. But the pattern of calling a count function inside a loop is dangerous:

```typescript
// DANGEROUS — N+1 in disguise
const drivers = await prisma.user.findMany({ where: { role: 'DRIVER' } });
for (const driver of drivers) {
  driver.tripCount = await prisma.trip.count({ where: { driverId: driver.id } }); // N queries!
}

// CORRECT — single query with count aggregation
const driversWithCounts = await prisma.user.findMany({
  where: { role: 'DRIVER' },
  include: {
    _count: { select: { trips: true } }
  }
});
// Access: driver._count.trips
```

Audit every route that iterates over a result set and makes additional queries per item. Replace with `_count`, `groupBy`, or a single JOIN-based query.

### 6.4 OpenAPI Spec Generation

Once the response contract is stable (Layer 1 done), add `fastify-swagger`. This is not documentation for its own sake — it is the single source of truth for the mobile SDK. The spec forces you to define every response shape explicitly, which means any deviation from the contract becomes a visible inconsistency.

```bash
npm install @fastify/swagger @fastify/swagger-ui zod-to-json-schema
```

```typescript
// apps/backend/src/plugins/swagger.ts
await app.register(require('@fastify/swagger'), {
  openapi: {
    info: { title: 'College Bus API', version: '1.0.0' },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }
      }
    },
    security: [{ bearerAuth: [] }],
  }
});

await app.register(require('@fastify/swagger-ui'), {
  routePrefix: '/docs',  // Available at localhost:3000/docs in development
  uiConfig: { persistAuthorization: true },
});
```

---

## 7. Security Hardening

### 7.1 All Issues and Their Fixes

**Device binding missing on `/assign`** — High severity. See section 5.4.

**Coordinator scope not enforced on mutations** — High severity. See section 5.2 and 5.3.

**GPS coordinates accept `[0,0]`** — Medium severity. The haversine formula calculates distance from [0,0] to your bus stops, which returns a number in the thousands of kilometers. The check-in logic sees this distance and returns `TOO_FAR`, blocking a legitimate check-in with a confusing error. See the coordinate schema in section 3.2.

**Bulk operation DoS** — Medium severity. No maximum on `studentIds` arrays. See section 3.4.

**Rate limit headers missing** — Medium severity. Clients cannot implement backoff without knowing their remaining quota. See section 6.2.

**Data exposure in coordinator DTO** — Low-medium severity. `toCoordinatorStudentDto` includes `deviceId` and `lastLoginAt`. These are internal fields that have no business being in a coordinator-facing response. Review all DTO serializer functions and ask: does this role need this field to do their job? If no, remove it.

### 7.2 Security Headers

Add these globally via a plugin. They do not require any per-route work:

```typescript
app.addHook('onSend', async (request, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('X-XSS-Protection', '1; mode=block');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Remove server identification
  reply.removeHeader('X-Powered-By');
  reply.removeHeader('Server');
});
```

---

## 8. Implementation Order

Do these in strict sequence. Each layer depends on the previous one being stable.

### Day 1 — Unblock production (1–2 hours, 1 developer)

1. Fix `incidents.routes.ts` — change `.uuid()` to `.cuid()`. One line, deploy immediately.
2. Create `packages/shared/src/lib/response.ts` with `ok()`, `okList()`, `fail()`.
3. Update the global error handler to use `fail()`.
4. Migrate the two highest-traffic modules to the new response contract: `attendance` and `users`.

### Days 2–3 — Stabilize the contract (parallel work possible)

5. Migrate remaining route modules to `ok()` / `okList()`.
6. Fix all POST endpoints to return correct 201 / 200 status codes.
7. Fix fleet DELETE to return 204.
8. Create `packages/shared/src/schemas/common.ts` and update all GPS-touching routes.
9. Add `.max()` limits to bulk operation schemas.
10. Tighten search query schemas to use `z.enum()`.

### Days 4–5 — Security and reliability

11. Implement idempotency plugin and apply to all 10 critical POST endpoints.
12. Consolidate authorization to `mobileRoute()` / `adminRoute()` helpers.
13. Add `scopeCoordinator` to all coordinator mutation endpoints.
14. Add device binding to `/assign`.
15. Standardize rate limits and add rate limit response headers.
16. Add request ID generation and structured logging hooks.

### Days 6–7 — Testing and documentation

17. Write the authorization test matrix.
18. Write integration tests for idempotency (send same key twice, verify one DB row).
19. Write tests for all response shapes (ensure every endpoint returns `{ success, data }`).
20. Generate OpenAPI spec via `fastify-swagger`.
21. Remove `410` deprecated endpoints — replace with deprecation headers.

---

## 9. Testing Strategy

### 9.1 Response Shape Tests

Every endpoint needs a test that verifies the response shape. Not just status code — the actual structure:

```typescript
// Shared helper
function assertApiResponse(response: Response) {
  const body = response.json();
  expect(body).toHaveProperty('success');
  if (body.success) {
    expect(body).toHaveProperty('data');
    expect(body).not.toHaveProperty('total');    // old flat pagination shape
    expect(body).not.toHaveProperty('message');  // message belongs in error responses
  } else {
    expect(body).toHaveProperty('error');
    expect(body).toHaveProperty('message');
  }
}

it('GET /v1/users returns correct envelope', async () => {
  const response = await app.inject({ method: 'GET', url: '/v1/users' });
  assertApiResponse(response);
  expect(response.json().data).toBeInstanceOf(Array);
  expect(response.json().pagination).toBeDefined();
});
```

### 9.2 Idempotency Tests

```typescript
describe('POST /v1/attendance/checkin — idempotency', () => {
  it('returns same response on duplicate key', async () => {
    const key = 'test-idem-key-001';
    const payload = { lat: 13.0827, lon: 80.2707 };

    const first = await app.inject({
      method: 'POST', url: '/v1/attendance/checkin',
      headers: { 'Idempotency-Key': key, ...authHeaders },
      payload,
    });

    const second = await app.inject({
      method: 'POST', url: '/v1/attendance/checkin',
      headers: { 'Idempotency-Key': key, ...authHeaders },
      payload,
    });

    expect(second.statusCode).toBe(first.statusCode);
    expect(second.json()).toEqual(first.json());

    // Verify only one record was created
    const records = await prisma.attendance.findMany({ where: { studentId: testUser.id } });
    expect(records).toHaveLength(1);
  });
});
```

### 9.3 The UUID Regression Test

Add this so it never silently breaks again:

```typescript
describe('POST /v1/incidents/report', () => {
  it('accepts a valid CUID tripId', async () => {
    const cuid = 'cjxyz123abcdef456ghijk'; // valid CUID format
    const response = await app.inject({
      method: 'POST',
      url: '/v1/incidents/report',
      payload: { tripId: cuid, type: 'BREAKDOWN', description: 'Engine failure on route 5' },
      headers: driverAuthHeaders,
    });
    // Must not return 400 validation error
    expect(response.statusCode).not.toBe(400);
  });

  it('rejects a UUID-format tripId', async () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000'; // valid UUID but wrong format
    const response = await app.inject({
      method: 'POST',
      url: '/v1/incidents/report',
      payload: { tripId: uuid, type: 'BREAKDOWN', description: 'Engine failure on route 5' },
      headers: driverAuthHeaders,
    });
    expect(response.statusCode).toBe(400);
  });
});
```

---

## 10. Future-Proofing Checklist

These are decisions to make now that prevent expensive rewrites later.

### API Versioning

Your `/v1/` prefix is correct. Protect it by establishing this rule: **a breaking change requires a new version prefix.** A breaking change is any change to the response shape, removal of a field, or change to how errors are returned. Adding optional fields is not breaking. Changing a field's type is breaking.

For your current codebase: the response standardization work (Layer 1) should be done entirely within `/v1/` since you are fixing inconsistencies, not changing a stable contract.

### Mobile SDK Client Generation

Once the OpenAPI spec is stable, consider generating the TypeScript client automatically:

```bash
npx openapi-typescript http://localhost:3000/docs/json -o apps/mobile/src/lib/api.types.ts
```

This eliminates an entire class of type mismatch bugs — the mobile client's types are derived from the spec, not written by hand.

### Circuit Breaker for External Services

Firebase Realtime Database calls in `gps.routes.ts` happen on the critical path of GPS pings. If Firebase is slow or down, your GPS pings will pile up and block server threads. Add a simple circuit breaker:

```typescript
// If Firebase fails 5 times in 30 seconds, stop calling it for 60 seconds
// and return the last known state from Redis instead.
// Libraries: opossum (Node.js circuit breaker)
```

This is a post-launch concern, but worth noting now so the architecture accommodates it.

### Environment Config Validation

Validate all required environment variables at startup, not at the point of first use:

```typescript
// apps/backend/src/config.ts
import { z } from 'zod';

const configSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  FIREBASE_PROJECT_ID: z.string(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
});

export const config = configSchema.parse(process.env);
// If any variable is missing or wrong format, the server fails immediately on startup
// with a clear error — not silently at runtime when that variable is first accessed.
```

---

## Summary

The API layer has strong bones — JWT auth, AppError pattern, Zod validation, route organization. The problems are all about **consistency**, not fundamental design. The five response shapes, four auth patterns, and missing idempotency are all fixable without a rewrite.

Fix in this order: the UUID blocker first (5 minutes), then the response contract (1 day), then idempotency (1 day), then auth consolidation (half a day). After those four things, the API is production-grade and the mobile SDK can be built with confidence.

The OpenAPI spec is the finish line — when every endpoint is documented and the spec is generated automatically from your Zod schemas, you have an API that is trustworthy by construction, not by convention.
