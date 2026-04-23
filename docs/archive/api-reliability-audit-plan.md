# College Bus Management System
# API Reliability & Structural Integrity Audit Plan
# Running locally · Basic manual testing done

> Purpose: Find every place where the contract between frontend and backend is wrong,
> missing, assumed, or fragile — before the system goes to a real device.
>
> This is not a feature audit. This is a correctness audit.
> Every item here is a potential production failure.

---

## How to use this document

Work through each section in order. Each item has:
- **What to check** — the specific thing being verified
- **How to check it** — the exact command, code, or test to run
- **Pass condition** — what "correct" looks like
- **Fail action** — what to do if it fails

Mark each item ✅ PASS / ❌ FAIL / ⚠️ PARTIAL as you go.
Do not skip items. Every skip is a future production incident.

---

## Section 1 — Contract Correctness (Backend → Mobile)

These are the endpoints the mobile app calls. Verify that what the backend
actually returns matches what the mobile app actually consumes.

### 1.1 GET /v1/student/home — The most important endpoint

This endpoint feeds the entire student home screen. If it returns wrong data,
the most-used screen in the system is broken.

**What to check:**

Run the endpoint with a real student token and verify every field exists
and is the correct type:

```bash
# Get a student token first
curl -X POST http://localhost:3000/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"firebaseToken": "TEST_TOKEN", "deviceId": "test-device-123"}'

# Store the token
TOKEN="<paste token here>"

# Call the home endpoint
curl http://localhost:3000/v1/student/home \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Verify the response contains ALL of these fields (none can be null or missing):**

```typescript
// Paste the actual response into this checker mentally or in a script:
{
  student: {
    id: string,           // ← check: exists, not null
    name: string,         // ← check: real name, not undefined
    rollNumber: string,   // ← check: exists
    department: string,   // ← check: exists
    year: number,         // ← check: number not string
    busNumber: string,    // ← check: exists if assigned
    stopName: string,     // ← check: exists if assigned
  },
  trip: {
    id: string,
    status: 'SCHEDULED' | 'ACTIVE' | 'COMPLETED',
    busNumber: string,
    driverName: string,           // ← AUDIT FLAG: was null in code audit
    scheduledDeparture: string,   // ← AUDIT FLAG: was missing
    minutesLate: number,          // ← AUDIT FLAG: was missing
    substitute: null | {
      busNumber: string,
      driverName: string,
    }
  } | null,
  attendance: {
    status: string | null,
    checkedInAt: string | null,
    percentage: number,           // ← AUDIT FLAG: was null in code audit
    presentCount: number,         // ← AUDIT FLAG: was null
    absentCount: number,          // ← AUDIT FLAG: was null
    pendingCorrections: number,   // ← AUDIT FLAG: was null
  },
  alerts: {
    yesterdayAbsent: boolean,     // ← AUDIT FLAG: was hard-disabled
    substituteAssigned: boolean,  // ← AUDIT FLAG: was hard-disabled
    correctionPending: boolean,
    unassigned: boolean,
  }
}
```

**Pass condition:** Every field exists with the correct type. No nulls on fields
that are supposed to be calculated values (percentage, presentCount, etc.)

**Fail action:** Apply Fix 2 from integration-fix-guide.md before proceeding.
This endpoint must be correct before any frontend work begins.

---

### 1.2 GET /v1/driver/today — Driver pre-trip screen

```bash
# Get a driver token
TOKEN="<driver token>"

curl http://localhost:3000/v1/driver/today \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Verify:**
```
driver.id           → string, not null
driver.name         → string, real name
assignment.busNumber → string
assignment.routeName → string  
assignment.scheduledDeparture → "07:15" format (HH:MM)
assignment.expectedStudents  → number
trip.status         → 'SCHEDULED' | 'ACTIVE' | 'COMPLETED' | null
trip.minutesLate    → number (0 if on time, positive if late)
substituteFor       → null or { originalDriverName, originalBusNumber }
```

