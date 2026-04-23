# Stabilization Plan — College Bus Management System

**Target file on approval:** `plans/stabilization.426.md`
**Authored:** 2026-04-22
**Approved scope:** option (a) — stabilize the mobile platform and backend contracts before any new mobile UI work.

---

## Context

The repo has strong architectural bones and a mostly production-capable backend, but three layered problems block new mobile work:

1. `apps/mobile` does not type-check (see `ts-errors.txt`, `tsc-log.txt`, `tsc_errors.txt`). Any change lands against a broken build.
2. Mobile consumers compensate for missing backend data. `useStudentHome` synthesizes fields that the backend does not provide. Building UI on top of a repair layer encodes the wrong contract into every new screen.
3. Three launch-blocking security items remain: admin MFA enforcement is commented out, mobile OTP is a mock path, and push delivery is wired to Expo tokens while the backend sends via Firebase Admin FCM.

Building new screens before these are closed compounds churn. This plan sequences the stabilization work so that by the end of Phase 3, new mobile UI can land on honest contracts, on a clean build, against a working push and auth path. Phases 4–5 raise the operational floor and run in parallel with new feature work after the Phase 3 gate.

---

## Exit criteria

The stabilization effort is complete when all of the following hold:

- `pnpm turbo type-check` is green across `backend`, `admin`, `mobile`, `shared`, gated in CI.
- `pnpm --filter backend test -- --run` green.
- `pnpm --filter backend e2e:smoke` green against local and against staging.
- `apps/backend/src/modules/auth/admin-auth.middleware.ts` re-enables the MFA enforcement block; privileged admin accounts without MFA are rejected with `MFA_REQUIRED`.
- Mobile login uses real Firebase phone auth in non-`__DEV__` builds. No mock-token code path is reachable in a release build.
- Push delivers end-to-end using native FCM registration tokens on both iOS and Android. `fcmToken` in the DB holds actual FCM registration tokens, never Expo tokens.
- `apps/mobile/hooks/useStudentHome.ts` consumes the real BFF shape. Zero synthesized fields, zero hard-disabled alerts, zero UI branches on state the contract does not expose.
- Zero `toISOString().split('T')[0]` in `apps/backend/src/modules/**` or `apps/backend/src/jobs/**`. CI guard prevents regression.
- `modules/notifications`, `modules/admin`, `modules/gps` have a repository layer. No Prisma calls from route files anywhere in the backend.
- Staging environment runs the full stack (Cloud Run + Cloud SQL + Memorystore + Cloud Tasks + Firebase staging project).
- `/v1/metrics` exists, is protected (not publicly reachable), and feeds a dashboard with at least five baseline alerts.
- Three critical-path integration tests pass: QR check-in end-to-end, incident → +10min escalation, trip end → absents finalized.
- Maestro device E2E covers login, session restore, driver start trip, QR refresh, student check-in, offline replay.

**Hard gate:** no new mobile UI work ships until the end of Phase 3.

---

## Phase 0 — Builds green (1–2 days)

Goal: restore type-check as the first-line regression gate so the rest of the plan can be verified.

**Corrected principle (per user review):** fix TS errors *without adding fake mobile contract fields*. If `useStudentHome` references a field that doesn't exist in `StudentHomeResponseV3`, prefer **narrowing the UI / deleting the branch temporarily** over **inventing a type shape**. The goal is honest compilation, not decorative compilation.

### Work

1. Categorize errors in `apps/mobile/ts-errors.txt`, `tsc-log.txt`, `tsc_errors.txt` — group by root cause (missing backend field, component prop drift, query-client dynamic import, theme token renames).
2. For each error:
   - If the fix is a legitimate type/prop alignment within `apps/mobile` — fix it.
   - If the fix would require inventing a field in `StudentHomeResponseV3` or any `shared` type to satisfy a UI synthesis — **remove the UI branch** and file the missing data in Phase 2 backlog notes inside the code comment.
