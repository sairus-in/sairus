# College Bus Management System
# Mobile App — Target Structure & System Architecture
# Implementation Blueprint v2 (Not Readiness Proof)

> Built from: all flow decisions + low-network strategy + substitute bus logic +
> unassigned student handling + push notification deep links + offline queue.
> v2 update: 7 fixes from architecture review applied.
> This document is a build blueprint and intent spec, not a claim that every flow is production-complete today.

Status legend for claims in this file:
- Target: intended architecture
- Implemented: present in code
- Validate: needs runtime/device proof

---

## What Changed in v2

7 fixes applied from post-review:

| # | Fix | Impact |
|---|---|---|
| 1 | Realtime channel law — hard boundary between Firebase and Socket.io | Eliminates split-brain bugs |
| 2 | Zustand hydration hard blocking gate | Eliminates navigation flicker on slow Android |
| 3 | Driver kiosk GPS status indicator | Driver knows when GPS task is killed |
| 4 | 410 replay → auto-create correction request on backend | Student never manually submits after offline replay |
| 5 | keepSynced scoped to one bus, not all 200 | 200x reduction in background data usage |
| 6 | Socket reconnection: jitter + max 50 attempts | Prevents server death spiral on restart |
| 7 | Replace refetchInterval polling with socket-driven invalidation | Eliminates mass refetch spike every 60s |

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

### Structural integrity above everything
- Navigation must work perfectly before any design is applied
- Every screen has a defined loading state, error state, empty state, offline state
- No screen ever shows a blank white page under any condition
- Every API call has a fallback

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

### [FIX 1] Realtime channel law — NEVER violate this

```
Firebase RTDB  → ONLY live bus position
               Fields: lat, lon, speed, heading, gpsStatus, lastUpdated
               Driver writes directly. Students read directly.
               Backend NEVER proxies Firebase reads.
               GPS data NEVER travels through Socket.io.

Socket.io      → ONLY server-triggered events
               Events: qr:refresh, checkin:success, wait:request,
                       admin:message, home:refresh, substitute:assigned
               Event data NEVER travels through Firebase.
               GPS position NEVER emitted via Socket.io.
```

Mixing these two channels is the #1 source of split-brain bugs.
Any engineer who crosses this boundary is creating a 3am debugging nightmare.

### [FIX 2] Zustand hydration is a hard blocking gate

```typescript
// app/_layout.tsx — CORRECT pattern
const { user, isLoaded } = useAuthStore()

// Hard gate — nothing renders until storage is read
if (!isLoaded) return <SplashScreen />

// Now safe to route
if (!user) return <Redirect href="/(auth)/login" />
// ...
```

- Navigator MUST NOT render until `isLoaded = true`
- `isLoaded` only becomes true after AsyncStorage has been fully read
- Splash screen shown during this window — never a blank screen, never a flicker
- Prevents the login-screen flash bug common on low-end Android devices

---

## 2. Navigation Architecture

### Root layout — the brain

```typescript
// app/_layout.tsx — routing logic
const { user, isLoaded } = useAuthStore()

if (!isLoaded) return <SplashScreen />           // HARD GATE — reading from AsyncStorage
if (!user)     → redirect('/(auth)/login')        // not authenticated
if (user.role === 'DRIVER') → redirect('/(driver)/')
if (!user.routeAssignment && !user.isUnassigned) → redirect('/(auth)/pending')
else → redirect('/(student)/')
```

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
  // scanner, checkin-success, checkin-fail, verify-arrival → tabBarStyle: {display:'none'}
</Tabs>
```

### Deep link scheme

```json
{
  "expo": {
    "scheme": "busapp",
    "plugins": ["expo-router"]
  }
}
```

---

## 3. Screen Inventory

### AUTH SCREENS

---

#### `(auth)/login.tsx`

**States:**
```
idle     → input + "Send OTP" button
loading  → button disabled + spinner
error    → specific message ("Phone not registered" / "Too many attempts")
success  → navigate to verify-otp
```

**Logic:**
```typescript
1. Format to +91XXXXXXXXXX
2. Firebase: auth().signInWithPhoneNumber(formatted)
3. On success → router.push('/(auth)/verify-otp', { verificationId, phone })
Error mapping:
  auth/invalid-phone-number → "Enter a valid 10-digit number"
  auth/too-many-requests    → "Too many attempts. Try again in 1 hour."
