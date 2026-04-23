# E2E Critical Paths

Run the current backend smoke harness with:

`pnpm --filter backend e2e:smoke`

## P0 Flows

### 1. Admin Login and Session Bootstrap

- `POST /v1/admin/auth/login`
- `GET /v1/admin/auth/me`
- admin websocket connects with cookie auth
- logout clears session and disconnects socket

Pass condition:
- user lands in `/ops/dashboard`
- refresh keeps session
- logout returns to `/login`

### 2. Driver Starts Trip

- driver logs in
- `GET /v1/driver/today-assignment`
- `POST /v1/driver/start-trip`
- socket joins `trip:{tripId}`
- driver receives `qr:refresh`

Pass condition:
- trip becomes active
- admin dashboard reflects active trip
- QR rotates without reconnecting

### 3. Student Check-In

- student logs in
- student scans current QR
- `POST /v1/attendance/checkin`
- admin receives `checkin:success`
- trip detail and dashboard counts update

Pass condition:
- attendance log is written once
- duplicate scan is rejected cleanly
- trip boarded count increments once

### 4. Wait For Me

- student calls `POST /v1/attendance/wait-for-me`
- trip room receives `wait:request`

Pass condition:
- driver sees the request on the active trip
- repeated request updates instead of duplicating rows

### 5. Trip End and Absent Finalization

- driver calls `POST /v1/driver/end-trip/:tripId`
- Cloud Task is enqueued
- trip leaves active state

Pass condition:
- dashboard active trip count decrements
- absent-marking job path executes once
- outage self-report path opens only when GPS outage exists

## P1 Flows

### 6. Admin Correction Review

- student creates correction request
- admin loads corrections queue
- admin approves or rejects

Pass condition:
- attendance status changes correctly
- audit attribution uses the reviewer id

### 7. Admin Messaging

- admin sends message to trip or bus
- backend persists message
- correct room receives `admin:message`

Pass condition:
- target driver receives exactly one message
- admin message thread reload matches emitted event

### 8. FCM Token Registration

- mobile app updates token via `PATCH /v1/users/fcm-token`

Pass condition:
- latest token persists for the current mobile user
- push job reads the right token source

## Failure Drills

- expired admin cookie during websocket reconnect
- Redis unavailable during check-in
- Cloud Tasks auth failure
- Firebase unavailable in non-production mock mode
- Prisma connection restart during readiness checks