3. Fix `apps/mobile/lib/query-client.ts` dynamic import (native module resolution issue, not contract-related).
4. Delete `ts-errors.txt`, `tsc-log.txt`, `tsc_errors.txt`. Confirm they are ignored by `.gitignore`.
5. Verify `pnpm turbo type-check` passes across all packages.
6. Update `.github/workflows/ci.yml` (already exists per `git status`) to run `pnpm turbo type-check` on every PR and block merge on failure.

### Critical files

- `apps/mobile/app/(student)/index.tsx`
- `apps/mobile/hooks/useStudentHome.ts`
- `apps/mobile/components/student/BusStatusCard.tsx`
- `apps/mobile/components/student/CheckInButton.tsx`
- `apps/mobile/components/student/StatCards.tsx`
- `apps/mobile/lib/query-client.ts`
- `apps/mobile/lib/trip-state.ts`
- `.github/workflows/ci.yml`

### Done

- `pnpm turbo type-check` green repo-wide.
- CI fails any PR that breaks type-check.
- No `*.md` or `*.txt` error dumps remain in `apps/mobile/`.

---

## Phase 1 — P0 security (4–6 days)

Three contained changes, all launch blockers.

### 1.1 Re-enable admin MFA

- Uncomment enforcement block at `apps/backend/src/modules/auth/admin-auth.middleware.ts:133-141` (removes the `TODO(PRODUCTION_BLOCKER)` warning). Block roles `TRANSPORT_OFFICER` and `MANAGEMENT` without `mfaEnabled` with `MFA_REQUIRED` 403.
- Write `apps/backend/scripts/backfill-admin-mfa.ts` that forces MFA enrollment prompt on the next login for existing privileged admins without MFA set up.
- Add negative test in `apps/backend/src/modules/auth/admin-auth.middleware.test.ts`: admin with `mfaEnabled=false` and privileged role → 403 `MFA_REQUIRED` on any protected route.

### 1.2 Real Firebase OTP on mobile

- Rewrite `apps/mobile/app/(auth)/verify-otp.tsx` and relevant parts of `apps/mobile/lib/phone-auth.ts` to complete Firebase phone auth end-to-end: `signInWithPhoneNumber` → `confirmationResult.confirm(otp)` → `getIdToken()` → `POST /v1/auth/login`.
- Keep mock-token path behind `if (__DEV__)` for simulator work. Confirm it is tree-shaken from release builds.
- Backend `mobile-auth.service.ts` already verifies real Firebase ID tokens — no backend change required.

### 1.3 Native FCM registration end-to-end (corrected per user review)

**Why the simple `getDevicePushTokenAsync()` swap is insufficient.** On Android `getDevicePushTokenAsync` returns the native FCM registration token, but on iOS it returns the **raw APNs token**. The backend calls `firebase-admin.sendEachForMulticast()` which expects FCM registration tokens on both platforms. A raw APNs token in `fcmToken` will fail silently on iOS.

**Target:** actual FCM registration tokens on both platforms, obtained from Firebase Cloud Messaging directly. Use `@react-native-firebase/messaging` so `messaging().getToken()` returns a true FCM token on iOS (after the APNs key is uploaded to Firebase Console) and on Android.

- Install `@react-native-firebase/app` and `@react-native-firebase/messaging` in `apps/mobile`. This requires an EAS dev-client build — the project already uses EAS, so no new infra.
- Update `apps/mobile/lib/notifications.ts` to call `messaging().getToken()` instead of `getExpoPushTokenAsync()`.
- Android: bundle `google-services.json` via the Expo config plugin (`@react-native-firebase/app` ships one).
- iOS: upload the APNs auth key (`.p8`) to Firebase Console under each project (staging + production) so FCM can route to APNs.
- Rename no fields in the DB — `fcmToken` now stores what its name already implies: an FCM token.
- On the backend, do nothing — `notification.worker.ts` already sends via `sendEachForMulticast`.
- Verification: real push sent from `notification.worker.ts` to a real logged-in device arrives in <5s on both iOS and Android in staging.

### Firebase project prerequisite

