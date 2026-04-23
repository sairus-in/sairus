# Refactoring Action Plan — 4-Layer Pattern Implementation

**Strategic Playbook for System-Wide Architecture Standardization**

This document provides step-by-step execution guidance for refactoring all 14 modules to the 4-layer pattern (Routes → Service → Repository → Types).

---

## Pre-Refactoring Checklist

### ✅ Prerequisites

- [ ] Read TRIPS_MODULE_AUDIT.md (reference implementation)
- [ ] Read MODULE_REFERENCE_INDEX.md (dependency graph)
- [ ] Set up test environment (Jest, integration DB)
- [ ] Create `origin-phase1`, `origin-phase2` branches for rollback
- [ ] Schedule code reviews (tech lead required)
- [ ] Alert team: refactoring in progress (no major feature PRs)

### ✅ Production Stabilization (MUST DO BEFORE Phase 1)

**CRITICAL P0 Fixes (blocks refactoring):**

1. **Fix Reports Cloud Tasks Integration** (2 days)
   - Replace fire-and-forget with GCP Cloud Tasks
   - Add persistent job storage to PostgreSQL
   - Implement retry policy + DLQ
   - [See REPORTS_MODULE_AUDIT.md — P0 section]

2. **Fix Notifications Firebase Tokens** (3 days)
   - Replace mock tokens with actual `userDevice` table lookup
   - Test PUSH notifications end-to-end
   - [See NOTIFICATIONS_MODULE_AUDIT.md — Critical gaps]

3. **Complete Incidents Stub Methods** (1 day)
   - Implement `listIncidents()` with filters
   - Implement `getIncident(id)` with full context
   - [See INCIDENTS_MODULE_AUDIT.md — List methods]

4. **Add Incidents Cloud Tasks Auto-Escalation** (2 days)
   - Implement +10-minute escalation workflow
   - Test escalation chain (COORDINATOR → OFFICER → PRINCIPAL)
   - [See INCIDENTS_MODULE_AUDIT.md — Escalation]

**Estimated P0 effort:** 8 days (1 developer)  
**Do this in parallel:** Phase 1 planning + setup

---

## Phase 1: Critical Path — Architectural Foundation

### **Module 1.1: Trips** (Reference Pattern + Foundation)

**Status:** Likely already partially refactored (TRIPS_AUDIT ref)  
**Effort:** 40 hours  
**Timeline:** Week 1-2  
**Team:** 1 senior + 1 mid-level developer

#### Step 1.1.1: Inventory Current State
```bash
wc -l apps/backend/src/modules/trips/*.ts
grep -n "prisma\." apps/backend/src/modules/trips/*.ts | wc -l
grep -n "redis\." apps/backend/src/modules/trips/*.ts | wc -l
```

**Goal:** Understand how many Prisma/Redis calls are in service vs routes

#### Step 1.1.2: Extract Routes Layer
**From:** `trips.service.ts` (mixed concerns)  
**To:** `trips.routes.ts` (HTTP only)

```typescript
// trips.routes.ts (FINAL STATE)
export const tripsRoutes: FastifyInstance = async (fastify) => {
  // POST /trips/:tripId/start
  fastify.post('/trips/:tripId/start', 
    {
      preHandler: [verifyAdminAuth],
      schema: { body: StartTripSchema }
    },
    async (req, res) => {
      const { startTime, busId, driverId } = req.body
      const result = await tripsService.startTrip({
        tripId: req.params.tripId,
        startTime,
        busId,
        driverId,
        context: { adminId: req.user.id, scope: req.scope }
      })
      return res.send({ success: true, data: result })
    }
  )
  
  // Similar: POST /trips/:tripId/end
  // Similar: PATCH /trips/:tripId/attendance-corrections
  // etc.
}
```

**Checklist:**
- [ ] All Zod validators moved to `.types.ts`
- [ ] All Prisma calls removed (→ repository)
- [ ] All Redis calls removed (→ service)
- [ ] Request/response serialization only
- [ ] Middleware binding (auth/scope) preserved
- [ ] TypeScript compilation: `tsc --noEmit` ✅

