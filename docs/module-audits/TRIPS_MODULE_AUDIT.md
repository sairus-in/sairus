# Trips Module — Deep Dive Audit

**Module Location:** `apps/backend/src/modules/trips/`  
**Files:** `trips.service.ts`, `trips.routes.ts`, `delegate.service.ts`  
**Total LOC:** ~700+ lines of highly coordinated backend logic

---

## 1. ARCHITECTURE OVERVIEW

### 1.1 Module Purpose

The trips module is the **temporal/operational heart** of the bus system. It manages:
- **Trip Lifecycle**: SCHEDULED → ACTIVE → COMPLETED state transitions
- **Student Boarding**: Per-trip attendance tracking and expected counts
- **GPS Fallback Handling**: Graceful degradation when GPS goes offline
- **Driver Delegation**: Emergency takeover by staff when driver is incapacitated
- **Admin Alerts**: Real-time dashboard updates for operational visibility

### 1.2 Core Abstraction

```
Request Layer (trips.routes.ts)
    ↓ parse + validate Zod schemas
Service Layer (trips.service.ts + delegate.service.ts)
    ↓ business logic + orchestration
Data Layer (prisma ORM)
    ↓ database operations
```

**Why No Repository?** The trips module predates the 4-layer pattern. It blends service-level logic directly with Prisma queries. This is acceptable because:
- Trip queries are simple (few JOINs: bus, route, driver)
- Service layer remains cohesive (all trip logic in one place)
- Future refactoring candidate for repository extraction

---

## 2. ROUTE LAYER ANALYSIS (`trips.routes.ts`)

### 2.1 Route Structure

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/:tripId/start` | PATCH | DRIVER | Driver initiates trip |
| `/:tripId/end` | POST | DRIVER | Driver ends trip |
| `/:tripId/students` | GET | DRIVER | List trip attendees |
| `/:tripId/manual-mark` | POST | DRIVER | Mark student as present (dead phone) |
| `/late-starts` | GET | ADMIN | Alert on unstarted trips |
| `/my-trip` | GET | DRIVER | Driver's trip for today |
| `/:tripId/delegate/check` | POST | ADMIN/STAFF | Pre-check delegation eligibility |
| `/:tripId/delegate/activate` | POST | ADMIN/STAFF | Activate delegation (GPS fallback) |
| `/:tripId/delegate/warning` | POST | STAFF/DELEGATE | Report location permission issues |
| `/:tripId/delegate/end` | POST | DRIVER | End delegation (driver returns) |

### 2.2 Authentication & Guards

```typescript
// Mobile driver endpoints
mobileRoute(['DRIVER'])

// Admin/staff endpoints (delegation, alerts)
adminRoute(['COORDINATOR', 'TRANSPORT_OFFICER', 'FACULTY', 'MANAGEMENT'])
```

**Design Pattern:** Role-based middleware guards prevent unauthorized state transitions.

### 2.3 Validation Schemas

#### Manual Mark Schema
```typescript
const manualMarkSchema = z.object({
  studentId: z.string().cuid(),      // Target student
  note: z.string().optional(),        // Reason (dead phone, etc)
});
```

**Intent:** Driver manually marks student present when phone is dead or QR fails.

#### Delegation Schemas
```typescript
const delegateCheckSchema = z.object({
  lat: z.number(),                    // Requester's location
  lon: z.number(),
});

const delegateActivateSchema = z.object({
  lat: z.number(),
  lon: z.number(),
  delegateType: z.enum(['GPS', 'KIOSK', 'BOTH']),  // What responsibility transfers
});

const delegateWarningSchema = z.object({
  warningType: z.enum([
    'BACKGROUND_ENTERED',              // Delegate went to background
    'PRECISION_LOCATION_DISABLED',     // User disabled location perms
    'GPS_ACCURACY_DEGRADED',           // Signal weak
    'LOCATION_PERMISSION_REVOKED',     // OS revoked perms
    'BATTERY_SAVER_ENABLED',           // Power saving mode on
    'PING_FAILURES_REPEATED'           // Network is bad
  ]),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  meta: z.record(z.any()).optional(),  // Context-specific metadata
});
```

**Intent:** Delegation is **conditional, continuous, and observable**. These schemas ensure operators understand the real-time state degradation.

### 2.4 Rate Limiting

```typescript
// START TRIP: 100 operations/hour per driver
await checkRateLimit((app as any).redis, {
  key: `rl:trip:${request.user!.sub}`,
  max: 100,
  windowSeconds: 3600,
});
```

**Why?** Prevents accidental/malicious rapid trip starts. 100/hour = ~1.67 ops/minute, plenty for legitimate use.

### 2.5 Idempotency Pattern

```typescript
// START TRIP + MANUAL MARK are idempotent
await cacheIdempotentResponse(request, 200, body, IDEMPOTENCY_TTL.ONE_DAY);
```

**How it works:**
1. Client sends `Idempotency-Key` header
2. Response cached for 1 day
3. Retry with same key → returns cached response (no re-execution)

**Purpose:** Handle network retries without double-starting trips or duplicating manual marks.

---

## 3. SERVICE LAYER ANALYSIS (`trips.service.ts`)

### 3.1 Class-Based Design

```typescript
export class TripsService {
  async startTrip(tripId, driverId) { ... }
  async endTrip(tripId, driverId, auditActor?) { ... }
  async getTripStudents(tripId) { ... }
  async manualMark(tripId, studentId, driverId, note?) { ... }
  async getScheduledTripForDriver(driverId) { ... }
  async getLateStartTrips() { ... }
}

