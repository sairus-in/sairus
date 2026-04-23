# College Bus Management System
# Mobile App — Target Structure & System Architecture
# Implementation Blueprint (Not Readiness Proof)

> Built from: all flow decisions + low-network strategy + substitute bus logic +
> unassigned student handling + push notification deep links + offline queue.
> This document is an architecture and implementation target with some current-code notes.
> It is not evidence that every flow is complete, production-hardened, or device-validated.

Status legend for claims in this file:
- Target: intended architecture
- Implemented: present in code
- Validate: needs runtime/device proof

Read this file as:
- structure and intended responsibilities for the mobile app
- current-code notes where the implementation is verified
- build guidance for future work

Do not read this file as:
- a production-readiness sign-off
- proof that every described edge case is already handled
- proof that docs, mobile code, backend contracts, and device behavior are perfectly aligned

## Reality Check

As of March 24, 2026, the mobile app has a strong overall shape, but maturity is uneven.

Known areas that still require verification or discipline:
- auth correctness still needs full physical-device QA across login, restore, logout, and forced-expiry paths
- realtime behavior depends on reconnect and reconciliation details, not just a socket singleton existing
- GPS/live-map behavior spans mobile background task, backend ingest, Firebase RTDB projection, and student subscriptions
- this document can drift unless changes are checked against code in `apps/mobile`, `apps/backend`, and shared contracts in `packages/shared`

Primary source files for truth:
- `apps/mobile/app/_layout.tsx`
- `apps/mobile/app/(auth)/verify-otp.tsx`
- `apps/mobile/hooks/useStudentHome.ts`
- `apps/mobile/tasks/gps.task.ts`
- `apps/mobile/lib/socket.ts`
- `apps/mobile/hooks/useLiveBus.ts`
- `apps/backend/src/modules/student/student-home.service.ts`
- `apps/backend/src/modules/gps/gps.service.ts`

---

## Table of Contents

