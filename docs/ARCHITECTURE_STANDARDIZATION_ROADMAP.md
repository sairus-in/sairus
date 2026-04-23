# Architecture Standardization Roadmap — 11 Modules to Production

**Date**: April 4, 2026  
**Objective**: Enforce 4-layer pattern across all 20 modules  
**Status**: 3/20 modules complete (Users, Routes, Attendance), 11/20 need repositories, 6/20 are core/infra  
**Timeline**: 2-3 weeks (1-2 developers)

---

## 📊 Module Readiness Matrix

| Module | Layer | Status | Need Repo? | Effort | P0/P1 | Notes |
|--------|-------|--------|-----------|--------|-------|-------|
| **Auth** | Infra | 🟡 Partial | YES | 3h | P1 | Only Firebase wrapper; needs service layer |
| **Mobile-Auth** | Infra | 🟡 Partial | YES | 4h | P1 | ✅ Rate limiting extracted to service (DONE) |
| **Admin-Auth** | Infra | 🟢 Complete | - | 0h | - | Clean implementation, CSRF verified |
| **QR** | Infra | 🟢 Complete | - | 0h | - | Thin nonce generation, correct pattern |
| **Trips** | Core | 🟡 Partial | YES | 5h | P0 | Reference implementation needed |
| **Attendance** | Core | 🟢 Complete | ✅ EXISTS | 0h | - | Complex 13-step flow, repository exists |
| **GPS** | Core | 🟡 Partial | YES | 4h | P1 | Buffering logic, needs error handling |
| **Delegate** | Core | 🟡 Partial | YES | 3h | P1 | Redis-heavy, atomic operations |
| **Admin** | Ops | 🔴 Incomplete | YES | 6h | P1 | Command center, fragmented query logic |
| **Incidents** | Ops | 🟡 Partial | YES | 5h | P0 | ✅ Escalation added, list methods added |
| **Notifications** | Ops | 🔴 Critical | YES | 6h | P0 | ✅ FCM tokens fixed, needs transaction support |
| **Student** | Ops | 🟡 Partial | YES | 4h | P0 | BFF pattern, cache invalidation |
| **Driver** | Ops | 🔴 Violates | YES | 3h | P1 | Calls Prisma directly from routes |
| **Users** | Support | 🟢 Complete | ✅ EXISTS | 0h | - | Atomic import via transactions |
| **Import** | Support | 🟡 Partial | YES | 4h | P2 | Sequential transactions, needs streaming |
| **Fleet** | Support | 🟡 Partial | YES | 4h | P1 | Error handling needs P2025 mapping |
| **Reports** | Support | 🔴 Critical | - | 0h | P0 | Fire-and-forget, needs Cloud Tasks (out of scope) |
| **Routes** | Support | 🟢 Complete | ✅ EXISTS | 0h | - | Exemplary 4-layer + atomic mutations |
| **Jobs** | Infra | 🟡 Partial | - | 2h | P0 | Webhook handlers, returns 200 always |
| **RAG** | Infra | 🟰 Empty | - | 0h | - | Design phase, skip for now |

**Summary**:
- ✅ 4 modules complete (Admin-Auth, QR, Attendance, Users, Routes)
- 🟡 8 modules partially done (need repository extraction)
- 🔴 4 modules critical (Driver, Notifications, Student, Admin)
- ⏭️ 4 modules out of scope (RAG, Reports needs Cloud Tasks redesign)

---

## 🏗️ Repository Layer Template

Every repository must follow this pattern. Use [users.repository.ts](apps/backend/src/modules/users/users.repository.ts) as the gold standard:

```typescript
// apps/backend/src/modules/{MODULE}/{MODULE}.repository.ts

import { prisma } from '../../lib/prisma'
import { AppError } from '../../lib/errors'
import { Prisma } from '@prisma/client'
import type { AuditContext } from 'shared'

// ═══════════════════════════════════════════════════════════════════
// ERROR MAPPING
// ═══════════════════════════════════════════════════════════════════

function handlePrismaError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2025':
        throw new AppError('NOT_FOUND', 404, 'Record not found')
      case 'P2002':
        throw new AppError('CONFLICT', 409, 'Unique constraint violation', {
          field: error.meta?.target as string[]
        })
      case 'P2003':
        throw new AppError('FOREIGN_KEY_VIOLATION', 400, 'Referenced record does not exist', {
          field: error.meta?.field_name as string
        })
      case 'P2014':
        throw new AppError('INVALID_STATE', 400, 'Cannot perform operation: has dependent records')
      default:
        throw new AppError('DATABASE_ERROR', 500, `Database error: ${error.code}`)
    }
  }
  throw error
}

// ═══════════════════════════════════════════════════════════════════
// CRUD OPERATIONS
// ═══════════════════════════════════════════════════════════════════

async function findById(id: string) {
  try {
    return await prisma.{table}.findUnique({ where: { id } })
  } catch (e) {
    return handlePrismaError(e)
  }
}

async function findMany(filters: any) {
  try {
    return await prisma.{table}.findMany({ where: filters })
  } catch (e) {
    return handlePrismaError(e)
  }
}

async function create(data: any, audit?: AuditContext) {
  try {
    return await prisma.{table}.create({ data })
  } catch (e) {
    return handlePrismaError(e)
  }
}

async function update(id: string, data: any, audit?: AuditContext) {
  try {
    return await prisma.{table}.update({ where: { id }, data })
  } catch (e) {
    return handlePrismaError(e)
  }
}

async function delete_soft(id: string, audit?: AuditContext) {
  try {
    return await prisma.{table}.update({
      where: { id },
      data: { isActive: false }  // or isDeleted: true
    })
  } catch (e) {
    return handlePrismaError(e)
  }
}

// ═══════════════════════════════════════════════════════════════════
// TRANSACTIONS (for atomic multi-step operations)
// ═══════════════════════════════════════════════════════════════════

async function updateWithCascade(id: string, data: any) {
  try {
    return await prisma.$transaction([
      prisma.{table}.update({ where: { id }, data }),
      prisma.{related}.deleteMany({ where: { {table}Id: id } }),
      prisma.auditLog.create({
        data: {
          action: 'RECORD_UPDATED',
          resourceId: id,
          actorId: '...',
          timestamp: new Date(),
        }
      })
    ])
  } catch (e) {
    return handlePrismaError(e)
  }
}

export const {module}Repository = {
  findById,
  findMany,
  create,
  update,
  delete_soft,
  updateWithCascade,
  // ... more methods
}
```

---

## 🔄 11 Modules to Standardize

### **TIER 0: FOUNDATION (4 modules)**

#### 1️⃣ Auth Module
**Current State**: Thin Firebase wrapper, no repository  
**Files**: `modules/auth/auth.service.ts`, `modules/auth/auth.routes.ts`  
**Work**:
- Create `auth.repository.ts` (Firebase token verification, cache)
- Move Firebase calls from service to repository
- Add cache layer: JWT validation → Redis check

**Effort**: 3 hours  
**P-level**: P1 (medium priority)

---

#### 2️⃣ Mobile-Auth Module
**Current State**: ✅ Rate limiting extracted (DONE), still needs repository  
**Files**: `modules/auth/mobile-auth.service.ts`, `modules/auth/auth.routes.ts`  
**Work**:
- Create `mobile-auth.repository.ts`
- Move device binding logic to repository
- Add session validation queries to repository

**Effort**: 4 hours  
**P-level**: P1

---

#### 3️⃣ QR Module
**Current State**: ✅ Clean, correct pattern already  
**Files**: `modules/qr/qr.service.ts`  
**Work**: None (reference implementation)

**Effort**: 0 hours

---

#### 4️⃣ Admin-Auth Module
**Current State**: ✅ Complete 4-layer already  
**Files**: `modules/auth/admin-auth.service.ts`  
**Work**: None (reference implementation)

**Effort**: 0 hours

---

### **TIER 1: CORE OPERATIONS (4 modules)**

#### 5️⃣ Trips Module
**Current State**: Partial — service exists, no dedicated repository  
**Files**: `modules/trips/trips.service.ts`, `modules/trips/trips.routes.ts`  
**Work**:
- Extract `trips.repository.ts` (trip CRUD, state transitions)
- Move all Prisma calls from service
- Add error mapping for P2025 (trip not found)
- Add transaction for trip start/end (atomic state change)

