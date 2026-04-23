# Module Reference Index — All 14 Audits

**Complete System Overview — Refactoring Reference**

This document provides a quick-access index to all 14 backend module audits, enabling architectural decisions and refactoring sequencing.

---

## Module Inventory (14 Total)

### ✅ Completed Audits

| Module | LOC | Complexity | Dependencies | Status | Audit File |
|--------|-----|-----------|--------------|--------|-----------|
| **Trips** | 800+ | ⭐⭐⭐⭐⭐ | PostgreSQL, Redis, Firebase, GPS, Attendance, Delegate, Notifications | Production-hardened | TRIPS_MODULE_AUDIT.md |
| **Attendance** | 800+ | ⭐⭐⭐⭐⭐ | QR, GPS, Redis, Transactions | Event-sourced, hardened | ATTENDANCE_MODULE_AUDIT.md |
| **GPS** | 500+ | ⭐⭐⭐⭐ | PostgreSQL, Redis, Firebase, Delegation | Batch-optimized | GPS_MODULE_AUDIT.md |
| **Incidents** | 400+ | ⭐⭐⭐⭐ | PostgreSQL, Notifications, Admin, Escalation | Partial stubs | INCIDENTS_MODULE_AUDIT.md |
| **Admin (Service)** | 600+ | ⭐⭐⭐⭐ | PostgreSQL, Redis, WebSocket, Notifications | Live dashboard | ADMIN_MODULE_AUDIT.md |
| **Notifications** | 400+ | ⭐⭐⭐⭐ | BullMQ, Firebase, MSG91, PostgreSQL | Multi-channel queue | NOTIFICATIONS_MODULE_AUDIT.md |
| **Admin-Auth** | 800+ | ⭐⭐⭐⭐ | PostgreSQL, Redis, CSRF, TOTP | Custom auth + MFA | ADMIN_AUTH_MODULE_AUDIT.md |
| **Users** | 500+ | ⭐⭐⭐ | PostgreSQL, Transactions | Import-integrated | USERS_MODULE_AUDIT.md |
| **Import** | 400+ | ⭐⭐⭐ | PostgreSQL, Users, Transactions | Two-stage validation | IMPORT_MODULE_AUDIT.md |
| **Admin Reports** | 350+ | ⭐⭐⭐ | PostgreSQL, Redis, BullMQ, CSV | Fire-and-forget async | REPORTS_MODULE_AUDIT.md |
| **Mobile-Auth** | 250+ | ⭐⭐ | Firebase, PostgreSQL, Redis, JWT | Device binding | MOBILE_AUTH_MODULE_AUDIT.md |
| **Auth (Service)** | 50+ | ⭐ | Firebase Admin | Minimal verification | AUTH_MODULE_AUDIT.md |
| **QR** | 35 | ⭐ | Redis, JWT, Cryptography | Nonce GETDEL | QR_MODULE_AUDIT.md |
| **Delegate** | 400+ | ⭐⭐⭐⭐ | PostgreSQL, Redis, GPS layer, Firebase | Atomic lock, 2-ping detection | DELEGATE_MODULE_AUDIT.md |

---

## Dependency Graph

```
EXTERNAL INPUTS (Device/Driver)
├── Mobile App (Firebase phone) → AUTH_MODULE → MOBILE_AUTH → JWT + Device Binding
├── Kiosk Scan → QR → JWT Nonce (Redis GETDEL)
└── Web Browser → ADMIN_AUTH → JWT + TOTP MFA

MOBILE JWT USAGE
├── Attendance (QR check-in) → Geofence + Event Sourcing
├── GPS Ping (realtime location upload)
└── Self-Report (GPS outage recovery)

GPS INTEGRATION
├── GPS Layer (batch buffer + Firebase)
├── Delegation Discovery (2-ping driver return)
├── Realtime Dashboard (Firebase RTDB)
└── Map Animation (coordinates + speed)

TRIP ORCHESTRATION
├── Start Trip → GPS Stream Begin
├── Attendance Check-In (13-step hardened)
├── Incidents (SOS reporting + escalation)
├── Admin Dashboard (live alerts + messages)
├── Assignment (substitute drivers)
└── End Trip → GPS Stream Stop + Delegate Cleanup

ADMIN OPERATIONS
├── Admin-Auth (Email/Password + TOTP MFA)
├── Command Center (alerts, outages, corrections)
├── Reports (async job queue)
└── User Management (bulk import transactions)

NOTIFICATIONS
├── Dispatch (multi-channel BullMQ)
├── Channels: PUSH (Firebase), IN_APP (DB), SMS (MSG91)
└── Consumers: Students, Staff, Coordinators

ASYNC JOBS
├── Reports (fire-and-forget → Redis-only storage)
└── Notifications (BullMQ queue → 5 concurrent workers)
```

