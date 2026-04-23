# Production Enforcement Guide — System Architecture & Standards

> **For**: College Bus Management System (180+ buses, 1000+ students)  
> **Purpose**: Enforce 4-layer architecture, error handling, data atomicity, and observability  
> **Status**: Enforcement rules defined. Violation detection: manual code review + automated tests.

---

## 1. THE 4-LAYER ARCHITECTURE — MANDATORY PATTERN

Every module MUST follow this structure. Violations are architectural debt and must be refactored.

```
HTTP Request
     │
     ├─► LAYER 1: Routes (routes/module.routes.ts)
     │     ├─ Parse + validate HTTP input (Zod)
     │     ├─ Call service layer
     │     ├─ Wrap response in ok() or okList()
     │     ├─ Return HTTP response
     │     └─ NO business logic, NO Prisma calls
     │
     ├─► LAYER 2: Service (modules/module.service.ts)
     │     ├─ Orchestrate business logic
     │     ├─ Call repository for queries
     │     ├─ Coordinate between modules
     │     ├─ Throw typed AppError
     │     └─ NO Prisma imports, NO direct Redis
     │
     ├─► LAYER 3: Repository (modules/module.repository.ts)
     │     ├─ ALL Prisma queries live here
     │     ├─ Map Prisma errors to AppError
     │     ├─ Support transactions for atomic ops
     │     ├─ Add audit logging
     │     └─ NO business logic, NO HTTP knowledge
     │
     └─► LAYER 4: Database (Prisma + PostgreSQL)
           └─ Raw data persistence
```

### ✅ Correct Example

```typescript
// routes/user.routes.ts
app.post('/create', async (req, reply) => {
  const parsed = UserCreateSchema.safeParse(req.body)
  if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', parsed.error)
  
  const user = await userService.create(parsed.data)
  return reply.send(ok(user, req.id))
})

// service/user.service.ts
async function create(input: UserCreateInput) {
  // Business logic: validate uniqueness, hash password, etc.
  if (await userRepository.findByEmail(input.email)) {
    throw new AppError(409, 'EMAIL_EXISTS', 'Email already registered')
  }
  
  const hashedPassword = await hashPassword(input.password)
  const user = await userRepository.create({ ...input, password: hashedPassword })
  return user
}

// repository/user.repository.ts
async function create(input: any) {
  try {
    return await prisma.user.create({ data: input })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2002') {
        throw new AppError(409, 'CONFLICT', 'Unique constraint violated')
      }
    }
    throw e
  }
}
```

### ❌ INCORRECT (Will be rejected in code review)

```typescript
// DON'T: Prisma in routes
app.post('/create', async (req, reply) => {
  const user = await prisma.user.create({ data: req.body })  // ← VIOLATION
  return reply.send(user)  // ← Not wrapped in ok()
})

// DON'T: Redis cache in service without abstraction
async function getUser(id: string) {
  const cached = await redis.get(`user:${id}`)  // ← VIOLATION
  if (cached) return JSON.parse(cached)
  // ...
}

// DON'T: Business logic in repository
async function findById(id: string) {
  const user = await prisma.user.findUnique({ where: { id } })
  if (!user || user.role !== 'ADMIN') {  // ← VIOLATION: authorization logic
    throw new Error('Not authorized')
  }
  return user
}
```

---

## 2. ERROR HANDLING — UNIVERSAL STANDARD

### AppError Contract
Every error must be an instance of `AppError` with these fields:

```typescript
export class AppError extends Error {
  constructor(
    public readonly code: string,          // Machine-readable: NOT_FOUND, CONFLICT, etc.
    public readonly statusCode: number,    // HTTP status: 400, 404, 409, 500, etc.
    public readonly message: string,       // User-friendly message
    public readonly meta?: Record<string, unknown> // Optional metadata for logging
  ) {}
}
```

### HTTP Response Envelope (ALL endpoints)
Every response MUST use `ok()` or `okList()` from shared:

```typescript
// Success response  
return reply.send(ok(data, requestId))

// Success list response with pagination
return reply.send(okList(items, pagination, requestId))

// Error response (handled by middleware)
throw new AppError('NOT_FOUND', 404, 'User not found')
```

### Prisma Error Mapping (Repository Layer)
All Prisma errors must be caught and mapped to AppError:

```typescript
import { Prisma } from '@prisma/client'

function mapPrismaError(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    switch (e.code) {
      case 'P2025': // Record not found
        throw new AppError('NOT_FOUND', 404, 'Record not found', { code: e.code })
      case 'P2002': // Unique constraint violation
        throw new AppError('CONFLICT', 409, 'Duplicate entry', { field: e.meta?.target })
      case 'P2003': // Foreign key constraint failed
        throw new AppError('FOREIGN_KEY_VIOLATION', 400, 'Referenced record not found')
      case 'P2014': // Required relation violation
        throw new AppError('INVALID_STATE', 400, 'Cannot delete record with dependent relationships')
      default:
        throw new AppError('DB_ERROR', 500, 'Database error', { code: e.code })
    }
  }
  throw e
}
```

### Global Error Handler Middleware
All routes are protected by:

```typescript
app.setErrorHandler((error, request, reply) => {
  if (error instanceof AppError) {
    return reply.code(error.statusCode).send({
      success: false,
      code: error.code,
      message: error.message,
      requestId: request.id,
      ...(process.env.NODE_ENV === 'development' && { meta: error.meta })
    })
  }
  
  // Unhandled error → log to Sentry
  logger.error('Unhandled error', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    requestId: request.id,
  })
  
  return reply.code(500).send({
    success: false,
    code: 'INTERNAL_SERVER_ERROR',
    message: 'An unexpected error occurred',
    requestId: request.id,
  })
})
```

---

## 3. DATA CONSISTENCY — TRANSACTIONS & ATOMICITY

### Rule: Multi-step operations MUST be atomic

Any operation that writes to multiple tables must use `prisma.$transaction`:

```typescript
// CORRECT: Atomic transaction
async function cancelTrip(tripId: string, reason: string) {
  return await prisma.$transaction([
    // Step 1: Mark trip as cancelled
    prisma.trip.update({
      where: { id: tripId },
      data: { status: 'CANCELLED', cancelledReason: reason }
    }),
    
    // Step 2: Cancel all related route assignments
    prisma.routeAssignment.updateMany({
      where: { trip: { id: tripId } },
      data: { isCancelled: true }
    }),
    
    // Step 3: Log the cancellation
    prisma.auditLog.create({
      data: {
        action: 'TRIP_CANCELLED',
        resourceId: tripId,
        actorId: getCurrentUserId(),
      }
    })
  ])
}

// WRONG: Not atomic — could crash between steps
async function cancelTrip(tripId: string, reason: string) {
  await prisma.trip.update({ ... })  // Step 1
  // ^ If app crashes here, step 2 never happens
  await prisma.routeAssignment.updateMany({ ... })  // Step 2
  await prisma.auditLog.create({ ... })  // Step 3
}
```

### Idempotency: Operations must handle retries
Any operation that might be retried (due to network errors, timeouts) must be idempotent:

```typescript
// CORRECT: Idempotent check-in
async function checkIn(studentId: string, tripId: string) {
  const existing = await attendanceRepository.findTodayLog(studentId, tripId)
  
  // If already checked in → return existing record, don't create duplicate
  if (existing?.status === 'PRESENT') {
    return existing
  }
  
  // Only create if not exists
  return await attendanceRepository.upsertLog({
    studentId,
    tripId,
    status: 'PRESENT',
    checkedInAt: new Date()
  })
}

// WRONG: Not idempotent
async function checkIn(studentId: string, tripId: string) {
  const log = await attendanceRepository.createLog({
    studentId,
    tripId,
    status: 'PRESENT'
  })
  // ^ Retry will create duplicate PRESENT records
  
  return log
}
```

---

## 4. CACHING STRATEGY — EXPLICIT INVALIDATION

### Rules for Cache Usage

**Rule 1**: Cache key naming convention
```
{resource}:{scope}:{identifier}:{variant}
Examples:
  student:home:abc123           (student home screen)
  trip:active:route:xyz789     (active trip for route)
  user:permissions:admin1       (admin permissions)
  bus:lastping:bus456          (last GPS ping)
```

**Rule 2**: Always set TTL
```typescript
// ❌ WRONG: No TTL
await redis.set(`student:${id}`, JSON.stringify(data))

// ✅ CORRECT: TTL set
await redis.setex(`student:home:${id}`, 300, JSON.stringify(data))  // 5 min TTL
```