**Effort**: 5 hours  
**P-level**: P0 (critical core path)  
**Key Methods**:
```typescript
- findById(tripId)
- findActive(busId, date)
- start(tripId, startData) // Atomic: update status + cache priming
- end(tripId, endData)    // Atomic: update status + clear caches
- markAbsent(tripId)      // Called via Cloud Tasks
```

---

#### 6️⃣ GPS Module
**Current State**: Partial — buffering + real-time, no repository  
**Files**: `modules/gps/gps.service.ts`, `modules/gps/gps.routes.ts`  
**Work**:
- Extract `gps.repository.ts` (ping storage, last-known lookups)
- Move batch flush logic to repository
- Add transaction for atomic multi-ping inserts
- Error handling for database timeouts (buffer overflow)

**Effort**: 4 hours  
**P-level**: P1  
**Key Methods**:
```typescript
- createMany(pings)                    // Batch flush, atomic
- getLastPing(busId)
- getLastNPings(busId, minutes)        // For playback
- updateGpsStatus(tripId, status)      // ONLINE/OFFLINE Redis
```

---

#### 7️⃣ Delegate Module
**Current State**: Partial — Redis-heavy, no repository  
**Files**: `modules/trips/delegate.service.ts`  
**Work**:
- Create `delegate.repository.ts` (state in Redis + DB)
- Add transaction for activation (SET NX lock + state write)
- Add transaction for end delegation (atomic cleanup)

**Effort**: 3 hours  
**P-level**: P1  
**Key Methods**:
```typescript
- activate(tripId, coordinatorId)      // Atomic: SET NX + write
- end(tripId)                          // Atomic: delete 3 Redis keys
- getActive(busId)
- checkHeartbeat()                     // Called from Jobs
```

---

#### 8️⃣ Attendance Module
**Current State**: ✅ Complete, repository exists  
**Work**: None (reference)

**Effort**: 0 hours

---

### **TIER 2: LIVE COORDINATION (5 modules)**

#### 9️⃣ Admin Module
**Current State**: Incomplete — fragmented query logic, no repository  
**Files**: `modules/admin/admin.service.ts`, `modules/admin/admin.routes.ts`  
**Work**:
- Extract `admin.repository.ts` (alerts, messages, stats)
- Consolidate fragmented Redis queries (sorted sets, hashes)
- Add pagination to alert feed query
- Statistics computation (refactor to service, data access in repo)

**Effort**: 6 hours  
**P-level**: P1  
**Key Methods**:
```typescript
- getAlerts(coordinatorId, limit, cursor)  // Paginated, filtered by route
- addAlert(alert)
- getMessages(recipientId)
- getMessage(id)
- getDashboardStats(coordinatorId)  // Cached 30s
- getIncidentQueue(routeId)
```

---

#### 🔟 Incidents Module
**Current State**: ✅ Escalation + list added this session  
**Files**: `modules/incidents/incidents.service.ts`, `modules/incidents/incidents.routes.ts`  
**Work**:
- Extract `incidents.repository.ts`
- Move all Prisma calls from service
- Add error mapping (P2025 → NOT_FOUND)
- Add transaction for atomic create + notification dispatch

**Effort**: 5 hours  
**P-level**: P0 (critical safety flow)  
**Key Methods**:
```typescript
- create(data, audit)              // Atomic: insert + audit log
- findById(id)
- listByRoute(routeId, filter)
- update(id, data, audit)
- resolve(id, resolverId, notes)
- getEscalationRecipients(level, routeId)
```

---

#### 1️⃣1️⃣ Notifications Module
**Current State**: 🔴 Critical — ✅ FCM tokens fixed, still needs repository  
**Files**: `modules/notifications/notifications.service.ts`, `jobs/notification.worker.ts`  
**Work**:
- Extract `notifications.repository.ts`
- Move BullMQ enqueue logic to repository
- Move in-app notification inserts to repository
- Add transaction for batch notification creation
- Track notification delivery status (PostgreSQL)

**Effort**: 6 hours  
**P-level**: P0  
**Key Methods**:
```typescript
- enqueueJob(userIds, payload, channels)  // BullMQ + DB record
- createInAppBatch(notifications)          // Atomic batch
- getFcmTokens(userIds)
- markTokensInvalid(tokens)
- getDeliveryStatus(jobId)
```