export const tripsService = new TripsService();
```

**Why Class-Based?** Provides:
- Singleton pattern (one instance per process)
- Method organization (cohesive trip logic)
- Future extensibility (inheritance, mixins)

---

### 3.2 Trip Start Flow (`startTrip`)

#### Step 1: Retrieve & Validate Trip

```typescript
const trip = await prisma.trip.findUnique({ where: { id: tripId } });
if (!trip) throw new BadRequestError('TRIP_NOT_FOUND');
if (trip.driverId !== driverId) throw new ForbiddenError('NOT_YOUR_TRIP');
if (trip.status === 'ACTIVE') return trip;  // idempotent
if (trip.status !== 'SCHEDULED') throw new BadRequestError('TRIP_CANNOT_START');
```

**Checks:**
- Trip exists (active trip = valid state)
- Ownership (driver can only start their own trips)
- Idempotency (already active = return cached)
- State machine (can only start from SCHEDULED)

#### Step 2: Update Database

```typescript
const updated = await prisma.trip.update({
  where: { id: tripId },
  data: { status: 'ACTIVE', startedAt: new Date() },
  include: { bus: true, route: true, driver: true }
});
```

**Includes:** Fetch related bus/route/driver for event broadcasting.

#### Step 3: Prime Redis Caches

```typescript
// Cache for check-in lookups (all check-ins will hit this)
await setActiveTripCache(trip.busId, trip.id);

// Seed dashboard stats
await cacheSAdd('active-trips', tripId);
await cacheHIncrBy('dashboard:stats', 'activeTrips', 1);

