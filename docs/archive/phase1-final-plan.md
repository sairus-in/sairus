# College Bus Management System
# Phase 1 — Finalized Complete Plan

> Every decision made. Every edge case handled. Every service boundary clear.
> Ready to hand to Claude Code without a single ambiguity.
>
> Built from: original Phase 1 plan + senior dev review + DevOps review +
> GPT review analysis + 6 locked flow decisions + 2 new features designed in discussion.

---

## Table of Contents

1. [What Phase 1 Delivers](#1-what-phase-1-delivers)
2. [Locked Decisions — 6 Flow Decisions + 2 New Features](#2-locked-decisions)
3. [Schema Changes from Original Plan](#3-schema-changes-from-original-plan)
4. [Complete Final Schema](#4-complete-final-schema)
5. [packages/shared — Complete](#5-packagesshared--complete)
6. [Backend — All Modules](#6-backend--all-modules)
7. [Mobile App — All Screens](#7-mobile-app--all-screens)
8. [Admin Panel — All Screens](#8-admin-panel--all-screens)
9. [Infrastructure & Jobs](#9-infrastructure--jobs)
10. [Build Order](#10-build-order)
11. [Critical Rules for Claude Code](#11-critical-rules-for-claude-code)

---

## 1. What Phase 1 Delivers

Phase 1 is a complete, production-ready attendance system for a college bus fleet.
Not a prototype. Real students, real buses, real consequences for getting it wrong.

### Features delivered in Phase 1

| Feature | Description |
|---|---|
| Phone OTP login | Firebase Auth phone sign-in for all roles |
| QR check-in | Per-scan QR, burned atomically, geofence validated |
| Live bus tracking | Firebase RTDB, driver GPS → student map |
| Arrival verification | College gate geofence check + FCM push fallback |
| Absent marking | Cloud Tasks job when trip ends |
| Attendance corrections | Student requests, coordinator reviews with GPS evidence |
| TripSkip | Student marks "not coming today" |
| WaitForMe | Student requests driver to wait (2, 3, or 5 min) |
| Incident reporting | Driver reports breakdown, escalation chain |
| Admin panel | Live attendance, correction queue, student/route CRUD |
| Bulk import | CSV upload for student roster |
| Admin ↔ Driver messaging | Replaces WhatsApp |

### What is NOT in Phase 1

- GPS trip history replay (Phase 2 — Traccar)
- RAG admin intelligence (Phase 4)
- Analytics dashboards beyond basic attendance (Phase 4 — Metabase)
- Parent notifications
- Fee integration

---

## 2. Locked Decisions

These were decided through detailed discussion. Do not revisit during build.

---

### Decision 1 — Trip start: Manual with nightly pre-creation

**Answer:** Manual "Start Trip" tap required. But trips are pre-created every night.

**How it works:**
```
11pm nightly Cloud Tasks job:
  For each active BusAssignment:
    CREATE Trip {
      status: SCHEDULED,
      date: tomorrow (YYYY-MM-DD IST),
      type: MORNING,
      busId, routeId, driverId,
      expectedCount: count of active RouteAssignments for this route
    }
    CREATE Trip { same but type: RETURN }

8am — Driver opens app:
  Sees full-screen "Start Morning Trip" prompt (blocks kiosk)
  Taps → PATCH /v1/trips/:id/start
        → Trip.status = ACTIVE
        → Trip.startedAt = now()
        → SET Redis: trip:active:{busId} = tripId (TTL 12hrs)
```

**Why nightly pre-creation:**
- Admin can see tomorrow's schedule tonight
- Coordinators can verify driver assignments before 8am
- `expectedCount` is accurate from the start
- Admin panel shows "Bus 12 — Scheduled, not yet started" before 8am
- If driver hasn't started trip 10 min past scheduled time → admin alert

**Driver UX rule:** The "Start Trip" screen is not a small button. It is a full-screen
block — the driver cannot see the kiosk QR until they tap Start Trip. Makes forgetting
nearly impossible.

---

### Decision 2 — Geofence: Soft zone with constants

**Answer:** 100m = PRESENT, 100–150m = LATE_BOARD, >150m = FAIL (hard reject).

**Rationale:**
- First 60 days: calibration period. Stop coordinates might be off by 20–30m.
- LATE_BOARD exists in AttendanceStatus enum — use it.
- After 60 days: analyse LATE_BOARD data. If clustering 100–115m → fix stop coords.
  If spread randomly → tighten to hard cutoff by setting SOFT_RADIUS = HARD_RADIUS.

**Constants (packages/shared):**
```typescript
export const GEOFENCE = {
  HARD_RADIUS_METRES: 100,
  SOFT_RADIUS_METRES: 150,   // set equal to HARD to disable soft zone
  ACCURACY_WARNING_THRESHOLD: 50,
  COLLEGE_GATE_RADIUS_METRES: 500,
  COLLEGE_GATE_LAT: 12.9900,  // update to real college gate coords
  COLLEGE_GATE_LON: 80.1700,
} as const
```

**Student-facing messages:**
- PRESENT: normal check-in, no message
- LATE_BOARD: "Checked in — you were a bit far from the stop today" (no mention of LATE_BOARD)
- FAIL >150m: "You're Xm from the bus. Move closer or submit a correction."

---

### Decision 3 — QR refresh: Socket.io push primary, polling fallback

**Answer:** Server pushes new QR via Socket.io at t=25s. Kiosk polls if no push received before expiry.

**Timing rules:**
```
t=0s   QR generated, nonce stored in Redis (40s TTL), JWT exp = 35s
t=25s  Backend pushes new QR to driver socket
t=35s  JWT expires (but 5s grace accepted)
t=40s  Redis nonce TTL expires (hard cutoff)

Fallback: If kiosk countdown hits 0 with no socket refresh:
  → GET /v1/trips/:tripId/qr (polling fallback)
  → Show "Reconnecting..." for max 2 seconds
```

**Critical rule — nonce stored BEFORE push:**
Backend stores nonce in Redis first, then pushes to kiosk. Never push first.
Reason: if student scans immediately after push but before Redis write, GETDEL
returns null → QR_ALREADY_USED error for a valid scan.

**Validation order on check-in:**
```
1. GETDEL nonce (atomic) — if null → QR_ALREADY_USED
2. Verify JWT signature
3. Check JWT exp with 5s grace (exp + 5000 > Date.now())
4. Continue with geofence...
```

**Kiosk states:**
```typescript
type KioskState =
  | 'ACTIVE'      // QR displayed, countdown running
  | 'REFRESHING'  // fallback polling fired (<2s)
  | 'EXPIRED'     // refresh failed (network issue, shown max 3s)
  | 'NO_TRIP'     // trip not started yet → shows Start Trip button
  | 'TRIP_ENDED'  // trip completed → shows summary
```

---

### Decision 4 — TripSkip override: Always allow check-in

**Answer:** TripSkip is a hint, not a lock. Check-in always succeeds regardless of TripSkip.

**Behaviour:**
```
Student has TripSkip for today:
  GET /student/home returns:
    canCheckIn: true       ← never blocked
    tripSkipActive: true   ← UI shows different message

Home screen shows:
  "You marked 'not travelling today'"
  [Scan QR anyway] button — always visible

Student scans and checks in:
  AttendanceLog.status → PRESENT
  TripSkip record → kept (audit trail, never deleted)
  AttendanceEvent.metadata → { overrodeTripSkip: true }

Driver kiosk → shows student with indicator "marked skip, came anyway"
```

**Schema impact:** Zero. No changes needed.

---

### Decision 5 — Bus location: Direct Firebase, never through backend

**Answer:** `/student/home` returns `busId`. Mobile subscribes to Firebase RTDB directly.

**Channel boundaries (locked forever):**
```
Firebase RTDB — live state only, high frequency writes
  /buses/{busId}/lat          Float
  /buses/{busId}/lon          Float
  /buses/{busId}/speed        Float
  /buses/{busId}/heading      Float  (0-360 degrees)
  /buses/{busId}/gpsStatus    "LIVE" | "OFFLINE"
  /buses/{busId}/lastUpdated  Unix timestamp

PostgreSQL — historical + relational data
  gps_logs     all pings, 30-day retention
  trips        trip records, status, timing
  everything else

Backend NEVER proxies Firebase for GPS reads.
Firebase NEVER stores historical data.
```

**Mobile startup sequence:**
```typescript
// Step 1: Load stale cache instantly → show UI immediately
const cached = await AsyncStorage.getItem('homeCache')
if (cached) setHomeData(JSON.parse(cached))

// Step 2: Fetch fresh data from backend
const fresh = await api.get('/v1/student/home')
setHomeData(fresh)
AsyncStorage.setItem('homeCache', JSON.stringify(fresh))

// Step 3: Subscribe to Firebase with busId from step 2
if (fresh.trip?.busId) {
  const ref = firebase.database().ref(`/buses/${fresh.trip.busId}`)
  ref.on('value', snap => setBusLocation(snap.val()))
  return () => ref.off()
}
```

---

### Decision 6 — Offline queue expiry: Trip window boundary

**Answer:** Trip lifecycle is the boundary. Mobile pre-filters at 90 minutes.

**Two-layer validation:**
```
Layer 1 (mobile, before replay):
  Discard queued items where queuedAt > 90 minutes ago

Layer 2 (backend, on receiving replay):
  clientTimestamp must be >= trip.startedAt
  clientTimestamp must be <= trip.endedAt (if ended)
  Trip must not be CANCELLED
  Returns 410 TRIP_ALREADY_ENDED if outside window
```

**When 410 received:** Show correction request button automatically.
"Your check-in couldn't be processed — submit a correction request instead."

---

### New Feature 1 — Arrival verification at college gate

**Not in original plan. Designed in discussion. Must be built in Phase 1.**

**What it does:** When bus hits college gate geofence, silently verifies every
PRESENT student is actually at college. Catches fraud (scan and walk away).

**Full sequence:**
```
Bus GPS update → backend checks distance to college gate
  Distance < 200m AND trip ACTIVE AND not already triggered?
    SET Redis: arrival:triggered:{tripId} = "1" (TTL 30min, idempotent)

Attempt 1 — Silent Socket.io (t=0):
  io.to(`trip:${tripId}`).emit('gate:reached', { tripId })
  Mobile receives → Location.getCurrentPositionAsync() → POST /verify-arrival
  Student notices nothing. Done in ~5 seconds.

Wait 2 minutes — no response?

Attempt 2 — FCM Push Notification (t=2min):
  Title: "Confirm your arrival"
  Body:  "Tap to verify you've reached college — takes 2 seconds"
  Deep link → opens app → VerifyArrivalScreen → auto-fires GPS → POST /verify-arrival
  method: "PUSH_NOTIFICATION" logged

Wait 5 more minutes — still no response?

Final state (t=7min):
  No response → arrivalVerified = null → treated as PRESENT (benefit of doubt)
  Only flag students who actively send location OUTSIDE 500m
```

**Outcome mapping:**
```
Within 500m   → arrivalVerified = true, no action
Outside 500m  → arrivalVerified = false, flagged for coordinator review
No response   → arrivalVerified = null, treated as PRESENT
```

**Why not auto-absent on outside 500m:**
Phone GPS drift in tunnels/flyovers, dead battery, metal bus body blocking GPS.
Coordinator reviews flag, calls driver if suspicious. Driver knows who was on the bus.

---

### New Feature 2 — GPS heartbeat and offline detection

**Not in original plan. Added from GPT review. Must be built in Phase 1.**

**Why:** Android OEMs (Samsung, Xiaomi — common in India) kill background tasks
silently. Without this, the bus stops updating and students see a 5-minute-old
position with no indication that GPS is down.

**Implementation:**
```
Driver GPS task (every ping):
  SET Redis: gps:heartbeat:{busId} = Date.now() (TTL 120s)
  Write to Firebase: /buses/{busId}/lastUpdated = Date.now()

Backend Cloud Tasks job (every 60s, per active trip):
  GET Redis: gps:heartbeat:{busId}
  If null OR (Date.now() - lastPing > 90_000):
    firebase.ref(`/buses/${busId}/gpsStatus`).set('OFFLINE')
  Else:
    firebase.ref(`/buses/${busId}/gpsStatus`).set('LIVE')

Student app:
  If gpsStatus === 'OFFLINE':
    Show on map: "GPS signal lost — last seen X minutes ago"
    Show last known position as faded/grayed marker
```

---

## 3. Schema Changes from Original Plan

These are the exact changes to make to the original `schema.prisma` before running migration.

### Change 1 — `scheduledTimeMorning` and `scheduledTimeReturn` → Int

**Original:**
```prisma
scheduledTimeMorning String  // "07:30"
scheduledTimeReturn  String  // "17:00"
```

**Fixed:**
```prisma
scheduledTimeMorning Int  // 435 (= 7*60+15, minutes since midnight)
scheduledTimeReturn  Int  // 1050 (= 17*60+30)
```

**Why:** String time comparison breaks all time math — late detection, absent marking
triggers, ETA calculations. Store as minutes, format at display layer only.

### Change 2 — Add missing indexes

```prisma
// On Trip model — HOTTEST QUERY: "active trip for bus X"
@@index([busId, status])

// On AttendanceLog model — every admin table query
@@index([tripId, status])

// On RouteAssignment model — every check-in
@@index([userId])
```

### Change 3 — Add arrival verification fields to AttendanceLog

```prisma
model AttendanceLog {
  // ... existing fields unchanged ...

  // Arrival verification (new feature)
  arrivalVerified   Boolean?   // null=not checked, true=verified, false=flagged
  arrivalLat        Float?
  arrivalLon        Float?
  arrivalDistance   Int?       // metres from college gate
  arrivalCheckedAt  DateTime?
  arrivalMethod     String?    // "SOCKET" | "PUSH_NOTIFICATION" | null
}
```

### Change 4 — Add two new AttendanceEventType values

```prisma
enum AttendanceEventType {
  CHECK_IN
  MANUAL_CORRECTION
  MARK_EXCUSED
  SKIP_TODAY
  WAIT_FOR_ME
  TRIP_END_ABSENT
  ARRIVAL_VERIFIED    // new
  ARRIVAL_FLAGGED     // new
}
```

### Change 5 — Add dateKey to AttendanceLog

```prisma
model AttendanceLog {
  // ... existing fields ...
  dateKey String  // "2026-03-18" — cheap exact-match index, avoids range scan
  @@index([dateKey])
  @@index([userId, dateKey])  // replaces userId+date
}
```

### Change 6 — Trip pre-creation support (Trip.status already has SCHEDULED)

No schema change needed. `TripStatus.SCHEDULED` already exists. The nightly
Cloud Tasks job just creates Trip records with this status.

### What does NOT change

- `lon` not `lng` — locked everywhere, no change
- Flat User model — no change
- All existing indexes — kept as-is
- All enums except AttendanceEventType — no change
- Event sourcing architecture — no change

---

## 4. Complete Final Schema

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── ENUMS ───────────────────────────────────────────────

enum Role {
  STUDENT
  STAFF
  DRIVER
  COORDINATOR
  TRANSPORT_OFFICER
  FACULTY
  MANAGEMENT
}

enum TripType {
  MORNING
  RETURN
}

enum TripStatus {
  SCHEDULED
  ACTIVE
  COMPLETED
  CANCELLED
}

enum AttendanceStatus {
  PRESENT
  ABSENT
  SELF_ARRANGED
  LATE_BOARD
  MANUAL
  EXCUSED
  PENDING
}

enum CheckInMethod {
  QR_SCAN
  MANUAL_DRIVER
  MANUAL_ADMIN
  SYSTEM_AUTO
}

enum AttendanceEventType {
  CHECK_IN
  MANUAL_CORRECTION
  MARK_EXCUSED
  SKIP_TODAY
  WAIT_FOR_ME
  TRIP_END_ABSENT
  ARRIVAL_VERIFIED
  ARRIVAL_FLAGGED
}

enum IncidentType {
  MECHANICAL
  FLAT_TYRE
  ACCIDENT
  DRIVER_UNWELL
  ROUTE_BLOCKED
  OTHER
}

enum IncidentStatus {
  REPORTED
  ASSIGNED
  RESOLVED
  CANCELLED
}

enum EscalationLevel {
  COORDINATOR
  TRANSPORT_OFFICER
  PRINCIPAL
}

enum ComplaintCategory {
  DRIVER_BEHAVIOUR
  BUS_CONDITION
  TIMING_ISSUE
  ROUTE_ISSUE
  ATTENDANCE_ISSUE
  OTHER
}

enum ComplaintStatus {
  OPEN
  IN_REVIEW
  RESOLVED
  CLOSED
}

enum MessageType {
  DIRECT
  BROADCAST_ALL
  BROADCAST_ROUTE
  BROADCAST_BUS
  SYSTEM_EVENT
}

enum CorrectionStatus {
  PENDING
  APPROVED
  REJECTED
}

enum DayOfWeek {
  MON
  TUE
  WED
  THU
  FRI
  SAT
  SUN
}

// ─── USERS ───────────────────────────────────────────────

model User {
  id        String   @id @default(cuid())
  phone     String   @unique
  name      String
  email     String?
  role      Role     @default(STUDENT)
  deviceId  String?
  fcmToken  String?
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  rollNumber    String? @unique
  department    String?
  year          Int?
  licenseNumber String?

  routeAssignment       RouteAssignment?
  attendanceLogs        AttendanceLog[]
  attendanceEvents      AttendanceEvent[]          @relation("EventActor")
  primaryAssignments    BusAssignment[]            @relation("PrimaryDriver")
  substituteAssignments BusAssignment[]            @relation("SubstituteDriver")
  tripsDriven           Trip[]                     @relation("TripDriver")
  incidentsReported     Incident[]                 @relation("IncidentReporter")
  incidentsResolved     Incident[]                 @relation("IncidentResolver")
  coordinatedRoutes     RouteCoordinator[]
  complaints            Complaint[]
  correctionRequests    AttendanceCorrection[]      @relation("CorrectionRequester")
  correctionsReviewed   AttendanceCorrection[]      @relation("CorrectionReviewer")
  messagesSent          Message[]                  @relation("Sender")
  notifications         Notification[]
  tripSkips             TripSkip[]
  waitRequests          WaitRequest[]

  @@index([phone])
  @@index([role])
  @@index([department])
  @@map("users")
}

// ─── BUSES ───────────────────────────────────────────────

model Bus {
  id          String   @id @default(cuid())
  number      String   @unique
  plateNumber String   @unique
  capacity    Int      @default(50)
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  assignments BusAssignment[]
  trips       Trip[]
  incidents   Incident[]
  gpsLogs     GpsLog[]
  messages    Message[]
  complaints  Complaint[]

  @@map("buses")
}

// ─── ROUTES & STOPS ──────────────────────────────────────

model Route {
  id         String      @id @default(cuid())
  name       String      @unique
  area       String
  isActive   Boolean     @default(true)
  activeDays DayOfWeek[]
  createdAt  DateTime    @default(now())
  updatedAt  DateTime    @updatedAt

  stops        RouteStop[]
  assignments  BusAssignment[]
  students     RouteAssignment[]
  coordinators RouteCoordinator[]
  trips        Trip[]
  incidents    Incident[]

  @@map("routes")
}

model Stop {
  id        String   @id @default(cuid())
  name      String
  area      String?
  lat       Float
  lon       Float    // lon not lng — locked forever
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  routeStops       RouteStop[]
  routeAssignments RouteAssignment[]

  @@map("stops")
}

model RouteStop {
  id                   String    @id @default(cuid())
  routeId              String
  stopId               String
  sequence             Int
  scheduledTimeMorning Int       // minutes since midnight (435 = 07:15)
  scheduledTimeReturn  Int       // minutes since midnight (1050 = 17:30)
  isActive             Boolean   @default(true)

  route Route @relation(fields: [routeId], references: [id], onDelete: Cascade)
  stop  Stop  @relation(fields: [stopId], references: [id], onDelete: Cascade)

  @@unique([routeId, stopId])
  @@index([routeId, sequence])
  @@map("route_stops")
}

// ─── ASSIGNMENTS ─────────────────────────────────────────

model BusAssignment {
  id            String    @id @default(cuid())
  busId         String
  routeId       String
  driverId      String
  substituteId  String?
  effectiveFrom DateTime
  effectiveTo   DateTime?
  isActive      Boolean   @default(true)
  createdAt     DateTime  @default(now())

  bus        Bus    @relation(fields: [busId], references: [id])
  route      Route  @relation(fields: [routeId], references: [id])
  driver     User   @relation("PrimaryDriver", fields: [driverId], references: [id])
  substitute User?  @relation("SubstituteDriver", fields: [substituteId], references: [id])
  trips      Trip[]

  @@index([routeId, isActive])
  @@index([driverId, isActive])
  @@map("bus_assignments")
}

model RouteAssignment {
  id            String    @id @default(cuid())
  userId        String    @unique
  routeId       String
  stopId        String
  effectiveFrom DateTime  @default(now())
  effectiveTo   DateTime?
  isActive      Boolean   @default(true)
  isOverride    Boolean   @default(false)
  overrideDate  DateTime?
  createdAt     DateTime  @default(now())

  user  User  @relation(fields: [userId], references: [id])
  route Route @relation(fields: [routeId], references: [id])
  stop  Stop  @relation(fields: [stopId], references: [id])

  @@index([routeId, isActive])
  @@index([userId])
  @@map("route_assignments")
}

model RouteCoordinator {
  id      String @id @default(cuid())
  userId  String
  routeId String

  user  User  @relation(fields: [userId], references: [id], onDelete: Cascade)
  route Route @relation(fields: [routeId], references: [id], onDelete: Cascade)

  @@unique([userId, routeId])
  @@map("route_coordinators")
}

// ─── TRIPS ───────────────────────────────────────────────

model Trip {
  id              String     @id @default(cuid())
  busAssignmentId String?
  busId           String
  routeId         String
  driverId        String
  type            TripType
  status          TripStatus @default(SCHEDULED)
  date            String     // YYYY-MM-DD IST
  expectedCount   Int        @default(0)
  boardedCount    Int        @default(0)
  absentCount     Int        @default(0)
  startedAt       DateTime?
  endedAt         DateTime?
  createdAt       DateTime   @default(now())
  updatedAt       DateTime   @updatedAt

  busAssignment  BusAssignment?  @relation(fields: [busAssignmentId], references: [id])
  bus            Bus             @relation(fields: [busId], references: [id])
  route          Route           @relation(fields: [routeId], references: [id])
  driver         User            @relation("TripDriver", fields: [driverId], references: [id])
  attendanceLogs AttendanceLog[]
  gpsLogs        GpsLog[]
  incidents      Incident[]
  waitRequests   WaitRequest[]

  @@unique([busId, date, type])
  @@index([busId, status])       // CRITICAL — hottest query in system
  @@index([busId, date])
  @@index([routeId, date])
  @@index([date, status])
  @@map("trips")
}

// ─── ATTENDANCE ──────────────────────────────────────────

model AttendanceLog {
  id          String           @id @default(cuid())
  userId      String
  tripId      String
  busId       String
  routeId     String
  date        String           // YYYY-MM-DD IST
  dateKey     String           // "2026-03-18" — for fast exact-match queries
  status      AttendanceStatus @default(PENDING)
  method      CheckInMethod?
  checkedInAt DateTime?

  // Geofence context — logged on EVERY attempt (success + failure)
  studentLat     Float?
  studentLon     Float?
  distanceToBus  Int?
  distanceToStop Int?
  boardedNearStop String?
  geofenceMethod  String?      // "BUS" | "STOP" | "BOTH"
  failReason      String?

  // Arrival verification (college gate check)
  arrivalVerified  Boolean?    // null=unchecked, true=verified, false=flagged
  arrivalLat       Float?
  arrivalLon       Float?
  arrivalDistance  Int?        // metres from college gate
  arrivalCheckedAt DateTime?
  arrivalMethod    String?     // "SOCKET" | "PUSH_NOTIFICATION" | null

  driverNote String?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  user        User                  @relation(fields: [userId], references: [id])
  trip        Trip                  @relation(fields: [tripId], references: [id], onDelete: Cascade)
  events      AttendanceEvent[]
  corrections AttendanceCorrection[]

  @@unique([userId, tripId])
  @@index([userId, dateKey])
  @@index([dateKey])
  @@index([tripId])
  @@index([tripId, status])        // CRITICAL — every admin table query
  @@index([busId, tripId])
  @@index([routeId, dateKey])
  @@index([date, status])
  @@map("attendance_logs")
}

model AttendanceEvent {
  id             String              @id @default(cuid())
  attendanceId   String
  type           AttendanceEventType
  method         CheckInMethod
  actorId        String
  previousStatus AttendanceStatus?
  newStatus      AttendanceStatus
  timestamp      DateTime            @default(now())
  metadata       Json?

  attendance AttendanceLog @relation(fields: [attendanceId], references: [id], onDelete: Cascade)
  actor      User?         @relation("EventActor", fields: [actorId], references: [id], map: "event_actor_fk")

  @@index([attendanceId])
  @@index([timestamp])
  @@map("attendance_events")
}

model AttendanceCorrection {
  id            String           @id @default(cuid())
  attendanceId  String
  requestedById String
  reason        String
  status        CorrectionStatus @default(PENDING)
  reviewedById  String?
  reviewNote    String?
  reviewedAt    DateTime?
  createdAt     DateTime         @default(now())

  attendance  AttendanceLog @relation(fields: [attendanceId], references: [id])
  requestedBy User          @relation("CorrectionRequester", fields: [requestedById], references: [id])
  reviewedBy  User?         @relation("CorrectionReviewer", fields: [reviewedById], references: [id])

  @@index([status, createdAt])
  @@map("attendance_corrections")
}

// ─── TRIP SKIP & WAIT FOR ME ─────────────────────────────

model TripSkip {
  id        String    @id @default(cuid())
  userId    String
  date      String
  type      TripType
  reason    String?
  createdAt DateTime  @default(now())

  user User @relation(fields: [userId], references: [id])

  @@unique([userId, date, type])
  @@index([date, type])
  @@map("trip_skips")
}

model WaitRequest {
  id         String   @id @default(cuid())
  userId     String
  tripId     String
  etaMinutes Int
  status     String   @default("PENDING")
  createdAt  DateTime @default(now())

  user User @relation(fields: [userId], references: [id])
  trip Trip @relation(fields: [tripId], references: [id])

  @@unique([userId, tripId])
  @@index([tripId, createdAt])
  @@map("wait_requests")
}

// ─── GPS ─────────────────────────────────────────────────

model GpsLog {
  id        String   @id @default(cuid())
  busId     String
  tripId    String?
  lat       Float
  lon       Float    // lon not lng
  speed     Float
  heading   Float
  accuracy  Float
  timestamp DateTime

  bus  Bus   @relation(fields: [busId], references: [id], onDelete: Cascade)
  trip Trip? @relation(fields: [tripId], references: [id])

  @@index([busId, timestamp])
  @@index([tripId, timestamp])
  @@map("gps_logs")
}

// ─── INCIDENTS ───────────────────────────────────────────

model Incident {
  id              String          @id @default(cuid())
  tripId          String
  busId           String
  routeId         String?
  reportedById    String
  resolvedById    String?
  type            IncidentType
  status          IncidentStatus  @default(REPORTED)
  description     String
  lat             Float?
  lon             Float?
  escalationLevel EscalationLevel @default(COORDINATOR)
  alternateBusId  String?
  resolutionNotes String?
  reportedAt      DateTime        @default(now())
  assignedAt      DateTime?
  resolvedAt      DateTime?
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  trip       Trip   @relation(fields: [tripId], references: [id])
  bus        Bus    @relation(fields: [busId], references: [id])
  route      Route? @relation(fields: [routeId], references: [id])
  reportedBy User   @relation("IncidentReporter", fields: [reportedById], references: [id])
  resolvedBy User?  @relation("IncidentResolver", fields: [resolvedById], references: [id])

  @@index([busId, status])
  @@index([routeId, createdAt])
  @@index([status, reportedAt])
  @@map("incidents")
}

// ─── COMPLAINTS, MESSAGES, NOTIFICATIONS ─────────────────
// (unchanged from original plan)
```

---

## 5. packages/shared — Complete

### Constants

```typescript
// packages/shared/src/constants/index.ts

export const GEOFENCE = {
  HARD_RADIUS_METRES: 100,
  SOFT_RADIUS_METRES: 150,
  ACCURACY_WARNING_THRESHOLD: 50,
  COLLEGE_GATE_RADIUS_METRES: 500,
  COLLEGE_GATE_LAT: 12.9900,       // UPDATE to real college gate coords
  COLLEGE_GATE_LON: 80.1700,
} as const

export const QR = {
  JWT_EXPIRY_SECONDS: 35,
  REDIS_TTL_SECONDS: 40,           // 5s grace beyond JWT expiry
  REFRESH_PUSH_AT_SECONDS: 25,     // push new QR at t=25s
  GRACE_PERIOD_MS: 5_000,
} as const

export const ARRIVAL_VERIFICATION = {
  PUSH_FALLBACK_DELAY_MS: 2 * 60 * 1000,   // 2 minutes
  VERIFICATION_WINDOW_MS: 7 * 60 * 1000,   // 7 minutes total
  PUSH_TITLE: 'Confirm your arrival',
  PUSH_BODY: 'Tap to verify you\'ve reached college — takes 2 seconds',
} as const

export const GPS = {
  HEARTBEAT_TTL_SECONDS: 120,
  OFFLINE_THRESHOLD_MS: 90_000,    // 90 seconds without ping = OFFLINE
  DELTA_MIN_METRES: 5,             // skip write if moved less than 5m
  PING_MOVING_MS: 3_000,           // 3s when speed > 5 km/h
  PING_SLOW_MS: 15_000,            // 15s when speed <= 5 km/h
  PING_PARKED_MS: 60_000,          // 60s when speed = 0 for 5+ minutes
  RETENTION_DAYS: 30,
} as const

export const TRIP = {
  LATE_START_ALERT_MINUTES: 10,    // alert admin if trip not started 10min late
  OFFLINE_QUEUE_MAX_AGE_MS: 90 * 60 * 1000,  // 90 minutes mobile pre-filter
} as const

export const CACHE_TTL = {
  ACTIVE_TRIP_SECONDS: 300,        // 5 minutes
  ROUTE_ASSIGNMENT_SECONDS: 3600,  // 1 hour
  BUS_ASSIGNMENT_SECONDS: 3600,
} as const
```

### Geo utilities

```typescript
// packages/shared/src/utils/geo.utils.ts

export function getDistanceMetres(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R  = 6_371_000
  const φ1 = lat1 * Math.PI / 180
  const φ2 = lat2 * Math.PI / 180
  const Δφ = (lat2 - lat1) * Math.PI / 180
  const Δλ = (lon2 - lon1) * Math.PI / 180
  const a  = Math.sin(Δφ/2) ** 2 +
             Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export type GeofenceStatus = 'PRESENT' | 'LATE_BOARD' | 'FAIL'
export type GeofenceMethod = 'BUS' | 'STOP' | 'BOTH' | null

export interface GeofenceResult {
  status:        GeofenceStatus
  method:        GeofenceMethod
  distanceToBus: number | null
  distanceToStop: number
}

export function evaluateCheckin(
  studentLat: number,
  studentLon: number,
  busLat:     number | null,
  busLon:     number | null,
  stopLat:    number,
  stopLon:    number,
  hardRadius  = GEOFENCE.HARD_RADIUS_METRES,
  softRadius  = GEOFENCE.SOFT_RADIUS_METRES,
): GeofenceResult {
  const distanceToStop = getDistanceMetres(studentLat, studentLon, stopLat, stopLon)
  const distanceToBus  = busLat !== null && busLon !== null
    ? getDistanceMetres(studentLat, studentLon, busLat, busLon)
    : null

  const minDistance = Math.min(distanceToBus ?? Infinity, distanceToStop)

  const nearBus  = distanceToBus !== null && distanceToBus <= hardRadius
  const nearStop = distanceToStop <= hardRadius
  const method: GeofenceMethod =
    nearBus && nearStop ? 'BOTH' : nearBus ? 'BUS' : nearStop ? 'STOP' : null

  const status: GeofenceStatus =
    minDistance <= hardRadius ? 'PRESENT' :
    minDistance <= softRadius ? 'LATE_BOARD' :
    'FAIL'

  return {
    status,
    method,
    distanceToBus:  distanceToBus !== null ? Math.round(distanceToBus) : null,
    distanceToStop: Math.round(distanceToStop),
  }
}
```

### Time utilities

```typescript
// packages/shared/src/utils/time.utils.ts

// Returns YYYY-MM-DD in IST — never affected by server UTC offset
export function getISODateIST(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata'
  }).format(new Date())
}

// Store schedule times as minutes since midnight
export function minutesToTimeString(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function timeStringToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

export function formatTimeIST(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }).format(date)
}
```

---

## 6. Backend — All Modules

### New endpoints added in final plan

```
// Existing routes (unchanged from original plan)
POST   /v1/auth/login
GET    /v1/auth/me
GET    /v1/student/home          ← BFF endpoint (returns trip+attendance+busId)
POST   /v1/trips/start
PATCH  /v1/trips/:id/start       ← driver starts pre-created trip
POST   /v1/trips/:id/end
GET    /v1/trips/:id/students
POST   /v1/trips/:id/manual-mark
POST   /v1/attendance/checkin
GET    /v1/attendance/today
GET    /v1/attendance/history
POST   /v1/attendance/skip-today
POST   /v1/attendance/wait-for-me
POST   /v1/attendance/correction-request
GET    /v1/attendance/corrections
POST   /v1/attendance/corrections/:id/review
POST   /v1/gps/ping
POST   /v1/incidents/report
POST   /v1/incidents/:id/resolve
POST   /v1/users
POST   /v1/users/bulk-import
GET    /v1/users
PATCH  /v1/users/:id
POST   /v1/users/:id/assign-route
PATCH  /v1/users/:id/fcm-token
GET    /v1/routes
POST   /v1/routes
PATCH  /v1/routes/:id
POST   /v1/messages
POST   /v1/messages/broadcast
GET    /v1/messages/:busId
POST   /v1/messages/:id/reply

// NEW endpoints from final plan
POST   /v1/attendance/verify-arrival    ← college gate arrival verification
GET    /v1/health                       ← production-ready (checks DB + Redis)

// Cloud Tasks job endpoints (internal, requires Cloud Tasks header auth)
POST   /v1/jobs/create-daily-trips      ← nightly trip pre-creation
POST   /v1/jobs/mark-absent             ← run when trip ends
POST   /v1/jobs/gps-cleanup             ← nightly GPS retention
POST   /v1/jobs/gps-heartbeat-check     ← every 60s, per active trip
POST   /v1/jobs/late-start-alert        ← 10min after scheduled departure
POST   /v1/jobs/arrival-push-fallback   ← 2min after gate:reached if no response
```

### Check-in service — complete hardened sequence

```typescript
// apps/backend/src/modules/attendance/attendance.service.ts

async checkIn(userId: string, deviceId: string, payload: CheckinPayload) {
  const { qrToken, lat, lon, accuracy, clientTimestamp, isReplay } = payload

  // [1] Rate limit: 3 req/60s per userId
  const rateLimitKey = `rate:checkin:${userId}`
  const count = await redis.incr(rateLimitKey)
  if (count === 1) await redis.expire(rateLimitKey, 60)
  if (count > 3) throw new TooManyRequestsError('RATE_LIMITED')

  // [2] Decode QR JWT (don't verify yet — extract nonce first)
  let qrPayload: QRPayload
  try {
    qrPayload = jwt.decode(qrToken) as QRPayload
  } catch {
    throw new BadRequestError('QR_INVALID')
  }

  // [3] GETDEL nonce — single atomic operation
  const nonce = await redis.getdel(`qr:nonce:${qrPayload.nonce}`)
  if (!nonce) throw new ConflictError('QR_ALREADY_USED')

  // [4] Verify JWT signature + expiry with 5s grace
  try {
    jwt.verify(qrToken, process.env.JWT_SECRET!)
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      const decoded = jwt.decode(qrToken) as any
      const expiredAgo = Date.now() - decoded.exp * 1000
      if (expiredAgo > QR.GRACE_PERIOD_MS) throw new BadRequestError('QR_EXPIRED')
      // within grace period — continue
    } else {
      throw new BadRequestError('QR_INVALID')
    }
  }

  // [5] deviceId guard
  const user = await getUserCached(userId)
  if (user.deviceId && user.deviceId !== deviceId) {
    throw new ForbiddenError('DEVICE_MISMATCH')
  }

  // [6] Get active trip — Redis cache first
  const trip = await getActiveTripCached(qrPayload.busId)
  if (!trip || trip.status !== 'ACTIVE') throw new BadRequestError('TRIP_NOT_ACTIVE')
  if (trip.id !== qrPayload.tripId) throw new BadRequestError('TRIP_MISMATCH')

  // [7] Verify student is assigned to this bus
  const assignment = await getRouteAssignmentCached(userId)
  if (!assignment) throw new BadRequestError('NO_ROUTE_ASSIGNMENT')

  // Check it's the right bus via route
  const busRoute = await getBusRouteCached(qrPayload.busId)
  if (assignment.routeId !== busRoute.routeId) throw new BadRequestError('WRONG_BUS')

  // [8] Get bus GPS position from Firebase RTDB
  const busGps = await firebase
    .database().ref(`/buses/${qrPayload.busId}`).once('value')
    .then(s => s.val())

  // [9] Haversine geofence check
  const stop = await prisma.stop.findUnique({ where: { id: assignment.stopId } })
  const geofence = evaluateCheckin(
    lat, lon,
    busGps?.lat ?? null, busGps?.lon ?? null,
    stop!.lat, stop!.lon
  )

  // [10] Idempotency check
  const existing = await prisma.attendanceLog.findUnique({
    where: { userId_tripId: { userId, tripId: trip.id } }
  })
  if (existing?.status === 'PRESENT' || existing?.status === 'LATE_BOARD') {
    return { status: 'ALREADY_CHECKED_IN', checkedInAt: existing.checkedInAt }
  }

  if (geofence.status === 'FAIL') {
    // Log the attempt even on failure — correction evidence
    await prisma.attendanceLog.upsert({
      where: { userId_tripId: { userId, tripId: trip.id } },
      update: {
        studentLat: lat, studentLon: lon,
        distanceToBus: geofence.distanceToBus,
        distanceToStop: geofence.distanceToStop,
        failReason: 'GEOFENCE',
      },
      create: {
        userId, tripId: trip.id, busId: trip.busId,
        routeId: trip.routeId,
        date: getISODateIST(),
        dateKey: getISODateIST(),
        status: 'PENDING',
        studentLat: lat, studentLon: lon,
        distanceToBus: geofence.distanceToBus,
        distanceToStop: geofence.distanceToStop,
        failReason: 'GEOFENCE',
      }
    })
    throw new BadRequestError('TOO_FAR', {
      distanceToBus: geofence.distanceToBus,
      distanceToStop: geofence.distanceToStop,
    })
  }

  // [11] Write attendance — single transaction
  const attendanceStatus = geofence.status  // 'PRESENT' or 'LATE_BOARD'

  const [log] = await prisma.$transaction([
    prisma.attendanceLog.upsert({
      where: { userId_tripId: { userId, tripId: trip.id } },
      update: {
        status: attendanceStatus,
        method: 'QR_SCAN',
        checkedInAt: new Date(),
        studentLat: lat, studentLon: lon,
        distanceToBus: geofence.distanceToBus,
        distanceToStop: geofence.distanceToStop,
        geofenceMethod: geofence.method,
      },
      create: {
        userId, tripId: trip.id, busId: trip.busId,
        routeId: trip.routeId,
        date: getISODateIST(),
        dateKey: getISODateIST(),
        status: attendanceStatus,
        method: 'QR_SCAN',
        checkedInAt: new Date(),
        studentLat: lat, studentLon: lon,
        distanceToBus: geofence.distanceToBus,
        distanceToStop: geofence.distanceToStop,
        geofenceMethod: geofence.method,
      }
    }),
    prisma.attendanceEvent.create({
      data: {
        attendanceId: existing?.id ?? 'will-be-set',
        type: 'CHECK_IN',
        method: 'QR_SCAN',
        actorId: userId,
        previousStatus: existing?.status ?? null,
        newStatus: attendanceStatus,
        metadata: {
          distanceToBus: geofence.distanceToBus,
          distanceToStop: geofence.distanceToStop,
          geofenceMethod: geofence.method,
          accuracy,
          overrodeTripSkip: !!(await prisma.tripSkip.findUnique({
            where: { userId_date_type: { userId, date: getISODateIST(), type: trip.type } }
          })),
        }
      }
    }),
    prisma.trip.update({
      where: { id: trip.id },
      data: { boardedCount: { increment: 1 } }
    })
  ])

  // [12] Emit to admin and driver kiosk
  io.to(`trip:${trip.id}`).emit('checkin:success', {
    userId,
    name: user.name,
    status: attendanceStatus,
  })

  // [13] Structured log
  fastify.log.info({
    event: 'checkin_attempt',
    userId, tripId: trip.id, busId: trip.busId,
    distanceToBus: geofence.distanceToBus,
    distanceToStop: geofence.distanceToStop,
    geofenceMethod: geofence.method,
    result: attendanceStatus,
    isReplay: !!isReplay,
  })

  return {
    status: 'CHECKED_IN',
    attendanceStatus,
    checkedInAt: new Date(),
    distanceToBus: geofence.distanceToBus,
    distanceToStop: geofence.distanceToStop,
  }
}
```

---

## 7. Mobile App — All Screens

### QRScanner — updated with parallel GPS prefetch

```typescript
// Key change from original: start GPS fetch BEFORE scan
export default function QRScannerScreen() {
  const [permission, requestPermission] = useCameraPermissions()
  const [scanned, setScanned]           = useState(false)
  const [loading, setLoading]           = useState(false)
  const locationRef = useRef<Location.LocationObject | null>(null)

  // Start GPS fetch immediately on screen mount — parallel with camera
  useEffect(() => {
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      .then(loc => { locationRef.current = loc })
      .catch(() => {})  // silent — we'll try again on scan
  }, [])

  const handleScan = async ({ data }: { data: string }) => {
    if (scanned || loading) return
    setScanned(true)
    setLoading(true)

    try {
      // Use pre-fetched location or fetch now if not ready
      const location = locationRef.current
        ?? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })

      if (location.coords.accuracy && location.coords.accuracy > 50) {
        // Warn but don't block
      }

      await submitCheckIn(data, location)
    } catch (err: any) {
      handleError(err)
      setScanned(false)
    } finally {
      setLoading(false)
    }
  }
  // ... rest unchanged
}
```

### Offline queue hook

```typescript
// hooks/useOfflineCheckinQueue.ts
export const useOfflineCheckinQueue = () => {

  const flushQueue = async () => {
    const raw = await AsyncStorage.getItem('checkin_queue')
    if (!raw) return
    const queue: QueuedCheckin[] = JSON.parse(raw)
    const remaining: QueuedCheckin[] = []

    for (const item of queue) {
      // Layer 1: mobile pre-filter
      if (Date.now() - item.queuedAt > TRIP.OFFLINE_QUEUE_MAX_AGE_MS) {
        showExpiredToast()
        continue
      }
      try {
        const result = await api.post('/v1/attendance/checkin', { ...item, isReplay: true })
        if (result.status === 201 || result.status === 200) {
          showSuccessToast('Check-in confirmed')
        } else {
          remaining.push(item)
        }
      } catch (err: any) {
        if (err.status === 410) {
          // Trip ended — offer correction
          showCorrectionPrompt(item)
        } else if (err.status === 409) {
          // Already checked in — was successful earlier
          showSuccessToast('Already checked in')
        } else if (item.retries < 3) {
          remaining.push({ ...item, retries: item.retries + 1 })
        } else {
          showFailureToast()
        }
      }
    }
    await AsyncStorage.setItem('checkin_queue', JSON.stringify(remaining))
  }

  // Flush on: app foreground, network reconnect
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') flushQueue()
    })
    return () => sub.remove()
  }, [])
}
```

### Arrival verification screen

```typescript
// app/(student)/verify-arrival.tsx
// Deep linked from FCM push notification
export default function VerifyArrivalScreen() {
  const params = useLocalSearchParams<{ tripId: string }>()

  useEffect(() => {
    const verify = async () => {
      try {
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced
        })
        await api.post('/v1/attendance/verify-arrival', {
          tripId: params.tripId,
          lat: location.coords.latitude,
          lon: location.coords.longitude,
          accuracy: location.coords.accuracy,
          method: 'PUSH_NOTIFICATION',
        })
      } catch {
        // Silent failure — null treated as verified (benefit of doubt)
      } finally {
        // Auto-close after 1.5s
        setTimeout(() => router.back(), 1500)
      }
    }
    verify()
  }, [])

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#16a34a" />
      <Text style={styles.text}>Verifying your arrival...</Text>
    </View>
  )
}
```

---

## 8. Admin Panel — All Screens

### New: Late Start Alert on Dashboard

The dashboard shows a red alert card for any bus that hasn't started its trip
10 minutes after scheduled departure time.

```typescript
// Admin dashboard — live alerts section
const { data: lateStarts } = useQuery({
  queryKey: ['late-starts'],
  queryFn: () => apiClient.get('/v1/trips/late-starts').then(r => r.data),
  refetchInterval: 60_000,
})

