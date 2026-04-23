# College Bus System — Refactoring Orchestration Plan

**Status:** Initiated  
**Date:** April 4, 2026  
**Approach:** Boss Agent + Specialized Module Agents (Coordinated)  
**Goal:** Enforce 4-layer architecture + Fix P0/P1 issues across all 20 modules  

---

## Part 1: Architecture & Scope

### 4-Layer Architecture (Mandatory Pattern)

```
Routes (HTTP validation only)
  ↓
Service (Business logic, orchestration, caching)
  ↓
Repository (All Prisma calls, error mapping)
  ↓
Database (PostgreSQL)
```

### 20 Modules Organized by Tier

**Tier 0 — Foundation (4 modules)**
- Auth ✅ (clean, no Prisma)
- Mobile-Auth ⚠️ (P1: no rate limit)
- Admin-Auth ⚠️ (P1: CSRF stale on MFA, no rate limit on invite)
- QR ✅ (clean)

**Tier 1 — Core Operations (4 modules)**  
- Trips ✅ (4-layer pattern exists, but called directly by other modules)
- Attendance ⚠️ (P1: Firebase latency bottleneck)
- GPS ⚠️ (P2: buffer loss on crash)
- Delegate ⚠️ (P1: no heartbeat monitor)

**Tier 2 — Live Coordination (5 modules)**
- Admin ⚠️ (P1: unbatched context in sendMessage)
- Incidents ⚠️⚠️ (P0: Cloud Tasks escalation missing, list/get stubs; P1: no validation)
- Notifications ⚠️⚠️ (P0: mock FCM in production; P1: SMS no idempotency)
- Student ⚠️⚠️ (P0: 7+ queries, no cache; P1: substitute driver inconsistency)
- Driver ⚠️ (P1: Prisma called directly from routes, no service layer)

**Tier 3 — Admin Support (5 modules)**
- Users ✅ (atomic bulk import with $transaction)
- Import ⚠️ (P2: sequential per-row, no streaming; race condition on concurrent trip start)
- Fleet ⚠️ (P1: 404s surface as 500s, no transactions)
- Reports ⚠️⚠️ (P0: fire-and-forget with no Cloud Tasks, OOM risk on 50K+ rows)
- Routes ✅ (exemplary 4-layer pattern)

**Tier 4 — Infrastructure (2 modules)**
- Jobs ⚠️⚠️ (P0: returns 200 on all errors — Cloud Tasks never retries; no Zod validation)
- RAG (empty, design phase)

---

## Part 2: Agent Roles & Responsibilities

### Boss Agent (Self — Orchestration & Oversight)

**Responsibilities:**
- Manages subagent queue (preventing conflicts)
- Tracks global progress (which modules are done, which are in-progress)
- Validates cross-module contracts (e.g., Student invalidates caches in Attendance)
- Performs integration testing between module agents
- Checks for build errors after each module completion
- Updates master progress file

**Does NOT write code directly** — only supervises.

**Subagent Control:**
- Can start subagents sequentially or in parallel (with dependencies respected)
- Monitors subagent output for breaks/errors
- Can pause/restart if build fails
- Tracks token usage per subagent

---

### Module Agent Template (1 per module)

**Scope:** Single module only — does NOT touch other modules  

**Tasks:**
1. Extract Repository layer (if missing)
   - Move all Prisma calls from routes/service → repository
   - Implement error mapping (P2025→404, P2002→409, etc.)
   - Use typed imports (import type { Role } from '@prisma/client')

2. Clean Service layer
   - Remove all `import { prisma }` statements
   - Replace Prisma calls with repository method calls
   - Implement caching (if applicable)
   - Implement cache invalidation hooks

3. Fix Routes layer
   - HTTP validation only (Zod schemas)
   - Pass AuditContext through to service
   - Return proper HTTP response codes

4. Fix P0/P1 issues specific to module
   - Add rate limiting (Mobile-Auth, Admin-Auth)
   - Implement missing features (Incidents Cloud Tasks, Notifications FCM)
   - Fix async job durability (Jobs, Reports)
   - Add validation checks (driver assignment, trip status)

