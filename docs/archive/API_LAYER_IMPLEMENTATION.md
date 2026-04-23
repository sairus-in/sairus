# API Layer Implementation Guide

**College Bus Management System** | **Date:** April 2026 | **Status:** Production-Ready

## Overview

This document describes the complete API layer for the college bus management system. The layer enforces:

1. **Response Contract**: One standard envelope for all responses
2. **Error Handling**: Centralized error codes with type safety
3. **Authentication**: Consistent JWT verification across all routes
4. **Authorization**: Role-based access with coordinator scoping
5. **Idempotency**: Prevents duplicate database writes
6. **Rate Limiting**: Protects endpoints from abuse
7. **Request Context**: Structured logging with requestId propagation
8. **Validation**: Zod schemas for all inputs

---

## Architecture Layers

```
Request
  ↓
┌─────────────────────────────────────────┐
│  Plugins (Infrastructure)                │
│  - Request Context (requestId, logging) │
│  - Idempotency (cache duplicate keys)   │
│  - CORS, Security Headers                │
└────────────────┬────────────────────────┘
                 ↓
┌─────────────────────────────────────────┐
│  Middleware (Guards)                     │
│  - mobileRoute() or adminRoute()         │
│  - JWT verification                     │
│  - Role/scope checks                    │
└────────────────┬────────────────────────┘
                 ↓
┌─────────────────────────────────────────┐
│  Route Handler (routes.ts)               │
│  - Parse + validate with Zod            │
│  - Call service method                  │
│  - Wrap result in ok() or okList()      │
│  - Cache idempotent response if needed  │
└────────────────┬────────────────────────┘
                 ↓
┌─────────────────────────────────────────┐
│  Service Layer (service.ts)              │
│  - Business logic                       │
│  - Orchestrate repositories             │
│  - Throw AppError on violations         │
└────────────────┬────────────────────────┘
                 ↓
┌─────────────────────────────────────────┐
│  Repository Layer (repository.ts)       │
│  - Prisma queries only                  │
│  - No business logic                    │
└────────────────┬────────────────────────┘
                 ↓
        Database + Redis
```

---

## Response Contract

### Success Response (Single Resource)

```typescript
// ✅ CORRECT
app.post('/users', async (request, reply) => {
  const user = await userService.create(data);
  return reply.code(201).send(ok(user, request.id));
});

// Response:
{
  "success": true,
  "data": { "id": "cju123...", "name": "Alice" },
  "requestId": "uuid",
  "timestamp": "2026-04-03T10:30:00Z"
}
```

### Success Response (Paginated List)

```typescript
// ✅ CORRECT
app.get('/users', async (request, reply) => {
  const { users, total } = await userService.list({ page: 1, limit: 50 });
  return reply.send(
    okList(users, buildPagination(1, 50, total), request.id)
  );
});

// Response:
{
  "success": true,
  "data": [ { "id": "cju123...", "name": "Alice" }, ... ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 150,
    "hasMore": true
  },
  "requestId": "uuid",
  "timestamp": "2026-04-03T10:30:00Z"
}
```

### Error Response (All Status Codes)

```typescript
// Response:
{
  "success": false,
  "error": "VALIDATION_ERROR",
  "message": "Request validation failed.",
  "details": [{ "path": "email", "message": "Invalid email" }],
  "retryable": false,
  "requestId": "uuid",
  "timestamp": "2026-04-03T10:30:00Z"
}
```

---

## HTTP Status Codes

| Code | When | Examples |
|------|------|----------|
| 200 | GET, PATCH, PUT, action commands | `/users?filter=active`, `/trips/123/skip` |
| 201 | POST that created a new row | `POST /users`, `POST /buses` |
| 204 | DELETE with no body | `DELETE /users/123` |
| 400 | Schema validation failed | Invalid zod schema, malformed JSON |
| 401 | JWT missing, expired, invalid | `Authorization` header missing/invalid |
| 403 | JWT valid but wrong role/scope | Student token on admin endpoint |
| 404 | Resource doesn't exist | User not found, trip doesn't exist |
| 409 | Concurrent modification or duplicate | Already checked in, duplicate request |
| 422 | Business logic violation | GPS coordinates too far |
| 429 | Rate limited | Too many login attempts |
| 500 | Unhandled server error | Database connection failure |

---

## Error Codes

All error codes live in **`shared/src/lib/error-codes.ts`**. Never inline error strings.

### Adding a New Error