// Shows:
// "Bus 12 — Tambaram Route — scheduled 8:00am — not started (12 min late)"
// [Contact Driver] [Force Start] buttons
```

### New: Arrival verification column in attendance table

Attendance table gets a new column showing arrival verification status:
- Green checkmark: verified at college gate
- Orange flag: location outside 500m (flagged)
- Gray dash: no response (treated as present)

---

## 9. Infrastructure & Jobs

### Nightly trip pre-creation job (11pm daily)

```typescript
// apps/backend/src/jobs/create-daily-trips.job.ts
export async function createDailyTrips() {
  const tomorrow = getISODateIST() // run at 11pm, creates for next day

  const assignments = await prisma.busAssignment.findMany({
    where: { isActive: true },
    include: {
      route: { include: { students: { where: { isActive: true } } } }
    }
  })

  for (const assignment of assignments) {
    const expectedCount = assignment.route.students.length

    // Check if today is an active day for this route
    const dayOfWeek = getTomorrowDayOfWeek()
    if (!assignment.route.activeDays.includes(dayOfWeek)) continue

    await prisma.trip.createMany({
      data: [
        {
          busAssignmentId: assignment.id,
          busId: assignment.busId,
          routeId: assignment.routeId,
          driverId: assignment.driverId,
          type: 'MORNING',
          status: 'SCHEDULED',
          date: tomorrow,
          expectedCount,
        },
        {
          busAssignmentId: assignment.id,
          busId: assignment.busId,
          routeId: assignment.routeId,
          driverId: assignment.driverId,
          type: 'RETURN',
          status: 'SCHEDULED',
          date: tomorrow,
          expectedCount,
        },
      ],
      skipDuplicates: true,
    })
  }
}
```

### GPS heartbeat check job (every 60s)

```typescript
// apps/backend/src/jobs/gps-heartbeat.job.ts
export async function checkGpsHeartbeats() {
  const activeTrips = await prisma.trip.findMany({
    where: { status: 'ACTIVE' },
    select: { busId: true }
  })

  for (const { busId } of activeTrips) {
    const lastPing = await redis.get(`gps:heartbeat:${busId}`)
    const isOffline = !lastPing || (Date.now() - Number(lastPing)) > GPS.OFFLINE_THRESHOLD_MS

    await firebase.database()
      .ref(`/buses/${busId}/gpsStatus`)
      .set(isOffline ? 'OFFLINE' : 'LIVE')
  }
}
```

### GPS retention job (nightly)

```typescript
// apps/backend/src/jobs/gps-cleanup.job.ts
export async function cleanupGpsLogs() {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - GPS.RETENTION_DAYS)

  await prisma.gpsLog.deleteMany({
    where: { timestamp: { lt: cutoff } }
  })
}
```

### Health check — production ready

```typescript
// GET /health
fastify.get('/health', async (req, reply) => {
  const [dbCheck, redisCheck] = await Promise.allSettled([
    prisma.$queryRaw`SELECT 1`,
    redis.ping(),
  ])
  const db    = dbCheck.status    === 'fulfilled' ? 'ok' : 'error'
  const cache = redisCheck.status === 'fulfilled' ? 'ok' : 'error'
  const healthy = db === 'ok' && cache === 'ok'

  reply.code(healthy ? 200 : 503)
  return {
    status: healthy ? 'ok' : 'degraded',
    db, cache,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  }
})
```

---

## 10. Build Order

Build in this exact sequence. Each step unlocks testing for the next.

```
1.  Monorepo scaffold — Turborepo + TypeScript + ESLint + Prettier + Husky
    → verify: pnpm build runs clean