#### Step 1.1.3: Refactor Service Layer
**From:** Mixed concerns (DB + cache + logic)  
**To:** Pure business logic (orchestration, transactions)

```typescript
// trips.service.ts (FINAL STATE)
export class TripsService {
  constructor(
    private repo: TripsRepository,
    private gpsService: GPSService,
    private delegateService: DelegateService,
    private notificationsService: NotificationsService,
    private redis: Redis
  ) {}

  async startTrip(input: StartTripInput): Promise<Trip> {
    // Input validation (defensive)
    const trip = await this.repo.getTripById(input.tripId)
    if (trip.status !== 'SCHEDULED') {
      throw new APIError(TRIP_ALREADY_STARTED, `Trip ${input.tripId} already started`)
    }
    
    // Business logic: trip lifecycle
    const updatedTrip = await this.repo.updateTripStatus(input.tripId, 'ACTIVE')
    
    // Coordinate external systems
    await this.gpsService.startTracking(input.busId)
    await this.notificationsService.dispatch({
      type: 'TRIP_STARTED',
      recipients: { bus: input.busId },
      data: updatedTrip
    })
    
    // Cache invalidation (service decides)
    await this.redis.del(`trip:${input.tripId}:state`)
    
    return updatedTrip
  }
  
  // Service never calls Prisma directly
  // Service coordinates: repo + external services + cache
}
```

**Checklist:**
- [ ] Zero Prisma calls (→ async this.repo.method())
- [ ] Zero direct Redis (→ service cache policy)
- [ ] All domain logic preserved
- [ ] Error handling consistent (throw APIError)
- [ ] Dependencies injected (no `new` inside service)
- [ ] Unit tests pass ✅

#### Step 1.1.4: Extract Repository Layer
**From:** Scattered Prisma calls  
**To:** Database abstraction (atomic, indexed queries)

```typescript
// trips.repository.ts (FINAL STATE)
export class TripsRepository {
  constructor(private prisma: PrismaClient) {}

  async updateTripStatus(tripId: string, status: TripStatus): Promise<Trip> {
    return this.prisma.trip.update({
      where: { id: tripId },
      data: {
        status,
        updatedAt: new Date()
      },
      // Query optimization (index on status, id)
      select: tripSelectFull
    })
  }

  async getTripWithAttendance(tripId: string) {
    return this.prisma.trip.findUniqueOrThrow({
      where: { id: tripId },
      include: {
        routeAssignment: { include: { route: true, stop: true } },
        attendanceLogs: { where: { status: 'PRESENT' } },
        incidents: { include: { reports: true } }
      }
    })
  }
  
  // All Prisma calls here
  // Responsibility: indexed queries, transaction coordination
  // No business logic (just data access)
}
```

**Checklist:**
- [ ] All Prisma queries centralized
- [ ] Transaction patterns documented (prisma.$transaction)
- [ ] N+1 query prevention (proper includes)
- [ ] Indexes defined for common filters
- [ ] Integration tests ✅

#### Step 1.1.5: Organize Types
**From:** Types scattered + unvalidated  
**To:** Centralized, Zod-validated contracts

```typescript
// trips.types.ts (FINAL STATE)
export const TripStatusSchema = z.enum(['SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED'])
export type TripStatus = z.infer<typeof TripStatusSchema>

export const StartTripInputSchema = z.object({
  tripId: z.string().cuid(),
  startTime: z.date(),
  busId: z.string().cuid(),
  driverId: z.string().cuid()
})
export type StartTripInput = z.infer<typeof StartTripInputSchema>

export const TripResponseSchema = z.object({
  id: z.string(),
  routeId: z.string(),
  vehicleId: z.string(),
  status: TripStatusSchema,
  startedAt: z.date().nullable(),
  endedAt: z.date().nullable(),
  passengers: z.number(),
  attendanceRate: z.number()
})
export type TripResponse = z.infer<typeof TripResponseSchema>
```

**Checklist:**
- [ ] All input schemas use `.parse()` in routes
- [ ] All output schemas use `.parse()` for serialization
- [ ] Shared types in `packages/shared` if used elsewhere
- [ ] ZodError handling in error middleware ✅