5. Build + Test
   - Run `npm run build` (zero errors)
   - Verify module compiles in isolation
   - Report any cross-module import issues to Boss

---

## Part 3: Refactoring Sequence

### Phase 1: Foundation (Tier 0) — Blocks Everything

#### 1a. Auth Module
- **Status:** Already clean ✅
- **Work:** None
- **Subagent:** Skip (review-only)

#### 1b. Mobile-Auth Module
- **Status:** Needs P1 fix (rate limiting)
- **Work:** 
  - Add `express-rate-limit` to login endpoint
  - Validate: 10 req/60s per IP
- **Subagent:** MobileAuthAgent
- **Dependencies:** None
- **Estimated effort:** 1 hour

#### 1c. Admin-Auth Module
- **Status:** Needs P1 fixes (CSRF stale on MFA, rate limit on invite)
- **Work:**
  - CSRF token must regenerate after MFA verification
  - Rate limit invite endpoint: 20 req/hour per principal
- **Subagent:** AdminAuthAgent
- **Dependencies:** None
- **Estimated effort:** 1.5 hours

#### 1d. QR Module
- **Status:** Already clean ✅
- **Work:** None
- **Subagent:** Skip (review-only)

### Phase 2: Core Operations (Tier 1) — Execution Depends on Phase 1

#### 2a. Trips Module
- **Status:** Needs contract enforcement (other modules call directly)
- **Work:**
  - Verify 4-layer pattern is complete (already is)
  - Add repository layer if missing (check current code)
  - Enforce: all callers use service, not prisma directly
  - Add database indexes: (date, routeId), (routeId, status), (driverId)
- **Subagent:** TripsAgent
- **Dependencies:** None
- **Estimated effort:** 2 hours

#### 2b. Attendance Module
- **Status:** Needs P1 fix (GPS latency) + 4-layer
- **Work:**
  - Extract attendanceRepository.ts
  - Implement 13-step check-in flow
  - Add geofence validation (Haversine distance)
  - Add self-report window (GPS offline >5 min)
  - Event sourcing: immutable AttendanceEvent table
- **Subagent:** AttendanceAgent
- **Dependencies:** Trips ✅
- **Estimated effort:** 3 hours

#### 2c. GPS Module
- **Status:** Needs P2 fix (buffer recovery) + 4-layer
- **Work:**
  - Extract gpsRepository.ts (batch flush, buffer overflow)
  - Implement 2-phase driver return detection
  - Implement GPS outage heartbeat (every 2 min)
  - Document: acceptable loss SLA (not acceptable for compliance)
- **Subagent:** GPSAgent
- **Dependencies:** Trips ✅
- **Estimated effort:** 2 hours

#### 2d. Delegate Module
- **Status:** Needs P1 fix (no heartbeat) + 4-layer
- **Work:**
  - Extract delegateRepository.ts
  - Implement SETNX atomic lock
  - Add heartbeat monitor (60s timeout)
  - Implement 3-step cleanup on end delegation
  - Add rate limit: 1 activation per 60s per route
- **Subagent:** DelegateAgent
- **Dependencies:** Trips ✅, GPS ✅
- **Estimated effort:** 2 hours

### Phase 3: Live Coordination (Tier 2) — Depends on Phase 1-2

#### 3a. Incidents Module (✅ ALREADY IN PROGRESS — Kristofer's Work)
- **Status:** 95% done (Cloud Tasks + validation remain)
- **Work:**
  - Finish: driver assignment validation (trip.driverId check)
  - Finish: trip status validation (trip.status === 'ACTIVE')
  - Add: database indexes (reportedById), (escalationLevel), (tripId)
- **Subagent:** IncidentsAgent (Kristofer continues)
- **Dependencies:** Trips ✅
- **Estimated effort:** 0.5 hours (finish)