**Fail condition:** Any field is undefined, null when it shouldn't be,
or the wrong type.

---

### 1.3 POST /v1/attendance/checkin — The core transaction

This is the most critical endpoint in the system. Test every possible response
code and verify the mobile app handles each one correctly.

```bash
# Test 1: Valid check-in
curl -X POST http://localhost:3000/v1/attendance/checkin \
  -H "Authorization: Bearer $STUDENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "qrToken": "<valid QR token from active trip>",
    "lat": 12.9716,
    "lon": 80.2209,
    "accuracy": 15,
    "clientTimestamp": '$(date +%s000)'
  }' | jq .

# Expected: 201 { status: "PRESENT", checkedInAt: "...", busNumber: "..." }
```

**All response scenarios to test:**

| Scenario | How to test | Expected response |
|---|---|---|
| Valid check-in, within range | Valid QR, coords within 150m | 201 `{ status: "PRESENT" }` |
| Valid but soft zone 100-150m | Valid QR, coords 120m from stop | 201 `{ status: "LATE_BOARD" }` |
| Too far (>150m) | Valid QR, coords 200m away | 400 `{ error: "TOO_FAR", distance: 200 }` |
| QR expired | Expired token | 400 `{ error: "QR_EXPIRED" }` |
| QR already used | Same token twice | 409 `{ error: "QR_ALREADY_USED" }` |
| Wrong bus | Token from different bus | 403 `{ error: "ROUTE_MISMATCH", correctBus: "Bus 12" }` |
| Trip not active | QR from scheduled (not started) trip | 400 `{ error: "TRIP_NOT_ACTIVE" }` |
| Already checked in | Check in twice | 409 `{ error: "ALREADY_CHECKED_IN" }` |
| Device mismatch | Request from wrong device | 401 `{ error: "DEVICE_MISMATCH" }` |
| Rate limited | 10+ attempts in 60s | 429 `{ error: "RATE_LIMITED", retryAfter: 60 }` |
| Offline replay | isReplay: true, within time window | 200 or 409 (idempotent) |
| Offline replay expired | isReplay: true, after 2h | 410 `{ error: "TRIP_EXPIRED" }` |

**Pass condition:** Every row returns the exact error code listed. No generic 500s.
No missing `error` field in the response body.

**Critical: verify the mobile app maps each code to a human message**

In `apps/mobile/app/(student)/checkin-fail.tsx`, verify these mappings exist:

```typescript
// Every backend error code must have a mobile message
const ERROR_MESSAGES = {
  TOO_FAR:           (meta) => `You're ${meta.distance}m away. Move closer and try again.`,
  QR_EXPIRED:        'Code expired. Ask the driver for a fresh one.',
  QR_ALREADY_USED:   'This code was just used. Wait for the next one.',
  ROUTE_MISMATCH:    (meta) => `Wrong bus. Your bus is ${meta.correctBus}.`,
  TRIP_NOT_ACTIVE:   "Trip hasn't started yet.",
  ALREADY_CHECKED_IN:'Already checked in today.',
  DEVICE_MISMATCH:   'Login detected on another device.',
  RATE_LIMITED:      'Too many attempts. Wait 1 minute.',
  TRIP_EXPIRED:      'Trip has ended. Request a correction.',
}

// FAIL if any code from the backend has no entry here
// FAIL if any message shows raw error codes to the user
```

---

### 1.4 GET /v1/attendance/history — Pagination contract

```bash
curl "http://localhost:3000/v1/attendance/history?page=1&limit=20" \
  -H "Authorization: Bearer $STUDENT_TOKEN" | jq .
```

**Verify:**
```
{
  data: Array of attendance logs,
  pagination: {
    page: number,
    limit: number,
    total: number,
    hasMore: boolean,    // ← must exist for infinite scroll
  }
}
```

**Test pagination boundary:**
```bash
# Last page
curl "http://localhost:3000/v1/attendance/history?page=999&limit=20" \
  -H "Authorization: Bearer $STUDENT_TOKEN" | jq .

