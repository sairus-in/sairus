# Admin Panel Frontend + API Contract Audit

This document audits the `apps/admin` frontend and the backend/API contracts it depends on.

It is **not** a full end-to-end audit of the entire college bus management system.

It covers:
- Admin frontend pages, hooks, shells, and components
- Shared admin-facing types and policy/capability derivation
- Backend routes consumed by the admin panel
- Admin realtime/socket integration
- Query/cache/error-handling behavior affecting admin UX

---

## 1. API CONTRACT GAPS

[SEVERITY: HIGH]  
File: `apps/admin/src/lib/api.client.ts` line 40  
Call: all `api.get/post/put/patch/delete` wrappers  
Issue: every response is caller-asserted with `as unknown as Promise<T>`. There is no runtime validation at the API boundary, so every page/hook trusts backend payload shape blindly. This is the main contract weakness in the admin panel.  
Fix: add schema-backed decoding at the API layer, or at minimum centralize typed endpoint wrappers instead of raw `Promise<T>` casts.

[SEVERITY: HIGH]  
File: `apps/admin/src/pages/fleet/BusList.tsx` line 64  
Call: `api.put('/v1/fleet/buses/:id')`, `api.post('/v1/fleet/buses')`  
Issue: the frontend expects readable validation failures, but `apps/backend/src/modules/fleet/fleet.routes.ts` lines 39 and 47 still return raw Zod payloads instead of normalized `AppError` bodies. The page then reads `error?.response?.data?.error` at line 75, so real validation details are lost.  
Fix: throw `AppError(400, 'VALIDATION_ERROR', issues)` in fleet routes and switch the page to `extractApiError()`.

[SEVERITY: HIGH]  
File: `apps/admin/src/pages/fleet/DriverList.tsx` line 64  
Call: `api.put('/v1/fleet/drivers/:id')`, `api.post('/v1/fleet/drivers')`  
Issue: same contract problem as buses. `apps/backend/src/modules/fleet/fleet.routes.ts` lines 78 and 94 emit raw Zod errors; `DriverList.tsx` line 75 still parses legacy `data.error`.  
Fix: normalize backend validation failures and use `extractApiError()` in the page.

[SEVERITY: HIGH]  
File: `apps/admin/src/pages/ops/OperationsCenter.tsx` line 7  
Call: `api.get('/v1/admin/ops/import-sessions')`, `api.get('/v1/admin/ops/import-sessions/:id')`  
Issue: the page hardcodes local interfaces for import-session responses even though shared already defines import-session types in `packages/shared/src/types/admin-api.types.ts` line 285. The backend routes in `apps/backend/src/modules/admin/admin.routes.ts` lines 367 and 378 return raw Prisma-shaped records, so any serializer change will silently break this page.  
Fix: import shared types and ideally serialize these responses explicitly in the backend.

[SEVERITY: MEDIUM]  
File: `apps/admin/src/pages/routes/RouteEditor.tsx` line 9  
Call: `api.get('/v1/routes')`, `api.get('/v1/routes/:id')`, `api.get('/v1/routes/stops')`  
Issue: the page uses local `StopCatalogItem` and `RouteData` types instead of shared contracts, while `apps/backend/src/modules/routes/routes.routes.ts` lines 38 and 92 return raw Prisma objects. The optimistic-concurrency flow also depends on `updatedAt` being present and string-serializable.  
Fix: move these route/stop payloads into `shared`, validate them at the edge, and serialize routes explicitly on the backend.

[SEVERITY: MEDIUM]  
File: `apps/admin/src/pages/auth/Login.tsx` line 6  
Call: `api.post('/v1/admin/auth/login')`, `api.post('/v1/admin/auth/verify-mfa')`  
Issue: login redefines a local `LoginResponse` instead of using shared auth response types, and its error handling still reads `err?.response?.data?.message/code` at line 60. That works only because auth routes return mixed legacy/message/code shapes from `apps/backend/src/modules/auth/admin-auth.routes.ts` line 70.  
Fix: use shared auth response types end-to-end and route all failures through `extractApiError()`.