1. Add to `ErrorCode` type union
2. Add message to `ERROR_MESSAGES`
3. Add status code to `ERROR_STATUS_CODES`
4. Set `RETRYABLE_CODES` if applicable

Example:

```typescript
// shared/src/lib/error-codes.ts

export type ErrorCode = 
  | 'EXISTING_ERROR'
  | 'NEW_FEATURE_LIMIT_EXCEEDED'; // ← Add here

export const ERROR_MESSAGES = {
  EXISTING_ERROR: 'Existing message',
  NEW_FEATURE_LIMIT_EXCEEDED: 'You have reached the limit for this feature.',
};

export const ERROR_STATUS_CODES = {
  EXISTING_ERROR: 400,
  NEW_FEATURE_LIMIT_EXCEEDED: 409,
};
```

### Using Errors in Routes

```typescript
import { AppError } from '../../lib/errors';

if (user.isDisabled) {
  throw new AppError(403, 'ACCOUNT_DISABLED');
}

if (!found) {
  throw new AppError(404, 'RESOURCE_NOT_FOUND');
}

if (validationFailed) {
  throw new AppError(400, 'VALIDATION_ERROR', zodIssues);
}
```

---

## Authorization Patterns

### Mobile Routes

```typescript
import { mobileRoute } from '../../middleware/route-guards';

app.post('/attendance/checkin', 
  { preHandler: mobileRoute(['STUDENT']) },
  async (request, reply) => {
    // request.user.role === 'STUDENT'
    return reply.send(ok(result, request.id));
  },
);
```

### Admin Routes (Without Scoping)

```typescript
import { adminRoute } from '../../middleware/route-guards';

// Read-only, no scoping needed
app.get('/audit-log',
  { preHandler: adminRoute(['TRANSPORT_OFFICER', 'MANAGEMENT']) },
  async (request, reply) => {
    const logs = await getAuditLogs();
    return reply.send(okList(logs, pagination, request.id));
  },
);
```

### Admin Routes (With Coordinator Scoping)

```typescript
// Mutation endpoint: MUST use scoped=true
app.post('/users/:id/assign',
  { preHandler: adminRoute(['COORDINATOR', 'TRANSPORT_OFFICER'], true) }, // scoped=true
  async (request, reply) => {
    // Service layer receives coordinatorRouteIds from request context
    const result = await userService.assign(studentId, routeId, request);
    return reply.code(201).send(ok(result, request.id));
  },
);
```

---

## Validation Schemas

### Use Shared Schemas

```typescript
import { cuidSchema, coordinatesSchema, paginationSchema } from 'shared';

// ✅ CORRECT
const querySchema = paginationSchema.extend({
  routeId: cuidSchema.optional(),
});

// ❌ WRONG — redefines CUID validation
const querySchema = z.object({
  routeId: z.string().cuid().optional(),
  page: z.coerce.number().min(1),
  limit: z.coerce.number().min(1).max(100),
});
```

### GPS Coordinates

```typescript
import { coordinatesSchema } from 'shared';

const pingSchema = coordinatesSchema.extend({
  busId: cuidSchema,
  timestamp: z.number().int().positive(),
});

// Automatically rejects [0,0] and [-1,-1]
const parsed = pingSchema.safeParse(body);
if (!parsed.success) throw new AppError(400, 'INVALID_COORDINATES', parsed.error.issues);
```

### CUID Entity IDs

```typescript
import { cuidSchema } from 'shared';

const paramSchema = z.object({
  userId: cuidSchema, // ✅ Matches Prisma @default(cuid())
});

// ❌ WRONG — causes validation failure on every CUID
const paramSchema = z.object({
  userId: z.string().uuid(), // No entity ID is UUID
});
```

### Bulk Operations

```typescript
import { cuidArraySchema } from 'shared';

const assignSchema = z.object({
  studentIds: cuidArraySchema, // ✅ max(1000) enforced
  routeId: cuidSchema,
});

// ❌ WRONG — unbounded arrays = DoS risk
const assignSchema = z.object({
  studentIds: z.array(cuidSchema),
  routeId: cuidSchema,
});
```

---

## Idempotency

### For Mobile Clients (Network Retries)

Client generates a UUID per action, always sends it on retries:

```typescript
const idempotencyKey = crypto.randomUUID();
const response = await fetch('/v1/attendance/checkin', {
  method: 'POST',
  headers: { 'Idempotency-Key': idempotencyKey },
  body: JSON.stringify(payload),
});

// If network fails, retry with SAME key
const retryResponse = await fetch('/v1/attendance/checkin', {
  method: 'POST',
  headers: { 'Idempotency-Key': idempotencyKey },
  body: JSON.stringify(payload),
});
```

