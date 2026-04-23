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

## Student Attendance

| Client | Method | Path | Backend Source | Notes |
|---|---|---|---|---|
| Mobile | `POST` | `/v1/attendance/checkin` | `apps/backend/src/modules/attendance/attendance.routes.ts` | Canonical QR check-in endpoint. |
| Mobile | `POST` | `/v1/attendance/verify-arrival` | `apps/backend/src/modules/attendance/attendance.routes.ts` | Arrival verification after gate reach. |
| Mobile | `POST` | `/v1/attendance/skip-today` | `apps/backend/src/modules/attendance/attendance.routes.ts` | Student self-skip. |
| Mobile | `POST` | `/v1/attendance/wait-for-me` | `apps/backend/src/modules/attendance/attendance.routes.ts` | Emits `wait:request` to trip room. |
| Mobile | `POST` | `/v1/attendance/correction-request` | `apps/backend/src/modules/attendance/attendance.routes.ts` | Creates attendance correction request. |
| Mobile/Admin | `GET` | `/v1/attendance/corrections` | `apps/backend/src/modules/attendance/attendance.routes.ts` | Coordinator/admin review queue. |
| Mobile/Admin | `POST` | `/v1/attendance/corrections/:correctionId/review` | `apps/backend/src/modules/attendance/attendance.routes.ts` | Reviews correction request. |
| Mobile | `POST` | `/v1/attendance/self-report` | `apps/backend/src/modules/attendance/attendance.routes.ts` | GPS outage self-report. |

## Driver Flow

| Client | Method | Path | Backend Source | Notes |
|---|---|---|---|---|
| Mobile Driver | `GET` | `/v1/driver/today-assignment` | `apps/backend/src/modules/driver/driver.routes.ts` | Compatibility route for current app. |
| Mobile Driver | `POST` | `/v1/driver/start-trip` | `apps/backend/src/modules/driver/driver.routes.ts` | Starts trip and returns initial QR. |
| Mobile Driver | `GET` | `/v1/driver/route-stops` | `apps/backend/src/modules/driver/driver.routes.ts` | Returns current route stop list. |
| Mobile Driver | `GET` | `/v1/driver/trip-summary/:tripId` | `apps/backend/src/modules/driver/driver.routes.ts` | Returns boarded, absent, and trip timing summary. |
| Mobile Driver | `POST` | `/v1/driver/end-trip/:tripId` | `apps/backend/src/modules/driver/driver.routes.ts` | Ends trip. |
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
| Admin | `POST` | `/v1/admin/auth/logout` | `apps/backend/src/modules/auth/admin-auth.routes.ts` | Clears admin cookie. |
| Admin | `POST` | `/v1/admin/auth/forgot-password` | `apps/backend/src/modules/auth/admin-auth.routes.ts` | Password reset request. |
| Admin | `POST` | `/v1/admin/auth/reset-password` | `apps/backend/src/modules/auth/admin-auth.routes.ts` | Completes reset. |
| Admin | `POST` | `/v1/admin/auth/invite` | `apps/backend/src/modules/auth/admin-auth.routes.ts` | Admin invite flow. |
| Admin | `POST` | `/v1/admin/auth/set-password` | `apps/backend/src/modules/auth/admin-auth.routes.ts` | Invite acceptance. |

## Admin Ops / Data

| Client | Method | Path | Backend Source | Notes |
|---|---|---|---|---|
| Admin | `GET` | `/v1/admin/live/dashboard` | `apps/backend/src/modules/admin/admin.routes.ts` | Live dashboard stats. |
| Admin | `GET` | `/v1/admin/live/trips/active` | `apps/backend/src/modules/admin/admin.routes.ts` | Active trip list. |
| Admin | `GET` | `/v1/admin/live/trips/:id` | `apps/backend/src/modules/admin/admin.routes.ts` | Active trip state. |
| Admin | `GET` | `/v1/admin/live/alerts` | `apps/backend/src/modules/admin/admin.routes.ts` | Alert rail. |
| Admin | `GET` | `/v1/admin/corrections` | `apps/backend/src/modules/admin/admin.routes.ts` | Pending corrections. |
| Admin | `POST` | `/v1/admin/corrections/:id/resolve` | `apps/backend/src/modules/admin/admin.routes.ts` | Review correction. |
| Admin | `GET` | `/v1/admin/incidents` | `apps/backend/src/modules/admin/admin.routes.ts` | Incident list. |
| Admin | `GET` | `/v1/admin/messages` | `apps/backend/src/modules/admin/admin.routes.ts` | Admin messages. |
| Admin | `POST` | `/v1/admin/messages` | `apps/backend/src/modules/admin/admin.routes.ts` | Persists and emits driver/admin message. |
| Admin | `POST` | `/v1/admin/reports/attendance` | `apps/backend/src/modules/admin/admin.routes.ts` | Attendance report job. |
| Admin | `GET` | `/v1/admin/reports/:jobId/status` | `apps/backend/src/modules/admin/admin.routes.ts` | Report job status. |
