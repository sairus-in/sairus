# Phase 1a — Auth/Policy Migration: Implementation Spec

> **Status:** Spec under refinement. No code written yet.
> **Scope:** The auth/policy slice of `FOUNDATION_PLAN.md` Phase 1, unbundled from multiSchema and `UniversityPerson` work.
> **Owner:** Platform engineering.
> **Last updated:** 2026-05-17.

---

## Why this is a separate phase

`FOUNDATION_PLAN.md` Phase 1 bundles four things that touch the same files but carry independent risk:

1. Auth/policy migration — mechanical, well-scoped, ~3–4 days.
2. Prisma `multiSchema` config + migration — high-blast-radius if it goes wrong, needs staging dry-run.
3. `UniversityPerson` canonical-human table — schema decision rippling through `Student`/`Driver`/`User`/`AdminUser` FKs.
4. Transport stub methods + FAIL surfacing — domain work that fits Phase 4 naturally.

Bundling means a bug in any one blocks all four. Unbundled, they ship independently. This doc covers (1) only. (2) and (3) get their own specs as Phase 1b / 1c.

---

## Reality check — actual migration surface

Raw count from `grep` on `apps/backend/src`: **22 occurrences of role-string comparisons across 12 files.** Most are legitimate role-typed dispatch and should **not** be migrated.

| File | Sites | Migrate? | Why |
|---|---|---|---|
| `lib/admin-access.ts` | 2 | No | This **is** the policy. Stays. |
| `modules/auth/auth.middleware.ts:133` | 1 | No | `requireRole` factory itself. |
| `modules/auth/admin-auth.middleware.ts:163,199` | 2 | No | `requireAdminRole` factory + COORDINATOR loader. |
| `modules/admin/admin.routes.ts:90,98,275,279` | 4 | No | Zod conditional schemas (COORDINATOR needs `department`, FACULTY needs `routeIds`). Form shape, not authz. |
| `modules/auth/admin-auth.routes.ts:36,44` | 2 | No | Same — form validation. |
| `modules/users/users.service.ts:159` | 1 | No | `existingUser.role !== 'STUDENT'` is a domain invariant. |
| `modules/auth/admin-auth.repository.ts:223` | 1 | No | Prisma write. |
| `websocket/socket.ts:64,202` | 2 | **Yes** | Driver kiosk handler. |
| `modules/users/users.routes.ts:109,131,133` | 3 | **Yes** | Coordinator scope filter. |
| `modules/auth/scopeCoordinator.ts:13` | 1 | **Yes** | Coordinator loader. |
| `modules/admin/admin.service.ts:190` | 1 | **Yes** | COORDINATOR check in service. |
| `modules/admin/reports.service.ts:44,65` | 2 | **Yes** | Report scope filter. |

**Real migration surface: ~10 sites.** The lint rule must be **scoped to `apps/backend/src/modules/**/*.routes.ts`** — blanket-banning `role ===` would force rewrites of legitimate code (Zod schemas, factories, domain invariants).

---

## Decisions locked

| Decision | Choice |
|---|---|
| Phase 1 scope | Auth/policy only (this doc). multiSchema + `UniversityPerson` deferred to 1b/1c. |
| MFA real flow | Built in this phase behind `auth.mfa_required` flag (default `false` prod, `true` for engineering accounts). |
| Mobile capabilities | STUDENT + DRIVER only. Faculty/staff/management added when classroom-attendance domain ships. |
| Parity testing | Script-based; mandatory after each batch of Commit 5 migrations. |
| Lint rule scope | Route files only (`apps/backend/src/modules/**/*.routes.ts`). |

---

## Target file layout

```
packages/shared/src/
├── auth/
│   ├── actor.ts            ← Actor, ActorType, ActorSource, ScopeContext
│   ├── capabilities.ts     ← Capability union (closed vocabulary)
│   └── index.ts
├── policy/
│   ├── decision.ts         ← Decision { allowed, reason, auditPayload }
│   ├── can.ts              ← policy.can(actor, capability, resource): Decision
│   ├── matrix.ts           ← capability → actor predicate map
│   ├── pii.ts              ← field sensitivity matrix + tier resolver
│   ├── serializers/
│   │   ├── student.ts      ← serializeStudent(actor, row)
│   │   ├── trip.ts
│   │   └── user.ts
│   └── index.ts
└── policy.ts               ← becomes shim; canAdmin delegates to policy.can; deleted Commit 8

apps/backend/src/spine/
└── auth/
    ├── resolve-actor.ts    ← Fastify preHandler: req.user → req.actor
    ├── actor-cache.ts      ← Redis-A backed, 5-min TTL, invalidation API
    └── index.ts
```