### Server-Side Caching

Route handler calls cacheIdempotentResponse() AFTER operation succeeds:

```typescript
import { cacheIdempotentResponse, IDEMPOTENCY_TTL } from '../../plugins/idempotency';

app.post('/attendance/checkin',
  { preHandler: mobileRoute(['STUDENT']) },
  async (request, reply) => {
    const result = await checkInService.execute(...);
    const body = ok(result, request.id);

    // Cache for 24 hours (one per day pattern)
    await cacheIdempotentResponse(request, 201, body, IDEMPOTENCY_TTL.ONE_DAY);

    return reply.code(201).send(body);
  },
);
```

### TTL Guidelines

| Pattern | TTL | Reason |
|---------|-----|--------|
| Daily actions (check-in, skip) | 24h | One per day |
| Session actions (wait-for-me) | 30min | Momentary |
| Business actions (correction) | 1h | Per session |
| Incident reports | 6h | Trip-bounded |
| Import execution | 48h | Full admin workflow |

---

## Rate Limiting

### Standard Limits

```typescript
import { checkRateLimit, RateLimits } from '../../lib/rate-limit';

app.post('/auth/login',
  async (request, reply) => {
    // 10 attempts per minute per IP
    await checkRateLimit((app as any).redis, {
      ...RateLimits.mobileLogin(request.ip),
      reply,
    });

    // Continue with login...
  },
);
```

### Pre-Built Limits

- `mobileLogin`: 10/min per IP
- `mobileRefresh`: 10/min per IP
- `adminLogin`: 10/min per IP
- `checkIn`: 5/min per user
- `gpsPing`: 30/min per bus
- `incidentReport`: 10/hour per driver
- `mfaDisable`: 3/15min per admin (security-critical)
- `forgotPassword`: 5/hour per IP

### Custom Limits

```typescript
await checkRateLimit((app as any).redis, {
  key: `rl:custom:file:${fileId}`,
  max: 100,
  windowSeconds: 3600,
  reply,
});
```

### Response Headers

All rate-limited endpoints return:

```
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 3
X-RateLimit-Reset: 1712145600
Retry-After: 45  (only on 429)
```

---

## Request Context & Logging

### Automatic

Every request includes in all logs:

```json
{
  "requestId": "uuid",
  "method": "POST",
  "path": "/v1/users",
  "statusCode": 201,
  "durationMs": 145,
  "userId": "cju123...",
  "role": "TRANSPORT_OFFICER"
}
```

### Slow Requests

Requests exceeding 2000ms are logged with WARN level:

```json
{
  "requestId": "uuid",
  "path": "/v1/users",
  "durationMs": 3245,
  "msg": "SLOW_REQUEST: exceeded 2000ms threshold"
}
```

### Access Logs

Fastify access logs (structured):

```
POST /v1/users 201 145ms userId=cju123 role=TRANSPORT_OFFICER
```

---

## Audit Log Sanitization

### Sensitive Fields

Automatically redacted from audit logs:

- `password`, `passwordHash`
- `fcmToken`, `firebaseToken`
- `mfaSecret`, `secret`, `apiKey`
- `refreshToken`, `accessToken`
- `resetToken`, `inviteToken`

### Usage

```typescript
import { sanitizeAuditEntries } from '../../lib/audit-sanitizer';

const entries = await getAuditLog(filters);
const sanitized = sanitizeAuditEntries(entries); // [REDACTED] sensitive fields

return reply.send(okList(sanitized, pagination, request.id));
```

---

## Environment Configuration

All required env vars are validated at startup in **`lib/env.ts`**:

```
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
JWT_SECRET=<min 16 chars>
ADMIN_JWT_SECRET=<min 16 chars>
CORS_ALLOWED_ORIGINS=https://mobile.example.com,https://admin.example.com
NODE_ENV=production
```

Missing variables cause server startup failure with clear error messages.

---

## Common Patterns

### Complete Route Example