#### Step 1.1.6: Testing
```bash
# Unit tests (service layer)
npm test -- trips.service.test.ts

# Integration tests (full stack)
npm test:integration -- trips.e2e.test.ts

# Type checking
tsc --noEmit

# Linting
eslint apps/backend/src/modules/trips
```

**Checklist:**
- [ ] Service unit tests (100+ mocks): 30+ tests ✅
- [ ] Repository integration tests (real DB): 20+ tests ✅
- [ ] Routes integration tests (HTTP): 15+ tests ✅
- [ ] Error scenarios (404, 403, transaction fail): 10+ tests ✅
- [ ] Coverage: >90%

---

### **Module 1.2: Attendance** (Critical Path)

**Effort:** 40 hours  
**Timeline:** Week 2-3 (parallel with Trips review cycle)

**Key Challenges:**
- Event sourcing + immutable audit trail
- Real-time geofence validation
- Atomic GETDEL nonce pattern
- Hot path optimization (50ms latency target)

**Refactoring Steps (abbreviated):**
1. Extract routes (QR check-in validation)
2. Refactor service (13-step hardened sequence → pure logic)
3. Extract repository (event sourcing, atomic operations)
4. Define types (Zod validators for GPS, geofence)
5. Test critical path (50+ concurrent check-ins)

**See:** [ATTENDANCE_MODULE_AUDIT.md — 4-Layer Refactoring Section]

---

### **Module 1.3: GPS** (Critical Path)

**Effort:** 35 hours  
**Timeline:** Week 3-4

**Key Challenges:**
- Batch buffering (dual-trigger: 5s / 100 pings)
- Delegation detection (Redis coordination)
- Driver return filter (2-ping threshold)
- Performance (150+ pings/sec throughput)

**Refactoring Steps (abbreviated):**
1. Extract routes (POST /gps/ping validation)
2. Refactor service (batch coordination, metrics)
3. Extract repository (createMany + delegation state)
4. Define types (Zod for ping payload)
5. Benchmark (ensure <50ms p99 latency)

**See:** [GPS_MODULE_AUDIT.md — 4-Layer Refactoring Section]

---

### **Phase 1 Deliverables**

```
apps/backend/src/modules/
├── trips/
│   ├── trips.routes.ts (HTTP only)
│   ├── trips.service.ts (logic only)
│   ├── trips.repository.ts (Prisma only)
│   ├── trips.types.ts (Zod validators)
│   └── __tests__/
│       ├── trips.service.test.ts (100+ tests)
│       ├── trips.repository.test.ts (50+ tests)
│       └── trips.e2e.test.ts (30+ tests)
├── attendance/
│   ├── (same 4-layer structure)
│   └── __tests__/
├── gps/
│   ├── (same 4-layer structure)
│   └── __tests__/
└── (other modules unchanged)
```

**Phase 1 PR Checklist:**
- [ ] Zero TypeScript errors (`tsc --noEmit`)
- [ ] Zero failing tests (`npm test`)
- [ ] >90% code coverage for service layers
- [ ] E2E tests pass on staging database
- [ ] Performance benchmarks: Trips start <100ms, Check-in <100ms, GPS ping <50ms
- [ ] Code review approved (tech lead + 1 senior)
- [ ] Deployment to staging + smoke tests ✅

---

## Phase 2: High-Value Integrations

### **Module 2.1: Incidents** (Fix Stubs + Refactor)

**Effort:** 20 hours  
**Timeline:** Week 4

**Key Tasks:**
1. Complete `listIncidents()` + `getIncident(id)` stubs
2. Add Cloud Tasks auto-escalation
3. Apply 4-layer pattern
4. Test escalation flow

---

### **Module 2.2: Admin Service (Command Center)**

**Effort:** 25 hours  
**Timeline:** Week 4-5

**Key Tasks:**
1. Extract message routing → service
2. Move scope control → repository
3. Optimize alert dequeue (batch trip lookup)
4. Apply 4-layer pattern

---