`packages/shared/src/policy.ts` (the existing 192-line `canAdmin`) stays alive through Commits 1–7 as a deprecation shim. Deleted Commit 8.

---

## Core contracts

```ts
// packages/shared/src/auth/actor.ts
export type ActorType = 'mobile_student' | 'mobile_driver' | 'admin' | 'system';

export interface ScopeContext {
  routeIds: readonly string[];
  departmentIds: readonly string[];
  busId?: string | null;
  tripId?: string | null;
}

export interface Actor {
  actorId: string;            // UserId or AdminId
  actorType: ActorType;
  capabilities: ReadonlySet<Capability>;
  scope: ScopeContext;
  sessionContext: {
    sessionId?: string;
    deviceId?: string;
    requestId: string;
  };
}
```

```ts
// packages/shared/src/auth/capabilities.ts
// Closed vocabulary, 46 capabilities. New capability = packages/shared PR + review.
// Naming convention: domain.resource.action
export type Capability =
  // ── Admin (31) — ports existing AdminAction values ────────────────────────
  | 'admin.command_center.view'
  | 'admin.dashboard.view'
  | 'admin.fleet_map.view'
  | 'admin.trip.view'
  | 'admin.trip.override'              // renamed from COORDINATOR_OVERRIDE (scope in predicate, not name)
  | 'admin.trip.end_manually'
  | 'admin.trip.assign_substitute'
  | 'admin.incident.view'
  | 'admin.incident.resolve'
  | 'admin.incident.escalate'
  | 'admin.message.view'
  | 'admin.message.send_to_driver'
  | 'admin.correction.review'
  | 'admin.gps_outage.review'
  | 'admin.attendance.manual_mark'
  | 'admin.attendance.export'
  | 'admin.attendance_report.view'
  | 'admin.defaulter.view'
  | 'admin.defaulter.notify'
  | 'admin.student.manage'
  | 'admin.student.bulk_import'
  | 'admin.route.manage'
  | 'admin.route.bulk_assign'
  | 'admin.bus.manage'
  | 'admin.driver.manage'
  | 'admin.import.view'
  | 'admin.import.retry'
  | 'admin.auth_provisioning.view'     // renamed from VIEW_PENDING_AUTH (Firebase auth provisioning queue)
  | 'admin.admin_user.invite'
  | 'admin.audit_log.view'
  | 'admin.security.view'
  // ── Mobile student (7) — scope-self enforced in policy predicate ──────────
  // Note: GET /student/home is actor-type guarded (mobile_student), no capability.
  | 'student.attendance.checkin'
  | 'student.attendance.verify_arrival'
  | 'student.attendance.skip_today'
  | 'student.wait_request.create'
  | 'student.correction.submit'        // /corrections; /correction-request is a 410 stub, no separate capability
  | 'student.history.view'
  | 'student.self_report.submit'
  // ── Mobile driver (8) ─────────────────────────────────────────────────────
  | 'driver.assignment.view'           // today-assignment, route-stops, my-trip
  | 'driver.trip.start'
  | 'driver.trip.end'
  | 'driver.trip.roster.view'
  | 'driver.attendance.manual_mark'    // distinct from admin.attendance.manual_mark (different audit story)
  | 'driver.gps.ping'
  | 'driver.delegate.manage'           // check/warning/activate/end — single workflow
  | 'driver.kiosk.operate';            // socket-side QR refresh
```

```ts
// packages/shared/src/policy/decision.ts
export interface Decision {
  allowed: boolean;
  reason: 'ok' | 'missing_capability' | 'out_of_scope' | 'resource_not_found' | 'forbidden';
  auditPayload: {
    actorId: string;
    actorType: ActorType;
    capability: Capability;
    resourceKind?: string;
    resourceId?: string;
    scopeMatch?: 'route' | 'department' | 'none';
  };
}
```

```ts
// packages/shared/src/policy/serializers/types.ts
// Universal mechanism for ALL entities. Tiers are an organizational pattern
// used when composing User-style declarations; not a runtime concept.

type ActorFieldSet<T> = Readonly<Record<ActorType, ReadonlyArray<keyof T>>>;

// Credential material — never serialized to any actor under any condition.
// Listed here as a registry; SafeFields<T> excludes them at compile time so
// declaring a credential field in any ActorFieldSet is a TS error.
type CredentialField =
  | 'passwordHash' | 'mfaSecretEncrypted' | 'passwordResetTokenHash'
  | 'inviteTokenHash' | 'fcmToken' | 'firebaseUid' | 'registeredDeviceId'
  | 'sessionVersion' | 'deviceBoundAt' | 'forcedReloginAt';

type SafeFields<T> = Exclude<keyof T, CredentialField>;
export type SafeActorFieldSet<T> = Readonly<Record<ActorType, ReadonlyArray<SafeFields<T>>>>;
```