1. [Core Principles](#1-core-principles)
2. [Navigation Architecture](#2-navigation-architecture)
3. [Screen Inventory](#3-screen-inventory)
4. [State Management Architecture](#4-state-management-architecture)
5. [API Connection Map](#5-api-connection-map)
6. [Low Network Strategy](#6-low-network-strategy)
7. [Push Notification System](#7-push-notification-system)
8. [Substitute Bus Flow](#8-substitute-bus-flow)
9. [Unassigned Student Flow](#9-unassigned-student-flow)
10. [Offline Queue](#10-offline-queue)
11. [Background GPS Task](#11-background-gps-task)
12. [Socket.io Connection](#12-socketio-connection)
13. [Firebase RTDB Integration](#13-firebase-rtdb-integration)
14. [Admin Dashboard — Bulk Actions](#14-admin-dashboard--bulk-actions)
15. [Complete File Structure](#15-complete-file-structure)
16. [Build Rules for Claude Code](#16-build-rules-for-claude-code)

---

## 1. Core Principles

### Structural integrity first
- Navigation should be deterministic before design polish is treated as done
- Every important screen should define loading, error, empty, and offline behavior
- Blank or half-initialized screens are treated as bugs
- Critical API calls should have intentional failure behavior

### Low network is the default
- Design for 2G/edge conditions first
- Cache everything that can be cached
- Queue everything that can be queued
- Show stale data with an indicator rather than a spinner

### Role-based routing is automatic
- The app decides where to send the user — the user never navigates between roles
- One codebase, two completely separate experiences
- Role is determined from the JWT and stored in auth store

### Attendance morning only
- No return trip check-in
- One trip per student per day
- Trip window: trip.startedAt → trip.endedAt

---

## 2. Navigation Architecture

### Root layout — the brain

The root `_layout.tsx` is the single decision point for all routing.
Nobody navigates here manually. It reads state and redirects.

Current code note:
- the live `apps/mobile/app/_layout.tsx` also syncs the mobile profile when a token exists before routing
- route gating depends on both `user` and `token`, not just hydrated user state
- pending routing is based on missing `routeAssignment` for student users; the `isUnassigned` branch shown below should be treated as target behavior, not guaranteed current logic

```typescript
// app/_layout.tsx — routing logic

const { user, isLoaded } = useAuthStore()

if (!isLoaded) → <SplashScreen />          // reading from AsyncStorage
if (!user)     → redirect('/(auth)/login') // not authenticated
if (user.role === 'DRIVER') → redirect('/(driver)/')
if (!user.routeAssignment && !user.isUnassigned) → redirect('/(auth)/pending')
else → redirect('/(student)/')
```

Treat the snippet above as routing intent, not an exact copy of current implementation.

### Complete navigation tree

```
app/
│
├── _layout.tsx                        BRAIN — auth guard + role routing
│
├── (auth)/                            UNAUTHENTICATED + PENDING USERS
│   ├── _layout.tsx                    Stack navigator
│   ├── login.tsx                      Phone number entry
│   ├── verify-otp.tsx                 6-digit OTP verification
│   └── pending.tsx                    Logged in, no route assigned yet
│
├── (student)/                         STUDENT + STAFF + FACULTY
│   ├── _layout.tsx                    Tab navigator (4 tabs)
│   ├── index.tsx                      Tab 1: Home
│   ├── map.tsx                        Tab 2: Live map
│   ├── history.tsx                    Tab 3: Attendance history
│   ├── profile.tsx                    Tab 4: Profile + settings
│   │
│   ├── scanner.tsx                    QR scanner — full screen, no tabs
│   ├── checkin-success.tsx            Success screen — full screen
│   ├── checkin-fail.tsx               Fail screen with reason + next action
│   ├── verify-arrival.tsx             FCM deep link target — auto-fires GPS
│   │
│   └── correction/
│       ├── index.tsx                  Correction list (pending/resolved)
│       └── [logId].tsx                Correction request form
│
└── (driver)/                          DRIVER ONLY
    ├── _layout.tsx                    Stack navigator
    ├── index.tsx                      Pre-trip assignment screen
    ├── route-preview.tsx              Stop list before starting trip
    ├── kiosk.tsx                      Active kiosk — full screen, no nav bar
    ├── breakdown.tsx                  Incident report screen
    ├── post-breakdown.tsx             After reporting — admin messages + replies
    ├── summary.tsx                    End trip summary
    └── messages.tsx                   Admin ↔ Driver message thread
```

### Tab navigator configuration (student)

```typescript
// (student)/_layout.tsx
<Tabs
  screenOptions={{
    headerShown: false,
    tabBarShowLabel: true,
    tabBarActiveTintColor: '#1E3A8A',
    tabBarInactiveTintColor: '#9CA3AF',
  }}
>
  <Tabs.Screen name="index"   options={{ title: 'Home' }} />
  <Tabs.Screen name="map"     options={{ title: 'Map' }} />
  <Tabs.Screen name="history" options={{ title: 'History' }} />
  <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
  // Scanner, checkin-success, checkin-fail, verify-arrival → tabBarStyle: {display:'none'}
</Tabs>
```

### Deep link scheme

```json
// app.json
{
  "expo": {
    "scheme": "busapp",
    "plugins": ["expo-router"]
  }
}
```

---

## 3. Screen Inventory

Every screen: what it shows, what it fetches, all possible states.

---

### AUTH SCREENS

---

#### `(auth)/login.tsx`

**Purpose:** Phone number entry. First screen every user sees.

**States:**
```
idle        → input field + "Send OTP" button
loading     → button disabled + spinner
error       → "Phone number not registered" or "Too many attempts"
success     → navigate to verify-otp
```

**Logic:**
```typescript
1. User enters 10-digit phone number
2. App formats to +91XXXXXXXXXX
3. Firebase Auth: auth().signInWithPhoneNumber(formatted)
4. On success: router.push('/(auth)/verify-otp', { verificationId, phone })
5. On error: show specific message
   - auth/invalid-phone-number → "Enter a valid 10-digit number"
   - auth/too-many-requests    → "Too many attempts. Try again in 1 hour."
```

**Current code note:** the login screen initiates Firebase phone verification only.
The backend session starts in `verify-otp.tsx` after the Firebase token is exchanged with `/v1/auth/login`.

---

#### `(auth)/verify-otp.tsx`

**Purpose:** 6-digit OTP verification.

**States:**
```
idle        → 6 input boxes + "Verify" button (disabled until 6 digits)
loading     → button disabled
error       → "Incorrect code. X attempts remaining"
resend      → "Resend OTP" available after 30s countdown
success     → backend exchange → navigate to role destination
```

**Logic:**
```typescript
1. User enters 6-digit OTP
2. Firebase: auth().signInWithCredential(PhoneAuthProvider.credential(verificationId, otp))
3. Get Firebase ID token: userCredential.user.getIdToken()
4. POST /v1/auth/login { firebaseToken, deviceId: await getDeviceId() }
5. Backend returns: { user, token, routeAssignment }
6. Store in Zustand: setUser(user, token)
7. Root _layout.tsx reacts → routes to correct destination
```

**Current status:** implemented in code, but still not a readiness proof by itself.
This flow still needs device QA for resend, expiry, unregistered numbers, logout, restore, and forced 401 handling.

**What `getDeviceId()` returns:**
```typescript
import * as Application from 'expo-application'
// iOS: Application.getIosIdForVendorAsync()
// Android: Application.androidId
// Hash this before storing — never store raw device ID
```

---

#### `(auth)/pending.tsx`

**Purpose:** User is authenticated but not yet assigned a route by admin.

**What it shows:**
```
"You're registered"
"Your transport assignment is being set up"
"Contact your transport office if this takes more than 24 hours"

Bus number: Not yet assigned
Stop: Not yet assigned

[Check again] button — re-fetches /v1/auth/me
[Contact transport office] button → opens phone dialer

Bottom: shows student's name + roll number (from auth store)
```

**Special case — unassigned student who knows their bus:**
```
"Check in on your bus and let us know"
[I know my bus — check in anyway] button
→ navigates to scanner with isUnassigned: true flag
→ After successful check-in:
  Backend records check-in with isUnassigned: true
  Admin dashboard shows this student in "Needs assignment" list
```

**Auto-poll:** Every 2 minutes, silently re-fetch `/v1/auth/me`.
If routeAssignment appears → root layout automatically redirects to student home.

---

### STUDENT SCREENS

---

#### `(student)/index.tsx` — Home

**Purpose:** Everything the student needs for the morning in one screen.

**Data source:** `GET /v1/student/home` (BFF endpoint)

**Response shape:**
```typescript
{
  student: {
    id, name, rollNumber, department, year,
    routeId, routeName, stopId, stopName, busId, busNumber
  },
  transport: {
    trip: {
      id, type, status, routeName, busId, busNumber, driverName,
      gpsStatus, expectedCount, boardedCount,
      scheduledDeparture, minutesLate,
      canCheckIn,
      checkInReason: 'TRIP_SKIPPED' | 'WINDOW_CLOSED' | null,
      isSubstitute, originalBusNumber,
      substituteInfo: { reason, assignedAt } | null,
    } | null,
    attendance: {
      today, checkedInAt, busNumber, arrivalVerified,
    },
    history: {
      presentCount, absentCount, percentage, pendingCorrections,
    },
    alerts: {
      yesterdayAbsent, yesterdayDate, substituteAssigned,
    }
  },
  features: {
    hasAssignment, canCheckIn, canSkipToday, canUseLiveMap, canRequestCorrection,
  }
}
```

Use the shared type in `packages/shared/src/types/student-home.ts` as the contract source.
If this markdown and that shared type differ, the shared type wins.

**States (7 distinct states):**
```
1. LOADING          → skeleton cards (stale cache shown underneath)
2. NO_TRIP          → "No trip scheduled today"
3. TRIP_NOT_STARTED → Bus card (gray) + disabled check-in + "Driver hasn't started yet"
4. LATE_START       → Same + red banner "Bus is X minutes late"
5. ACTIVE           → Bus card (live) + green check-in button
6. CHECKED_IN       → Bus card + green "✓ Checked in at X:XX AM"
7. WINDOW_CLOSED    → Bus card + "Check-in window closed" + correction link
```

These are target UX states. The exact rendered states still depend on the frontend keeping pace with the backend contract and screen implementation.

**Realtime:** After home loads `busId`, open Firebase RTDB subscription to `/buses/{busId}`

**Refresh strategy:**
```typescript
useQuery({
  queryKey: ['student-home'],
  queryFn: () => api.get('/v1/student/home'),
  staleTime: 5 * 60 * 1000,
  refetchInterval: 60 * 1000,       // every 1 min in foreground
  refetchOnWindowFocus: true,
  networkMode: 'offlineFirst',
})
```

---

#### `(student)/map.tsx` — Live Map

**Purpose:** See exact bus position right now.

**Data source:** Firebase RTDB only — no backend call.
`busId` comes from home query cache.

**States:**
```
LOADING         → map loads + spinner overlay
LIVE            → bus marker moving + ETA + next stop card
GPS_OFFLINE     → map shows last position (faded) + amber banner
NO_TRIP         → static map + "No active trip"
NO_BUS_ID       → "Open home screen first" (home cache miss)
```

**Map configuration:**
```typescript
<MapView
  style={{ flex: 1 }}
  initialRegion={stopCoordinates}
  showsUserLocation={true}
  showsMyLocationButton={true}
>
  <BusMarker
    coordinate={{ latitude: busLoc.lat, longitude: busLoc.lon }}
    rotation={busLoc.heading}
    // Smooth animation between pings using heading + speed
  />
  <StopMarker coordinate={studentStop} />
  {/* Route polyline */}
</MapView>
```

**Smooth marker animation:**
```typescript
// Interpolate between GPS pings using speed + heading
// Update marker position every 500ms even when no new ping received
// This makes bus appear to move smoothly at 30km/h instead of jumping every 3s
```

---

#### `(student)/scanner.tsx` — QR Scanner

**Purpose:** Scan driver's QR and submit check-in.

**CRITICAL: No tab bar on this screen.**

**On mount (parallel):**
```typescript
useEffect(() => {
  Promise.all([
    requestCameraPermission(),
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      .then(loc => locationRef.current = loc)
      .catch(() => {})   // silent — try again on scan
  ])
}, [])
```

**On QR decode:**
```typescript
const handleScan = async ({ data: qrToken }) => {
  if (scanned) return
  setScanned(true)

  // Use pre-fetched location or fetch now
  const location = locationRef.current
    ?? await Location.getCurrentPositionAsync({ accuracy: Balanced })

  // Submit check-in
  const result = await submitCheckIn({
    qrToken,
    lat: location.coords.latitude,
    lon: location.coords.longitude,
    accuracy: location.coords.accuracy,
    clientTimestamp: Date.now(),
  })

  // Navigate based on result
  if (result.success) {
    router.replace('/checkin-success')
  } else if (result.offline) {
    router.replace({ pathname: '/checkin-success', params: { offline: 'true' } })
  } else {
    router.replace({ pathname: '/checkin-fail', params: { reason: result.reason, ...result.meta } })
  }
}
```

**States:**
```
REQUESTING_PERMISSION   → loading
PERMISSION_DENIED       → "Camera access needed" + [Open Settings] button
SCANNING                → camera + corner brackets + "Fetching location..." if GPS not ready
PROCESSING              → "Verifying..." overlay on camera
```

---

#### `(student)/checkin-success.tsx`

**Purpose:** Confirm check-in worked. Auto-navigates back to home.

**Props (from router params):**
```typescript
{
  offline?: 'true'    // show offline saved state instead of confirmed
  status?: 'PRESENT' | 'LATE_BOARD'
  checkedInAt?: string
  distanceToBus?: string
  distanceToStop?: string
}
```

**States:**
```
PRESENT    → green screen + "Checked in!" + time + distance
LATE_BOARD → amber screen + "Checked in" + "You were a bit far from the stop"
OFFLINE    → amber screen + "Saved offline" + "Will sync when connected"
```

**Auto-navigate:** `setTimeout(() => router.replace('/(student)/'), 2500)`
**Haptic:** `Haptics.notificationAsync(NotificationFeedbackType.Success)`

---

#### `(student)/checkin-fail.tsx`

**Purpose:** Tell student exactly what went wrong and what to do next.

**Error types and copy:**
```
TOO_FAR         → "You're {X}m away. Move closer and try again."
                  [Try again] [Request correction]

QR_EXPIRED      → "Code expired. Ask driver for a fresh one."
                  [Try again]

QR_ALREADY_USED → "This code was just used. Next code in ~{X}s"
                  [Try again] + countdown

WRONG_BUS       → "This is Bus {N}'s code. Your bus is Bus {M}."
                  [Close]

TRIP_NOT_ACTIVE → "Trip hasn't started yet."
                  [Go back]

DEVICE_MISMATCH → "Login detected on another device."
                  [Re-register device]

RATE_LIMITED    → "Too many attempts. Wait 1 minute."
                  [Go back]
```

**Never show raw error codes to students.**

---

#### `(student)/verify-arrival.tsx`

**Purpose:** Confirm student is at college when bus arrives at gate.
Opened via FCM deep link. Student should barely notice this screen.

**On mount:**
```typescript
useEffect(() => {
  const verify = async () => {
    try {
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
        timeoutMs: 8000,
      })
      await api.post('/v1/attendance/verify-arrival', {
        tripId: params.tripId,
        lat: location.coords.latitude,
        lon: location.coords.longitude,
        accuracy: location.coords.accuracy,
        method: 'PUSH_NOTIFICATION',
      })
    } catch {
      // Silent fail — null treated as verified (benefit of doubt)
    } finally {
      setTimeout(() => router.back(), 1500)
    }
  }
  verify()
}, [])
```

**Shows:** Loading spinner + "Verifying your arrival..." → closes automatically.
**No button needed.** Tapping the notification IS the action.

---

#### `(student)/history.tsx` — Attendance History

**Purpose:** Full attendance record with correction flow.

**Data source:** `GET /v1/attendance/history?page=1&limit=20`

**Features:**
```
Filter pills: All | Absent | Corrections
Infinite scroll pagination (20 per page)
Progress bar showing attendance %
Each absent row has "Request correction →" link
```

**States:**
```
LOADING       → skeleton rows
LOADED        → list
LOAD_MORE     → spinner at bottom
EMPTY         → "No attendance records yet"
OFFLINE       → cached list + "Last updated X ago"
ERROR         → "Couldn't load history" + [Retry]
```

---

#### `(student)/correction/[logId].tsx` — Correction Request

**Data source:** `GET /v1/attendance/logs/:logId`
**Action:** `POST /v1/attendance/correction-request`

**Shows:**
```
Incident card: date, bus, trip
GPS evidence card: distanceToBus + distanceToStop at time of attempt
  (if available — shows even if check-in failed)
Reason text input (min 10 chars)
Submit button
"Coordinator reviews within 24 hours"
```

**Offline:** Queue the correction request. Sync on reconnect.

---

#### `(student)/profile.tsx` — Profile & Settings

**Data source:** auth store (no extra API call)

**Actions:**
```
Toggle Tamil language → AsyncStorage persist → i18n switch
Toggle notifications  → update FCM preferences
Sign out             → clear auth store + AsyncStorage → redirect to login
```

**FCM token refresh:**
```typescript
// On profile mount + on app foreground:
const token = await Notifications.getExpoPushTokenAsync()
if (token !== storedToken) {
  await api.patch('/v1/users/fcm-token', { fcmToken: token })
  setStoredToken(token)
}
```

---

### DRIVER SCREENS

---

#### `(driver)/index.tsx` — Pre-trip Assignment

**Purpose:** Show driver their assignment. Block kiosk until trip started.

**Data source:** `GET /v1/driver/today`

**Response shape:**
```typescript
{
  driver: { id, name, licenseNumber },
  assignment: {
    busId, busNumber, plateNumber,
    routeId, routeName,
    scheduledDeparture: "07:15",
    expectedStudents: 48,
  },
  trip: {
    id, status,   // SCHEDULED | ACTIVE | COMPLETED | NO_TRIP
    startedAt: null | DateTime,
    minutesLate: number,
  } | null,
  substituteFor: {  // if this driver is substitute
    originalDriverName,
    originalBusNumber,
  } | null
}
```

**States:**
```
NO_TRIP           → "No trip scheduled today"
SCHEDULED         → Assignment card + [Start morning trip] button
LATE              → Same + red banner "X minutes late. Coordinator notified."
ACTIVE            → Auto-redirect to kiosk.tsx
COMPLETED         → "Today's trip is complete" + summary link
```

**Late start alert:** If `minutesLate > 10`, show red banner.
Backend has already alerted coordinator via Cloud Tasks.

---

#### `(driver)/kiosk.tsx` — Active Kiosk

**Purpose:** Full-screen QR display + live check-in feed.
This is the most critical driver screen. Runs for 1-2 hours straight.

**On mount:**
```typescript
// Keep screen awake
await KeepAwake.activateKeepAwakeAsync()

// Max brightness
await Brightness.setBrightnessAsync(1.0)

// Connect Socket.io
socket.connect()
socket.join(`trip:${tripId}`)

// Start background GPS task
await startGPSTask(tripId, busId)
```

**Socket.io events listened:**
```typescript
socket.on('qr:refresh', ({ qrToken, expiresAt }) => {
  setQrToken(qrToken)
  setExpiresAt(expiresAt)
})

socket.on('checkin:success', ({ userId, name, status, distanceToStop }) => {
  setLastToast({ name, status, distanceToStop, time: Date.now() })
  setBoardedCount(prev => prev + 1)
  // Toast auto-dismisses after 4000ms
})

socket.on('wait:request', ({ studentName, etaMinutes }) => {
  addWaitRequest({ studentName, etaMinutes })
})

socket.on('admin:message', ({ body, isUrgent }) => {
  addAdminMessage({ body, isUrgent })
  if (isUrgent) Haptics.notificationAsync(NotificationFeedbackType.Warning)
})
```

**QR refresh fallback (polling):**
```typescript
// If no qr:refresh socket event received before countdown hits 0:
useEffect(() => {
  if (countdown > 0) return
  // Fallback poll
  api.get(`/v1/trips/${tripId}/qr`)
    .then(({ qrToken, expiresAt }) => {
      setQrToken(qrToken)
      setExpiresAt(expiresAt)
    })
}, [countdown])
```

**Manual mark bottom sheet:**
```typescript
// Driver long-presses or taps "Manual mark" row
// Bottom sheet slides up (never leaves kiosk screen)
<BottomSheet>
  <SearchInput placeholder="Search student name..." />
  <StudentList onSelect={(student) => {
    api.post(`/v1/trips/${tripId}/manual-mark`, {
      userId: student.id,
      reason: selectedReason,
    })
    closeBottomSheet()
  }} />
  <ReasonSelector options={['Student present', 'Phone issue', 'Camera issue']} />
</BottomSheet>
```

**On unmount:**
```typescript
KeepAwake.deactivateKeepAwake()
Brightness.restoreSystemBrightnessAsync()
socket.disconnect()
await stopGPSTask()
```

---

#### `(driver)/breakdown.tsx` — Incident Report

**States:**
```
TYPE_SELECT    → 5 incident types (large tap targets, full-width rows)
CONFIRMING     → "This will alert your coordinator immediately" + [Report] [Cancel]
SUBMITTING     → loading
SUCCESS        → navigate to post-breakdown.tsx
OFFLINE        → queue with high priority + navigate to post-breakdown with offline flag
```

**API:** `POST /v1/incidents/report`
**Offline:** Queue immediately — this is high priority. Sync the moment network returns.

---

#### `(driver)/summary.tsx` — Trip End

**Shows:**
```
3 stat cards: Boarded | Absent | Expected
Trip times: started / arrived / duration
Absent students list:
  Each row: name + reason badge (No check-in | Trip skip | Unassigned)
  Driver can tap name → manual mark bottom sheet (one last chance)
[End trip] button → confirmation bottom sheet → POST /v1/trips/:id/end
```

**End trip confirmation:**
```
"This will mark remaining students as absent. Continue?"
[Confirm] [Cancel]
```

---

## 4. State Management Architecture

### What lives where — the golden rule

```
Zustand (persistent, global)
  └── Auth store: user, token, deviceId, fcmToken

TanStack Query (server state, auto-cached)
  └── All API responses: home, history, trip, driver-today

Local component state (useState)
  └── Form inputs, modal open/close, UI toggles

AsyncStorage (persistent offline)
  └── homeCache, checkinQueue, correctionQueue, fcmToken, language preference
```

### Zustand auth store

```typescript
// store/auth.store.ts
interface AuthStore {
  user: User | null
  token: string | null
  deviceId: string | null
  isLoaded: boolean        // false until AsyncStorage read complete

  setUser: (user: User, token: string) => void
  clearUser: () => void
  setFcmToken: (token: string) => void
}

// Persisted to AsyncStorage via zustand/middleware/persist
const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      user: null, token: null, deviceId: null, isLoaded: false,
      setUser: (user, token) => set({ user, token }),
      clearUser: () => set({ user: null, token: null }),
      setFcmToken: (fcmToken) => set(state => ({
        user: state.user ? { ...state.user, fcmToken } : null
      })),
    }),
    {
      name: 'auth-store',
      storage: createJSONStorage(() => AsyncStorage),
      onRehydrateStorage: () => () => useAuthStore.setState({ isLoaded: true }),
    }
  )
)
```

### TanStack Query global config

```typescript
// lib/query-client.ts
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      networkMode: 'offlineFirst',
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
    },
    mutations: {
      networkMode: 'offlineFirst',
    },
  },
})
```

---

## 5. API Connection Map

### Axios client setup

```typescript
// lib/api.client.ts
const api = axios.create({
  baseURL: process.env.EXPO_PUBLIC_API_URL,
  timeout: 10_000,
})

// Auth interceptor — attach JWT
api.interceptors.request.use(config => {
  const token = useAuthStore.getState().token
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Response interceptor — handle 401
api.interceptors.response.use(
  response => response,
  async error => {
    if (error.response?.status === 401) {
      useAuthStore.getState().clearUser()
      router.replace('/(auth)/login')
    }
    return Promise.reject(error)
  }
)
```

### Complete endpoint map

```
SCREEN                    METHOD   ENDPOINT                              CACHE TTL
─────────────────────────────────────────────────────────────────────────────────
login.tsx                 POST     /v1/auth/login                        none
verify-otp.tsx            POST     /v1/auth/login                        none
pending.tsx               GET      /v1/auth/me                           30s (poll)
─────────────────────────────────────────────────────────────────────────────────
index.tsx (student)       GET      /v1/student/home                      5 min
map.tsx                   —        Firebase RTDB /buses/{busId}           realtime
history.tsx               GET      /v1/attendance/history?page&limit      10 min
scanner.tsx               POST     /v1/attendance/checkin                 none
verify-arrival.tsx        POST     /v1/attendance/verify-arrival          none
correction/[logId].tsx    GET      /v1/attendance/logs/:logId             5 min
correction/[logId].tsx    POST     /v1/attendance/correction-request      none
profile.tsx               PATCH    /v1/users/fcm-token                    none
─────────────────────────────────────────────────────────────────────────────────
index.tsx (driver)        GET      /v1/driver/today                       1 min
kiosk.tsx                 GET      /v1/trips/:id/qr                       fallback only
kiosk.tsx                 POST     /v1/trips/:id/manual-mark              none
kiosk.tsx                 —        Socket.io trip:{tripId} room            realtime
breakdown.tsx             POST     /v1/incidents/report                   none
summary.tsx               GET      /v1/trips/:id/summary                  none
summary.tsx               POST     /v1/trips/:id/end                      none
messages.tsx              GET      /v1/messages/:busId                    30s
messages.tsx              POST     /v1/messages/:id/reply                 none
```

---

## 6. Low Network Strategy

### Three-layer architecture

This section describes the intended low-network behavior.
Treat it as directionally correct, not proof that every screen already implements the full policy consistently.

**Layer 1 — Cache first, always**
```typescript
// Every query returns cached data IMMEDIATELY
// Then fetches fresh in background
// User always sees something — never a blank screen

networkMode: 'offlineFirst'   // TanStack Query built-in
```

**Layer 2 — AsyncStorage for persistence across app restarts**
```typescript
// On every successful home fetch:
AsyncStorage.setItem('home-cache', JSON.stringify(data))

// On app launch, before API call:
const cached = await AsyncStorage.getItem('home-cache')
if (cached) setHomeData(JSON.parse(cached))  // instant display
// Then fetch in background and update
```

**Layer 3 — NetInfo for reactive network awareness**
```typescript
import NetInfo from '@react-native-community/netinfo'

NetInfo.addEventListener(state => {
  if (state.isConnected && state.isInternetReachable) {
    flushCheckinQueue()       // replay queued check-ins
    flushCorrectionQueue()    // replay queued corrections
    queryClient.refetchQueries({ type: 'active' })  // refresh all active queries
  }
})
```

### Offline indicators
```
- Subtle banner at top: "You're offline · Showing last known data"
- Never block the UI — always show something
- Green "Back online" flash when reconnected
- Amber "Last updated X minutes ago" on stale data
```

### Firebase offline persistence

Current code note:
- `apps/mobile/lib/firebase.ts` uses the Firebase JS SDK in Expo
- `apps/mobile/hooks/useLiveBus.ts` subscribes to `/buses/{busId}` only
- the explicit native-style persistence calls shown below are architectural intent, not the exact current implementation

```typescript
// Initialize once at app startup — enables offline map even with no network
firebase.database().setPersistenceEnabled(true)
firebase.database().ref('/buses').keepSynced(true)
// Last known bus positions always available
```

---

## 7. Push Notification System

### Setup (app startup)

```typescript
// lib/notifications.ts
async function setupNotifications() {
  // Request permission
  const { status } = await Notifications.requestPermissionsAsync()
  if (status !== 'granted') return

  // Get FCM token
  const token = await Notifications.getExpoPushTokenAsync({
    projectId: process.env.EXPO_PUBLIC_PROJECT_ID
  })

  // Send to backend
  await api.patch('/v1/users/fcm-token', { fcmToken: token.data })

  // Handle foreground notifications
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  })
}
```

### Deep link handler

```typescript
// app/_layout.tsx — handles notification taps
useEffect(() => {
  // App opened from notification (background/killed)
  const sub1 = Notifications.addNotificationResponseReceivedListener(response => {
    const { screen, params } = response.notification.request.content.data
    if (screen) router.push({ pathname: screen, params })
  })

  // Notification received while app is open (foreground)
  const sub2 = Notifications.addNotificationReceivedListener(notification => {
    const { type } = notification.request.content.data
    // Refresh relevant query
    if (type === 'SUBSTITUTE_ASSIGNED') {
      queryClient.invalidateQueries({ queryKey: ['student-home'] })
    }
    if (type === 'CORRECTION_REVIEWED') {
      queryClient.invalidateQueries({ queryKey: ['attendance-history'] })
    }
  })

  return () => { sub1.remove(); sub2.remove() }
}, [])
```

### Complete notification → deep link map

```
TYPE                    TITLE                           DEEP LINK TARGET
────────────────────────────────────────────────────────────────────────
BUS_APPROACHING         "Bus {N} is 5 minutes away"     /(student)/map
SUBSTITUTE_ASSIGNED     "Your bus has changed to Bus {N}" /(student)/
ARRIVAL_VERIFY          "Confirm your arrival"           /(student)/verify-arrival?tripId=X
CHECKIN_CONFIRMED       "Check-in confirmed"             /(student)/
CORRECTION_REVIEWED     "Correction {approved/rejected}" /(student)/history
BREAKDOWN_ON_YOUR_BUS   "Bus {N} breakdown"              /(student)/
TRIP_CANCELLED          "Today's trip cancelled"         /(student)/
────────────────────────────────────────────────────────────────────────
ADMIN_MESSAGE (driver)  "New message from coordinator"   /(driver)/messages
WAIT_REQUEST (driver)   "{Name} is 2 min away"           /(driver)/kiosk
LATE_START (driver)     "Trip is late — please start"    /(driver)/
```

### Tamil notification copy

Every notification has both English and Tamil versions.
Backend sends the correct language based on `user.preferredLanguage`.

```typescript
// Backend: notifications/templates.ts
const templates = {
  BUS_APPROACHING: {
    en: { title: 'Bus {N} is 5 minutes away', body: 'Head to {stop} now' },
    ta: { title: 'பேருந்து {N} 5 நிமிடத்தில்', body: 'இப்போதே {stop}க்கு செல்லுங்கள்' },
  },
  SUBSTITUTE_ASSIGNED: {
    en: { title: 'Your bus has changed', body: 'Bus {N} is your bus today (was Bus {M})' },
    ta: { title: 'உங்கள் பேருந்து மாற்றப்பட்டது', body: 'பேருந்து {N} இன்று உங்கள் பேருந்து' },
  },
  // ... all types
}
```

---

## 8. Substitute Bus Flow

### Three cases, one smooth experience

**Case 1 — Pre-assigned before student opens app:**
```
Admin assigns Bus 7 as substitute for Bus 12
Student opens app → /student/home returns busId: "bus-7-id", isSubstitute: true
Home screen shows: "Bus 7 (substitute for Bus 12)"
Student scans Bus 7's QR → normal check-in
```

**Case 2 — Pre-assigned, student already checked in:**
```
Student already checked in on Bus 12
Admin assigns substitute Bus 7
Backend: transfers AttendanceLog to Bus 7 automatically
Student opens app → sees "✓ Checked in · Bus 7 (transferred from Bus 12)"
Student notification: "Your attendance transferred to Bus 7"
No re-scan needed. Zero friction.
```

**Case 3 — On-the-fly substitute (bus breaks down mid-route):**
```
Admin marks incident on Bus 12 → assigns substitute Bus 7
Backend:
  - Students on Bus 12 not yet checked in → their routeAssignment temporarily
    points to Bus 7 for today
  - Students already checked in → attendance transferred
  - Push notification to all affected students
Mobile:
  - Foreground: TanStack Query auto-refetches (1 min interval)
  - Background: FCM push notification triggers query invalidation
  - Firebase subscription automatically switches to Bus 7
    (busId changes in home response → useEffect in map.tsx fires)
```

### Firebase subscription switching

```typescript
// hooks/useLiveBus.ts
const prevBusIdRef = useRef<string | null>(null)
const listenerRef = useRef<(() => void) | null>(null)

useEffect(() => {
  const busId = homeData?.trip?.busId
  if (!busId || busId === prevBusIdRef.current) return

  // Unsubscribe from old bus
  listenerRef.current?.()

  // Subscribe to new bus
  const ref = firebase.database().ref(`/buses/${busId}`)
  const handler = ref.on('value', snap => setBusLocation(snap.val()))
  listenerRef.current = () => ref.off('value', handler)
  prevBusIdRef.current = busId

  return () => listenerRef.current?.()
}, [homeData?.trip?.busId])
```

---

## 9. Unassigned Student Flow

### Problem
A student exists in real life (physically attending college) but was missed
during the bulk import. They are not in the system but want to check in.

### Solution — self-registration with admin alert

**`(auth)/pending.tsx` — additional flow:**
```typescript
// Student taps "I know my bus — check in anyway"
// Scanner opens with isUnassigned: true

// POST /v1/attendance/checkin with { isUnassigned: true }
// Backend:
//   1. Creates a temporary RouteAssignment record (isOverride: true, needs admin review)
//   2. Marks attendance PRESENT
//   3. Fires admin notification: "Unassigned student checked in: [name]"
//   4. Adds to admin dashboard counter: "X students need assignment"
```

**Admin dashboard — bulk view:**
```
Unassigned students                              [Bulk assign]
─────────────────────────────────────────────────────────────
32 students checked in without route assignment
Last updated 2 minutes ago

Name            Roll No    Bus      Date        Action
Karthik R       21CS044    Bus 12   18 Mar      [Assign]
Meera T         21CS043    Bus 7    18 Mar      [Assign]
...

[Select all] [Bulk assign to route] [Export CSV]
```

**Bulk assign flow:**
```
Admin selects students → [Bulk assign] →
Dropdown: select route →
System assigns all selected students to that route →
Students get notification: "You've been assigned to Tambaram Route (Bus 12)"
Students app refreshes → now has full access
```

---

## 10. Offline Queue

### Check-in queue

```typescript
// lib/checkin-queue.ts
interface QueuedCheckin {
  id: string              // uuid — for deduplication
  qrToken: string
  lat: number
  lon: number
  accuracy: number
  clientTimestamp: number  // when student scanned
  queuedAt: number         // when added to queue
  retries: number
}

const QUEUE_KEY = 'checkin_queue'
const MAX_AGE_MS = 90 * 60 * 1000   // 90 minutes — mobile pre-filter
const MAX_RETRIES = 3

export const queueCheckin = async (payload: Omit<QueuedCheckin, 'id' | 'queuedAt' | 'retries'>) => {
  const queue = await getQueue()
  const item: QueuedCheckin = {
    ...payload,
    id: uuid(),
    queuedAt: Date.now(),
    retries: 0,
  }
  await saveQueue([...queue, item])
}

export const flushCheckinQueue = async () => {
  const queue = await getQueue()
  const remaining: QueuedCheckin[] = []

  for (const item of queue) {
    // Layer 1: mobile pre-filter
    if (Date.now() - item.queuedAt > MAX_AGE_MS) {
      showExpiredToast(item)
      continue
    }

    try {
      const result = await api.post('/v1/attendance/checkin', {
        ...item,
        isReplay: true,
      })

      if (result.status === 201 || result.status === 200) {
        showSuccessToast('Check-in confirmed')
        // Update TanStack Query cache
        queryClient.invalidateQueries({ queryKey: ['student-home'] })
      }
    } catch (error: any) {
      if (error.response?.status === 410) {
        // Trip ended — offer correction
        showCorrectionPrompt(item)
      } else if (error.response?.status === 409) {
        // Already checked in — was successful
        showSuccessToast('Already checked in')
      } else if (item.retries < MAX_RETRIES) {
        remaining.push({ ...item, retries: item.retries + 1 })
      } else {
        showFailureToast()
      }
    }
  }

  await saveQueue(remaining)
}
```

### Correction queue

```typescript
// Same pattern — queue correction requests offline
// Flush on reconnect
// Higher priority than check-in queue — flush corrections first
```

---

## 11. Background GPS Task

### Driver GPS background task

Current code note:
- the live mobile task in `apps/mobile/tasks/gps.task.ts` performs delta compression and posts directly to `/v1/gps/ping`
- it does not currently write to Firebase RTDB from the device
- Firebase RTDB projection happens in the backend GPS service after ingest, in `apps/backend/src/modules/gps/gps.service.ts`
- that means backend GPS ingest is the operational choke point for live-map correctness
```typescript
// tasks/gps.task.ts
import * as TaskManager from 'expo-task-manager'
import * as Location from 'expo-location'

const GPS_TASK_NAME = 'background-gps-task'

TaskManager.defineTask(GPS_TASK_NAME, async ({ data, error }) => {
  if (error) return
  const { locations } = data as { locations: Location.LocationObject[] }
  const location = locations[0]

  const { tripId, busId } = getGPSContext()  // from AsyncStorage

  // Adaptive ping rate
  const speed = location.coords.speed ?? 0
  const speedKmh = speed * 3.6

  // Delta compression — skip if moved less than 5m
  const lastPos = await getLastPosition()
  if (lastPos) {
    const distance = getDistanceMetres(
      lastPos.lat, lastPos.lon,
      location.coords.latitude, location.coords.longitude
    )
    if (distance < 5) return  // skip this ping
  }

  // Write to Firebase RTDB
  await firebase.database().ref(`/buses/${busId}`).update({
    lat: location.coords.latitude,
    lon: location.coords.longitude,
    speed: speedKmh,
    heading: location.coords.heading ?? 0,
    accuracy: location.coords.accuracy,
    gpsStatus: 'LIVE',
    lastUpdated: Date.now(),
  })

  // Write to backend (GPS log + heartbeat)
  await api.post('/v1/gps/ping', {
    busId, tripId,
    lat: location.coords.latitude,
    lon: location.coords.longitude,
    speed: speedKmh,
    heading: location.coords.heading ?? 0,
    accuracy: location.coords.accuracy,
    timestamp: location.timestamp,
  }).catch(() => {})  // silent fail — Firebase write is the critical one

  // Update heartbeat in AsyncStorage
  await AsyncStorage.setItem(`gps:heartbeat:${busId}`, String(Date.now()))
  await setLastPosition({
    lat: location.coords.latitude,
    lon: location.coords.longitude
  })
})

// Start task (called when driver starts trip)
export const startGPSTask = async (tripId: string, busId: string) => {
  await AsyncStorage.setItem('gps-context', JSON.stringify({ tripId, busId }))
  await Location.startLocationUpdatesAsync(GPS_TASK_NAME, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 3000,     // every 3 seconds base
    distanceInterval: 5,    // OR every 5 metres — whichever comes first
    foregroundService: {
      notificationTitle: 'Bus 12 — Trip Active',
      notificationBody: 'GPS tracking is running',
      notificationColor: '#1E3A8A',
    },
    // Android: prevent OEM from killing the task
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.AutomotiveNavigation,
    showsBackgroundLocationIndicator: true,  // iOS blue bar
  })
}

export const stopGPSTask = async () => {
  await Location.stopLocationUpdatesAsync(GPS_TASK_NAME)
  await AsyncStorage.removeItem('gps-context')
}
```

Treat the snippet above as older target flow, not a literal copy of the current task implementation.

---

## 12. Socket.io Connection

### Connection management

Current code note:
- `apps/mobile/lib/socket.ts` currently uses bounded reconnect attempts (`50`), exponential backoff, jitter, and an Android toast on `reconnect_failed`
- student realtime in `apps/mobile/hooks/useStudentSocket.ts` is intentionally lightweight and still relies on query invalidation for some reconciliation
- this is functional, but it should not be described as fully self-healing without reconnect and missed-state QA
```typescript
// lib/socket.ts
import { io, Socket } from 'socket.io-client'

let socket: Socket | null = null

export const getSocket = () => {
  if (!socket) {
    socket = io(process.env.EXPO_PUBLIC_API_URL!, {
      auth: { token: useAuthStore.getState().token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,  // exponential backoff, max 10s
      timeout: 10000,
    })
  }
  return socket
}

export const disconnectSocket = () => {
  socket?.disconnect()
  socket = null
}
```

Treat the snippet above as connection design intent. Check `apps/mobile/lib/socket.ts` for the actual retry settings.

### Driver kiosk hook

```typescript
// hooks/useKioskSocket.ts
export const useKioskSocket = (tripId: string) => {
  const socket = getSocket()

  useEffect(() => {
    socket.emit('join-trip', { tripId })

    socket.on('qr:refresh', handleQRRefresh)
    socket.on('checkin:success', handleCheckinSuccess)
    socket.on('wait:request', handleWaitRequest)
    socket.on('admin:message', handleAdminMessage)

    // Connection state
    socket.on('connect', () => setSocketStatus('connected'))
    socket.on('disconnect', () => setSocketStatus('disconnected'))
    socket.on('reconnecting', () => setSocketStatus('reconnecting'))

    return () => {
      socket.emit('leave-trip', { tripId })
      socket.off('qr:refresh', handleQRRefresh)
      socket.off('checkin:success', handleCheckinSuccess)
      socket.off('wait:request', handleWaitRequest)
      socket.off('admin:message', handleAdminMessage)
    }
  }, [tripId])
}
```

---

## 13. Firebase RTDB Integration

### Initialization

Current code note:
- `apps/mobile/lib/firebase.ts` uses the Firebase JS SDK, not `@react-native-firebase/database`
- the live student subscription in `apps/mobile/hooks/useLiveBus.ts` is scoped to `/buses/{busId}`
- current student UI deliberately translates raw GPS freshness into calmer states instead of exposing internal status language directly
```typescript
// lib/firebase.ts
import firebase from '@react-native-firebase/app'
import database from '@react-native-firebase/database'

// Enable offline persistence — MUST be called before any database operations
database().setPersistenceEnabled(true)

// Keep buses synced for offline access
database().ref('/buses').keepSynced(true)
```

The initialization snippet below is older/native-oriented guidance. Use the current Expo-side Firebase wrapper as the implementation reference.

### Live bus hook

```typescript
// hooks/useLiveBus.ts
export const useLiveBus = (busId: string | null) => {
  const [busLocation, setBusLocation] = useState<BusLocation | null>(null)
  const prevBusIdRef = useRef<string | null>(null)
  const listenerRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!busId || busId === prevBusIdRef.current) return

    // Clean up previous listener
    listenerRef.current?.()

    const ref = database().ref(`/buses/${busId}`)
    const handler = ref.on('value', snapshot => {
      const data = snapshot.val()
      if (data) setBusLocation(data)
    })

    listenerRef.current = () => ref.off('value', handler)
    prevBusIdRef.current = busId

    return () => listenerRef.current?.()
  }, [busId])

  const isStale = busLocation
    ? Date.now() - busLocation.lastUpdated > 90_000
    : false

  return {
    busLocation,
    gpsStatus: isStale ? 'OFFLINE' : (busLocation?.gpsStatus ?? 'UNKNOWN'),
    isStale,
  }
}
```

---

## 14. Admin Dashboard — Bulk Actions

These are the admin-facing surfaces that support the mobile app flows.
Displayed in the admin panel (`apps/admin`).

### Dashboard alert cards

```
┌─ Needs immediate attention ──────────────────────────────────┐
│                                                               │
│  [!] 3 buses have not started their trips (12 min late)      │
│      Bus 4, Bus 7, Bus 12  [View all] [Alert drivers]        │
│                                                               │
│  [!] Bus 8 reported a breakdown (Flat tyre · 8:32 AM)        │
│      Tambaram Route · 42 students affected  [View incident]  │
│                                                               │
│  [~] 32 students need route assignment                        │
│      Checked in without assignment today   [Bulk assign]      │
│                                                               │
│  [~] 14 correction requests pending review                    │
│      Oldest: 2 days ago                    [Review all]       │
└───────────────────────────────────────────────────────────────┘
```

### Unassigned students bulk view

```
GET /v1/admin/unassigned-students

Returns: {
  total: 32,
  students: [
    { id, name, rollNumber, busUsed, dateCheckedIn, checkInCount }
  ]
}

Actions:
  POST /v1/admin/bulk-assign-route
  Body: { userIds: string[], routeId: string }

  After bulk assign:
    → All students get FCM notification "You've been assigned to [Route]"
    → Their app refreshes automatically (query invalidation via socket)
    → They move from pending.tsx to student home
```

### Substitute bus management

```
GET /v1/admin/active-trips
→ Shows all active trips with status

POST /v1/admin/trips/:id/assign-substitute
Body: { substituteDriverId, substituteBusId }
→ Triggers full substitute flow:
  1. Updates trip record
  2. Transfers existing check-ins
  3. Updates all affected students' home response
  4. Sends push notifications to affected students
  5. Updates Firebase RTDB subscription context
```

---

## 15. Complete File Structure

```
apps/mobile/
├── app/
│   ├── _layout.tsx
│   ├── (auth)/
│   │   ├── _layout.tsx
│   │   ├── login.tsx
│   │   ├── verify-otp.tsx
│   │   └── pending.tsx
│   ├── (student)/
│   │   ├── _layout.tsx
│   │   ├── index.tsx
│   │   ├── map.tsx
│   │   ├── history.tsx
│   │   ├── profile.tsx
│   │   ├── scanner.tsx
│   │   ├── checkin-success.tsx
│   │   ├── checkin-fail.tsx
│   │   ├── verify-arrival.tsx
│   │   └── correction/
│   │       ├── index.tsx
│   │       └── [logId].tsx
│   └── (driver)/
│       ├── _layout.tsx
│       ├── index.tsx
│       ├── route-preview.tsx
│       ├── kiosk.tsx
│       ├── breakdown.tsx
│       ├── post-breakdown.tsx
│       ├── summary.tsx
│       └── messages.tsx
│
├── components/
│   ├── shared/
│   │   ├── SplashScreen.tsx
│   │   ├── OfflineBanner.tsx
│   │   ├── LoadingState.tsx
│   │   ├── ErrorState.tsx
│   │   └── EmptyState.tsx
│   ├── student/
│   │   ├── BusStatusCard.tsx       ← 7 states
│   │   ├── CheckInButton.tsx       ← 6 states
│   │   ├── StatCards.tsx           ← attendance %, present, absent
│   │   ├── AttendanceRow.tsx       ← single history row
│   │   ├── CorrectionNudge.tsx     ← "you were absent yesterday" card
│   │   └── WaitForMeSheet.tsx      ← bottom sheet
│   └── driver/
│       ├── QRDisplay.tsx           ← QR + countdown ring
│       ├── CheckInToast.tsx        ← 4s auto-dismiss toast
│       ├── WaitRequestBanner.tsx   ← wait-for-me banner
│       ├── ManualMarkSheet.tsx     ← bottom sheet
│       └── AdminMessageBar.tsx     ← urgent message banner
│
├── hooks/
│   ├── useAuth.ts
│   ├── useLiveBus.ts               ← Firebase RTDB + auto-switch on substitute
│   ├── useStudentHome.ts           ← TanStack Query wrapper
│   ├── useAttendanceHistory.ts     ← infinite scroll
│   ├── useCheckin.ts               ← submit + queue + offline handling
│   ├── useKioskSocket.ts           ← Socket.io for driver kiosk
│   ├── useOfflineQueue.ts          ← flush on reconnect
│   └── useNetworkStatus.ts         ← NetInfo wrapper
│
├── store/
│   ├── auth.store.ts               ← Zustand + AsyncStorage persist
│   └── trip.store.ts               ← driver trip state (Zustand)
│
├── lib/
│   ├── api.client.ts               ← Axios + interceptors
│   ├── socket.ts                   ← Socket.io singleton
│   ├── firebase.ts                 ← Firebase init + persistence
│   ├── notifications.ts            ← FCM setup + deep link handler
│   ├── checkin-queue.ts            ← offline check-in queue
│   └── query-client.ts             ← TanStack Query config
│
├── tasks/
│   └── gps.task.ts                 ← Expo background location task
│
├── i18n/
│   ├── index.ts                    ← language switcher
│   ├── en.ts                       ← English strings
│   └── ta.ts                       ← Tamil strings
│
├── constants/
│   └── index.ts                    ← import from packages/shared
│
└── types/
    └── index.ts                    ← import from packages/shared
```

---

## 16. Build Rules for Claude Code

These are implementation rules and target conventions.
They are useful as guardrails, but they do not prove the current code already satisfies every item.

### Navigation
1. Never use `router.push` for role-switching — only the root `_layout.tsx` routes between role groups
2. Tab bar must be hidden on: scanner, checkin-success, checkin-fail, verify-arrival, kiosk
3. All deep links must be registered in the FCM handler in root `_layout.tsx`

### API calls
4. Never call API directly in a component — always use a hook
5. Every query must have `networkMode: 'offlineFirst'`
6. Every mutation that touches attendance must have an offline fallback (queue)
7. Never show a raw API error message to users — always map to human language

### State
8. User session lives only in Zustand auth store — never in component state
9. All server state lives in TanStack Query — never duplicated in Zustand
10. AsyncStorage is only for: auth persistence, offline queue, cache, preferences

### GPS + Firebase
Current code note: the live mobile task posts GPS to backend first; backend then updates Firebase RTDB.

11. Firebase persistence must be enabled before any database operation
12. GPS task must write to Firebase RTDB AND backend — RTDB is the critical one
13. Firebase subscription must clean up on unmount — no memory leaks
14. Subscription must switch automatically when busId changes (substitute bus)

### Performance + low network
15. Every screen must show cached data before making any API call
16. No screen may show a blank white screen under any network condition
17. Offline queue flushes automatically on network reconnect — never manual
18. GPS task uses delta compression — skip write if bus moved < 5 metres

### Notifications
19. FCM token must be refreshed and sent to backend on every app launch
20. All notification handlers must be set up in root `_layout.tsx` — not in individual screens
21. Tamil notifications sent by backend based on `user.preferredLanguage`
22. Every notification type must have both English and Tamil copy in backend templates

---

*Mobile App Structure & System Architecture — College Bus Management System*  
*March 2026.*  
*Status: architecture target plus current-code notes; verify implementation maturity in code and device QA before treating any section as production-ready.*