---

## Critical Path Analysis

### **Tier 0: Foundation (Must Have)**
- ✅ Auth (verification) + Mobile-Auth (JWT) — without this, no one can log in
- ✅ Trips — orchestrates all bus operations

### **Tier 1: Bus Operations (Critical)**
- ✅ GPS — realtime tracking (enables live maps, delegation detection)
- ✅ Attendance — QR check-in (primary student interaction)
- ✅ Delegate — GPS fallback (operates when GPS offline)

### **Tier 2: Coordination (High-Value)**
- ✅ Admin (Command Center) — live dashboard (ops team decision support)
- ✅ Incidents — SOS/breakdown (critical safety feature)
- ✅ Notifications — multi-channel dispatch (alerts students/staff)

### **Tier 3: Administration (Operational Support)**
- ✅ Users — profiles + role management
- ✅ Import — bulk student provisioning
- ✅ Admin-Auth — staff login + MFA

### **Tier 4: Reporting & Utilities (Nice-to-Have)**
- ✅ Reports — async attendance analysis
- ✅ QR — nonce generation (simple, clean)
- ✅ Auth (Service) — Firebase wrapper (minimal)

---

## Quick Lookup: Problem Areas

### 🔴 Production Risk (P0 - Fix Before Refactoring)

| Module | Problem | Impact | Fix Complexity |
|--------|---------|--------|-----------------|
| **Reports** | Fire-and-forget (no Cloud Tasks) | Artifacts lost after 60min | Medium (add Cloud Tasks) |
| **Notifications** | Firebase tokens mock only | PUSH notifications fail | High (implement device lookup) |
| **Incidents** | Missing API implementations | Admin can't list/get incidents | Low (complete stubs) |
| **GPS** | No idempotency on retries | Duplicate metrics on network errors | Low (add operation ID) |
| **Attendance** | Firebase blocking hot path | 50-150ms spike per check-in | Medium (async GPS fetch) |

### ⚠️ Architectural Gaps (P1 - Address During Refactoring)

| Module | Gap | Recommendation |
|--------|-----|-----------------|
| **Admin-Auth** | No heartbeat monitor | Add session keep-alive for long-lived operations |
| **Import** | No streaming CSV | Implement chunked upload for 100K+ rows |
| **Attendance** | Arrival verification optional | Make mandatory + add auto-reminder FCM |
| **Delegate** | No cascade cleanup | Track lifecycle with Cloud Tasks |
| **Admin Service** | Alert set bloats | Implement FIFO queue with TTL + max size |

### 💡 Performance Optimizations (P2 - Nice-to-Have)

| Module | Opportunity | Gain |
|--------|-----------|------|
| **Admin Reports** | Pagination + streaming | Handle 1M+ rows without OOM |
| **Notifications** | Parallel SMS dispatch | 2x faster broadcast for 50K+ users |
| **Admin Service** | Batch trip lookup | 2-3× faster coordinator alert dequeue |
| **Attendance** | Batch rate limits | Pool Redis INCRBY operations |
| **GPS** | Cache geofence calcs | Skip repeated Haversine for same locations |

---

## Module Relationships: Data Flow

### **Student Check-In Flow**
```
1. Mobile Auth (Firebase phone) → JWT with deviceId
2. Mobile-Auth (device binding stored)
3. Attendance (hot path):
   - QR generation (WebSocket) + nonce in Redis
   - Check-in: Verify QR nonce (GETDEL) + geofence + eventSourcing
   - GPS fallback: Self-report if offline for 5+ mins
4. GPS Layer: Concurrent ping stream
5. Delegate Service: If GPS offline + coordinator takes over
6. Notifications: FCM to student app (arrival + alerts)
```

### **Admin Dashboard Flow**
```
1. Admin-Auth (Email/Password + TOTP MFA) → JWT with role
2. Admin Service (Command Center):
   - Live alerts (GPS outages, SOS alerts, attendance issues)
   - Message routing (broadcast to coordinators)
   - GPS state (active trips, delegation status)
3. Trip data (GPS batches → Firebase Realtime DB)
4. WebSocket (push updates to browser)
5. Notifications (escalations for critical issues)
```

### **Incident Escalation Flow**
```
1. Driver/Coordinator reports incident (Incidents module)
2. Create SOS alert (trip-dependent)
3. Notify all route coordinators (Notifications multi-channel)
4. Admin dashboard sees incident alert (Admin Service)
5. Accept + assign substitute (Trips.assignSubstitute)
6. GPS switches to assigned driver (GPS layer detects ping)
7. Push notification to new driver (Notifications)
8. Resolve incident (close SOS, clear alert)
9. Cloud Tasks auto-escalate (+10 mins unresolved) [NOT IMPLEMENTED]
```