```ts
// packages/shared/src/policy/serializers/user.ts
// Tiers expressed as composable arrays — organizational only, not runtime.
const PUBLIC     = ['id'] as const;
const ROSTER     = [...PUBLIC, 'name', 'role', 'rollNumber', 'department',
                    'year', 'isActive', 'createdAt'] as const;
const CONTACT    = [...ROSTER, 'phone', 'email', 'lastLoginAt'] as const;
const RESTRICTED = [...CONTACT, 'licenseNumber', 'authStatus', 'updatedAt',
                    'authProvisionError', 'authProvisionFailedAt',
                    'importSessionId', 'deactivatedAt',
                    'deactivatedById', 'deactivationReason'] as const;

export const userVisibleFields: SafeActorFieldSet<User> = {
  mobile_student: PUBLIC,       // scope-self enforced in serializer
  mobile_driver:  ROSTER,
  admin:          RESTRICTED,
  system:         RESTRICTED,
};
```

```ts
// packages/shared/src/policy/serializers/trip.ts
// Operational visibility — no tier nesting. Adds derived driverName for non-admin.
export const tripVisibleFields: SafeActorFieldSet<Trip> = {
  mobile_student: ['id', 'busId', 'routeId', 'status', 'startedAt', 'endedAt', 'gpsStatus'],
  mobile_driver:  ['id', 'busId', 'routeId', 'type', 'status', 'date',
                   'expectedCount', 'boardedCount', 'absentCount',
                   'startedAt', 'endedAt', 'gpsStatus', 'gpsOutageStart'],
  admin:          ['id', 'busAssignmentId', 'busId', 'routeId', 'driverId', 'type',
                   'status', 'date', 'expectedCount', 'boardedCount', 'absentCount',
                   'startedAt', 'endedAt', 'delegateId', 'gpsOutageStart',
                   'gpsStatus', 'createdAt', 'updatedAt'],
  system:         /* same as admin */,
};
```

```ts
// packages/shared/src/policy/serializers/serialize.ts
export function makeSerializer<T extends object>(
  fields: SafeActorFieldSet<T>,
  options?: {
    scopeSelf?: (actor: Actor, row: T) => boolean;
    derived?: (actor: Actor, row: T, ctx?: unknown) => Partial<Record<string, unknown>>;
  }
) {
  return (actor: Actor, row: T, ctx?: unknown): Partial<T> | null => {
    if (options?.scopeSelf && !options.scopeSelf(actor, row)) return null;
    const allowed = fields[actor.actorType] ?? [];
    const out: Partial<T> = {};
    for (const k of allowed) out[k] = row[k];
    return { ...out, ...(options?.derived?.(actor, row, ctx) ?? {}) };
  };
}

export const serializeUser = makeSerializer(userVisibleFields, {
  scopeSelf: (actor, row) =>
    actor.actorType !== 'mobile_student' || actor.actorId === row.id,
});

export const serializeTrip = makeSerializer(tripVisibleFields, {
  derived: (actor, _trip, ctx: { driverName: string }) =>
    actor.actorType !== 'admin' && actor.actorType !== 'system'
      ? { driverName: ctx.driverName }
      : {},
});
```

**Key design points (locked):**

- **Whitelist model.** Fields not declared in `userVisibleFields` are silently dropped — default-deny.
- **Compile-time credential safety.** `SafeActorFieldSet<T>` excludes `CredentialField`. Putting `passwordHash` in any actor's list is a type error before runtime.
- **One factory, all entities.** `makeSerializer<T>()` is the universal mechanism. Adding an entity = declare a `SafeActorFieldSet<T>` + optional scope-self predicate + optional derived fields. Zero serializer logic edits.
- **Driver denormalization.** `driverName: string` derived field for non-admin actors. Never nested `trip.driver: SerializedUser` — that pattern tempts call sites to grow CONTACT-tier joins for students.
- **No separate `Student` model.** The schema has `User` with `role` discriminator (schema.prisma:213). `serializeUser` covers all role types; the scope-self predicate handles "student can only see own row."

**Accepted residual risks (logged to `SECURITY_DEBT.md`):**

- Student can infer classmate absence from `expectedCount - boardedCount` after trip ends. Acceptable under current threat model. Revisit if classroom-attendance domain introduces stricter privacy regime.

---

## Commit sequence