# Expected: { data: [], pagination: { hasMore: false } }
# FAIL if: 404, 500, or missing pagination object
```

---

### 1.5 Socket.io events — Verify all emitted events match documented contract

**Add this debug listener to the mobile app temporarily:**

```typescript
// Paste this into apps/mobile/lib/socket.ts for testing
const socket = getSocket()
socket.onAny((event, ...args) => {
  console.log('[SOCKET EVENT]', event, JSON.stringify(args))
})
```

**Then start a trip with a driver account and verify these events fire:**

| Event | Triggered by | Expected payload |
|---|---|---|
| `qr:refresh` | Every 30s on active trip | `{ qrToken: string, expiresAt: number }` |
| `checkin:success` | Student checks in | `{ userId, name, status, distanceToStop }` |
| `wait:request` | Student taps wait-for-me | `{ studentName, etaMinutes }` |
| `admin:message` | Admin sends message to bus | `{ body, isUrgent, sentAt }` |
| `incident:reported` | Driver reports breakdown | `{ incidentId, tripId, incidentType }` |
| `gps:position` | Backend GPS heartbeat | `{ busId, lat, lon, speed, heading }` |

**Pass condition:** All 6 events fire with the correct payload shape.
**Fail condition:** Any event fires with missing fields, or doesn't fire at all.

Note: `incident:reported` and `gps:position` were missing from SOCKET_EVENT_REGISTRY.md.
Verify they exist in `apps/backend/src/modules/incidents/incidents.service.ts`
and `apps/backend/src/modules/gps/gps.service.ts`.

---

## Section 2 — Timezone Integrity Audit

The code audit found `new Date().toISOString().split('T')[0]` in three backend files.
This returns the wrong date between 18:30 UTC and 00:00 UTC (= 23:00–05:30 IST).
The nightly trip creation job runs at 23:00 IST. This will silently create trips
for the wrong day.

### 2.1 Find all remaining UTC date splits

```bash
# Run from monorepo root
echo "=== Searching for UTC date splits in backend ==="
grep -rn "toISOString().split\|\.split('T')\[0\]" apps/backend/src/

echo ""
echo "=== Expected: 0 results ==="
echo "=== If any results appear, Fix 1 from integration-fix-guide.md is not complete ==="
```

### 2.2 Verify the shared IST helper exists and is correct

```bash
cat packages/shared/src/utils/time.utils.ts
```

**Verify this function exists and uses IST offset (5.5 hours = 330 minutes):**

```typescript
// CORRECT — must look like this:
export const getTodayDateKey = (): string => {
  const now = new Date()
  const istOffset = 5.5 * 60 * 60 * 1000  // 330 minutes in ms
  const istDate = new Date(now.getTime() + istOffset)
  return istDate.toISOString().split('T')[0]
}

// WRONG — any version that doesn't add the IST offset:
export const getTodayDateKey = (): string => {
  return new Date().toISOString().split('T')[0]  // UTC — wrong
}
```

### 2.3 Test the timezone boundary

```bash
# Simulate a server in UTC (as GCP Cloud Run runs in UTC by default)
node -e "
const now = new Date()
const utc = now.toISOString().split('T')[0]
const istOffset = 5.5 * 60 * 60 * 1000
const ist = new Date(now.getTime() + istOffset).toISOString().split('T')[0]

console.log('UTC date key:', utc)
console.log('IST date key:', ist)
console.log('Same?', utc === ist)

// If they differ: UTC split would have created trips for wrong day
// The IST key is always correct
"
```

**Pass condition:** The backend uses `getTodayDateKey()` from shared utils everywhere.
Zero `toISOString().split('T')[0]` calls remain in backend business logic.

---

## Section 3 — Authentication & Device Binding Audit

### 3.1 Verify device binding is enforced on ALL endpoints (not just check-in)

```bash
# Step 1: Get a valid token for device A
TOKEN_A="<token for device A>"