[SEVERITY: MEDIUM]  
File: `apps/admin/src/pages/students/BulkUploadWizard.tsx` line 18  
Call: `api.post('/v1/import/validate')`, `api.post('/v1/import/:sessionId/execute')`  
Issue: the page uses a custom `getErrorMessage()` parser instead of the normalized API error contract, even though `apps/backend/src/modules/import/import.routes.ts` line 30 now throws `AppError('VALIDATION_ERROR', issues)`.  
Fix: replace the local parser with `extractApiError()`.

[SEVERITY: MEDIUM]  
File: `apps/admin/src/pages/students/UnassignedDrawer.tsx` line 34  
Call: `api.post('/v1/users/assign-bulk')`  
Issue: the request shape matches `apps/backend/src/modules/users/users.routes.ts` line 202, but the error path still assumes legacy `data.error` at line 46.  
Fix: switch to `extractApiError()` so normalized validation details surface correctly.

---

## 2. MISSING ENDPOINTS

No missing frontend endpoints were found. Every `api.get/post/patch/put/delete` call in `apps/admin/src` has a matching backend route.

Files requested for review but missing on disk:
- `packages/shared/src/capabilities.ts`
- `apps/admin/src/lib/status.ts`

---

## 3. RESPONSE SHAPE DRIFT

- The backend still mixes plain payloads and wrapped payloads for adjacent resources. Examples:
  - `apps/backend/src/modules/admin/admin.routes.ts` line 83 returns plain stats from `/live/dashboard`, while line 97 returns `{ success, data }` from `/stats`.
  - `apps/backend/src/modules/admin/admin.routes.ts` line 105 returns plain trips from `/live/trips/active`, while line 112 returns `{ success, data }` from `/active-trips`.
  - `apps/backend/src/modules/admin/admin.routes.ts` line 142 returns a plain correction array, while `apps/backend/src/modules/attendance/attendance.routes.ts` line 308 returns `{ success, data }` for another correction list.

- Legacy raw-error bodies still exist outside the routes already normalized:
  - `apps/backend/src/modules/routes/routes.routes.ts` lines 62, 79, 100, 108, 138
  - `apps/backend/src/modules/fleet/fleet.routes.ts` lines 39, 47, 78, 94
  - `apps/backend/src/modules/gps/gps.routes.ts` lines 27, 37
  - `apps/backend/src/modules/attendance/attendance.routes.ts` line 63
  - `apps/backend/src/modules/incidents/incidents.routes.ts` line 27
  - `apps/backend/src/modules/trips/trips.routes.ts` has older legacy error responses as well

- Because `apps/admin/src/lib/api.client.ts` line 35 globally unwraps `response.data`, pages that still expect Axios-like objects or legacy `error/message` bodies remain brittle.

- `apps/admin/src/pages/routes/RouteEditor.tsx` line 125 assumes `updatedAt` exists and is stable enough for concurrency control; that currently works only because raw Prisma serialization is leaking directly to the frontend.

- `apps/admin/src/pages/fleet/BusList.tsx` line 140 and `apps/admin/src/pages/fleet/DriverList.tsx` line 130 treat `isActive` as always present. That matches current backend selects, but there is no serializer contract enforcing it.

---

## 4. LOADING AND ERROR STATE COVERAGE