---

#### 1️⃣2️⃣ Student Module
**Current State**: 🔴 Critical — No caching despite being bottleneck  
**Files**: `modules/student/student.routes.ts`, `modules/student/student-home.service.ts`  
**Work**:
- Extract `student.repository.ts` (multi-query aggregation)
- Move all 7 Prisma queries to repository
- Add Redis cache layer to service (5-min TTL)
- Add cache invalidation hooks (from Attendance, Trips)
- Optimize parallel query execution

**Effort**: 4 hours  
**P-level**: P0 (peak-hour bottleneck)  
**Key Methods**:
```typescript
- getHomeData(studentId)            // Aggregate all home screen data
- getAttendanceHistory(studentId, limit)
- getRouteAssignment(studentId)
- getTripStatus(studentId)
- getFeatureFlags(studentId, role)
```

---

#### 1️⃣3️⃣ Driver Module
**Current State**: 🔴 Violates pattern — calls Prisma directly  
**Files**: `modules/driver/driver.routes.ts`, `modules/driver/driver.service.ts` (thin)  
**Work**:
- Extract `driver.repository.ts`
- Move all Prisma calls from routes to repository
- Add error mapping
- Refactor routes to only handle HTTP + service calls
- Add caching for route stops (rarely change)

**Effort**: 3 hours  
**P-level**: P1  
**Key Methods**:
```typescript
- getTodayAssignment(driverId)
- getRouteStops(routeId)
- getTripSummary(tripId)
```

---

### **TIER 3: ADMIN SUPPORT (4 modules)**

#### 1️⃣4️⃣ Users Module
**Current State**: ✅ Complete  
**Work**: None

---

#### 1️⃣5️⃣ Routes Module
**Current State**: ✅ Complete  
**Work**: None

---

#### 1️⃣6️⃣ Fleet Module
**Current State**: Partial — error handling needs P2025 mapping  
**Files**: `modules/fleet/fleet.routes.ts`, `modules/fleet/fleet.service.ts`  
**Work**:
- Extract `fleet.repository.ts`
- Add Prisma error mapping
- Add transaction for cascading deletes (bus → assignments → trips)
- Move validation to service, queries to repository

**Effort**: 4 hours  
**P-level**: P1  
**Key Methods**:
```typescript
- createBus(data, audit)
- updateBus(id, data, audit)
- deactivateBus(id, audit)           // Cascade: assignments, trips
- createDriver(data, audit)
- deactivateDriver(id, audit)         // Cascade: active trip end
```

---

#### 1️⃣7️⃣ Import Module
**Current State**: Partial — sequential transactions, needs streaming  
**Files**: `modules/import/import.routes.ts`, `modules/import/import.service.ts`  
**Work**:
- Extract `import.repository.ts`
- Move conflict checking to repository
- Move upsert logic to repository
- Add error handling + validation errors accumulation
- (Streaming CSV is P2, defer)

**Effort**: 4 hours  
**P-level**: P2 (bulk operations, non-critical path)  
**Key Methods**:
```typescript
- validateStudentRows(rows)          // Pre-flight checks
- upsertStudents(rows)               // All-or-nothing
- createAssignments(rows)            // Route validation
- getConflicts(rows, activeTripIds)  // Students on active trips
```

---

### **TIER 4: INFRASTRUCTURE (2 modules)**

#### 1️⃣8️⃣ Jobs Module
**Current State**: Partial — returns HTTP 200 always, no error handling  
**Files**: `modules/jobs/jobs.routes.ts`  
**Work**:
- Add error handling: return 500 on caught exceptions
- Add Zod validation on Cloud Tasks payloads
- Add logging for all job invocations
- (Cloud Tasks redesign for Reports is separate, P0)

**Effort**: 2 hours  
**P-level**: P0  
**Changes**: See [jobs.routes.ts](apps/backend/src/modules/jobs/jobs.routes.ts)

---

#### 1️⃣9️⃣ RAG Module
**Current State**: Empty  
**Work**: Skip (design phase)

---

---

## 📋 Implementation Sequence (Critical Path First)

