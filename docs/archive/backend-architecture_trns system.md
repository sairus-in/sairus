# College Bus Management System
# Backend Architecture — Complete Specification
# Organisational Level Design

> Single college deployment. 3,000–6,000 students. Morning peak 7am–9:30am.
> Attendance reported to university board — data integrity is non-negotiable.
> Paper fallback exists — 99.5% uptime target during morning window.

---

## Table of Contents

1. [Architecture Philosophy](#1-architecture-philosophy)
2. [Service Boundary Decision](#2-service-boundary-decision)
3. [Module Structure](#3-module-structure)
4. [Database Strategy](#4-database-strategy)
5. [Caching Strategy](#5-caching-strategy)
6. [The 6 Background Jobs](#6-the-6-background-jobs)
7. [API Design Principles](#7-api-design-principles)
8. [Reliability and Failure Handling](#8-reliability-and-failure-handling)
9. [Security Model](#9-security-model)
10. [Observability](#10-observability)
11. [Infrastructure Configuration](#11-infrastructure-configuration)
12. [Build Rules for Claude Code](#12-build-rules)

---

## 1. Architecture Philosophy

### The load reality

```
Students:              3,000 – 6,000
Buses:                 ~180
Morning peak:          7:00am – 9:30am (2.5 hours)
Peak req/sec:          ~70–80 at absolute maximum
  GPS pings:           180 buses × 1 ping/3s = 60 req/sec (sustained)
  Check-ins:           ~5000 over 60 min = ~1.4 req/sec
  Home BFF calls:      ~6000 over 30 min = ~3.3 req/sec
  Admin panel:         ~20 coordinators, polling + socket = ~5 req/sec
  Total peak:          ~70 req/sec

Off-peak load:         Near zero (21 of 24 hours)
```

70–80 req/sec is a small system. PostgreSQL handles 1000+ req/sec.
Redis handles 100,000+ req/sec. Cloud Run handles this on 2 instances.

### The non-negotiables

```
1. Data integrity above everything
   Attendance is reported to a university board.
   A corrupted or missing attendance record is not a bug — it's a liability.
   Every attendance write is transactional. Audit trail is permanent.

2. Morning window reliability
   If the system fails at 8am, 6000 students are affected.
   Paper fallback exists but it's painful.
   Target: 99.5% uptime during morning window = <45s downtime per morning.

3. Graceful degradation over hard failure
   If Redis is slow: fall through to PostgreSQL (slower but correct)
   If GPS fails: show last known position, not an error
   If check-in fails: queue offline, sync on reconnect
   The system should never force a student to stand at a bus stop with a broken app
```

---

## 2. Service Boundary Decision

**Single Fastify monolith. Not microservices.**

### Why not microservices

```
What microservices would add:
  Network latency between services on the check-in hot path
  Service discovery and routing complexity
  Distributed tracing to debug cross-service failures
  Multiple Docker images and Cloud Run services to manage
  Authentication between services
  Eventual consistency problems on attendance records

What microservices would give you at this scale:
  Independent scaling per service
  → But GPS and attendance both peak at the same time (morning)
     so independent scaling provides zero benefit

  Team isolation
  → Single developer. No teams to isolate.

  Independent deployment
  → One developer deploying one service is already fast.
     Coordinating 5 service deployments would be slower.
```

### What monolith gives you

```
Single deployment → one Docker image, one Cloud Run service
Direct function calls between modules → no network latency
Shared database connection pool → no connection multiplier
Shared Redis client → no reconnection overhead
Single log stream → easy to trace a request end-to-end
Single health check → simple uptime monitoring
```

**Rule: split into services only when a specific module is causing problems
that cannot be solved within a monolith. Don't start there.**

### Module boundaries within the monolith

Modules are written as if they could be extracted later.
Each module has its own routes, service, and database access.
Modules communicate via service function calls — never via direct DB queries
into another module's tables.

```
Module A needs data owned by Module B:
  CORRECT: call B's service function → B queries its own tables
  WRONG:   query B's tables directly from A's service
```

---

## 3. Module Structure

```
apps/backend/src/
│
├── modules/
│   ├── auth/
│   │   ├── auth.routes.ts        ← POST /v1/auth/login, /refresh, /logout
│   │   ├── auth.service.ts       ← Firebase token verify, JWT issuance
│   │   └── auth.schema.ts        ← Zod request/response schemas
│   │
│   ├── attendance/
│   │   ├── attendance.routes.ts
│   │   ├── attendance.service.ts ← check-in 13-step, corrections, arrival verify
│   │   └── attendance.schema.ts
│   │
│   ├── gps/
│   │   ├── gps.routes.ts
│   │   ├── gps.service.ts        ← ping processing, heartbeat, source validation
│   │   └── gps.schema.ts
│   │
│   ├── trips/
│   │   ├── trips.routes.ts
│   │   ├── trips.service.ts      ← trip lifecycle, start, end, substitutes, delegates
│   │   └── trips.schema.ts
│   │
│   ├── routes/
│   │   ├── routes.routes.ts
│   │   ├── routes.service.ts     ← route and stop management
│   │   └── routes.schema.ts
│   │
│   ├── users/
│   │   ├── users.routes.ts
│   │   ├── users.service.ts      ← student, driver, staff management, serializers
│   │   └── users.schema.ts
│   │
│   ├── admin/
│   │   ├── admin.routes.ts
│   │   ├── admin.service.ts      ← live dashboard, fleet status, bulk operations
│   │   └── admin.schema.ts
│   │
│   ├── notifications/
│   │   ├── notifications.service.ts ← FCM dispatch, EN/TA templates
│   │   └── templates/
│   │       ├── en.ts
│   │       └── ta.ts
│   │
│   ├── incidents/
│   │   ├── incidents.routes.ts
│   │   └── incidents.service.ts
│   │
│   └── messages/
│       ├── messages.routes.ts
│       └── messages.service.ts
│
├── jobs/
│   ├── jobs.routes.ts            ← registers all job endpoints under /v1/jobs/*
│   ├── create-daily-trips.job.ts
│   ├── mark-absent.job.ts
│   ├── gps-heartbeat.job.ts
│   ├── late-start-alert.job.ts
│   ├── arrival-push-fallback.job.ts
│   ├── gps-cleanup.job.ts
│   ├── gps-outage-absent.job.ts  ← Phase 2: 2-hour window for GPS outage absences
│   └── provision-firebase.job.ts ← Phase D: two-step auth provisioning
│
├── middleware/
│   ├── auth.middleware.ts        ← JWT verification, attach req.user
│   ├── role.middleware.ts        ← role guard factory: roleGuard(['COORDINATOR'])
│   ├── rate-limit.middleware.ts  ← Redis sliding window rate limiter
│   ├── scope.middleware.ts       ← coordinator route scoping
│   ├── cloud-task.middleware.ts  ← verify X-CloudTasks-QueueName header
│   └── request-log.middleware.ts ← structured JSON logging per request
│
├── lib/
│   ├── prisma.ts                 ← PrismaClient singleton
│   ├── redis.ts                  ← Upstash Redis client singleton
│   ├── firebase.ts               ← Firebase Admin SDK singleton
│   ├── firebase-rtdb.ts          ← Firebase RTDB reference helper
│   ├── socket.ts                 ← Socket.io server instance
│   ├── jobs.ts                   ← dispatchJob() helper for Cloud Tasks
│   └── logger.ts                 ← Pino structured logger
│
├── app.ts                        ← Fastify app factory, plugin registration
├── server.ts                     ← HTTP server entry point
└── constants.ts                  ← re-export from packages/shared
```

---

## 4. Database Strategy

### Connection pooling

```typescript
// lib/prisma.ts
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    }
  },
  // Cloud Run: each instance gets max 5 connections
  // With min-instances=2: 10 connections always open
  // With max-instances=10: up to 50 connections at peak
  // PostgreSQL limit: 100 connections (well within safe range)
})

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect()
})

export { prisma }
```

### The 6 critical indexes

These must exist before the first morning run.
Add them to the initial Prisma migration.

```sql
-- 1. Check-in hot path: student's active route assignment
-- Used by: every check-in, every /student/home call
CREATE INDEX idx_route_assignments_user_active
  ON route_assignments(user_id)
  WHERE is_active = true;

-- 2. Trip lookup: today's active trip for a bus
-- Used by: check-in validation, driver pre-trip screen
CREATE INDEX idx_trips_date_bus_status
  ON trips(date, bus_id, status);

-- 3. Attendance log: today's record for a student
-- Used by: check-in idempotency check, /student/home
CREATE INDEX idx_attendance_logs_user_trip
  ON attendance_logs(user_id, trip_id);

-- 4. Correction queue: coordinator's daily workflow
-- Partial index — only indexes PENDING rows (most queries filter by this)
CREATE INDEX idx_corrections_status_created
  ON attendance_corrections(status, created_at DESC)
  WHERE status = 'PENDING';

-- 5. GPS logs: time-based queries and nightly cleanup
-- Used by: gps-cleanup.job.ts (30-day retention)
CREATE INDEX idx_gps_logs_timestamp
  ON gps_logs(timestamp DESC);

-- 6. Student search: admin panel full-text search
-- Used by: /v1/users?search=priya
CREATE INDEX idx_users_search
  ON users USING gin(
    to_tsvector('simple', name || ' ' || roll_number)
  )
  WHERE role = 'STUDENT' AND is_active = true;
```

### What belongs in PostgreSQL vs Redis

```
PostgreSQL — durable truth, survives any restart:
  All attendance records (AttendanceLog, AttendanceEvent)
  All user accounts (User)
  All route assignments (RouteAssignment + history)
  All trip records (Trip)
  All GPS logs (GpsLog — 30-day retention, then cleaned)
  All correction requests (AttendanceCorrection)
  All incident reports (Incident)
  All import sessions (ImportSession, ImportRow)
  All route stop change logs (RouteStopChangeLog)
  All trip delegates (TripDelegate)
  All messages (Message)

Redis — live operational state, reconstructable or expires naturally:
  trip:{id}:state         → boardedCount, gpsStatus, delegateId
  gps:heartbeat:{busId}   → last ping timestamp (TTL 120s, auto-expires)
  gps:status:{busId}      → LIVE | STALE | OFFLINE
  qr:nonce:{nonce}        → trip + bus reference (TTL 40s, auto-expires)
  checkin:ratelimit:{uid} → sliding window counter (TTL 60s, auto-expires)
  dashboard:stats         → activeTrips, checkedIn, gpsOffline, openCorrections
  active-trips            → Set of currently active tripIds
  user:{id}:assignment    → cached route assignment (TTL 5min)
  home:{userId}           → cached /student/home response (TTL 60s)
  trip:delegate:{tripId}  → active delegate info
  admin:alerts            → sorted set of pending alerts

Rule: if losing this data on a Redis restart would break business logic
or corrupt attendance records → PostgreSQL.
If it expires naturally, can be reconstructed, or is purely operational → Redis.
```

### Redis startup seeding

On every server start, verify Redis has the required operational state.
If Redis was restarted, rebuild from PostgreSQL.

```typescript
// app.ts — on startup
export const seedRedisOnStartup = async () => {
  // Dashboard stats — rebuild from DB if missing
  const exists = await redis.exists('dashboard:stats')
  if (!exists) {
    const [activeTrips, checkedIn, gpsOffline, openCorrections] = await Promise.all([
      prisma.trip.count({ where: { status: 'ACTIVE', date: getTodayDateKey() } }),
      prisma.attendanceLog.count({
        where: { status: 'PRESENT', trip: { date: getTodayDateKey() } }
      }),
      0,  // will be populated as GPS pings arrive
      prisma.attendanceCorrection.count({ where: { status: 'PENDING' } }),
    ])
    await redis.hset('dashboard:stats', { activeTrips, checkedIn, gpsOffline, openCorrections })
  }

  // Active trips set — rebuild from DB if missing
  const activeTripsExist = await redis.exists('active-trips')
  if (!activeTripsExist) {
    const activeTrips = await prisma.trip.findMany({
      where: { status: 'ACTIVE', date: getTodayDateKey() },
      select: { id: true }
    })
    if (activeTrips.length > 0) {
      await redis.sadd('active-trips', ...activeTrips.map(t => t.id))
    }
  }

  logger.info({ event: 'redis_seeded_on_startup' })
}
```

---

## 5. Caching Strategy

### Write-through caching on the check-in hot path

The check-in is the most performance-sensitive operation.
Every cache write happens in parallel with the DB transaction.

```typescript
// attendance.service.ts — processCheckin()

const startTime = Date.now()

// Step 1: Redis rate limit (< 1ms)
const rateKey = `checkin:ratelimit:${userId}`
const count = await redis.incr(rateKey)
if (count === 1) await redis.expire(rateKey, 60)
if (count > 3) throw new RateLimitError()

// Step 2: Atomic nonce burn (< 1ms)
const nonceData = await redis.getdel(`qr:nonce:${nonce}`)
if (!nonceData) throw new QRAlreadyUsedError()

// Step 3: Route assignment from cache (< 1ms on hit, ~10ms on miss)
let assignment = await redis.get(`user:${userId}:assignment`)
if (!assignment) {
  const dbAssignment = await prisma.routeAssignment.findFirst({
    where: { userId, isActive: true },
    include: { route: true, stop: true }
  })
  assignment = JSON.stringify(dbAssignment)
  await redis.setex(`user:${userId}:assignment`, 300, assignment)  // 5min TTL
}

// Step 4: Single PostgreSQL transaction (5-20ms with indexes)
await prisma.$transaction([
  prisma.attendanceLog.upsert({ ... }),
  prisma.attendanceEvent.create({ ... }),
  prisma.trip.update({ where: { id: tripId }, data: { boardedCount: { increment: 1 } } })
])

// Step 5: Write-through to Redis (< 1ms, all in parallel)
await Promise.all([
  redis.hincrby(`trip:${tripId}:state`, 'boardedCount', 1),
  redis.hincrby('dashboard:stats', 'checkedIn', 1),
])

// Step 6: Socket emit (fire and forget — don't await)
io.to(`trip:${tripId}`).emit('checkin:success', { userId, name, status, checkedInAt })
io.to('admin').emit('checkin:success', { tripId, userId, name, status })

// Step 7: Structured log
logger.info({
  event: 'checkin_success',
  requestId: req.id,
  userId, tripId, busId,
  geofenceResult, distanceToBus, distanceToStop,
  durationMs: Date.now() - startTime,
})

// Total path time: ~25-30ms
// PostgreSQL is the only variable — indexes keep it fast
```

### Cache invalidation rules

```typescript
// When a route assignment changes (reassign student):
await redis.del(`user:${userId}:assignment`)
await redis.del(`home:${userId}`)

// When a trip starts:
await redis.sadd('active-trips', tripId)
await redis.hincrby('dashboard:stats', 'activeTrips', 1)
await redis.hset(`trip:${tripId}:state`, {
  status: 'ACTIVE', boardedCount: 0, gpsStatus: 'LIVE',
  startedAt: Date.now(), busNumber, routeName, driverName, expectedCount
})

// When a trip ends:
await redis.srem('active-trips', tripId)
await redis.hincrby('dashboard:stats', 'activeTrips', -1)
await redis.del(`trip:${tripId}:state`)

// When a correction is reviewed:
await redis.hincrby('dashboard:stats', 'openCorrections', -1)

// When GPS goes OFFLINE:
await redis.hset(`trip:${tripId}:state`, 'gpsStatus', 'OFFLINE')
await redis.hincrby('dashboard:stats', 'gpsOffline', 1)

// When GPS recovers from OFFLINE:
await redis.hset(`trip:${tripId}:state`, 'gpsStatus', 'LIVE')
await redis.hincrby('dashboard:stats', 'gpsOffline', -1)
```

---

## 6. The 6 Background Jobs

### Job infrastructure

All jobs are HTTP endpoints. Cloud Tasks calls them. They run inside the
same Fastify process as all other routes. No separate job worker needed.

```typescript
// lib/jobs.ts — central dispatch helper
import { CloudTasksClient } from '@google-cloud/tasks'

const client = new CloudTasksClient()

const QUEUE_PATH = `projects/${process.env.GCP_PROJECT_ID}/locations/${process.env.GCP_LOCATION}/queues/${process.env.CLOUD_TASKS_QUEUE}`
const BASE_URL = process.env.BACKEND_URL

export const dispatchJob = async (
  jobName: string,
  body: object = {},
  delaySeconds = 0
): Promise<void> => {
  const scheduleTime = delaySeconds > 0
    ? { seconds: Math.floor(Date.now() / 1000) + delaySeconds }
    : undefined

  await client.createTask({
    parent: QUEUE_PATH,
    task: {
      httpRequest: {
        httpMethod: 'POST',
        url: `${BASE_URL}/v1/jobs/${jobName}`,
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(JSON.stringify(body)).toString('base64'),
        oidcToken: {
          serviceAccountEmail: process.env.CLOUD_TASKS_SA_EMAIL,
        },
      },
      ...(scheduleTime && { scheduleTime }),
    },
  })
}

// Usage:
await dispatchJob('mark-absent', { tripId })
await dispatchJob('late-start-alert', { tripId }, 600)       // 10 min
await dispatchJob('arrival-push-fallback', { tripId }, 120)  // 2 min
```

### Job security middleware

```typescript
// middleware/cloud-task.middleware.ts
export const verifyCloudTask = async (req: FastifyRequest, reply: FastifyReply) => {
  const queueName = req.headers['x-cloudtasks-queuename'] as string
  if (!queueName || !queueName.includes(process.env.CLOUD_TASKS_QUEUE!)) {
    reply.code(403).send({ error: 'FORBIDDEN' })
    return
  }
}
// Applied to ALL routes under /v1/jobs/*
```

### Job 1 — create-daily-trips

```typescript
// jobs/create-daily-trips.job.ts
// Triggered: Cloud Scheduler at 11:00pm IST daily
// Duration:  ~5 seconds (180 buses)
// Idempotent: yes

export const createDailyTrips = async () => {
  const tomorrow = getTomorrowDateKey()  // "YYYY-MM-DD" in IST

  const assignments = await prisma.busAssignment.findMany({
    where: { isActive: true },
    include: { bus: true, route: true, driver: true }
  })

  let created = 0
  let skipped = 0

  for (const assignment of assignments) {
    // Check if tomorrow is an active day for this route
    const tomorrowDay = getDayOfWeek(tomorrow)  // 'MONDAY' etc.
    if (!assignment.route.activeDays.includes(tomorrowDay)) {
      skipped++
      continue
    }

    // Idempotency: skip if trip already exists
    const existing = await prisma.trip.findFirst({
      where: { busId: assignment.busId, date: tomorrow, type: 'MORNING' }
    })
    if (existing) { skipped++; continue }

    // Create trip
    const trip = await prisma.trip.create({
      data: {
        status: 'SCHEDULED',
        date: tomorrow,
        type: 'MORNING',
        busId: assignment.busId,
        routeId: assignment.routeId,
        driverId: assignment.driverId,
        expectedCount: await getRouteStudentCount(assignment.routeId),
      }
    })

    // Schedule late-start alert for 10 min after departure
    const scheduledDeparture = getFirstStopTime(assignment.route)
    const alertDelay = scheduledDeparture + (10 * 60)  // seconds from now
    await dispatchJob('late-start-alert', { tripId: trip.id }, alertDelay)

    created++
  }

  logger.info({
    event: 'daily_trips_created',
    date: tomorrow, created, skipped,
    totalAssignments: assignments.length,
  })
}
```

### Job 2 — mark-absent

```typescript
// jobs/mark-absent.job.ts
// Triggered: by trips.service.ts when trip ends
// Body: { tripId }
// Duration: ~2 seconds
// Idempotent: yes

export const markAbsent = async ({ tripId }: { tripId: string }) => {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { status: true, gpsOutageStart: true }
  })

  if (!trip || trip.status !== 'COMPLETED') {
    logger.warn({ event: 'mark_absent_skipped', tripId, reason: 'Trip not completed' })
    return
  }

  // GPS outage: 2-hour PENDING window instead of immediate absent marking
  if (trip.gpsOutageStart) {
    await cloudTasks.createTask({
      scheduleTime: { seconds: Math.floor(Date.now() / 1000) + 2 * 60 * 60 },
      httpRequest: { url: `${BASE_URL}/v1/jobs/gps-outage-absent`, body: { tripId } }
    })
    await redis.setex(`trip:outage-window:${tripId}`, 3 * 60 * 60, '1')
    logger.info({ event: 'mark_absent_deferred_gps_outage', tripId })
    return
  }

  // Normal path: mark all PENDING as ABSENT immediately
  const result = await prisma.attendanceLog.updateMany({
    where: { tripId, status: 'PENDING' },
    data: { status: 'ABSENT' }
  })

  // Create AttendanceEvents for each
  const absentLogs = await prisma.attendanceLog.findMany({
    where: { tripId, status: 'ABSENT' },
    select: { id: true, userId: true }
  })

  await prisma.attendanceEvent.createMany({
    data: absentLogs.map(log => ({
      attendanceId: log.id,
      type: 'TRIP_END_ABSENT',
      method: 'SYSTEM_AUTO',
      actorId: 'system',
      previousStatus: 'PENDING',
      newStatus: 'ABSENT',
    }))
  })

  logger.info({ event: 'mark_absent_complete', tripId, markedCount: result.count })
}
```

### Job 3 — gps-heartbeat-check

```typescript
// jobs/gps-heartbeat.job.ts
// Triggered: Cloud Scheduler every 60 seconds
// Duration: ~1 second (Redis reads only)
// Idempotent: yes

export const gpsHeartbeatCheck = async () => {
  const activeTripIds = await redis.smembers('active-trips')

  for (const tripId of activeTripIds) {
    const tripState = await redis.hgetall(`trip:${tripId}:state`)
    if (!tripState) continue

    const busId = tripState.busId
    const lastHeartbeat = await redis.get(`gps:heartbeat:${busId}`)
    const prevStatus = await redis.get(`gps:status:${busId}`) ?? 'LIVE'
    const age = lastHeartbeat ? Date.now() - Number(lastHeartbeat) : Infinity

    const newStatus =
      age < 20_000  ? 'LIVE' :
      age < 90_000  ? 'STALE' :
      'OFFLINE'

    // Only act on status transitions — not on every check
    if (newStatus === prevStatus) continue

    await redis.set(`gps:status:${busId}`, newStatus)

    // Update Firebase
    await firebaseRTDB.ref(`/buses/${busId}/gpsStatus`).set(newStatus)

    // Socket emit to admin room and bus room
    io.to('admin').emit('gps:status', { busId, tripId, status: newStatus })
    io.to(`bus:${busId}`).emit('gps:status', { status: newStatus })

    // Handle OFFLINE transition specifically
    if (newStatus === 'OFFLINE' && prevStatus !== 'OFFLINE') {
      await redis.hincrby('dashboard:stats', 'gpsOffline', 1)

      // Add to admin alerts
      await redis.zadd('admin:alerts', Date.now(), JSON.stringify({
        type: 'GPS_OFFLINE', tripId, busId, timestamp: Date.now()
      }))

      // Schedule delegate escalation (5 min)
      const escalationScheduled = await redis.setnx(
        `gps:outage:escalation:scheduled:${tripId}`, '1'
      )
      if (escalationScheduled) {
        await redis.expire(`gps:outage:escalation:scheduled:${tripId}`, 60 * 60)
        await dispatchJob('gps-outage-escalation', { tripId, busId }, 5 * 60)
      }
    }

    // Handle recovery from OFFLINE
    if (prevStatus === 'OFFLINE' && newStatus !== 'OFFLINE') {
      await redis.hincrby('dashboard:stats', 'gpsOffline', -1)
    }

    logger.info({
      event: 'gps_status_transition',
      busId, tripId, from: prevStatus, to: newStatus, age
    })
  }
}
```

### Job 4 — late-start-alert

```typescript
// jobs/late-start-alert.job.ts
// Triggered: dispatched during trip creation with delay
// Body: { tripId }
// Duration: <1 second
// Idempotent: yes

export const lateStartAlert = async ({ tripId }: { tripId: string }) => {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: { bus: true, route: true, driver: true }
  })

  if (!trip) return

  // Already started — no alert needed
  if (trip.status === 'ACTIVE' || trip.status === 'COMPLETED') {
    logger.info({ event: 'late_start_alert_skipped', tripId, reason: 'Already started' })
    return
  }

  const minutesLate = calculateMinutesLate(trip)

  // Alert driver via FCM
  await notificationsService.send(trip.driver.id, {
    type: 'LATE_START_DRIVER',
    titleKey: 'notification.lateStart.driver.title',
    bodyKey: 'notification.lateStart.driver.body',
    data: { tripId, minutesLate: String(minutesLate) },
  })

  // Alert coordinators via socket
  io.to('admin').emit('trip:late-start', {
    tripId,
    busNumber: trip.bus.busNumber,
    routeName: trip.route.name,
    minutesLate,
    scheduledDeparture: trip.scheduledDeparture,
  })

  // Add to admin alerts
  await redis.zadd('admin:alerts', Date.now() + 100, JSON.stringify({
    type: 'LATE_START',
    tripId,
    busNumber: trip.bus.busNumber,
    minutesLate,
    timestamp: Date.now(),
  }))

  logger.info({ event: 'late_start_alert_fired', tripId, minutesLate })
}
```

### Job 5 — arrival-push-fallback

```typescript
// jobs/arrival-push-fallback.job.ts
// Triggered: 2 minutes after bus hits college gate geofence
// Body: { tripId }
// Duration: ~3 seconds (FCM batch)
// Idempotent: yes (Redis key guards against duplicate sends)

export const arrivalPushFallback = async ({ tripId }: { tripId: string }) => {
  // Idempotency: already sent FCM for this arrival
  const alreadySent = await redis.get(`arrival:fcm:sent:${tripId}`)
  if (alreadySent) return

  // Get students who haven't had arrival verification
  const unverifiedLogs = await prisma.attendanceLog.findMany({
    where: {
      tripId,
      status: 'PRESENT',
      arrivalVerified: null,  // not yet verified
    },
    include: { user: { select: { id: true, fcmToken: true } } }
  })

  if (unverifiedLogs.length === 0) return

  // Send FCM to each unverified student
  const notifications = unverifiedLogs
    .filter(log => log.user.fcmToken)
    .map(log => notificationsService.send(log.user.id, {
      type: 'ARRIVAL_VERIFY',
      titleKey: 'notification.arrivalVerify.title',
      bodyKey: 'notification.arrivalVerify.body',
      data: { screen: '/verify-arrival', tripId },
    }))

  await Promise.allSettled(notifications)

  // Mark as sent
  await redis.setex(`arrival:fcm:sent:${tripId}`, 6 * 60 * 60, '1')

  logger.info({
    event: 'arrival_push_fallback_sent',
    tripId,
    studentCount: unverifiedLogs.length,
  })
}
```

### Job 6 — gps-cleanup

```typescript
// jobs/gps-cleanup.job.ts
// Triggered: Cloud Scheduler at 1:00am IST daily
// Duration: 5-30 seconds (depends on GPS log volume)
// Idempotent: yes

export const gpsCleanup = async () => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  // Delete in batches to avoid locking the table
  let totalDeleted = 0
  const BATCH_SIZE = 10_000

  while (true) {
    const result = await prisma.$executeRaw`
      DELETE FROM gps_logs
      WHERE id IN (
        SELECT id FROM gps_logs
        WHERE timestamp < ${thirtyDaysAgo}
        LIMIT ${BATCH_SIZE}
      )
    `
    totalDeleted += result
    if (result < BATCH_SIZE) break  // no more rows to delete
    await new Promise(resolve => setTimeout(resolve, 100))  // brief pause between batches
  }

  logger.info({ event: 'gps_cleanup_complete', deletedCount: totalDeleted, cutoff: thirtyDaysAgo })
}
```

### Cloud Scheduler configuration

```yaml
# Configured in GCP Console or via Terraform

# 11pm IST daily — trip pre-creation
create-daily-trips:
  schedule: "30 17 * * *"  # 17:30 UTC = 23:00 IST
  timeZone: "Asia/Kolkata"
  target: Cloud Tasks queue (not direct HTTP)
  body: {}

# Every 60 seconds — GPS heartbeat
gps-heartbeat-check:
  schedule: "* * * * *"  # every minute
  target: Cloud Tasks queue
  body: {}

# 1am IST daily — GPS cleanup
gps-cleanup:
  schedule: "30 19 * * *"  # 19:30 UTC = 01:00 IST
  target: Cloud Tasks queue
  body: {}
```

---

## 7. API Design Principles

### Request/response contract

Every endpoint uses Zod schemas for both request validation and response shape.
Never trust unvalidated input. Never return unshapen output.

```typescript
// Pattern applied to every route
fastify.post('/v1/attendance/checkin', {
  preHandler: [authMiddleware, rateLimitMiddleware],
  schema: {
    body: CheckinRequestSchema,    // Zod → validates incoming request
    response: {
      201: CheckinResponseSchema,  // Zod → shapes outgoing response
      400: ErrorResponseSchema,
      429: RateLimitResponseSchema,
    }
  }
}, async (req, reply) => {
  // req.body is fully typed and validated
  // reply.send() is type-checked against response schema
})
```

### Error response contract

Every error response has the same shape. Mobile app and admin panel
map error codes to user-facing messages. Never expose internal errors.

```typescript
// Standard error response shape
interface ErrorResponse {
  error: string       // machine-readable code: 'QR_EXPIRED', 'RATE_LIMITED'
  message: string     // human-readable (for logging only — never shown to users)
  requestId: string   // for support debugging
}

// Error code → user-facing message mapping is in packages/shared
// Backend returns error codes. Frontend translates them.
```

### Idempotency on mutations

Every mutation that can be retried (check-in, attendance corrections,
bulk operations) must be idempotent.

```typescript
// Check-in idempotency: if already checked in, return 200 (not error)
const existing = await prisma.attendanceLog.findUnique({
  where: { userId_tripId: { userId, tripId } }
})
if (existing) {
  return reply.code(200).send({
    status: 'ALREADY_CHECKED_IN',
    checkedInAt: existing.checkedInAt,
  })
}

// Bulk operations: check operationId before processing
const existing = await redis.get(`operation:${operationId}`)
if (existing) return reply.send(JSON.parse(existing))  // return cached result
```

### Pagination on all list endpoints

No endpoint returns an unbounded list.
Default page size: 20. Maximum: 100.

```typescript
const { page = 1, limit = 20 } = req.query
const safeLimit = Math.min(limit, 100)
const offset = (page - 1) * safeLimit

const [data, total] = await Promise.all([
  prisma.attendanceCorrection.findMany({
    skip: offset, take: safeLimit,
    orderBy: { createdAt: 'desc' },
  }),
  prisma.attendanceCorrection.count(),
])

return { data, pagination: { page, limit: safeLimit, total, pages: Math.ceil(total / safeLimit) } }
```

---

## 8. Reliability and Failure Handling

### Uptime target

```
Target: 99.5% uptime during morning window (7am – 9:30am IST)
Meaning: < 45 seconds average downtime per morning
Achievable with: min-instances=2 Cloud Run (no cold starts)

What happens during the ~45 seconds if there IS a failure:
  Cloud Run restarts the instance automatically (usually 10-15 seconds)
  Second instance continues serving (load balanced)
  Students see brief delays, not complete failure
  Paper fallback is available for coordinators if needed
```

### Graceful degradation — what degrades and how

```
If Redis is unavailable:
  Check-in: fall through to PostgreSQL for nonce check (slower but correct)
  Dashboard: fetch stats from PostgreSQL (slower query, same data)
  GPS heartbeat: GPS status unknown (not OFFLINE) — no false delegate alerts
  Rate limiting: disabled temporarily (acceptable risk for a few minutes)
  Health check: returns 503 — Cloud Run stops routing to this instance

If Firebase RTDB is unavailable:
  GPS positions not updating for students
  Students see "GPS temporarily unavailable" (last known position)
  Coordinators see same on fleet map
  Check-in still works (Firebase not in check-in path)
  Health check: returns degraded (200 with warning, not 503)
  Operational but limited

If Cloud Tasks is unavailable:
  Background jobs queue up and retry when available
  Jobs are delayed but not lost (Cloud Tasks persists the queue)
  No immediate impact on check-in or GPS
  Trip pre-creation at 11pm may be delayed — alert if this happens

If PostgreSQL is unavailable:
  Everything stops — PostgreSQL is truth
  Health check returns 503 — Cloud Run stops routing
  Paper fallback activates
  PostgreSQL recovery is highest priority
```

### Production health endpoint

```typescript
// GET /v1/health
// Used by Cloud Run health checks and UptimeRobot
// Must return 503 if DB or Redis is unavailable

fastify.get('/v1/health', async (req, reply) => {
  const [dbCheck, redisCheck] = await Promise.allSettled([
    prisma.$queryRaw`SELECT 1` as Promise<any>,
    redis.ping(),
  ])

  const checks = {
    database: dbCheck.status === 'fulfilled' ? 'ok' : 'fail',
    redis: redisCheck.status === 'fulfilled' ? 'ok' : 'fail',
  }

  const isHealthy = checks.database === 'ok' && checks.redis === 'ok'
  const isDegraded = checks.database === 'ok' && checks.redis === 'fail'

  reply.code(isHealthy ? 200 : isDegraded ? 200 : 503).send({
    status: isHealthy ? 'ok' : isDegraded ? 'degraded' : 'unhealthy',
    timestamp: new Date().toISOString(),
    checks,
  })
})
```

### Request timeout configuration

```typescript
const server = Fastify({
  connectionTimeout: 10_000,   // 10s max to establish connection
  requestTimeout: 8_000,        // 8s max to handle a request
  logger: pinoLogger,
})

// If the database is slow (>8s), return 503 instead of hanging
// Mobile app offline queue catches 503 and retries
// This prevents cascading failures when DB is under load
```

---

## 9. Security Model

### JWT structure

```typescript
// JWT payload issued by backend after Firebase verification
interface JWTPayload {
  sub: string      // userId (our DB id, not Firebase uid)
  role: string     // STUDENT | DRIVER | COORDINATOR | TRANSPORT_OFFICER | ...
  deviceId: string // hashed device identifier
  iat: number
  exp: number      // 7 days
}
```

### Middleware stack (applied in order)

```typescript
// Every protected route goes through:
[
  authMiddleware,      // 1. Verify JWT, attach req.user
  rateLimitMiddleware, // 2. Per-user rate limit (varies by endpoint)
  scopeMiddleware,     // 3. Coordinator route scoping (if applicable)
]

// Job endpoints:
[
  verifyCloudTask,     // Verify Cloud Tasks header — no JWT needed
]
```

### Rate limiting by endpoint

```typescript
const RATE_LIMITS = {
  'POST /v1/attendance/checkin':         { max: 3,  windowSeconds: 60  },
  'POST /v1/auth/login':                 { max: 5,  windowSeconds: 60  },
  'POST /v1/attendance/verify-arrival':  { max: 3,  windowSeconds: 300 },
  'POST /v1/attendance/self-report':     { max: 1,  windowSeconds: 3600 },
  'GET /v1/student/home':               { max: 30, windowSeconds: 60  },
}

// Redis sliding window implementation
const checkRateLimit = async (userId: string, endpoint: string): Promise<void> => {
  const config = RATE_LIMITS[endpoint]
  if (!config) return  // no limit for this endpoint

  const key = `ratelimit:${userId}:${endpoint.replace(/\//g, ':')}`
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, config.windowSeconds)
  if (count > config.max) throw new RateLimitError(config.windowSeconds)
}
```

### Device ID enforcement

```typescript
// On check-in: verify request is from the registered device
// Prevents one student from checking in from a different phone

const { deviceId } = req.user  // from JWT

// Compare against registered device in DB
const user = await prisma.user.findUnique({
  where: { id: req.user.sub },
  select: { registeredDeviceId: true }
})

if (user.registeredDeviceId && user.registeredDeviceId !== deviceId) {
  throw new DeviceMismatchError()
}
```

---

## 10. Observability

### Structured logging — every request

```typescript
// lib/logger.ts
import pino from 'pino'

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
  // GCP Cloud Logging expects JSON with 'severity' field
  mixin: () => ({
    service: 'bus-backend',
    version: process.env.K_REVISION ?? 'local',
  }),
})
```

### The check-in log — most important log line in the system

```typescript
// Log on every check-in attempt (success AND failure)
logger.info({
  event: 'checkin_attempt',
  requestId: req.id,
  userId,
  tripId,
  busId,
  result: 'SUCCESS' | 'ALREADY_CHECKED_IN' | 'FAIL' | 'QUEUED_OFFLINE',
  failReason: reason ?? null,
  distanceToBus: Math.round(distanceToBus),
  distanceToStop: Math.round(distanceToStop),
  geofenceResult: 'PRESENT' | 'LATE_BOARD' | 'TOO_FAR',
  isReplay: req.body.isReplay ?? false,
  durationMs: Date.now() - startTime,
})

// This log answers every support question:
// "Why was student X marked absent?" → search userId → see fail reason
// "Why is check-in slow today?" → see durationMs spike → DB issue
// "Did the offline queue replay work?" → see isReplay: true + result
```

### Job execution logs

```typescript
// Log on every job run
logger.info({
  event: 'job_complete',
  job: 'create-daily-trips',
  date: tomorrow,
  created: 178,
  skipped: 2,
  durationMs: Date.now() - startTime,
})

logger.error({
  event: 'job_failed',
  job: 'mark-absent',
  tripId,
  error: err.message,
  stack: err.stack,
})
```

### Metrics to track (via GCP Cloud Monitoring)

```
checkin_success_rate     → should be >95% at 8am. Drop signals a bug.
checkin_p95_latency_ms   → should be <100ms. Spike signals DB issue.
gps_ping_acceptance_rate → should be ~100%. Drop signals GPS source problem.
job_execution_success    → all 6 jobs: should be 100%. Any failure needs alert.
active_trip_count        → compare to expected buses at 8am. Mismatch = job failure.
redis_memory_usage_mb    → should be stable. Growth = TTLs not set correctly.
db_connection_count      → should stay under 50. Spike = connection leak.
```

### Uptime monitoring

```
Tool: UptimeRobot (free tier is sufficient)
Check: GET /v1/health every 60 seconds
Alert: SMS + email if health check fails
Response time tracking: alert if p95 > 2 seconds

This is the first line of defense — you find out about outages
before students start calling the transport office.
```

---

## 11. Infrastructure Configuration

### Cloud Run

```yaml
# gcloud run deploy bus-backend
service: bus-backend
image: gcr.io/${PROJECT_ID}/bus-backend:${SHA}
region: asia-south1  # Mumbai — closest to Tamil Nadu, lowest latency

scaling:
  min-instances: 2         # Always warm — no cold starts at 7am
  max-instances: 10        # Cap prevents runaway costs
  concurrency: 80          # Requests per instance (Fastify handles this easily)

resources:
  cpu: 1                   # 1 vCPU per instance
  memory: 512Mi            # 512MB — more than enough

flags:
  no-cpu-throttling: true  # CPU always available (not just during requests)
  allow-unauthenticated: false  # Firebase + JWT handles auth

health-check:
  path: /v1/health
  initial-delay: 10s
  period: 30s
  failure-threshold: 3     # 3 failures = instance replaced
```

### Secret management

```
All secrets in GCP Secret Manager. Never in environment files.
Never in GitHub. Never in Docker images.

Secrets:
  DATABASE_URL              → Cloud SQL connection string
  REDIS_URL                 → Upstash Redis URL
  REDIS_TOKEN               → Upstash Redis auth token
  JWT_SECRET                → 64-char random string
  FIREBASE_SERVICE_ACCOUNT_JSON → JSON string (not file path)
  GOOGLE_MAPS_API_KEY       → for geofencing calculations
  CLOUD_TASKS_SA_EMAIL      → service account for Cloud Tasks OIDC

Loaded at runtime:
  Cloud Run mounts secrets as environment variables
  No .env files in production
```

### Database migrations

```
Migrations run as a Cloud Run Job (not on app startup).
This prevents migration failures from crashing the app.

Pipeline step before deploy:
  gcloud run jobs execute prisma-migrate \
    --args="migrate,deploy" \
    --wait  # wait for completion before deploying new app version

If migration fails: deploy is blocked. Previous version stays live.
```

---

## 12. Build Rules for Claude Code

### Architecture rules
1. Single Fastify monolith. Never split into separate services.
2. Modules communicate via service functions, never via direct DB queries
   into another module's tables.
3. All job endpoints are under /v1/jobs/* and protected by verifyCloudTask.
4. dispatchJob() from lib/jobs.ts is the only way to schedule background work.
   Never use setTimeout, setInterval, or node-cron for production scheduling.

### Database rules
5. All 6 critical indexes must be in the initial migration. Never add them later.
6. Every attendance write uses prisma.$transaction.
7. GPS cleanup job uses batched deletes (10,000 rows at a time) with brief
   pauses between batches to avoid table locks.
8. Connection pool: max 5 connections per Cloud Run instance.

### Caching rules
9. Redis is write-through on the check-in path — DB write and Redis update
   happen in the same async flow (Promise.all after transaction).
10. User route assignment cached at user:{id}:assignment TTL 300s.
    Invalidated explicitly on any assignment change.
11. Redis startup seeding: rebuild dashboard:stats and active-trips from
    PostgreSQL if keys are missing (happens after Redis restart).

### Job rules
12. Every job is idempotent — check preconditions before doing work.
    Exit cleanly with a log if work is already done or conditions not met.
13. Every job returns 200 OK even if no work was done.
    Cloud Tasks retries on non-200. Never let retry storms cause side effects.
14. Job execution time limits:
    create-daily-trips: must complete in < 30 seconds
    mark-absent: must complete in < 10 seconds
    gps-heartbeat: must complete in < 5 seconds
    Others: < 15 seconds

### Observability rules
15. Every check-in attempt (success or fail) logs the structured event
    with userId, tripId, result, failReason, distanceToBus, durationMs.
16. Every job run logs start, completion, and key metrics.
17. Every unhandled exception is caught, logged with stack trace, and
    returns a 500 response — never crashes the process.

### Security rules
18. Rate limiting is applied before any business logic on check-in.
    429 response before nonce is burned — nonces are not wasted on rate-limited requests.
19. Device ID check is applied on check-in — DEVICE_MISMATCH returns 403.
20. All secrets from environment variables. No hardcoded values anywhere.
    Constants (geofence radii, thresholds) in packages/shared/src/constants.

---

*Backend Architecture — College Bus Management System*
*Single college deployment. Production grade.*
*March 2026 · Status: Reference architecture for implementation*