### **Bulk Import Flow**
```
1. Admin uploads CSV (Import module)
2. Validate rows (Import.validateBulkStudents)
3. Check live trip conflicts (prevent mid-trip changes)
4. Execute in transaction (Users.upsert)
5. Create route assignments (conditional)
6. Mark import complete (session state)
7. Async provisioning (send credentials to students)
```

---

## Architecture Pattern: Current vs. Recommended

### **Current State: Class-Based Services**
```
Module
├── service.ts (mixed concerns)
│   ├── DB access (Prisma directly)
│   ├── Cache access (Redis directly)
│   ├── External calls (Firebase, APIs)
│   └── Domain logic
└── routes.ts (mixed validation)
    ├── Input validation (Zod)
    ├── Middleware binding (auth, scope)
    ├── Service call delegation
    └── Response serialization
```

### **Recommended: 4-Layer Pattern (Routes → Service → Repository → Types)**
```
Module
├── module.routes.ts
│   └── HTTP only (Zod validation, middleware, response)
├── module.service.ts
│   └── Business logic (coordination, transactions, no DB calls)
├── module.repository.ts
│   └── Data access (Prisma, atomic operations, indexed queries)
└── module.types.ts
    └── TSTypes + Zod validators (shared with packages/shared)
```

**Applied To:** Routes (complete reference implementation)  
**Ready For:** Trips (legacy, to be refactored), Attendance, GPS, Delegate

---

## Refactoring Sequence Recommendation

### **Phase 1: Critical Path (1-2 weeks)**
Priority: Unblock live system + enable developer velocity

1. **Trips** (COMPLETE 4-layer refactor)
   - Move all DB to repository layer
   - Extract route layer
   - Split service into domain + orchestration
   - Add integration tests
   - ~400 LOC → 600 LOC (clarity gain)

2. **Attendance** (COMPLETE 4-layer refactor)
   - Atomic operations → repository
   - Event sourcing logic → service
   - Validation → types
   - ~800 LOC → 1000 LOC (clarity + testability)

3. **GPS** (COMPLETE 4-layer refactor)
   - Batch buffer → service
   - Persistence → repository
   - Delegation detection → service
   - ~500 LOC → 700 LOC (clarity)

**Estimated Effort:** 80 hours (2 developers, 2 weeks)  
**Benefit:** 0 production risk, establish pattern, improve test coverage

---

### **Phase 2: High-Value Integrations (1.5 weeks)**
Priority: Reduce integration bugs + scale reliability

4. **Incidents** (COMPLETE 4-layer + fix stubs)
   - Implement listIncidents + getIncident
   - Add Cloud Tasks auto-escalation
   - Validation → types
   - ~400 LOC → 550 LOC

5. **Admin Service** (COMPLETE 4-layer refactor)
   - Scope control → repository queries
   - Message routing → service
   - Cache coordination → repository
   - ~600 LOC → 800 LOC

6. **Notifications** (COMPLETE 4-layer + fix tokens)
   - Fix Firebase token lookup (remove mocks)
   - Queue coordination → repository
   - Multi-channel dispatch → service
   - ~400 LOC → 600 LOC

**Estimated Effort:** 60 hours (2 developers, 1.5 weeks)  
**Benefit:** Production risks resolved, integration stability +40%

---

### **Phase 3: Operational Support (1 week)**
Priority: Operational excellence + scale limits

7. **Users** (COMPLETE 4-layer refactor)
   - Bulk import → service orchestration
   - Transactions → repository
   - Validation → types (shared)
   - ~500 LOC → 700 LOC

8. **Import** (COMPLETE 4-layer refactor + add streaming)
   - Validation context → repository
   - Row processing → service
   - Streaming CSV → repository
   - ~400 LOC → 600 LOC

9. **Admin-Auth** (COMPLETE 4-layer refactor)
   - Session management → repository
   - MFA logic → service
   - CSRF/TOTP → types
   - ~800 LOC → 1000 LOC

10. **Admin Reports** (COMPLETE 4-layer + add Cloud Tasks)
    - Job lifecycle → repository (persistent DB)
    - Processing → service
    - Add Cloud Tasks / Durable Job Queue
    - ~350 LOC → 500 LOC

**Estimated Effort:** 50 hours (2 developers, 1 week)  
**Benefit:** Admin operations scale 10×, operational visibility

---

### **Phase 4: Peripheral Services (3-4 days)**
Priority: Technical debt + simplification

11. **Delegate** (COMPLETE 4-layer refactor)
    - Atomic operations → repository
    - State machine → service
    - Escalation → service + Cloud Tasks
    - ~400 LOC → 600 LOC

