# Foundation Plan — College Platform

> **Status:** Direction agreed. Implementation plan.
> **Scope:** Foundation work that must complete before any new domain launches.
> **Model:** Modular monolith. One DB. One backend. Right-sized for one university (~13k users, 300 buses).
> **Last updated:** 2026-05-17.

---

## Guiding principles

1. **Right-size, don't enterprise-size.** This is a university operations platform, not a governance engine. Clean modular monolith is enough. No event sourcing, no read-models, no DLQs, no replay engines.
2. **Foundation work and transport hardening happen together, not in parallel.** They touch the same files. Doing them sequentially in one commit per concern is cleaner than two engineers stepping on each other.
3. **Every phase ends with the system in a deployable, working state.** No half-migrated middle states left on `main` overnight.
4. **The win condition is faculty adoption and operational trust, not architectural elegance.** Foundation exists to make domain launches safer and the code survivable — nothing more.
5. **Cut before you build.** If a piece of foundation work doesn't have a concrete domain that will use it within 3 months, defer it.

---

## What this plan deliberately does NOT include

To stay honest about scope:

- **No outbox table, event bus, or DLQ.** Cross-domain side effects use direct service calls within the same backend.
- **No replay infrastructure.** Not needed at this scale.
- **No workflow/OD domain.** Already cut. Stays cut.
- **No domain event registry document.** Code is the registry.
- **No chaos testing, no consumer lag dashboards, no event versioning infra.**
- **No formal "seven-layer spine."** Foundation is four practical concerns, not a philosophy.
- **No second backend, no microservices, no separate uni-admin Fastify.** One binary serves both admin SPAs.

These can be added later if a real scaling reason appears. None of them are needed now.

---

## The four foundation concerns

| # | Concern | What it provides | Why now |
|---|---|---|---|
| 1 | **Auth + Policy** | Single `Actor` model, capability-based `policy.can()`, PII-aware serializers | Stops role checks from sprawling across 70 files as faculty/driver/admin paths multiply |
| 2 | **Data discipline** | Schema namespacing, canonical UUIDs, `createdAt`/`updatedAt` everywhere, no cross-schema joins | Prevents hidden coupling between domains before classroom + announcements code lands |
| 3 | **SIS integration boundary** | One adapter file, inbound nightly sync, outbound daily push with idempotency, conflict policy documented | SIS is the one external system that can corrupt our data unrecoverably; cheapest insurance to buy now |
| 4 | **Operational basics** | Feature flags with per-domain kill switches, structured logging with correlation IDs, Sentry on three surfaces, four SLO dashboards, institutional-trace endpoint | Lets us deploy a new domain feature, watch it in production, and roll it back without paging anyone |

That's it. Anything else is overengineering for this stage.

---

## Phase 1 — Auth + Policy + Data Hygiene

**Goal:** Every authenticated request resolves to a typed `Actor`. Every authorization check goes through `policy.can()`. Every existing table lives in its correct schema with canonical UUIDs.

This phase is intentionally the heaviest. It touches every existing module. Once it's done, the rest of the foundation work bolts on without re-touching domain code.

### Deliverables

**Auth normalization**
- `Actor` type in `packages/shared/auth/` with `actorId`, `actorType`, `capabilities`, `scopes`, `sessionContext`
- Single auth middleware in `apps/backend/src/spine/auth/` that resolves cookie/JWT → `Actor` and attaches to request context
- `Capability` enum as a closed vocabulary; new capabilities require shared-package PR review
- MFA flow actually built end-to-end, gated behind `auth.mfa_required` flag (default `false` in prod, `true` for engineering accounts immediately)
- `SECURITY_DEBT.md` entry tracks current bypass; the bypass itself is replaced with the flagged real flow

**Policy layer**
- `policy.can(actor, action, resource): Decision` in `packages/shared/policy/`
- `Decision` includes `allowed`, `reason`, and `auditPayload` — not just a boolean
- PII sensitivity matrix declared as data: each student/person field tagged `PUBLIC | ROSTER | CONTACT | RESTRICTED`
- `policy.serializeStudent(actor, row)`, `policy.serializeTrip(actor, row)` etc. — the only paths through which entity data leaves the backend
- Every existing route migrated to `policy.can()`; lint rule blocks `actorType ===` and `role ===` in route files

**Data discipline**
- Prisma `multiSchema` preview enabled; schemas: `identity`, `transport`, `academic`, `comms`, `platform`
- One mechanical migration moves all existing models into their schemas
- Audit pass: every table has `createdAt`, `updatedAt`, UUID primary key
- `UniversityPerson` table created as the canonical human (one row per real person), with `sisPersonId` as the integration key — separate from any role-specific tables
- Existing `User`, `Student`, `Driver`, `AdminUser` tables refactored to reference `UniversityPerson.personId` (or scheduled to be in a follow-up if too risky in this phase)
- CI lint rule: no cross-schema Prisma `include` chains