# Step 2: Manually create a token for device B
# (modify deviceId in the JWT or test via the backend auth service)

# Step 3: Call any protected endpoint with device B's token
curl http://localhost:3000/v1/student/home \
  -H "Authorization: Bearer $TOKEN_B_WRONG_DEVICE" | jq .

# Expected: 401 { error: "DEVICE_MISMATCH" }
# FAIL if: 200 returned (device binding not enforced)
```

### 3.2 Verify session version invalidation works

```bash
# Step 1: Get a valid token
TOKEN="<valid token>"

# Step 2: Admin revokes the session (simulate via backend)
# POST /v1/admin/users/:id/revoke-session

# Step 3: Use the old token
curl http://localhost:3000/v1/student/home \
  -H "Authorization: Bearer $TOKEN" | jq .

# Expected: 401 { error: "SESSION_REVOKED" }
# FAIL if: 200 returned (old token still works after revocation)
```

### 3.3 Verify admin cookie auth enforces CSRF

```bash
# Try an unsafe request (POST) without the CSRF token
curl -X POST http://localhost:3000/v1/admin/corrections/approve \
  -H "Cookie: session=<valid_session_cookie>" \
  -H "Content-Type: application/json" \
  -d '{"correctionId": "test-123", "approved": true}' | jq .

# Expected: 403 { error: "CSRF_VALIDATION_FAILED" }
# FAIL if: 200 returned (CSRF not enforced)
```

---

## Section 4 — Background Jobs Integrity Audit

The 7 background jobs are the backbone of the system. If any fail silently,
attendance is wrong, GPS shows stale data, or trips never get created.

### 4.1 create-daily-trips job — P0

This job creates tomorrow's trips every night at 23:00 IST.
If this fails, no student can check in the next morning.

```bash
# Manually trigger the job endpoint
curl -X POST http://localhost:3000/v1/jobs/create-daily-trips \
  -H "Authorization: Bearer $INTERNAL_JOB_TOKEN" | jq .

# Expected:
# { success: true, tripsCreated: N, date: "YYYY-MM-DD" }

# Verify the date field uses IST (tomorrow in IST, not UTC tomorrow)
# If running after 18:30 UTC, the dates will differ

# Also verify: no N+1 queries
# Check backend logs for individual INSERT statements vs bulk createMany
```

**Verify idempotency:**
```bash
# Run the job twice for the same date
curl -X POST http://localhost:3000/v1/jobs/create-daily-trips ...
curl -X POST http://localhost:3000/v1/jobs/create-daily-trips ...

# Expected: second call returns { tripsCreated: 0 } (already exists)
# FAIL if: duplicate trips created, or 500 error
```

### 4.2 mark-absent job — P0

```bash
# Manually end a trip, then verify mark-absent fires
curl -X POST http://localhost:3000/v1/trips/:id/end \
  -H "Authorization: Bearer $DRIVER_TOKEN" | jq .

# After job runs, check attendance logs for students who didn't check in
# Every student on the route should be either PRESENT or ABSENT — nothing missing
```

### 4.3 gps-heartbeat-check job — P0

```bash
# Start a trip, stop sending GPS pings, wait 90 seconds
# Then check the bus status in Redis
redis-cli GET "gps:status:BUS_ID"

# Expected: "STALE" or "OFFLINE" after 90s of no pings
# Expected: admin dashboard shows amber GPS dot
# FAIL if: bus still shows "LIVE" after 2+ minutes of no pings
```

### 4.4 Verify all 7 jobs have OIDC auth (not just header check)

```bash
# Try calling a job endpoint without any auth
curl -X POST http://localhost:3000/v1/jobs/create-daily-trips | jq .

# Expected: 401 Unauthorized
# FAIL if: job runs without authentication
# This means any external caller could trigger your jobs
```

---

## Section 5 — GPS Pipeline Integrity Audit

### 5.1 Firebase RTDB write → mobile read latency

```typescript
// Test in the mobile app with a connected driver device
// Log timestamps at both ends:

// Backend GPS service (apps/backend/src/modules/gps/gps.service.ts):
console.log('[GPS] Writing to Firebase:', Date.now())

// Mobile map screen (apps/mobile/app/(student)/map.tsx):
firebase.database().ref(`/buses/${busId}`).on('value', (snap) => {
  console.log('[GPS] Received in mobile:', Date.now())
})

// Expected: < 500ms end-to-end
// FAIL if: > 2 seconds (Firebase has likely caching or persistence issue)
```

### 5.2 Delta compression — verify skips work

```bash
# GPS task should skip writes if bus moved < 5 metres
# Add logging to gps.task.ts:

console.log('[GPS TASK] Distance from last:', distance, '→', distance < 5 ? 'SKIP' : 'WRITE')

# Verify in logs: pings are skipped when bus is stationary
# FAIL if: every 3 seconds produces a write regardless of movement
```

### 5.3 Offline persistence — verify map works without network

```typescript
// In apps/mobile/lib/firebase.ts, verify this is called BEFORE any DB operation:
firebase.database().setPersistenceEnabled(true)
firebase.database().ref('/buses').keepSynced(true)

// Test: 
// 1. Open map screen with active GPS
// 2. Turn off mobile data
// 3. Navigate away and back to map screen
// Expected: last known bus position still shows
// Expected: amber "GPS offline" banner appears
// FAIL if: map shows blank or error with no network
```

---

## Section 6 — Frontend State Architecture Audit

### 6.1 Verify no raw Axios calls exist in screen components

```bash
# Search for direct axios/api calls in screen files
echo "=== Direct API calls in screens (should be 0) ==="
grep -rn "axios\.\|api\.get\|api\.post\|api\.patch\|api\.delete" \
  apps/mobile/app/ | grep -v "test\|spec"

echo ""
echo "=== All API calls should be in hooks/ or lib/ — not in app/ screens ==="
```

**Pass condition:** Zero results.
**Fail action:** Move any found API calls into the appropriate hook.

### 6.2 Verify TanStack Query config

```bash
cat apps/mobile/lib/query-client.ts
```

**Verify these settings exist:**
```typescript
defaultOptions: {
  queries: {
    networkMode: 'offlineFirst',  // ← MUST exist
    staleTime: 5 * 60 * 1000,    // ← minimum 5 minutes
    retry: 2,                     // ← retries on failure
    // keepPreviousData equivalent:
    placeholderData: keepPreviousData,  // ← prevents flicker
  }
}
```

**Fail if:** `networkMode` is not `offlineFirst` — this means all queries
fail immediately with no data when offline.

### 6.3 Verify Zustand selectors are narrow (no full state reads)

```bash
# Find any components using the full store object
grep -rn "useStore()" apps/mobile/ | grep -v "\.getState()"

# Expected: 0 results
# Each hook should use a selector: useStore((s) => s.user) not useStore()
# Full store reads cause re-renders on ANY state change
```

### 6.4 Verify offline queue exists and has all required fields

```bash
cat apps/mobile/lib/checkin-queue.ts
```

**Verify the QueuedCheckin interface has:**
```typescript
interface QueuedCheckin {
  id: string           // ← for deduplication
  qrToken: string
  lat: number
  lon: number
  accuracy: number
  clientTimestamp: number   // ← when student scanned (for expiry check)
  queuedAt: number          // ← when added to queue
  retries: number           // ← to stop after MAX_RETRIES
}

// Verify MAX_AGE_MS = 90 * 60 * 1000 (90 minutes, not 2 hours)
// Verify the queue flushes on NetInfo reconnect, not manually
// Verify isReplay: true is sent on retry
```

---

## Section 7 — Error Handling Completeness Audit

### 7.1 Backend error response format consistency

Every endpoint must return errors in the same shape.
Test 5 different error conditions across 5 different endpoints
and verify the format is identical.

```bash
# Call these endpoints with intentionally bad data:
curl -X POST .../v1/auth/login -d '{}' | jq .error
curl http://localhost:3000/v1/student/home  # no auth token | jq .error
curl -X POST .../v1/attendance/checkin -d '{"qrToken":"invalid"}' | jq .error

