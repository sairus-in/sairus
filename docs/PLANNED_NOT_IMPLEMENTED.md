# Planned But Not Implemented — Gap Audit

> **Purpose.** A single source of truth for work that was designed, planned, or promised in earlier docs but is **not yet in the code** (or is present but broken/bypassed). This file does not duplicate short-term TODOs, incident fixes, or PR-level notes — it is the backlog that blocks "production-ready, phase-1 complete, phase-2 ready".
>
> **How this file is maintained.** When you close a gap, move the row here to [`PRODUCTION_READINESS_STATUS.md`](PRODUCTION_READINESS_STATUS.md) as completed, and remove it from here. When a new plan is documented but not shipped, add a row here — not a todo in [`CLAUDE.md`](../CLAUDE.md).
>
> **Last reconciled against code:** 2026-04-22.

---

## Legend

- **Source.** Which doc originally captured the plan.
- **Evidence.** Concrete file(s) / grep result demonstrating the gap in the current tree.
- **Priority.** P0 blocks launch. P1 blocks "industry-locked" maturity. P2 is quality/debt.

---

## 1. Security — production blockers

### 1.1 Admin MFA enforcement is bypassed in code — P0

- **Source.** [`PRODUCTION_READINESS_CHECKLIST.md`](PRODUCTION_READINESS_CHECKLIST.md) §Security (explicit `CRITICAL` warning).
- **Evidence.** [`apps/backend/src/modules/auth/admin-auth.middleware.ts:133`](../apps/backend/src/modules/auth/admin-auth.middleware.ts) — `TODO(PRODUCTION_BLOCKER): Re-enable MFA enforcement before deploying to prod!`. Lines 135–140 are the commented-out enforcement block that throws `MFA_REQUIRED` for `TRANSPORT_OFFICER` and `MANAGEMENT` roles when `authState.mfaEnabled === false`.
- **Plan.** Uncomment the enforcement block, require MFA enrollment for privileged roles in staging before cutting a release branch.

### 1.2 Mobile production OTP flow is mock-token only — P0

- **Source.** [`SYSTEM_FULL_ANALYSIS.md`](SYSTEM_FULL_ANALYSIS.md) §4.1 and §9.
- **Evidence.** Backend verification is real ([`mobile-auth.service.ts`](../apps/backend/src/modules/auth/mobile-auth.service.ts)), but the mobile `verify-otp.tsx` screen and `lib/phone-auth.ts` do not complete the Firebase on-device credential exchange; they submit a dev-path token. Acceptable for non-production; not acceptable for public launch.
- **Plan.** Implement real Firebase `PhoneAuthProvider` flow on device, surface recaptcha, exchange the resulting ID token for a mobile JWT via `/v1/auth/login`.

### 1.3 Expo vs FCM push-token mismatch — P0

- **Source.** [`MOBILE_SYSTEM_FULL_AUDIT_2026-04-13.md`](MOBILE_SYSTEM_FULL_AUDIT_2026-04-13.md) §Critical Findings #2.
- **Evidence.** Mobile registers an Expo push token at [`apps/mobile/lib/notifications.ts:61`](../apps/mobile/lib/notifications.ts) (`Notifications.getExpoPushTokenAsync`), stores it in the `fcmToken` field, and the backend `notification.worker.ts` sends via `firebase-admin.sendEachForMulticast()` which expects FCM registration tokens. The two are not interchangeable.
- **Plan.** Either (a) switch mobile to `getDevicePushTokenAsync()` to acquire the native FCM registration token, or (b) register a dedicated FCM token alongside the Expo token and use the right one per delivery path. Rename `fcmToken` accordingly.

### 1.4 CSRF protection on admin write actions — P1

- **Source.** [`PRODUCTION_READINESS_CHECKLIST.md`](PRODUCTION_READINESS_CHECKLIST.md) §Security.
- **Evidence.** Checklist calls it a pre-public-launch add. CSRF validation exists in the admin auth middleware; verify it is actually enforced on every state-changing admin route, not only login paths.
- **Plan.** Audit every route under `/v1/admin/*` that is `POST`/`PATCH`/`DELETE` and confirm `X-CSRF-Token` is required. Add a failing negative test for any route without it.

---

## 2. Backend — 4-layer architecture gaps

Originally scoped in [`ARCHITECTURE_STANDARDIZATION_ROADMAP.md`](ARCHITECTURE_STANDARDIZATION_ROADMAP.md). Progress has happened, but four modules still lack a repository file.

