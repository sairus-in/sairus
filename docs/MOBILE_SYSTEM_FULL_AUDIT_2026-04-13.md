# Mobile System Full Audit

Date: 2026-04-13

Scope: `apps/mobile`, `apps/backend`, `apps/admin`, `packages/shared`, workspace config, current API/realtime contracts, and the operational coupling between mobile, backend, and admin.

## Executive Summary

The mobile app is not ready for focused feature work yet. The largest blockers are not cosmetic; they are contract and lifecycle failures in the core student flow, auth/session handling, offline replay, delegation, and push delivery.

The most important conclusion is this:

1. The backend and shared packages are currently type-clean.
2. The admin app is currently type-clean.
3. The mobile app is not type-clean and its main student home flow is internally inconsistent.
4. Several cross-system contracts that mobile depends on are either wrong, stale, or only partially implemented.

That means the correct next move is not "start building new mobile features". The correct move is to stabilize the mobile platform layer and fix the broken contracts first.

## Audit Method

- Repo structure and package manifests were reviewed directly.
- Core runtime files were inspected in mobile, backend, admin, and shared.
- Package type-check status was verified with `pnpm.cmd --filter <pkg> type-check`.
- Focused sub-audits were delegated across mobile, backend/contracts, admin integration, and workspace/dependency configuration.

## Current Repo Shape

- Mobile app: `apps/mobile`
- Admin panel: `apps/admin`
- Backend API + websocket server: `apps/backend`
- Shared contracts/types/validators: `packages/shared`

Mobile depends on:

- JWT auth via `/v1/auth/*`
- student BFF via `/v1/student/home`
- attendance flows via `/v1/attendance/*`
- driver/delegation/trip flows via `/v1/driver/*` and `/v1/trips/*`
- push token registration via `/v1/users/fcm-token`
- Socket.IO realtime from backend
- Firebase RTDB for bus position

## Verified Build / Type State

- `backend`: type-check passes
- `admin`: type-check passes
- `shared`: type-check passes
- `mobile`: type-check fails

Primary mobile failures:

- `apps/mobile/app/(student)/index.tsx` is out of sync with `useStudentHome`, `TripScreenState`, `BusStatusCard`, `CheckInButton`, `StatCards`, and theme typings.
- `apps/mobile/hooks/useStudentHome.ts` references `query.data.meta`, but `StudentHomeResponseV3` does not expose that shape.
- `apps/mobile/lib/query-client.ts` uses dynamic import in a config that does not satisfy the current TypeScript module requirements in mobile.

This is the clearest signal in the audit: mobile is currently the unstable edge of the monorepo.

## Critical Findings

### 1. Student home screen is contract-broken inside the mobile app

Evidence:

- `apps/mobile/app/(student)/index.tsx`
- `apps/mobile/hooks/useStudentHome.ts`
- `apps/mobile/components/student/BusStatusCard.tsx`
- `apps/mobile/components/student/CheckInButton.tsx`
- `apps/mobile/components/student/StatCards.tsx`
- `apps/mobile/lib/trip-state.ts`

Problems:

- `index.tsx` passes props that child components do not accept.
- `index.tsx` branches on states that the current `TripScreenState` model does not define.
- `useStudentHome` only accepts `enabled`, but the screen passes additional query options.
- The home screen uses fields and theme tokens that no longer exist in the current typed layer.

Impact:

- The primary student landing screen is not a trustworthy base for new work.
- Feature work on top of this screen will compound drift instead of reducing it.

### 2. Push notification pipeline is wired to the wrong token type

Evidence:

- Mobile registration: `apps/mobile/lib/notifications.ts`
- Backend delivery: `apps/backend/src/jobs/notification.worker.ts`
- Token storage endpoint: `apps/backend/src/modules/users/users.routes.ts`

Problems:

- Mobile calls `Notifications.getExpoPushTokenAsync()` and stores that value in `fcmToken`.
- Backend push worker sends via Firebase Admin `sendEachForMulticast()` using `fcmToken`.
- Expo push tokens and Firebase registration tokens are not interchangeable.

