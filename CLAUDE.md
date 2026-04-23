# CLAUDE.md — College Bus Management System

> **Audience.** This file is the standing instruction set for Claude Code and any other AI coding agent working in this repo. It is **policy + codebase explanation**, not status. For what's done vs outstanding, see [`docs/PRODUCTION_READINESS_STATUS.md`](docs/PRODUCTION_READINESS_STATUS.md) and [`docs/PLANNED_NOT_IMPLEMENTED.md`](docs/PLANNED_NOT_IMPLEMENTED.md). For architecture diagrams and data flows, see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
>
> If anything in this file contradicts the code, the code wins — update the file in the same PR.

---

## 1. Mission

Production-grade college bus management system serving **180+ buses and thousands of students**. Core capabilities:

- QR-based attendance with geofenced check-in
- Live GPS tracking with outage handling and self-report recovery
- Role-aware mobile experience for students and drivers
- Admin command center: live ops, corrections queue, incidents, messaging, reports
- Cloud Tasks-driven async jobs (trip finalization, notifications, escalation)

**North star.** The bus system is **phase 1** of a broader **university utility platform**. Over time the mobile app grows new route groups (e.g. `(utility)`), a separate `apps/uni-admin/` is added for university staff, and new backend modules (announcements, notices, OD requests) land alongside existing ones. See [§15 — Extending safely](#15-extending-safely).

---

## 2. Monorepo layout

```
college-bus-system/
├── apps/
│   ├── backend/          Fastify API + Socket.IO + jobs + Prisma
│   ├── admin/            React + Vite + React Router + TanStack Query (admin SPA)
│   └── mobile/           Expo + React Native + Expo Router + Zustand
├── packages/
│   └── shared/           Types, Zod schemas, constants, validators, policy, utils
├── infra/
│   ├── docker/           docker-compose.yml (Postgres + Redis for local dev)
│   ├── cloudbuild/       GCP Cloud Build pipelines
│   └── gcp/              GCP-specific infra
├── docs/                 Architecture, runbooks, audits, contracts
└── .github/workflows/    CI + deploy-staging + deploy-production
```

- **Package manager:** pnpm 10.32.1, workspaces defined in [`pnpm-workspace.yaml`](pnpm-workspace.yaml) (`apps/*`, `packages/*`), `nodeLinker: hoisted`.
- **Build orchestration:** Turborepo — see [`turbo.json`](turbo.json).
- **TypeScript everywhere.** 100%. Base config in [`tsconfig.base.json`](tsconfig.base.json).

---

## 3. Stack

| Layer | Choice | Why |
|---|---|---|
| Backend framework | Fastify 4 | Low overhead, strong plugin model, logger native |
| Backend language | TypeScript (strict) | Matches shared + apps |
| ORM | Prisma 5 | Typed, migration tooling, schema = `apps/backend/src/db/prisma/schema.prisma` |
| Database | PostgreSQL 15 (Cloud SQL in prod, Docker locally on port **5433**) | System of record |
| Cache / realtime coordinator | Redis 7 (Memorystore in prod, Docker locally on port **6380**) | Nonces, rate limits, sessions, socket adapter, cache |
| Live bus position | Firebase Realtime Database | Cheap broadcast-style reads for the mobile map |
| Background jobs | **GCP Cloud Tasks** | HTTP-delivered, survives Cloud Run scale-down (see §11 — no cron) |
| Sockets | socket.io 4 + `@socket.io/redis-adapter` | Horizontal scaling across Cloud Run instances |
| Auth (mobile) | JWT with issuer/audience + device binding | See §12 |
| Auth (admin) | httpOnly cookie JWT + CSRF + session version + fingerprint + MFA (TOTP) | See §12 |
| Push notifications | Firebase Admin (FCM) | `sendEachForMulticast` |
| SMS / OTP | MSG91 | Template-driven |
| Admin SPA | React 18 + Vite 5 + React Router v6 + TanStack Query v5 + Zustand | |
| Mobile | Expo (~51), React Native, Expo Router, Zustand, TanStack Query, socket.io-client | |
| Validation | Zod (env, inbound payloads, `packages/shared` schemas) | |

---

## 4. Architectural invariants — never break these

These are the rules that must hold across the entire codebase. If a change violates them, the change is wrong — rework it.

1. **`packages/shared` is the single source of truth for cross-app contracts.** Types, Zod schemas, domain constants (GPS, QR, GEOFENCE, TRIP), Haversine math, role policy, error codes. Never duplicate these in `apps/*`. If a type belongs to more than one app, it lives in `shared`.
2. **Backend enforces a 4-layer pattern per module.** `routes.ts` (HTTP parse/validate only) → `service.ts` (business logic) → `repository.ts` (Prisma only, maps Prisma errors to `AppError`). Never import `prisma` from a route. Never put business logic in a repository. The reference modules are [`modules/users/`](apps/backend/src/modules/users/), [`modules/routes/`](apps/backend/src/modules/routes/), [`modules/attendance/`](apps/backend/src/modules/attendance/).
3. **Attendance is event-sourced.** `AttendanceLog` is current state, `AttendanceEvent` is the immutable audit trail. **Never mutate** `AttendanceEvent` rows — append only. Corrections, excuses, trip-end marking all append new events.
4. **Idempotency is mandatory** for: check-ins, attendance corrections, notification dispatches, Cloud Tasks webhooks, admin write actions that emit sockets. Keys go through `redis` or the `idempotencyPlugin` in `apps/backend/src/plugins/idempotency.ts`. The pattern is cache the response under `idempotency:<kind>:<subject>:<key>` and replay it on repeat requests (see the first block of [`attendance.service.ts#checkIn`](apps/backend/src/modules/attendance/attendance.service.ts)).
5. **Background work runs on Cloud Tasks, never `node-cron`.** Cloud Run scales to zero and kills in-process intervals silently. Scheduled work is an HTTP-delivered Cloud Task with a webhook handler in [`modules/jobs/jobs.routes.ts`](apps/backend/src/modules/jobs/jobs.routes.ts). The single exception is `startDelegateMonitor` in [`server.ts`](apps/backend/src/server.ts) — a short-lived in-process interval that is acceptable because it is a best-effort watchdog and loses nothing on restart. Do not add more of these.
6. **QR check-in uses an atomic Redis `GETDEL` on the nonce.** The nonce is burned before any other validation. Exactly one of a concurrent pair of scans wins. Double-scan defense is not comment-deep — it is operation-deep. See [`attendance.service.ts` step [3]](apps/backend/src/modules/attendance/attendance.service.ts).
7. **Dates that matter are IST.** Use `getISODateIST` and the helpers in [`packages/shared/src/utils/time.utils.ts`](packages/shared/src/utils/time.utils.ts). **Never** `new Date().toISOString().split('T')[0]` in business logic — that's a bug, and historically has been.
8. **Contract docs are part of the change.** Any route change touches [`docs/API_CONTRACT_MATRIX.md`](docs/API_CONTRACT_MATRIX.md) in the same PR. Any socket event change touches [`docs/SOCKET_EVENT_REGISTRY.md`](docs/SOCKET_EVENT_REGISTRY.md) in the same PR. Reviewers reject undocumented contract changes.
9. **All routes live under `/v1`.** The prefix is how we'll introduce v2 without breaking mobile in the field. Mount every new route module with `app.register(xRoutes, { prefix: '/v1/x' })` in [`app.ts`](apps/backend/src/app.ts).
10. **The response envelope is `ok(data, requestId)` / `okList(...)` / `AppError`.** Helpers live in [`packages/shared/src/lib/response.ts`](packages/shared/src/lib/response.ts) and [`apps/backend/src/lib/errors.ts`](apps/backend/src/lib/errors.ts). Error handler is set in [`lib/error-handler.ts`](apps/backend/src/lib/error-handler.ts).
11. **New feature modules go next to existing ones.** Add `apps/backend/src/modules/<new>/` rather than editing unrelated modules. Register the routes in `app.ts`. This is how we grow into the university platform without fracturing the monolith.
12. **Modular monolith, not microservices.** Until there's a measured scaling reason, all modules deploy as one Fastify service. Do not split.

---

## 5. Backend — `apps/backend`

### 5.1 Lifecycle

- Entry: [`src/server.ts`](apps/backend/src/server.ts). Validates env via Zod at import time (fail-fast on invalid production config), initializes Redis dashboard stats hash atomically, calls `reconcileRedis()` on the leader, attaches the websocket server, starts the delegate heartbeat monitor, binds to `HOST:PORT`.
- Fastify app: [`src/app.ts`](apps/backend/src/app.ts). Registers CORS → cookie → request-context → idempotency plugins, mounts security headers, wires `/v1/live` and `/v1/ready` probes (both DB + Redis), mounts every `/v1/*` route module, then sets the error handler.
- Graceful shutdown on `SIGINT`/`SIGTERM` closes Fastify, sockets, notification worker, Prisma, Redis in parallel. Don't add work to shutdown that isn't idempotent.

### 5.2 Module catalog (`apps/backend/src/modules/`)

| Module | Surface | Layering | Notes |
|---|---|---|---|
| `auth` | `/v1/auth/*` mobile login, refresh, logout, me | routes + service + middleware, **no repo yet** | Firebase token verification; base `auth.service.ts` is thin, most logic is in `mobile-auth.service.ts`. `mobile-auth.repository.ts` exists. Reference for admin-auth instead. |
| `auth` (admin portion) | `/v1/admin/auth/*` | **Full 4-layer + middleware + types + multiple services** | Reference for complex auth: `admin-auth.service.ts`, `admin-auth.middleware.ts`, `admin-auth.repository.ts`, plus `admin-anomaly.service.ts`, `admin-fingerprint.service.ts`, and `scopeCoordinator.ts`. |
| `student` | `/v1/student/*` (BFF for mobile home, history, correction, self-report) | routes + service + repo | `student-home.service.ts` is the aggregation layer. |
| `driver` | `/v1/driver/*` (today-assignment, start-trip, end-trip, trip-summary, route-stops) | routes + service + repo + **serializers** | Serializers shape driver-visible responses. |
| `trips` | `/v1/trips/*` | routes + service + repo + `delegate.service.ts` | Delegate flow is Redis-heavy — coordinator takes over GPS pings when the driver phone fails. |
| `attendance` | `/v1/attendance/*` | **Full 4-layer.** Reference implementation. | The `checkIn` method is the canonical 13-step hardened flow. |
| `gps` | `/v1/gps/ping` | routes + service, **no repo** | Ingests ping → Postgres (buffered), Redis (live state), Firebase RTDB (map projection). |
| `incidents` | `/v1/incidents/*` | routes + service + repo | Cloud-Task-driven escalation at +10 min: COORDINATOR → TRANSPORT_OFFICER → PRINCIPAL. Idempotent. |
| `notifications` | *(service only, invoked from other modules)* | service, **no routes / no repo** | BullMQ + FCM multicast. Drops tracked in `notifications.service.ts` + `NotificationDrop` table. |
| `fleet` | `/v1/fleet/*` | routes + service + repo + serializers | Bus CRUD, bus assignments. |
| `routes` | `/v1/routes/*` | **Full 4-layer + types.** Reference for complex mutations. | Atomic route-stop-change with audit trail. |
| `users` | `/v1/users/*` | **Full 4-layer + serializers.** Reference for bulk import. | Student assign, FCM token patch, bulk student import (atomic transaction). |
| `admin` | `/v1/admin/*` live ops, dashboard, alerts, corrections list, messages, reports | routes + service + serializers + `reports.service.ts`, **no repo** | Biggest module by surface area. |
| `import` | `/v1/import/*` | routes + service + repo | Staff/student CSV ingestion. |
| `jobs` | `/v1/jobs/*` (Cloud Tasks webhook endpoints) | routes only | **Every job path is idempotent and verifies the `CLOUD_TASKS_SECRET`** before executing. Do not add a job without idempotency. |
| `qr` | *(no routes — used internally by sockets + attendance)* | service only | Signs per-trip JWTs, stores the nonce in Redis with TTL. |
| `rag` | `/v1/rag/*` | routes + service + repo + `index.ts` | Design-phase retrieval feature, not yet production-facing. |
| `students`, `drivers` | empty directories | — | Placeholders. Do not add files here; use `users`/`driver` unless a clean domain split emerges. |

### 5.3 Plugins (`apps/backend/src/plugins/`)

- [`idempotency.ts`](apps/backend/src/plugins/idempotency.ts) — reads the `Idempotency-Key` header, caches the canonical response for replay. Use it for every mutation that a flaky mobile network might retry.
- [`request-context.ts`](apps/backend/src/plugins/request-context.ts) — attaches `requestId`, user id, device id to the async local context so `logger` entries carry them automatically.

### 5.4 Shared lib (`apps/backend/src/lib/`)

Grouped by concern, so you don't have to read 40 files to orient:

- **Env and safety:** `env.ts` (Zod-validated, strict in production — rejects missing `FIREBASE_*`, short `JWT_SECRET`, etc.).
- **Observability:** `logger.ts` (pino), `correlation.ts`, `metrics.ts` (prom-client), `error-handler.ts`, `errors.ts` (AppError).
- **Data plane:** `prisma.ts`, `redis.ts`, `redis-client.ts`, `redis-circuit.ts` (circuit breaker — degraded-allow for rate limits), `redis-optimized.ts`, `redis-owned.ts`, `cache.ts`, `distributed-lock.ts`.
- **Auth:** `jwt.ts`, `auth-cache.ts`, `auth-config.ts`, `auth-audit.ts`, `auth-revocation.ts`, `auth-state-change.ts`, `password-policy.ts`.
- **Admin security:** `admin-mfa.ts`, `admin-session.ts`, `admin-security.ts`, `admin-rate-limiter.ts`, `admin-access.ts`, `admin-alerts.ts`, `admin-audit-logger.ts`, `admin-auth-utils.ts`.
- **External integrations:** `firebase.ts`, `msg91.ts`, `email.ts`, `cloud-tasks.ts`.
- **Rate limiting:** `rate-limit.ts`.
- **Async:** `queue.ts` (BullMQ wrappers), `load-balancer.ts`.
- **Audit:** `audit.service.ts`, `audit-sanitizer.ts`.

### 5.5 Websocket layer (`apps/backend/src/websocket/`)

- Canonical setup in [`socket.ts`](apps/backend/src/websocket/socket.ts). Uses `@socket.io/redis-adapter` so Cloud Run instances share rooms.
- Authentication differs by client:
  - **Mobile** — JWT via `socket.handshake.auth.token`, validated against `getAuthUserState(sub)` with session version and registered device id check.
  - **Admin** — `admin_jwt` cookie, validated against `getAuthAdminState(sub)`.
- Driver kiosk sockets receive server-initiated `qr:refresh` every `QR.REFRESH_PUSH_AT_SECONDS`. QR rotation timers live **on the socket layer**, keyed by `socket.id`, cleared on disconnect.
- Canonical room-join events are dash-cased (`join-trip`, `join-admin`, `join-bus`, `join-route`); snake-cased aliases (`join_trip_room`, etc.) remain for backward compatibility. **Do not use snake-case in new client code.** Full list in [`docs/SOCKET_EVENT_REGISTRY.md`](docs/SOCKET_EVENT_REGISTRY.md).

### 5.6 Background jobs (`apps/backend/src/jobs/`)

All Cloud Tasks-driven except the notification BullMQ worker and the in-process delegate heartbeat.

| File | Trigger | Purpose |
|---|---|---|
| `create-daily-trips.job.ts` | Cloud Task (scheduled) | Materializes trip rows for each active bus/route for the day. |
| `mark-absent.job.ts` | Cloud Task (trip-end follow-up) | Writes ABSENT events for students who didn't check in. |
| `arrival-push-fallback.job.ts` | Cloud Task | Fallback push for students whose arrival wasn't verified. |
| `gps-heartbeat.job.ts` | Cloud Task (periodic) | Detects GPS ONLINE/OFFLINE transitions, emits `gps:status`. |
| `gps-outage-absent.job.ts` | Cloud Task | Finalizes absents affected by a GPS outage. |
| `gps-outage-escalation.job.ts` | Cloud Task (scheduled) | Escalates long outages to transport officer. |
| `gps-cleanup.job.ts` | Cloud Task (daily) | 30-day retention on `GpsLog`. |
| `gps-delegate-heartbeat.job.ts` | **In-process** `startDelegateMonitor()` — ends stale delegate sessions | Short-lived watchdog; tolerant of restart. |
| `late-start-alert.job.ts` | Cloud Task | Alert if trip hasn't started within threshold. |
| `notification.worker.ts` | **BullMQ worker** (Redis-backed) | Reads FCM tokens from `UserDevice` and multicasts via Firebase Admin. |
| `provision-auth.job.ts` | Cloud Task | Provisions Firebase users for bulk-imported staff/students. |
| `reconcile-dashboard-stats.job.ts` | Cloud Task (periodic) + leader on boot | Rebuilds `dashboard:stats` Redis hash from DB truth. |
| `reconcile-redis.job.ts` | Called on leader boot | Ensures Redis derived state is consistent with Postgres. |

**Rule:** every Cloud Task handler validates `X-CloudTasks-Secret` against `env.CLOUD_TASKS_SECRET`, is idempotent, and returns 200 even on no-op so Cloud Tasks doesn't retry unnecessarily.

---

## 6. Shared package — `packages/shared`

Single source of truth, exported from [`packages/shared/src/index.ts`](packages/shared/src/index.ts):

```
src/
├── types/                 TS interfaces (users, bus, route, attendance, trip, incident, qr, notification, api, auth, admin-api, student-home)
├── schemas/               Zod schemas (api, common, auth, checkin, roles)
├── validators/            checkin, route, user, response validators
├── constants/             Domain constants + auth-audit
├── utils/                 time.utils (IST helpers), geo.utils (Haversine), attendance.utils
├── lib/                   response helpers (ok, okList), error-codes
├── policy.ts              Role/permission policy logic (tested)
└── branded.ts             Nominal-type brands for ids
```

**Rules:**

- Both backend and both frontends import from `shared` by package name (`import { ... } from 'shared'`). No relative imports across apps.
- Adding a cross-app contract? It goes here first, code uses it after.
- Changing a schema breaks consumers at type-check time. Good — do both sides in one PR.

---

## 7. Database — Prisma

**Schema:** [`apps/backend/src/db/prisma/schema.prisma`](apps/backend/src/db/prisma/schema.prisma). **1067 lines, 35 models, 22 enums.** Read before adding models.

### 7.1 Model groups

- **Identity & roles.** `User` (STUDENT / STAFF / DRIVER / COORDINATOR / TRANSPORT_OFFICER / FACULTY / MANAGEMENT / NCC_OFFICER), `AdminUser`, `AdminScope`, `AdminRefreshToken`, `AdminBackupCode`, `AdminFingerprint`, `AdminBehaviorEvent`, `AdminTrustedDevice`, `AdminInviteToken`, `AdminSuspension`.
- **Fleet & routing.** `Bus`, `Route`, `Stop`, `RouteStop`, `BusAssignment`, `RouteAssignment`, `RouteCoordinator`, `RouteStopChangeLog`.
- **Trip plane.** `Trip`, `TripDelegate`, `TripSkip`, `WaitRequest`.
- **Attendance (event-sourced).** `AttendanceLog` (current state), `AttendanceEvent` (immutable audit trail), `AttendanceCorrection`.
- **Telemetry.** `GpsLog` (raw pings, 30-day retention).
- **Ops.** `Incident`, `Complaint`, `Message`, `Notification`, `NotificationDrop`.
- **Onboarding.** `ImportSession`, `ImportRow`.
- **Auditing.** `AuthAuditEvent`, `AuditLog`.

### 7.2 Migrations

- Migrations live in `apps/backend/src/db/prisma/migrations/`.
- Use `pnpm --filter backend db:migrate` (wraps `prisma migrate dev`). Do **not** use `db push` in production.
- Always define composite indexes for hot queries: `[student_id, date]`, `[bus_id, timestamp]`, `[route_id, created_at]`, `[trip_id, student_id, status]`, etc.
- Writes that span multiple tables (e.g. incident + audit + notification job) go through `prisma.$transaction(...)`.

### 7.3 Future: schema namespacing

When the university utility platform lands, namespace new domains with `@@schema("utility")` / keep transport in `@@schema("transport")`. This lets Postgres isolate permissions and search paths without a new database.

---

## 8. Caching, realtime, and live state

### 8.1 Two logical Redis roles

Enforced by usage pattern, not by separate instances in all environments:

- **Redis-A (security-critical, `noeviction` in production).** JWT nonces, QR nonces, idempotency records, distributed locks, admin session version, auth state cache, Redis stats hash. Data loss here means correctness loss.
- **Redis-B (ephemeral, `allkeys-lru` in production).** Rate-limit counters, live GPS state, dashboard-derived caches. Eviction is acceptable — the circuit breaker in [`redis-circuit.ts`](apps/backend/src/lib/redis-circuit.ts) has degraded-allow fallbacks.

In local dev, one Docker Redis handles both. In production, map them to separate Memorystore instances.

### 8.2 Firebase Realtime Database

Used exclusively for the live bus position stream the student/admin map consumes. Writes are continuous overwrites under `buses/{busId}`. We write from [`gps.service.ts`](apps/backend/src/modules/gps/gps.service.ts) and read from mobile via `firebase.ts` in each app. RTDB is not a system of record — `GpsLog` in Postgres is.

### 8.3 Socket rooms

- `admin` — global admin broadcast.
- `trip:{tripId}` — driver + students + admins observing a trip.
- `bus:{busId}` — GPS-derived per-bus updates.
- `route:{routeId}` — route-scoped announcements.
- `user:{userId}` — per-user delegation / outage notifications.

Full event list: [`docs/SOCKET_EVENT_REGISTRY.md`](docs/SOCKET_EVENT_REGISTRY.md).

---

## 9. Mobile — `apps/mobile`

### 9.1 Shape

- **Router:** Expo Router v3, route groups:
  - `(auth)/` — `login`, `verify-otp`, `pending` (unassigned students).
  - `(student)/` — `index`, `map`, `scanner`, `checkin-success`, `checkin-fail`, `verify-arrival`, `history`, `self-report-prompt`, `correction/*`, `profile`.
  - `(driver)/` — `index` (today), `kiosk`, `breakdown`, `post-breakdown`, `route-preview`, `summary`, `messages`.
  - `unsupported-role.tsx` — staff/management fall-through.
- **Root layout:** [`app/_layout.tsx`](apps/mobile/app/_layout.tsx). Implements the `AuthGate` — hydrates session, syncs `/v1/auth/me` profile with exponential backoff, routes based on role and `routeAssignment`, wires FCM deep-link and foreground invalidation.
- **Background runtime:** [`tasks/gps.task.ts`](apps/mobile/tasks/gps.task.ts). Expo TaskManager task for driver GPS emission. Reads state from **AsyncStorage**, not from Zustand — the background runtime doesn't share memory with the foreground app.

### 9.2 State management

- **Zustand stores:** [`store/auth.store.ts`](apps/mobile/store/auth.store.ts), [`store/trip.store.ts`](apps/mobile/store/trip.store.ts). Auth store is persisted to AsyncStorage for `user` only; token and device id live in `lib/session-storage.ts` (SecureStore-backed where available).
- **Auth phases:** `idle` → `bootstrapping` → `authenticated` | `unverified` | `unauthenticated`. The `AuthGate` is the only place that transitions them.
- **Server state:** TanStack Query via [`lib/query-client.ts`](apps/mobile/lib/query-client.ts). Query keys live informally per-hook; the admin repo uses a central `query-keys.ts` — consider migrating mobile to the same.

### 9.3 Lib

- `api.client.ts` — fetch wrapper that injects JWT, device id, idempotency key, maps errors to `ApiError`.
- `socket.ts` — single socket.io-client instance, reconnects with auth.
- `checkin-queue.ts` — offline queue for check-ins (see §4 — semantically imperfect but bounded; by design).
- `phone-auth.ts`, `firebase.ts` — Firebase client bindings.
- `notifications.ts` — FCM/Expo token registration. **Known contract bug:** mobile currently registers Expo push tokens but backend expects FCM. See [`docs/PLANNED_NOT_IMPLEMENTED.md`](docs/PLANNED_NOT_IMPLEMENTED.md) §Mobile.
- `secure-storage.ts`, `session-storage.ts`, `persisted-cache.ts`, `warmCache.ts`.

### 9.4 Hooks (`apps/mobile/hooks/`)

One hook per live concern — `useStudentHome`, `useLiveBus`, `useCheckin`, `useKioskSocket`, `useStudentSocket`, `useNetworkStatus`, `useOfflineQueueCount`, `useOptimizedAuth`. Keep them this way; don't merge into mega-hooks.

### 9.5 Services (`apps/mobile/services/`)

`auth.service.ts`, `driver.service.ts`, `student.service.ts` — thin wrappers over `api.client` that return `shared`-typed responses. If a new endpoint appears in `API_CONTRACT_MATRIX`, add the corresponding method here, don't call `api.client` from hooks directly.

---

## 10. Admin — `apps/admin`

### 10.1 Shape

- **Router:** React Router v6 via `BrowserRouter`. The entry [`App.tsx`](apps/admin/src/App.tsx) lazy-loads every page.
- **Shells:**
  - `LiveOpsShell` — dashboard, fleet map, trip detail, incidents, messages, ops center, GPS outages, audit log.
  - `AdminDataShell` — corrections, attendance reports, students, routes, buses, drivers, security, admin users.
- **Auth bootstrap:** `AuthBootstrap` in `App.tsx` calls `GET /v1/admin/auth/me` once on load, hydrates the Zustand auth store, degrades to a retry banner on network error, redirects to `/login` on 401/403.
- **Capability gating:** every route is wrapped in `<RequireCapability capability="..."/>`. Capabilities are derived from admin scopes on the backend and shipped in the `/me` response. **Backend always re-checks capabilities on write** — the UI gate is advisory.
- **Default route resolution:** [`config/routing.config.ts`](apps/admin/src/config/routing.config.ts) computes the landing page from capabilities.

### 10.2 Hooks

Every live surface has a dedicated hook under `apps/admin/src/hooks/`: `useActiveTrips`, `useAdminSocket`, `useAlerts`, `useCommandCenter`, `useCorrections`, `useGpsOutages`, `useIncidents`, `useMessages`, `useReports`, `useTripDetail`. These combine a TanStack Query and a socket subscription — keep that pattern.

### 10.3 API client

- `api.client.ts` — fetch wrapper with `credentials: 'include'` (cookie auth) and `X-CSRF-Token` on write verbs. 401/403 surface through `api-error.ts` and `isAuthError`.
- `query-keys.ts` — central query key registry. Use it.
- `socket.ts` — admin socket connection with cookie-based auth.

---

## 11. Background work — Cloud Tasks model

The only **long-term** in-process scheduling we run is the BullMQ notification worker (it's short-lived, in-pod, and tolerates restart) and the delegate heartbeat interval (same). Everything else is delivered over HTTP by GCP Cloud Tasks.

**Pattern:**

1. Business code enqueues via `lib/cloud-tasks.ts#enqueueTask()` with a target URL on our own `/v1/jobs/*` route, a payload, a scheduled time, and headers including `X-CloudTasks-Secret`.
2. Cloud Tasks calls the webhook at the scheduled time.
3. The webhook:
   - validates `X-CloudTasks-Secret`,
   - validates the payload with Zod,
   - checks idempotency (if the task is at-least-once, the handler must tolerate duplicates),
   - executes the domain logic,
   - returns 200 — even on no-op, to prevent retries.
4. On failure, let Cloud Tasks retry via its own backoff — do not write retry loops in-process.

**Do not add `node-cron`, `setInterval`, `cron`, `agenda`, or `bull-scheduler`** as a replacement for Cloud Tasks.

---

## 12. Security boundaries

### 12.1 Mobile auth

- Firebase phone auth on device (login / verify OTP), backend exchanges the Firebase ID token for a mobile JWT.
- Mobile JWT claims: `sub`, `role`, `type: 'MOBILE'`, `deviceId`, `sv` (session version), issuer, audience (`JWT_MOBILE_AUDIENCE`).
- Device binding — token is valid only for the `deviceId` it was issued for. Rebind requires a fresh login.
- Session version — `sv` is bumped on logout-all and security-sensitive events; cached auth state check in [`auth-cache.ts`](apps/backend/src/lib/auth-cache.ts) rejects stale tokens.

### 12.2 Admin auth

- Username + password, optional MFA (TOTP), optional backup codes.
- `admin_jwt` httpOnly cookie; `SameSite=Lax`, `Secure` in production, optional `Domain=ADMIN_COOKIE_DOMAIN`.
- CSRF — admin writes require `X-CSRF-Token` header that matches a cookie-bound value.
- Session version invalidation, admin rate limiter, fingerprint drift detection ([`admin-fingerprint.service.ts`](apps/backend/src/modules/auth/admin-fingerprint.service.ts)), anomaly logging.
- **MFA enforcement is currently bypassed** (see [`admin-auth.middleware.ts:133`](apps/backend/src/modules/auth/admin-auth.middleware.ts)) — this must be reverted before production. Tracked in [`docs/PLANNED_NOT_IMPLEMENTED.md`](docs/PLANNED_NOT_IMPLEMENTED.md).

### 12.3 QR check-in

- Per-trip JWT rotated over socket every `QR.REFRESH_PUSH_AT_SECONDS`.
- Redis nonce burned via `GETDEL` (atomic).
- Server-side geofence validation against the active stop (Haversine, `GEOFENCE.CHECKIN_RADIUS_METRES`).
- Per-user rate limit (3/60s) with circuit-breaker degraded-allow.

### 12.4 Transport

- HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy applied in [`app.ts`](apps/backend/src/app.ts).
- CORS — strict allowlist from `CORS_ALLOWED_ORIGINS`, required in production.

---

## 13. Environment

Backend env is validated by Zod in [`apps/backend/src/lib/env.ts`](apps/backend/src/lib/env.ts). Production requires:

- `DATABASE_URL` (with pool tuning, e.g. `connection_limit=5&pool_timeout=20` on Cloud SQL)
- `REDIS_URL`
- `JWT_SECRET` (≥32 chars), `JWT_ISSUER`, `JWT_MOBILE_AUDIENCE`, `JWT_ADMIN_AUDIENCE`
- `ADMIN_MFA_ENCRYPTION_KEY` (≥32 chars), `ADMIN_MFA_ISSUER`
- `CORS_ALLOWED_ORIGINS` (comma-separated)
- `BACKEND_URL` (public, not `localhost`)
- `GOOGLE_CLOUD_PROJECT`, `CLOUD_TASKS_QUEUE`, `CLOUD_TASKS_LOCATION`, `CLOUD_TASKS_SA_EMAIL`, `CLOUD_TASKS_SECRET` (≥16)
- `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `FIREBASE_DATABASE_URL`
- `MSG91_AUTH_KEY` + `MSG91_ALERT_TEMPLATE_ID` (if SMS is on)

A local [`.env.example`](.env.example) is the template. Production config fails fast at boot if invalid — do not work around this.

---

## 14. Commands

At the monorepo root (pnpm workspaces + Turbo):

```bash
# Install
pnpm install

# Local infra (Postgres + Redis in Docker)
docker compose -f infra/docker/docker-compose.yml up -d

# All apps in dev
pnpm dev                           # turbo run dev, persistent, all apps

# Backend-only
pnpm --filter backend dev          # tsx watch src/server.ts
pnpm --filter backend build        # tsc
pnpm --filter backend type-check
pnpm --filter backend test         # vitest
pnpm --filter backend e2e:smoke    # tsx scripts/e2e-smoke.ts
pnpm --filter backend db:generate  # prisma generate
pnpm --filter backend db:migrate   # prisma migrate dev
pnpm --filter backend db:studio    # prisma studio

# Admin
pnpm --filter admin dev            # vite
pnpm --filter admin build

# Mobile (from apps/mobile)
cd apps/mobile
pnpm start                         # expo start
pnpm ios
pnpm android

# Cross-repo
pnpm lint          # turbo run lint
pnpm test          # turbo run test
pnpm build         # turbo run build
pnpm format        # prettier
```

---

## 15. Extending safely

### 15.1 Add a backend route

1. Create `apps/backend/src/modules/<name>/` with `routes.ts`, `service.ts`, `repository.ts` (+ `types.ts` if you need module-local types; cross-app types go in `packages/shared`).
2. Types/Zod schemas for requests/responses → `packages/shared/src/schemas/<name>.ts` or `types/<name>.types.ts`.
3. Register in [`app.ts`](apps/backend/src/app.ts): `app.register(nameRoutes, { prefix: '/v1/<name>' })`.
4. Route handler: parse via `request.body` against Zod schema, call `service`, respond with `ok(...)`. Throw `AppError` on failure — the error handler maps it.
5. Service: business logic, coordinates repositories, emits sockets via `io.to(room).emit(...)`, enqueues Cloud Tasks via `enqueueTask`.
6. Repository: Prisma only. Map Prisma errors (P2025 → NOT_FOUND, P2002 → CONFLICT, P2003 → FOREIGN_KEY_VIOLATION).
7. Update [`docs/API_CONTRACT_MATRIX.md`](docs/API_CONTRACT_MATRIX.md) in the same PR.

### 15.2 Add a socket event

1. Emit from the service that owns the domain. Rooms: `admin` for admin, `trip:{id}` / `bus:{id}` / `route:{id}` / `user:{id}` for scoped.
2. Update [`docs/SOCKET_EVENT_REGISTRY.md`](docs/SOCKET_EVENT_REGISTRY.md) in the same PR.
3. Client consumer — admin hook (`useXSocket.ts`) or mobile hook (`useKioskSocket` / `useStudentSocket`). Invalidate the relevant TanStack Query on receipt.

### 15.3 Add a background job

1. File in `apps/backend/src/jobs/<name>.job.ts` exporting a handler.
2. Webhook route in `apps/backend/src/modules/jobs/jobs.routes.ts` that validates `X-CloudTasks-Secret`, parses the payload, calls the handler, returns 200.
3. Enqueue via `enqueueTask` with explicit `scheduleTime` and a stable `taskId` for dedup.
4. Handler must be idempotent — check completed state before acting.

### 15.4 Add a Prisma model

1. Extend `apps/backend/src/db/prisma/schema.prisma`. Include composite indexes for hot queries.
2. `pnpm --filter backend db:migrate -- --name <change>`.
3. `pnpm --filter backend db:generate`.
4. If cross-app, add a DTO/type in `packages/shared`, never leak Prisma types to mobile/admin.

### 15.5 Add a mobile screen

1. File under `apps/mobile/app/(student|driver|auth)/<screen>.tsx`. Expo Router picks it up.
2. Use a hook from `hooks/` for server state; add a new one if needed.
3. Call backend via `services/<domain>.service.ts`. Don't call `api.client` directly from a screen.
4. Navigation: `useRouter().push('/(student)/...')`. Keep role routing decisions in `AuthGate`.

### 15.6 Add an admin page

1. File under `apps/admin/src/pages/<shell>/<Page>.tsx`.
2. Lazy-register it in `App.tsx`, wrap in `<RequireCapability capability="..."/>`.
3. Data fetching via an `apps/admin/src/hooks/useX.ts` that uses `query-keys.ts`.

### 15.7 Extend toward the university platform

- **New backend domain (announcements, notices, OD requests):** new module folder under `apps/backend/src/modules/`, no changes to existing modules. Use `@@schema("utility")` on new Prisma models.
- **New admin surface (university staff console):** create `apps/uni-admin/` as a sibling to `apps/admin/`. Don't bolt it onto the bus admin.
- **New mobile surface:** add a new route group (e.g. `app/(utility)/`) in `apps/mobile`. Existing `(student)`, `(driver)`, `(auth)` stay untouched.
- Shared types for the new domain go in `packages/shared/src/types/<domain>.types.ts`.

---

## 16. Forbidden patterns

| Don't | Do |
|---|---|
| `new Date().toISOString().split('T')[0]` in business logic | Use `getISODateIST()` from `shared` |
| `node-cron`, `setInterval` for scheduling | Cloud Tasks |
| `prisma.*` in a routes file | Call service → repository |
| Business logic in a repository | Move it to the service |
| Duplicate a type across apps | Put it in `packages/shared` |
| Mutate `AttendanceEvent` rows | Append a new event |
| `db push` in production | `prisma migrate deploy` |
| Commit `.env`, service account JSON, or `sqlitejdbc.dll` to git | Keep secrets in env; see `.gitignore` |
| Emit a new socket event without updating `SOCKET_EVENT_REGISTRY.md` | Update both files in the same PR |
| Add a new route without updating `API_CONTRACT_MATRIX.md` | Same rule |
| Skip the `Idempotency-Key` pattern on mutation endpoints | Wire the plugin or the `redis idempotency:*` cache pattern |
| Disable CSRF on admin write endpoints | Keep it on; debug the client |
| `any` in application code | `unknown` + narrow, or an explicit type |

---

## 17. Testing

- **Unit + integration** — Vitest in the backend (`apps/backend/src/**/*.test.ts`) and shared (`packages/shared/src/**/*.test.ts`).
- **Backend smoke harness** — `pnpm --filter backend e2e:smoke` runs [`scripts/e2e-smoke.ts`](apps/backend/scripts/e2e-smoke.ts).
- **Mobile** — no automated suite yet. Regressions are caught by type-check + manual device verification. Treat TypeScript as the first-line correctness gate.
- **Admin** — no automated suite yet; vite type-check + manual.
- **Contract tests** — aspirational; see [`docs/PLANNED_NOT_IMPLEMENTED.md`](docs/PLANNED_NOT_IMPLEMENTED.md).

Before claiming a change is done:

```bash
pnpm --filter backend type-check
pnpm --filter admin build
pnpm --filter backend test -- --run
pnpm --filter backend e2e:smoke
```

---

## 18. Runbooks

Operational playbooks for real incidents live in [`docs/runbooks/`](docs/runbooks/):

- [`checkin-failures.md`](docs/runbooks/checkin-failures.md)
- [`daily-trips-job-failed.md`](docs/runbooks/daily-trips-job-failed.md)
- [`database-connection-exhausted.md`](docs/runbooks/database-connection-exhausted.md)
- [`gps-offline.md`](docs/runbooks/gps-offline.md)
- [`morning-complete-outage.md`](docs/runbooks/morning-complete-outage.md)
- [`redis-restart-recovery.md`](docs/runbooks/redis-restart-recovery.md)

When a new incident class occurs, add a runbook, don't just fix the symptom.

---

## 19. Where to look next

| If you want… | Go to |
|---|---|
| Architecture diagrams and data flows | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| What's done vs in-progress vs not started | [`docs/PRODUCTION_READINESS_STATUS.md`](docs/PRODUCTION_READINESS_STATUS.md) + [`docs/PLANNED_NOT_IMPLEMENTED.md`](docs/PLANNED_NOT_IMPLEMENTED.md) |
| Authoritative route list | [`docs/API_CONTRACT_MATRIX.md`](docs/API_CONTRACT_MATRIX.md) |
| Authoritative socket event list | [`docs/SOCKET_EVENT_REGISTRY.md`](docs/SOCKET_EVENT_REGISTRY.md) |
| Critical E2E flows and failure drills | [`docs/E2E_CRITICAL_PATHS.md`](docs/E2E_CRITICAL_PATHS.md) |
| Production readiness checklist | [`docs/PRODUCTION_READINESS_CHECKLIST.md`](docs/PRODUCTION_READINESS_CHECKLIST.md) |
| Git branching policy | [`docs/GIT_WORKFLOW.md`](docs/GIT_WORKFLOW.md) |
| Dated audits (snapshots, not policy) | [`docs/SYSTEM_FULL_ANALYSIS.md`](docs/SYSTEM_FULL_ANALYSIS.md), [`docs/ARCHITECTURE_STANDARDIZATION_ROADMAP.md`](docs/ARCHITECTURE_STANDARDIZATION_ROADMAP.md), [`docs/MOBILE_SYSTEM_FULL_AUDIT_2026-04-13.md`](docs/MOBILE_SYSTEM_FULL_AUDIT_2026-04-13.md) |
| Module-specific audits | [`docs/module-audits/`](docs/module-audits/) |
| Post-mortems | [`docs/post-mortems/`](docs/post-mortems/) |
