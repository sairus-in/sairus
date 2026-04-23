# API Layer - Quick Reference Card

## Response Envelopes

```typescript
// Single resource (201 for create, 200 for GET/PATCH/PUT)
ok(data, requestId)
// Output: { success: true, data, requestId, timestamp }

// Paginated list (always 200)
okList(data, pagination, requestId)
// Output: { success: true, data: [...], pagination: {...}, requestId, timestamp }

// Error (all status codes)
fail(code, message, { details, retryable, requestId })
// Output: { success: false, error, message, details, retryable, requestId, timestamp }
```

---

## Status Codes

| Code | Use When |
|------|----------|
| 201 | POST created new row |
| 200 | GET, PATCH, PUT, actions |
| 204 | DELETE (no body) |
| 400 | Validation failed |
| 401 | Auth missing/expired |
| 403 | Wrong role/scope |
| 404 | Not found |
| 409 | Duplicate/conflict |
| 422 | Business logic violation |
| 429 | Rate limited |

---

## Authorization

```typescript
// Mobile
preHandler: mobileRoute(['STUDENT', 'DRIVER'])

// Admin (read-only)
preHandler: adminRoute(['TRANSPORT_OFFICER', 'MANAGEMENT'])

// Admin (mutation, coordinator-scoped)
preHandler: adminRoute(['COORDINATOR', 'TRANSPORT_OFFICER'], true)
```

---

## Schemas

```typescript
// IDs
cuidSchema  // All entity IDs use CUID, NOT UUID

// Coordinates
coordinatesSchema  // Rejects [0,0], [-1,-1]

// Pagination (query params)
paginationSchema  // { page, limit } with coercion

// Bulk arrays
cuidArraySchema  // min(1), max(1000)

// Roles
mobileRoleSchema   // 'STUDENT' | 'DRIVER' | 'PARENT'
adminRoleSchema    // 'TRANSPORT_OFFICER' | 'COORDINATOR' | ...
```

---

## Error Codes

All in `shared/src/lib/error-codes.ts`. Use:

```typescript
throw new AppError(400, 'VALIDATION_ERROR', details);
throw new AppError(404, 'USER_NOT_FOUND');
throw new AppError(403, 'ACCOUNT_DISABLED');
throw new AppError(409, 'ALREADY_CHECKED_IN');
throw new AppError(429, 'RATE_LIMITED');
```

Never inline error strings.

---

## Idempotency

Client sends `Idempotency-Key` header on critical writes:

```typescript
// Route handler (after success)
await cacheIdempotentResponse(request, statusCode, body, ttlSeconds);

// TTL constants
IDEMPOTENCY_TTL.ONE_DAY       // 86400 – daily actions
IDEMPOTENCY_TTL.ONE_HOUR      // 3600  – session actions
IDEMPOTENCY_TTL.THIRTY_MINUTES // 1800 – temporary
IDEMPOTENCY_TTL.SIX_HOURS     // 21600 – incident reports
IDEMPOTENCY_TTL.TWO_DAYS      // 172800 – imports
```

---

## Rate Limiting

```typescript
await checkRateLimit((app as any).redis, {
  ...RateLimits.incidentReport(driverId),
  reply,
});

// Pre-built: mobileLogin, mobileRefresh, adminLogin, checkIn, 
//            gpsPing, incidentReport, mfaDisable, forgotPassword
```

---

## Validation & Error Handling

```typescript
// 1. Define schema
const schema = z.object({
  tripId: cuidSchema,
  lat: z.number().min(-90).max(90),
});

// 2. Parse
const parsed = schema.safeParse(body);
if (!parsed.success) {
  throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);
}

// 3. Use parsed data
const { tripId, lat } = parsed.data;
```

---

## Middleware Stack

```
Request
  ↓
CORS + Security Headers
  ↓
Request Context (requestId, logging)
  ↓
Idempotency Cache (check/store)
  ↓
mobileRoute() OR adminRoute()
  ┣─ JWT verification
  ┣─ Role check
  ┗─ Coordinator scoping (if applicable)
  ↓
Route Handler (Zod parse → Service call → ok/okList)
  ↓
Error Handler (catches AppError, Zod, Prisma)
  ↓
Response (standard envelope)
```