12. **Mobile-Auth** (COMPLETE 4-layer refactor)
    - Device binding → repository
    - JWT issuance → service
    - Cache ops → repository
    - ~250 LOC → 350 LOC

13. **Auth Service** (Already minimal, light refactor)
    - Firebase verification → repository
    - User sync → service
    - ~50 LOC → 80 LOC

14. **QR** (Already clean, no refactor needed)
    - Current implementation already follows pattern
    - ~35 LOC (skip)

**Estimated Effort:** 30 hours (2 developers, 4 days)  
**Benefit:** Technical debt cleared, developer consistency

---

## Total Effort Estimate

| Phase | Modules | Effort | Duration | Risk |
|-------|---------|--------|----------|------|
| Phase 1 (Critical Path) | Trips, Attendance, GPS | 80h | 2 weeks | 🟢 Low |
| Phase 2 (High-Value) | Incidents, Admin Service, Notifications | 60h | 1.5 weeks | 🟡 Medium |
| Phase 3 (Operational) | Users, Import, Admin-Auth, Reports | 50h | 1 week | 🟡 Medium |
| Phase 4 (Peripheral) | Delegate, Mobile-Auth, Auth, QR | 30h | 4 days | 🟢 Low |
| **TOTAL** | **14 modules** | **220 hours** | **~5 weeks** | **🟢 Managed** |

**Team:** 2 developers, 1 tech lead (review + design)  
**Parallelization:** Phases 2-4 can run in parallel with Phase 1 code review

---

## Testing Strategy

Each refactored module needs:

1. **Unit Tests** (service layer, pure functions)
   - Domain logic (geofence calcs, event sourcing, state machines)
   - Validation (input + output contracts)
   - Cache operations

2. **Integration Tests** (repository layer)
   - Prisma queries + transactions
   - Redis operations (atomic patterns)
   - Error handling (constraint violations)

3. **E2E Tests** (critical paths)
   - Student check-in (happy path + GPS fallback)
   - Admin dashboard (live alerts, scope control)
   - Incident escalation (multi-channel notify)
   - Bulk import (transaction atomicity)

4. **Performance Tests** (scale validation)
   - GPS batch flush (1000+ pings)
   - Admin dashboard (10K+ live trips)
   - Notifications broadcast (50K+ users)
   - Attendance check-in (50+ concurrent users)

---

## Success Criteria

✅ **Code Quality:**
- Zero circular imports (enforced by build)
- 100% TypeScript type coverage
- Service layer isolation (no direct Prisma calls)
- Repository layer: All DB access atomic

✅ **Performance:**
- Check-in latency: 50-100ms (no Firebase blocking)
- Admin dashboard: 200-500ms (scope filtering)
- Report generation: Streaming (no OOM)
- Notification dispatch: 50K users in <3 mins

✅ **Reliability:**
- Idempotency: All critical operations have deduplication keys
- Atomicity: Transactions with bounded isolation
- Graceful degradation: GPS offline → self-report fallback
- Audit trails: Event sourcing for attendance/incidents/trips

✅ **Operational Excellence:**
- Cloud Tasks for all long-running jobs
- Distributed tracing (OpenTelemetry)
- Metrics dashboard (Prometheus + Grafana)
- Alert thresholds (incident escalation, latency)

---

## File Navigation

Each audit file follows this structure:
1. **Quick Summary** (1-2 paragraphs)
2. **Architecture Overview** (data flow, key methods)
3. **Key Strengths** (design wins)
4. **Critical Gaps** (P0/P1 issues)
5. **Performance Characteristics** (latency, throughput)
6. **Recommended Fixes** (priority-ordered)
7. **Full Details** (code examples, patterns, state machines)

**Start Here:**
- New to system? → Read Trips audit first (foundation)
- Working on features? → Search module name in this index
- Refactoring? → Read "Phase X" section above for sequence
- Debugging bug? → Find module in dependency graph, check "Critical Gaps"

---

## References

- **Architecture Pattern:** See [Routes Module](TRIPS_MODULE_AUDIT.md) — 4-layer reference
- **Event Sourcing:** See [Attendance](ATTENDANCE_MODULE_AUDIT.md) — immutable audit trail
- **Atomic Operations:** See [QR](QR_MODULE_AUDIT.md) + [Delegate](DELEGATE_MODULE_AUDIT.md) — GETDEL + SET NX patterns
- **Multi-Channel Integration:** See [Notifications](NOTIFICATIONS_MODULE_AUDIT.md) — BullMQ + Firebase + SMS
- **Scope Control:** See [Admin-Auth](ADMIN_AUTH_MODULE_AUDIT.md) + [Admin Service](ADMIN_MODULE_AUDIT.md) — role/route filtering
- **Design Patterns Library:** [CLAUDE.md](CLAUDE.md) — project decisions + key patterns