| Page | Loading | Error | Empty state | Uses extractApiError |
|---|---|---|---|---|
| `apps/admin/src/pages/auth/Login.tsx` | ❌ | ✅ | n/a | ❌ |
| `apps/admin/src/pages/auth/Security.tsx` | ✅ | ✅ | n/a | ✅ |
| `apps/admin/src/pages/ops/Dashboard.tsx` | ✅ | ❌ | ✅ | ✅ |
| `apps/admin/src/pages/ops/FleetMap.tsx` | ✅ | ❌ | ❌ | n/a |
| `apps/admin/src/pages/ops/TripDetail.tsx` | ✅ | ❌ | ✅ | ❌ |
| `apps/admin/src/pages/ops/Incidents.tsx` | ✅ | ❌ | ✅ | ❌ |
| `apps/admin/src/pages/ops/Messages.tsx` | ✅ | ❌ | ✅ | ✅ |
| `apps/admin/src/pages/ops/OperationsCenter.tsx` | ✅ | ❌ | ✅ | ❌ |
| `apps/admin/src/pages/ops/GPSOutageQueue.tsx` | ✅ | ✅ | ✅ | ❌ |
| `apps/admin/src/pages/data/AttendanceReports.tsx` | ❌ | ❌ | ✅ | ❌ |
| `apps/admin/src/pages/corrections/index.tsx` | ✅ | ❌ | ✅ | n/a |
| `apps/admin/src/pages/students/StudentList.tsx` | ✅ | ❌ | ❌ | ✅ |
| `apps/admin/src/pages/routes/RouteEditor.tsx` | ✅ | ❌ | ✅ | ✅ |
| `apps/admin/src/pages/fleet/BusList.tsx` | ✅ | ❌ | ❌ | ❌ |
| `apps/admin/src/pages/fleet/DriverList.tsx` | ✅ | ❌ | ❌ | ❌ |

Notes:
- `Dashboard.tsx` has mutation error UI but no top-level query error UI.
- Several pages handle loading and empty states but silently fail if the query itself errors.
- `AttendanceReports.tsx` is especially weak: no explicit loading state and no explicit error state.

---

## 5. TYPE SAFETY GAPS

- `apps/admin/src/lib/api.client.ts` line 40: all API responses are unsafe casts, not validated payloads.
- `apps/admin/src/pages/ops/OperationsCenter.tsx` line 7: local import-session interfaces duplicate shared definitions already present in `packages/shared/src/types/admin-api.types.ts`.
- `apps/admin/src/pages/routes/RouteEditor.tsx` line 9: local route/stop interfaces should live in `shared`.
- `apps/admin/src/pages/students/BulkUploadWizard.tsx` line 18: custom error casting instead of shared API error typing.
- `apps/admin/src/components/shared/RequireCapability.tsx` line 7: `keyof Capabilities` includes non-boolean fields (`routeScope`, `departmentScope`, `dataScope`), so the prop type is broader than the component’s actual contract.
- `apps/admin/src/pages/ops/TripDetail.tsx` lines 229 and 434, `apps/admin/src/pages/ops/Incidents.tsx` lines 287 and 315, `apps/admin/src/hooks/useAdminSocket.ts` line 36: `as any` is used to bypass status typing.
- `apps/backend/src/modules/users/users.routes.ts` line 90: `whereClause: any` weakens backend contract confidence for the student list surface.
- `apps/admin/src/hooks/useReports.ts`, `useCommandCenter.ts`, `useActiveTrips.ts`, `useIncidents.ts`: exported hooks rely on inferred return types instead of explicit public hook signatures.

---

## 6. UI/UX GAPS

- `apps/admin/src/App.tsx` lines 39 and 115: the degraded-session banner is not enough on a hard refresh. If the backend is down and the store is empty, `RequireAdminSession` still redirects to `/login`, so the “session is intact” promise is false in the exact scenario it was meant to protect.
- `apps/admin/src/shells/LiveOpsShell.tsx` line 85: “Switch to Data Admin” is always visible, even for roles that will land on access-denied routes.
- `apps/admin/src/shells/AdminDataShell.tsx` line 77: “Switch to Live Ops” is always visible, even if the target role cannot view the destination.
- `apps/admin/src/components/ops/CommandPalette.tsx` line 26: hardcoded page targets ignore capabilities and can send users to dead ends.
- `apps/admin/src/pages/ops/Dashboard.tsx` line 445, `TripDetail.tsx` line 265, `Incidents.tsx` line 331: action buttons are capability-disabled, not capability-hidden. Functionally safe, but noisy for constrained roles.
- `apps/admin/src/pages/fleet/BusList.tsx` line 67, `DriverList.tsx` line 67, `StudentList.tsx` line 104, `RouteEditor.tsx` line 168: saves have error banners but no success confirmation.
- `apps/admin/src/pages/ops/FleetMap.tsx` line 39: Google Maps load failure only logs to console; there is no user-visible fallback.
- `apps/admin/src/pages/data/AttendanceReports.tsx` line 18: hardcoded March 2026 defaults are stale and surprising.
- `apps/admin/src/pages/students/BulkUploadWizard.tsx` line 53: no column-schema validation before hitting the backend; users only discover mapping problems during API preview.
- `apps/admin/src/lib/status.tsx` line 5: mojibake glyphs are visible, and `RESOLVED` is mislabeled as “Active” at line 35.