// Broadcast trip state to admin maps
await cacheHSet(`trip:${tripId}:state`, {
  status: 'ACTIVE', 
  boardedCount: 0, 
  gpsStatus: 'LIVE',
  startedAt: Date.now(),
  busId, routeId, busNumber, routeName, driverName, expectedCount
});
```

**Purpose:**
- **Active trip cache** is queried on every QR check-in (hot path optimization)
- **Dashboard stats** enable real-time counter in admin UI
- **Trip state hash** contains all info needed for admin map animation

#### Step 4: Broadcast Events

```typescript
if (io) {
  io.to('admin').emit('trip:started', {
    tripId: updated.id,
    busId: updated.busId,
    routeId: updated.routeId,
    startedAt: updated.startedAt?.toISOString(),
  });
  
  io.to(`route:${updated.routeId}`).emit('trip:started', payload);
}
```

**Broadcasting Strategy:**
- `io.to('admin')` → all admin dashboard clients get update
- `io.to('route:X')` → route coordinators see their routes light up

**Timing:** Emitted **after** DB write + Redis cache, ensuring all sources synchronized.

---

### 3.3 Trip End Flow (`endTrip`)

#### Step 1: Retrieve & Validate

```typescript
const trip = await prisma.trip.findUnique({ where: { id: tripId } });
if (!trip) throw new BadRequestError('TRIP_NOT_FOUND');
if (trip.driverId !== driverId) throw new ForbiddenError('NOT_YOUR_TRIP');
if (trip.status === 'COMPLETED') return trip;  // idempotent
if (trip.status !== 'ACTIVE') throw new BadRequestError('TRIP_NOT_ACTIVE');
```

#### Step 2: Clear Caches

```typescript
await clearActiveTripCache(trip.busId);        // used by check-in layer
await cacheSRem('active-trips', tripId);       // used by dashboard
await cacheHIncrBy('dashboard:stats', 'activeTrips', -1);
await cacheDel(`trip:${tripId}:state`);        // cleanup
```

**Pattern:** Symmetrical cleanup. Whatever was cached during start is invalidated now.

#### Step 3: GPS Outage Fallback Logic (Critical)

```typescript
if (completed.gpsOutageStart) {
  // GPS was offline during trip
  // Schedule mark-absent job to wait for self-reports
  
  const delaySeconds = Math.floor(TRIP.OUTAGE_PENDING_WINDOW_MS / 1000);  // ~30 mins
  const url = `${BACKEND_URL}/v1/jobs/gps-outage-absent/${tripId}`;
  
  await cloudTasksClient.createTask({
    parent: queuePath,
    task: {
      scheduleTime: { seconds: Math.floor(Date.now() / 1000) + delaySeconds },
      httpRequest: {
        httpMethod: 'POST',
        url,
        headers: {
          'Content-Type': 'application/json',
          'x-cloud-tasks-secret': env.CLOUD_TASKS_SECRET || 'dev-secret',
        },
        body: Buffer.from(JSON.stringify({ outageMinutes })).toString('base64'),
      }
    }
  });
  
  // Open self-report window in Redis (blocks mark-absent until window closes)
  await redis.setex(`trip:outage-window:${tripId}`, TRIP.OUTAGE_WINDOW_REDIS_TTL_SECONDS, '1');
  
  // Notify students: "Let us know if you were on this bus"
  await notificationsService.notifyUncheckedStudentsForSelfReport(tripId);
  
} else {
  // Normal path: schedule mark-absent immediately
  const url = `${BACKEND_URL}/v1/jobs/mark-absent`;
  await cloudTasksClient.createTask({
    parent: queuePath,
    task: {
      httpRequest: {
        httpMethod: 'POST',
        url,
        headers: { ... },
        body: Buffer.from(JSON.stringify({ tripId })).toString('base64'),
      }
    }
  });
}
```

**GPS Outage Handling — The Two-Phase Approach:**

1. **Phase 1: Pending Window** (exists, deferred job)
   - GPS was offline during trip
   - Self-report notifications sent
   - Next 30 minutes: students can self-report attendance
   - Cloud Tasks job scheduled to execute after 30 mins

2. **Phase 2: Mark Absent** (final state)
   - After 30 mins, anyone not checked-in or self-reported → ABSENT
   - Job runs: `PATCH /v1/jobs/gps-outage-absent/{tripId}`

**Why Two Phases?**
- Students with dead phones get 30 mins to self-report (fairness)
- Prevents false absences from GPS outages (business requirement)
- Cloud Tasks handles deferred execution (unlike cron, survives Cloud Run restarts)

#### Step 4: Audit Logging

```typescript
if (auditActor) {
  auditService.log({
    actor: {
      ...auditActor,
      routeIds: auditActor.routeIds?.length ? auditActor.routeIds : [trip.routeId],
    },
    action: 'END_TRIP',
    entityType: 'trip',
    entityId: tripId,
    before: { status: trip.status, startedAt, endedAt },
    after: { status: completed.status, startedAt, endedAt },
    meta: { driverId, busId, routeId },
  });
}
```

**Who Calls This?** Routes layer with audit context (actor IP, user ID).  
**Who Calls Without?** Internal services (GPS delegate detection) skip audit.

#### Step 5: Broadcast Events

```typescript
io.to('admin').emit('trip:ended', adminPayload);
io.to(`trip:${completed.id}`).emit('trip:ended', tripPayload);
io.to(`route:${completed.routeId}`).emit('trip:ended', adminPayload);
```

---

### 3.4 Manual Mark Flow (`manualMark`)

#### Use Case
Driver sees student attendance list during trip. Spot a student on the bus but their phone is dead (no QR scan). Driver manually taps "Mark Present" with optional note.

#### Implementation

```typescript
async manualMark(tripId, studentId, driverId, note?) {
  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip || trip.driverId !== driverId) throw new ForbiddenError('UNAUTHORIZED');
  if (trip.status !== 'ACTIVE') throw new BadRequestError('TRIP_NOT_ACTIVE');

  const today = getISODateIST();

  // Atomic upsert + increment transaction
  const [log] = await prisma.$transaction([
    prisma.attendanceLog.upsert({
      where: { userId_tripId: { userId: studentId, tripId } },
      update: {
        status: 'MANUAL',
        method: 'MANUAL_DRIVER',
        checkedInAt: new Date(),
        driverNote: note
      },
      create: {
        userId: studentId, tripId, busId: trip.busId, routeId: trip.routeId,
        date: today, dateKey: today,
        status: 'MANUAL',
        method: 'MANUAL_DRIVER',
        checkedInAt: new Date(),
        driverNote: note,
      },
    }),
    prisma.trip.update({
      where: { id: tripId },
      data: { boardedCount: { increment: 1 } },
    }),
  ]);

  // Event source the change for audit trail
  await prisma.attendanceEvent.create({
    data: {
      attendanceId: log.id,
      type: 'MANUAL_CORRECTION',
      method: 'MANUAL_DRIVER',
      actorId: driverId,
      previousStatus: null,
      newStatus: 'MANUAL',
      metadata: { note },
    },
  });

  return log;
}
```

**Key Patterns:**

1. **Atomic Transaction**
   - Upsert log (create if not exists, update if already marked)
   - Increment trip's boarded count in same transaction
   - Prevents double-counting

2. **Event Sourcing**
   - Attendance change recorded in immutable `attendanceEvent` table
   - Every correction logged (who, when, what, why)
   - Enables audit trails + reconstruction of state

3. **Idempotency**
   - Same student marked twice? Upsert ignores second attempt
   - Boarding count only incremented once (via increment operation)

---

### 3.5 Admin Alerts: Get Trips Not Started on Time (`getLateStartTrips`)

#### Use Case
Admin dashboard shows "Trip X on Route Y hasn't started yet and it's 10+ minutes past scheduled time."

#### Implementation

```typescript
async getLateStartTrips() {
  const today = getISODateIST();
  const allScheduled = await prisma.trip.findMany({
    where: { date: today, status: 'SCHEDULED' },
    include: {
      bus: { select: { number: true } },
      route: {
        select: {
          name: true,
          stops: {
            orderBy: { sequence: 'asc' },
            take: 1,
            include: { stop: true }
          }
        }
      },
      busAssignment: { select: { driverId: true } },
    },
  });

  // Calculate "now" in minutes since midnight IST
  const nowMinutes = (() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  })();

  // Filter trips that are 10+ minutes overdue
  return allScheduled.filter(trip => {
    const firstStop = trip.route.stops[0];
    if (!firstStop) return false;
    
    // Get scheduled time for first stop (morning or return)
    const scheduled = trip.type === 'MORNING'
      ? firstStop.scheduledTimeMorning
      : firstStop.scheduledTimeReturn;
    
    // Time elapsed since scheduled
    return (nowMinutes - scheduled) >= 10;
  });
}
```

**Design Decisions:**

1. **IST Time Zone**
   - All times relative to India Standard Time (company HQ)
   - `getISODateIST()` returns YYYY-MM-DD in IST
   - Prevents midnight edge cases from timezone conversions

2. **First Stop Only**
   - Uses first stop's scheduled time as "trip start time"
   - Cleaner than averaging all stops or using fixed times

3. **Scheduled Time Format**
   - Stored as minutes since midnight (0-1440)
   - E.g., 8:30 AM = 510 minutes
   - Avoids DateTime parsing overhead on hot path

4. **10-Minute Threshold**
   - Grace period for driver delays (traffic, prep)
   - Prevents alert spam for minimal lateness

---

### 3.6 Query Patterns

#### Pattern: Fetch with Relationships

```typescript
const updated = await prisma.trip.update({
  where: { id: tripId },
  data: { status: 'ACTIVE', startedAt: new Date() },
  include: { bus: true, route: true, driver: true }  // ← fetch related
});
```

**Why Include?** Response must contain bus number, route name, driver name for event broadcasting. Single query = 1 round-trip instead of 3.

#### Pattern: Bulk Fetch for Dashboard

```typescript
await prisma.trip.findMany({
  where: { date: today, status: 'SCHEDULED' },
  include: {
    bus: { select: { number: true } },
    route: { select: { name: true, stops: { take: 1, include: { stop: true } } } },
  },
});
```

**Projection:** Only select fields needed (number, name, stops). Reduces network payload.

---

## 4. DELEGATION SYSTEM (`delegate.service.ts`)

### 4.1 Problem Statement

**Scenario:** Bus breaks down, driver is injured, or GPS fails. We need **someone nearby to take over GPS responsibilities** to keep location tracking live.

**Constraints:**
- Can't wait for driver recovery (students are stuck)
- Can't be anyone (must be trained staff: coordinator, faculty, transport officer)
- Can't be far away (20m radius from bus)
- Can't be long-term (should end when driver returns)
- Must be observable (all location issues must be logged)

### 4.2 Eligibility Check Phase (`checkEligibility`)

```typescript
async checkEligibility(tripId, userId, lat, lon) {
  // Parallel fetch
  const [user, trip] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.trip.findUnique({ where: { id: tripId } }),
  ]);

  if (!user || !trip) throw new BadRequestError('INVALID_DATA');

  // 1. Role check
  if (!ALLOWED_DELEGATE_ROLES.includes(user.role)) {
    return { eligible: false, reason: 'ROLE_NOT_AUTHORIZED' };
  }

  // 2. Trip must be active
  if (trip.status !== 'ACTIVE') {
    return { eligible: false, reason: 'TRIP_NOT_ACTIVE' };
  }

  // 3. GPS must be offline (can't delegate while driver has signal)
  const gpsStatus = await redis.get(`gps:status:${trip.busId}`);
  if (gpsStatus !== 'OFFLINE') {
    return { eligible: false, reason: 'BUS_GPS_NOT_OFFLINE', gpsStatus };
  }

  // 4. No active delegation
  const existingDelegate = await redis.get(`trip:delegate:${tripId}`);
  if (existingDelegate) {
    return { eligible: false, reason: 'DELEGATE_ALREADY_ACTIVE' };
  }

  // 5. Proximity check (within 200m of bus)
  const lastPosStr = await redis.get(`bus:${trip.busId}:lastPosition`);
  let distance = null;

  if (lastPosStr) {
    const busPos = JSON.parse(lastPosStr);
    distance = getDistanceMetres(lat, lon, busPos.lat, busPos.lon);
    if (distance > 200) {
      return { eligible: false, reason: 'NOT_NEAR_BUS', distance, maxAllowed: 200 };
    }
  } else {
    // No recent GPS = can't verify proximity geometrically
    // Fall back to: is coordinator assigned to this route?
    const routeAssignment = await prisma.routeAssignment.findFirst({
      where: { userId, routeId: trip.routeId, isActive: true },
    });
    if (!routeAssignment) {
      return { eligible: false, reason: 'NO_POSITION_AND_NO_ROUTE_ASSOCIATION' };
    }
  }

  return { eligible: true, gpsStatus, distance, maxAllowed: 200 };
}
```

**Design:** Pre-checks are **readonly** (no state mutation). Client can poll this to show "Eligibility: ✅ You can take over".

---

### 4.3 Activation Phase (`activateDelegation`)

#### 4.3.1 Atomic Lock

```typescript
const operationId = crypto.randomUUID();
const lockKey = `trip:delegate:activate:${tripId}`;