- **Staging Firebase project** with Phone Auth and Cloud Messaging enabled, APNs key uploaded.
- **Production Firebase project** with the same, never shared with staging.
- `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `FIREBASE_DATABASE_URL` differ per environment.

### Critical files

- `apps/backend/src/modules/auth/admin-auth.middleware.ts`
- `apps/backend/src/modules/auth/admin-auth.middleware.test.ts`
- `apps/backend/scripts/backfill-admin-mfa.ts` (new)
- `apps/mobile/app/(auth)/verify-otp.tsx`
- `apps/mobile/lib/phone-auth.ts`
- `apps/mobile/lib/notifications.ts`
- `apps/mobile/app.config.ts`
- `apps/mobile/package.json`

### Done

- Admin without MFA rejected with `MFA_REQUIRED` on a protected route (automated test).
- Mobile login via real OTP succeeds in staging on a real device (iOS + Android).
- Push sent via `sendEachForMulticast` arrives on both platforms in staging.
- No `getExpoPushTokenAsync` call remains in `apps/mobile`.
- No mock-token code path reachable outside `__DEV__`.

---

## Phase 2 — Contract alignment (6–8 days)

Goal: retire the repair layer so mobile consumes what the backend actually provides.

**Corrected principle (per user review):** the contract test for `/v1/student/home` **lands in the same PR as the BFF enrichment** — not a follow-up. That test is what prevents the repair layer from creeping back in. A later contract test is a later repair layer.

### 2.1 Student home BFF

- Enrich `apps/backend/src/modules/student/student-home.service.ts` to produce the full `StudentHomeResponseV3` shape defined in `packages/shared/src/types/student-home.ts`:
  - `attendance.percentage`, `presentCount`, `absentCount`, `pendingCorrections` — from `attendance.repository.ts` aggregates.
  - `alerts.yesterdayAbsent`, `alerts.substituteAssigned` — from yesterday's `AttendanceLog` + `TripDelegate` / substitute data.
  - Trip metadata: `driverName`, `scheduledDeparture`, `minutesLate`, substitute driver details.
- **In the same PR:** add `apps/backend/src/modules/student/student-home.contract.test.ts` that builds the full response via the route and asserts shape against the Zod schema.
- Remove compensation logic from `apps/mobile/hooks/useStudentHome.ts`. Re-enable the alerts. Restore the branches that Phase 0 removed.

### 2.2 IST/UTC purge

Replace every `toISOString().split('T')[0]` with `getISODateIST()` from `shared`. Known offenders as of 2026-04-22:

- `apps/backend/src/modules/driver/driver.service.ts:194`
- `apps/backend/src/modules/driver/driver.repository.ts:20`
- `apps/backend/src/modules/driver/driver.repository.ts:146`
- `apps/backend/src/modules/driver/driver.repository.ts:147`
- `apps/backend/src/modules/student/student.repository.ts:87`

Add CI check: grep the pattern under `apps/backend/src/modules/**` and `apps/backend/src/jobs/**` and fail the job if it's found.

### 2.3 Socket registry enforcement

- Add `scripts/check-socket-registry.ts` that:
  - greps `io\.emit\(|socket\.emit\(|io\.to\(.*\)\.emit\(` across backend source,
  - extracts event names,
  - diffs against the "Server -> Client Events" table in `docs/SOCKET_EVENT_REGISTRY.md`,
  - fails with the list of undocumented events.
- Wire into CI.

### Critical files

- `apps/backend/src/modules/student/student-home.service.ts`
- `apps/backend/src/modules/student/student-home.contract.test.ts` (new)
- `apps/backend/src/modules/student/student.repository.ts`
- `apps/backend/src/modules/driver/driver.service.ts`
- `apps/backend/src/modules/driver/driver.repository.ts`
- `apps/mobile/hooks/useStudentHome.ts`
- `apps/mobile/app/(student)/index.tsx`
- `scripts/check-socket-registry.ts` (new)
- `docs/SOCKET_EVENT_REGISTRY.md`
- `.github/workflows/ci.yml`

### Done

- Student home contract test passes against the real BFF; zero synthesized fields remain in `useStudentHome`.
- IST grep guard fails any PR adding `toISOString().split('T')[0]` to business logic.
- Socket registry check fails any PR that emits an undocumented event.

---

## Phase 3 — Architectural debt (5–7 days) — HARD STOP-GATE

After this phase, and only after, new mobile UI work can begin. Phases 4–5 run in parallel from this point.

### 3.1 Missing repositories

Extract Prisma calls from service into a repository for these modules, in order:

1. `notifications` — highest data-consistency risk. New file `modules/notifications/notifications.repository.ts`. Pull BullMQ enqueue + in-app `Notification` writes + `NotificationDrop` writes out of the service.
2. `admin` — biggest surface. `modules/admin/admin.repository.ts`. Consolidate dashboard stat queries, alert feed, messages, corrections list, incident queue. Add cursor-based pagination for the alert feed.
3. `gps` — hot path. `modules/gps/gps.repository.ts`. Batch ping flush, last-known ping lookup, GPS status transitions.

Template: `apps/backend/src/modules/users/users.repository.ts`. Map Prisma errors: `P2025` → `NOT_FOUND (404)`, `P2002` → `CONFLICT (409)`, `P2003` → `FOREIGN_KEY_VIOLATION (400)`, `P2014` → `INVALID_STATE (400)`. `qr` stays as-is.

### 3.2 Transaction audit

Grep for multi-table write sequences in:

- `apps/backend/src/modules/fleet/fleet.service.ts`
- `apps/backend/src/modules/driver/driver.service.ts`
- `apps/backend/src/modules/incidents/incidents.service.ts`

Where writes span more than one model and should be atomic, wrap in `prisma.$transaction(...)`.

### 3.3 Composite indexes

One Prisma migration, per the table in `docs/PRODUCTION_READINESS_STATUS.md`:

- `trips`: `[busId, dateScheduled, status]`
- `attendance_logs`: `[tripId, studentId, status]`, `[studentId, createdAt]`
- `gps_logs`: `[busId, timestamp]`, `[timestamp]`
- `users`: `[phone]`, `[firebaseUid]`
- `route_coordinator`: `[routeId, userId]`
- `route_assignment`: `[routeId, studentId]`
- `incidents`: `[routeId, createdAt]`, `[status]`
- `user_device`: `[userId, isActive]`

Verify with `EXPLAIN ANALYZE` on the hot queries in staging after the migration.

### Done

- `grep -rE "prisma\." apps/backend/src/modules/*/routes.ts` returns nothing.
- `notifications`, `admin`, `gps` each have a `repository.ts` that owns all their Prisma calls.
- Multi-table writes in `fleet`, `driver`, `incidents` are wrapped in `$transaction` where atomicity matters.
- Composite indexes present in staging; hot queries use the expected index in `EXPLAIN ANALYZE`.

**🎯 Gate:** New mobile UI work may begin after this phase. Phases 4 and 5 proceed in parallel.

---

## Phase 4 — Operational readiness (5–10 days, partially gated on GCP)

### 4.1 Staging environment

- Separate **staging GCP project** with billing enabled.
- Cloud Run service for the backend (reuse the existing `Dockerfile`).
- Cloud SQL Postgres 15 instance.
- Two Memorystore Redis instances (Redis-A `noeviction`, Redis-B `allkeys-lru`) — or a single instance initially if budget constrains us, with the split in production only.
- Cloud Tasks queue `system-jobs` with the service account email wired via `CLOUD_TASKS_SA_EMAIL`.
- Staging Firebase project (from Phase 1 prereq).
- Deploy via the existing `.github/workflows/deploy-staging.yml` workflow.

### 4.2 Observability

**Corrected principle (per user review):** `/v1/metrics` is internal or protected — never publicly reachable.

- Mount `prom-client` at `/v1/metrics` via a Fastify plugin.
- Protect the endpoint with one of:
  - bearer-token gate (`METRICS_TOKEN` env var), checked in the route handler, OR
  - IP allowlist in Cloud Run ingress (internal-only load balancer), OR
  - bind `/v1/metrics` to a separate internal port that the public load balancer does not expose.
- Recommended default: token-gated via `METRICS_TOKEN`. Simpler, explicit, survives ingress misconfiguration.
- Export to Grafana Cloud free tier (or Cloud Monitoring).
- Define baseline alert rules:
  - auth failure rate > 5% over 5 min
  - check-in failure rate > 1% over 5 min
  - Cloud Task failure rate > 1% over 10 min
  - Redis error rate > 0.5% over 5 min
  - p95 latency over 5 min exceeds: login 1s, check-in 1s, trip start 2s, trip end 2s, admin dashboard read 1s
  - websocket auth reject rate > 2% over 5 min

### 4.3 Error aggregation

- Wire Sentry (or GCP Error Reporting) into `apps/backend/src/lib/error-handler.ts`.
- Use `audit-sanitizer.ts` to scrub PII before send.
- Separate DSNs for staging and production.

### 4.4 Retention and rollback

- Write `docs/RETENTION_POLICY.md` covering each table with a finite retention: `GpsLog` (30d, already enforced), `Notification`, `NotificationDrop`, `AttendanceEvent` (append-only — needs policy), `AuditLog`, `AuthAuditEvent`.
- Schedule cleanup Cloud Tasks for anything with a finite policy that doesn't already have one.
- Write `docs/ROLLBACK.md` covering: additive migrations (no rollback risk), destructive migrations, backward-incompatible changes. Test a rollback once in staging.

### 4.5 Reports module → Cloud Tasks

- Move `apps/backend/src/modules/admin/reports.service.ts` from fire-and-forget in-process generation to a Cloud Task.
- Client polls via `GET /v1/admin/reports/:jobId/status`.
- Add a `ReportJob` model if one doesn't already exist, or reuse an existing status-tracking pattern.

### Critical files

- `apps/backend/src/app.ts` (mount metrics route)
- `apps/backend/src/lib/metrics.ts`
- `apps/backend/src/lib/error-handler.ts`
- `apps/backend/src/lib/env.ts` (add `METRICS_TOKEN`)
- `apps/backend/src/modules/admin/reports.service.ts`
- `.github/workflows/deploy-staging.yml` (already exists, verify)
- `docs/RETENTION_POLICY.md` (new)
- `docs/ROLLBACK.md` (new)

### Done

- Staging reachable at a public URL; `/v1/ready` returns 200 with DB + Redis ok.
- `/v1/metrics` returns only with the `METRICS_TOKEN` header; unauthenticated hits return 401.
- Alerts fire to a real channel (Slack or email) when thresholds are breached in staging.
- Errors from the backend surface in Sentry.
- Retention Cloud Tasks scheduled; rollback doc committed; one rollback exercised in staging.

---

## Phase 5 — Test depth (10–15 days)

### 5.1 Mobile test suite foundation

- Jest + React Native Testing Library for unit tests of `apps/mobile/hooks/*` and `apps/mobile/store/*`.
- **Maestro** for device E2E (chosen over Detox: YAML flows, no native setup tax). Flows to cover:
  - login with real OTP (against staging)
  - session restore after kill
  - driver start trip → QR refresh
  - student check-in success + replay rejection
  - offline check-in queue replay
- EAS Build dev client for CI-driven device runs.

### 5.2 Contract test harness

- Generate tests from `docs/API_CONTRACT_MATRIX.md` + Zod schemas in `packages/shared/src/schemas/api.ts`.
- Every route in the matrix is hit; every response is validated against its Zod schema.
- Fails fast on drift.

### 5.3 Three critical-path integration tests

Backend integration tests using Testcontainers Postgres + Redis, Firebase and Cloud Tasks faked:

1. **Check-in end-to-end:** driver starts trip → student check-in → `AttendanceEvent` + `AttendanceLog` written → socket `checkin:success` emitted → notification job enqueued.
2. **Incident escalation:** driver reports incident → +10 min → Cloud Task webhook fires → escalation to `TRANSPORT_OFFICER` → `incident:updated` emitted.
3. **Trip end + absent finalization:** driver ends trip → `mark-absent` Cloud Task → absent students get `TRIP_END_ABSENT` events and `ABSENT` log status.

### 5.4 Load test

- k6 script: 1000 concurrent check-ins against staging.
- Pass: p95 latency < 1s, error rate < 0.5%, zero duplicate `AttendanceLog` rows for any `(tripId, studentId)` pair.

### 5.5 Failure drills

Automate the drills from `docs/E2E_CRITICAL_PATHS.md`:

- expired admin cookie during websocket reconnect
- Redis unavailable during check-in (circuit breaker degrades gracefully)
- Cloud Tasks auth failure
- Firebase unavailable in non-production mock mode
- Prisma connection restart during readiness probe

### Done

- CI runs mobile Jest, backend integration tests, contract tests on every PR — all green.
- Maestro suite green in CI on at least one Android and one iOS emulator.
- k6 load test green in staging, rerun-able on demand.
- Failure drill suite green on demand.

---

## Decisions (locked)

| Decision | Value |
|---|---|
| Firebase | **Separate staging + production projects.** Both with Phone Auth + FCM enabled. Prereq for Phase 1. |
| GCP | **Separate staging project with billing.** Created in Phase 4 if absent. Does not block Phases 0–3. |
| Push approach | **Native FCM end-to-end** via `@react-native-firebase/messaging`. Not an Expo API swap. Not Expo Push. |
| Phase 3 gate | **Hard.** No new mobile UI before Phase 3 is complete. |
| Mobile E2E | **Maestro.** |
| Parallelism | **One thing at a time until Phase 3.** Phases 4–5 run in parallel with new feature work after. |

---

## What to avoid

1. "Mechanical" TS fixes in Phase 0 that invent type shapes to preserve dishonest UI. Prefer deleting a branch and circling back in Phase 2.
2. Shipping a mock OTP path outside `__DEV__`.
3. Mixing Expo push tokens and FCM tokens in one `fcmToken` field. Tokens stored in `fcmToken` must be real FCM registration tokens.
4. Starting new mobile UI before the Phase 3 stop-gate.
5. WatermelonDB or any large offline-DB refactor before mobile contracts and P0 security close. Out of scope.
6. Public `/v1/metrics`. Protect it.
7. Touching working reference modules (`users`, `routes`, `attendance`) beyond the Phase 2 contract fix on student home.
8. Socket event additions without updating `docs/SOCKET_EVENT_REGISTRY.md`.
9. Route additions without updating `docs/API_CONTRACT_MATRIX.md`.

---

## Timeline (one engineer, full-time)

| Phase | Estimate | Cumulative |
|---|---|---|
| 0 — Builds green | 1–2 d | end of week 1 |
| 1 — P0 security | 4–6 d | end of week 2 |
| 2 — Contract alignment | 6–8 d | end of week 3 |
| 3 — Architectural debt | 5–7 d | end of week 4 — **gate** |
| 4 — Operational readiness | 5–10 d (parallel allowed) | end of week 6 |
| 5 — Test depth | 10–15 d (parallel allowed) | end of week 9 |

Total elapsed: **6–9 weeks.** Stop-gate reached at ~week 4. After that, new mobile UI work runs alongside Phases 4–5.

---

## Verification

End-to-end checks against staging once the plan is complete:

```bash
# type-check across the repo
pnpm turbo type-check

# backend tests
pnpm --filter backend test -- --run

# backend smoke against staging
BACKEND_URL=https://staging.api.example.com pnpm --filter backend e2e:smoke

# contract test against staging
pnpm --filter backend test contract -- --run

# socket registry enforcement
tsx scripts/check-socket-registry.ts

# IST/UTC guard (fails if any toISOString().split('T')[0] in business logic)
! grep -rE "toISOString\(\)\.split\('T'\)\[0\]" apps/backend/src/modules apps/backend/src/jobs

# Maestro mobile E2E
maestro test apps/mobile/.maestro/

# k6 load test against staging
k6 run scripts/load/checkin-1000.js
```

Manual device drills:

- Login via real OTP on a clean device (iOS + Android) — lands on role-appropriate screen.
- Kill the app, reopen — session restored without re-login.
- Send a test notification from the backend — arrives in <5s.
- Disable network, perform a check-in — queued; re-enable network — queue replays or surfaces a clear failure.
- Admin login without MFA enrolled — blocked with `MFA_REQUIRED`.

---

## Next action on approval

Copy the contents of this plan to `plans/stabilization.426.md` in the repo. That path was the user's chosen location; this harness plan file is interim and not committed.

After commit, begin Phase 0.