```typescript
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { cuidSchema, ok, buildPagination, okList } from 'shared';
import { AppError } from '../../lib/errors';
import { adminRoute } from '../../middleware/route-guards';
import { checkRateLimit, RateLimits } from '../../lib/rate-limit';
import { cacheIdempotentResponse, IDEMPOTENCY_TTL } from '../../plugins/idempotency';

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

const createSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
});

export async function usersRoutes(app: FastifyInstance) {
  // GET list
  app.get('/',
    { preHandler: adminRoute(['TRANSPORT_OFFICER', 'MANAGEMENT']) },
    async (request, reply) => {
      const parsed = listQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);
      }

      const { page, limit, status } = parsed.data;
      const { users, total } = await userService.list({ page, limit, status });

      return reply.send(
        okList(users, buildPagination(page, limit, total), request.id)
      );
    },
  );

  // POST create
  app.post('/',
    { preHandler: adminRoute(['TRANSPORT_OFFICER'], true) },
    async (request, reply) => {
      const parsed = createSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);
      }

      // Rate limit
      await checkRateLimit((app as any).redis, {
        key: `rl:user-create:${request.user.sub}`,
        max: 100,
        windowSeconds: 3600,
        reply,
      });

      const user = await userService.create(parsed.data);
      const body = ok(user, request.id);

      // Cache (idempotent POST)
      await cacheIdempotentResponse(request, 201, body, IDEMPOTENCY_TTL.ONE_HOUR);

      return reply.code(201).send(body);
    },
  );

  // GET by ID
  app.get('/:id',
    { preHandler: adminRoute(['TRANSPORT_OFFICER', 'MANAGEMENT']) },
    async (request, reply) => {
      const params = z.object({ id: cuidSchema }).safeParse(request.params);
      if (!params.success) {
        throw new AppError(400, 'VALIDATION_ERROR', params.error.issues);
      }

      const user = await userService.getById(params.data.id);
      if (!user) {
        throw new AppError(404, 'USER_NOT_FOUND');
      }

      return reply.send(ok(user, request.id));
    },
  );
}
```

---

## Checklist: Implementing a New Endpoint

- [ ] Define Zod schema(s) (use shared schemas where possible)
- [ ] Define service layer method
- [ ] Choose `mobileRoute()` or `adminRoute()`
- [ ] If admin mutation, use `scoped=true`
- [ ] Wrap route handler to validate input
- [ ] Throw `AppError` on failures
- [ ] Wrap success response in `ok()`, `okList()`, or `fail()`
- [ ] Set correct status code (201 for POST create, 204 for DELETE, etc.)
- [ ] If idempotent, call `cacheIdempotentResponse()`
- [ ] If rate-limited, call `checkRateLimit()`
- [ ] Test with Postman/InsomniacodeBox
- [ ] Verify response envelope shape
- [ ] Verify error messages are helpful

---

## Hard Rules (Enforced via PR Review)

1. **No route may access Prisma directly** → Routes call services, services call repositories
2. **No `reply.send()` without `ok()` wrapper** → Every response must be standard shape
3. **No `z.string().uuid()` for entity IDs** → Always use `cuidSchema`
4. **No inline auth patterns** → Always `mobileRoute()` or `adminRoute()`
5. **No unbounded arrays** → Every `z.array()` must have `.max()`
6. **No new error codes without registry** → Add to `error-codes.ts` first
7. **No sensitive fields in audit log** → Always use `sanitizeAuditEntries()`
8. **All Cloud Tasks endpoints verify task header** → Prevents replay attacks

---

## Migration Guide (From Old Patterns)

### Response Shape

```typescript
// ❌ OLD
return reply.send({ success: true, incident });

// ✅ NEW
return reply.code(201).send(ok(incident, request.id));
```

### Pagination

```typescript
// ❌ OLD
return reply.send({ data, total, page, limit });

// ✅ NEW
return reply.send(okList(data, buildPagination(page, limit, total), request.id));
```

### Entity IDs

```typescript
// ❌ OLD
const schema = z.object({ userId: z.string().uuid() });

// ✅ NEW
const schema = z.object({ userId: cuidSchema });
```

### Error Throwing

```typescript
// ❌ OLD
throw new AppError('User not found', 404, 'USER_NOT_FOUND');

// ✅ NEW
throw new AppError(404, 'USER_NOT_FOUND');
```

### Auth Guards

```typescript
// ❌ OLD
[authenticate, requireRole(['COORDINATOR'])]

// ✅ NEW
adminRoute(['COORDINATOR'], true)
```

---

## Support

- **Questions?** Check the MASTER_IMPLEMENTATION_GUIDE.md
- **API Schema Issues?** Review `shared/src/schemas/common.ts`
- **Error Codes?** Refer to `shared/src/lib/error-codes.ts`
- **Rate Limits?** See `lib/rate-limit.ts` RateLimits constant