// SET NX (only set if key doesn't exist)
const lockAcquired = await redis.setnx(lockKey, operationId);
if (!lockAcquired) {
  throw new ConflictError('ACTIVATION_IN_PROGRESS');
}
await redis.expire(lockKey, 10);  // 10 second expiry
```

**Why Lock?** Two coordinators might click "Activate" simultaneously. Lock prevents double-activation:
- First wins (acquires lock)
- Second gets `ACTIVATION_IN_PROGRESS` error
- Lock auto-expires after 10s (failsafe)

#### 4.3.2 Re-Check Eligibility

```typescript
// Same checks as checkEligibility
const [user, trip] = await Promise.all([
  prisma.user.findUnique({ where: { id: userId } }),
  prisma.trip.findUnique({ where: { id: tripId } }),
]);

if (!ALLOWED_DELEGATE_ROLES.includes(user.role)) {
  throw new ForbiddenError('ROLE_NOT_AUTHORIZED');
}

if (trip.status !== 'ACTIVE') {
  throw new BadRequestError('TRIP_NOT_ACTIVE');
}

const gpsStatus = await redis.get(`gps:status:${trip.busId}`);
if (gpsStatus !== 'OFFLINE') {
  throw new BadRequestError('BUS_GPS_NOT_OFFLINE', { currentStatus: gpsStatus });
}