Impact:

- Push delivery is unreliable or outright broken.
- Any mobile workflows depending on arrival verification, outage messaging, or alert fanout are operationally risky.

### 3. Offline check-in replay does not honor backend idempotency contract

Evidence:

- Queue implementation: `apps/mobile/lib/checkin-queue.ts`
- Backend contract: `apps/backend/src/modules/attendance/attendance.routes.ts`
- Shared rule: `packages/shared/src/schemas/common.ts`

Problems:

- Mobile sends `idempotencyKey` in the request body.
- Backend reads `Idempotency-Key` from the header.
- Shared contract explicitly says idempotency belongs in the header.
- Queue `init()` exists but is not clearly wired into startup recovery.

Impact:

- Offline replay can produce duplicate-processing risk.
- Cold-start recovery for pending scans is incomplete.
- This is directly relevant to the most business-critical student action in the app.

### 4. Delegation feature is broken across mobile routing, backend auth, and feature placement

Evidence:

- Mobile screen: `apps/mobile/app/(student)/delegate-takeover.tsx`
- Mobile hook: `apps/mobile/hooks/useDelegation.ts`
- Mobile role routing: `apps/mobile/app/_layout.tsx`
- Backend routes: `apps/backend/src/modules/trips/trips.routes.ts`

Problems:

- Mobile delegation screen is placed under the student route group.
- Root mobile routing sends `COORDINATOR`, `TRANSPORT_OFFICER`, `FACULTY`, `MANAGEMENT`, and `NCC_OFFICER` to `unsupported-role`.
- The delegation banner/flow assumes those staff roles should use the app.
- Backend guards `/:tripId/delegate/check`, `/:tripId/delegate/warning`, and `/:tripId/delegate/activate` with `adminRoute(...)`, not `mobileRoute(...)`.
- Only `/:tripId/delegate/end` is driver-mobile accessible.

Impact:

- The feature is effectively dead or inaccessible in the current system.
- This is not a single bug; it is a design-level persona mismatch.

### 5. Session lifecycle is brittle in mobile bootstrap and realtime handling

Evidence:

- Auth gate: `apps/mobile/app/_layout.tsx`
- API client: `apps/mobile/lib/api.client.ts`
- Socket singleton: `apps/mobile/lib/socket.ts`

Problems:

- Auth bootstrap marks a token as "synced" after non-auth fetch failures, which can pin the app on stale local session state after transient startup failures.
- Socket auth token is captured when the singleton is first created and is not refreshed when auth changes.
- Logout/401 handling clears local auth but does not fully reset socket lifecycle state.

Impact:

- Realtime state can drift from session state.
- Startup recovery is weaker than it appears.
- Auth bugs will be hard to reproduce because they depend on timing.

## High-Risk Cross-System Findings

### 6. Admin list handling is inconsistent with the shared response envelope

Evidence:

- Backend list envelope: `packages/shared/src/lib/response.ts`
- Backend user list route: `apps/backend/src/modules/users/users.routes.ts`
- Admin client: `apps/admin/src/lib/api.client.ts`
- Admin screens: `apps/admin/src/pages/students/StudentList.tsx`, `apps/admin/src/pages/students/UnassignedDrawer.tsx`
- Shared admin types: `packages/shared/src/types/admin-api.types.ts`

Problems:

- Backend returns list data as `success + data + pagination`.
- Admin client unwraps `response.data.data` and discards pagination globally.
- Admin screens still type list responses as `{ data, total, page, limit }`.
- Shared `AdminListResponse<T>` is stale versus the actual API envelope.

Impact:

- Admin list pagination and counts are unreliable.
- "Unassigned" mobile-support workflows in admin can show wrong state.
- This matters because admin is the control plane for mobile operations.

### 7. Admin realtime coverage does not match backend emitters

Evidence:

- Backend websocket emitters: `apps/backend/src/websocket/socket.ts`, `apps/backend/src/modules/gps/gps.service.ts`, `apps/backend/src/modules/incidents/incidents.service.ts`
- Admin listeners: `apps/admin/src/hooks/useAdminSocket.ts`
- Docs: `docs/SOCKET_EVENT_REGISTRY.md`, `docs/socket-coverage.md`

Problems:

- Backend emits `gps:position` to admin, but admin subscribes only to `gps:status`.
- Backend emits `incident:escalated`, but admin does not subscribe to it.
- Socket docs are behind the live event surface.

Impact:

- Admin ops can act on incomplete live state.
- Mobile/admin coordination during outages or incidents is degraded.

### 8. Socket room authorization is weaker than route authorization

Evidence:

- `apps/backend/src/websocket/socket.ts`

Problems:

- Socket auth verifies the user/session.
- After auth, room joins for `trip`, `bus`, and `route` are based on client-supplied IDs.
- There is no visible resource-level authorization before joining those rooms.

Impact:

- Authenticated clients may subscribe beyond their intended resource scope.
- This is more serious for admin/staff personas and any future mobile staff flows.

### 9. Role definitions drift across shared, backend, and mobile

Evidence:

- Shared schemas: `packages/shared/src/schemas/common.ts`
- Shared user types: `packages/shared/src/types/user.types.ts`
- Backend guards: `apps/backend/src/middleware/route-guards.ts`
- Mobile auth store and router: `apps/mobile/store/auth.store.ts`, `apps/mobile/app/_layout.tsx`

Problems:

- Shared `mobileRoleSchema` includes `PARENT`, but mobile app has no parent flow.
- Shared admin role enum uses `NCC`, while mobile/router and user typing use `NCC_OFFICER`.
- Persona boundaries are not modeled consistently.

Impact:

- Contract drift will continue to leak into auth, routing, and admin capability logic.
- New mobile work will keep tripping over role ambiguity until this is normalized.

## Configuration and Dependency Risks

### 10. Mobile package depends on undeclared runtime dependencies

Evidence:

- `apps/mobile/lib/firebase.ts` imports `firebase/*`
- `apps/mobile/lib/checkin-queue.ts` imports `uuid`
- `apps/mobile/package.json` does not declare `firebase` or `uuid`

Impact:

- Mobile currently relies on hoisting/transitive install behavior.
- Clean installs, CI, stricter package isolation, or future workspace changes can break mobile unexpectedly.

### 11. Mobile Expo config is still placeholder-grade

Evidence:

- `apps/mobile/app.json`

Problems:

- `owner` is still `YOUR_EXPO_USERNAME`
- `updates.url` is still placeholder
- `./assets/notification-icon.png` is referenced but not present

Impact:

- OTA/EAS update setup is not production-ready.
- Notification asset config is already invalid.

### 12. Mobile environment fallback strategy is unsafe

Evidence:

- `apps/mobile/lib/api.client.ts`
- `apps/mobile/lib/socket.ts`
- `apps/mobile/lib/firebase.ts`
- `apps/mobile/lib/notifications.ts`

Problems:

- API/socket fallback points to hardcoded LAN IP `http://10.147.55.103:3000`
- Firebase config silently falls back to empty strings
- Push project id is optional at runtime instead of validated

Impact:

- Behavior changes silently by environment.
- The app can "start" while critical infrastructure is misconfigured.

### 13. Shared package resolution strategy is inconsistent across apps

Evidence:

- Mobile TS config: `apps/mobile/tsconfig.json`
- Backend TS config: `apps/backend/tsconfig.json`
- Admin TS config: `apps/admin/tsconfig.json`
- Shared package manifest: `packages/shared/package.json`

Problems:

- Mobile resolves `shared` from source.
- Backend/admin resolve `shared` from `dist`.
- This creates different contract-consumption behavior across apps.

Impact:

- Drift can appear only in one app.
- Fresh clone/build order issues become more likely.

### 14. Root build pipeline does not meaningfully validate mobile

Evidence:

- Root scripts: `package.json`
- Turbo pipeline: `turbo.json`
- Mobile scripts: `apps/mobile/package.json`

Problems:

- Root `build` depends on package `build` tasks.
- Mobile does not expose a standard `build` task in the same way.
- In practice, monorepo build success does not prove mobile health.

Impact:

- CI can report healthy while the mobile app is broken.

## Security / Readiness Notes

### 15. Admin MFA enforcement is still not fully hardened

Prior code audit evidence confirms an explicit MFA bypass remains in the admin auth path. That is not a mobile bug, but it matters because the admin panel is the operational authority over mobile users, trips, incidents, and delegation actions.

### 16. Docs do not fully match live implementation

Evidence:

- `docs/SOCKET_EVENT_REGISTRY.md`
- `docs/socket-coverage.md`

Impact:

- Current docs cannot be treated as source of truth for mobile/backend/admin event behavior.
- Any new mobile work should reference code first, docs second.

## What Is Working Well

- Backend and shared packages type-check cleanly.
- Admin and backend are generally structured with clear route/service separation.
- Shared validators and response helpers are the right architectural direction.
- Student home has a proper BFF endpoint in `apps/backend/src/modules/student/student.routes.ts`.
- The repo already has useful focused tests in auth/security and selected contract areas.

## Main Gaps In Automated Coverage

Missing or weak areas:

- mobile screen-level tests
- mobile auth bootstrap tests
- mobile socket lifecycle tests
- mobile offline queue replay tests
- websocket event parity tests between backend emitters and client listeners
- contract tests for admin list envelope and pagination
- delegation end-to-end tests across persona boundaries

## Prioritized Action Plan

### Phase 0: Stop Feature Work And Stabilize Mobile Foundations

1. Fix `apps/mobile/app/(student)/index.tsx` so it matches the current hook/component contracts.
2. Align `useStudentHome`, `TripScreenState`, `BusStatusCard`, `CheckInButton`, and `StatCards`.
3. Make mobile type-check pass again before adding any new screen logic.

### Phase 1: Repair Cross-System Contracts

1. Decide the real push strategy:
   - either register Firebase tokens on device
   - or switch backend delivery to Expo push
2. Move offline idempotency to `Idempotency-Key` header.
3. Normalize list envelope handling in admin and shared types.
4. Update socket listener coverage for `gps:position` and `incident:escalated`.

### Phase 2: Fix Auth / Persona Model

1. Decide whether staff/delegate flows truly belong in mobile.
2. If yes, define supported staff personas and route groups explicitly.
3. If no, remove or park delegation UI from the mobile app until backend and routing support it.
4. Refresh socket auth state on login/logout/token changes.

### Phase 3: Normalize Config And Build Reliability

1. Add missing mobile runtime dependencies to `apps/mobile/package.json`.
2. Replace placeholder Expo config with real project values.
3. Fail fast when required mobile env vars are missing.
4. Standardize how all apps consume `shared`.
5. Add a mobile-validating CI task, not just backend/admin/shared checks.

### Phase 4: Add Quality Gates

1. Add mobile test coverage for auth bootstrap and student home rendering.
2. Add replay/idempotency tests for offline check-in.
3. Add websocket contract tests for emitted/listened event names.
4. Add end-to-end tests for the most critical student flow:
   - login
   - profile bootstrap
   - student home
   - check-in
   - realtime refresh

## Recommended Immediate Work Order For The Next Session

1. Fix mobile type errors and bring the student home flow back to a single coherent contract.
2. Correct push-token strategy and offline idempotency behavior.
3. Normalize admin list envelope handling and socket event coverage.
4. Decide the future of delegation in mobile before touching that feature again.

## Bottom Line

The admin panel hardening work moved the backend/admin side closer to production shape, but the mobile app is currently the least reliable part of the system. The main blockers are not performance issues; they are broken contracts, incomplete lifecycle handling, and unresolved persona boundaries.

If we use this audit as the baseline, the right next step is a mobile stabilization pass, not new feature expansion.