2.  packages/shared — types, constants (with all new values), geo.utils, time.utils
    → verify: pnpm build in packages/shared

3.  Docker Compose up — local Postgres + Redis
    → verify: both containers healthy

4.  Prisma schema migration — apply final schema with all changes
    → verify: npx prisma studio shows all tables

5.  Seed script
    → verify: 5 students, 1 driver, 1 coordinator, 1 bus, 1 route visible in Studio

6.  Backend: lib layer — prisma.ts, redis.ts, firebase.ts, msg91.ts
    → verify: all clients connect without error

7.  Backend: auth module — Firebase verify, JWT, RBAC middleware
    → verify: POST /auth/login with test phone returns JWT

8.  Backend: /health endpoint
    → verify: GET /health returns 200 with db:ok, cache:ok

9.  Backend: /student/home BFF endpoint
    → verify: returns trip, attendance, busId for a test student

10. Backend: QR module — generate, store nonce, Socket.io push
    → verify: GET /trips/:id/qr returns JWT token + nonce in Redis

11. Backend: attendance check-in — full 13-step sequence
    → verify: POST /attendance/checkin with valid QR → 201
    → verify: same QR again → 409 QR_ALREADY_USED
    → verify: expired QR → 400 QR_EXPIRED

12. Backend: GPS module — ping endpoint + Firebase write + heartbeat
    → verify: POST /gps/ping writes to Firebase RTDB + gps_logs table