const existingDelegate = await redis.get(`trip:delegate:${tripId}`);
if (existingDelegate) {
  const delegateUser = await prisma.user.findUnique({ where: { id: JSON.parse(existingDelegate).userId } });
  throw new ConflictError('DELEGATE_ALREADY_ACTIVE', { delegateName: delegateUser?.name });
}
```

**Why Re-Check?** State could have changed between eligibility check and activation (e.g., driver returned, GPS came back online).

#### 4.3.3 Create Audit Record

```typescript
const delegateRecord = await prisma.tripDelegate.create({
  data: {
    tripId,
    delegateId: userId,
    delegateType,  // 'GPS', 'KIOSK', or 'BOTH'
    status: 'PENDING',
    activationLat: lat,
    activationLon: lon,
    distanceFromBus,
    activationMethod,  // 'GEOFENCE' or 'ROUTE_ASSOCIATION'
    operationId,
  }
});
```

**Immutable Audit Trail:** Every delegation activation is recorded with:
- Who activated it
- When
- Where (lat/lon)
- How far from bus
- Type of delegation (GPS-only vs. attendance kiosk)

#### 4.3.4 Atomic Activation Transaction

```typescript
try {
  await prisma.$transaction([
    // Atomic update 1: Mark trip as having delegate
    prisma.trip.updateMany({
      where: { id: tripId, delegateId: null },  // ← only if not already delegated
      data: { delegateId: userId, gpsOutageStart: new Date() }
    }),
    // Atomic update 2: Mark delegation as ACTIVE
    prisma.tripDelegate.update({
      where: { id: delegateRecord.id },
      data: { status: 'ACTIVE', activatedAt: new Date() }
    })
  ]);
} catch (txError) {
  // Someone else activated in between check and commit
  await prisma.tripDelegate.update({
    where: { id: delegateRecord.id },
    data: { status: 'FAILED', endReason: 'CONCURRENT_ACTIVATION' }
  });
  throw new ConflictError('DELEGATE_ALREADY_ACTIVE');
}
```

**Why `updateMany` with condition?** If another coordinator activated between our checks, the `updateMany` will match 0 rows. The `catch` block records this and throws.

#### 4.3.5 Store Delegation State in Redis

```typescript
await redis.setex(
  `trip:delegate:${tripId}`,
  12 * 60 * 60,  // 12-hour TTL
  JSON.stringify({
    userId,
    delegateType,
    operationId,
    activatedAt: Date.now(),
    busId: trip.busId,
  })
);

await redis.expire(lockKey, 12 * 60 * 60);  // Extend lock to 12 hours
```

**Purpose:**
- GPS layer queries this to know "who is sending pings for this trip?"
- Attendance layer skips QR for this trip (delegate only does manual marks)
- 12-hour TTL = safety net (delegation auto-ends if heartbeat crashes)

#### 4.3.6 Update Firebase Realtime

```typescript
if (firebaseAdmin) {
  await firebaseAdmin.database().ref(`/buses/${trip.busId}`).update({
    delegateActive: true,
    delegateSource: user.role,  // 'STAFF', 'COORDINATOR', etc.
    gpsStatus: 'LIVE',
  });
}
```

**Why Firebase?** Mobile app subscribed to `/buses/{busId}` to know "is a delegate active?" Realtime enables instant UI updates.

#### 4.3.7 Broadcast & Metrics

```typescript
if (io) {
  const payload = { tripId, busId: trip.busId, routeId: trip.routeId, delegateType };
  io.to(`bus:${trip.busId}`).emit('delegate:activated', payload);
  io.to('admin').emit('delegate:activated', payload);
}