### **Week 1: Critical Modules** (~40 hours)
1. ✅ Student repository (4h) — Fixes peak-hour bottleneck
2. ✅ Incidents repository (5h) — Completes safety flow
3. ✅ Notifications repository (6h) — Completes multi-channel dispatch
4. ✅ Trips repository (5h) — Core operations standardization
5. ✅ GPS repository (4h) — Realtime tracking standardization
6. ✅ Driver repository (3h) — Fixes architectural violation
7. ✅ Delegate repository (3h) — Emergency failover standardization
8. ✅ Mobile-Auth repository (4h) — Foundation standardization
9. ⏸️ Admin repository (6h) — Deferred to week 2

### **Week 2: Support Modules** (~25 hours)
1. Fleet repository (4h)
2. Import repository (4h)
3. Admin repository (6h)
4. Auth repository (3h)
5. Jobs error handling (2h)
6. All Prisma error mapping verification (4h)

### **Week 3: Integration & Testing** (~25 hours)
1. Add database composite indexes (2h)
2. Global error handler middleware (3h)
3. Verify all endpoints wrapped in ok()/okList() (3h)
4. Add transaction support (4h)
5. Setup Sentry + monitoring (6h)
6. Load testing & performance validation (7h)

**Total**: ~90 hours = 2–3 weeks (1 developer)

---

## ✅ Checklist: Each Repository Must Have

- [ ] CRUD methods (find, findMany, create, update, delete_soft)
- [ ] Prisma error mapping (P2025→404, P2002→409, etc.)
- [ ] Transactions for multi-step operations
- [ ] Audit logging for mutations (if applicable)
- [ ] Type imports from Prisma
- [ ] No business logic (all logic in service)
- [ ] No HTTP knowledge (pure Prisma access)

---

## 📝 Current Module Violations

```
❌ DRIVER: Calls prisma.trip, prisma.route from routes.ts directly
   FIX: Extract driver.repository.ts, move queries there

❌ STUDENT: 7 Prisma queries in service, no caching
   FIX: Extract repository, add Redis cache in service layer

❌ ADMIN: Fragmented Redis queries, no consolidated query interface
   FIX: Extract admin.repository.ts, centralize Redis patterns

❌ FLEET: Returns raw Prisma errors (P2025) as 500s
   FIX: Repository error mapping, throw AppError(404)

❌ NOTIFICATIONS: Mostly repository, but inconsistent with others
   FIX: Standardize pattern, add BullMQ interface

❌ JOBS: Returns 200 on all responses, never retries
   FIX: Return 500 on error, add validation

✅ ROUTES: Exemplary 4-layer, atomic transactions, error mapping
✅ USERS: Complete implementation, reference pattern
✅ ATTENDANCE: Complex logic properly structured
```

---

## 🎯 Success Criteria (Production Ready)

- [ ] All 20 modules follow 4-layer pattern (routes → service → repository → DB)
- [ ] All Prisma errors mapped to AppError in repository layer
- [ ] All HTTP responses wrapped in ok() or okList()
- [ ] All multi-step operations use prisma.$transaction
- [ ] All mutations logged to auditLog table
- [ ] Database indexes created for all WHERE/ORDER BY clauses
- [ ] Global error handler catches all exceptions + sends to Sentry
- [ ] Load test: 1000 concurrent students checking in (latency <500ms p95)
- [ ] No N+1 queries (use include/select properly)
- [ ] Cache invalidation is explicit and complete

---

## 🔗 References

- **Guide**: [PRODUCTION_ENFORCEMENT_GUIDE.md](../PRODUCTION_ENFORCEMENT_GUIDE.md)
- **Status**: [PRODUCTION_READINESS_STATUS.md](PRODUCTION_READINESS_STATUS.md)
- **Reference Impl**: [users.repository.ts](apps/backend/src/modules/users/users.repository.ts)
- **4-Layer Pattern**: [college_bus_system_agent_guide.md](../college_bus_system_agent_guide.md#3-the-4-layer-architecture-pattern)

---

**Next Action**: Start with Student, Incidents, Notifications, Trips (critical path)  
**Owner**: Architecture Lead  
**Review Frequency**: Daily standup to track progress