13. Backend: trips module — start, end, nightly pre-creation job
    → verify: PATCH /trips/:id/start sets status ACTIVE + Redis cache

14. Backend: absence marking job
    → verify: run job manually → all PENDING students → ABSENT

15. Backend: arrival verification — gate detection + push fallback
    → verify: POST /attendance/verify-arrival sets arrivalVerified

16. Backend: remaining modules — incidents, notifications, users, messages
    → verify: each endpoint responds correctly

17. Mobile: auth screens (login + verify-otp)
    → verify: full OTP flow on real device

18. Mobile: driver kiosk — QR display + Socket.io refresh + fallback polling
    → verify: QR refreshes every 25s, fallback works on socket drop

19. Mobile: student home — BFF hydration + Firebase GPS subscription
    → verify: bus location updates live on map

20. Mobile: QR scanner — parallel GPS prefetch + check-in + offline queue
    → verify: end-to-end check-in flow

21. Mobile: verify-arrival deep link screen
    → verify: tapping FCM notification opens screen, fires GPS, closes

22. Admin panel: auth + attendance table + correction queue + live alerts
    → verify: admin sees live check-in counter update via Socket.io

23. Admin panel: student CRUD + bulk import + route management
    → verify: import 10 students from CSV

24. CI/CD: GitHub Actions pipeline
    → verify: push to main triggers test → build → migrate → deploy

