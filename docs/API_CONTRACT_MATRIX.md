# API Contract Matrix

Contract discipline note:

- This file is an endpoint inventory, not a standalone readiness verdict.
- Route existence does not imply production-complete client behavior.
- If mobile/client behavior differs from this matrix, treat it as contract drift and update this file in the same PR as code changes.

## Mobile Auth

| Client | Method | Path | Backend Source | Notes |
|---|---|---|---|---|
| Mobile | `POST` | `/v1/auth/login` | `apps/backend/src/modules/auth/auth.routes.ts` | Accepts Firebase token, dev mock tokens outside production. |
| Mobile | `POST` | `/v1/auth/refresh` | `apps/backend/src/modules/auth/auth.routes.ts` | Reissues mobile JWT. |
| Mobile | `POST` | `/v1/auth/logout` | `apps/backend/src/modules/auth/auth.routes.ts` | Clears mobile session state. |
| Mobile | `POST` | `/v1/auth/logout-all` | `apps/backend/src/modules/auth/auth.routes.ts` | Revokes all mobile sessions. |
| Mobile | `GET` | `/v1/auth/me` | `apps/backend/src/modules/auth/auth.routes.ts` | Returns current user profile. |

## Student Home

| Client | Method | Path | Backend Source | Notes |
|---|---|---|---|---|
| Mobile | `GET` | `/v1/student/home` | `apps/backend/src/modules/student/student-home.service.ts` | BFF for student home + map. Response includes `screenState` (discriminated by `status`), `transport.trip`, `transport.routeGeometry` (ordered stops + polyline with `passed` and `isMyStop` flags), and `transport.attendance`. When `screenState.status === 'trip_active'`, the variant carries `busEta` (minutes) and `distanceRemainingM` (meters), both server-computed and refreshed via Firebase RTDB liveState on each ping. |

### Firebase RTDB live state (`/buses/{busId}`)

Written by `apps/backend/src/modules/gps/gps.service.ts#processPing` on every accepted GPS ping. Schema validated client-side in `apps/mobile/hooks/useLiveBus.ts`:

```
{
  lat, lon, speed, heading, accuracy,
  gpsStatus: 'LIVE' | 'STALE' | 'OFFLINE' | 'UNKNOWN',
  lastUpdated: number,           // epoch ms
  source: 'DRIVER' | 'DELEGATE',
  delegateActive: boolean,
  etaMin: number | null,         // computed against student's assigned stop
  distanceRemainingM: number | null
}
```

ETA is computed inline on each ping (Haversine sum over remaining stops); no Cloud Task needed. Route-stop list cached in Redis `trip:{tripId}:stops` (TTL 5 min). Route geometry cached at `trip:{tripId}:geometry` (TTL 30s) and consumed by `/v1/student/home`.

## Student Attendance

| Client | Method | Path | Backend Source | Notes |
|---|---|---|---|---|
| Mobile | `POST` | `/v1/attendance/checkin` | `apps/backend/src/modules/attendance/attendance.routes.ts` | Canonical QR check-in endpoint. |
| Mobile | `POST` | `/v1/attendance/verify-arrival` | `apps/backend/src/modules/attendance/attendance.routes.ts` | Arrival verification after gate reach. |
| Mobile | `POST` | `/v1/attendance/skip-today` | `apps/backend/src/modules/attendance/attendance.routes.ts` | Student self-skip. |
| Mobile | `POST` | `/v1/attendance/wait-for-me` | `apps/backend/src/modules/attendance/attendance.routes.ts` | Emits `wait:request` to trip room. |
| Mobile | `POST` | `/v1/attendance/correction-request` | `apps/backend/src/modules/attendance/attendance.routes.ts` | **DEPRECATED** — returns 410. Use `POST /v1/attendance/corrections`. |
| Mobile | `POST` | `/v1/attendance/corrections` | `apps/backend/src/modules/attendance/attendance.routes.ts` | Creates attendance correction request. |
| Mobile/Admin | `GET` | `/v1/attendance/corrections` | `apps/backend/src/modules/attendance/attendance.routes.ts` | Coordinator/admin review queue (mobile: own corrections only). |
| Mobile/Admin | `PATCH` | `/v1/admin/corrections/:id` | `apps/backend/src/modules/admin/admin.routes.ts` | Resolve correction (canonical). |
| Mobile/Admin | `POST` | `/v1/admin/corrections/:correctionId/review` | `apps/backend/src/modules/attendance/attendance.routes.ts` | **DEPRECATED** — returns 410. Use `PATCH /v1/admin/corrections/:id`. |
| Mobile | `POST` | `/v1/attendance/self-report` | `apps/backend/src/modules/attendance/attendance.routes.ts` | GPS outage self-report. |

## Driver Flow

| Client | Method | Path | Backend Source | Notes |
|---|---|---|---|---|
| Mobile Driver | `GET` | `/v1/driver/today-assignment` | `apps/backend/src/modules/driver/driver.routes.ts` | Compatibility route for current app. |
| Mobile Driver | `POST` | `/v1/driver/start-trip` | `apps/backend/src/modules/driver/driver.routes.ts` | **DEPRECATED** — returns 410. Use `PATCH /v1/trips/:tripId/start`. |
| Mobile Driver | `GET` | `/v1/driver/route-stops` | `apps/backend/src/modules/driver/driver.routes.ts` | Returns current route stop list. |
| Mobile Driver | `GET` | `/v1/driver/trip-summary/:tripId` | `apps/backend/src/modules/driver/driver.routes.ts` | Returns boarded, absent, and trip timing summary. |
| Mobile Driver | `POST` | `/v1/driver/end-trip/:tripId` | `apps/backend/src/modules/driver/driver.routes.ts` | **DEPRECATED** — returns 410. Use `POST /v1/trips/:tripId/end`. |
| Mobile | `POST` | `/v1/gps/ping` | `apps/backend/src/modules/gps/gps.routes.ts` | Driver and delegate GPS updates. |

