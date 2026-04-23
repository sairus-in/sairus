# System Full Analysis

Date: 2026-03-24
Repository: `c:\Users\krist\Desktop\college-bus-system`

## 1. Executive Summary

This system is a serious, production-oriented monorepo with the right macro shape for the problem: a Fastify backend, an admin SPA, a mobile Expo client, shared contracts/utilities, Redis-backed realtime, Firebase RTDB for live bus position, and Prisma/Postgres for system-of-record data.

Status terminology used across docs:

- **Verified**: explicitly confirmed in current code.
- **Partial**: implemented but incomplete or fallback-heavy.
- **Intended**: documented target architecture, not fully implemented/proven.
- **At Risk**: known drift, inconsistency, or correctness concern.

The architecture is not the main problem anymore. The main problem is contract discipline and execution completeness at the edges:

- the backend core is ahead of the mobile and docs in several places
- some frontend and markdown artifacts still compensate for backend shape instead of consuming a locked BFF contract
- security posture is directionally strong, but production-grade mobile auth and some operational guardrails are still incomplete
- reliability work exists, but runtime proof is uneven across subsystems

### Overall verdict

- Architecture: strong
- Security design: good, with a few remaining production blockers
- Reliability design: good, proof still incomplete
- API / contract discipline: medium
- Completeness: medium-high for backend core, medium for mobile and docs
- Production readiness: promising but not yet fully industry-locked

## 2. System Map

### Monorepo shape

- `apps/backend`: Fastify API, auth, jobs, websocket server, Prisma integration
- `apps/admin`: admin web UI
- `apps/mobile`: Expo / React Native client for student and driver flows
- `packages/shared`: shared constants, types, time utils, validators

### Runtime boundaries

- Mobile foreground app:
  - `apps/mobile/app/*`
  - Zustand stores
  - React Query
  - socket.io client
- Mobile background task:
  - `apps/mobile/tasks/gps.task.ts`
  - separate Expo TaskManager runtime
- Backend API:
  - `apps/backend/src/app.ts`
  - REST endpoints under `/v1/*`
- Backend realtime:
  - `apps/backend/src/websocket/socket.ts`
  - Redis adapter for horizontal websocket scaling
- Backend async jobs:
  - `apps/backend/src/jobs/*`
- Firebase RTDB:
  - live bus location projection for mobile map
- Postgres via Prisma:
  - source of truth for trips, attendance, assignments, users, incidents

### Major client flows

- Mobile auth:
  - login / verify OTP / `/v1/auth/login` / `/v1/auth/me`
- Student:
  - home, live map, QR check-in, history, correction, self-report
- Driver:
  - today assignment, trip start, kiosk, breakdown, summary
- Admin:
  - cookie auth, live dashboard, incidents, corrections, messaging

## 3. Current Strengths

### Verified strengths

- Backend startup and request pipeline are structured and production-aware.
  - `apps/backend/src/app.ts`
  - request ids, readiness checks, security headers, explicit route mounting
- Admin auth boundary is materially stronger than average for this stage.
  - `apps/backend/src/modules/auth/admin-auth.middleware.ts`
  - httpOnly cookie auth, CSRF validation, session-version enforcement
- Mobile auth design includes device binding and session invalidation.
  - `apps/backend/src/modules/auth/mobile-auth.service.ts`
- Websocket auth is real, not decorative.
  - `apps/backend/src/websocket/socket.ts`
  - JWT validation, admin/mobile differentiation, auth cache checks
- Driver GPS background flow uses the correct runtime handoff pattern.
  - `apps/mobile/tasks/gps.task.ts`
  - AsyncStorage handoff instead of in-memory Zustand reads
- Mobile app structure is clean.
  - `apps/mobile/app/_layout.tsx`
  - `apps/mobile/store/auth.store.ts`
  - `apps/mobile/store/trip.store.ts`
  - `apps/mobile/lib/*`
- Runbooks and operational docs exist.
  - `docs/runbooks/*`
  - `docs/PRODUCTION_READINESS_CHECKLIST.md`
  - `docs/E2E_CRITICAL_PATHS.md`