---

## 7. WEBSOCKET / REALTIME COVERAGE

From `apps/admin/src/hooks/useAdminSocket.ts`:

Socket listens to:
- `checkin:success`
- `gps:status`
- `trip:started`
- `trip:ended`
- `outage:escalation`
- `trip:absent_finalized`
- `admin:message`

Coverage notes:
- `apps/admin/src/shells/LiveOpsShell.tsx` mounts the socket globally for Live Ops pages only.
- Pages that benefit today:
  - Dashboard
  - Messages
  - TripDetail
  - Incidents
  - GPSOutageQueue
  - FleetMap
- Pages that do not get direct realtime coverage but arguably should:
  - `pages/corrections/index.tsx` still polls every 15s
  - Attendance reporting and Operations Center are polling-only
- Missing event coverage:
  - no explicit incident-created event handling
  - no explicit incident-resolved event handling
  - no correction-created / correction-reviewed event handling
- No degraded socket UI exists; the code mostly relies on reconnect behavior and console logging.
- Connection handling is technically resilient:
  - reconnect enabled in `apps/admin/src/lib/socket.ts`
  - admin room rejoin on connect/reconnect
  - cleanup on logout in `apps/admin/src/lib/session.ts`
- Client/server payload for trip room join now matches; the current socket layer is compatible.

---

## 8. REACT QUERY USAGE

- Query keys are inconsistent and partially unnamespaced:
  - `['live', 'alerts']` in `useAlerts.ts`
  - `['ops-rail-alerts']` in `OpsEventRail.tsx`
  - `['report-overview', ...]` and `['report-status', ...]` in `useReports.ts`
  - `['fleet-buses']`, `['fleet-drivers']`, `['trip-students', tripId]`, `['trip-timeline', tripId]`

- Duplicate queries hit the same endpoint with different keys:
  - `apps/admin/src/hooks/useAlerts.ts`
  - `apps/admin/src/components/ops/OpsEventRail.tsx`

- Invalidation gaps:
  - `apps/admin/src/hooks/useCorrections.ts` line 39 invalidates `['live', 'dashboard']` but not `['live', 'command-center']`, so the command center can stay stale after correction review.
  - `apps/admin/src/hooks/useGpsOutages.ts` line 31 misses `['live', 'command-center']`; local pages work around it inconsistently.

- Cache policy is minimal:
  - `apps/admin/src/lib/query-client.ts` line 6 disables `refetchOnWindowFocus` globally, which is questionable for live operations views.
  - Live pages compensate with polling, but reporting/static pages would benefit from more explicit stale-time tuning.

- Polling remains active even where sockets already exist:
  - `apps/admin/src/hooks/useMessages.ts` still polls every 5 seconds even though `admin:message` invalidation exists.

- Capability-aware query execution is mixed:
  - Route-level guards prevent most unauthorized page queries.
  - `apps/admin/src/components/ops/CommandPalette.tsx` still loads active trips whenever authenticated, regardless of page capability context.

---

## 9. PRIORITY FIX LIST

### P0 — Broken

- `apps/admin/src/App.tsx`: rework bootstrap/session gating so a backend outage on hard refresh shows degraded mode instead of redirecting to `/login`. This is currently the main end-to-end behavior bug.
- `apps/admin/src/lib/status.tsx`: fix corrupted glyphs and the incorrect `RESOLVED` label. This is visibly wrong in multiple pages.

### P1 — High

