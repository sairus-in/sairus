# Phase 1 — Senior Dev + DevOps Review

> Thinking like a senior developer and DevOps specialist.
> Every issue found, every fix prescribed, every good decision acknowledged.

---

## Table of Contents

1. [Landmines — Bugs waiting to happen](#1-landmines)
2. [Database Issues](#2-database-issues)
3. [Check-in Race Condition](#3-check-in-race-condition)
4. [Scale Tricks](#4-scale-tricks)
5. [DevOps](#5-devops)
6. [What's Solid](#6-whats-solid)
7. [Flows to Discuss Before Building](#7-flows-to-discuss-before-building)

---

## 1. Landmines

> These are bugs waiting to happen in production — not theoretical issues. Each one has caused real incidents in similar systems.

---

### 🔴 CRITICAL — Will break at launch

---

#### QR nonce is not atomic — race condition on 8am check-in spike

**Problem:**
Your QR validation flow reads the nonce from Redis, checks it, then deletes it in separate steps. At 500+ simultaneous check-ins (8am), two requests can both read the same nonce before either deletes it — both succeed. That's a double check-in that bypasses your idempotency key.

**Fix:**
Use Redis `GETDEL` as a single atomic operation. Never read-check-delete in three steps. The nonce burn must be one atomic command.

```typescript
// WRONG — 3 separate ops, race condition possible
const nonce = await redis.get(`qr:nonce:${token}`)
if (!nonce) throw new Error('QR already used')
await redis.del(`qr:nonce:${token}`)

// CORRECT — single atomic op
const nonce = await redis.getdel(`qr:nonce:${token}`)
if (!nonce) throw new Error('QR already used')
```

---

#### Bulk import has no transaction — partial import leaves orphaned data

**Problem:**
Your `bulk-import` endpoint processes students in a loop. If it fails at student 400 of 600, students 1–400 are in the DB, 401–600 are not. Next import attempt hits unique constraint errors on the first 400. No clean recovery path.

**Fix:**
Wrap the entire import in `prisma.$transaction([])`. All-or-nothing. On failure, everything rolls back cleanly.

```typescript
// WRONG — no transaction
for (const student of students) {
  await prisma.user.create({ data: student })
}

// CORRECT — single transaction
await prisma.$transaction(
  students.map(student => prisma.user.create({ data: student }))
)
```

---

#### No rate limiting on check-in endpoint — scriptable attack

**Problem:**
A student who intercepts a QR token can write a script that hammers `POST /v1/attendance/checkin`. Even with nonce burning, if this hits before the legitimate scan, the real student can't check in.

**Fix:**
Rate limit per `userId` on check-in: max 3 attempts per minute per user. Use Upstash Redis sliding window. Also rate limit the auth/login endpoint per IP.

```typescript
// Fastify rate limit plugin with Redis store
await fastify.register(import('@fastify/rate-limit'), {
  max: 3,
  timeWindow: '1 minute',
  keyGenerator: (req) => req.user?.id ?? req.ip,
  redis: redisClient,
})
```

---

### 🟡 HIGH — Will hurt within a week

---

#### deviceId binding has no enforcement path

**Problem:**
`deviceId` exists on the User model for fraud detection but nothing in the code actually enforces it. A student can log in from multiple devices simultaneously. The field is decorative right now.

**Fix:**
On login, store the device fingerprint. On check-in, validate that the JWT's `deviceId` matches the stored one. Reject with a specific error code on mismatch so the student can re-register their device.

```typescript
// On check-in
if (req.user.deviceId !== storedUser.deviceId) {
  throw new ForbiddenError('DEVICE_MISMATCH')
}
```

---

#### `activeDays String[]` on Route — no enum safety

**Problem:**
`activeDays: ["MON","TUE"]` stored as raw string array. Nothing stops `"MONDAY"`, `"monday"`, or `"Mon"` getting in. Attendance logic that checks if today is an active day will silently fail on mismatched strings.

**Fix:**
Add a `DayOfWeek` enum and validate at the Zod layer before the DB.

```typescript
// packages/shared/src/validators/route.validator.ts
const DayOfWeek = z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'])

export const routeSchema = z.object({
  activeDays: z.array(DayOfWeek).min(1),
  // ...
})
```

---

#### Scheduled time stored as `String "07:30"` — timezone bugs guaranteed

**Problem:**
`scheduledTimeMorning: String` on RouteStop stores "07:30" as plain text. When you compare this against real timestamps for late detection, absent marking, and ETA calculations, you'll be doing string manipulation on time — not real date math. Daylight saving, midnight edge cases, and IST conversion will all go wrong.

**Fix:**
Store as minutes since midnight as `Int`. Do all time math in integers. Only format to "HH:mm" at the display layer.

```prisma
// schema.prisma — WRONG
scheduledTimeMorning String  // "07:30"

// CORRECT
scheduledTimeMorning Int  // 450 (= 7 * 60 + 30)
scheduledTimeReturn  Int  // 1020 (= 17 * 60 + 0)
```

```typescript
// Conversion helpers in packages/shared
export const minutesToTime = (mins: number) =>
  `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`

export const timeToMinutes = (time: string) => {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}
```

---

### 🟠 MEDIUM — Will hurt within a month

---

#### No pagination on attendance logs query

Admin page fetches all attendance logs for a trip. At 2000 students per trip that's a 2000-row query hitting the browser in one shot. The table will freeze.

**Fix:** Add `?page=1&limit=50` pagination on `GET /v1/attendance/logs`. TanStack Query handles paginated fetching automatically with `keepPreviousData: true`.

---

#### `any` types in admin components

Multiple admin pages cast API responses to `any` (e.g. `corrections.map((c: any) => ...)`). This defeats TypeScript entirely — runtime errors won't be caught at compile time.

**Fix:** Import types from `packages/shared` and use them everywhere. If a type doesn't exist in shared yet, add it — don't use `any`.

---

#### Mobile hardcodes localhost IP

The setup docs say "find your laptop IP and update api.client.ts manually". This breaks every time you switch networks.

**Fix:** Use an `.env` variable read via `expo-constants`:

```typescript
// apps/mobile/src/services/api.client.ts
import Constants from 'expo-constants'
const BASE_URL = Constants.expoConfig?.extra?.apiUrl ?? 'http://localhost:3000'
```

```javascript
// apps/mobile/app.config.js
extra: {
  apiUrl: process.env.API_URL ?? 'http://localhost:3000'
}
```

---

## 2. Database Issues

---

### Missing indexes that will kill you at scale

---

#### No index on `attendance_logs(tripId, status)` 🔴

Every admin attendance table query filters by trip + status. At 2000 students × 2 trips/day × 365 days = **1.46M rows/year** — a full table scan on this query will take seconds.

```prisma
model AttendanceLog {
  // ... existing fields ...
  @@index([tripId, status])    // ADD THIS
  @@index([userId, date])      // already planned — confirm it's there
}
```

---

#### No index on `trips(busId, status)` 🔴

"What is the active trip for bus 12?" is the **hottest query in the system** — called on every GPS update, every check-in, every QR validation. Without this index it scans the entire trips table.

```prisma
model Trip {
  // ... existing fields ...
  @@index([busId, status])     // ADD THIS — most critical missing index
}
```

---

#### No index on `route_assignments(userId)` 🟡

"Which route/stop is this student assigned to?" is called on every check-in.

```prisma
model RouteAssignment {
  // ... existing fields ...
  @@index([userId])            // ADD THIS
}
```

---

### Schema design issues

---

#### `AttendanceLog.date` as `DateTime` — date-only queries are expensive

When you query "all attendance for 2026-03-18", you're doing a range scan:
```sql
WHERE date >= '2026-03-18 00:00' AND date < '2026-03-19 00:00'
```

**Better:** Add a `dateKey String` column (e.g. `"2026-03-18"`) that's cheap to index and query exactly.

```prisma
model AttendanceLog {
  date    DateTime
  dateKey String   // "2026-03-18" — add this
  @@index([dateKey])
  @@index([userId, dateKey])  // replaces userId+date composite
}
```

---

### GPS data retention — will become a problem fast

At 180 buses × 1 ping/5s × 10hrs/day = **~1.3M rows/day**.
In 30 days: 39M rows. In a year: 474M rows.

Without a cleanup job this table will become the biggest table in your DB and slow everything down.

**Plan:**
Add a Cloud Tasks daily job:
1. Aggregate `gps_logs` older than 30 days into `trip_summaries` (path, avg speed, total distance)
2. Delete raw rows older than 30 days
3. Raw GPS: 30-day retention. Aggregated summaries: forever.

---

### What's correct in the schema ✅

| Decision | Why it's right |
|---|---|
| `lon` not `lng` — locked everywhere | Prevents the silent coordinate swap bug that plagues GPS systems |
| Flat User model with nullable role fields | Avoiding JOIN per user lookup is correct at this scale |
| `AttendanceLog` + `AttendanceEvent` separation | CQRS-lite: fast reads from log, full history from events |

---

## 3. Check-in Race Condition

> The check-in flow is the most critical path in the system. At 8am, 500+ students scan simultaneously. Here's exactly what needs to be bulletproof.

---

### The race condition in detail

**Current flow (broken under load):**

```
1. GET nonce from Redis          ← request A reads nonce "abc123"
2. GET nonce from Redis          ← request B also reads "abc123" (before A deletes)
3. Validate nonce "abc123" ✓     ← A validates
4. Validate nonce "abc123" ✓     ← B validates (same nonce, still in Redis!)
5. DELETE nonce from Redis       ← A deletes
6. INSERT attendance_log         ← A inserts
7. INSERT attendance_log         ← B inserts duplicate
```

**Fixed flow (atomic):**

```
1. GETDEL nonce from Redis       ← single atomic op — reads AND deletes simultaneously
   → returns "abc123" to A, returns null to B
2. A continues, B gets 409 CONFLICT immediately
3. Only A inserts attendance_log
```

**Redis command:** `GETDEL key` (Redis 6.2+, Upstash supports this). One line change, eliminates the entire race.

---

### The full hardened check-in sequence

```
POST /v1/attendance/checkin
  │
  ├─ 1. Rate limit check (Redis sliding window, 3 req/min per userId)
  │      → 429 TOO_MANY_REQUESTS if exceeded
  │
  ├─ 2. Validate JWT + extract userId, deviceId
  │
  ├─ 3. deviceId check (does JWT deviceId match stored deviceId?)
  │      → 403 DEVICE_MISMATCH if no
  │
  ├─ 4. GETDEL qr:nonce:{token} from Redis  ← ATOMIC
  │      → 409 QR_ALREADY_USED if null
  │
  ├─ 5. Decode + verify QR JWT signature
  │      → 400 QR_INVALID if bad signature
  │      → 400 QR_EXPIRED if exp passed
  │
  ├─ 6. Verify tripId in QR matches active trip for that bus
  │      → 400 TRIP_MISMATCH if no
  │
  ├─ 7. Haversine check: student GPS vs (bus GPS OR stop GPS)
  │      → 400 TOO_FAR if outside geofence
  │      → always log distanceToBus + distanceToStop (correction evidence)
  │
  ├─ 8. Check for existing attendance_log (idempotency)
  │      → 200 ALREADY_CHECKED_IN if exists (not an error — idempotent)
  │
  ├─ 9. prisma.$transaction([
  │        create attendance_log { status: PRESENT },
  │        create attendance_event { type: CHECK_IN }
  │     ])
  │
  └─ 10. Emit Socket.io event to admin room
         Return 201 CHECKED_IN
```

---

### Offline check-in (network drops)

Students in areas with poor signal (common in Tamil Nadu outskirts) will scan the QR but the POST fails silently. The plan mentions offline-first but needs concrete implementation:

**Mobile side:**
- Store failed check-in attempts in `AsyncStorage` with timestamp + QR payload
- On reconnect: replay queued check-ins

**Backend side:**
- Accept replayed check-ins up to 10 minutes after QR generation time (not nonce time — nonce is already burned)
- Validate that the timestamp is within the trip window

```typescript
// Mobile — queue failed check-ins
const CHECKIN_QUEUE_KEY = 'checkin_queue'

const queueCheckin = async (payload: CheckinPayload) => {
  const queue = await AsyncStorage.getItem(CHECKIN_QUEUE_KEY)
  const existing = queue ? JSON.parse(queue) : []
  await AsyncStorage.setItem(CHECKIN_QUEUE_KEY, JSON.stringify([...existing, payload]))
}

// On reconnect — flush queue
const flushCheckinQueue = async () => {
  const queue = await AsyncStorage.getItem(CHECKIN_QUEUE_KEY)
  if (!queue) return
  const items = JSON.parse(queue)
  for (const item of items) {
    await api.post('/v1/attendance/checkin', item)
  }
  await AsyncStorage.removeItem(CHECKIN_QUEUE_KEY)
}
```

---

## 4. Scale Tricks

---

### GPS — 180 buses × thousands of readers

---

#### Adaptive ping rate — save 60% battery and bandwidth

```typescript
// apps/mobile/src/tasks/gps.task.ts
const getPingInterval = (speed: number): number => {
  if (speed > 5)  return 3000   // moving → every 3s
  if (speed > 0)  return 15000  // slow/stopped → every 15s
  return 60000                   // parked → every 60s
}
```

At peak: 180 buses × 1 ping/3s = 60 writes/s to Firebase.
With adaptive: average drops to ~20 writes/s. Significant at scale.

---

#### Delta compression — only write if bus moved >5m

```typescript
// Before writing to Firebase RTDB
let lastLat: number | null = null
let lastLon: number | null = null

const shouldWrite = (newLat: number, newLon: number): boolean => {
  if (!lastLat || !lastLon) return true
  const moved = getDistanceMetres(lastLat, lastLon, newLat, newLon)
  return moved >= 5
}
```

Cuts Firebase writes by ~40% when buses are in slow traffic or stopped at lights.

---

#### Room-based Socket.io fanout — don't broadcast to everyone

```typescript
// Student joins their bus room only
socket.on('join', ({ busId }) => {
  socket.join(`bus:${busId}`)
})

// Admin joins all bus rooms
socket.on('join-admin', async () => {
  const buses = await prisma.bus.findMany({ where: { isActive: true } })
  buses.forEach(b => socket.join(`bus:${b.id}`))
})

// GPS update — emit to bus room only
io.to(`bus:${busId}`).emit('gps:update', { lat, lon, speed, heading })
```

Without rooms: every GPS update broadcasts to all 2000+ connected clients.
With rooms: each update goes to ~10–15 students on that bus only.

---

### Database — survive the 8am spike

---

#### pgBouncer connection pooling — critical for Cloud Run

Cloud Run scales horizontally. Each new container instance opens new DB connections. At 10 instances × 10 connections = 100 connections. PostgreSQL starts struggling at 100+.

**Fix:** Set `connection_limit` in your Prisma DATABASE_URL for Cloud Run:

```
# Cloud Run environment
DATABASE_URL="postgresql://user:pass@host/db?connection_limit=5&pool_timeout=20"
```

Or use Cloud SQL Proxy with PgBouncer sidecar. The key: each Cloud Run instance should hold max 5 DB connections.

---

#### Cache the hot read paths in Redis

These queries run on every single check-in and should never hit the DB directly:

```typescript
// lib/cache.ts
const CACHE_TTL = {
  ACTIVE_TRIP: 300,        // 5 min — invalidate when trip ends
  ROUTE_ASSIGNMENT: 3600,  // 1 hr — changes rarely
  BUS_ASSIGNMENT: 3600,    // 1 hr
}

export const getActiveTripForBus = async (busId: string) => {
  const cacheKey = `trip:active:${busId}`
  const cached = await redis.get(cacheKey)
  if (cached) return JSON.parse(cached)

  const trip = await prisma.trip.findFirst({
    where: { busId, status: 'ACTIVE' }
  })
  if (trip) await redis.setex(cacheKey, CACHE_TTL.ACTIVE_TRIP, JSON.stringify(trip))
  return trip
}

// Invalidate when trip ends
export const invalidateActiveTripCache = (busId: string) =>
  redis.del(`trip:active:${busId}`)
```

---

### Cloud Run — don't get caught by cold starts

---

#### `min-instances=1` is not enough for the 8am spike

At 8am you'll suddenly go from 1 to 10+ instances. Each new instance takes ~3–5 seconds to cold start (Node.js boot + Prisma init + Redis connect). During that 3–5 seconds, requests queue up and students get errors.

**Fix:**

```yaml
# cloud-run.yaml
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/minScale: "2"    # was 1
        autoscaling.knative.dev/maxScale: "20"
        run.googleapis.com/cpu-throttling: "false" # CPU always allocated
    spec:
      containerConcurrency: 80
```

With `cpu-throttling: false`, instances stay warm and scale-up is near-instant instead of 3–5 seconds.

---

## 5. DevOps

---

### Before you deploy a single container

---

#### Secret Manager — never put credentials in env vars on Cloud Run

Credentials set as plain-text environment variables appear in the GCP console and potentially in logs.

**Fix:** Store all secrets in GCP Secret Manager. Mount them in Cloud Run via secret references:

```yaml
# cloud-run.yaml
env:
  - name: JWT_SECRET
    valueFrom:
      secretKeyRef:
        name: jwt-secret
        key: latest
  - name: FIREBASE_SERVICE_ACCOUNT_JSON
    valueFrom:
      secretKeyRef:
        name: firebase-sa-json
        key: latest
```

```bash
# Create secrets
gcloud secrets create jwt-secret --data-file=-  <<< "your-jwt-secret"
gcloud secrets create firebase-sa-json --data-file=firebase-service-account.json
```

---

#### Health check endpoint must be production-ready

Cloud Run uses your health check to decide if an instance is ready for traffic. If the DB is down, Cloud Run thinks the instance is healthy and keeps routing traffic to it.

```typescript
// CURRENT (insufficient)
fastify.get('/health', () => ({ status: 'ok' }))

// PRODUCTION-READY
fastify.get('/health', async (req, reply) => {
  const checks = await Promise.allSettled([
    prisma.$queryRaw`SELECT 1`,
    redis.ping(),
  ])

  const db    = checks[0].status === 'fulfilled' ? 'ok' : 'error'
  const cache = checks[1].status === 'fulfilled' ? 'ok' : 'error'

  const healthy = db === 'ok' && cache === 'ok'
  reply.code(healthy ? 200 : 503)

  return {
    status: healthy ? 'ok' : 'degraded',
    db,
    cache,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  }
})
```

---

#### Prisma migrations on Cloud Run — never run on startup

If `prisma migrate deploy` is in your container startup, and 5 instances start simultaneously, all 5 will try to run migrations at once. The first succeeds, the other 4 fail or deadlock.

**Fix:** Run migrations as a one-time Cloud Run **Job** triggered by your GitHub Actions deploy pipeline, *before* the new container version rolls out. Never in app startup code.

```yaml
# .github/workflows/deploy.yml
- name: Run DB migrations
  run: |
    gcloud run jobs create migrate-job \
      --image gcr.io/$PROJECT/backend:$SHA \
      --command "npx,prisma,migrate,deploy" \
      --region asia-south1 \
      --execute-now \
      --wait
```

---

#### Firebase service account JSON — never inside the Docker image

Your setup says save `firebase-service-account.json` to the backend folder. If this file makes it into the Docker image, your private key is in every container instance.

**Fix:** Store the JSON content as a GCP Secret Manager secret:

```typescript
// lib/firebase.ts
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON!)

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
})
```

Add to `.dockerignore`:
```
firebase-service-account.json
*.json.key
.env
```

---

### GitHub Actions CI/CD pipeline

**Deploy pipeline order matters:**

```
GitHub push to main
  │
  ├─ 1. Run tests (vitest)
  ├─ 2. Build Docker image
  ├─ 3. Push to Artifact Registry
  ├─ 4. Run: prisma migrate deploy (Cloud Run Job)  ← migrations FIRST
  ├─ 5. Deploy new Cloud Run revision
  ├─ 6. Traffic: 10% → new revision, wait 2 minutes
  ├─ 7. If no errors: 100% → new revision (canary promotion)
  └─ 8. If errors: rollback to previous revision automatically
```

The traffic split (step 6) is Cloud Run's built-in canary — one config flag. Saves you from a broken backend hitting all users at once.

---

### Structured logging from day one

```typescript
// Every check-in attempt should log this shape:
fastify.log.info({
  event: 'checkin_attempt',
  userId,
  tripId,
  busId,
  distanceToBus,
  distanceToStop,
  result: 'SUCCESS' | 'TOO_FAR' | 'QR_USED' | 'QR_EXPIRED' | 'DEVICE_MISMATCH',
  durationMs: Date.now() - startTime,
})
```

When a student complains "I scanned but wasn't marked present", you can query this log in 10 seconds. Without structured logs, you're asking students to re-explain and guessing.

Configure Pino for JSON output in production:

```typescript
// app.ts
const fastify = Fastify({
  logger: process.env.NODE_ENV === 'production'
    ? { level: 'info' }           // JSON output — GCP Cloud Logging parses this
    : { level: 'debug', transport: { target: 'pino-pretty' } }  // pretty for dev
})
```

---

## 6. What's Solid

> The foundations are genuinely good. These design decisions show real systems thinking — most developers only add these after getting burned in production.

---

### Architecture decisions that are correct ✅

---

#### Event sourcing for attendance

Every attendance state change creates an immutable `AttendanceEvent` record. Full auditability, ability to reconstruct state at any point, clear paper trail for disputes. Most student systems don't do this and regret it later.

---

#### Separate `AttendanceLog` (current state) + `AttendanceEvent` (history)

CQRS-lite pattern. Fast reads from the log, full history from events. Exactly right. The log answers "what is this student's attendance today?" in one query. The event table answers "what happened, when, and who did it?" with full history.

---

#### GPS evidence stored on failed check-in attempts

`distanceToBus` and `distanceToStop` stored even when check-in is rejected. Correction requests have hard evidence. Coordinators can see "student was 120m away (geofence is 100m)" — this resolves 80% of disputes without any back-and-forth.

---

#### Cloud Tasks for absent marking + escalation

Replacing node-cron with Cloud Tasks was the right call. Jobs survive container restarts, have built-in retry with exponential backoff, and are observable in the GCP console. node-cron dies silently mid-job on container restart — Cloud Tasks does not.

---

#### `packages/shared` as single source of truth

Types, validators, Haversine — defined once, used by backend + mobile + admin. Any type mismatch between frontend and backend fails at compile time, not at runtime at 8am. This alone will save days of debugging.

---

#### TripSkip + WaitRequest as first-class models

Most bus systems treat these as edge cases and hack them in later. Having them in the schema from day one means the attendance logic handles them cleanly instead of special-casing everywhere.

---

#### Flat User model with nullable role fields

Avoiding a JOIN per user lookup is correct at this scale. The tradeoff (nullable fields) is worth it. Validate at the service layer that role-specific fields are present for the right roles.

---

#### `lon` not `lng` — locked everywhere

Single naming convention prevents the silent coordinate swap bug (lat/lng vs lat/lon) that plagues GPS systems. Good discipline.

---

## 7. Flows to Discuss Before Building

> These 5 flows touch multiple services and have decisions that affect the entire codebase. Walk through each one before handing to Claude Code.

---

### Flow 1 — Full QR check-in end-to-end

Driver starts trip → QR generated → student scans → backend validates → attendance marked → admin sees it.

**Key questions:**
- What is the exact QR payload structure? (tripId, busId, exp, nonce — what else?)
- How does the QR refresh work — every 30s on the driver kiosk?
- How does the student app know to subscribe to which bus's QR?
- What is the exact geofence logic — bus GPS OR nearest stop GPS, not bus GPS AND stop GPS?
- What happens if the driver's GPS hasn't updated in 2 minutes (stuck in tunnel)?

---

### Flow 2 — Absent marking when trip ends

Trip ends → Cloud Tasks job fires → finds all students on route with no check-in → marks absent.

**Key questions:**
- When exactly does the job fire — immediately on trip end, or with a grace period?
- How does TripSkip affect this? (students who pre-marked "not taking bus today")
- How does WaitRequest affect this? (students who asked driver to wait)
- What about students who self-arranged? How did they declare this?
- If a student was marked absent and then submits a correction, does the event chain replay?

---

### Flow 3 — Attendance correction request

Student sees they were marked absent → submits correction → coordinator reviews GPS evidence → approves/rejects → attendance updated.

**Key questions:**
- What correction types are allowed? (Was present but QR failed? Self-arranged but forgot to declare? Other?)
- Who can approve corrections — only coordinator, or also transport officer?
- Does an approved correction update `AttendanceLog.status` directly or create a new event that recalculates?
- What is the SLA for corrections — is there a deadline?
- Can a student submit multiple corrections for the same trip?

---

### Flow 4 — Breakdown incident + escalation chain

Driver reports breakdown → Pub/Sub event → notifications to students + coordinator → escalation timer starts → unresolved → escalates up.

**Key questions:**
- What are the escalation time thresholds? (Coordinator: 15min? Transport Officer: 30min? Principal: 45min?)
- What happens to the active trip — is it cancelled immediately or kept open?
- What do students see on their app during a breakdown?
- Who can mark an incident as resolved, and what triggers the Cloud Tasks timer to stop?
- If the driver resolves it themselves (e.g. tyre changed), can they close the incident?

---

### Flow 5 — Live GPS tracking

Driver app background task → POST to backend → write to Firebase RTDB → student app subscribes → map updates.

**Key questions:**
- Does the GPS post go to backend first (which then writes to Firebase), or does the driver app write directly to Firebase RTDB?
- How does the student app know which `busId` to subscribe to?
- What does the student see when the driver's phone dies mid-route? (Last known position? "GPS unavailable" state?)
- How is the smooth marker animation handled — using the `heading` + `speed` fields for interpolation between 3s pings?
- What happens to live GPS subscription when the student checks in — does anything change?

---

*Senior Dev + DevOps Review — College Bus Management System*
*March 2026*
*Status: Pre-build review — fix critical issues before handing to Claude Code*