#### 3b. Notifications Module
- **Status:** Needs P0 fix (mock FCM) + P1 (SMS idempotency) + 4-layer
- **Work:**
  - Extract notificationsRepository.ts
  - FIX P0: Remove mock FCM token logic—use real `userDevice` table lookup
  - FIX P1: Add idempotency key to MSG91 calls (jobId + recipientId)
  - Implement BullMQ batching (100 notifications per 5s)
  - Add database indexes: (userId, createdAt), (status)
- **Subagent:** NotificationsAgent
- **Dependencies:** Mobile-Auth ✅ (userDevice table), Admin-Auth ✅
- **Estimated effort:** 4 hours

#### 3c. Student Module
- **Status:** Needs P0 fix (7+ queries, no cache) + P1 (substitute driver) + 4-layer
- **Work:**
  - Extract studentRepository.ts (6 methods)
  - CRITICAL: implement Redis cache (5-min TTL) on /home endpoint
  - Fix substitute driver source (consistency check)
  - Add cache invalidation in Attendance + Trips
  - Add database indexes: (studentId, routeId), (studentId, date)
- **Subagent:** StudentAgent
- **Dependencies:** Trips ✅, Attendance ✅
- **Estimated effort:** 2 hours

#### 3d. Driver Module
- **Status:** Needs P1 fix (Prisma in routes) + 4-layer
- **Work:**
  - Extract driverRepository.ts (move all Prisma from routes)
  - Extract driverService.ts (orchestrate business logic)
  - Fix deprecated endpoints (410 Gone)
  - Add rate limiting: 10 req/min per driver
- **Subagent:** DriverAgent
- **Dependencies:** Trips ✅, Mobile-Auth ✅
- **Estimated effort:** 2 hours

#### 3e. Admin Module
- **Status:** Needs P1 fix (unbatched sendMessage) + 4-layer
- **Work:**
  - Extract adminRepository.ts
  - Replace O(M log M) coordinator filtering with single query + batch
  - Implement message deduplication
  - Add WebSocket connection pooling
- **Subagent:** AdminAgent
- **Dependencies:** Admin-Auth ✅, Notifications ✅
- **Estimated effort:** 2 hours

### Phase 4: Admin Support (Tier 3) — Depends on Phase 2-3

#### 4a. Users Module
- **Status:** Already 4-layer ✅ — minor cleanup
- **Work:**
  - Verify atomic $transaction usage
  - Add soft-delete cascade handling
  - Add database indexes: (uid), (email)
- **Subagent:** UsersAgent
- **Dependencies:** None
- **Estimated effort:** 1 hour

#### 4b. Import Module
- **Status:** Needs P2 fix (sequential per-row) + 4-layer + race condition
- **Work:**
  - Extract importRepository.ts
  - Implement streaming CSV parser
  - Change from sequential to batched $transaction (50 rows per batch)
  - Fix: check if student on active trip before import
  - Add rate limit: 1 import per 5 min per principal
- **Subagent:** ImportAgent
- **Dependencies:** Users ✅, Trips ✅, Routes ✅
- **Estimated effort:** 3 hours

#### 4c. Fleet Module
- **Status:** Needs P1 fixes (404→500, no transactions) + 4-layer
- **Work:**
  - Extract fleetRepository.ts
  - Fix: Prisma error handling (P2025→404)
  - Implement transactions on cascading mutations (deactivate driver → delete trips)
  - Add pagination on bus list
  - Add database indexes: (status), (operatorId)
- **Subagent:** FleetAgent
- **Dependencies:** Trips ✅
- **Estimated effort:** 2 hours

#### 4d. Routes Module
- **Status:** Already exemplary 4-layer ✅— reference implementation
- **Work:**
  - Verify pattern compliance
  - Document for other agents
  - No changes needed
- **Subagent:** Skip (review-only)

#### 4e. Reports Module
- **Status:** Needs P0 fix (fire-and-forget → Cloud Tasks) + 4-layer
- **Work:**
  - Extract reportsRepository.ts
  - FIX P0: Remove Redis-only artifact storage—use PostgreSQL + Cloud Tasks
  - Implement CSV streaming (S3 upload instead of in-memory)
  - Add pagination: 1000 rows max per export
  - Add audit logging: who exported, when, which rows