- Finish the error-normalization sweep and use `extractApiError()` everywhere:
  - `apps/admin/src/pages/auth/Login.tsx`
  - `apps/admin/src/pages/ops/TripDetail.tsx`
  - `apps/admin/src/pages/ops/Incidents.tsx`
  - `apps/admin/src/pages/ops/OperationsCenter.tsx`
  - `apps/admin/src/pages/students/UnassignedDrawer.tsx`
  - `apps/admin/src/pages/students/BulkUploadWizard.tsx`
  - `apps/admin/src/pages/fleet/BusList.tsx`
  - `apps/admin/src/pages/fleet/DriverList.tsx`

- Finish converting legacy backend error bodies to `AppError`:
  - `apps/backend/src/modules/routes/routes.routes.ts`
  - `apps/backend/src/modules/fleet/fleet.routes.ts`
  - `apps/backend/src/modules/gps/gps.routes.ts`
  - `apps/backend/src/modules/attendance/attendance.routes.ts`
  - `apps/backend/src/modules/incidents/incidents.routes.ts`
  - `apps/backend/src/modules/trips/trips.routes.ts`

- Capability-filter navigation targets, not just sidebars:
  - `apps/admin/src/shells/LiveOpsShell.tsx`
  - `apps/admin/src/shells/AdminDataShell.tsx`
  - `apps/admin/src/components/ops/CommandPalette.tsx`

### P2 — Medium

- Replace local DTOs with shared contracts:
  - `apps/admin/src/pages/ops/OperationsCenter.tsx`
  - `apps/admin/src/pages/routes/RouteEditor.tsx`

- Stop caller-asserting `Promise<T>` and add runtime validation/decoding:
  - `apps/admin/src/lib/api.client.ts`

- Normalize query keys and invalidation strategy:
  - `apps/admin/src/hooks/useCorrections.ts`
  - `apps/admin/src/hooks/useGpsOutages.ts`
  - `apps/admin/src/components/ops/OpsEventRail.tsx`
  - `apps/admin/src/hooks/useReports.ts`

- Add first-class query error states:
  - `apps/admin/src/pages/ops/Messages.tsx`
  - `apps/admin/src/pages/ops/TripDetail.tsx`
  - `apps/admin/src/pages/ops/Incidents.tsx`
  - `apps/admin/src/pages/data/AttendanceReports.tsx`

### P3 — Low

- Replace hardcoded March 2026 defaults with dynamic dates:
  - `apps/admin/src/pages/data/AttendanceReports.tsx`

- Improve config-failure fallbacks and remove demo/default assumptions:
  - `apps/admin/src/pages/ops/FleetMap.tsx`
  - `apps/admin/src/lib/firebase.ts`

- Tune cache policy per surface instead of one global default:
  - `apps/admin/src/lib/query-client.ts`

- Reduce polling or disable it once websocket invalidation is trusted:
  - `apps/admin/src/hooks/useMessages.ts`

---

## 10. OTHER FINDINGS

- `packages/shared/src/capabilities.ts` is missing. The live code derives capabilities from `packages/shared/src/policy.ts` plus `apps/admin/src/lib/capabilities.ts`.
- `apps/admin/src/lib/status.ts` is missing; the actual file is `apps/admin/src/lib/status.tsx`.
- `apps/admin/src/components/TripCard.tsx` appears to be stale/legacy UI alongside `apps/admin/src/components/ops/TripCard.tsx`. It is worth checking whether the root-level file should be removed.
- `apps/admin/src/hooks/useDashboard.ts` appears to be effectively obsolete for the current command-center-driven dashboard.
- `apps/admin/src/hooks/useAlerts.ts` and `apps/admin/src/components/ops/OpsEventRail.tsx` duplicate alert fetching logic and should likely be consolidated.
- `apps/backend/src/modules/admin/admin.routes.ts` is currently the cleanest backend/frontend contract surface in the repo and should be treated as the model for other modules.
- `apps/backend/src/lib/errors.ts` supports both old and new constructor signatures, which is why the migration currently works incrementally.

---

## Backend Contract Coverage Notes