---

## Complete Route Template

```typescript
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { cuidSchema, ok, okList, buildPagination } from 'shared';
import { AppError } from '../../lib/errors';
import { adminRoute } from '../../middleware/route-guards';
import { checkRateLimit, RateLimits } from '../../lib/rate-limit';
import { cacheIdempotentResponse, IDEMPOTENCY_TTL } from '../../plugins/idempotency';

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const createSchema = z.object({
  name: z.string().min(2).max(100),
});

export async function exampleRoutes(app: FastifyInstance) {
  // GET list
  app.get('/',
    { preHandler: adminRoute(['TRANSPORT_OFFICER']) },
    async (request, reply) => {
      const parsed = listSchema.safeParse(request.query);
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);
      const { page, limit } = parsed.data;
      const { items, total } = await service.list(page, limit);
      return reply.send(okList(items, buildPagination(page, limit, total), request.id));
    },
  );

  // POST create
  app.post('/',
    { preHandler: adminRoute(['TRANSPORT_OFFICER'], true) },
    async (request, reply) => {
      const parsed = createSchema.safeParse(request.body);
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);

      await checkRateLimit((app as any).redis, {
        key: `rl:create:user:${request.user.sub}`,
        max: 100,
        windowSeconds: 3600,
        reply,
      });

      const item = await service.create(parsed.data);
      const body = ok(item, request.id);
      await cacheIdempotentResponse(request, 201, body, IDEMPOTENCY_TTL.ONE_HOUR);
      return reply.code(201).send(body);
    },
  );

  // GET by ID
  app.get('/:id',
    { preHandler: adminRoute(['TRANSPORT_OFFICER']) },
    async (request, reply) => {
      const params = z.object({ id: cuidSchema }).safeParse(request.params);
      if (!params.success) throw new AppError(400, 'VALIDATION_ERROR', params.error.issues);
      const item = await service.getById(params.data.id);
      if (!item) throw new AppError(404, 'RESOURCE_NOT_FOUND');
      return reply.send(ok(item, request.id));
    },
  );
}
```

---

## Common Mistakes ❌→✅

| Mistake | Fix |
|---------|-----|
| `reply.send(data)` | `reply.send(ok(data, request.id))` |
| `z.string().uuid()` | `cuidSchema` |
| `throw new Error(...)` | `throw new AppError(400, 'CODE')` |
| `[authenticate, requireRole(...)]` | `mobileRoute(roles)` or `adminRoute(roles)` |
| `{ total, page, limit, data }` | `okList(data, pagination)` |
| `reply.code(200).send(newUser)` | `reply.code(201).send(ok(newUser))` |
| No validation header check | Add `await cacheIdempotentResponse(...)` |
| No rate limiting on endpoint | Add `await checkRateLimit(...)` |
| Unbounded array in schema | Use `cuidArraySchema` (max 1000) |

---

## Debugging

**Request fails with 500?**
→ Check `/v1/ready` endpoint health

**Response shape wrong?**
→ Wrap with `ok()`, `okList()`, or `fail()`

**CUID validation fails?**
→ Use `import { cuidSchema } from 'shared'`

**Rate limit not working?**
→ Redis must be running, add headers to response

**Idempotency returns different result?**
→ TTL expired; increase `IDEMPOTENCY_TTL`

**Auth returns 403 instead of 200?**
→ Check role, check `scoped=true` for coordinator

---

## Documentation

- **Full Guide:** `API_LAYER_IMPLEMENTATION.md`
- **Summary:** `API_LAYER_SUMMARY.md`
- **Response Types:** `packages/shared/src/lib/response.ts`
- **Error Codes:** `packages/shared/src/lib/error-codes.ts`
- **Schemas:** `packages/shared/src/schemas/common.ts`

---

## Enforcement Rules (Non-Negotiable)

1. ✅ All responses use `ok()`, `okList()`, `fail()`
2. ✅ All entity IDs use `cuidSchema`
3. ✅ All errors in `ErrorCode` registry
4. ✅ All auth via `mobileRoute()`/`adminRoute()`
5. ✅ All lists paginated
6. ✅ No Prisma in routes
7. ✅ No sensitive fields in audit logs
8. ✅ All Cloud Tasks verify header