## 4. Critical Findings

The findings below are verified against the current codebase unless explicitly marked as inferred.

### High

#### 4.1 Mobile production login is still not a true production login flow

The mobile verify screen still sends a dev-style mock token instead of completing a real Firebase phone-auth UI flow.

- `apps/mobile/app/(auth)/verify-otp.tsx`
- `apps/backend/src/modules/auth/mobile-auth.service.ts`

Impact:

- this is acceptable for non-production and local integration
- it is not acceptable as the final production mobile auth UX
- production readiness is blocked until real Firebase credential acquisition is wired on-device

#### 4.2 Student home contract is only partially real; the mobile app is compensating for backend omissions

The student home hook currently normalizes backend payloads into a richer UI model and suppresses fields the backend does not actually provide.

- `apps/mobile/hooks/useStudentHome.ts`
- `apps/backend/src/modules/student/student.routes.ts`

Examples:

- `attendance.percentage`, `presentCount`, `absentCount`, `pendingCorrections` are currently `null` in the mobile normalization layer
- `alerts.yesterdayAbsent` and `alerts.substituteAssigned` are hard-disabled
- trip metadata like `driverName`, `scheduledDeparture`, `minutesLate`, and substitute details are not provided by the student BFF contract

Impact:

- the app is functional, but not contract-clean
- UI correctness depends on a frontend repair layer instead of a locked backend-for-frontend response
- future mobile work is still vulnerable to silent shape drift

#### 4.3 Timezone integrity is still inconsistent in backend business logic

Several backend services still use `new Date().toISOString().split('T')[0]` even though the shared utilities explicitly warn against that for IST-sensitive date logic.

- `apps/backend/src/modules/users/users.service.ts`
- `apps/backend/src/modules/import/import.service.ts`
- `apps/backend/src/modules/routes/routes.service.ts`
- `packages/shared/src/utils/time.utils.ts`

Impact:

- date-sensitive operations can be wrong around IST day boundaries
- route assignment gating, import safety, and route operations can behave incorrectly depending on server timezone / UTC offsets

This is one of the highest-signal correctness bugs remaining in the backend.

#### 4.4 The markdown contract docs are already drifting from live code

The repo has improved contract docs, but they are not yet authoritative enough to prevent drift.

Verified examples:

- `docs/SOCKET_EVENT_REGISTRY.md` does not list `incident:reported`
  - backend emit exists in `apps/backend/src/modules/incidents/incidents.service.ts`
- `docs/SOCKET_EVENT_REGISTRY.md` does not list `gps:position`
  - backend emit exists in `apps/backend/src/modules/gps/gps.service.ts`
- websocket server accepts legacy aliases such as `join_trip_room` and `join_admin_room`, but the registry only documents canonical names
  - `apps/backend/src/websocket/socket.ts`

Impact:

- docs are useful, but not yet sufficient as a source of truth
- integrators can still build against incomplete event knowledge

### Medium

#### 4.5 Mobile offline check-in is operationally helpful but semantically imperfect

The queue is well-intentioned and bounded, but it cannot guarantee semantic success after reconnection.

- `apps/mobile/lib/checkin-queue.ts`

Impact:

- queued check-ins may still fail because the underlying trip or QR validity has moved on
- the queue improves resilience but does not fully solve offline attendance correctness

This is an architectural limitation, not just an implementation mistake.

#### 4.6 Mobile has type safety but not evidence-rich runtime proof

There are backend and shared tests, but no visible mobile-specific automated test suite in the app itself.

- mobile test search returned no mobile test files under `apps/mobile`
- backend/shared tests exist under `apps/backend/src/lib/*.test.ts` and `packages/shared/src/utils/*.test.ts`

Impact:

- mobile regressions are currently caught mostly by type-checking and manual verification
- runtime behavior on Android/iOS devices remains under-proven

#### 4.7 Student realtime integrity is acceptable, but still fallback-heavy

The student side now joins the active trip room and polls every 30 seconds, but it does not have a fully explicit student event contract comparable to the driver kiosk.