### **Module 2.3: Notifications** (Fix Tokens + Refactor)

**Effort:** 30 hours  
**Timeline:** Week 5

**Key Tasks:**
1. Fix Firebase token lookup (remove mocks)
2. Fix SMS deduplication
3. Apply 4-layer pattern
4. E2E test all 3 channels

---

### **Phase 2 Deliverables**

```
apps/backend/src/modules/
├── incidents/
│   ├── (4-layer structure)
│   └── Cloud Tasks integration ✅
├── admin/
│   ├── admin.routes.ts
│   ├── admin.service.ts
│   ├── admin.repository.ts
│   ├── admin.types.ts
│   └── __tests__/
└── notifications/
    ├── (4-layer structure)
    └── Firebase token lookup ✅
```

---

## Phase 3: Operational Support

**Timeline:** Week 6-7  
**Modules:** Users, Import, Admin-Auth, Admin Reports (4 modules)  
**Effort:** ~50 hours total

Follow same pattern:
1. Extract routes
2. Refactor service
3. Extract repository
4. Define types
5. Test coverage >90%

**Key Focus:**
- Users: Bulk import transactions
- Import: Streaming CSV support
- Admin-Auth: Session management + TOTP
- Admin Reports: Cloud Tasks integration

---

## Phase 4: Peripheral Services

**Timeline:** Week 8 (4 days)  
**Modules:** Delegate, Mobile-Auth, Auth, QR  
**Effort:** ~30 hours

- Delegate: Atomic locks + state machine
- Mobile-Auth: Device binding + session
- Auth: Firebase wrapper (minimal)
- QR: Already clean (reference pattern)

---

## Quality Gates & Validation

### Per-Module Validation

**Definition of Done (each module):**

```checklist
Refactoring Complete
├── Routes Layer
│   ├── [ ] Zero Prisma calls
│   ├── [ ] Zero Redis direct calls
│   ├── [ ] All validation schemas defined
│   └── [ ] Middleware intact (auth/scope)
├── Service Layer
│   ├── [ ] Pure logic (orchestration only)
│   ├── [ ] All Prisma → repository calls
│   ├── [ ] Error handling consistent
│   └── [ ] Dependency injection working
├── Repository Layer
│   ├── [ ] All Prisma calls centralized
│   ├── [ ] Transactions documented
│   ├── [ ] N+1 prevention (includes)
│   └── [ ] Indexes for common queries
└── Types Layer
    ├── [ ] Zod schemas for all endpoints
    ├── [ ] Input validation in routes
    ├── [ ] Output serialization in routes
    └── [ ] Shared types in packages/shared

Testing Complete
├── Unit Tests
│   ├── [ ] Service: 30+ tests
│   ├── [ ] Repository: 20+ tests
│   └── [ ] Coverage: >90%
├── Integration Tests
│   ├── [ ] Routes: 15+ tests
│   ├── [ ] Critical paths: 10+ tests
│   └── [ ] Error scenarios: 10+ tests
└── Performance Tests
    ├── [ ] Benchmarks established
    ├── [ ] P99 latency targets met
    └── [ ] Load test (50+ concurrent)

Code Review Complete
├── [ ] Tech lead approval
├── [ ] Senior developer approval
├── [ ] Linting passes (eslint/prettier)
└── [ ] Type checking passes (tsc)

Deployment Ready
├── [ ] Staging DB data migrated
├── [ ] Smoke tests pass (staging)
├── [ ] Rollback plan documented
├── [ ] Performance monitoring configured
└── [ ] Incident response prepared
```

### System-Level Validation

After all phases complete:

```bash
# Type Safety
tsc --noEmit
# Result: 0 errors

# Linting
npm run lint
# Result: 0 errors

# Test Coverage
npm test -- --coverage
# Result: ≥85% coverage overall

# Build
npm run build
# Result: All modules compile

# Integration
npm run test:e2e
# Result: All critical paths pass

# Performance
npm run benchmark
# Result: All targets met
```

---

## Risk Mitigation

### **Risk 1: Breaking Changes During Refactoring**