- **Subagent:** ReportsAgent
- **Dependencies:** Trips ✅, Jobs (see phase 5)
- **Estimated effort:** 3 hours

### Phase 5: Infrastructure (Tier 4) — Depends on Everything

#### 5a. Jobs Module
- **Status:** Needs P0 fixes (returns 200 on errors, no validation) + 4-layer
- **Work:**
  - Extract jobsRepository.ts
  - FIX P0: Return 4xx/5xx codes so Cloud Tasks retries
  - Add Zod validation on ALL Cloud Tasks webhooks
  - Implement idempotency: check if job already processed
  - Add database indexes: (jobId), (status, createdAt)
- **Subagent:** JobsAgent
- **Dependencies:** All Tier 1-3 modules ✅
- **Estimated effort:** 2 hours

#### 5b. RAG Module
- **Status:** Empty (design phase) — skip
- **Work:** None

---

## Part 4: Cross-Module Integration Points

**These must be checked after each module phase:**

### After Phase 1 (Foundation)
- [ ] All modules can authenticate (Mobile-Auth + Admin-Auth rate limiting working)

### After Phase 2 (Core Operations)
- [ ] Trips → Attendance contract: trip ACTIVE validation ✅
- [ ] Trips → GPS contract: last known position available ✅
- [ ] Trips → Delegate contract: delegation override working ✅
- [ ] Build: zero errors in Tier 1

### After Phase 3 (Live Coordination)
- [ ] Student invalidates cache in Attendance checks ✅
- [ ] Incidents notifies via Notifications (FCM real, not mock) ✅
- [ ] Incidents escalates via Jobs (Cloud Tasks, not fire-and-forget) ✅
- [ ] Build: zero errors in Tier 2

### After Phase 4 (Admin Support)
- [ ] Import validates trips via Trips module ✅
- [ ] Fleet invalidates Mobile-Auth cache on driver deactivate ✅
- [ ] Reports enqueues jobs via Jobs module ✅
- [ ] Build: zero errors in Tier 3

### After Phase 5 (Infrastructure)
- [ ] Jobs webhooks return proper HTTP codes ✅
- [ ] All Cloud Tasks payloads validated ✅
- [ ] Build: **FINAL BUILD — ZERO ERRORS REQUIRED**

---

## Part 5: Progress Tracking

### Master Status File (Updated by Boss Agent)

Will be located at: `REFACTORING_PROGRESS.md`

Format:
```
# Refactoring Progress — April 4-16, 2026

## Phase 1: Foundation (Tier 0)
- [x] Auth — ✅ SKIP (already clean)
- [x] Mobile-Auth — ✅ COMPLETE (rate limiting added)
- [ ] Admin-Auth — 🔄 IN_PROGRESS (CSRF fix in progress)
- [x] QR — ✅ SKIP (already clean)

## Phase 2: Core Operations (Tier 1)
- [ ] Trips — ⏳ BLOCKED (waiting for Phase 1)
- [ ] Attendance — ⏳ BLOCKED
- [ ] GPS — ⏳ BLOCKED
- [ ] Delegate — ⏳ BLOCKED

[...]

Build Status: ❌ (13 errors — non-incidents)
```

---

## Part 6: Subagent Instructions Template

Each subagent will receive:

```
# [Module] Agent — Refactoring Instructions

**Module:** [NAME]  
**Files:** src/modules/[name]/  
**Health Status:** [Current issues]  
**Dependencies:** [List of other modules this calls]  
**Estimated effort:** [Time]

## Mandatory Tasks

### 1. Repository Extraction
- [ ] Create src/modules/[name]/[name].repository.ts
- [ ] Move ALL Prisma calls from service/routes → repository
- [ ] Implement error mapping (P2025→404, etc.)
- [ ] Add logger.error() on all catches with source: 'SYSTEM'

### 2. Service Cleanup
- [ ] Remove import { prisma } from service file
- [ ] Replace all Prisma calls with repository method calls
- [ ] Keep business logic intact (caching, notifications, orchestration)
- [ ] Implement cache invalidation hooks

### 3. Routes Layer
- [ ] HTTP validation only (Zod schemas)
- [ ] Pass AuditContext to service on mutations
- [ ] Return okList() / ok() / fail() only

### 4. P0/P1 Fixes (Specific to Module)
- [ ] [List specific fixes for this module]

### 5. Build & Test
- [ ] Run: npm run build
- [ ] Report: any errors or cross-module issues
- [ ] Validate: module compiles in isolation

### 6. Report to Boss
- [ ] Post completion summary
- [ ] List any blocking issues found
- [ ] Confirm: no other modules touched
```

---

## Part 7: Boss Agent Execution Workflow

```
FOR EACH PHASE:
  1. Identify all modules in phase with no dependencies blocking them
  2. IF modules can be parallelized safely:
       Spawn subagents concurrently (e.g., Mobile-Auth + Admin-Auth can run in parallel)
  3. IF dependencies exist:
       Wait for predecessor modules to complete before spawning dependent modules
  4. Monitor each subagent:
       - Check for build errors after completion
       - Review cross-module contract violations
       - Update progress file
  5. IF any subagent fails:
       - Identify blocker
       - Pause queue
       - Fix issue before continuing

FINAL STEP:
  6. Run full `npm run build`
  7. If zero errors: ✅ PRODUCTION READY
     If errors: Triage + assign to appropriate subagent
```

---

## Part 8: Success Criteria

**Module Refactoring is complete when:**
- [ ] All 20 modules follow 4-layer architecture
- [ ] All P0 issues fixed:
  - Incidents: Cloud Tasks escalation ✅
  - Notifications: Real FCM tokens ✅
  - Student: Redis cache on /home ✅
  - Jobs: Proper HTTP codes ✅
  - Reports: Cloud Tasks durability ✅
- [ ] All P1 issues fixed:
  - Mobile-Auth: Rate limiting ✅
  - Admin-Auth: CSRF + invite rate limit ✅
  - All modules: Repository error mapping ✅
- [ ] All cross-module contracts verified ✅
- [ ] Build: **ZERO ERRORS** ✅
- [ ] Codebase: 100% TypeScript + Zod validated ✅

**Estimated Total Time:** 30-40 hours (2-3 weeks part-time)

---

## Part 9: Danger Zones (Things That Break Easy)

**CRITICAL — Boss Agent Must Monitor:**

1. **Student BFF cache invalidation**
   - If Attendance doesn't invalidate `student:home:${userId}`, data goes stale
   - Need to verify: every attendance change → Redis delete

2. **Trips state propagation**
   - If Trips doesn't update Redis on trip start/end, live map breaks
   - Need to verify: trip.status change → Redis + Firebase update

3. **Mock FCM tokens**
   - If Notifications isn't fixed, 0 push notifications in production
   - Need to verify: userDevice table lookup, not mock placeholder

4. **Cloud Tasks error codes**
   - If Jobs returns 200, Cloud Tasks thinks success and never retries
   - Need to verify: return 4xx/5xx on validation failures

5. **Cross-module Prisma imports**
   - If Driver module still imports Prisma after refactoring, it's broken
   - Need to verify: all imports removed from routes/service

---

## Next Steps

**Immediate (Next 30 min):**
1. ✅ Create REFACTORING_PROGRESS.md (this file)
2. ⏳ Boss Agent reviews this plan
3. ⏳ Spawn Phase 1 subagents (Mobile-Auth + Admin-Auth in parallel)

**Follow-up:**
- Boss Agent monitors Phase 1 progress
- As Phase 1 completes, spawn Phase 2 subagents
- Continue sequentially through Phase 5

---

**Boss Agent Controls Everything. Subagents Report Only to Boss.**