**Transport-side work folded in**
- The 5 stub read methods in `attendance.service.ts` implemented while touching transport for policy migration
- FAIL log surfacing in admin corrections queue (touches transport admin routes that are getting policy migration anyway)

### Exit criteria

- Zero direct role checks anywhere in route handlers (CI-enforced)
- Every route returns entity data through a `policy.serializeX()` call
- MFA flow works end-to-end for engineering accounts in staging
- All Prisma migrations apply cleanly to a staging clone of production data
- Existing e2e smoke tests pass
- `CLAUDE.md` updated with the auth + policy + schema invariants

### Estimated effort

2–3 weeks. Heavy because it touches every existing route. The policy migration is the long tail — budget for it.

---

## Phase 2 — Operational Basics

**Goal:** Make it safe to deploy. Make it possible to debug across domains. Make it trivial to turn things off.

This phase is fast because it's mostly new code in `spine/` rather than refactoring existing modules. Most of it can ship behind their own kill switches.

### Deliverables

**Feature flags**
- `FeatureFlag` table in `platform` schema: `key`, `enabled`, `audience` (JSON for role/department/userId targeting), `description`, `updatedAt`, `updatedBy`
- `flags.isEnabled(flagKey, actor): boolean` client in `packages/shared/flags/`
- Per-domain master kill switches: `transport.enabled`, `academic.enabled`, `comms.enabled` — checked at the route group level
- Flag changes propagate via Redis-B pub/sub (instant invalidation across Cloud Run instances)
- Simple admin UI to flip flags (one page in existing bus-admin SPA, accessible to admin role only)
- `FEATURE_FLAGS_BOOT_OVERRIDE` env var for break-glass at startup

**Structured logging**
- Logger wrapper in `packages/shared/logging/` that requires `domain`, `module`, `correlationId` on every line
- `correlationId` propagation: mobile generates per user action → sent in `X-Correlation-Id` header → backend extracts and attaches to logger context → all downstream service calls carry it
- Cloud Logging sink configured; old unstructured logs deprecated
- Sentry SDK wired in backend (Fastify hook), admin SPA (React error boundary), mobile (Expo Sentry); `domain` tag set on every event

**SLO dashboards**
- Four Cloud Logging dashboards, one per domain (Transport, Academic stub for now, Comms stub for now, Platform/Spine)
- Transport SLOs go live now: check-in latency P95/P99, GPS ping ingestion rate, RTDB write latency, FCM delivery rate
- Alert policies: P95 latency >2× baseline for 5 min, error rate >1% for 5 min, FCM delivery rate <90%

**Institutional-trace endpoint**
- `GET /v1/admin/trace?personId=X&date=Y` returns: sessions the person should have attended, bus trips they were on, FCM pushes sent, admin overrides on their records, audit events
- Admin-only, capability-gated
- Returns within 2 seconds for any (person, date) pair
- This is built now because it pays back the moment the dean asks the first question

**Transport-side work folded in**
- FCM-vs-Expo push token mismatch fixed (touches notifications wiring being structured anyway)
- Bus position cached in Redis-B with 2s TTL (touches `gps.service.ts` being instrumented anyway)
- `/v1/admin/attendance/reconcile?date=...` endpoint added

### Exit criteria

- Every log line has `domain`, `module`, `correlationId`, `actorId` where applicable
- Correlation ID traceable end-to-end through one full request from mobile → backend → notification delivery
- Transport master kill switch tested in staging: flipping it returns 503 from all transport routes within 30s
- Four dashboards live with at least 7 days of data
- Institutional-trace endpoint returns within 2s on staging
- Runbook stub: `docs/runbooks/feature-flag-rollback.md`

### Estimated effort

1.5–2 weeks. Mostly additive code, low refactoring risk.

---

## Phase 3 — SIS Integration Boundary

**Goal:** All SIS interaction lives in one adapter. Inbound sync is idempotent and resumable. Outbound push is durable and retryable. Conflicts have a documented resolution policy.

This is the riskiest external dependency in the platform. Build it deliberately.

### Deliverables

**Adapter interface**
- `IntegrationAdapter` interface in `packages/shared/integration/` with `pullPersons`, `pullEnrollments`, `pullSections`, `pushAttendance`, `healthCheck`
- `SisAdapter` implementation in `apps/backend/src/spine/integration/sis/` — single file (or small folder) absorbing all SIS quirks
- All SIS-specific code lives here; no SIS field names or endpoints leak into domain modules