```

**No backend call here. Firebase handles OTP entirely.**

---

#### `(auth)/verify-otp.tsx`

**States:**
```
idle     → 6 OTP inputs + "Verify" button (disabled until 6 digits)
loading  → button disabled
error    → "Incorrect code. X attempts remaining."
resend   → available after 30s countdown
success  → backend exchange → navigate to role destination
```

**Logic:**
```typescript
1. Firebase credential from verificationId + OTP
2. Get Firebase ID token
3. POST /v1/auth/login { firebaseToken, deviceId: await getDeviceId() }
4. Store in Zustand: setUser(user, token)
5. Root _layout.tsx reacts → routes automatically
```

---

#### `(auth)/pending.tsx`

**Shows:**
```
"You're registered — transport assignment being set up"
"Contact transport office if this takes more than 24 hours"
Bus: Not yet assigned
Stop: Not yet assigned
[Check again] → re-fetch /v1/auth/me
[Contact transport office] → opens phone dialer
[I know my bus — check in anyway] → scanner with isUnassigned: true
```

**Auto-poll:** Every 2 minutes, silently re-fetch `/v1/auth/me`.
If routeAssignment appears → root layout automatically redirects.

---

### STUDENT SCREENS

---

#### `(student)/index.tsx` — Home

**Data source:** `GET /v1/student/home` (BFF endpoint)

**Response shape:**
```typescript
{
  student: { id, name, rollNumber, department, year, routeId, stopId, stopName, busId, busNumber },
  trip: {
    id, status, type, busId, busNumber, driverName,
    isSubstitute, originalBusNumber,
    substituteInfo: { reason, assignedAt } | null,
    canCheckIn: boolean,
    checkInReason: null | 'ALREADY_CHECKED_IN' | 'TRIP_NOT_ACTIVE'
                       | 'TRIP_SKIPPED' | 'WINDOW_CLOSED' | 'UNASSIGNED',
    scheduledDeparture: "07:15",
    minutesLate: number | null,
  } | null,
  attendance: {
    today: AttendanceStatus | null,
    checkedInAt: string | null,
    busNumber: string | null,
    percentage: number,
    presentCount: number,
    absentCount: number,
    pendingCorrections: number,
  },
  alerts: {
    yesterdayAbsent: boolean,
    yesterdayDate: string | null,
    substituteAssigned: boolean,
  }
}
```

**7 distinct states:**
```
LOADING          → skeleton cards (stale cache shown underneath immediately)
NO_TRIP          → "No trip scheduled today"
TRIP_NOT_STARTED → Bus card (gray) + disabled check-in + "Driver hasn't started yet"
LATE_START       → Same + red banner "Bus is X minutes late"
ACTIVE           → Bus card (live GPS) + green check-in button
CHECKED_IN       → Bus card + green "✓ Checked in at X:XX AM"
WINDOW_CLOSED    → Bus card + "Check-in window closed" + correction link
```

**[FIX 7] Query config — socket-driven, not interval-driven:**
```typescript
useQuery({
  queryKey: ['student-home'],
  queryFn: () => api.get('/v1/student/home'),
  staleTime: 5 * 60 * 1000,
  // NO refetchInterval — backend pushes home:refresh via socket instead
  refetchOnWindowFocus: true,   // backup — refetch when app comes to foreground
  networkMode: 'offlineFirst',
})