await metrics.inc('delegate_activation_success_total');
await metrics.gaugeInc('active_delegations_gauge');
```

**Broadcasting:** All connected clients subscribed to bus or admin room get instant notification.

---

### 4.4 Handling Location Permission Warnings (`handleWarning`)

#### Use Case
While delegating GPS, the coordinator's phone enters background or loses location permissions. They report this to warn others about potential GPS blackout.

```typescript
async handleWarning(tripId, userId, data) {
  const activeDelegateStr = await redis.get(`trip:delegate:${tripId}`);
  if (!activeDelegateStr) throw new BadRequestError('INVALID_DATA');
  
  const delegate = JSON.parse(activeDelegateStr);
  if (delegate.userId !== userId) throw new ForbiddenError('ROLE_NOT_AUTHORIZED');

  const { warningType, severity, meta } = data;
  const operationId = `warn-${tripId}-${Date.now()}`;

  // 1. Audit Log (immutable trace)
  logger.info({
    event: 'delegate_warning_received',
    tripId, userId, operationId, source: 'DELEGATE',
    meta: { warningType, severity, ...meta }
  });

  await metrics.inc('delegate_warning_total', { type: warningType });

  // 2. Rate limit push notifications (max 1 push per 60s per trip+type)
  const rateLimitPushKey = `rate:warn:push:${tripId}:${warningType}`;
  const pushAllowed = await redis.setnx(rateLimitPushKey, '1');
  
  if (pushAllowed) {
    await redis.expire(rateLimitPushKey, 60);
    
    if (severity === 'HIGH' || severity === 'CRITICAL') {
      await notificationsService.dispatch(
        [userId],
        {
          type: 'DELEGATE_WARNING',
          title: 'Critical Location Warning',
          body: 'Your OS is restricting location. Open the app immediately to keep GPS broadcasting.',
          metadata: { tripId, warningType }
        },
        ['PUSH']
      );
    }
  }

  // 3. Coordinator Escalation Rate Limiting (max 3 per 10 mins)
  if (severity === 'CRITICAL') {
    const rateLimitCoordKey = `rate:warn:coord:${tripId}`;
    const countStr = await redis.get(rateLimitCoordKey);
    let count = countStr ? parseInt(countStr, 10) : 0;
    
    if (count < 3) {
      await redis.incr(rateLimitCoordKey);
      if (count === 0) await redis.expire(rateLimitCoordKey, 600);  // 10 mins
      
      logger.warn({
        event: 'delegate_warning_escalation_eligible',
        tripId, operationId, source: 'SYSTEM',
        meta: { warningCount: count + 1 }
      });
    }
  }
}
```

**Pattern: Observability via Immutable Events**
- Every warning logged (who, when, what)
- Metrics tracked (how often, what type)
- Notifications rate-limited (don't spam)
- Escalation thresholds enforced (max 3 criticals per 10 mins)

---

### 4.5 Ending Delegation (`endDelegation`)

#### When Does It Happen?

1. **Manual end** — Driver returns, coordinator clicks "End Delegation"
2. **Driver return detected** — GPS layer detects driver sending 2+ pings after delegate started (see `handleDriverReturn`)
3. **Session expiry** — Delegation expires after 12 hours (Redis TTL)

```typescript
async endDelegation(tripId, reason, requesterId) {
  const activeDelegateStr = await redis.get(`trip:delegate:${tripId}`);
  if (!activeDelegateStr) return;  // Already ended or never existed
  
  const activeDelegate = JSON.parse(activeDelegateStr);

  // Atomic end: update trip + delegation record
  await prisma.$transaction([
    prisma.tripDelegate.updateMany({
      where: { tripId, delegateId: activeDelegate.userId, status: 'ACTIVE' },
      data: { status: 'ENDED', endedAt: new Date(), endReason: reason as any }
    }),
    prisma.trip.update({
      where: { id: tripId },
      data: { delegateId: null }  // Clear delegate reference
    })
  ]);

  // Clean up all Redis state
  await redis.del(`trip:delegate:${tripId}`);
  await redis.del(`trip:delegate:activate:${tripId}`);
  await redis.del(`trip:delegate:heartbeat:${tripId}`);

  // Update Firebase (mobile apps watching will see this)
  if (firebaseAdmin) {
    await firebaseAdmin.database().ref(`/buses/${activeDelegate.busId}`).update({
      delegateActive: false,
      delegateSource: null,
      source: 'DRIVER'
    });
  }

  // Broadcast to all connected clients
  if (io) {
    const payload = { tripId, busId: activeDelegate.busId, userId: activeDelegate.userId, reason };
    io.to(`user:${activeDelegate.userId}`).emit('delegation:ended', payload);
    io.to('admin').emit('delegation:ended', payload);
  }

  // Audit
  logger.info({
    event: 'delegation_ended',
    tripId, userId: activeDelegate.userId, source: 'SYSTEM',
    meta: { reason, requesterId }
  });

  // Metrics
  await metrics.gaugeDec('active_delegations_gauge');
  await metrics.inc('delegate_termination_total', { reason: String(reason) });
}
```

**Cleanup Pattern:** Remove all Redis keys, update DB, broadcast, log. Ensures state is eventually consistent.

---

### 4.6 Driver Return Detection (`handleDriverReturn`)

**Scenario:** Delegate is broadcasting GPS. Driver suddenly returns and their app starts sending pings again.

**GPS layer detects:** "OK, delegate is active, but I'm getting pings from the original driver (not the delegate)."

```typescript
async handleDriverReturn(tripId, busId, delegateUserId, operationId) {
  await this.endDelegation(tripId, 'DRIVER_RETURNED', 'SYSTEM');
  
  logger.info({
    event: 'delegate_handback_driver_returned',
    tripId, busId, userId: delegateUserId, operationId, source: 'DRIVER'
  });
}
```

Called from `gps.service.ts`:
```typescript
const activeDelegateStr = await redis.get(`trip:delegate:${tripId}`);
if (activeDelegateStr) {
  const delegate = JSON.parse(activeDelegateStr);
  if (userId === trip.driverId) {
    const driverPingCount = await redis.incr(`trip:driver:return:${tripId}`);
    await redis.expire(`trip:driver:return:${tripId}`, 15);

    if (driverPingCount >= 2) {  // 2 pings = confirmed return
      await redis.del(`trip:driver:return:${tripId}`);
      await delegateService.handleDriverReturn(tripId, busId, delegate.userId, operationId);
      source = 'DRIVER';
    } else {
      source = 'DELEGATE';
    }
  }
}
```

**Why 2-Ping Threshold?** Prevents flapping (network hiccup = delegate ends prematurely). 2 pings within 15s confirms driver is back online.

---

## 5. CACHING STRATEGY

### 5.1 Redis Keys Used

| Key | TTL | Purpose | Set By | Read By |
|-----|-----|---------|--------|---------|
| `active-trips` | N/A (SET) | Set of active trip IDs | startTrip | Dashboard stats |
| `dashboard:stats` | N/A (HASH) | Real-time counter (activeTrips, etc) | startTrip | Admin panel |
| `trip:{tripId}:state` | N/A (HASH) | All trip info for map animation | startTrip | Admin maps |
| `trip:delegate:{tripId}` | 12h | Active delegation metadata | activateDelegation | GPS service |
| `trip:delegate:activate:{tripId}` | 12h | Activation lock + state | activateDelegation | Concurrent activation detection |
| `trip:driver:return:{tripId}` | 15s | Driver ping counter | GPS service | Driver return detection |
| `rate:warn:push:{tripId}:{type}` | 60s | Push notification rate limit | handleWarning | Prevent spam |
| `rate:warn:coord:{tripId}` | 10m | Coordinator escalation threshold | handleWarning | Prevent alert flooding |
| `trip:outage-window:{tripId}` | varies | DNS outage self-report window | endTrip | mark-absent job |
| `bus:{busId}:lastPosition` | varies | Most recent GPS ping | GPS service | Delegation proximity checks |
| `gps:status:{busId}` | varies | LIVE/OFFLINE state | GPS service | Delegation eligibility |

### 5.2 Caching Principles

**Hot Path:** Check-in (attendance.service) queries `active-trips` → `trip:X:state` to validate trip context. Must be cache hits (Prisma queries = slow).

**Cold Path:** Admin alerts query Prisma directly. Acceptable latency.

**Consistency:** Redis is **not authoritative**. Prisma is source of truth. Redis is optimized view for fast queries.

---

## 6. INTEGRATION POINTS

### 6.1 Fastify (Request/Response)

- `mobileRoute`, `adminRoute` middleware validate roles
- Zod schemas parse request bodies
- Rate limiting via `checkRateLimit`
- Idempotency plugin caches responses
- `request.id` used for distributed tracing

### 6.2 Prisma (Database)

- Transactional updates (upsert + increment atomicity)
- Relationships included (bus, route, driver)
- Event sourcing (attendanceEvent immutable table)
- Audit logging (before/after snapshots)

### 6.3 Redis (Cache & State)

- Active trip cache (hot check-in path)
- Dashboard stats (real-time counters)
- Delegation state (GPS layer coordination)
- Rate limiting buckets (warnings, push notifications)
- Locks (concurrent activation prevention)

### 6.4 Firebase (Realtime Coordination)

- Realtime DB: `/buses/{busId}` updated on delegation state change
- Mobile clients subscribe → instant UI update ("delegate now active")
- Cloud Messaging: Push notifications for warnings

### 6.5 Cloud Tasks (Deferred Jobs)

- Mark-absent jobs scheduled on trip end
- GPS outage two-phase window (self-report window → automatic mark-absent)
- Uses HTTP POST with signed secret header

### 6.6 Socket.io (Real-Time Broadcasting)

- `io.to('admin')` → all admin dashboards
- `io.to('route:X')` → coordinators for specific route
- `io.to('bus:X')` → all clients watching this bus
- Events: `trip:started`, `trip:ended`, `delegate:activated`, `delegation:ended`

### 6.7 Notifications Service (Multi-Channel)

- SMS + Push alerts for incidents
- Self-report prompts on GPS outage
- Delegate degradation warnings

---

## 7. DATA STRUCTURES

### 7.1 Trip Model

```
Trip {
  id              CUID
  date            ISO Date (YYYY-MM-DD in IST)
  status          SCHEDULED | ACTIVE | COMPLETED
  type            MORNING | RETURN
  busId           FK(Bus)
  routeId         FK(Route)
  driverId        FK(User/DRIVER)
  delegateId      FK(User) | NULL
  expectedCount   INT (students expected)
  boardedCount    INT (students checked in)
  
  startedAt       DateTime | NULL
  endedAt         DateTime | NULL
  gpsOutageStart  DateTime | NULL  (set when delegate activates)
}
```

### 7.2 Attendance Log (Current State)

```
AttendanceLog {
  id              CUID
  tripId          FK(Trip)
  userId          FK(User/STUDENT)
  busId           FK(Bus)
  routeId         FK(Route)
  
  date            ISO Date
  dateKey         String (for bucketing)
  status          PENDING | PRESENT | LATE_BOARD | MANUAL | ABSENT | EXCUSED
  method          QR | MANUAL_DRIVER | SELF_REPORT | SYSTEM
  
  checkedInAt     DateTime | NULL
  driverNote      String | NULL  (for manual marks)
  
  Unique: (userId, tripId)  // One record per student per trip
}
```

### 7.3 Attendance Event (Immutable Audit Trail)

```
AttendanceEvent {
  id              CUID
  attendanceId    FK(AttendanceLog)
  
  type            CHECK_IN | MANUAL_CORRECTION | EXCUSED | SYSTEM_CORRECTION
  method          QR | MANUAL_DRIVER | SELF_REPORT | SYSTEM_CORRECTION
  
  actorId         FK(User)
  previousStatus  String | NULL
  newStatus       String
  
  metadata        JSON  (context: note, reason, etc)
  createdAt       DateTime
}
```

### 7.4 Trip Delegate (Delegation Audit Trail)

```
TripDelegate {
  id              CUID
  tripId          FK(Trip)
  delegateId      FK(User)
  
  delegateType    'GPS' | 'KIOSK' | 'BOTH'
  status          PENDING | ACTIVE | ENDED | FAILED
  
  activationLat   Float
  activationLon   Float
  distanceFromBus INT (meters) | NULL
  activationMethod 'GEOFENCE' | 'ROUTE_ASSOCIATION'
  
  activatedAt     DateTime | NULL
  endedAt         DateTime | NULL
  endReason       String | NULL
  
  operationId     CUID (idempotency key)
}
```

---

## 8. ERROR HANDLING

### 8.1 Business Errors

```typescript
TRIP_NOT_FOUND         (400) → Trip ID doesn't exist
NOT_YOUR_TRIP          (403) → Driver ID mismatch
TRIP_CANNOT_START      (400) → Trip not in SCHEDULED state
TRIP_NOT_ACTIVE        (400) → Trip not in ACTIVE state
TRIP_NOT_FOUND         (400) → For trip ownership checks
```

### 8.2 Delegation Errors

```typescript
ROLE_NOT_AUTHORIZED    (403) → User is not STAFF/COORDINATOR/etc
BUS_GPS_NOT_OFFLINE    (400) → GPS is still online (no delegation needed)
DELEGATE_ALREADY_ACTIVE (409) → Another coordinator already delegating
NOT_NEAR_BUS           (403) → >200m away from bus
ACTIVATION_IN_PROGRESS (409) → Concurrent activation attempt
```

### 8.3 Error Response Format

```typescript
{
  success: false,
  error: {
    code: 'TRIP_NOT_FOUND',
    message: 'Trip not found',
    statusCode: 400,
    requestId: 'abc-123'  // For debugging
  }
}
```

---

## 9. KEY DESIGN PATTERNS

### 9.1 Idempotency
- Trip start/manual mark cached for 1 day
- Retry with same `Idempotency-Key` → cached response
- Prevents double-starts, duplicate marks

### 9.2 Atomic Transactions
- Upsert + increment in single transaction (manual mark)
- Trip status + delegation record updated atomically
- Prevents race conditions

### 9.3 Optimistic Locking
- `updateMany` with conditions (deleteId check during delegation)
- No explicit locks; conflicts detected and handled

### 9.4 Event Sourcing
- `AttendanceEvent` table tracks every change (immutable)
- Enables audit trails, state reconstruction, compliance

### 9.5 Rate Limiting
- Redis `SETNX` + expire for sliding windows
- Per-driver (trip starts), per-trip (warnings), per-window (escalations)

### 9.6 Eventual Consistency
- Prisma = source of truth
- Redis = optimized view (cache invalidation on mutation)
- Firebase = realtime projection (subscribe for instant updates)

### 9.7 Graceful Degradation
- GPS offline → delegate model activated
- Self-report window opens → fairness for dead phones
- Manual marks supported → dead phones handled

---

## 10. PERFORMANCE CHARACTERISTICS

### Check-In Hot Path (Per QR Scan)

```
Request: POST /v1/attendance/check-in
├─ Parse Zod schema (1ms)
├─ Redis get `active-trips` (2ms) ← cache hit
├─ Redis get `trip:X:state` (2ms) ← cache hit
├─ Rate limit check `rl:student:Y:tripId` (1ms)
├─ Redis GETDEL `qr:nonce:Z` (1ms) ← atomic nonce burn
├─ Prisma upsert + event (20-40ms)
└─ WebSocket emit (5ms)
Total: ~50-60ms per check-in
```

**Optimization:** Redis caching prevents Prisma query on every scan.

### Trip Start (During Peak)

```
Request: PATCH /v1/trips/X/start
├─ Prisma update + include (30-50ms)
├─ Redis setActiveTripCache (2ms)
├─ Redis admin stats update (3ms × 4 keys)
├─ Firebase update (50-100ms, async)
└─ WebSocket broadcast (5ms)
Total: ~150-200ms
```

**Expected QPS:** 50-100 trip starts during morning peak (30 mins).

### Delegation Activation

```
Request: POST /v1/trips/X/delegate/activate
├─ Eligibility checks (3 Prisma queries + Redis gets) (150ms)
├─ Atomic lock (2ms)
├─ Create audit record (20ms)
├─ Atomic transaction (30-50ms)
├─ Redis delegation state (2ms)
├─ Firebase update (50-100ms)
└─ WebSocket broadcast (5ms)
Total: ~250-350ms
```

---

## 11. KNOWN LIMITATIONS & TODOs

### 11.1 Missing Cloud Tasks Escalation

```typescript
// TODO: Enqueue Cloud Tasks job to escalate in +10 minutes if still REPORTED
console.log(`[Incidents] Incident ${incident.id} created — Cloud Tasks escalation job should fire here`);
```

Not implemented: Auto-escalation for unresolved incidents (admin should be notified after 10 mins).

### 11.2 No Typed Bus Assignment

```typescript
busAssignment: { select: { driverId: true } }
```

Should use explicit FK in Trip model instead of separate join table.

### 11.3 Delegation Timeout

12-hour TTL on delegation Redis key is safety net, but no active heartbeat monitoring. If delegate's app crashes, delegation continues until timeout.

---

## 12. TESTING CONSIDERATIONS

### Unit Tests (Service Layer)

```typescript
// Start trip: Verify ACTIVE state set + caches primed
// End trip: Verify caches cleared + Cloud Tasks fired
// Manual mark: Verify idempotent upsert + event sourced
// Delegation: Verify atomicity of role + GPS + trip checks
```

### Integration Tests (Routes + Service)

```typescript
// Trip start with rate limiting
// Manual mark with idempotency
// Delegation with concurrent activation attempts
// GPS outage two-phase window
```

### E2E Scenarios

```typescript
// Full trip lifecycle: SCHEDULED → ACTIVE → COMPLETED
// Delegation flow: Check → Activate → Warning → End
// Driver return detection: 2-ping threshold
```

---

## 13. SUMMARY TABLE

| Aspect | Implementation | Notes |
|--------|---|---|
| **State Machine** | SCHEDULED → ACTIVE → COMPLETED | Unidirectional, idempotent |
| **Caching** | Redis (active-trips, trip state, delegation) | Cache invalidation on mutations |
| **Consistency** | Eventual (Prisma = truth, Redis = view) | Works for read-heavy operations |
| **Concurrency** | Atomic transactions + optimistic locking | No pessimistic locks |
| **Events** | WebSocket broadcasts | Async, fire-and-forget |
| **Audit** | Event sourcing (immutable table) | Every attendance change logged |
| **Notifications** | BullMQ queue + Cloud Tasks | Deferred, scalable |
| **GPS Fallback** | Delegation model + self-report window | Two-phase, fair |
| **Rate Limiting** | Redis sliding windows | Per-driver, per-trip, per-window |
| **Error Mode** | Graceful degradation | Manual marks, self-reports available |

---

## 14. RECOMMENDED REFACTORING (Later Phase)

### Extract Repository Layer

```typescript
// trips.repository.ts (NEW)
class TripsRepository {
  async findActiveTrip(tripId)
  async updateTripStatus(tripId, status)
  async findScheduledTrips(date)
  async createAttendanceEvent(...)
}
```

### Extract Types File

```typescript
// trips.types.ts (NEW)
interface Trip { ... }
interface AttendanceLog { ... }
interface AttendanceEvent { ... }
interface TripDelegate { ... }
```

### Separate Delegate Service

```typescript
// trips/delegate.service.ts (ALREADY SEPARATED)
// delegate is independent; good extraction model
```

### Add Explicit Tests

```typescript
// trips.service.test.ts
// Test trip state transitions, cache consistency, delegation atomicity
```

---

**End of Audit**