**Rule 3**: Invalidate on write
```typescript
// ❌ WRONG: Write to DB but forget cache
await userRepository.update(id, { name, email })
// ^ Cache is now stale

// ✅ CORRECT: Cache invalidated with transaction
await prisma.$transaction(async () => {
  await userRepository.update(id, { name, email })
  await redis.del(`user:profile:${id}`)  // Explicit invalidation
})
```

**Rule 4**: Cache only read-only data
```typescript
// ✅ CORRECT: Cache stable student data
const student = await studentRepository.findById(id)
await redis.setex(`student:${id}`, 3600, JSON.stringify(student))

// ❌ WRONG: Cache transitional/mutable state
const trip = await tripRepository.findById(id)  // Status: ACTIVE (mutable!)
await redis.set(`trip:${id}`, JSON.stringify(trip))
// ^ Cache will be stale when trip ends
```

---

## 5. AUDIT LOGGING — IMMUTABLE RECORD OF CHANGES

### Every mutating operation must be audited

```typescript
export interface AuditContext {
  actorId: string
  actorRole: Role
  ip: string
  userAgent?: string
}

// In repository — log every change
async function updateAttendance(id: string, status: AttendanceStatus, audit: AuditContext) {
  const updated = await prisma.attendanceLog.update({
    where: { id },
    data: { status }
  })
  
  // Always create an audit log (before/after snapshot)
  await prisma.auditLog.create({
    data: {
      action: 'ATTENDANCE_STATUS_CHANGED',
      resourceType: 'ATTENDANCE_LOG',
      resourceId: id,
      beforeValue: JSON.stringify({ status: older_status }),
      afterValue: JSON.stringify({ status }),
      actorId: audit.actorId,
      actorRole: audit.actorRole,
      ipAddress: audit.ip,
      userAgent: audit.userAgent,
      timestamp: new Date(),
    }
  })
  
  return updated
}
```

### Called from routes with audit context
```typescript
// routes/attendance.routes.ts
app.patch('/:id', async (req, reply) => {
  const audit: AuditContext = {
    actorId: req.user.sub,
    actorRole: req.user.role,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  }
  
  const result = await attendanceService.updateStatus(req.params.id, req.body.status, audit)
  return reply.send(ok(result, req.id))
})
```

---

## 6. DATABASE INDEXES — MANDATORY FOR PERFORMANCE

### Composite Index Checklist

Every table used in WHERE/ORDER BY clauses MUST have appropriate indexes:

```prisma
// ✅ CORRECT: Composite indexes for common queries
model Trip {
  id String @id
  busId String
  routeId String
  status TripStatus
  dateScheduled DateTime
  
  @@index([busId, dateScheduled, status])  // ← Find trips for bus on date
  @@index([routeId, status])               // ← Active trips per route
}

model AttendanceLog {
  @@index([tripId, studentId, status])  // ← Check-in lookup
  @@index([studentId, createdAt])       // ← Attendance history
}

// ❌ WRONG: No indexes
model User {
  phone String  // Often queried: SELECT * WHERE phone = ? but NO index
  email String  // Unique but no explicit index reference
  role Role     // Filtered but no index
}
```

### Index Strategy
- **High cardinality** (>1000 unique values): Always index
- **Foreign keys**: Always index (Prisma does this automatically)
- **Range queries** (createdAt, date): Always index
- **Filter fields** in common WHERE clauses: Always index
- **Low cardinality** (enum, boolean): Only if frequently filtered

---

## 7. RATE LIMITING — PREVENT ABUSE

### Where to apply
- Authentication endpoints (login, register) — IP + phone per attempt
- API endpoints with high resource cost (file upload, report generation) — per user
- Webhook endpoints (Cloud Tasks) — per task type

### Correct Pattern
```typescript
// In service layer
export async function checkLoginRateLimit(ipAddress: string) {
  const key = `ratelimit:login:${ipAddress}`
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, 60)
  
  if (count > 10) {
    throw new AppError('RATE_LIMITED', 429, 'Too many requests. Try again in 1 minute.')
  }
}

// Called from routes
app.post('/login', async (req, reply) => {
  await checkLoginRateLimit(req.ip)  // ← Called first, before expensive operations
  const result = await authService.login(req.body)
  return reply.send(ok(result, req.id))
})
```

---

## 8. NOTIFICATIONS — RELIABILITY & DELIVERY GUARANTEE

### Multi-Channel GUARANTEED Delivery