# Every error response must be:
{
  "error": "SCREAMING_SNAKE_CASE_CODE",   // ← machine-readable
  "message": "Human readable description", // ← optional, for logging
  // sometimes: "meta": { extra data }    // ← only when needed by mobile
}

# FAIL if any endpoint returns:
# { "msg": "..." }          ← wrong field name
# { "message": "..." }      ← missing error code
# "Internal server error"   ← generic, not actionable
# { "statusCode": 400 }     ← missing error field
```

### 7.2 Mobile error boundaries

```bash
# Verify error boundaries exist in the Expo Router layout
grep -rn "ErrorBoundary\|errorBoundary" apps/mobile/app/

# Every layout file should have error handling
# FAIL if: no error boundaries found
# Result of failure: a single API error crashes the entire screen
```

---

## Section 8 — Performance & Load Readiness

### 8.1 N+1 query check on student home endpoint

```bash
# Enable Prisma query logging temporarily
# In apps/backend/src/app.ts, add:
const prisma = new PrismaClient({
  log: ['query'],
})

# Then call GET /v1/student/home
# Count the number of SQL queries in the logs

# Expected: ≤ 5 queries (user, trip, attendance, history aggregate, corrections)
# FAIL if: > 10 queries (N+1 problem — parallel Promise.all not used)
```

### 8.2 Redis cache hit on hot path

```bash
# First call: populates Redis
curl http://localhost:3000/v1/student/home -H "Authorization: Bearer $TOKEN"

# Check Redis
redis-cli KEYS "student:home:*"

# Second call: should hit Redis, not Postgres
# Watch Redis monitor during second call
redis-cli MONITOR &
curl http://localhost:3000/v1/student/home -H "Authorization: Bearer $TOKEN"

# Expected: Redis GET command visible in monitor
# FAIL if: only Postgres queries visible (Redis not being used on hot path)
```

---

## Section 9 — Full Morning Simulation (End-to-End)

This is the final boss. Run this after all previous sections pass.

### 9.1 The 8am simulation script

```
Actors needed:
  1 Transport Officer account (admin)
  1 Coordinator account
  1 Driver account  
  3 Student accounts (one assigned, one unassigned, one offline-capable)

Step 1: Night before (23:00 IST equivalent)
  → Manually trigger create-daily-trips job
  → Verify: trips created for tomorrow
  → Verify: trip date is in IST, not UTC

Step 2: Driver opens app (7:45 AM)
  → Driver logs in
  → Verify: pre-trip screen shows correct assignment
  → Verify: bus number, route, student count are correct
  → Driver taps "Start morning trip"
  → Verify: Socket.io event fires to all students on this route
  → Verify: Student home screens update within 60s (refetch interval)

Step 3: Student 1 checks in normally (8:00 AM)
  → Student opens app
  → Verify: home screen shows bus approaching
  → Student taps "Scan QR"
  → Verify: camera opens within 500ms
  → Verify: GPS location prefetch starts immediately
  → Student scans driver's QR code
  → Verify: response < 2 seconds end-to-end
  → Verify: success screen shows correct bus, stop, time
  → Verify: driver kiosk shows toast with student name
  → Verify: admin dashboard updates count

Step 4: Student 2 checks in offline (8:10 AM)
  → Turn off student's mobile data
  → Student scans QR
  → Verify: amber "Saved offline" screen appears (not red)
  → Verify: no crash, no spinner
  → Turn mobile data back on
  → Verify: queue auto-flushes within 5 seconds of reconnect
  → Verify: attendance shows PRESENT after sync
  → Verify: check-in timestamp reflects original scan time