25. ✅ Full end-to-end test:
    Nightly job creates trips → driver starts trip → driver opens kiosk
    → student scans QR → marked PRESENT → bus reaches college gate
    → arrival verification fires → admin sees full attendance
    → driver ends trip → absent marking runs
```

---

## 11. Critical Rules for Claude Code

These rules must be followed in every file generated. Non-negotiable.

### Architecture rules
1. `packages/shared` is the single source of truth. Types, constants, geo utils, time utils — defined once, imported everywhere. Never duplicate.
2. Backend follows Routes → Service → Repository pattern in every module.
3. Every attendance write is wrapped in `prisma.$transaction()`. No exceptions.
4. QR nonce burn uses Redis `GETDEL` (single atomic operation). Never GET then DEL.
5. `activeDays` uses `DayOfWeek[]` enum — never raw strings.
6. Schedule times stored as `Int` (minutes since midnight). Never strings.

### Naming rules
7. `lon` not `lng` everywhere — coordinates, schema, payloads, variables.
8. `dateKey` is always `"YYYY-MM-DD"` string. `date` columns on Trip and AttendanceLog are also strings. Never DateTime for date-only fields.

### Performance rules
9. Hot read paths (active trip, route assignment, bus assignment) read from Redis cache first, fall through to DB on miss.
10. GPS writes to Firebase RTDB include: `{ lat, lon, speed, heading, gpsStatus, lastUpdated }` — never just lat/lon.
11. GPS heartbeat key set on every ping: `SET gps:heartbeat:{busId} = Date.now() EX 120`.

### Security rules
12. Firebase service account loaded from `process.env.FIREBASE_SERVICE_ACCOUNT_JSON` as JSON string. Never a file path.
13. All secrets from GCP Secret Manager in production. Never plain-text env vars on Cloud Run.
14. Prisma migrations run as a Cloud Run Job in CI/CD pipeline. Never in application startup code.

### DevOps rules
15. `GET /health` checks DB + Redis and returns 503 if either is down.
16. Structured JSON logging on every check-in attempt (event, userId, tripId, result, durationMs).
17. Cloud Run: `min-instances=2`, `cpu-throttling=false`, `max-instances=20`.

---

*College Bus Management System — Phase 1 Final Plan*
*Decisions locked: March 2026*
*Status: Ready to build with Claude Code*
