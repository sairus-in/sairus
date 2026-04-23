# Refactoring Progress — Master Tracker

**Start Date:** April 4, 2026  
**Target Completion:** April 14-16, 2026 (2-3 weeks)  
**Boss Agent:** In control  
**Build Status:** 🔴 13 ERRORS (non-incidents, pre-refactoring state)

---

## Phase 1: Foundation (Tier 0) — 4 Modules

| Module | Status | Agent | ETA | Notes |
|--------|--------|-------|-----|-------|
| Auth | ✅ SKIP | — | — | Already clean (thin Firebase wrapper) |
| Mobile-Auth | ⏳ QUEUED | MobileAuthAgent | Phase 1a | Need: rate limiting (10/60s per IP) |
| Admin-Auth | ⏳ QUEUED | AdminAuthAgent | Phase 1b | Need: CSRF token refresh on MFA + rate limit invite |
| QR | ✅ SKIP | — | — | Already clean (GETDEL atomic, secure) |

**Phase 1 Status:** Not started  
**Dependencies:** None (can parallelize Mobile-Auth + Admin-Auth)

---

## Phase 2: Core Operations (Tier 1) — 4 Modules

| Module | Status | Agent | ETA | Notes |
|--------|--------|-------|-----|-------|
| Trips | ⏳ BLOCKED | TripsAgent | 2a | Need: verify 4-layer complete, add DB indexes |
| Attendance | ⏳ BLOCKED | AttendanceAgent | 2b | Need: extract repo, implement 13-step check-in, event sourcing |
| GPS | ⏳ BLOCKED | GPSAgent | 2c | Need: extract repo, batch buffering, driver return 2-phase |
| Delegate | ⏳ BLOCKED | DelegateAgent | 2d | Need: extract repo, SETNX lock, heartbeat monitor |

**Phase 2 Status:** Waiting for Phase 1  
**Dependencies:** Phase 1 ✅

---

## Phase 3: Live Coordination (Tier 2) — 5 Modules

| Module | Status | Agent | ETA | Notes |
|--------|--------|-------|-----|-------|
| Incidents | 🔄 IN_PROGRESS | IncidentsAgent (Kristofer) | 3a | ✅ Repo done, service refactored. Still need: validation + DB indexes |
| Notifications | ⏳ BLOCKED | NotificationsAgent | 3b | 🔴 P0: Mock FCM in prod. Need: real userDevice lookup, SMS idempotency |
| Student | ⏳ BLOCKED | StudentAgent | 3c | 🔴 P0: 7+ queries no cache. Need: extract repo, Redis 5-min TTL |
| Driver | ⏳ BLOCKED | DriverAgent | 3d | P1: Prisma in routes. Need: extract repo + service layer |
| Admin | ⏳ BLOCKED | AdminAgent | 3e | P1: unbatched sendMessage(). Need: batch optimization |

**Phase 3 Status:** Incidents in progress, others waiting  
**Dependencies:** Phase 2 ✅

---

## Phase 4: Admin Support (Tier 3) — 5 Modules

| Module | Status | Agent | ETA | Notes |
|--------|--------|-------|-----|-------|
| Users | ⏳ BLOCKED | UsersAgent | 4a | ✅ Already 4-layer. Minor cleanup: soft-delete cascade |
| Import | ⏳ BLOCKED | ImportAgent | 4b | P2: Sequential per-row. Need: batch 50 rows + streaming |
| Fleet | ⏳ BLOCKED | FleetAgent | 4c | P1: 404→500. Need: error handling + transactions |
| Routes | ✅ SKIP | — | — | Already exemplary 4-layer (reference impl) |
| Reports | ⏳ BLOCKED | ReportsAgent | 4e | 🔴 P0: Fire-and-forget, OOM risk. Need: Cloud Tasks + S3 stream |

**Phase 4 Status:** Waiting for Phase 3  
**Dependencies:** Phase 3 ✅

---

## Phase 5: Infrastructure (Tier 4) — 2 Modules

| Module | Status | Agent | ETA | Notes |
|--------|--------|-------|-----|-------|
| Jobs | ⏳ BLOCKED | JobsAgent | 5a | 🔴 P0: Returns 200 on all errors. Need: proper codes + Zod validation |
| RAG | ✅ SKIP | — | — | Empty (design phase only) |

**Phase 5 Status:** Waiting for Phase 4  
**Dependencies:** Phase 4 ✅

---

## Current Build Status