Step 5: Student 3 is unassigned (8:15 AM)
  → Student sees pending screen
  → Student taps "I know my bus — check in anyway"
  → Student scans driver's QR
  → Verify: check-in succeeds with isUnassigned: true
  → Verify: admin dashboard shows "X students need assignment"
  → Admin assigns student to route
  → Verify: student's app updates within 2 minutes (auto-poll)
  → Verify: student moves from pending to home screen

Step 6: GPS goes offline mid-trip (8:20 AM)
  → Stop GPS background task on driver's phone
  → Wait 90 seconds
  → Verify: student home screen shows AMBER "GPS offline" pill
  → Verify: NOT red
  → Verify: last known position still visible on map
  → Resume GPS task
  → Verify: GPS_LIVE state returns within 30 seconds

Step 7: Driver reports breakdown (8:30 AM)
  → Driver taps Breakdown button
  → Selects "Flat tyre"
  → Verify: incident created in backend within 2 seconds
  → Verify: coordinator receives push notification
  → Verify: students receive "Bus breakdown" notification
  → Verify: incident:reported socket event fires to admin dashboard

Step 8: Trip ends (8:45 AM)
  → Driver reviews trip summary
  → Verify: boarded count + absent count = expected count
  → Driver taps "End trip"
  → Verify: mark-absent job triggered for non-checked-in students
  → Wait for job to complete
  → Verify: every student on route has either PRESENT or ABSENT status
  → Verify: no student has NULL or missing attendance for this date
```

**Pass condition:** All 8 steps complete with zero errors, zero manual interventions,
and all data in the database matches expected values.

**Fail condition:** Any step requires a workaround, manual fix, or produces
unexpected behavior. Document the failure and fix before proceeding.

---

## Section 10 — Audit Completion Checklist

Mark each section complete only when ALL items within it pass.

```
[ ] Section 1 — Contract Correctness
    [ ] 1.1 GET /v1/student/home — all fields present and correct type
    [ ] 1.2 GET /v1/driver/today — complete response
    [ ] 1.3 POST /v1/attendance/checkin — all 12 scenarios tested
    [ ] 1.4 GET /v1/attendance/history — pagination contract correct
    [ ] 1.5 Socket.io — all 6 events fire with correct payload

[ ] Section 2 — Timezone Integrity
    [ ] 2.1 Zero UTC date splits in backend
    [ ] 2.2 IST helper exists and uses correct offset
    [ ] 2.3 Boundary test passes

[ ] Section 3 — Authentication
    [ ] 3.1 Device binding enforced on all endpoints
    [ ] 3.2 Session revocation works
    [ ] 3.3 CSRF enforced on admin unsafe requests

[ ] Section 4 — Background Jobs
    [ ] 4.1 create-daily-trips — idempotent, correct date
    [ ] 4.2 mark-absent — fires after trip end
    [ ] 4.3 gps-heartbeat — marks STALE after 90s
    [ ] 4.4 All jobs require OIDC auth

[ ] Section 5 — GPS Pipeline
    [ ] 5.1 Firebase latency < 500ms
    [ ] 5.2 Delta compression skipping stationary bus
    [ ] 5.3 Offline persistence works on map screen

[ ] Section 6 — Frontend State
    [ ] 6.1 Zero raw API calls in screen components
    [ ] 6.2 TanStack Query has offlineFirst + placeholderData
    [ ] 6.3 Zustand selectors are narrow
    [ ] 6.4 Offline queue has all required fields

[ ] Section 7 — Error Handling
    [ ] 7.1 Backend error format is consistent
    [ ] 7.2 Mobile error boundaries exist

[ ] Section 8 — Performance
    [ ] 8.1 Student home ≤ 5 DB queries
    [ ] 8.2 Redis cache hit on second request

[ ] Section 9 — Morning Simulation
    [ ] 9.1 All 8 steps complete without manual intervention

SYSTEM IS AUDIT-COMPLETE WHEN ALL BOXES ARE CHECKED.
Do not deploy to a real device until Section 9 passes completely.
```

---

*API Reliability & Structural Integrity Audit Plan*
*College Bus Management System*
*March 2026 — For local backend, basic manual testing complete*