```typescript
// Always dispatch to multiple channels
await notificationsService.dispatch(userIds, payload, [
  'PUSH',    // Firebase FCM (highest priority)
  'IN_APP',  // Database notification (fallback)
  'SMS',     // MSG91 (last resort for critical alerts)
])
```

### FCM Token Management
```typescript
// ✅ CORRECT: Real tokens + stale token cleanup
const tokens = await prisma.userDevice.findMany({
  where: { userId: { in: userIds }, fcmToken: { not: null }, isActive: true }
})

const response = await firebase.messaging().sendEachForMulticast({
  tokens: tokens.map(t => t.fcmToken),
  // ...
})

// Clean up stale tokens immediately
response.responses.forEach((resp, idx) => {
  if (!resp.success && isInvalidTokenError(resp.error?.code)) {
    prisma.userDevice.update({
      where: { id: tokens[idx].id },
      data: { fcmToken: null, isActive: false }
    })
  }
})

// ❌ WRONG: Mocked tokens (never reaches users)
const mockTokens = userIds.map(id => `fcm_token_for_${id}`)
```

---

## 9. CODE REVIEW CHECKLIST — ENFORCED

Every merge request must pass these checks:

### Architectural
- [ ] Routes layer: Only HTTP parsing + service calls
- [ ] Service layer: Only business logic + repository calls
- [ ] Repository layer: Only Prisma queries + error mapping
- [ ] No Prisma calls in routes or service files
- [ ] No business logic in repository files

### Error Handling
- [ ] All errors are `AppError` instances
- [ ] All endpoints wrapped in `ok()` or `okList()`
- [ ] All Prisma errors mapped in repository
- [ ] No `console.error()` or `throw new Error()` — use logger and AppError

### Data Consistency
- [ ] Multi-step writes use `prisma.$transaction`
- [ ] Operations are idempotent (handle retries safely)
- [ ] Audit logs created for all mutations
- [ ] Cache invalidated on writes

### Performance
- [ ] All WHERE/ORDER BY clauses have indexes
- [ ] N+1 queries eliminated (use `include` or batch loads)
- [ ] Large responses paginated (cursor-based)
- [ ] Expensive operations cached (with TTL + invalidation)

### Security
- [ ] Rate limiting enforced on public endpoints
- [ ] Authorization checks before data access
- [ ] No hardcoded secrets (use env vars)
- [ ] Sensitive data logged via `hashForLog()`

---

## 10. PRODUCTION DEPLOYMENT GATE

### Before deploying to production:

- [ ] All (P0) critical bugs fixed ✅
- [ ] All critical unit tests passing
- [ ] Load test: 1000 concurrent requests
- [ ] Database failover tested
- [ ] All endpoints returning ok() envelopes
- [ ] Error handler + Sentry configured
- [ ] Database indexes applied + analyzed
- [ ] Audit logging working
- [ ] Rate limiting tested
- [ ] Monitoring dashboards + alerts configured
- [ ] Runbooks written for 5+ incident scenarios
- [ ] Auto-scaling tested (Cloud Run config)
- [ ] Deployment + rollback procedures documented

### Rolling back?
If production issues detected:
1. Revert to previous Cloud Run revision (1-click rollback)
2. Database migrations are backward-compatible (never auto-migrate)
3. Cache invalidation happens automatically on code revision
4. Feature flags disable breaking changes

---

## Summary: What to Enforce

**Every module must**:
1. Follow 4-layer pattern (routes → service → repository → DB)
2. Use AppError for all errors + map Prisma errors
3. Wrap all responses in ok() or okList()
4. Audit all mutations (with before/after snapshot)
5. Use transactions for multi-step writes
6. Invalidate cache explicitly on writes
7. Add indexes for all WHERE/ORDER BY clauses
8. Rate limit public endpoints
9. Never mock production systems (FCM, SMS, Firebase)

**Every PR review checks**:
- [ ] Architecture pattern (4-layer)
- [ ] Error handling (all AppError, all wrapped)
- [ ] Data consistency (transactions, idempotency)
- [ ] Performance (indexes, caching, no N+1)
- [ ] Security (rate limiting, authorization)
- [ ] Tests passing

---

**Last Updated**: April 4, 2026  
**Version**: 1.0 (Enforcement Phase)  
**Owner**: Engineering Lead  
**Review Period**: Monthly / After major refactors