**Inbound sync**
- Staging table `integration.SisImportRow` for raw inbound data with `importBatchId`, `kind`, `rawPayload`, `validationStatus`, `errorReason`
- Zod validators per entity type; rows that fail validation stay in staging with the error
- Materializer writes from staging into `identity.UniversityPerson`, `academic.Section`, `academic.CourseEnrollment` (Section/Enrollment tables can be created here even before classroom domain launches — they're empty until then)
- Nightly Cloud Task at a low-traffic hour
- Manual CSV upload path via admin UI as fallback/initial seed — uses the same materializer

**Outbound push**
- Simple retry table `integration.PendingSisPush`: `id`, `type`, `payload`, `idempotencyKey`, `attempts`, `lastError`, `createdAt`, `dispatchedAt`
- Idempotency key: `(personId, date, domain)` — SIS receives the same batch twice, stores once
- Cloud Task scheduled every 15 minutes drains pending rows
- After 5 attempts, row marked `requires_review` and alert fires
- Manual replay endpoint for admin: `POST /v1/admin/sis/retry?pushIds=[...]`
- Currently no domain produces attendance pushes — the infrastructure exists, the producer hooks land when academic/transport push goes live

**Conflict resolution policy**
- `docs/SIS_INTEGRATION_CONTRACT.md` documents:
  - Enrollment data: SIS wins always; our view is a cache
  - Attendance data: We win for the operational day; SIS is downstream
  - Person demographics: SIS wins on name/DOB; we win on operational state
  - Section assignment: SIS wins; if student removed from enrollment, stop accepting attendance for them but retain historical
- Policy is enforced in the materializer, not scattered across handlers

**Health visibility**
- `GET /v1/admin/integrations/sis/health` exposes: last successful pull per entity type, last successful push, pending push count, requires-review count
- Staleness alarm: no successful inbound sync in 36 hours → P2 alert

### Exit criteria

- SIS adapter is a single, isolated module
- Inbound sync runs nightly on staging against a real (or realistic mock) SIS endpoint for 7 consecutive nights without manual intervention
- Outbound push infrastructure proven by replaying a test batch end-to-end including a forced failure + retry
- Conflict resolution policy reviewed with whoever owns the SIS on the institution side
- Health endpoint reports correctly under both healthy and degraded conditions

### Estimated effort

1–2 weeks. Lower bound if the SIS exposes a clean API. Upper bound if it's CSV-over-SFTP or has authentication quirks.

---

## Phase 4 — Transport Stabilization (residual)

**Goal:** Close out anything transport-specific that didn't naturally fold into Phases 1–3.

Most transport hardening already happened in Phases 1–2. This phase is short and targeted.

### Deliverables

- Any of the original Phase 0 items that didn't fit naturally elsewhere
- Load test harness (k6 scripts) covering 8 AM check-in peak: 50 concurrent buses GPS-pinging + 2000 students scanning + 100 admin dashboard polls
- Load tests run weekly on staging; results in Sentry/Cloud Logging
- Transport-specific runbook: `docs/runbooks/transport-degraded.md` covering RTDB failure, Redis-B eviction issues, FCM degradation
- Corrections queue UI polish: surface FAIL reasons, filter by route, bulk acknowledge

### Exit criteria

- Load test results show check-in P99 <800ms at 2× expected peak load
- All transport SLOs green on dashboard for 7 consecutive days under real traffic
- Transport runbook reviewed and dry-run by whoever will be on-call

### Estimated effort

3–5 days. Largely cleanup and load-testing.

---

## Total foundation timeline

| Phase | Focus | Estimate |
|---|---|---|
| 1 | Auth + Policy + Data | 2–3 weeks |
| 2 | Operational basics | 1.5–2 weeks |
| 3 | SIS integration | 1–2 weeks |
| 4 | Transport stabilization residual | 3–5 days |

**Total: 5–7 weeks of focused foundation work.** After this, the platform has a clean substrate. New domain launches (Announcements, then Classroom Attendance) sit on top of it without re-litigating any of this.

---

## What "done" looks like across all phases

Before declaring foundation complete:

- A new engineer can read the codebase and understand the auth/policy pattern within an hour
- A new domain feature can be added behind a flag, deployed, watched on dashboards, and rolled back via flag flip — all without paging anyone
- Any (personId, date) institutional question can be answered in under 2 minutes from the trace endpoint
- The SIS adapter is the only file that knows what SIS we're talking to
- Transport is running on the new foundation with no regressions in measured SLOs
- `CLAUDE.md` reflects the actual code; the docs don't lie

---

## What comes after foundation

Three domain launches in order:

1. **Announcements** (low risk, exercises FCM + flag rollout + audience resolution)
2. **Classroom Attendance** (pilot department → expansion, exercises SIS sync, cross-domain reconciliation, faculty adoption)
3. **Further hardening only as triggered by real load**

No "Workflows" domain. No "Phase 5" automatic OD. Those stay cut.

---

## The single honest sentence

The foundation is small on purpose: capability auth, schema discipline, a clean SIS adapter, feature flags, and structured logs. Build it in 5–7 focused weeks. Then build domains on top. Don't simulate Netflix infrastructure for a 13,000-user platform — the win is faculty adoption, not architectural elegance.