### 2.1 Missing repository layer — P1

- **Evidence.** Confirmed against the current tree (2026-04-22):

  | Module | Status | Files present |
  |---|---|---|
  | `modules/gps/` | ❌ no `gps.repository.ts` | routes + service only |
  | `modules/notifications/` | ❌ no `notifications.repository.ts`, no `notifications.routes.ts` | service only |
  | `modules/qr/` | ❌ no `qr.repository.ts` | service only (acceptable — nonce generation is thin and already correct) |
  | `modules/admin/` | ❌ no `admin.repository.ts` | routes + service + serializers + `reports.service.ts` |
  | `modules/auth/` | ⚠️ partial | `mobile-auth.repository.ts` and `admin-auth.repository.ts` exist, but base `auth.service.ts` has no repo. |

- **Plan.** Use [`users.repository.ts`](../apps/backend/src/modules/users/users.repository.ts) as the template. Extract Prisma calls from each service into a repository that maps Prisma errors (`P2025`/`P2002`/`P2003`/`P2014`) to `AppError`. Start with `admin` and `notifications` (highest surface area), then `gps`. `qr` is acceptable as-is.

### 2.2 IST/UTC date handling still drifts — P1

- **Source.** [`SYSTEM_FULL_ANALYSIS.md`](SYSTEM_FULL_ANALYSIS.md) §4.3, and the invariant in [`CLAUDE.md` §4.7](../CLAUDE.md#4-architectural-invariants--never-break-these).
- **Evidence.** The previously-called-out offenders (`users.service`, `import.service`, `routes.service`) appear to have been cleaned up, but new usages now exist:
  - [`apps/backend/src/modules/driver/driver.service.ts:194`](../apps/backend/src/modules/driver/driver.service.ts)
  - [`apps/backend/src/modules/driver/driver.repository.ts:20, 146, 147`](../apps/backend/src/modules/driver/driver.repository.ts)
  - [`apps/backend/src/modules/student/student.repository.ts:87`](../apps/backend/src/modules/student/student.repository.ts)
- **Plan.** Replace every `toISOString().split('T')[0]` with `getISODateIST()` from `shared`. Add a repo-wide grep guard in CI to block regression.

### 2.3 Composite database indexes not added — P2

- **Source.** [`PRODUCTION_READINESS_STATUS.md`](PRODUCTION_READINESS_STATUS.md) §[P2] Database Composite Indexes.
- **Evidence.** Roadmap lists ~12 composite indexes (on `trips`, `attendance_logs`, `gps_pings`, `users`, `route_coordinator`, `route_assignment`, `incidents`, `user_device`). Verify against current `schema.prisma` before migration — some may have landed.
- **Plan.** One Prisma migration, `ANALYZE` on production DB, verify query plans.

### 2.4 Enforced AppError mapping + global error handler contract — P2

- **Source.** [`PRODUCTION_READINESS_STATUS.md`](PRODUCTION_READINESS_STATUS.md) §[P2] Error Handling.
- **Evidence.** `error-handler.ts` exists, but repositories that don't exist (§2.1) can't map Prisma errors. Once those ship, make sure every route responds via `ok()`/`okList()`/`AppError` — no bare `reply.send({...})`.
- **Plan.** After §2.1 closes, add a lint rule or test that asserts every route handler either returns an `ok/okList` value or throws `AppError`.

### 2.5 Multi-step transactional atomicity — P2

- **Source.** [`PRODUCTION_READINESS_STATUS.md`](PRODUCTION_READINESS_STATUS.md) §[P2] Database Transactions.
- **Evidence.** Some flows (fleet CRUD, driver state changes, some incident flows) do multi-write without `prisma.$transaction`. Attendance and routes have been standardized.
- **Plan.** Audit fleet, driver, and incident service writes for multi-table mutations; wrap in `$transaction`.

---

## 3. Contracts — docs vs. code drift

### 3.1 Socket event registry still missing events — P1 (partial)

- **Source.** [`SYSTEM_FULL_ANALYSIS.md`](SYSTEM_FULL_ANALYSIS.md) §4.4 and §5.
- **Evidence.** The audit flagged `incident:reported` and `gps:position` as missing; both are now listed in [`SOCKET_EVENT_REGISTRY.md`](SOCKET_EVENT_REGISTRY.md). What's still not codified: the enforcement discipline — every socket PR must touch the registry. Currently it's honor-system.
- **Plan.** Add a PR-check script that diffs `io.emit|io.to(...).emit|socket.emit` call sites against the table in the registry and fails the PR if an emitted event isn't listed.

### 3.2 Student home BFF contract drift — P1

- **Source.** [`SYSTEM_FULL_ANALYSIS.md`](SYSTEM_FULL_ANALYSIS.md) §4.2 and §10 P0 #3.
- **Evidence.** The mobile `useStudentHome` still normalizes backend payloads and hard-disables fields the backend doesn't provide (`attendance.percentage`, `presentCount`, `absentCount`, `pendingCorrections`, `alerts.yesterdayAbsent`, `alerts.substituteAssigned`, trip metadata). The app compensates with UI-side defaults.
- **Plan.** Enrich `/v1/student/home` in [`modules/student/student-home.service.ts`](../apps/backend/src/modules/student/student-home.service.ts) to return the full `StudentHomeResponseV3` shape. Remove the compensation layer in `useStudentHome`. Add a contract test.

### 3.3 Contract test harness — P1

- **Source.** [`PRODUCTION_READINESS_CHECKLIST.md`](PRODUCTION_READINESS_CHECKLIST.md) §Testing.
- **Evidence.** No contract test file exists that asserts every row in `API_CONTRACT_MATRIX.md` is reachable and returns a schema-matching envelope.
- **Plan.** Generate a contract test from `API_CONTRACT_MATRIX.md` + the Zod response schemas in `packages/shared/src/schemas/api.ts`.

---

## 4. Mobile

### 4.1 Mobile type-check fails — P0 for mobile work

- **Source.** [`MOBILE_SYSTEM_FULL_AUDIT_2026-04-13.md`](MOBILE_SYSTEM_FULL_AUDIT_2026-04-13.md) §Verified Build / Type State.
- **Evidence.** `ts-errors.txt`, `tsc-log.txt`, `tsc_errors.txt` present in `apps/mobile/`. The audit names `app/(student)/index.tsx`, `hooks/useStudentHome.ts`, `lib/query-client.ts`, `components/student/*` as the broken surface.
- **Plan.** Align `useStudentHome` with the backend contract fix in §3.2, align `StudentHomeResponseV3` with the UI model, re-type student components. No new student feature work until this is green.

### 4.2 No mobile automated test suite — P1

- **Source.** [`SYSTEM_FULL_ANALYSIS.md`](SYSTEM_FULL_ANALYSIS.md) §4.6 and §10 P1 #5.
- **Evidence.** No `__tests__/` directories under `apps/mobile/`, no vitest/jest config.
- **Plan.** Start with the P1 flows from [`E2E_CRITICAL_PATHS.md`](E2E_CRITICAL_PATHS.md) — login / session restore, driver start trip, QR refresh, student check-in, offline replay, history/correction. Use Detox or Maestro for device E2E.

### 4.3 Offline check-in queue is bounded-but-imperfect — P2

- **Source.** [`SYSTEM_FULL_ANALYSIS.md`](SYSTEM_FULL_ANALYSIS.md) §4.5.
- **Evidence.** [`apps/mobile/lib/checkin-queue.ts`](../apps/mobile/lib/checkin-queue.ts) queues check-ins when offline, but queued attempts can fail on reconnect because the underlying trip or QR has moved on.
- **Plan.** Accept this as a design limitation and document the user-facing behavior (a banner when a queued check-in can't be replayed). No "fix" required, but the UI should not pretend it always works.

### 4.4 Student realtime uses 30s polling fallback — P2

- **Source.** [`SYSTEM_FULL_ANALYSIS.md`](SYSTEM_FULL_ANALYSIS.md) §4.7 and §10 P2 #7.
- **Evidence.** [`apps/mobile/hooks/useStudentSocket.ts`](../apps/mobile/hooks/useStudentSocket.ts) joins the active trip room but also polls every 30s. Acceptable for now; a fully push-driven contract would remove the polling.
- **Plan.** Define explicit student-side socket events (attendance state updates, trip status) and remove the polling fallback.

---

## 5. Infrastructure / deployment

### 5.1 Staging environment parity with production — P1

- **Source.** [`PRODUCTION_READINESS_CHECKLIST.md`](PRODUCTION_READINESS_CHECKLIST.md) §Runtime.
- **Evidence.** GitHub workflow files exist (`deploy-staging.yml`, `deploy-production.yml`) but a staging environment on Cloud Run / Cloud SQL / Memorystore / Cloud Tasks with Firebase project parity isn't confirmed in-code. Current CLAUDE.md snapshot said "not deployed anywhere".
- **Plan.** Stand up staging. Run the smoke suite (`pnpm --filter backend e2e:smoke`) against it from CI.

### 5.2 Redis two-instance split not exercised in staging — P2

- **Source.** [`CLAUDE.md` §8.1](../CLAUDE.md#81-two-logical-redis-roles) invariant.
- **Evidence.** Both logical roles point at the same Redis in local dev and likely in staging. Production intends to split them into two Memorystore instances with different eviction policies.
- **Plan.** Wire a staging profile that uses two Redis URLs (`REDIS_URL`, `REDIS_URL_LIVE` or similar), update `redis-client.ts` to route per-operation, and document which keys belong to which instance.

### 5.3 Observability: dashboards + alerts — P1

- **Source.** [`PRODUCTION_READINESS_STATUS.md`](PRODUCTION_READINESS_STATUS.md) §[P2] Production Monitoring, [`PRODUCTION_READINESS_CHECKLIST.md`](PRODUCTION_READINESS_CHECKLIST.md) §Observability.
- **Evidence.** `prom-client` is a dependency, metrics utilities exist in `apps/backend/src/lib/metrics.ts`, but no `/v1/metrics` scrape endpoint mount is documented, and no dashboard/alert configuration lives in-repo.
- **Plan.** Expose `/v1/metrics`, wire it to Cloud Monitoring or Grafana Cloud, define alerts for: auth failure rate > 5%, check-in failure rate > 1%, job failure rate, Redis error rate, websocket auth rejection rate, GPS outage count, p95 latency for login / check-in / trip start / trip end / admin dashboard read.

### 5.4 Error aggregation (Sentry-class) — P2

- **Source.** [`PRODUCTION_READINESS_STATUS.md`](PRODUCTION_READINESS_STATUS.md) §[P2] Production Monitoring.
- **Evidence.** No Sentry / equivalent integration in `apps/backend/src/lib/error-handler.ts`.
- **Plan.** Add Sentry (or GCP Error Reporting) wiring in the error handler; scrub PII using `audit-sanitizer.ts`.

### 5.5 Notification delivery status tracking — P2

- **Source.** [`ARCHITECTURE_STANDARDIZATION_ROADMAP.md`](ARCHITECTURE_STANDARDIZATION_ROADMAP.md) §11 Notifications.
- **Evidence.** `NotificationDrop` table exists for failures; there is no per-notification delivery-status record (sent/delivered/opened).
- **Plan.** If we need it, add a `Notification.status` column or a separate `NotificationDelivery` table. Not a launch blocker.

### 5.6 Reports module — Cloud Tasks migration — P1

- **Source.** [`ARCHITECTURE_STANDARDIZATION_ROADMAP.md`](ARCHITECTURE_STANDARDIZATION_ROADMAP.md) §Reports ("fire-and-forget, needs Cloud Tasks — out of scope").
- **Evidence.** `modules/admin/reports.service.ts` has a test file and is in use, but the roadmap flagged it as still fire-and-forget rather than Cloud Tasks-backed.
- **Plan.** Move report generation to Cloud Tasks with a job ID the client polls via `GET /v1/admin/reports/:jobId/status`.

---

## 6. Testing gaps

### 6.1 Unit coverage on critical paths — P1

- **Source.** [`PRODUCTION_READINESS_STATUS.md`](PRODUCTION_READINESS_STATUS.md) §Production Gate Checklist.
- **Evidence.** The checklist names three critical-path tests that don't exist: (1) QR check-in → attendance recorded → notification sent, (2) incident reported → escalated at +10 min, (3) trip end → absents marked.
- **Plan.** Write these three as integration tests against a Testcontainers Postgres + Redis. Fakes for Firebase / Cloud Tasks.

### 6.2 Load test: 1000 concurrent check-ins — P2

- **Source.** [`PRODUCTION_READINESS_STATUS.md`](PRODUCTION_READINESS_STATUS.md) §Production Gate Checklist.
- **Evidence.** No k6 / artillery script in-repo.
- **Plan.** Add a k6 script that drives 1000 concurrent check-ins through the backend, assert p95 < 1s, zero duplicate writes.

### 6.3 Failure drills from E2E_CRITICAL_PATHS — P1

- **Source.** [`E2E_CRITICAL_PATHS.md`](E2E_CRITICAL_PATHS.md) §Failure Drills.
- **Evidence.** Documented drills: expired admin cookie during websocket reconnect, Redis unavailable during check-in, Cloud Tasks auth failure, Firebase unavailable in non-production mock mode, Prisma connection restart during readiness. No automated tests exist for any of them.
- **Plan.** Each becomes a test case in the backend test suite (for Redis/Prisma/Cloud Tasks) and a mobile device drill (for the admin cookie / Firebase cases).

---

## 7. Documentation debt

### 7.1 Retention policies not documented per domain — P2

- **Source.** [`PRODUCTION_READINESS_CHECKLIST.md`](PRODUCTION_READINESS_CHECKLIST.md) §Data and Migrations.
- **Evidence.** `GpsLog` has a 30-day job; no documented policy for `Notification`, `NotificationDrop`, `AuditLog`, `AuthAuditEvent`, `AttendanceEvent` (append-only — grows unbounded), `AttendanceCorrection`.
- **Plan.** Define retention in a new `docs/RETENTION_POLICY.md`; schedule cleanup Cloud Tasks for everything with a policy shorter than "forever".

### 7.2 Rollback plan per migration class — P2

- **Source.** [`PRODUCTION_READINESS_CHECKLIST.md`](PRODUCTION_READINESS_CHECKLIST.md) §Data and Migrations, §Delivery.
- **Evidence.** No `docs/ROLLBACK.md` or migration runbook.
- **Plan.** Document rollback procedure for (a) additive migrations, (b) destructive migrations, (c) backward-incompatible schema changes. Test one in staging.

---

## 8. Phase-2 prerequisites (university utility platform)

These are not phase-1 blockers, but the design goal in [`CLAUDE.md` §15.7](../CLAUDE.md#157-extend-toward-the-university-platform) and [`ARCHITECTURE.md` §9](ARCHITECTURE.md#9-phase-2--university-utility-platform) requires these to be in place before adding new domains.

### 8.1 Prisma multi-schema namespacing — P1 for phase 2

- **Plan.** Migrate existing transport tables to `@@schema("transport")`, configure `previewFeatures = ["multiSchema"]` in the Prisma generator, update `DATABASE_URL` with `?schemas=transport,utility`. Test in staging before any utility model is added.

### 8.2 `apps/uni-admin/` scaffold — P1 for phase 2

- **Plan.** Create a sibling Vite + React app with shared auth (reuse `admin-auth.middleware.ts`), separate capability set, own routing config. Do not copy-paste from `apps/admin/` — share only what goes through `packages/shared`.

### 8.3 Mobile `(utility)` route group + role extension — P1 for phase 2

- **Plan.** Add `app/(utility)/` to Expo Router, extend the `AuthGate` role switch, add a new navigation entry. Existing `(student)` and `(driver)` untouched.

### 8.4 Shared domain types for announcements / notices / OD requests — P1 for phase 2

- **Plan.** New files under `packages/shared/src/types/`: `announcement.types.ts`, `notice.types.ts`, `od-request.types.ts`. New Zod schemas. Do not model these in individual apps first.

---

## 9. Superseded / cleared items

These appeared in earlier docs or in the previous `CLAUDE.md` but are **not gaps** anymore. Listed so future readers don't re-open them:

- **`ioredis` version conflict override** — resolved. `package.json` root has `"ioredis": "^5.4.1"` in `pnpm.overrides`.
- **`.env.example`** — committed at repo root.
- **Archive root-level analysis `.md` files** — done; all `*.resolved` files and analysis drafts now live in `docs/archive/`.
- **Notifications FCM token lookup from mock to real** — resolved in `notification.worker.ts`.
- **Incidents escalation chain + list methods** — resolved (`incidents.service.ts`, `jobs.routes.ts`).
- **Mobile-auth rate limiting moved from routes to service** — resolved (`mobile-auth.service.ts`).

---

## Where to escalate

- **Production blockers (P0):** raise in a tracked issue before any launch milestone.
- **Architectural debt (P1):** schedule into the current sprint.
- **Quality debt (P2):** group into monthly polish passes.

When something here closes, move it to [`PRODUCTION_READINESS_STATUS.md`](PRODUCTION_READINESS_STATUS.md) and delete the row. Keep this file honest.