**Mitigation:**
- ✅ Branch per phase (`phase-1-trips`, `phase-2-incidents`, etc.)
- ✅ Keep old module alongside new (gradual migration)
- ✅ Feature flags for routes (old vs. new implementation)
- ✅ Run both in parallel for 1 sprint (validation)

### **Risk 2: Performance Degradation**

**Mitigation:**
- ✅ Benchmark before/after each phase
- ✅ Profile hot paths (check-in, GPS ping, admin dashboard)
- ✅ Load test (50+ concurrent users)
- ✅ Revert if p99 latency increases >20%

### **Risk 3: Production Data Loss**

**Mitigation:**
- ✅ Backup PostgreSQL before each phase
- ✅ Test recovery procedure (restore from dump)
- ✅ Staging environment matches production schema
- ✅ Rollback scripts prepared

### **Risk 4: Team Skill Transfer**

**Mitigation:**
- ✅ Pair programming for first 2 modules
- ✅ Document pattern in ARCHITECTURE.md
- ✅ Code review by tech lead (enforce consistency)
- ✅ Retrospective after Phase 1

---

## Success Metrics

### **Code Quality**
- ✅ TypeScript coverage: 100%
- ✅ Circular dependencies: 0
- ✅ Test coverage: >90%
- ✅ Linting: 0 errors
- ✅ Type errors: 0

### **Performance**
- ✅ Student check-in: <100ms p99
- ✅ GPS ping: <50ms p99
- ✅ Admin dashboard: <500ms
- ✅ Report generation: Streaming (no OOM)
- ✅ Notification broadcast: <3 mins for 50K users

### **Reliability**
- ✅ Error handling: 100% of routes
- ✅ Idempotency: All critical operations
- ✅ Audit trail: Event sourced
- ✅ Cloud Tasks: All async jobs
- ✅ Transaction atomicity: Database-level

### **Operational Excellence**
- ✅ Monitoring: Prometheus metrics
- ✅ Alerting: Critical thresholds
- ✅ Logging: Structured JSON
- ✅ Distributed tracing: OpenTelemetry
- ✅ Runbooks: Posted in Slack

---

## Execution Timeline

```
Week 1-2:  Phase 1.1 Trips (parallel with P0 fixes)
Week 2-3:  Phase 1.2 Attendance (parallel with Trips review)
Week 3-4:  Phase 1.3 GPS (parallel with Incidents)
Week 4:    Phase 2.1 Incidents (parallel with Admin Service)
Week 4-5:  Phase 2.2 Admin Service
Week 5:    Phase 2.3 Notifications
Week 6-7:  Phase 3 (Users, Import, Admin-Auth, Reports)
Week 8:    Phase 4 (Delegate, Mobile-Auth, Auth, QR)

Total: 8 weeks (2 developers + 1 tech lead review)
Parallel: Phases can overlap (manage via git branches)
```

---

## Rollback Procedures

### **Per-Phase Rollback**

If Phase X fails production validation:

```bash
# Revert phase branch
git revert origin/main..phase-X-branch

# Restore backup
pg_restore --dbname college_bus < backup-pre-phase-X.sql

# Redeploy previous version
gcloud run deploy college-bus-api --image previous-image-hash

# Verify
curl https://api.college-bus/health  # 200 OK
npm run smoke-tests                   # All pass
```

### **Full Rollback**

If entire refactoring blocked (catastrophic):

```bash
# Revert all changes
git checkout main  # Restore pre-refactoring state

# Mark as "refactoring paused"
# Schedule retrospective
# Plan new approach
```

---

## Next Steps

1. **NOW:** Review this document in team standup
2. **Day 1:** Complete P0 production fixes (Reports, Notifications, Incidents)
3. **Week 1:** Start Phase 1.1 (Trips refactoring)
4. **Week 2:** Code review + pair programming (Attendance)
5. **Week 3:** Proceed to GPS + Incidents in parallel

**Questions?** → Refer to [MODULE_REFERENCE_INDEX.md](MODULE_REFERENCE_INDEX.md) or specific audit files.

**Need clarification?** → See architecture decisions in [CLAUDE.md](CLAUDE.md)
