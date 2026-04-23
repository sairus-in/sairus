# College Bus System — Complete Engineering Guide for Coding Agent

> **Purpose:** This document is the single source of truth for understanding, fixing, structuring, and making the college bus tracking system production-reliable. It covers every module, every known issue, every fix with implementation detail, all inter-module data flows, caching strategy, async job durability, layering conventions, and the full optimization roadmap. Read it top to bottom before touching any code.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Technology Stack](#2-technology-stack)
3. [The 4-Layer Architecture Pattern](#3-the-4-layer-architecture-pattern)
4. [Module Reference — Tier 0: Foundation](#4-module-reference--tier-0-foundation)
5. [Module Reference — Tier 1: Core Operations](#5-module-reference--tier-1-core-operations)
6. [Module Reference — Tier 2: Live Coordination](#6-module-reference--tier-2-live-coordination)
7. [Module Reference — Tier 3: Admin Support](#7-module-reference--tier-3-admin-support)
8. [Module Reference — Tier 4: Infrastructure](#8-module-reference--tier-4-infrastructure)
9. [Critical System Flows (End-to-End)](#9-critical-system-flows-end-to-end)
10. [P0 Fixes — Must Do Before Production](#10-p0-fixes--must-do-before-production)
11. [P1 Fixes — Architectural Gaps](#11-p1-fixes--architectural-gaps)
12. [P2 Fixes — Performance & Minor Issues](#12-p2-fixes--performance--minor-issues)
13. [Cross-Cutting Concerns](#13-cross-cutting-concerns)
14. [Caching Strategy](#14-caching-strategy)
15. [Async Job Durability](#15-async-job-durability)
16. [Database Index Audit](#16-database-index-audit)
17. [Security Hardening](#17-security-hardening)
18. [Phased Execution Roadmap](#18-phased-execution-roadmap)
19. [Module Dependency Map](#19-module-dependency-map)
20. [Testing Strategy](#20-testing-strategy)

---

## 1. System Overview

The college bus system is a real-time fleet tracking and student attendance platform. It manages the full lifecycle of school bus operations: from buses leaving the depot in the morning, through live GPS tracking, QR-code-based student check-ins, incident reporting, GPS emergency delegation, and end-of-day attendance reporting.

### Scale targets
- 180+ buses operating concurrently
- 1000+ students checking in during a 30-minute morning rush window (6:45–7:15 AM)
- GPS pings arriving at ~10/min per bus = ~1,800 pings/min system-wide
- Real-time WebSocket connections from driver apps, admin dashboards, and student apps

### What "running" means
The system is considered production-ready when:
- Every student check-in is recorded reliably and idempotently
- Every GPS ping is persisted (with acceptable loss only during pod crashes)
- Incident escalation reaches the correct authority within 10 minutes
- Push notifications actually reach devices (not mock FCM tokens)
- Async jobs (reports, absent-marking, auth provisioning) survive pod restarts
- The admin dashboard reflects live state without stale data

---

## 2. Technology Stack

| Layer | Technology | Role |
|-------|-----------|------|
| Runtime | Node.js + TypeScript | All backend services |
| ORM | Prisma | PostgreSQL access, schema migrations |
| Database | PostgreSQL | Primary persistence |
| Cache / Pub-Sub | Redis | Session cache, BullMQ queues, GPS state, sorted alert sets |
| Realtime DB | Firebase RTDB | Live GPS map data for mobile apps |
| Auth (mobile) | Firebase Auth | Phone number identity verification |
| Auth (admin) | Custom email/TOTP | Staff login with MFA |
| Push | Firebase FCM | Push notifications to student/driver apps |
| SMS | MSG91 | Fallback SMS for critical alerts |
| Queue | BullMQ (Redis-backed) | Notification broadcast queue |
| Async jobs | GCP Cloud Tasks | Durable background work with retry |
| Hosting | GCP Cloud Run | Stateless containerized backend |
| WebSockets | Native ws / Socket.IO | Real-time dashboard and mobile updates |

### Key constraints imposed by Cloud Run
- **Stateless**: No in-process state survives a pod restart. Everything that must survive goes to Redis, PostgreSQL, or Firebase.
- **Scale-to-zero**: Instances may spin down between requests. Cold start budget is ~2s.
- **Concurrency**: Cloud Run can run multiple instances. All shared state must be atomically managed in Redis.

---

## 3. The 4-Layer Architecture Pattern

The `Routes` module is the **reference implementation**. Every module must follow this pattern. Deviation (e.g., calling Prisma directly from route handlers) is a P1 issue.

```
HTTP Request
     │
     ▼
┌─────────────────────────┐
│   Route Handler         │  ← validates HTTP input, calls service, returns HTTP response
│   routes/foo.routes.ts  │    no business logic here, no Prisma calls
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│   Service Layer         │  ← orchestrates business logic, calls repository
│   foo.service.ts        │    throws typed AppError, no Prisma imports
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│   Repository Layer      │  ← all Prisma calls live here
│   foo.repository.ts     │    maps Prisma errors to AppError (P2025 → NOT_FOUND)
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│   Prisma Client         │  ← raw DB access
└─────────────────────────┘
```

### AppError convention

```typescript
// packages/shared/errors.ts
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly meta?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// In a repository
import { Prisma } from '@prisma/client';
import { AppError } from '@shared/errors';

function handlePrismaError(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === 'P2025') throw new AppError(404, 'NOT_FOUND', 'Record not found');
    if (e.code === 'P2002') throw new AppError(409, 'CONFLICT', 'Unique constraint violated');
  }
  throw e;
}
```

### AuditContext convention

All mutating operations (create, update, delete) must pass an `AuditContext` from the route handler down through the service and into the repository. The repository logs it to an `AuditLog` table.

```typescript
export interface AuditContext {
  actorId: string;
  actorRole: 'STUDENT' | 'DRIVER' | 'COORDINATOR' | 'TRANSPORT_OFFICER' | 'PRINCIPAL';
  ip: string;
  userAgent?: string;
}
```

---

## 4. Module Reference — Tier 0: Foundation

Nothing in the system works without these four modules. They are the authentication and identity layer.

---

### 4.1 Auth

**File:** `src/modules/auth/`  
**Role:** Thin Firebase wrapper. The only entry point for mobile identity.  
**Health:** ✅ Clean

**What it does:**
- Accepts a Firebase ID token from the mobile client
- Calls `admin.auth().verifyIdToken(token)` — validates signature, expiry, and revocation
- Returns `{ uid, phoneNumber }` — nothing more
- Has no session management (that is delegated to Mobile-Auth)

**In development:** Accepts a mock token header (`X-Dev-Token: <uid>`) so Firebase isn't required locally.

**Dependencies:** Firebase Admin SDK  
**Called by:** Mobile-Auth only

**No fixes needed.** Keep it thin. Do not add session logic here.

---

### 4.2 Mobile-Auth

**File:** `src/modules/mobile-auth/`  
**Role:** Issues JWTs to students and drivers after Firebase verifies identity.  
**Health:** ⚠️ P1 (no rate limiting)

**What it does:**
1. Receives Firebase ID token from mobile app
2. Calls `Auth` module to verify it → gets `uid`
3. Looks up user in PostgreSQL by `uid`
4. Performs device binding: computes `SHA-256(deviceId)` and stores in `userDevice` table
5. Checks session version (incremented on logout/revocation) — issues JWT with `sessionVersion` claim
6. Pre-fetches route assignment so the mobile app has bus info immediately at login
7. Returns signed JWT (24h lifetime)

**Device binding detail:**
```typescript
const deviceHash = crypto.createHash('sha256').update(deviceId).digest('hex');
const device = await prisma.userDevice.upsert({
  where: { userId_deviceHash: { userId, deviceHash } },
  update: { lastSeenAt: new Date() },
  create: { userId, deviceHash, fcmToken: body.fcmToken }, // ← FCM token stored here
});
```

**Session versioning — instant revocation:**
```typescript
// In JWT payload
{ sub: userId, sessionVersion: user.sessionVersion, role: user.role }

// In auth middleware
if (payload.sessionVersion !== user.sessionVersion) {
  throw new AppError(401, 'SESSION_REVOKED', 'Session has been revoked');
}
```

To revoke all sessions: `prisma.user.update({ where: { id }, data: { sessionVersion: { increment: 1 } } })`

**P1 Fix — Add rate limiting:**
```typescript
import rateLimit from 'express-rate-limit';

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.ip,
  message: { error: 'TOO_MANY_REQUESTS', message: 'Try again in 60 seconds' },
});

router.post('/auth/mobile/login', loginLimiter, mobileAuthController.login);
```

**Called by:** All mobile endpoints (auth middleware validates JWT on every request)

---

### 4.3 Admin-Auth

**File:** `src/modules/admin-auth/`  
**Role:** Staff login with TOTP MFA for transport officers.  
**Health:** ⚠️ P1 (CSRF stale on MFA, invite endpoint unrate-limited)

**What it does:**
- Completely separate from Firebase — custom email + bcrypt password
- TOTP MFA required for `TRANSPORT_OFFICER` and `PRINCIPAL` roles
- 8h JWT + Redis session cache (session stored at `admin:session:<sessionId>`)
- CSRF double-submit cookie pattern
- Invitation-based: no self-signup

**Login flow:**
1. `POST /admin/auth/login` with `{ email, password }` → validate credentials
2. If role requires MFA: return `{ requiresMfa: true, challengeToken }` — do NOT issue JWT yet
3. Client submits TOTP code with `challengeToken` → `POST /admin/auth/mfa`
4. MFA verified → issue JWT + set CSRF cookie

**P1 Fix — CSRF token must refresh after MFA:**
```typescript
// After MFA verification, issue a fresh CSRF token
// Bug: current code reuses the pre-MFA CSRF token
async function completeMfa(challengeToken: string, totpCode: string): Promise<AuthResult> {
  const challenge = await redis.get(`mfa:challenge:${challengeToken}`);
  if (!challenge) throw new AppError(401, 'CHALLENGE_EXPIRED', 'MFA challenge expired');

  const { adminId } = JSON.parse(challenge);
  const admin = await adminRepository.findById(adminId);

  if (!verifyTotp(totpCode, admin.totpSecret)) {
    throw new AppError(401, 'INVALID_TOTP', 'Invalid TOTP code');
  }

  await redis.del(`mfa:challenge:${challengeToken}`);

  const sessionId = crypto.randomUUID();
  const jwt = signJwt({ sub: adminId, role: admin.role, sessionId });
  const csrfToken = crypto.randomBytes(32).toString('hex'); // ← fresh token

  await redis.setex(`admin:session:${sessionId}`, 8 * 3600, JSON.stringify({ adminId, role: admin.role }));

  return { jwt, csrfToken, sessionId };
}
```

**P1 Fix — Rate limit invite endpoint:**
```typescript
const inviteLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20 });
router.post('/admin/invite', inviteLimiter, requireRole('PRINCIPAL'), adminAuthController.invite);
```

---

### 4.4 QR

**File:** `src/modules/qr/`  
**Role:** Generates cryptographically signed nonces for the check-in kiosk.  
**Health:** ✅ Clean

**What it does:**
- Kiosk connects via WebSocket and receives a new QR JWT every 25 seconds
- Each QR contains a `nonce` (UUID) stored atomically in Redis with 40s TTL
- JWT itself has a 35s expiry (5s grace window)
- The nonce is consumed by `Attendance` via `GETDEL` — atomic burn on first use

**Why this is secure:**
- `GETDEL` is atomic: two concurrent check-ins with the same QR code cannot both succeed
- 35s JWT expiry prevents old QR codes from being used
- WebSocket-only delivery: the QR endpoint has no HTTP surface to spray requests against
- Nonce is one-time-use only

**QR generation:**
```typescript
async function generateQr(busId: string): Promise<string> {
  const nonce = crypto.randomUUID();
  const token = jwt.sign({ nonce, busId }, QR_SECRET, { expiresIn: '35s' });

  // Store nonce in Redis with 40s TTL (5s grace)
  await redis.set(`qr:nonce:${nonce}`, busId, 'EX', 40);

  return token; // sent to kiosk over WebSocket
}
```

**Called by:** Attendance (GETDEL on nonce during check-in)

---

## 5. Module Reference — Tier 1: Core Operations

These four modules handle the live trip. They are the most critical and the most complex.

---

### 5.1 Trips

**File:** `src/modules/trips/`  
**Role:** Orchestrates the full lifecycle of a bus trip.  
**Health:** ⚠️ P0 (reference pattern is clean, but other modules call into it without going through the service layer)

**State machine:**
```
SCHEDULED ──► ACTIVE ──► COMPLETED
                │
                └──► (GPS_OUTAGE detected)
                      ├── DELEGATE activated
                      └── Two-phase recovery on driver return
```

**On trip start (`startTrip`):**
1. Validate trip is SCHEDULED and driver is assigned
2. Set trip status to ACTIVE in PostgreSQL
3. Prime Redis caches:
   - `trip:active:<routeId>` → tripId (used by Student BFF)
   - `trip:students:<tripId>` → Set of studentIds on this route
   - `trip:gpsStatus:<tripId>` → "ONLINE"
4. Broadcast `trip:started` WebSocket event to all students on the route
5. Dual-write trip start to Firebase RTDB for mobile live map

**On trip end (`endTrip`):**
1. Set trip status to COMPLETED
2. Clear all Redis keys for this trip
3. Enqueue Cloud Tasks job: mark all students without check-in as ABSENT
4. Broadcast `trip:ended` WebSocket event
5. Clear Firebase RTDB entry

**GPS outage two-phase recovery:**
```typescript
async function handleDriverReturn(tripId: string): Promise<void> {
  const trip = await tripRepository.findById(tripId);
  if (trip.delegateActive) {
    await delegateService.endDelegation(tripId);
    await redis.set(`trip:gpsStatus:${tripId}`, 'ONLINE');
    await websocketService.broadcast(`trip:${tripId}`, 'gps:restored', {});
  }
}
```

**Who calls Trips:**
- `Fleet` — to validate a driver before deactivation
- `Jobs` — for daily trip creation and absent-marking
- `Incidents` — to update trip on substitute driver assignment
- `Attendance` — to validate trip is ACTIVE before check-in

**Trips calls:**
- `GPS` — to get last known GPS position
- `Attendance` — to trigger end-of-trip absent scan
- `Delegate` — to activate/end delegation
- `Notifications` — to alert students of trip start/end
- Redis — state caches
- Firebase — RTDB live map
- WebSocket — real-time broadcasts

---

### 5.2 Attendance

**File:** `src/modules/attendance/`  
**Role:** 13-step hardened QR check-in.  
**Health:** ⚠️ P1 (Firebase GPS latency is main bottleneck)

**The 13 steps of check-in (must all pass atomically):**

```typescript
async function checkIn(studentId: string, qrToken: string, gpsCoords: Coords): Promise<void> {
  // Step 1: Verify student JWT is valid
  // Step 2: Decode QR JWT — validate signature and expiry
  const { nonce, busId } = verifyQrToken(qrToken);

  // Step 3: GETDEL nonce from Redis — atomic burn (prevents replay)
  const storedBusId = await redis.getdel(`qr:nonce:${nonce}`);
  if (!storedBusId) throw new AppError(410, 'QR_EXPIRED', 'QR code already used or expired');
  if (storedBusId !== busId) throw new AppError(400, 'QR_MISMATCH', 'QR bus mismatch');

  // Step 4: Rate limit — 3 attempts per student per 60s
  const attempts = await redis.incr(`checkin:rate:${studentId}`);
  if (attempts === 1) await redis.expire(`checkin:rate:${studentId}`, 60);
  if (attempts > 3) throw new AppError(429, 'RATE_LIMITED', 'Too many check-in attempts');

  // Step 5: Find active trip for this bus
  const tripId = await redis.get(`trip:active:${busId}`);
  if (!tripId) throw new AppError(404, 'NO_ACTIVE_TRIP', 'No active trip for this bus');

  // Step 6: Verify student is assigned to this route
  const assignment = await attendanceRepository.findRouteAssignment(studentId, busId);
  if (!assignment) throw new AppError(403, 'NOT_ASSIGNED', 'Student not assigned to this bus');

  // Step 7: Check for duplicate check-in today
  const existing = await attendanceRepository.findTodayLog(studentId, tripId);
  if (existing?.status === 'PRESENT') throw new AppError(409, 'ALREADY_CHECKED_IN', 'Already checked in');

  // Step 8: Get GPS position of bus (Firebase RTDB — fast path)
  const busGps = await gpsService.getLastKnownPosition(busId);

  // Step 9: Geofence check — 3-tier
  const distance = haversine(gpsCoords, busGps);
  let status: AttendanceStatus;
  if (distance <= 50) status = 'PRESENT';
  else if (distance <= 200) status = 'LATE_BOARD';
  else {
    // Step 10: Check if GPS is offline — if so, open self-report window
    const gpsStatus = await redis.get(`trip:gpsStatus:${tripId}`);
    if (gpsStatus === 'OFFLINE') {
      status = 'SELF_REPORTED';
    } else {
      throw new AppError(400, 'OUTSIDE_GEOFENCE', 'Too far from bus');
    }
  }

  // Step 11: Write attendance log (upsert — idempotent)
  await attendanceRepository.upsertLog({ studentId, tripId, status, checkedInAt: new Date() });

  // Step 12: Emit AttendanceEvent (event sourcing — immutable record)
  await attendanceRepository.createEvent({ studentId, tripId, eventType: 'CHECK_IN', status });

  // Step 13: Invalidate Student BFF cache
  await redis.del(`student:home:${studentId}`);

  // Async: send push notification (fire-and-forget, non-critical)
  notificationService.sendCheckInConfirmation(studentId, status).catch(console.error);
}
```

**GPS fallback — self-report window:**
If GPS has been OFFLINE for more than 5 minutes, the system opens a self-report window. Students can check in without geofence validation, but it's recorded as `SELF_REPORTED` (not `PRESENT`) so coordinators can audit it.

**Event sourcing:**
Every attendance state change (CHECK_IN, SELF_REPORT, MARKED_ABSENT, MANUAL_OVERRIDE) creates an immutable `AttendanceEvent` row. This gives a full audit trail and allows reprocessing.

---

### 5.3 GPS

**File:** `src/modules/gps/`  
**Role:** Processes real-time pings from 180+ buses.  
**Health:** ⚠️ P2 (buffer lost on pod crash — known acceptable risk)

**Architecture — why buffering:**
180 buses × 10 pings/min = 1,800 pings/min = 30 pings/sec. A direct PostgreSQL write per ping would saturate the connection pool. Instead, pings are buffered in memory and batch-flushed.

**Buffering strategy:**
```typescript
const pingBuffer = new Map<string, GpsPing[]>(); // busId → pings[]
const FLUSH_INTERVAL_MS = 5000;
const FLUSH_THRESHOLD = 100; // flush if buffer hits 100 pings

async function receivePing(busId: string, ping: GpsPing): Promise<void> {
  // Step 1: Lua atomic rate limit (prevents race on concurrent pings from same bus)
  const allowed = await redis.eval(GPS_RATE_LIMIT_LUA, 1, `gps:rate:${busId}`, '10', '60');
  if (!allowed) return; // silently drop excess pings

  // Step 2: Buffer the ping
  if (!pingBuffer.has(busId)) pingBuffer.set(busId, []);
  pingBuffer.get(busId)!.push(ping);

  // Step 3: Dual-write to Firebase RTDB for live mobile map (async, non-blocking)
  firebase.database().ref(`buses/${busId}/location`).set({
    lat: ping.lat, lng: ping.lng, timestamp: ping.timestamp,
  }).catch(console.error);

  // Step 4: Update Redis GPS status
  await redis.set(`bus:lastPing:${busId}`, JSON.stringify(ping), 'EX', 120);

  // Step 5: Flush if threshold hit
  if (pingBuffer.get(busId)!.length >= FLUSH_THRESHOLD) {
    await flushBuffer(busId);
  }

  // Step 6: Driver return detection — ends delegation
  await checkDriverReturn(busId);
}

// Scheduled flush — every 5 seconds
setInterval(async () => {
  for (const [busId, pings] of pingBuffer.entries()) {
    if (pings.length > 0) await flushBuffer(busId);
  }
}, FLUSH_INTERVAL_MS);

async function flushBuffer(busId: string): Promise<void> {
  const pings = pingBuffer.get(busId) ?? [];
  if (pings.length === 0) return;
  pingBuffer.set(busId, []); // clear before async write to avoid double-flush

  await prisma.gpsPing.createMany({ data: pings });
}
```

**GPS outage detection:**
```typescript
// Jobs module calls this every 2 minutes
async function checkGpsHeartbeat(): Promise<void> {
  const activeTripIds = await tripRepository.findActiveTripIds();

  for (const tripId of activeTripIds) {
    const busId = await redis.hget(`trip:${tripId}`, 'busId');
    const lastPing = await redis.get(`bus:lastPing:${busId}`);

    if (!lastPing) {
      const currentStatus = await redis.get(`trip:gpsStatus:${tripId}`);
      if (currentStatus !== 'OFFLINE') {
        await redis.set(`trip:gpsStatus:${tripId}`, 'OFFLINE');
        await websocketService.broadcast(`admin`, 'gps:outage', { tripId, busId });
        await adminService.addAlert({ type: 'GPS_OUTAGE', tripId, busId });
      }
    }
  }
}
```

**Driver return detection:**
```typescript
async function checkDriverReturn(busId: string): Promise<void> {
  const delegation = await redis.get(`delegate:active:${busId}`);
  if (!delegation) return;

  const pingCount = await redis.incr(`driver:returnPings:${busId}`);
  await redis.expire(`driver:returnPings:${busId}`, 60); // reset if no pings for 60s

  if (pingCount >= 2) {
    const { tripId } = JSON.parse(delegation);
    await delegateService.endDelegation(tripId);
    await redis.del(`driver:returnPings:${busId}`);
  }
}
```

---

### 5.4 Delegate

**File:** `src/modules/delegate/`  
**Role:** Activates emergency GPS coverage when the driver is incapacitated.  
**Health:** ⚠️ P1 (no heartbeat monitor for the delegate themselves)

**Scenario:** GPS goes OFFLINE and the driver is unresponsive. A coordinator who is within 200m of the bus can activate delegation. Their phone then acts as the GPS source.

**Activation — SET NX atomic lock prevents race:**
```typescript
async function activateDelegation(tripId: string, coordinatorId: string, coords: Coords): Promise<void> {
  const busId = await redis.hget(`trip:${tripId}`, 'busId');

  // Proximity check — Haversine
  const lastPing = JSON.parse(await redis.get(`bus:lastPing:${busId}`) ?? 'null');
  if (!lastPing) throw new AppError(400, 'NO_LAST_POSITION', 'Cannot determine bus position');

  const distance = haversine(coords, { lat: lastPing.lat, lng: lastPing.lng });
  if (distance > 200) throw new AppError(400, 'TOO_FAR', `Must be within 200m of bus (you are ${Math.round(distance)}m away)`);

  // SET NX — atomic: only one coordinator can activate delegation
  const lockAcquired = await redis.set(
    `delegate:lock:${tripId}`,
    coordinatorId,
    'NX', 'EX', 43200 // 12h TTL
  );
  if (!lockAcquired) throw new AppError(409, 'ALREADY_DELEGATED', 'Delegation already active');

  // Store delegation state (3 keys — all must be cleaned up on end)
  await redis.set(`delegate:active:${busId}`, JSON.stringify({ tripId, coordinatorId, startedAt: Date.now() }), 'EX', 43200);
  await redis.set(`delegate:coordinator:${coordinatorId}`, tripId, 'EX', 43200);

  // Update Firebase so mobile app shows delegate GPS
  await firebase.database().ref(`buses/${busId}/delegateActive`).set(true);

  // Broadcast to admin dashboard
  await websocketService.broadcast('admin', 'delegate:activated', { tripId, busId, coordinatorId });
}
```

**End delegation — clean up all 3 Redis keys atomically:**
```typescript
async function endDelegation(tripId: string): Promise<void> {
  const busId = await redis.hget(`trip:${tripId}`, 'busId');
  const delegationRaw = await redis.get(`delegate:active:${busId}`);
  if (!delegationRaw) return; // already ended

  const { coordinatorId } = JSON.parse(delegationRaw);

  // Atomic cleanup — use a pipeline
  const pipeline = redis.pipeline();
  pipeline.del(`delegate:lock:${tripId}`);
  pipeline.del(`delegate:active:${busId}`);
  pipeline.del(`delegate:coordinator:${coordinatorId}`);
  await pipeline.exec();

  // Update Firebase
  await firebase.database().ref(`buses/${busId}/delegateActive`).set(false);

  // Broadcast
  await websocketService.broadcast('admin', 'delegate:ended', { tripId, busId });
}
```

**P1 Fix — Add delegate heartbeat monitor:**
```typescript
// If the delegate's phone stops sending pings for > 5 minutes, escalate
async function checkDelegateHeartbeat(): Promise<void> {
  const activeDelegations = await redis.keys('delegate:active:*');

  for (const key of activeDelegations) {
    const { coordinatorId, tripId, startedAt } = JSON.parse(await redis.get(key) ?? '{}');
    const lastPing = await redis.get(`delegate:lastPing:${coordinatorId}`);

    if (!lastPing || Date.now() - parseInt(lastPing) > 5 * 60 * 1000) {
      await incidentService.createIncident({
        tripId,
        type: 'DELEGATE_LOST',
        detail: 'Delegate coordinator stopped sending GPS pings',
      });
    }
  }
}
```

---

## 6. Module Reference — Tier 2: Live Coordination

These modules are what humans interact with in real time.

---

### 6.1 Admin

**File:** `src/modules/admin/`  
**Role:** Backend for the coordinator command center dashboard.  
**Health:** ⚠️ P1 (O(M log M) alert filtering, unbatched message context)

**Alert feed — Redis sorted set:**
```typescript
// Alerts stored as sorted set, score = timestamp (for chronological order)
// Max 50 items — oldest is trimmed
async function addAlert(alert: Alert): Promise<void> {
  const key = 'admin:alerts';
  const score = Date.now();
  await redis.zadd(key, score, JSON.stringify(alert));
  await redis.zremrangebyrank(key, 0, -51); // keep only top 50
  await websocketService.broadcast('admin', 'alert:new', alert);
}

async function getAlerts(coordinatorId: string): Promise<Alert[]> {
  const all = await redis.zrevrange('admin:alerts', 0, 49);
  const alerts = all.map(a => JSON.parse(a));

  // P1 Bug: this filter runs in Node.js — O(M) where M = 50 (acceptable)
  // But if a coordinator only manages certain routes, filter must be O(1)
  // Fix: store alerts per-route: 'admin:alerts:<routeId>'
  const coordinator = await adminRepository.findCoordinator(coordinatorId);
  return alerts.filter(a => coordinator.routeIds.includes(a.routeId));
}
```

**P1 Fix — Scope alerts per route at write time:**
```typescript
async function addAlert(alert: Alert): Promise<void> {
  // Write to both the global feed and the route-specific feed
  const globalKey = 'admin:alerts';
  const routeKey = `admin:alerts:route:${alert.routeId}`;
  const score = Date.now();

  const pipeline = redis.pipeline();
  pipeline.zadd(globalKey, score, JSON.stringify(alert));
  pipeline.zremrangebyrank(globalKey, 0, -51);
  pipeline.zadd(routeKey, score, JSON.stringify(alert));
  pipeline.zremrangebyrank(routeKey, 0, -51);
  pipeline.expire(routeKey, 86400); // 24h TTL per route
  await pipeline.exec();

  await websocketService.broadcast('admin', 'alert:new', alert);
}

// Now coordinator query is O(1) per route they manage
async function getAlerts(coordinatorId: string): Promise<Alert[]> {
  const coordinator = await adminRepository.findCoordinator(coordinatorId);
  const keys = coordinator.routeIds.map(id => `admin:alerts:route:${id}`);

  // Union all their route feeds
  const allAlerts = await Promise.all(keys.map(k => redis.zrevrange(k, 0, 24)));
  return allAlerts.flat().map(a => JSON.parse(a))
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 50);
}
```

**Message routing:**
```typescript
type MessageTarget =
  | { type: 'DIRECT'; recipientId: string }
  | { type: 'BROADCAST_ALL' }
  | { type: 'BROADCAST_ROUTE'; routeId: string }
  | { type: 'BROADCAST_BUS'; busId: string };
```

**Dashboard stats — 30s cache:**
```typescript
async function getDashboardStats(coordinatorId: string): Promise<DashboardStats> {
  const cacheKey = `admin:stats:${coordinatorId}`;
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const stats = await adminRepository.computeStats(coordinatorId);
  await redis.setex(cacheKey, 30, JSON.stringify(stats));
  return stats;
}
```

---

### 6.2 Incidents

**File:** `src/modules/incidents/`  
**Role:** SOS and breakdown reporting with multi-tier escalation.  
**Health:** 🔴 P0 (list and get stubs unimplemented, escalation missing)

**State machine:**
```
REPORTED ──► ASSIGNED ──► RESOLVED
    │
    └──► (auto-escalate at +10 min if still REPORTED)
         COORDINATOR → TRANSPORT_OFFICER → PRINCIPAL
```

**P0 Fix — Implement listIncidents and getIncident:**
```typescript
// incidents.repository.ts
async function listIncidents(filters: {
  tripId?: string;
  status?: IncidentStatus;
  escalationLevel?: EscalationLevel;
  routeId?: string;
  from?: Date;
  to?: Date;
  cursor?: string;
  limit?: number;
}): Promise<{ incidents: Incident[]; nextCursor: string | null }> {
  const limit = filters.limit ?? 20;

  const incidents = await prisma.incident.findMany({
    where: {
      ...(filters.tripId && { tripId: filters.tripId }),
      ...(filters.status && { status: filters.status }),
      ...(filters.escalationLevel && { escalationLevel: filters.escalationLevel }),
      ...(filters.routeId && { trip: { routeId: filters.routeId } }),
      ...(filters.from || filters.to ? {
        createdAt: {
          ...(filters.from && { gte: filters.from }),
          ...(filters.to && { lte: filters.to }),
        }
      } : {}),
      ...(filters.cursor && { id: { lt: filters.cursor } }),
    },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    include: { trip: { include: { route: true, driver: true } } },
  });

  const hasMore = incidents.length > limit;
  return {
    incidents: incidents.slice(0, limit),
    nextCursor: hasMore ? incidents[limit - 1].id : null,
  };
}
```

**P0 Fix — Implement escalation via Cloud Tasks:**
```typescript
// When incident is created, enqueue a Cloud Tasks job to check escalation at +10 min
async function createIncident(data: CreateIncidentInput): Promise<Incident> {
  const incident = await incidentRepository.create(data);

  // Notify all coordinators for this route immediately
  await notificationService.broadcast({
    recipientIds: await coordinatorIds(data.routeId),
    channels: ['PUSH', 'IN_APP', 'SMS'],
    title: 'SOS: Bus incident reported',
    body: `Trip ${data.tripId} — ${data.type}`,
    data: { incidentId: incident.id },
  });

  // Broadcast to admin command center
  await websocketService.broadcast('admin', 'incident:created', incident);

  // Enqueue Cloud Tasks escalation check at +10 min
  await cloudTasks.enqueue({
    url: `/jobs/incidents/escalate`,
    payload: { incidentId: incident.id, expectedStatus: 'REPORTED' },
    scheduleTime: Date.now() + 10 * 60 * 1000,
  });

  return incident;
}

// jobs/incidents/escalate handler
async function handleEscalation(payload: { incidentId: string; expectedStatus: string }): Promise<void> {
  const incident = await incidentRepository.findById(payload.incidentId);

  // If it's already been resolved/assigned, do nothing
  if (incident.status !== payload.expectedStatus) return;

  const nextLevel = getNextEscalationLevel(incident.escalationLevel);
  if (!nextLevel) return; // already at max

  await incidentRepository.update(incident.id, { escalationLevel: nextLevel });

  const recipients = await getEscalationRecipients(nextLevel, incident.trip.routeId);
  await notificationService.broadcast({
    recipientIds: recipients,
    channels: ['PUSH', 'IN_APP', 'SMS'],
    title: `ESCALATED: Unresolved incident`,
    body: `Incident ${incident.id} escalated to ${nextLevel}`,
    data: { incidentId: incident.id },
  });

  // Enqueue next escalation if still unresolved in another 10 min
  await cloudTasks.enqueue({
    url: `/jobs/incidents/escalate`,
    payload: { incidentId: incident.id, expectedStatus: 'REPORTED' },
    scheduleTime: Date.now() + 10 * 60 * 1000,
  });
}

function getNextEscalationLevel(current: EscalationLevel): EscalationLevel | null {
  const chain: EscalationLevel[] = ['COORDINATOR', 'TRANSPORT_OFFICER', 'PRINCIPAL'];
  const idx = chain.indexOf(current);
  return idx < chain.length - 1 ? chain[idx + 1] : null;
}
```

---

### 6.3 Notifications

**File:** `src/modules/notifications/`  
**Role:** Multi-channel broadcast via BullMQ queue.  
**Health:** 🔴 P0 (mock FCM tokens — ALL push notifications silently fail)

**Architecture:**
- BullMQ queue backed by Redis
- 5 concurrent workers
- 3 channels: PUSH (FCM), IN_APP (PostgreSQL), SMS (MSG91)
- Large broadcasts split into 5,000-recipient chunks
- 3 retries with exponential backoff

**P0 Fix — Replace mock FCM tokens with real lookup:**

The bug is in the dispatch function. Instead of looking up real FCM tokens from the `userDevice` table, it constructs fake ones:

```typescript
// BROKEN (current code):
const fcmTokens = recipientIds.map(id => `fcm_token_for_${id}`);

// FIXED:
async function getFcmTokens(userIds: string[]): Promise<Map<string, string[]>> {
  const devices = await prisma.userDevice.findMany({
    where: {
      userId: { in: userIds },
      fcmToken: { not: null },
      isActive: true,
    },
    select: { userId: true, fcmToken: true },
  });

  const tokenMap = new Map<string, string[]>();
  for (const d of devices) {
    if (!d.fcmToken) continue;
    if (!tokenMap.has(d.userId)) tokenMap.set(d.userId, []);
    tokenMap.get(d.userId)!.push(d.fcmToken!);
  }
  return tokenMap;
}
```

**Full fixed dispatch function:**
```typescript
async function sendPush(notification: PushNotification): Promise<void> {
  const tokenMap = await getFcmTokens(notification.recipientIds);
  const allTokens = Array.from(tokenMap.values()).flat();

  if (allTokens.length === 0) {
    console.warn('No FCM tokens found for recipients:', notification.recipientIds);
    return;
  }

  // Chunk into 500 (FCM limit per batch request)
  const chunks = chunk(allTokens, 500);

  for (const tokenChunk of chunks) {
    const response = await admin.messaging().sendEachForMulticast({
      tokens: tokenChunk,
      notification: { title: notification.title, body: notification.body },
      data: notification.data ?? {},
    });

    // Handle token invalidation — remove stale tokens
    response.responses.forEach((resp, idx) => {
      if (!resp.success && resp.error?.code === 'messaging/registration-token-not-registered') {
        const staleToken = tokenChunk[idx];
        prisma.userDevice.updateMany({
          where: { fcmToken: staleToken },
          data: { fcmToken: null, isActive: false },
        }).catch(console.error);
      }
    });
  }
}
```

**P1 Fix — SMS idempotency:**
```typescript
async function sendSms(notification: SmsNotification, jobId: string): Promise<void> {
  for (const recipientId of notification.recipientIds) {
    const user = await prisma.user.findUnique({ where: { id: recipientId }, select: { phone: true } });
    if (!user?.phone) continue;

    await msg91Client.send({
      to: user.phone,
      message: notification.body,
      // Idempotency key prevents duplicate SMS on BullMQ retry
      idempotencyKey: `${jobId}:${recipientId}`,
    });
  }
}
```

**BullMQ worker setup:**
```typescript
const notificationWorker = new Worker('notifications', async (job) => {
  const { type, notification, jobId } = job.data;

  switch (type) {
    case 'PUSH': await sendPush(notification); break;
    case 'SMS': await sendSms(notification, jobId); break;
    case 'IN_APP': await sendInApp(notification); break;
  }
}, {
  connection: redis,
  concurrency: 5,
});

notificationWorker.on('failed', (job, err) => {
  console.error(`Notification job ${job?.id} failed:`, err);
  // BullMQ will retry automatically (3 attempts with exponential backoff)
});
```

---

### 6.4 Student

**File:** `src/modules/student/`  
**Role:** BFF (Backend for Frontend) for the student mobile home screen.  
**Health:** 🔴 P0 (7+ Prisma queries per request, no cache — connection pool saturation at peak)

**P0 Fix — Add Redis cache with proper invalidation:**

```typescript
const STUDENT_HOME_TTL = 300; // 5 minutes

async function getHomeData(studentId: string): Promise<StudentHomeData> {
  const cacheKey = `student:home:${studentId}`;

  // Cache read
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  // Cache miss — run the 7 parallel queries
  const [
    student,
    routeAssignment,
    activeTrip,
    todayAttendance,
    attendanceHistory,
    announcements,
    featureFlags,
  ] = await Promise.all([
    prisma.user.findUnique({ where: { id: studentId } }),
    prisma.routeAssignment.findFirst({ where: { studentId, isActive: true }, include: { route: true, stop: true } }),
    getActiveTripForStudent(studentId),
    prisma.attendanceLog.findFirst({ where: { studentId, date: today() } }),
    prisma.attendanceLog.findMany({ where: { studentId }, orderBy: { date: 'desc' }, take: 5 }),
    prisma.announcement.findMany({ where: { active: true }, orderBy: { createdAt: 'desc' }, take: 3 }),
    prisma.featureFlag.findMany({ where: { OR: [{ userId: studentId }, { userId: null }] } }),
  ]);

  const data: StudentHomeData = {
    student,
    routeAssignment,
    activeTrip,
    todayAttendance,
    attendanceHistory,
    announcements,
    featureFlags,
  };

  // Write cache
  await redis.setex(cacheKey, STUDENT_HOME_TTL, JSON.stringify(data));
  return data;
}

// Invalidation — called by Attendance and Trips modules
export async function invalidateStudentCache(studentId: string): Promise<void> {
  await redis.del(`student:home:${studentId}`);
}
```

**Substitute driver — P1 fix (consolidate source):**
```typescript
// The canonical source for substitute driver is trip.substituteDriverId
// delegateId is for GPS coverage, not driver substitution — these are different concepts

function getSubstituteDriver(trip: TripWithRelations): Driver | null {
  // Single canonical source — trip.substituteDriver (assigned by coordinator)
  return trip.substituteDriver ?? null;
  // Do NOT use trip.delegateId — that is a GPS coordinator, not a substitute driver
}
```

---

### 6.5 Driver

**File:** `src/modules/driver/`  
**Role:** BFF for the driver mobile app.  
**Health:** ⚠️ P1 (Prisma called directly from route handlers)

**P1 Fix — Extract driverRepository.ts:**

```typescript
// BEFORE (broken — route handler touching Prisma directly):
router.get('/driver/home', async (req, res) => {
  const route = await prisma.route.findUnique({ where: { id: req.user.routeId } }); // ❌
  const stops = await prisma.stop.findMany({ where: { routeId: route.id } }); // ❌
  res.json({ route, stops });
});

// AFTER — 4-layer:

// driver.repository.ts
export class DriverRepository {
  async getTodayTrip(driverId: string): Promise<TripWithRoute | null> {
    return prisma.trip.findFirst({
      where: { driverId, date: today(), status: { in: ['SCHEDULED', 'ACTIVE'] } },
      include: { route: { include: { stops: { include: { students: true } } } } },
    });
  }

  async getPostTripSummary(tripId: string): Promise<TripSummary> {
    return prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        attendanceLogs: { include: { student: true } },
        route: true,
      },
    });
  }
}

// driver.service.ts
export class DriverService {
  constructor(private repo: DriverRepository) {}

  async getHomeData(driverId: string): Promise<DriverHomeData> {
    const trip = await this.repo.getTodayTrip(driverId);
    if (!trip) return { status: 'NO_TRIP_TODAY' };

    return {
      status: trip.status,
      trip,
      stopSummary: trip.route.stops.map(stop => ({
        stop,
        expectedStudents: stop.students.length,
        checkedIn: trip.attendanceLogs?.filter(l => l.stopId === stop.id && l.status === 'PRESENT').length ?? 0,
      })),
    };
  }
}

// driver.routes.ts
router.get('/driver/home', authenticate, async (req, res, next) => {
  try {
    const data = await driverService.getHomeData(req.user.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
});
```

---

## 7. Module Reference — Tier 3: Admin Support

---

### 7.1 Users

**File:** `src/modules/users/`  
**Role:** Student and staff profile management.  
**Health:** ✅ Clean (minor: soft-delete cascade missing)

**Bulk import — all-or-nothing:**
```typescript
async function bulkCreate(users: CreateUserInput[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const user of users) {
      await tx.user.upsert({
        where: { phone: user.phone }, // idempotent on phone number
        update: { ...user },
        create: { ...user },
      });
    }
  });
}
```

**Minor fix — soft delete cascade:**
```typescript
async function softDelete(userId: string): Promise<void> {
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { isActive: false } }),
    prisma.routeAssignment.updateMany({ where: { studentId: userId }, data: { isActive: false } }),
    prisma.userDevice.updateMany({ where: { userId }, data: { isActive: false, fcmToken: null } }),
    // Revoke mobile JWT by incrementing session version
    prisma.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } }),
  ]);
}
```

---

### 7.2 Import

**File:** `src/modules/import/`  
**Role:** CSV bulk upload with conflict detection.  
**Health:** ⚠️ P2 (sequential per-row transactions, no streaming)

**Current architecture (correct logic, inefficient execution):**
1. Pre-fetch all routes, stops, live trips, and existing users into memory → O(1) conflict checks
2. Block rows where student is on an active trip
3. Execute: one `prisma.$transaction` per row → 10K rows = 10K roundtrips

**P2 Fix — Batch transactions and streaming CSV:**
```typescript
import { parse } from 'csv-parser';
import { Readable } from 'stream';

async function importCsv(fileBuffer: Buffer): Promise<ImportResult> {
  // Pre-fetch context (still correct — O(1) checks)
  const [routes, stops, liveTrips, existingUsers] = await Promise.all([
    prisma.route.findMany({ select: { id: true, name: true } }),
    prisma.stop.findMany({ select: { id: true, routeId: true } }),
    prisma.trip.findMany({ where: { status: 'ACTIVE' }, include: { routeAssignments: true } }),
    prisma.user.findMany({ select: { id: true, phone: true } }),
  ]);

  const routeMap = new Map(routes.map(r => [r.name, r.id]));
  const stopMap = new Map(stops.map(s => [s.id, s]));
  const activeStudentIds = new Set(liveTrips.flatMap(t => t.routeAssignments.map(a => a.studentId)));
  const existingPhones = new Map(existingUsers.map(u => [u.phone, u.id]));

  const rows: ParsedRow[] = [];
  const errors: ImportError[] = [];

  // Stream parse instead of loading entire file into memory
  await new Promise<void>((resolve, reject) => {
    Readable.from(fileBuffer)
      .pipe(parse({ headers: true }))
      .on('data', (row) => {
        const validationError = validateRow(row, routeMap, stopMap, activeStudentIds);
        if (validationError) {
          errors.push({ row: row._lineNumber, error: validationError });
        } else {
          rows.push(row);
        }
      })
      .on('end', resolve)
      .on('error', reject);
  });

  // Batch upsert: 50 rows per transaction instead of 1
  const BATCH_SIZE = 50;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await prisma.$transaction(async (tx) => {
      for (const row of batch) {
        await tx.user.upsert({
          where: { phone: row.phone },
          update: { name: row.name, routeId: routeMap.get(row.routeName) },
          create: { phone: row.phone, name: row.name, role: 'STUDENT' },
        });
      }
    });
  }

  return { imported: rows.length, errors };
}
```

---

### 7.3 Fleet

**File:** `src/modules/fleet/`  
**Role:** Bus and driver CRUD.  
**Health:** ⚠️ P1 (404s surface as 500s, no transactions on cascading mutations)

**P1 Fix — Catch Prisma P2025 in repository:**
```typescript
// fleet.repository.ts
async function findBusById(id: string): Promise<Bus> {
  try {
    return await prisma.bus.findUniqueOrThrow({ where: { id } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      throw new AppError(404, 'BUS_NOT_FOUND', `Bus ${id} not found`);
    }
    throw e;
  }
}
```

**P1 Fix — Wrap cascading driver deactivation in a transaction:**
```typescript
async function deactivateDriver(driverId: string, auditCtx: AuditContext): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // 1. Find active trip
    const activeTrip = await tx.trip.findFirst({
      where: { driverId, status: 'ACTIVE' }
    });

    // 2. End the trip if active
    if (activeTrip) {
      await tx.trip.update({
        where: { id: activeTrip.id },
        data: { status: 'COMPLETED', endedAt: new Date(), endReason: 'DRIVER_DEACTIVATED' },
      });
    }

    // 3. Revoke mobile auth (increment session version)
    await tx.user.update({
      where: { id: driverId },
      data: { sessionVersion: { increment: 1 }, isActive: false },
    });

    // 4. Deactivate all devices
    await tx.userDevice.updateMany({
      where: { userId: driverId },
      data: { isActive: false, fcmToken: null },
    });

    // 5. Audit log
    await tx.auditLog.create({
      data: { action: 'DRIVER_DEACTIVATED', targetId: driverId, ...auditCtx },
    });
  });
}
```

---

### 7.4 Reports

**File:** `src/modules/reports/`  
**Role:** Asynchronous attendance CSV export.  
**Health:** 🔴 P0 (fire-and-forget, Redis-only artifact, OOM risk on large datasets)

**P0 Fix — Migrate to Cloud Tasks + PostgreSQL job store:**

```typescript
// Step 1: When admin requests a report, create a DB record and enqueue a Cloud Task

async function requestReport(params: ReportParams, requestedBy: string): Promise<{ jobId: string }> {
  // Create durable job record in PostgreSQL
  const job = await prisma.reportJob.create({
    data: {
      status: 'PENDING',
      params: params as any,
      requestedBy,
      createdAt: new Date(),
    },
  });

  // Enqueue Cloud Tasks job — survives pod restart
  await cloudTasks.enqueue({
    url: `/jobs/reports/generate`,
    payload: { jobId: job.id },
    // No schedule time = execute immediately
  });

  return { jobId: job.id };
}

// Step 2: Cloud Tasks calls this endpoint
// jobs/reports/generate — MUST return 500 on error so Cloud Tasks retries
async function handleGenerateReport(req: Request, res: Response): Promise<void> {
  const { jobId } = req.body;

  try {
    await prisma.reportJob.update({ where: { id: jobId }, data: { status: 'PROCESSING' } });

    const job = await prisma.reportJob.findUnique({ where: { id: jobId } });
    const csvPath = await generateCsvStreaming(job!.params);

    // Upload to GCS instead of keeping in Redis
    const gcsUrl = await uploadToGcs(csvPath, `reports/${jobId}.csv`);

    await prisma.reportJob.update({
      where: { id: jobId },
      data: { status: 'COMPLETED', resultUrl: gcsUrl, completedAt: new Date() },
    });

    res.status(200).json({ success: true }); // ← 200 only on success
  } catch (e) {
    await prisma.reportJob.update({
      where: { id: jobId },
      data: { status: 'FAILED', error: String(e) },
    });
    res.status(500).json({ error: 'Report generation failed' }); // ← 500 so Cloud Tasks retries
  }
}

// Step 3: Streaming CSV generation (prevents OOM on large datasets)
async function generateCsvStreaming(params: ReportParams): Promise<string> {
  const tmpPath = `/tmp/report-${Date.now()}.csv`;
  const writeStream = fs.createWriteStream(tmpPath);

  writeStream.write('StudentName,Phone,Route,Date,Status,CheckedInAt\n');

  // Cursor-based pagination — never loads all rows into memory
  let cursor: string | undefined;
  const PAGE_SIZE = 1000;

  while (true) {
    const logs = await prisma.attendanceLog.findMany({
      where: {
        date: { gte: params.from, lte: params.to },
        ...(params.routeId && { trip: { routeId: params.routeId } }),
      },
      include: { student: true, trip: { include: { route: true } } },
      take: PAGE_SIZE,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      orderBy: { id: 'asc' },
    });

    for (const log of logs) {
      writeStream.write(
        `"${log.student.name}","${log.student.phone}","${log.trip.route.name}","${log.date}","${log.status}","${log.checkedInAt ?? ''}"\n`
      );
    }

    if (logs.length < PAGE_SIZE) break;
    cursor = logs[logs.length - 1].id;
  }

  await new Promise((resolve) => writeStream.end(resolve));
  return tmpPath;
}
```

---

### 7.5 Routes

**File:** `src/modules/routes/`  
**Role:** Route and stop CRUD.  
**Health:** ✅ Clean (reference implementation of 4-layer pattern)

**This is the gold standard.** Study this module's structure when fixing Driver, Student, and Fleet.

**Atomic stop replacement (correct pattern):**
```typescript
async function replaceStops(routeId: string, newStops: CreateStopInput[]): Promise<void> {
  await prisma.$transaction([
    prisma.stop.deleteMany({ where: { routeId } }),
    prisma.stop.createMany({ data: newStops.map(s => ({ ...s, routeId })) }),
  ]);
}
```

**Minor: Haversine for stop proximity (not bounding box):**
```typescript
// Current (approximation — wrong for large distances):
function isNearStop(point: Coords, stop: Coords): boolean {
  return Math.abs(point.lat - stop.lat) < 0.001 && Math.abs(point.lng - stop.lng) < 0.001;
}

// Fixed (Haversine — correct):
function haversineMeters(a: Coords, b: Coords): number {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

function isNearStop(point: Coords, stop: Coords, thresholdMeters = 100): boolean {
  return haversineMeters(point, stop) <= thresholdMeters;
}
```

---

## 8. Module Reference — Tier 4: Infrastructure

---

### 8.1 Jobs

**File:** `src/modules/jobs/`  
**Role:** GCP Cloud Tasks webhook endpoints for all background work.  
**Health:** 🔴 P0 (returns HTTP 200 on all errors — Cloud Tasks never retries)

**Why this is catastrophic:**
Cloud Tasks determines whether a job succeeded by the HTTP response code. If the handler returns 200 even when it throws an exception, Cloud Tasks marks the job as succeeded and never retries. All failed daily jobs (trip creation, absent marking, auth provisioning) silently disappear.

**P0 Fix — Correct error handling pattern for ALL job handlers:**

```typescript
// The global pattern — wrap every handler with this
function jobHandler(fn: (payload: unknown) => Promise<void>) {
  return async (req: Request, res: Response): Promise<void> => {
    // Step 1: Validate Cloud Tasks headers (prevents spoofing)
    const taskName = req.headers['x-cloudtasks-taskname'];
    if (!taskName) {
      res.status(403).json({ error: 'Not a Cloud Tasks request' });
      return;
    }

    // Step 2: Validate payload with Zod
    let payload: unknown;
    try {
      payload = parsePayload(fn, req.body); // Zod schema per handler
    } catch (e) {
      // Invalid payload — return 200 to prevent infinite retry of a fundamentally broken job
      console.error('Invalid Cloud Tasks payload (not retrying):', e);
      res.status(200).json({ skipped: true, reason: 'invalid_payload' });
      return;
    }

    // Step 3: Execute and return 500 on failure so Cloud Tasks retries
    try {
      await fn(payload);
      res.status(200).json({ success: true });
    } catch (e) {
      console.error('Job execution failed (will retry):', e);
      res.status(500).json({ error: String(e) }); // ← THIS IS THE FIX
    }
  };
}

// Usage:
router.post('/jobs/trips/create-daily', jobHandler(async (payload) => {
  const { date } = DailyTripSchema.parse(payload);
  await tripService.createDailyTrips(date);
}));

router.post('/jobs/attendance/mark-absent', jobHandler(async (payload) => {
  const { tripId } = AbsentMarkSchema.parse(payload);
  await attendanceService.markAbsents(tripId);
}));

router.post('/jobs/reports/generate', jobHandler(async (payload) => {
  const { jobId } = ReportJobSchema.parse(payload);
  await reportService.generate(jobId);
}));
```

**All 11 job endpoints:**

| Endpoint | Trigger | Action |
|----------|---------|--------|
| `POST /jobs/trips/create-daily` | 5 AM daily | Create SCHEDULED trips for all routes today |
| `POST /jobs/attendance/mark-absent` | Trip end | Mark students with no check-in as ABSENT |
| `POST /jobs/gps/heartbeat` | Every 2 min | Check GPS silence → set OFFLINE, alert |
| `POST /jobs/cleanup` | Midnight | Purge expired Redis keys, old GPS pings |
| `POST /jobs/trips/late-start` | 7:30 AM | Alert coordinators of trips not yet started |
| `POST /jobs/admin/reconcile` | Every 5 min | Reconcile dashboard state with DB |
| `POST /jobs/auth/provision` | After import | Provision Firebase accounts for new students |
| `POST /jobs/gps/outage-escalate` | On GPS outage | Escalate to transport officer if unresolved |
| `POST /jobs/incidents/escalate` | +10 min | Escalate unresolved incidents |
| `POST /jobs/reports/generate` | On demand | Generate attendance CSV report |
| `POST /jobs/notifications/retry` | On FCM fail | Retry failed push notification batches |

---

### 8.2 RAG (Empty — Design Phase)

**File:** `src/modules/rag/`  
**Role:** AI-powered features — not yet implemented.  
**Health:** ✅ (empty — not a production risk)

**Planned capabilities:**
- Natural language query over attendance reports (e.g., "Show me students who were late more than 3 times this month")
- Route optimization suggestions based on historical GPS and attendance patterns
- Anomaly detection on attendance (e.g., sudden drop on specific route suggests route issue)

**Implementation approach when ready:**
```typescript
// Use Anthropic API with tool use for structured data queries
// Store embeddings of report summaries in pgvector extension
// Context window: pass relevant DB schema + recent data in system prompt
```

---

## 9. Critical System Flows (End-to-End)

### Flow 1: Student Check-In (Morning Rush — Critical Path)

```
06:45 AM  Driver opens app
          │
          ▼
          Mobile-Auth.login() → Firebase verify → JWT issued
          │
          ▼
          Trips.startTrip(tripId, driverId)
          │  ├─ Set trip ACTIVE in PostgreSQL
          │  ├─ redis.set('trip:active:<busId>', tripId)
          │  ├─ redis.sadd('trip:students:<tripId>', ...studentIds)
          │  └─ websocket.broadcast('trip:started') → student phones wake
          │
          ▼
06:50 AM  Student opens app
          │
          ▼
          Student.getHome(studentId)
          │  └─ redis.get('student:home:<studentId>') → MISS
          │     └─ 7x parallel Prisma queries → cache for 5 min
          │
          ▼
          QR kiosk receives new QR every 25s via WebSocket
          │  └─ QR JWT contains nonce, stored in Redis 40s
          │
          ▼
          Student scans QR with phone
          │
          ▼
          Attendance.checkIn(studentId, qrToken, gpsCoords)
          │  ├─ Verify QR JWT signature
          │  ├─ redis.GETDEL('qr:nonce:<nonce>') → ATOMIC BURN
          │  ├─ Rate limit check (3/60s)
          │  ├─ redis.get('trip:active:<busId>') → tripId
          │  ├─ Verify route assignment
          │  ├─ Haversine geofence (PRESENT / LATE_BOARD / FAIL)
          │  ├─ prisma.attendanceLog.upsert()
          │  ├─ prisma.attendanceEvent.create() [event sourcing]
          │  └─ redis.del('student:home:<studentId>') [cache bust]
          │
          ▼
          Notifications.send(PUSH) → FCM → student phone "You're checked in"
```

### Flow 2: GPS Outage → Delegation → Driver Return

```
GPS pings stop arriving for busId X
          │
          ▼
Jobs.gpsHeartbeat() (runs every 2 min via Cloud Tasks)
          │  └─ redis.get('bus:lastPing:<busId>') → null
          │     └─ redis.set('trip:gpsStatus:<tripId>', 'OFFLINE')
          │        └─ websocket.broadcast('admin', 'gps:outage')
          │
          ▼
Admin dashboard shows GPS outage alert
          │
          ▼
Coordinator opens delegation UI, taps "Take Over GPS"
          │
          ▼
Delegate.activate(tripId, coordinatorId, coords)
          │  ├─ haversine(coords, lastKnownBusPos) ≤ 200m? → proceed
          │  ├─ redis.SET 'delegate:lock:<tripId>' NX → acquire lock
          │  ├─ redis.set('delegate:active:<busId>', {...})
          │  ├─ redis.set('delegate:coordinator:<coordinatorId>', tripId)
          │  └─ firebase.update('buses/<busId>/delegateActive', true)
          │
          ▼
Coordinator's phone sends GPS pings
          │  └─ GPS.receivePing() tagged as source: DELEGATE
          │
          ▼
[Meanwhile: Attendance opens self-report window if GPS offline > 5 min]
          │
          ▼
Driver returns — phone starts sending pings
          │
          ▼
GPS.checkDriverReturn(busId) (called on every ping)
          │  └─ redis.incr('driver:returnPings:<busId>') → reaches 2
          │     └─ Delegate.endDelegation(tripId)
          │        ├─ pipeline.del(3 Redis keys)
          │        ├─ firebase.update('buses/<busId>/delegateActive', false)
          │        └─ websocket.broadcast('admin', 'delegate:ended')
```

### Flow 3: SOS Incident

```
Driver taps SOS in app
          │
          ▼
Incidents.createIncident({ tripId, type: 'BREAKDOWN', coords })
          │  ├─ prisma.incident.create({ status: 'REPORTED', escalationLevel: 'COORDINATOR' })
          │  ├─ Notifications.broadcast(coordinatorIds, ['PUSH', 'IN_APP', 'SMS'])
          │  ├─ websocket.broadcast('admin', 'incident:created')
          │  └─ CloudTasks.enqueue('/jobs/incidents/escalate', { incidentId }, +10min)
          │
          ▼
[+10 min — Cloud Tasks fires]
          │
          ▼
Jobs.handleEscalation({ incidentId, expectedStatus: 'REPORTED' })
          │  ├─ incident.status === 'REPORTED'? → proceed
          │  ├─ escalate to TRANSPORT_OFFICER
          │  ├─ Notifications.broadcast(transportOfficerIds, ['PUSH', 'IN_APP', 'SMS'])
          │  └─ CloudTasks.enqueue('/jobs/incidents/escalate', { incidentId }, +10min)
          │
          ▼
Coordinator assigns substitute driver
          │
          ▼
Trips.assignSubstitute(tripId, substituteDriverId)
          │  ├─ prisma.trip.update({ substituteDriverId })
          │  └─ Notifications.send(substituteDriver, PUSH, trip details)
          │
          ▼
Incident resolved → status = RESOLVED → no further escalation
```

### Flow 4: Bulk Student Import

```
Admin uploads CSV (e.g., 5,000 students)
          │
          ▼
Import.importCsv(fileBuffer)
          │  ├─ Stream parse CSV (csv-parser — not buffered)
          │  ├─ Pre-fetch routes, stops, liveTrips, existingUsers
          │  ├─ Validate each row O(1) against in-memory maps
          │  ├─ Block rows where student is on active trip
          │  └─ Batch upsert 50 rows/transaction → 100 transactions for 5K rows
          │
          ▼
Jobs.authProvision({ userIds: newStudentIds })
          │  └─ For each new student: Firebase.createUser(phone)
          │
          ▼
Notifications.broadcast(newStudentIds, IN_APP, 'Welcome!')
```

---

## 10. P0 Fixes — Must Do Before Production

These 5 issues mean the system cannot safely go to production. Fix in this order.

### P0-1: JOBS — Return 500 on errors (0.5 days)

**Impact:** All async background work silently fails and never retries.  
**File:** `src/modules/jobs/jobs.routes.ts`  
**Fix:** Wrap all handlers with the `jobHandler()` wrapper shown in Section 8.1. Every catch block must call `res.status(500)`.

**Verification:** Deploy, trigger a job that throws, confirm Cloud Tasks retries.

---

### P0-2: STUDENT /home — Add Redis cache (1 day)

**Impact:** 7+ Prisma queries per request saturates connection pool during morning rush.  
**File:** `src/modules/student/student.service.ts`  
**Fix:** See Section 6.4. Cache key: `student:home:<studentId>`, TTL: 300s.  
**Invalidation:** Call `redis.del('student:home:<studentId>')` in:
- `Attendance.checkIn()` (after successful check-in)
- `Trips.startTrip()` (for all students on the route)
- `Trips.endTrip()` (for all students on the route)
- `Users.update()` (profile changes)

---

### P0-3: NOTIFICATIONS — Fix FCM tokens (3 days)

**Impact:** Every push notification silently fails.  
**File:** `src/modules/notifications/notifications.service.ts`  
**Fix:** See Section 6.3. Replace mock token construction with `prisma.userDevice.findMany()` join.  
**Also:** Add FCM token storage in Mobile-Auth on login (if not already done — verify `userDevice.fcmToken` is populated).

---

### P0-4: INCIDENTS — Implement stubs (1.5 days)

**Impact:** Admin dashboard cannot view incident history. Escalation never fires.  
**Files:** `src/modules/incidents/incidents.repository.ts`, `incidents.service.ts`  
**Fix:** See Section 6.2. Implement `listIncidents()`, `getIncident()`, and Cloud Tasks escalation chain.

---

### P0-5: REPORTS — Migrate to Cloud Tasks (2 days)

**Impact:** Reports die silently on pod restart. Status hangs at PROCESSING indefinitely.  
**Files:** `src/modules/reports/reports.service.ts`, `src/modules/jobs/jobs.routes.ts`  
**Fix:** See Section 7.4. Add `reportJob` Prisma model. Enqueue Cloud Tasks on report request. Generate CSV with cursor pagination. Upload artifact to GCS.

**Prisma schema addition:**
```prisma
model ReportJob {
  id          String    @id @default(cuid())
  status      String    // PENDING | PROCESSING | COMPLETED | FAILED
  params      Json
  requestedBy String
  resultUrl   String?
  error       String?
  createdAt   DateTime  @default(now())
  completedAt DateTime?

  @@index([requestedBy, createdAt])
}
```

---

## 11. P1 Fixes — Architectural Gaps

### P1-1: DRIVER — Extract repository layer (4h)

See Section 6.5. Create `driver.repository.ts` and `driver.service.ts`. Remove all Prisma imports from `driver.routes.ts`.

### P1-2: FLEET — Fix 404→500 and add transaction (2h + 5h)

See Section 7.3. Catch `P2025` in all repository methods. Wrap `deactivateDriver` in a transaction.

### P1-3: MOBILE_AUTH — Rate limit login (1h)

See Section 4.2. Add `express-rate-limit` middleware: 10 req/60s per IP.

### P1-4: ADMIN_AUTH — Fix CSRF + rate limit invite (10h total)

See Section 4.3. Issue fresh CSRF token after MFA completion. Add rate limiter to `/admin/invite`.

### P1-5: NOTIFICATIONS — SMS idempotency (0.5 days)

See Section 6.3. Add `idempotencyKey: jobId + ':' + recipientId` to all MSG91 calls.

### P1-6: DELEGATE — Add heartbeat monitor (8h)

See Section 5.4. Cloud Tasks job every 5 minutes to verify delegate is still sending pings.

### P1-7: ADMIN — Scope alerts per route (8h)

See Section 6.1. Write alerts to per-route Redis sorted sets at write time. Query by coordinator's routes.

### P1-8: STUDENT — Consolidate substitute driver source (3h)

See Section 6.4. Canonical source is `trip.substituteDriverId`. Remove all references to `trip.delegateId` when displaying substitute driver in student BFF.

---

## 12. P2 Fixes — Performance & Minor Issues

### P2-1: GPS — Redis-backed buffer (1 day, optional)

If pod crash GPS data loss is unacceptable, replace in-memory buffer with a Redis list:
```typescript
// Instead of: pingBuffer.get(busId)!.push(ping)
await redis.rpush(`gps:buffer:${busId}`, JSON.stringify(ping));
// Flush: LRANGE + DEL in a pipeline
```

This adds ~1ms per ping but survives pod restarts. Current in-memory approach loses ~15 pings per restart — likely acceptable.

### P2-2: IMPORT — Batch transactions + streaming (3h)

See Section 7.2. Already documented. 50 rows per transaction. Use `csv-parser` stream.

### P2-3: ROUTES — Add pagination (4h)

```typescript
async function listRoutes(cursor?: string, limit = 20): Promise<PaginatedRoutes> {
  const routes = await prisma.route.findMany({
    take: limit + 1,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    orderBy: { name: 'asc' },
    include: { _count: { select: { stops: true } } },
  });

  return {
    routes: routes.slice(0, limit),
    nextCursor: routes.length > limit ? routes[limit - 1].id : null,
  };
}
```

---

## 13. Cross-Cutting Concerns

### 13.1 Inconsistent Layering

**Problem:** Driver and Student call Prisma directly from route handlers. Fleet has partial layering.  
**Standard:** Follow the 4-layer pattern from Routes module (Section 3).  
**Audit checklist:** Search the codebase for `prisma.` in any `*.routes.ts` file — every hit is a violation.

```bash
# Find all violations
grep -rn "prisma\." src/modules/ --include="*.routes.ts"
```

### 13.2 Status Enum Fragmentation

**Problem:** `PRESENT_STATUSES` is defined in the Student module. Jobs module may use different string values. Silent mismatches across module boundaries.

**Fix — Centralize in packages/shared:**
```typescript
// packages/shared/enums.ts
export const AttendanceStatus = {
  PRESENT: 'PRESENT',
  LATE_BOARD: 'LATE_BOARD',
  ABSENT: 'ABSENT',
  SELF_REPORTED: 'SELF_REPORTED',
  EXCUSED: 'EXCUSED',
} as const;
export type AttendanceStatus = typeof AttendanceStatus[keyof typeof AttendanceStatus];

export const PRESENT_STATUSES: AttendanceStatus[] = ['PRESENT', 'LATE_BOARD', 'SELF_REPORTED'];

export const TripStatus = {
  SCHEDULED: 'SCHEDULED',
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
} as const;

export const IncidentStatus = {
  REPORTED: 'REPORTED',
  ASSIGNED: 'ASSIGNED',
  RESOLVED: 'RESOLVED',
} as const;

export const EscalationLevel = {
  COORDINATOR: 'COORDINATOR',
  TRANSPORT_OFFICER: 'TRANSPORT_OFFICER',
  PRINCIPAL: 'PRINCIPAL',
} as const;
```

### 13.3 Audit Logging Gaps

**Problem:** Fleet, Driver, Import lack audit trails. Only Routes passes AuditContext.

**Fix — Add AuditContext to all mutating operations:**
```typescript
// middleware: extract AuditContext from request
function extractAuditContext(req: Request): AuditContext {
  return {
    actorId: req.user.id,
    actorRole: req.user.role,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  };
}

// Route handler pattern:
router.patch('/fleet/drivers/:id/deactivate', authenticate, async (req, res, next) => {
  try {
    const auditCtx = extractAuditContext(req);
    await fleetService.deactivateDriver(req.params.id, auditCtx);
    res.json({ success: true });
  } catch (e) { next(e); }
});
```

### 13.4 Async Job Durability — Standardize on Cloud Tasks

Three async patterns currently in use:

| Pattern | Used by | Durability | Verdict |
|---------|---------|-----------|---------|
| Fire-and-forget | Reports (old) | None | Eliminated by P0 fix |
| BullMQ | Notifications | Redis-backed (survives restarts if Redis persists) | Keep for high-volume notification fanout |
| Cloud Tasks | Jobs module | GCP-managed, durable | Use for all server-initiated background work |

**Rule going forward:**
- Notification fanout → BullMQ (optimized for high concurrency)
- All other background jobs → Cloud Tasks (durable, retryable, schedulable)
- Never use fire-and-forget for anything that must complete

### 13.5 Module Duplication

**Problem:** `DRIVER` and `DRIVERS` module paths, `STUDENT` and `STUDENTS` paths exist in parallel.

**Fix:**
1. Pick one canonical name per module (singular: `student`, `driver`)
2. Redirect any old routes with 301
3. Remove duplicate route files
4. Update all import paths

---

## 14. Caching Strategy

### Cache key registry

| Key Pattern | TTL | Set by | Invalidated by |
|-------------|-----|--------|----------------|
| `student:home:<studentId>` | 300s | Student.getHome | Attendance.checkIn, Trips.start/end, Users.update |
| `trip:active:<busId>` | Trip duration | Trips.startTrip | Trips.endTrip |
| `trip:students:<tripId>` | Trip duration | Trips.startTrip | Trips.endTrip |
| `trip:gpsStatus:<tripId>` | Trip duration | Trips.startTrip, GPS.heartbeat | Trips.endTrip |
| `bus:lastPing:<busId>` | 120s | GPS.receivePing | (auto-expire) |
| `qr:nonce:<nonce>` | 40s | QR.generate | Attendance.checkIn (GETDEL) |
| `admin:alerts` | Persistent | Admin.addAlert | Admin.clearAlerts |
| `admin:alerts:route:<routeId>` | 86400s | Admin.addAlert | (auto-expire) |
| `admin:stats:<coordinatorId>` | 30s | Admin.getStats | (auto-expire) |
| `admin:session:<sessionId>` | 28800s | AdminAuth.login | AdminAuth.logout |
| `delegate:lock:<tripId>` | 43200s | Delegate.activate | Delegate.endDelegation |
| `delegate:active:<busId>` | 43200s | Delegate.activate | Delegate.endDelegation |
| `delegate:coordinator:<coordinatorId>` | 43200s | Delegate.activate | Delegate.endDelegation |
| `checkin:rate:<studentId>` | 60s | Attendance.checkIn | (auto-expire) |
| `gps:buffer:<busId>` | N/A | GPS.receivePing | GPS.flushBuffer |

### Cache invalidation rules

1. **Event-driven invalidation:** When a domain event occurs (check-in, trip start, trip end), the module that owns the event must call `redis.del()` on all affected cache keys.
2. **TTL as backstop:** Every key must have a TTL. TTL is not the primary invalidation strategy — it's the safety net.
3. **No cache stampede:** For high-traffic keys (e.g., `student:home`), use `SET NX EX` to prevent multiple concurrent cache-miss regenerations.

```typescript
// Cache stampede prevention
async function getWithLock<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached);

  const lockKey = `lock:${key}`;
  const acquired = await redis.set(lockKey, '1', 'NX', 'EX', 10);

  if (!acquired) {
    // Another process is computing — wait and retry
    await new Promise(r => setTimeout(r, 100));
    return getWithLock(key, ttl, fn);
  }

  try {
    const result = await fn();
    await redis.setex(key, ttl, JSON.stringify(result));
    return result;
  } finally {
    await redis.del(lockKey);
  }
}
```

---

## 15. Async Job Durability

### Cloud Tasks — how it works

1. Your code enqueues a task to a Cloud Tasks queue via the GCP API
2. Cloud Tasks stores the task durably (survives Cloud Run pod restarts)
3. Cloud Tasks makes an HTTP POST to your Cloud Run service at the specified time
4. Your handler must return 2xx for success or non-2xx for retry
5. Cloud Tasks retries on non-2xx up to the configured maximum (default: unlimited, 100h deadline)

### Enqueueing helper

```typescript
// packages/shared/cloud-tasks.ts
import { CloudTasksClient } from '@google-cloud/tasks';

const client = new CloudTasksClient();
const QUEUE_PATH = client.queuePath(
  process.env.GCP_PROJECT!,
  process.env.GCP_REGION!,
  process.env.CLOUD_TASKS_QUEUE!,
);
const SERVICE_URL = process.env.CLOUD_RUN_URL!;

export async function enqueueJob(opts: {
  path: string;
  payload: unknown;
  scheduleTimeMs?: number;
  taskIdempotencyKey?: string;
}): Promise<void> {
  const task: any = {
    httpRequest: {
      url: `${SERVICE_URL}${opts.path}`,
      httpMethod: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Cloud Tasks OIDC token so our handler can verify it's a real Cloud Tasks request
        Authorization: `Bearer ${await getServiceAccountToken()}`,
      },
      body: Buffer.from(JSON.stringify(opts.payload)).toString('base64'),
    },
  };

  if (opts.scheduleTimeMs) {
    task.scheduleTime = { seconds: Math.floor(opts.scheduleTimeMs / 1000) };
  }

  if (opts.taskIdempotencyKey) {
    task.name = `${QUEUE_PATH}/tasks/${opts.taskIdempotencyKey}`;
  }

  await client.createTask({ parent: QUEUE_PATH, task });
}
```

### Idempotency in job handlers

Cloud Tasks may retry a job more than once (e.g., if your handler returns 200 but Cloud Tasks didn't receive it). All job handlers must be idempotent:

```typescript
// Pattern: check-then-act with database state
async function markAbsents(tripId: string): Promise<void> {
  const trip = await prisma.trip.findUnique({ where: { id: tripId } });

  // Idempotency check: if trip already processed, skip
  if (trip?.absentMarkingDoneAt) {
    console.log(`Trip ${tripId} already processed — skipping`);
    return;
  }

  const studentsWithoutCheckin = await prisma.routeAssignment.findMany({
    where: {
      trip: { id: tripId },
      NOT: { student: { attendanceLogs: { some: { tripId } } } },
    },
    select: { studentId: true },
  });

  await prisma.$transaction([
    prisma.attendanceLog.createMany({
      data: studentsWithoutCheckin.map(s => ({
        studentId: s.studentId,
        tripId,
        status: 'ABSENT',
        date: today(),
      })),
      skipDuplicates: true, // idempotent: safe to re-run
    }),
    prisma.trip.update({
      where: { id: tripId },
      data: { absentMarkingDoneAt: new Date() },
    }),
  ]);
}
```

---

## 16. Database Index Audit

These indices are called out in code comments as missing but not verified in `schema.prisma`. Add all of them.

```prisma
model AttendanceLog {
  // ... existing fields

  @@index([tripId, status])         // attendance queries filter by both
  @@index([studentId, date])        // student home BFF: today's attendance
  @@index([date, status])           // report generation: date range + status filter
}

model Trip {
  // ... existing fields

  @@index([date, routeId])          // daily trip creation: find trips for route today
  @@index([driverId, status])       // driver home: find today's active trip for driver
  @@index([status, date])           // jobs: find all active trips for GPS heartbeat
}

model Notification {
  // ... existing fields

  @@index([userId, createdAt])      // student in-app notifications: by user, recent first
  @@index([status, createdAt])      // admin: filter unread notifications
}

model Incident {
  // ... existing fields

  @@index([status, createdAt])      // incident list: filter by status
  @@index([tripId])                 // incident lookup by trip
}

model GpsPing {
  // ... existing fields

  @@index([busId, timestamp])       // GPS history queries: by bus, time range
}

model UserDevice {
  // ... existing fields

  @@index([userId, isActive])       // FCM token lookup: active devices per user
}

model ReportJob {
  // ... existing fields

  @@index([requestedBy, createdAt]) // admin: list their own report jobs
  @@index([status])                 // jobs: find pending/stuck reports
}
```

---

## 17. Security Hardening

### Authentication middleware

```typescript
// Both JWT types (mobile + admin) must validate in middleware
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) { res.status(401).json({ error: 'UNAUTHORIZED' }); return; }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;

    // Session version check — instant revocation
    const user = await userRepository.findById(payload.sub);
    if (user.sessionVersion !== payload.sessionVersion) {
      res.status(401).json({ error: 'SESSION_REVOKED' }); return;
    }

    req.user = user;
    next();
  } catch (e) {
    res.status(401).json({ error: 'INVALID_TOKEN' });
  }
}
```

### CSRF for admin panel

```typescript
// Double-submit cookie pattern
export function csrfProtect(req: Request, res: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) { next(); return; }

  const cookieToken = req.cookies['csrf-token'];
  const headerToken = req.headers['x-csrf-token'];

  if (!cookieToken || cookieToken !== headerToken) {
    res.status(403).json({ error: 'CSRF_VIOLATION' }); return;
  }
  next();
}
```

### Cloud Tasks request validation

```typescript
// Verify request actually came from Cloud Tasks (not spoofed)
export function validateCloudTasksRequest(req: Request, res: Response, next: NextFunction): void {
  const taskName = req.headers['x-cloudtasks-taskname'];
  const taskQueueName = req.headers['x-cloudtasks-queuename'];

  if (!taskName || !taskQueueName) {
    res.status(403).json({ error: 'NOT_A_CLOUD_TASKS_REQUEST' }); return;
  }

  // Optionally verify the OIDC bearer token from Cloud Tasks
  // using google-auth-library's OAuth2Client
  next();
}
```

---

## 18. Phased Execution Roadmap

### Pre-production (Before Week 1) — ~8 days total

| Task | Module | Effort | Owner |
|------|--------|--------|-------|
| Fix JOBS 200-on-all-errors | Jobs | 0.5d | Backend |
| Add Redis cache to STUDENT /home | Student | 1d | Backend |
| Fix mock FCM tokens | Notifications | 3d | Backend |
| Implement INCIDENTS list/get/escalate | Incidents | 1.5d | Backend |
| Migrate REPORTS to Cloud Tasks + GCS | Reports | 2d | Backend |

### Phase 1: Architectural Foundation (Week 1–4) — ~130h

| Task | Module | Effort |
|------|--------|--------|
| Full 4-layer refactor | Trips | 40h |
| Service layer + atomic repository | Attendance | 40h |
| Batch buffer extraction + delegation state machine | GPS | 30h |
| Lock + state machine refactor | Delegate | 20h |

### Phase 2: Operational Core (Week 4–5) — ~55h

| Task | Module | Effort |
|------|--------|--------|
| Cloud Tasks escalation chain | Incidents | 20h |
| Batch context + coordinator filtering | Admin | 15h |
| FCM token lookup + SMS idempotency | Notifications | 20h |

### Phase 3: Operational Support (Week 6–7) — ~45h

| Task | Module | Effort |
|------|--------|--------|
| Streaming CSV + batch transactions | Users + Import | 20h |
| Rate limit invite + CSRF refresh | Admin-Auth | 10h |
| Streaming CSV export + pagination | Reports | 15h |

### Phase 4: Clean-up (Week 8) — ~20h

| Task | Module | Effort |
|------|--------|--------|
| Extract driverRepository.ts | Driver | 4h |
| Fix 404→500 + add transactions | Fleet | 5h |
| Consolidate substitute driver source | Student | 3h |
| Resolve module path duplication | Driver + Student | 4h |
| Add Haversine to Routes stop proximity | Routes | 2h |
| Add all missing DB indices | Schema | 2h |

---

## 19. Module Dependency Map

```
                     ┌─────────────────────────────────────┐
                     │         EXTERNAL SERVICES           │
                     │  Firebase Auth · FCM · RTDB · GCS   │
                     │  MSG91 · GCP Cloud Tasks · Redis     │
                     │  PostgreSQL (via Prisma)             │
                     └─────────────────────────────────────┘
                                       │
          ┌────────────────────────────┼────────────────────────────┐
          │                            │                            │
    ┌─────▼──────┐             ┌───────▼──────┐            ┌───────▼──────┐
    │    AUTH    │             │  ADMIN-AUTH  │            │     QR       │
    │ Firebase   │             │ Email+TOTP   │            │ Nonce gen    │
    └─────┬──────┘             └──────────────┘            └───────┬──────┘
          │                                                         │
    ┌─────▼──────┐                                         ┌───────▼──────┐
    │ MOBILE-AUTH│                                         │ ATTENDANCE   │
    │ JWT+device │◄────────────────────────────────────────│ 13-step QR   │
    └────────────┘                                         └───────┬──────┘
                                                                   │
         ┌─────────────────────────────────────────────────────────┤
         │                                                         │
   ┌─────▼──────┐    ┌──────────────┐    ┌──────────────┐  ┌──────▼───────┐
   │   TRIPS    │◄───│   DELEGATE   │◄───│     GPS      │  │  STUDENT     │
   │ Lifecycle  │───►│ GPS takeover │───►│ 180+ buses   │  │  Home BFF    │
   └─────┬──────┘    └──────────────┘    └──────────────┘  └──────────────┘
         │
    ┌────┼────────────┬───────────────┐
    │    │            │               │
┌───▼──┐ │      ┌─────▼──────┐  ┌────▼───────┐
│FLEET │ │      │  INCIDENTS │  │   ADMIN    │
│Bus   │ │      │  SOS/esc.  │  │  Dashboard │
└──────┘ │      └─────┬──────┘  └────────────┘
         │            │
   ┌─────▼────┐  ┌────▼────────────────────────┐
   │  DRIVER  │  │       NOTIFICATIONS          │
   │  BFF     │  │  FCM · SMS · IN_APP · BullMQ │
   └──────────┘  └────────────────────────────┬─┘
                                              │
              ┌───────────────────────────────┤
              │               │               │
        ┌─────▼───┐   ┌───────▼──┐   ┌───────▼──┐
        │  USERS  │   │  IMPORT  │   │  REPORTS │
        │ Profile │   │  CSV     │   │  Export  │
        └─────────┘   └──────────┘   └──────────┘
                                          │
                                    ┌─────▼───────┐
                                    │    JOBS     │
                                    │ CloudTasks  │
                                    └─────────────┘
```

**Read direction:** Arrow = "depends on" / "calls"

---

## 20. Testing Strategy

### What to test first (by risk)

1. **Attendance.checkIn** — highest traffic, most steps, most failure modes
2. **Notifications.sendPush** — was broken in production, must have integration test
3. **Jobs handlers** — must verify 500 on error
4. **Trips.startTrip / endTrip** — Redis priming and cache clearing
5. **Delegate.activate** — race condition on concurrent activation

### Unit test pattern (service layer)

```typescript
// attendance.service.test.ts
describe('Attendance.checkIn', () => {
  let redis: MockRedis;
  let prisma: DeepMockProxy<PrismaClient>;
  let service: AttendanceService;

  beforeEach(() => {
    redis = new MockRedis();
    prisma = mockDeep<PrismaClient>();
    service = new AttendanceService(redis, new AttendanceRepository(prisma));
  });

  it('burns QR nonce atomically and prevents replay', async () => {
    redis.set('qr:nonce:abc123', 'bus-1');
    redis.set('trip:active:bus-1', 'trip-1');

    await service.checkIn('student-1', validQrToken('abc123', 'bus-1'), coords);

    // Nonce consumed
    expect(await redis.get('qr:nonce:abc123')).toBeNull();

    // Second attempt with same nonce fails
    await expect(service.checkIn('student-1', validQrToken('abc123', 'bus-1'), coords))
      .rejects.toMatchObject({ code: 'QR_EXPIRED' });
  });

  it('opens self-report window when GPS is OFFLINE', async () => {
    redis.set('qr:nonce:abc123', 'bus-1');
    redis.set('trip:active:bus-1', 'trip-1');
    redis.set('trip:gpsStatus:trip-1', 'OFFLINE');

    prisma.attendanceLog.upsert.mockResolvedValue({ status: 'SELF_REPORTED' } as any);

    const result = await service.checkIn('student-1', validQrToken('abc123', 'bus-1'), farAwayCoords);
    expect(result.status).toBe('SELF_REPORTED');
  });
});
```

### Integration test — FCM tokens (must run against staging Firebase)

```typescript
it('fetches real FCM tokens from userDevice table', async () => {
  await prisma.userDevice.create({
    data: { userId: 'u1', deviceHash: 'h1', fcmToken: 'real-fcm-token-from-firebase' },
  });

  const spy = jest.spyOn(admin.messaging(), 'sendEachForMulticast');

  await notificationService.sendPush({ recipientIds: ['u1'], title: 'Test', body: 'Test' });

  expect(spy).toHaveBeenCalledWith(
    expect.objectContaining({ tokens: ['real-fcm-token-from-firebase'] })
  );
});
```

### Load test — Student /home at peak

```typescript
// Use k6 or Artillery to simulate 1000 concurrent /home requests
// Before fix: expect connection pool exhaustion (~8 concurrent Prisma connections)
// After fix: expect cache hit rate > 90%, response time < 50ms at p99
```

---

## Appendix: Shared Utilities Required

These utilities are referenced throughout this document. Ensure they exist in `packages/shared/`:

```
packages/shared/
├── errors.ts           // AppError class
├── enums.ts            // All status enums centralized
├── haversine.ts        // haversineMeters(a, b) function
├── today.ts            // today() → Date at midnight local time
├── cloud-tasks.ts      // enqueueJob() helper
├── redis.ts            // Shared Redis client instance
├── logger.ts           // Structured logger (pino recommended)
└── audit.ts            // AuditContext type + extractAuditContext()
```

---

*This document reflects the system state as of the initial audit. Update it as modules are fixed and new issues are discovered. Each completed fix should be marked with a ✅ and dated.*