Reviewed and relevant to admin-facing contracts:
- `apps/backend/src/app.ts`
- `apps/backend/src/modules/auth/admin-auth.routes.ts`
- `apps/backend/src/modules/admin/admin.routes.ts`
- `apps/backend/src/modules/users/users.routes.ts`
- `apps/backend/src/modules/import/import.routes.ts`
- `apps/backend/src/modules/trips/trips.routes.ts`
- `apps/backend/src/modules/fleet/fleet.routes.ts`
- `apps/backend/src/modules/driver/driver.routes.ts`
- `apps/backend/src/modules/routes/routes.routes.ts`
- `apps/backend/src/modules/gps/gps.routes.ts`
- `apps/backend/src/modules/attendance/attendance.routes.ts`
- `apps/backend/src/modules/incidents/incidents.routes.ts`
- `apps/backend/src/modules/jobs/jobs.routes.ts`
- `apps/backend/src/lib/errors.ts`
- `packages/shared/src/index.ts`
- `packages/shared/src/policy.ts`

Additional observations:
- `apps/backend/src/modules/auth/admin-auth.routes.ts`: auth endpoints are mostly internally consistent. `login` and `verify-mfa` return wrapped `{ success, data }`, while `/me` returns a plain session payload.
- `apps/backend/src/modules/trips/trips.routes.ts`: not used directly by the admin frontend, but still emits legacy validation/error responses and mixed wrappers.
- `apps/backend/src/modules/driver/driver.routes.ts` and `jobs.routes.ts`: reviewed, but no direct admin contract blockers found.

---

## Frontend File Coverage Notes

Reviewed under `apps/admin/src`:
- `lib/api.client.ts`
- `lib/api-error.ts`
- `lib/capabilities.ts`
- `lib/query-client.ts`
- `lib/session.ts`
- `lib/socket.ts`
- `lib/firebase.ts`
- `lib/status.tsx`
- `store/auth.store.ts`
- `App.tsx`

Hooks reviewed:
- `useActiveTrips.ts`
- `useAdminSocket.ts`
- `useAlerts.ts`
- `useCommandCenter.ts`
- `useCorrections.ts`
- `useDashboard.ts`
- `useGpsOutages.ts`
- `useIncidents.ts`
- `useMessages.ts`
- `useReports.ts`
- `useTripDetail.ts`

Shells reviewed:
- `LiveOpsShell.tsx`
- `AdminDataShell.tsx`

Pages reviewed:
- `pages/auth/Login.tsx`
- `pages/auth/Security.tsx`
- `pages/ops/Dashboard.tsx`
- `pages/ops/FleetMap.tsx`
- `pages/ops/TripDetail.tsx`
- `pages/ops/Incidents.tsx`
- `pages/ops/Messages.tsx`
- `pages/ops/OperationsCenter.tsx`
- `pages/ops/GPSOutageQueue.tsx`
- `pages/data/AttendanceReports.tsx`
- `pages/corrections/index.tsx`
- `pages/students/StudentList.tsx`
- `pages/students/UnassignedDrawer.tsx`
- `pages/students/BulkUploadWizard.tsx`
- `pages/routes/RouteEditor.tsx`
- `pages/fleet/BusList.tsx`
- `pages/fleet/DriverList.tsx`

Components reviewed:
- `components/shared/RequireCapability.tsx`
- `components/shared/ConfirmWithImpactModal.tsx`
- `components/ops/CommandPalette.tsx`
- `components/ops/AlertDropdown.tsx`
- `components/ops/OpsEventRail.tsx`
- `components/ops/CorrectionCard.tsx`
- `components/ops/AlertStrip.tsx`
- `components/ops/StatCard.tsx`
- `components/ops/TripCard.tsx`
- `components/TripCard.tsx`

---

## Scope Clarification

This is an **Admin Panel + Admin-Facing API Contract Audit**.

It is **not** a full-system audit of:
- mobile/student/driver end-user apps
- all backend modules equally
- infra/runtime outside admin-facing behavior
- every end-to-end workflow in the full bus system

It **does** include backend modules where they affect the admin panel directly.