- `apps/mobile/hooks/useStudentSocket.ts`
- `apps/mobile/hooks/useStudentHome.ts`

Impact:

- functional, but not elegant
- current behavior mixes socket-driven refresh and polling fallback

## 5. Contract Drift Between Docs and Code

### Verified drift

#### Socket registry drift

Docs:

- `docs/SOCKET_EVENT_REGISTRY.md`

Code:

- `apps/backend/src/modules/incidents/incidents.service.ts` emits `incident:reported`
- `apps/backend/src/modules/gps/gps.service.ts` emits `gps:position`
- `apps/backend/src/websocket/socket.ts` supports both canonical and legacy join/leave event names

Assessment:

- the doc is directionally useful but incomplete
- this is exactly the kind of drift that causes future frontend/backend integration pain

#### Mobile home shape drift

Docs:

- `frontend-spec.md`
- `mobile-app-architecture.md`
- `mobile-app-architecture-v2.md`

Code:

- `apps/backend/src/modules/student/student.routes.ts`
- `apps/mobile/hooks/useStudentHome.ts`

Assessment:

- the mobile UI model is richer than the current backend BFF
- the frontend now compensates locally, which is safer than breaking, but not a final contract state

#### Auth flow drift across docs and implementation maturity

Docs and readiness checklist indicate production-grade mobile auth intent, but the mobile UI still runs a mock-token exchange path.

- `docs/PRODUCTION_READINESS_CHECKLIST.md`
- `apps/mobile/app/(auth)/verify-otp.tsx`

Assessment:

- backend supports real Firebase verification
- client UX remains in an implementation-incomplete state

## 6. Security Analysis

### Verified strengths

- Admin auth:
  - httpOnly cookie model
  - session-version invalidation
  - CSRF validation on unsafe requests
  - `apps/backend/src/modules/auth/admin-auth.middleware.ts`
- Mobile auth:
  - JWT with issuer/audience validation
  - device binding
  - auth cache checks on websocket connect
  - `apps/backend/src/modules/auth/mobile-auth.service.ts`
  - `apps/backend/src/websocket/socket.ts`
- API headers / transport hardening:
  - request ids, HSTS in production, frame denial, no sniff, permissions policy
  - `apps/backend/src/app.ts`

### Verified security gaps

- Real mobile Firebase UI flow is not complete on-device.
  - `apps/mobile/app/(auth)/verify-otp.tsx`
- Production safety still depends on environment correctness.
  - `docs/PRODUCTION_READINESS_CHECKLIST.md`
  - `apps/backend/src/app.ts`

### Inferred risks

These are plausible risks, not confirmed exploits:

- doc drift can produce unsafe client implementations even when backend guards are correct
- timezone inconsistency can become a security-adjacent integrity issue where date-based guards behave differently than expected

## 7. Reliability / Operability Analysis

### Verified strengths

- readiness probes check both DB and Redis
  - `apps/backend/src/app.ts`
- websocket layer is Redis-adapted and auth-gated
  - `apps/backend/src/websocket/socket.ts`
- GPS pipeline includes heartbeat, delta compression, RTDB projection, Redis live state, and buffered persistence
  - `apps/mobile/tasks/gps.task.ts`
  - `apps/backend/src/modules/gps/gps.service.ts`
  - `apps/backend/src/jobs/gps-heartbeat.job.ts`
- runbooks exist for real incidents
  - `docs/runbooks/*`
- backend smoke/E2E artifacts exist
  - `docs/E2E_CRITICAL_PATHS.md`
  - `apps/backend/scripts/e2e-smoke.ts`

### Verified weaknesses

- mobile runtime confidence remains lower than backend confidence because there is no visible mobile automated test suite
- student-side realtime still depends partly on periodic refetch rather than a fully locked push contract

### Inferred risks

- Expo/device-specific regressions may escape type-checking
- reconnect edge cases on weak mobile networks are under-proven without device E2E

## 8. Completeness Matrix