// Socket-driven invalidation (in useKioskSocket or root socket handler):
socket.on('home:refresh', () => {
  queryClient.invalidateQueries({ queryKey: ['student-home'] })
})
// Backend emits home:refresh when: substitute assigned, trip started,
// correction reviewed, trip cancelled
```

**Realtime:** After home loads `busId`, open Firebase RTDB subscription to `/buses/{busId}`

---

#### `(student)/map.tsx` — Live Map

**Data source:** Firebase RTDB only — no backend call.
`busId` comes from home query cache.

**States:**
```
LOADING     → map loads + spinner overlay
LIVE        → bus marker moving + ETA + next stop card
GPS_OFFLINE → map shows last position (faded) + amber banner "GPS signal lost · last seen X min ago"
NO_TRIP     → static map + "No active trip"
NO_BUS_ID   → "Open home screen first"
```

**Smooth marker animation:**
```typescript
// Interpolate between GPS pings using speed + heading
// Update marker every 500ms even between pings
// Bus appears to glide at speed rather than jump every 3s
```

---

#### `(student)/scanner.tsx` — QR Scanner

**No tab bar on this screen.**

**On mount (parallel):**
```typescript
useEffect(() => {
  Promise.all([
    requestCameraPermission(),
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      .then(loc => locationRef.current = loc)
      .catch(() => {})   // silent — retry on scan
  ])
}, [])
```

**On QR decode:**
```typescript
const handleScan = async ({ data: qrToken }) => {
  if (scanned) return
  setScanned(true)

  const location = locationRef.current
    ?? await Location.getCurrentPositionAsync({ accuracy: Balanced })

  const result = await submitCheckIn({
    qrToken,
    lat: location.coords.latitude,
    lon: location.coords.longitude,
    accuracy: location.coords.accuracy,
    clientTimestamp: Date.now(),
  })

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
REQUESTING_PERMISSION → loading
PERMISSION_DENIED     → "Camera access needed" + [Open Settings]
SCANNING              → camera + corner brackets + "Fetching location..." if GPS not ready
PROCESSING            → "Verifying..." overlay
```

---

#### `(student)/checkin-success.tsx`

**Props:**
```typescript
{ offline?: 'true', status?: 'PRESENT' | 'LATE_BOARD', checkedInAt?, distanceToBus?, distanceToStop? }
```

**States:**
```
PRESENT    → green + "Checked in!" + time + distance
LATE_BOARD → amber + "Checked in" + "You were a bit far from the stop"
OFFLINE    → amber + "Saved offline" + "Will sync when connected"
```

**Auto-navigate:** 2500ms → `router.replace('/(student)/')`
**Haptic:** `NotificationFeedbackType.Success`

---

#### `(student)/checkin-fail.tsx`

**Error → copy mapping (never show raw codes):**
```
TOO_FAR         → "You're {X}m away. Move closer and try again."
                  [Try again] [Request correction]
QR_EXPIRED      → "Code expired. Ask driver for a fresh one."
                  [Try again]
QR_ALREADY_USED → "This code was just used. Next code in ~{X}s"
                  [Try again] + countdown timer
WRONG_BUS       → "This is Bus {N}'s code. Your bus is Bus {M}."
                  [Close]
TRIP_NOT_ACTIVE → "Trip hasn't started yet."
                  [Go back]
DEVICE_MISMATCH → "Login detected on another device."
                  [Re-register device]
RATE_LIMITED    → "Too many attempts. Wait 1 minute."
                  [Go back]
```

---

#### `(student)/verify-arrival.tsx`

**FCM deep link target. Student barely notices this screen.**

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

**Shows:** Spinner + "Verifying your arrival..." → closes in 1.5s automatically.

---

#### `(student)/history.tsx`

**Data:** `GET /v1/attendance/history?page=1&limit=20`
**Features:** Filter pills (All | Absent | Corrections), infinite scroll, progress bar
**States:** loading → loaded → load-more → empty → offline-cached → error

---

#### `(student)/correction/[logId].tsx`

**Data:** `GET /v1/attendance/logs/:logId`
**Action:** `POST /v1/attendance/correction-request`
**Shows:** Date/bus card + GPS evidence card (distanceToBus + distanceToStop) + reason input
**Offline:** Queue the correction request. Sync on reconnect.

---

### DRIVER SCREENS

---

#### `(driver)/index.tsx` — Pre-trip Assignment

**Data:** `GET /v1/driver/today`
**States:**
```
NO_TRIP    → "No trip scheduled today"
SCHEDULED  → Assignment card + [Start morning trip]
LATE       → Same + red banner "X min late. Coordinator notified."
ACTIVE     → Auto-redirect to kiosk.tsx
COMPLETED  → "Today's trip is complete" + summary link
```

---

#### `(driver)/kiosk.tsx` — Active Kiosk

**[FIX 3] GPS status indicator added to kiosk:**

```typescript
// Check GPS task health every 10 seconds
useEffect(() => {
  const check = setInterval(async () => {
    const lastWrite = await AsyncStorage.getItem(`gps:heartbeat:${busId}`)
    const isGPSAlive = lastWrite && (Date.now() - Number(lastWrite)) < 15_000
    setGPSStatus(isGPSAlive ? 'LIVE' : 'DEAD')
  }, 10_000)
  return () => clearInterval(check)
}, [busId])

// In kiosk UI — top status bar:
// Green dot "GPS active" when alive
// Red dot "GPS stopped — reopen app" when dead
// Red state triggers Haptics.notificationAsync(Warning) once
```

**On mount:**
```typescript
await KeepAwake.activateKeepAwakeAsync()
await Brightness.setBrightnessAsync(1.0)
socket.connect()
socket.emit('join-trip', { tripId })
await startGPSTask(tripId, busId)
```

**Socket events:**
```typescript
socket.on('qr:refresh', ({ qrToken, expiresAt }) => { setQrToken(qrToken); setExpiresAt(expiresAt) })
socket.on('checkin:success', ({ name, status, distanceToStop }) => {
  setLastToast({ name, status, distanceToStop, time: Date.now() })
  setBoardedCount(prev => prev + 1)
})
socket.on('wait:request', ({ studentName, etaMinutes }) => addWaitRequest({ studentName, etaMinutes }))
socket.on('admin:message', ({ body, isUrgent }) => {
  addAdminMessage({ body, isUrgent })
  if (isUrgent) Haptics.notificationAsync(NotificationFeedbackType.Warning)
})
```

**QR refresh fallback:**
```typescript
useEffect(() => {
  if (countdown > 0) return
  api.get(`/v1/trips/${tripId}/qr`)
    .then(({ qrToken, expiresAt }) => { setQrToken(qrToken); setExpiresAt(expiresAt) })
}, [countdown])
```

**Manual mark bottom sheet:**
```typescript
// Slides up without leaving kiosk — driver never loses QR view
<BottomSheet>
  <SearchInput placeholder="Search student name..." />
  <StudentList onSelect={(student) => {
    api.post(`/v1/trips/${tripId}/manual-mark`, { userId: student.id, reason: selectedReason })
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

#### `(driver)/breakdown.tsx`

**States:** TYPE_SELECT → CONFIRMING → SUBMITTING → SUCCESS / OFFLINE
**API:** `POST /v1/incidents/report`
**Offline:** Queue with high priority. Sync immediately on reconnect.

---

#### `(driver)/summary.tsx`

**Shows:** 3 stats (Boarded/Absent/Expected) + trip times + absent list with reason badges
**Absent list:** driver can tap name → manual mark bottom sheet (last chance before end)
**End trip:** confirmation bottom sheet → `POST /v1/trips/:id/end`

---

## 4. State Management Architecture

### What lives where

```
Zustand (persistent, global)      → Auth store: user, token, deviceId, fcmToken, isLoaded
TanStack Query (server state)     → All API responses: home, history, trip, driver-today
Local component state             → Form inputs, modal open/close, UI toggles
AsyncStorage (persistent offline) → homeCache, checkinQueue, correctionQueue, fcmToken, language
```

### Zustand auth store

```typescript
// store/auth.store.ts
interface AuthStore {
  user: User | null
  token: string | null
  deviceId: string | null
  isLoaded: boolean        // FALSE until AsyncStorage read completes

  setUser: (user: User, token: string) => void
  clearUser: () => void
  setFcmToken: (token: string) => void
}

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
      // NO global refetchInterval — use socket-driven invalidation per query
    },
  },
})
```

---

## 5. API Connection Map

### Axios client

```typescript
// lib/api.client.ts
const api = axios.create({
  baseURL: process.env.EXPO_PUBLIC_API_URL,
  timeout: 10_000,
})

api.interceptors.request.use(config => {
  const token = useAuthStore.getState().token
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  res => res,
  async error => {
    if (error.response?.status === 401) {
      useAuthStore.getState().clearUser()
      router.replace('/(auth)/login')
    }
    return Promise.reject(error)
  }
)
```

### Endpoint map

```
SCREEN                    METHOD   ENDPOINT                           CACHE TTL
─────────────────────────────────────────────────────────────────────────────
login.tsx                 POST     /v1/auth/login                     none
verify-otp.tsx            POST     /v1/auth/login                     none
pending.tsx               GET      /v1/auth/me                        30s poll
─────────────────────────────────────────────────────────────────────────────
index.tsx (student)       GET      /v1/student/home                   5 min
map.tsx                   —        Firebase RTDB /buses/{busId}        realtime
history.tsx               GET      /v1/attendance/history?page&limit   10 min
scanner.tsx               POST     /v1/attendance/checkin              none
verify-arrival.tsx        POST     /v1/attendance/verify-arrival       none
correction/[logId].tsx    GET      /v1/attendance/logs/:logId          5 min
correction/[logId].tsx    POST     /v1/attendance/correction-request   none
profile.tsx               PATCH    /v1/users/fcm-token                 none
─────────────────────────────────────────────────────────────────────────────
index.tsx (driver)        GET      /v1/driver/today                    1 min
kiosk.tsx                 GET      /v1/trips/:id/qr                    fallback only
kiosk.tsx                 POST     /v1/trips/:id/manual-mark           none
kiosk.tsx                 —        Socket.io trip:{tripId} room         realtime
breakdown.tsx             POST     /v1/incidents/report                none
summary.tsx               GET      /v1/trips/:id/summary               none
summary.tsx               POST     /v1/trips/:id/end                   none
messages.tsx              GET      /v1/messages/:busId                 30s
messages.tsx              POST     /v1/messages/:id/reply              none
```

---

## 6. Low Network Strategy

### Three-layer architecture

**Layer 1 — Cache first, always**
```typescript
networkMode: 'offlineFirst'   // TanStack Query — returns cache before fetching
```

**Layer 2 — AsyncStorage persistence across restarts**
```typescript
// On every successful home fetch:
AsyncStorage.setItem('home-cache', JSON.stringify(data))

// On app launch, before any API call:
const cached = await AsyncStorage.getItem('home-cache')
if (cached) setHomeData(JSON.parse(cached))  // instant — no spinner
// Then fetch in background and update when ready
```

**Layer 3 — NetInfo reactive reconnection**
```typescript
import NetInfo from '@react-native-community/netinfo'

NetInfo.addEventListener(state => {
  if (state.isConnected && state.isInternetReachable) {
    flushCheckinQueue()
    flushCorrectionQueue()
    queryClient.refetchQueries({ type: 'active' })
  }
})
```

### Offline indicators
- Subtle banner: "You're offline · Showing last known data"
- Never block the UI
- Green "Back online" flash on reconnect
- Amber "Last updated X minutes ago" on stale data

### Firebase offline persistence
```typescript
// Initialized ONCE at app startup — before any database operations
firebase.database().setPersistenceEnabled(true)
// [FIX 5] Scope keepSynced to student's bus ONLY — not all 200 buses
// Do NOT call: firebase.database().ref('/buses').keepSynced(true)
// DO call after busId is known:
firebase.database().ref(`/buses/${busId}`).keepSynced(true)
```

---

## 7. Push Notification System

### Setup

```typescript
async function setupNotifications() {
  const { status } = await Notifications.requestPermissionsAsync()
  if (status !== 'granted') return

  const token = await Notifications.getExpoPushTokenAsync({
    projectId: process.env.EXPO_PUBLIC_PROJECT_ID
  })
  await api.patch('/v1/users/fcm-token', { fcmToken: token.data })

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
// app/_layout.tsx
useEffect(() => {
  // Background/killed → app opened from notification
  const sub1 = Notifications.addNotificationResponseReceivedListener(response => {
    const { screen, params } = response.notification.request.content.data
    if (screen) router.push({ pathname: screen, params })
  })

  // Foreground — notification received while app is open
  const sub2 = Notifications.addNotificationReceivedListener(notification => {
    const { type } = notification.request.content.data
    // Invalidate relevant queries
    if (type === 'SUBSTITUTE_ASSIGNED')  queryClient.invalidateQueries({ queryKey: ['student-home'] })
    if (type === 'CORRECTION_REVIEWED')  queryClient.invalidateQueries({ queryKey: ['attendance-history'] })
    if (type === 'TRIP_STARTED')         queryClient.invalidateQueries({ queryKey: ['student-home'] })
  })

  return () => { sub1.remove(); sub2.remove() }
}, [])
```

### Notification → deep link map

```
TYPE                    TITLE                                DEEP LINK
─────────────────────────────────────────────────────────────────────
BUS_APPROACHING         "Bus {N} is 5 minutes away"          /(student)/map
SUBSTITUTE_ASSIGNED     "Your bus has changed to Bus {N}"    /(student)/
ARRIVAL_VERIFY          "Confirm your arrival"               /(student)/verify-arrival?tripId=X
CHECKIN_CONFIRMED       "Check-in confirmed"                 /(student)/
CORRECTION_REVIEWED     "Correction approved/rejected"       /(student)/history
BREAKDOWN_ON_YOUR_BUS   "Bus {N} breakdown"                  /(student)/
TRIP_CANCELLED          "Today's trip cancelled"             /(student)/
─────────────────────────────────────────────────────────────────────
ADMIN_MESSAGE (driver)  "New message from coordinator"       /(driver)/messages
WAIT_REQUEST (driver)   "{Name} is 2 min away"               /(driver)/kiosk
LATE_START (driver)     "Trip is late — please start"        /(driver)/
```

### Tamil notification copy

Backend sends correct language based on `user.preferredLanguage`.

```typescript
const templates = {
  BUS_APPROACHING: {
    en: { title: 'Bus {N} is 5 minutes away', body: 'Head to {stop} now' },
    ta: { title: 'பேருந்து {N} 5 நிமிடத்தில்', body: 'இப்போதே {stop}க்கு செல்லுங்கள்' },
  },
  SUBSTITUTE_ASSIGNED: {
    en: { title: 'Your bus has changed', body: 'Bus {N} is your bus today (was Bus {M})' },
    ta: { title: 'உங்கள் பேருந்து மாற்றப்பட்டது', body: 'பேருந்து {N} இன்று உங்கள் பேருந்து' },
  },
  ARRIVAL_VERIFY: {
    en: { title: 'Confirm your arrival', body: 'Tap to verify you\'ve reached college' },
    ta: { title: 'வருகையை உறுதிப்படுத்துங்கள்', body: 'கல்லூரி வந்ததை உறுதிப்படுத்த தட்டவும்' },
  },
}
```

---

## 8. Substitute Bus Flow

### Three cases — one smooth experience

**Case 1 — Pre-assigned before student opens app:**
```
Admin assigns Bus 7 as substitute for Bus 12
Student opens app → /student/home returns busId: "bus-7-id", isSubstitute: true
Home shows: "Bus 7 (substitute for Bus 12)"
Student scans Bus 7's QR → normal check-in, zero friction
```

**Case 2 — Pre-assigned, student already checked in:**
```
Student checked in on Bus 12
Admin assigns substitute Bus 7
Backend: transfers AttendanceLog to Bus 7 automatically
Student gets notification: "Your attendance transferred to Bus 7"
Student sees: "✓ Checked in · Bus 7 (transferred from Bus 12)"
No re-scan. No action needed.
```

**Case 3 — On-the-fly (breakdown mid-route):**
```
Admin marks incident → assigns Bus 7 as substitute
Backend:
  Students not yet checked in → temp route to Bus 7 for today
  Students already checked in → attendance transferred automatically
  Push to all affected: "Your bus has changed to Bus 7"
Mobile:
  Foreground: home:refresh socket event → query invalidates → UI updates
  Background: FCM notification → app updates on next open
  Firebase: subscription switches to Bus 7 automatically
```

### Firebase subscription auto-switch

```typescript
// hooks/useLiveBus.ts
const prevBusIdRef = useRef<string | null>(null)
const listenerRef = useRef<(() => void) | null>(null)

useEffect(() => {
  const busId = homeData?.trip?.busId
  if (!busId || busId === prevBusIdRef.current) return

  // Clean up previous listener
  listenerRef.current?.()

  // [FIX 5] keepSynced scoped to THIS bus only
  firebase.database().ref(`/buses/${busId}`).keepSynced(true)

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
Student exists in real life but was missed during bulk import.
Not in the system but wants to check in.

### Solution

**`(auth)/pending.tsx` — check-in anyway flow:**
```typescript
// Student taps "I know my bus — check in anyway"
// Scanner opens with isUnassigned: true

// POST /v1/attendance/checkin { isUnassigned: true }
// Backend:
//   1. Creates temporary RouteAssignment (isOverride: true, needs admin review)
//   2. Marks attendance PRESENT
//   3. Admin notification: "Unassigned student checked in: [name]"
//   4. Counter in admin dashboard: "X students need assignment"
```

### Admin bulk view

```
Unassigned students                           [Bulk assign]
──────────────────────────────────────────────────────────
32 students checked in without route assignment

Name        Roll No   Bus     Date      Action
Karthik R   21CS044   Bus 12  18 Mar    [Assign]
Meera T     21CS043   Bus 7   18 Mar    [Assign]

[Select all] [Bulk assign to route] [Export CSV]
```

**Bulk assign → students get FCM → app refreshes → full access restored.**

---

## 10. Offline Queue

### [FIX 4] Check-in replay → auto-create correction

```typescript
// lib/checkin-queue.ts
export const flushCheckinQueue = async () => {
  const queue = await getQueue()
  const remaining: QueuedCheckin[] = []

  for (const item of queue) {
    if (Date.now() - item.queuedAt > MAX_AGE_MS) {
      showExpiredToast(item)
      continue
    }

    try {
      await api.post('/v1/attendance/checkin', { ...item, isReplay: true })
      showSuccessToast('Check-in confirmed')
      queryClient.invalidateQueries({ queryKey: ['student-home'] })
    } catch (error: any) {
      if (error.response?.status === 410) {
        // [FIX 4] Backend auto-creates correction request
        // Student gets notification: "We submitted a correction request for you"
        // No manual action needed from student — just show informational toast
        showInfoToast('Trip ended — we\'ve submitted a correction request for you')
      } else if (error.response?.status === 409) {
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

### Backend — 410 auto-correction (new behaviour)

```typescript
// attendance.service.ts — replay validation
if (isReplay && trip.status === 'COMPLETED') {
  // Auto-create correction request with queue data as evidence
  await prisma.attendanceCorrection.create({
    data: {
      attendanceId: attendanceLog.id,
      requestedById: userId,
      reason: `Automatic: check-in scanned at ${new Date(clientTimestamp).toLocaleTimeString('en-IN')} but arrived after trip ended`,
      status: 'PENDING',
      metadata: { clientTimestamp, distanceAtScan: distanceToStop, isAutoCreated: true }
    }
  })

  // Notify student
  await sendPushNotification(userId, {
    type: 'CORRECTION_AUTO_CREATED',
    title: 'Correction request submitted',
    body: 'We submitted a correction request on your behalf. Coordinator will review.',
  })

  return { status: 410, message: 'TRIP_ALREADY_ENDED', correctionCreated: true }
}
```

---

## 11. Background GPS Task

```typescript
// tasks/gps.task.ts
TaskManager.defineTask(GPS_TASK_NAME, async ({ data, error }) => {
  if (error) return
  const { locations } = data as { locations: Location.LocationObject[] }
  const location = locations[0]
  const { tripId, busId } = await getGPSContext()

  // Delta compression — skip if moved < 5m
  const lastPos = await getLastPosition()
  if (lastPos) {
    const distance = getDistanceMetres(
      lastPos.lat, lastPos.lon,
      location.coords.latitude, location.coords.longitude
    )
    if (distance < 5) return
  }

  const speedKmh = (location.coords.speed ?? 0) * 3.6

  // [CHANNEL LAW] Firebase RTDB — live position only
  await firebase.database().ref(`/buses/${busId}`).update({
    lat: location.coords.latitude,
    lon: location.coords.longitude,
    speed: speedKmh,
    heading: location.coords.heading ?? 0,
    accuracy: location.coords.accuracy,
    gpsStatus: 'LIVE',
    lastUpdated: Date.now(),
  })

  // Backend — GPS log + heartbeat
  await api.post('/v1/gps/ping', {
    busId, tripId,
    lat: location.coords.latitude,
    lon: location.coords.longitude,
    speed: speedKmh,
    heading: location.coords.heading ?? 0,
    accuracy: location.coords.accuracy,
    timestamp: location.timestamp,
  }).catch(() => {})  // silent fail — Firebase write is critical, backend is secondary

  // [FIX 3] Update heartbeat for kiosk GPS indicator
  await AsyncStorage.setItem(`gps:heartbeat:${busId}`, String(Date.now()))
  await setLastPosition({ lat: location.coords.latitude, lon: location.coords.longitude })
})

export const startGPSTask = async (tripId: string, busId: string) => {
  await AsyncStorage.setItem('gps-context', JSON.stringify({ tripId, busId }))
  await Location.startLocationUpdatesAsync(GPS_TASK_NAME, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 3000,
    distanceInterval: 5,
    foregroundService: {
      notificationTitle: 'Bus 12 — Trip Active',
      notificationBody: 'GPS tracking is running',
      notificationColor: '#1E3A8A',
    },
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.AutomotiveNavigation,
    showsBackgroundLocationIndicator: true,
  })
}
```

**AppState restart guard — driver side:**
```typescript
// In (driver)/kiosk.tsx
AppState.addEventListener('change', async (state) => {
  if (state === 'active') {
    const isRunning = await Location.hasStartedLocationUpdatesAsync(GPS_TASK_NAME)
    if (!isRunning) {
      await startGPSTask(tripId, busId)
      setGPSStatus('LIVE')
    }
  }
})
```

---

## 12. Socket.io Connection

### [FIX 6] Connection config with jitter + max attempts

```typescript
// lib/socket.ts
let socket: Socket | null = null

export const getSocket = () => {
  if (!socket) {
    socket = io(process.env.EXPO_PUBLIC_API_URL!, {
      auth: { token: useAuthStore.getState().token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 50,          // [FIX 6] Not Infinity — after 50, show error
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30_000,      // [FIX 6] Max 30s between attempts
      randomizationFactor: 0.5,          // [FIX 6] Jitter — prevents reconnection storm
      timeout: 10_000,
    })

    // After 50 failed attempts, show user a message
    socket.on('reconnect_failed', () => {
      showOfflineMessage("Can't connect to server. Check your internet connection.")
    })
  }
  return socket
}
```

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
    socket.on('connect', () => setSocketStatus('connected'))
    socket.on('disconnect', () => setSocketStatus('disconnected'))
    socket.on('reconnecting', (attempt) => {
      setSocketStatus('reconnecting')
      setReconnectAttempt(attempt)
    })

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

```typescript
// lib/firebase.ts
import firebase from '@react-native-firebase/app'
import database from '@react-native-firebase/database'

// Enable offline persistence — MUST be called before ANY database operations
database().setPersistenceEnabled(true)

// [FIX 5] DO NOT call: database().ref('/buses').keepSynced(true)
// Scoped keepSynced is called in useLiveBus hook after busId is known
```

### Live bus hook

```typescript
// hooks/useLiveBus.ts
export const useLiveBus = (busId: string | null) => {
  const [busLocation, setBusLocation] = useState<BusLocation | null>(null)
  const prevBusIdRef = useRef<string | null>(null)
  const listenerRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!busId || busId === prevBusIdRef.current) return

    listenerRef.current?.()  // clean up previous

    // [FIX 5] Scope keepSynced to THIS bus only
    database().ref(`/buses/${busId}`).keepSynced(true)

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

### Dashboard alert cards

```
┌─ Needs immediate attention ──────────────────────────────────┐
│  [!] 3 buses have not started their trips (12 min late)      │
│      Bus 4, Bus 7, Bus 12  [View all] [Alert drivers]        │
│                                                               │
│  [!] Bus 8 reported breakdown (Flat tyre · 8:32 AM)          │
│      Tambaram Route · 42 students affected  [View incident]  │
│                                                               │
│  [~] 32 students need route assignment                        │
│      Checked in without assignment today   [Bulk assign]      │
│                                                               │
│  [~] 14 correction requests pending review                    │
│      Oldest: 2 days ago                    [Review all]       │
└───────────────────────────────────────────────────────────────┘
```

### Unassigned students — bulk assign

```
GET  /v1/admin/unassigned-students
POST /v1/admin/bulk-assign-route { userIds: string[], routeId: string }

After bulk assign:
  → FCM to each student: "You've been assigned to [Route]"
  → home:refresh socket event to connected students
  → Students transition from pending.tsx to full student home
```

### Substitute management

```
POST /v1/admin/trips/:id/assign-substitute { substituteDriverId, substituteBusId }
→ Transfers existing check-ins
→ Updates all affected students' home response
→ FCM push to affected students
→ home:refresh socket event to connected students
→ Firebase subscription context updates automatically on mobile
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
│   │   ├── StatCards.tsx
│   │   ├── AttendanceRow.tsx
│   │   ├── CorrectionNudge.tsx
│   │   └── WaitForMeSheet.tsx
│   └── driver/
│       ├── QRDisplay.tsx           ← QR + countdown ring
│       ├── CheckInToast.tsx        ← 4s auto-dismiss
│       ├── WaitRequestBanner.tsx
│       ├── ManualMarkSheet.tsx     ← bottom sheet (no nav)
│       ├── AdminMessageBar.tsx
│       └── GPSStatusIndicator.tsx  ← [FIX 3] green/red dot
│
├── hooks/
│   ├── useAuth.ts
│   ├── useLiveBus.ts               ← Firebase RTDB + auto-switch
│   ├── useStudentHome.ts           ← TanStack Query + socket invalidation
│   ├── useAttendanceHistory.ts     ← infinite scroll
│   ├── useCheckin.ts               ← submit + queue + offline
│   ├── useKioskSocket.ts           ← Socket.io for kiosk
│   ├── useOfflineQueue.ts          ← flush on reconnect
│   └── useNetworkStatus.ts         ← NetInfo wrapper
│
├── store/
│   ├── auth.store.ts               ← Zustand + AsyncStorage persist
│   └── trip.store.ts               ← driver trip state
│
├── lib/
│   ├── api.client.ts               ← Axios + interceptors
│   ├── socket.ts                   ← Socket.io singleton (with jitter)
│   ├── firebase.ts                 ← Firebase init + persistence
│   ├── notifications.ts            ← FCM setup + deep links
│   ├── checkin-queue.ts            ← offline check-in queue
│   └── query-client.ts             ← TanStack Query config
│
├── tasks/
│   └── gps.task.ts                 ← Expo background location
│
├── i18n/
│   ├── index.ts
│   ├── en.ts
│   └── ta.ts
│
├── constants/
│   └── index.ts                    ← import from packages/shared
│
└── types/
    └── index.ts                    ← import from packages/shared
```

---

## 16. Build Rules for Claude Code

### Navigation rules
1. Never use `router.push` for role-switching — only root `_layout.tsx` routes between groups
2. Tab bar hidden on: scanner, checkin-success, checkin-fail, verify-arrival, kiosk
3. All deep links registered in FCM handler in root `_layout.tsx`
4. Navigator MUST NOT render until `isLoaded = true` — SplashScreen is the hard gate

### Realtime channel rules (NEVER violate)
5. Firebase RTDB carries ONLY: lat, lon, speed, heading, gpsStatus, lastUpdated
6. Socket.io carries ONLY: events (qr:refresh, checkin:success, home:refresh, etc.)
7. GPS position is NEVER emitted via Socket.io
8. Event data is NEVER stored in Firebase RTDB
9. keepSynced is called on `/buses/{busId}` (single bus) — NEVER on `/buses` root

### API rules
10. Never call API directly in a component — always through a hook
11. Every query uses `networkMode: 'offlineFirst'`
12. No global `refetchInterval` — use socket-driven `home:refresh` invalidation
13. Every mutation touching attendance has an offline fallback queue
14. Never show raw error codes — always map to human language

### State rules
15. User session only in Zustand auth store — never in component state
16. All server state in TanStack Query — never duplicated in Zustand
17. AsyncStorage only for: auth persistence, offline queue, cache, preferences

### GPS + Firebase rules
18. Firebase persistence enabled before any database operation
19. GPS task writes to Firebase RTDB first — backend GPS ping is secondary
20. Firebase subscription cleans up on unmount — no memory leaks
21. Subscription auto-switches when busId changes (substitute bus)
22. GPS heartbeat written to AsyncStorage on every ping for kiosk indicator

### Socket rules
23. `reconnectionAttempts: 50` — not Infinity
24. `randomizationFactor: 0.5` — always include jitter
25. Show "can't connect" message after max reconnection attempts

### Offline + queue rules
26. Check-in queue flushes automatically on network reconnect — never manual
27. 410 replay response → backend auto-creates correction — client shows info toast only
28. Breakdown reports queued with high priority — sync immediately on reconnect

### Notifications rules
29. FCM token refreshed and sent to backend on every app launch
30. All notification handlers set up in root `_layout.tsx` only
31. Tamil notifications sent by backend based on `user.preferredLanguage`

---

*Mobile App Structure & System Architecture v2 — College Bus Management System*  
*7 architecture fixes applied. March 2026.*  
*Status: Architecture target and build guidance; verify implementation maturity against `docs/SYSTEM_FULL_ANALYSIS.md` and `mobile_architecture_analysis.md.resolved`.*