| # | Files touched | Behavior change? | Rollback |
|---|---|---|---|
| **1** | `packages/shared/src/auth/*`, `packages/shared/src/index.ts` | None — type additions | `git revert` |
| **2** | `packages/shared/src/policy/*`, `policy.ts` (becomes shim) | None — `canAdmin` results identical via new code path | `git revert` |
| **3** | `apps/backend/src/spine/auth/resolve-actor.ts`, `actor-cache.ts`, `app.ts` registration | `req.actor` attached; no route reads it yet | `git revert`; perf-test on staging first |
| **4** | `packages/shared/src/policy/serializers/*` + tests | None — no route calls them yet | `git revert` |
| **5** | The ~10 real call sites | **Yes — authz paths change.** Run parity script. | Per-site revert; each site 2–8 lines |
| **6** | Route modules wired to serializers (one module per commit) | **Yes — response shapes shrink for non-admin actors.** | Per-module revert |
| **7** | Custom ESLint rule + CI grep, scoped to route files | None — gates new code | Disable rule |
| **8** | Delete `canAdmin`, `AdminAction`, `lib/admin-access.ts`; update `CLAUDE.md §4` | None if all sites migrated | `git revert`; type-check catches missed imports |

---

## Verification per commit

- **Commits 1–2:** `pnpm --filter shared test` + `pnpm --filter backend type-check` green.
- **Commit 3:** Synthetic `GET /v1/health/actor` returning resolved actor JSON. Hit on staging with sample mobile JWT and admin cookie. Verify shape. Delete endpoint at end of Phase 1a.
- **Commit 5 / 6:** Parity script — see "Parity script (Commit 5–6 safety net)" section below.
- **Commit 8:** Type-check sufficient.

---

## Actor cache (Commit 3)

- Storage: Redis-A (security-critical instance per `CLAUDE.md §8.1`).
- Key: `actor:{actorId}`.
- TTL: 5 min.
- Invalidation triggers (`await actorCache.invalidate(actorId)`):
  - `admin.service.ts` — `setScope()`
  - `users.service.ts` — `updateRole()`
  - `auth-revocation.ts` — `forceRelogin()`
  - `admin.service.ts` — `suspendAdmin()`
  - `auth.routes.ts` + `admin-auth.routes.ts` — logout
- Five sites, audited. No background invalidation sweep — 5-min TTL is the floor on staleness.

---

## MFA parallel track (does not block commit sequence)

| Step | Deliverable | Depends on |
|---|---|---|
| M1 | TOTP secret encryption + `AdminMfaSecret` model (partial via `admin-mfa.ts` today) | Commit 1 |
| M2 | `POST /v1/admin/mfa/enroll` returns provisioning URI + recovery codes | M1 |
| M3 | `POST /v1/admin/mfa/verify` in login flow, gated by `auth.mfa_required` flag | M2 |
| M4 | Admin SPA force-enrollment redirect when actor has admin capability but no MFA | M3 + Commit 6 |
| M5 | Flip `auth.mfa_required = true` for engineering accounts via per-actor flag override | M4 |
| M6 | Revert `admin-auth.middleware.ts:133` bypass; add `SECURITY_DEBT.md` entry | M5 |

M1–M3 run in parallel with Commits 1–4. M4 requires Commit 6 plumbing. M6 closes the §13 hard gate as a flag flip rather than a launch-week build.

---

## PR sequencing

1. **PR-1: Commits 1 + 2** — `packages/shared` types + policy module + shim. ~400 LoC, no behavior change. Establishes vocabulary; type checker enforces it everywhere from this point on.
2. **PR-2: Commit 3** — resolver + cache + synthetic health endpoint.
3. **PR-3..6: Commit 5 batches** — small per-module PRs migrating real call sites, each followed by parity-script run.
4. **PR-7..10: Commit 6 batches** — per-module serializer wiring.
5. **PR-11: Commit 7** — lint rule + CI grep.
6. **PR-12: Commit 8** — delete shim, update `CLAUDE.md`.

MFA PRs interleave whenever each step is ready.

---

## Open refinement TBD

The following need finalization before Commit 1 starts:

- [x] ~~Complete `Capability` enumeration~~ — **LOCKED.** 46 capabilities (31 admin + 7 student + 8 driver). See list above.
- [x] ~~PII matrix validation~~ — **LOCKED.** Universal `SafeActorFieldSet<T>` mechanism. User uses composed tiers (PUBLIC/ROSTER/CONTACT/RESTRICTED), Trip uses explicit per-actor lists. Credential material excluded at compile time. See contracts above.
- [x] ~~Parity script fixture actors and route sweep~~ — **LOCKED.** 8 actors, 15 routes, per-commit named baselines. See "Parity script" section below.
- [ ] Whether `system` actor type ships in Phase 1a (used for Cloud Tasks handlers) or in 1c. Current direction: defer to 1c; Cloud Tasks stays on `X-CloudTasks-Secret` middleware.
- [ ] Where the `auth.mfa_required` flag is read from before Phase 2's feature-flag system lands — env var as bootstrap?