```
npm run build

Found 13 errors in 5 files:

Errors  Files
     1  src/app.ts:26 (routesRoutes not exported)
     7  src/jobs/notification.worker.ts (userDevice model missing, logger source invalid)
     2  src/modules/auth/mobile-auth.service.ts (logger source invalid)
     2  src/modules/auth/admin-auth.middleware.ts (MFA_REQUIRED code)
     2  src/modules/jobs/jobs.routes.ts (AppError string codes)

NOT incidents-related ✅
```

**Pre-Refactoring Build:** 🔴 13 ERRORS (expected — modules not yet refactored)

---

## Cross-Module Integration Checklist

### Before Phase 1 Completion
- [ ] All Tier 0 auth modules working (can login)

### Before Phase 2 Completion
- [ ] Trips → Attendance: trip ACTIVE check working
- [ ] Trips → GPS: last known position queryable
- [ ] Trips → Delegate: delegation override tested
- [ ] Build: Zero Tier 1 errors

### Before Phase 3 Completion
- [ ] Student cache invalidation in Attendance working
- [ ] Incidents → Notifications: Real FCM tokens (not mock)
- [ ] Incidents → Jobs: Cloud Tasks escalation enqueued
- [ ] Build: Zero Tier 2 errors

### Before Phase 4 Completion
- [ ] Import → Trips: Trip status validation working
- [ ] Fleet → Mobile-Auth: Cache invalidation on driver deactivate
- [ ] Reports → Jobs: Cloud Tasks job enqueued
- [ ] Build: Zero Tier 3 errors

### Final (Phase 5 Complete)
- [ ] Jobs CloudTasks webhooks return 4xx/5xx on errors
- [ ] All Zod validations in place
- [ ] **FINAL BUILD: ZERO ERRORS REQUIRED**
- [ ] ✅ Production Ready

---

## Agent Status Log

```
PHASE 1 — Foundation
├─ Auth (SKIP - already clean)
├─ Mobile-Auth (QUEUED) - MobileAuthAgent
├─ Admin-Auth (QUEUED) - AdminAuthAgent
└─ QR (SKIP - already clean)

PHASE 2 — Core Operations
├─ Trips (BLOCKED) - TripsAgent
├─ Attendance (BLOCKED) - AttendanceAgent
├─ GPS (BLOCKED) - GPSAgent
└─ Delegate (BLOCKED) - DelegateAgent

PHASE 3 — Live Coordination (CURRENT)
├─ Incidents (IN_PROGRESS - Kristofer) ✅ 90% done
├─ Notifications (BLOCKED) - NotificationsAgent
├─ Student (BLOCKED) - StudentAgent
├─ Driver (BLOCKED) - DriverAgent
└─ Admin (BLOCKED) - AdminAgent

PHASE 4 — Admin Support
├─ Users (BLOCKED) - UsersAgent
├─ Import (BLOCKED) - ImportAgent
├─ Fleet (BLOCKED) - FleetAgent
├─ Routes (SKIP - already clean)
└─ Reports (BLOCKED) - ReportsAgent

PHASE 5 — Infrastructure
├─ Jobs (BLOCKED) - JobsAgent
└─ RAG (SKIP - empty)
```

---

## Danger Zones Being Monitored

| Risk | Impact | Check |
|------|--------|-------|
| Student cache invalidation missing | Home page goes stale | Verify: Attendance deletes `student:home:${userId}` |
| Trip state not in Redis | Live map breaks | Verify: trip start/end updates Redis + Firebase |
| Mock FCM tokens remain | Zero push notifications | Verify: userDevice table lookup, not mock |
| Jobs returns 200 on errors | Cloud Tasks never retries | Verify: 4xx/5xx codes on validation fail |
| Prisma still imported in routes | Module broken | Verify: only repository has Prisma imports |

---

## Weekly Milestones

**Week 1 (Apr 4-6):**
- [ ] Phase 1 complete ✅
- [ ] Phase 2 in progress

**Week 2 (Apr 7-13):**
- [ ] Phase 2 complete ✅
- [ ] Phase 3 complete ✅
- [ ] Phase 4 in progress

**Week 3 (Apr 14-16):**
- [ ] Phase 4 complete ✅
- [ ] Phase 5 complete ✅
- [ ] Final build: ZERO ERRORS ✅
- [ ] ✅ PRODUCTION READY

---

**Next: Boss Agent spawns Phase 1 subagents**