| Subsystem | Status | Assessment |
|---|---|---|
| Backend core API | High | Route mounting, auth, errors, readiness, and domain modules are broadly in place. |
| Admin auth/security | High | Cookie auth, CSRF, session revocation, and MFA support are materially strong. |
| Mobile auth backend | High | Real verification path exists server-side with device binding and audit hooks. |
| Mobile auth frontend | Medium | Works for dev/integration, but on-device production OTP UX is incomplete. |
| Student attendance hot path | Medium-High | Check-in, wait-for-me, correction, self-report, and history routes exist; some UX/data richness is still partial. |
| Driver trip/kiosk flow | High | Assignment, start-trip, kiosk sockets, QR rotation, and trip summary are present and coherent. |
| GPS / live location | High | End-to-end design is strong across background task, backend ingest, Redis, RTDB, and sockets. |
| Admin live operations | Medium-High | Core live dashboard/realtime paths exist, but docs are not fully current with emitted events. |
| API contract docs | Medium | Better than before, but not yet fully authoritative. |
| Socket contract docs | Medium | Helpful, but already missing real emitted events. |
| Observability / runbooks | Medium-High | Runbooks and readiness exist; broader metric/alert proof is not fully visible in this audit. |
| Mobile automated testing | Low | No visible mobile test suite. |

## 9. Production Readiness Verdict

### Verdict

This system is not a toy and it is not architectural nonsense. It is viable, serious, and already better than many early-stage internal systems.

It is not yet fully industry-grade locked because the last mile is still incomplete in three areas:

1. mobile production auth UX
2. contract authority between docs, backend BFFs, and mobile consumers
3. runtime proof on real devices

### What is production-capable now

- backend core request handling
- admin security model
- driver trip and kiosk model
- GPS ingestion and live bus projection
- core attendance backend logic

### What still prevents a full-confidence launch

- mobile verify-OTP flow is still development-oriented on the client
- student home contract remains partially repaired on the frontend
- timezone-sensitive business logic is not fully standardized
- markdown contract docs are not yet strict enough to prevent integration drift
- mobile runtime validation is too manual

## 10. Prioritized Remediation Roadmap

### P0

1. Replace the mock-token mobile OTP UI flow with full Firebase phone-auth on-device.
   - `apps/mobile/app/(auth)/verify-otp.tsx`

2. Remove UTC date splitting from backend business logic and standardize on the shared IST helpers.
   - `apps/backend/src/modules/users/users.service.ts`
   - `apps/backend/src/modules/import/import.service.ts`
   - `apps/backend/src/modules/routes/routes.service.ts`
   - `packages/shared/src/utils/time.utils.ts`

3. Lock the student home BFF contract so the mobile app does not have to synthesize missing fields.
   - `apps/backend/src/modules/student/student.routes.ts`
   - `apps/mobile/hooks/useStudentHome.ts`

### P1

4. Update `docs/SOCKET_EVENT_REGISTRY.md` to reflect all real emitted events and accepted aliases.
   - include at least `incident:reported`, `gps:position`, and alias support in `apps/backend/src/websocket/socket.ts`

5. Add mobile E2E / device smoke coverage for:
   - login
   - session restore
   - driver start trip
   - QR refresh
   - student check-in
   - offline replay
   - history / correction flow

6. Enforce contract update discipline:
   - every route or socket change updates the relevant markdown doc in the same PR

### P2

7. Strengthen student realtime so refresh behavior depends less on generic polling.
8. Enrich mobile history / home data contracts to reduce frontend-derived placeholders.
9. Continue expanding operational metrics and alert validation in staging.

## 11. Verified vs Inferred Summary

### Verified

- mobile verify screen still uses mock-token exchange
- mobile home normalization layer is compensating for missing backend fields
- backend still has UTC date-splitting code in several business services
- socket registry markdown is missing real emitted events
- mobile has no visible automated test suite
- backend/app/socket/auth hardening is materially strong

### Inferred

- staging and device-level runtime confidence is lower than backend-only confidence
- future integration drift risk remains high unless docs become enforced contracts rather than helpful references