## User / Device

| Client | Method | Path | Backend Source | Notes |
|---|---|---|---|---|
| Mobile | `PATCH` | `/v1/users/fcm-token` | `apps/backend/src/modules/users/users.routes.ts` | Stores Expo/FCM push token for current mobile user. |
| Admin | `GET` | `/v1/users` | `apps/backend/src/modules/users/users.routes.ts` | Student/user listing with admin scopes. |
| Admin | `POST` | `/v1/users/:studentId/assign` | `apps/backend/src/modules/users/users.routes.ts` | Route/stop assignment. |
| Admin | `POST` | `/v1/users/import` | `apps/backend/src/modules/users/users.routes.ts` | Bulk import students. |

## Admin Auth

| Client | Method | Path | Backend Source | Notes |
|---|---|---|---|---|
| Admin | `POST` | `/v1/admin/auth/login` | `apps/backend/src/modules/auth/admin-auth.routes.ts` | Sets `admin_jwt` httpOnly cookie. |
| Admin | `GET` | `/v1/admin/auth/me` | `apps/backend/src/modules/auth/admin-auth.routes.ts` | Session bootstrap endpoint for admin SPA. |
| Admin | `POST` | `/v1/admin/auth/logout` | `apps/backend/src/modules/auth/admin-auth.routes.ts` | Clears admin cookie. Returns 204. |
| Admin | `POST` | `/v1/admin/auth/forgot-password` | `apps/backend/src/modules/auth/admin-auth.routes.ts` | Password reset request. |
| Admin | `POST` | `/v1/admin/auth/reset-password` | `apps/backend/src/modules/auth/admin-auth.routes.ts` | Completes reset. |
| Admin | `POST` | `/v1/admin/auth/invite` | `apps/backend/src/modules/auth/admin-auth.routes.ts` | Admin invite flow. |
| Admin | `POST` | `/v1/admin/auth/set-password` | `apps/backend/src/modules/auth/admin-auth.routes.ts` | Invite acceptance. |

## Admin Ops / Data

| Client | Method | Path | Backend Source | Notes |
|---|---|---|---|---|
| Admin | `GET` | `/v1/admin/live/dashboard` | `apps/backend/src/modules/admin/admin.routes.ts` | Live dashboard stats. |
| Admin | `GET` | `/v1/admin/stats` | `apps/backend/src/modules/admin/admin.routes.ts` | **DEPRECATED** — returns 410. Use `GET /v1/admin/live/dashboard`. |
| Admin | `GET` | `/v1/admin/live/trips/active` | `apps/backend/src/modules/admin/admin.routes.ts` | Active trip list. Supports `?page=1&limit=20`. |
| Admin | `GET` | `/v1/admin/active-trips` | `apps/backend/src/modules/admin/admin.routes.ts` | **DEPRECATED** — returns 410. Use `GET /v1/admin/live/trips/active`. |
| Admin | `GET` | `/v1/admin/live/trips/:id` | `apps/backend/src/modules/admin/admin.routes.ts` | Active trip state. |
| Admin | `GET` | `/v1/admin/live/alerts` | `apps/backend/src/modules/admin/admin.routes.ts` | Alert rail. Redis top-50, no pagination. |
| Admin | `GET` | `/v1/admin/corrections` | `apps/backend/src/modules/admin/admin.routes.ts` | Pending corrections. Supports `?page=1&limit=25`. |
| Admin | `PATCH` | `/v1/admin/corrections/:id` | `apps/backend/src/modules/admin/admin.routes.ts` | Resolve correction (canonical). |
| Admin | `GET` | `/v1/admin/incidents` | `apps/backend/src/modules/admin/admin.routes.ts` | Incident list. Supports `?status=REPORTED&page=1&limit=25`. |
| Admin | `GET` | `/v1/admin/messages` | `apps/backend/src/modules/admin/admin.routes.ts` | Admin messages. Capped at `?limit=50`, no total count. |
| Admin | `POST` | `/v1/admin/messages` | `apps/backend/src/modules/admin/admin.routes.ts` | Persists and emits driver/admin message. |
| Admin | `POST` | `/v1/admin/reports/attendance` | `apps/backend/src/modules/admin/admin.routes.ts` | Attendance report job. |
| Admin | `GET` | `/v1/admin/reports/:jobId/status` | `apps/backend/src/modules/admin/admin.routes.ts` | Report job status. |
| Admin | `GET` | `/v1/admin/ops/gps-outages` | `apps/backend/src/modules/admin/admin.routes.ts` | Active GPS outages. No pagination (bounded). |
| Admin | `GET` | `/v1/admin/ops/gps-outage-corrections` | `apps/backend/src/modules/admin/admin.routes.ts` | GPS outage corrections. Supports `?page=1&limit=25`. |
| Admin | `GET` | `/v1/admin/ops/import-sessions` | `apps/backend/src/modules/admin/admin.routes.ts` | Import sessions. Hardcoded top-50, no pagination. |
| Admin | `GET` | `/v1/admin/ops/pending-auth` | `apps/backend/src/modules/admin/admin.routes.ts` | Pending provisioning users. Hardcoded top-100, no pagination. |