## Parity script (Commit 5–6 safety net)

**Purpose:** Catch behavioral regressions in Commit 5b (10 real authz migrations) and detect serializer leaks in Commit 6. Not a full E2E framework — narrow scope.

**Layout:**

```
apps/backend/scripts/policy-parity/
├── parity.ts                        ← runner (capture | diff modes)
├── fixtures.json                    ← 8 fixture actors with pre-signed tokens
├── seed.ts                          ← idempotent DB seed (8 actors + supporting rows)
├── routes.ts                        ← 15-route sweep spec
└── baselines/
    ├── 00-pre-migration.json
    ├── 01-post-c5a-mechanical.json
    ├── 02-post-c5b-authz.json
    ├── 03-post-c6a-users.json
    └── ... (one per checkpoint)
```

**8 fixture actors:** `admin-transport-officer-broad`, `admin-coordinator-route1`, `admin-faculty-dept2`, `admin-management`, `mobile-student-1`, `mobile-driver-bus1`, `unauthenticated`, `invalid-token`. Auth artifacts pre-signed with `PARITY_JWT_SECRET` and committed — no login flow during tests.

**15-route sweep:**

- `GET /v1/users`, `GET /v1/users/:id` — coordinator filter + scope-coordinator
- `GET /v1/admin/dashboard`, `GET /v1/admin/ops/pending-auth`, `GET /v1/admin/ops/corrections`, `GET /v1/admin/audit-log` — `requireAction` shim validation
- `POST /v1/admin/students/:id/assign-route` — admin mutation w/ scope
- `GET /v1/admin/reports/attendance` — service-layer scope filter
- `POST /v1/attendance/corrections/:id/review`, `POST /v1/trips/:tripId/coordinator-override` — coordinator override paths
- `GET /v1/student/home` — mobile actor-type guard
- `POST /v1/attendance/checkin`, `GET /v1/attendance/history` — mobile capability + scope-self
- `GET /v1/driver/today-assignment`, `POST /v1/trips/:tripId/end` — driver capability + own-trip scope

**Out of scope:** Sockets (`socket.ts:64,202` — manual smoke during Commit 5b); load behavior; full E2E.

**Diff rules:**

- HTTP status — strict equality.
- Response body — strict by default. Commit 6 expects shape changes for non-admin actors; diff against previous baseline once for behavioral verification, then re-capture as the new baseline.
- Headers — only security-relevant compared (`set-cookie`, `www-authenticate`, `x-csrf-token`).

**Runner:**

```
pnpm tsx apps/backend/scripts/policy-parity/parity.ts capture --label 02-post-c5b-authz
pnpm tsx apps/backend/scripts/policy-parity/parity.ts diff --against 01-post-c5a-mechanical
```

**Seed:** Idempotent upsert of fixture actors + minimal supporting rows (route-1, route-2, bus-1, dept-2, sample trip, sample correction). Run before each capture.

**Not in CI for Phase 1a** — manual run gated by code review. ~120 requests per run, ~5 seconds.

## Additional findings during refinement

- **Admin SPA has its own capability layer.** `apps/admin/src/lib/capabilities.ts` calls `canAdmin(admin, 'VIEW_PENDING_AUTH')` etc. This file must be migrated alongside the backend in Commit 5/6. Adds frontend touch to those commits.
- **`POST /v1/attendance/correction-request` is a 410 deprecation stub** (`attendance.routes.ts:161-169`). Returns `{ error: 'ENDPOINT_DEPRECATED', canonical: '/v1/attendance/corrections' }`. Recommend a separate cleanup PR (out of Phase 1a scope) to delete the route entirely once mobile clients are confirmed to be on the canonical path.
- **`requireAction(request, 'VIEW_PENDING_AUTH')` pattern** (admin.routes.ts:819) is the in-route policy check call site that Commit 5 migrates. Grep for `requireAction(` to enumerate all 31 admin sites.

---

## Forbidden during Phase 1a

- Touching Prisma `schema.prisma` for anything other than the existing `canAdmin`-related work (kept stable to avoid coupling with 1b).
- Adding new capabilities without a `packages/shared` PR.
- Calling `req.user.role` in a route file after Commit 7 lands.
- Returning a Prisma row directly from a route after the relevant module's Commit 6 lands.
