# Platform Evolution Plan — College Bus → University Platform

> **Status:** Approved direction. Not yet implementation. Phase 0 is the next merge target.
> **Owner:** Platform engineering.
> **Last updated:** 2026-05-13.

---

## Locked decisions

| Decision | Value | Rationale |

|---|---|---|
| Cloud | **GCP** — Cloud Run + Cloud SQL + 2× Memorystore + Cloud Tasks + Firebase RTDB/FCM + GCS | Existing investment; Cloud Tasks is an architectural invariant (`CLAUDE.md §4 rule 5`); Firebase RTDB drives the live bus map |
| Region | **`asia-south1` (Mumbai)** — single region | Closest GCP region to Chennai (no Chennai region exists). Single-region keeps Cloud SQL ⇄ Cloud Run ⇄ Memorystore latency in single-digit ms |
| Tenancy | **Single-tenant forever** | One college. No `collegeId` columns anywhere. A second college = new deployment, not a code change |
| Roster ingest | **CSV first, ERP/SIS pull added later** | Two adapters behind one ingest interface |
| Mobile strategy | **One Expo app with lazy route groups** | Bundle size instrumented from Phase 1; split decision deferred to a measured trigger |
| Delivery model | **Trunk-based, single production cutover** | No incremental PRs to prod. All work lands on `main`, everything ships behind feature flags, one big deploy when the final-push gate (§13) is met |

---

## 0. North star

This is **not** version 2 of a bus app. It is a **university operations platform**. The bus system is its first domain. Classroom attendance, announcements, notices, and OD requests are siblings of "bus," not extensions of it.

Everything below is structured so that adding a 6th, 7th, 8th domain in year two does not require touching the first five.

---

## 1. Target architecture


```
                  ┌──────────────────────────┐
   Mobile (Expo)  │  app/(auth)              │
                  │  app/(student)           │
                  │  app/(driver)            │  ← lazy-loaded
                  │  app/(faculty)           │     route groups
                  │  app/(utility)           │
                  └────────────┬─────────────┘
                               │
   Admin (Vite)   ┌────────────┴─────────────┐
                  │  apps/admin   (bus)      │
                  │  apps/uni-admin (univ.)  │
                  └────────────┬─────────────┘
                               │
                       HTTPS + cookie/JWT
                               │
                  ┌────────────┴─────────────┐
                  │   Cloud Run (Fastify)    │
                  │   single backend binary  │
                  │                          │
                  │   /v1/transport/*        │
                  │   /v1/academic/*         │
                  │   /v1/comms/*            │
                  │   /v1/workflows/*        │
                  │   /v1/identity/*         │
                  │   /v1/platform/*         │
                  └───┬────────┬─────────┬───┘
                      │        │         │
              Cloud SQL    Memorystore   Cloud Tasks
              (single)     (× 2 roles)   (jobs queue)
                                │
                        Firebase RTDB  ← live bus position only
                        FCM            ← push
                        GCS            ← signed-URL files
```

**One backend binary, many domains.** Domains are isolated *internally* by module folder + Prisma schema namespace + capability boundary, not by deployment. Same Fastify, same env, same cron.

---

## 2. Domains & their module folders

Each domain owns one folder under `apps/backend/src/modules/`. **No cross-domain Prisma imports.** Cross-domain data is exchanged through `packages/shared` DTOs and the outbox.

| Domain | Module(s) | Prisma schema | Owns |
|---|---|---|---|
| **identity** | `auth/`, `users/` (existing) | `identity` | User, AdminUser, sessions, devices, MFA |
| **transport** | `attendance/`, `trips/`, `routes/`, `fleet/`, `gps/`, `driver/`, `student/`, `qr/`, `incidents/` (existing) | `transport` | All bus-related models |
| **academic** | `classroom/` (new), `calendar/` (new), `roster/` (new) | `academic` | ClassSession, ClassAttendanceLog, Semester, WorkingDay, CourseEnrollment |
| **comms** | `notifications/` (existing), `announcements/` (new), `messages/` (existing) | `comms` | Announcement, Notification, NotificationDrop, Message |
| **workflows** | `od-requests/` (new), `complaints/` (existing extended) | `workflows` | OdRequest, Complaint, WorkflowState |
| **platform** | `feature-flags/` (new), `audit/` (existing extended), `import/` (existing extended) | `platform` | FeatureFlag, AuditLog, ImportSession, ImportRow |

Existing modules stay where they are; new ones are added next to them. Schema namespacing happens in Phase 2 — not retroactively per migration.

---

## 3. Architectural invariants — additions to `CLAUDE.md §4`

In addition to the existing 12 invariants:

13. **Cross-domain reads go through the outbox + read-model, never through SQL joins across schemas.** A bus query never joins `academic.*`. A classroom query never joins `transport.*`. Cross-checks consume domain events.
14. **Every Prisma model belongs to exactly one schema** declared via `@@schema("…")`. Schemas are: `identity`, `transport`, `academic`, `comms`, `workflows`, `platform`.
15. **Every new feature ships behind a feature flag.** The flag name and ramp plan are in the PR description. Flags are removed within one release of reaching 100%.
16. **Every authorization check goes through `policy.can(actor, action, resource)`** in `packages/shared/policy.ts`. No inline `if (user.role === …)` in routes or services.
17. **Every new table includes `createdAt`, `updatedAt`.** No exceptions for "audit-only" tables.
18. **All GCP resources live in `asia-south1`.** Cross-region traffic is a P1 incident, not a config drift.
19. **Migrations are additive.** Drops happen one full release after a column has been unused in code. Mark intent with a Prisma comment `// DEPRECATED <date>: remove after <release>`.
20. **No domain logic in webhook routes.** Cloud Tasks webhooks (`/v1/jobs/*`) parse + validate + delegate to a service. Same rule as the user-facing routes.

---

## 4. Data model evolution

### 4.1 Phase 2 schema namespacing

Prisma 5 supports `@@schema()` with `multiSchema` preview. Migration plan:

1. Enable `previewFeatures = ["multiSchema"]` and `schemas = ["identity", "transport", "academic", "comms", "workflows", "platform"]` in the Prisma `generator` and `datasource` blocks.
2. **One Prisma migration** that issues `CREATE SCHEMA IF NOT EXISTS …` for the five new schemas, then `ALTER TABLE … SET SCHEMA …` for every existing model. Done once, never again.
3. Update `@@map` declarations to include schema where needed.
4. The migration is mechanical — no data movement, just metadata. Cloud SQL handles it in seconds.

### 4.2 New models — minimum set

**In `academic`:**

- `Semester` — `id`, `name`, `startsOn`, `endsOn`, `isActive`
- `WorkingDay` — `id`, `date`, `kind` (`WORKING | HOLIDAY | EXAM | RESCHEDULED`), `note`
- `Course` — `id`, `code`, `name`, `department`, `year`, `semesterId`
- `Section` — `id`, `courseId`, `code`, `facultyId`
- `CourseEnrollment` — `id`, `sectionId`, `studentId` — `@@unique([sectionId, studentId])`
- `ClassSession` — `id`, `sectionId`, `facultyId`, `scheduledStart`, `scheduledEnd`, `actualStart?`, `actualEnd?`, `room?`, `status` (`SCHEDULED|IN_PROGRESS|COMPLETED|CANCELLED`)
- `ClassAttendanceLog` — `id`, `sessionId`, `studentId`, `status` (`PRESENT|ABSENT|EXCUSED|OD`), `markedById`, `markedAt`, `note?` — `@@unique([sessionId, studentId])`
- `ClassAttendanceEvent` — event-sourced audit, mirrors `AttendanceEvent` shape

**In `comms`:**

- `Announcement` — `id`, `authorId`, `audienceKind` (`COLLEGE|DEPARTMENT|YEAR|SECTION|ROUTE|CUSTOM`), `audienceFilter` (JSON), `title`, `body`, `attachmentKeys` (string[]), `publishedAt?`, `expiresAt?`

**In `workflows`:**

- `OdRequest` — `id`, `studentId`, `reason`, `fromDate`, `toDate`, `state` (`DRAFT|SUBMITTED|UNDER_REVIEW|APPROVED|REJECTED|WITHDRAWN`), `evidenceKeys` (string[]), `currentReviewerId?`
- `WorkflowEvent` — generic state-machine audit (`entityType`, `entityId`, `fromState`, `toState`, `actorId`, `metadata`, `at`)

**In `platform`:**

- `FeatureFlag` — `id`, `key`, `enabled`, `audience` (JSON: role/department/userIds), `description`, `updatedById`
- `Outbox` — `id`, `aggregateType`, `aggregateId`, `eventType`, `payload` (JSON), `occurredAt`, `dispatchedAt?`, `attempts`

### 4.3 What stays untouched

`AttendanceLog` and `AttendanceEvent` keep their structure. Bus attendance and class attendance are **siblings**, not parent/child. The "cross-check" is a derived read-model populated by the outbox consumer (Phase 2 deliverable).

---

## 5. Infrastructure target on GCP

| Resource | Choice | Notes |
|---|---|---|
| Compute | **Cloud Run** | `min-instances=1` to keep socket-adapter warm, `max-instances=10` initially. CPU always allocated for the websocket pod. |
| Database | **Cloud SQL Postgres 15**, regional HA | Private IP only. `connection_limit=10&pool_timeout=20` in DATABASE_URL. PgBouncer not needed at current scale — revisit if `pg_stat_activity` shows saturation. |
| Cache A (security-critical) | **Memorystore Redis 7**, `noeviction`, 1GB Basic-tier | Nonces, idempotency, locks, sessions. `REDIS_URL`. |
| Cache B (ephemeral) | **Memorystore Redis 7**, `allkeys-lru`, 1GB Basic-tier | Rate limits, live GPS, dashboard stats. `REDIS_URL_VOLATILE`. |
| Jobs | **Cloud Tasks**, two queues per env | `transport-jobs`, `platform-jobs`. Separate queues = independent retry/backoff. |
| Realtime bus position | **Firebase RTDB** | Unchanged. Single path `/buses/{busId}`. |
| Push | **FCM via Firebase Admin** | Unchanged. Fix the Expo-token-vs-FCM bug in Phase 0. |
| Files | **GCS bucket** per env | V4 signed PUT URLs. CORS allowlist. Object lifecycle: 7-day TTL on `tmp/`, indefinite on `permanent/`. |
| Secrets | **Secret Manager** | Replace any env vars holding service-account JSON. |
| Logging | **Cloud Logging** → BigQuery sink | One sink filtered for `AuthAuditEvent` + `AuditLog` for analytics. |
| Errors | **Sentry** | Three projects: backend, admin, mobile. |
| Mobile OTA | **EAS Update** | Staged rollout: 10% → 50% → 100% per release. |
| CI/CD | **GitHub Actions → Cloud Build → Cloud Run** | Existing `infra/cloudbuild/` reused. PR previews via per-PR Cloud Run revision with traffic 0%. |

### New env vars locked in now

```
REDIS_URL                    # security-critical, noeviction
REDIS_URL_VOLATILE           # ephemeral, allkeys-lru
GCS_BUCKET_ATTACHMENTS       # files
FEATURE_FLAGS_BOOT_OVERRIDE  # comma-separated `key=true|false` for break-glass
JWT_UNI_ADMIN_AUDIENCE       # new audience for uni-admin SPA
```

Update `apps/backend/src/lib/env.ts` Zod schema to require all five in production.

---

## 6. Phase-by-phase delivery

Estimates assume one senior engineer + reviewer.

### Phase 0 — Bug-fix the foundation (1–2 weeks)

**No new features until this is green.**

| # | Fix | Where |
|---|---|---|
| 0.1 | **Mark and track** the MFA bypass — keep the bypass active during build phase (user-deferred), but make it loud: warn-level log on every admin login that hits the bypass, Sentry breadcrumb, and a `SECURITY_DEBT.md` entry. Actual revert is a **hard gate** on the final production push (see §13). | `apps/backend/src/modules/auth/admin-auth.middleware.ts:133` |
| 0.2 | Implement 5 stub read methods (history, log details, list corrections, self-report, list self-reports) | `apps/backend/src/modules/attendance/attendance.service.ts` + repository |
| 0.3 | Fix FCM-vs-Expo-push token mismatch — backend expects FCM, mobile sends Expo today | `apps/mobile/lib/notifications.ts` + `apps/backend/src/modules/notifications/` |
| 0.4 | Cache bus position in Redis-B with 2s TTL on GPS ping write; check-in reads cache, falls back to RTDB | `apps/backend/src/modules/gps/gps.service.ts`, `apps/backend/src/modules/attendance/attendance.service.ts:160-173` |
| 0.5 | New endpoint `GET /v1/admin/attendance/reconcile?date=…` comparing `AttendanceEvent` rows vs `dashboard:stats` | `apps/backend/src/modules/admin/` |
| 0.6 | Surface FAIL logs (`failReason: 'GEOFENCE'`) in corrections queue UI | `apps/admin/src/pages/corrections/` |

**Definition of Done:** all six merged, type-check + e2e-smoke green, manual run-through of student check-in + admin reconcile passes.

### Phase 1 — Managed GCP cutover (1 week)

| # | Task |
|---|---|
| 1.1 | Provision Cloud SQL (private IP, `asia-south1`), import Docker dev data via `pg_dump` |
| 1.2 | Provision 2× Memorystore (Basic tier, two `maxmemory-policy` settings) in `asia-south1` |
| 1.3 | Update `apps/backend/src/lib/env.ts` + `redis.ts` + `redis-client.ts` to read `REDIS_URL` and `REDIS_URL_VOLATILE` separately. Audit every Redis call: nonces/locks/idempotency → A; rate-limit/dashboard/live-state → B. |
| 1.4 | GCS bucket + IAM + signed-URL helper at `apps/backend/src/lib/files.ts` |
| 1.5 | Secret Manager for `FIREBASE_SERVICE_ACCOUNT_JSON`, `MSG91_AUTH_KEY`, `CLOUD_TASKS_SECRET`, JWT secrets |
| 1.6 | Sentry wired in backend (Fastify hook), admin (React error boundary), mobile (Expo Sentry SDK) |
| 1.7 | Cloud Build pipeline tightened: lint + type-check + unit tests + e2e-smoke must pass before deploy |
| 1.8 | Add `expo-atlas` to mobile CI; record baseline bundle size as a comment on every PR |
| 1.9 | `min-instances=1` on Cloud Run; verify socket adapter survives a rollout |

**Definition of Done:** staging running entirely on managed GCP in `asia-south1`, prod cutover with documented rollback (DNS-level traffic split).

### Phase 2 — Platform primitives (2 weeks)

**The foundation everything else stands on.**

| # | Primitive | What ships |
|---|---|---|
| 2.1 | **Schema namespacing** | One Prisma migration moves all 35 models into named schemas. `multiSchema` preview enabled. Zero data movement. |
| 2.2 | **Academic calendar module** | `Semester`, `WorkingDay` models; `/v1/academic/calendar/*` admin CRUD; cached "is today a working day" check exposed via `packages/shared/policy.ts`. |
| 2.3 | **Feature flags** | `FeatureFlag` table, admin UI in bus-admin (until uni-admin exists), client SDK that snapshots flags into `/v1/auth/me`. Rule 15 of `CLAUDE.md`. |
| 2.4 | **Capability/policy layer** | `packages/shared/policy.ts` exports `can(actor, action, resource)` with typed resource kinds. Every route migrated to use it. AuditLog every deny. |
| 2.5 | **Outbox pattern** | `Outbox` table + Cloud Tasks consumer at `/v1/jobs/dispatch-outbox`. Helper `outbox.publish(eventType, payload)` used by services within their DB transaction. |
| 2.6 | **Workflow state-machine helper** | `packages/shared/workflow.ts` — generic FSM with audit hook. Reused by OD requests, complaints, future leave requests. |
| 2.7 | **Domain event registry** | New doc `docs/DOMAIN_EVENT_REGISTRY.md` listing every event type, producer module, consumers. Reviewer rule: PRs adding events update this doc. |
| 2.8 | **`UNI_ADMIN` JWT audience** | Add `JWT_UNI_ADMIN_AUDIENCE` env, mint tokens with the new `aud` from admin-auth, no UI yet but the auth path is wired. |

**Definition of Done:** all primitives merged, every existing route migrated to `policy.can(...)`, outbox consumer running idle in staging, schema namespacing live on staging without breaking any existing test.

### Phase 3 — Faculty role + classroom attendance (2–3 weeks)

| # | Deliverable |
|---|---|
| 3.1 | Prisma models in `academic`: `Course`, `Section`, `CourseEnrollment`, `ClassSession`, `ClassAttendanceLog`, `ClassAttendanceEvent` |
| 3.2 | CSV ingest extension: new `ImportSession.kind = 'ROSTER'` that creates courses/sections/enrollments. Existing import infrastructure carries it. |
| 3.3 | `apps/backend/src/modules/classroom/` — full 4-layer module. `/v1/academic/classroom/*` routes: list-my-sections, start-session, mark, end-session, my-sessions-today |
| 3.4 | `apps/backend/src/modules/roster/` — read-only views for "students in my section," "courses I teach" |
| 3.5 | **No QR. No student scan. Faculty marks; students receive a `CLASS_ATTENDANCE_MARKED` push.** Reuses `notifications.service.ts`. |
| 3.6 | Mobile `app/(faculty)/` route group, lazy-loaded. Screens: `today.tsx`, `session/[id].tsx` (mark roster), `history.tsx`, `profile.tsx`. Faculty still get `(student)` for their own bus rides. |
| 3.7 | `AuthGate` extension in `apps/mobile/app/_layout.tsx` — `FACULTY` role routes to `(faculty)/today` by default, with `(student)` available via a tab |
| 3.8 | PII boundary: faculty sees `name + rollNumber + photo? + section`. Phone/parent contact gated behind a separate capability (`student:contact:read`) that faculty do **not** have by default. |
| 3.9 | Cross-check read-model: outbox consumer builds `daily_presence_facts` (student × date × on_bus × in_first_period). Admin report endpoint `/v1/admin/reports/cross-check`. |
| 3.10 | Feature flag `classroom.v1` gates the whole thing. Ramp by department. |

**Definition of Done:** one pilot department live behind the flag, two weeks of dual-reading (bus + class) compared against manual ground truth, < 2% reconciliation delta.

### Phase 4 — University utility (3–4 weeks)

| # | Deliverable |
|---|---|
| 4.1 | `apps/backend/src/modules/announcements/` — CRUD, audience resolver (`COLLEGE|DEPARTMENT|YEAR|SECTION|ROUTE|CUSTOM`), publish/expire, attachments via GCS signed URLs |
| 4.2 | `apps/backend/src/modules/od-requests/` — uses the workflow helper from 2.6. States: `DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED|REJECTED`. Approved OD writes `EXCUSED` to both `AttendanceLog` (transport) and `ClassAttendanceLog` (academic) via the outbox. |
| 4.3 | `apps/backend/src/modules/notices/` — formal college notices, read receipts tracked, archival to GCS |
| 4.4 | `apps/uni-admin/` — new Vite SPA, sibling of `apps/admin/`. Auth via `UNI_ADMIN` JWT audience. Capability-gated pages for each of the three sub-domains above. |
| 4.5 | Mobile `app/(utility)/` route group, lazy-loaded. Screens: `announcements.tsx`, `notices.tsx`, `od/*` (list, new, detail, evidence-upload via signed URL). |
| 4.6 | **ERP/SIS pull adapter** (the second roster ingest) — a new Cloud Tasks-scheduled importer that calls the college ERP endpoint nightly, normalizes into the same `ImportSession.ROSTER` shape, dedupes against existing enrollments. CSV remains as the manual override. |
| 4.7 | Feature flags per sub-feature: `announcements.v1`, `od.v1`, `notices.v1`, `roster.erp_pull` |

**Definition of Done:** all four features live behind flags, one pilot department uses OD end-to-end for one full month, no manual data fix-ups required.

### Phase 5 — Scale hardening (triggered, not scheduled)

Each is a one-week project when its trigger fires.

| Trigger | Action |
|---|---|
| Memorystore CPU > 60% sustained on Redis-B | Shard socket rooms by route across two Pub/Sub channels |
| Cloud SQL CPU > 70% sustained on read replicas | Add a read replica, route admin report queries to it via a separate Prisma client |
| Mobile bundle > 25 MB Android download | Reassess one-app-vs-split decision with hard data |
| AttendanceEvent table > 50M rows | Move > 2-year-old rows to a cold partition / BigQuery archive |
| Job webhook latency P99 > 2s | Migrate from Cloud Run handler → dedicated Cloud Run job service |

---

## 7. Roster ingest — the two-adapter strategy

One interface, two adapters, picked per term:

```
RosterSource (interface in packages/shared)
   ↓ implemented by
   ├─ CsvRosterAdapter      (Phase 3 — manual upload via admin UI)
   └─ ErpPullRosterAdapter  (Phase 4 — nightly Cloud Task)
```

Both write into the same `ImportSession` → `ImportRow` → `Course/Section/CourseEnrollment` materialization path. **Faculty never writes rosters directly.** The CSV admin upload is the v1 source of truth; the ERP adapter is added later without touching the materializer.

This means in Phase 3 you build the materializer once. Phase 4 only adds a new feeder.

---

## 8. Security & PII rules (codified)

- **PII matrix in `packages/shared/policy.ts`.** Every student field tagged with a sensitivity level (`PUBLIC | ROSTER | CONTACT | RESTRICTED`). The serializer for student responses reads the actor's capabilities and strips fields they cannot see. **One place to change, one place to audit.**
- **Faculty default capabilities:** `student:roster:read`, `classroom:session:mark`, `announcement:create:section`. Notably absent: `student:contact:read`, `student:address:read`.
- **Every non-admin read of a student profile writes an `AuditLog` row.** No exceptions.
- **Data retention job (Phase 2.5):** Cloud Task daily, archives `AttendanceEvent` older than 5 years to GCS Cold Storage as Parquet, deletes from Postgres. Same for `AuthAuditEvent` after 2 years.
- **DPDP Act readiness:** maintain `docs/DATA_INVENTORY.md` listing every personal data field, its purpose, retention period, lawful basis. Update in the same PR that adds a new personal-data column. Reviewer-enforced.

---

## 9. Observability & runbooks

Add by Phase 1 end:

- **Sentry alerts** routed to Slack/Discord. Severity tiers: P1 (error rate > 1% for 5 min), P2 (single 500 in a critical route), P3 (anything else).
- **Cloud Logging dashboards** for: check-in latency P95/P99, GPS ping ingestion rate, Cloud Tasks queue depth per queue, outbox dispatch lag, FCM delivery rate.
- **New runbooks** in `docs/runbooks/` to write during Phase 1/2:
  - `redis-a-vs-redis-b-confusion.md` (when the wrong cache eats security data)
  - `outbox-stalled.md`
  - `feature-flag-rollback.md`
  - `cloud-sql-failover.md`

---

## 10. Definition of Done — every phase

We are **trunk-based with a single production cutover**. There are no incremental PRs to prod; every phase below is a milestone on `main`, verified locally + on staging, gated for production by §13.

A phase is considered "Done" when **all** of these are true on `main`:

1. All listed deliverables committed.
2. `pnpm --filter backend type-check && pnpm --filter admin build && pnpm --filter backend test -- --run && pnpm --filter backend e2e:smoke` green locally and in CI.
3. `docs/API_CONTRACT_MATRIX.md` and `docs/SOCKET_EVENT_REGISTRY.md` updated in the same commit (or commit chain) as each new route/event.
4. `docs/DATA_INVENTORY.md` updated if any new personal-data column was added.
5. New runbooks added for any new failure mode.
6. **Every new code path lives behind a feature flag** from Phase 2 onwards. Because `main` will always carry unfinished domains until the final cutover, flags default to `false` in production env and `true` in staging/local. No exceptions.
7. Sentry shows < baseline + 5% error rate for 48h on staging before the phase is signed off.
8. `CLAUDE.md` updated to reflect any new invariants — the docs cannot lie about the code.

### Notes specific to the trunk-based model

- **Phase 0 ships without flags** because it only fixes existing user-visible behavior (stub reads, FCM tokens, RTDB cache, reconcile endpoint, FAIL surfacing). These are safe-by-default.
- **Phases 1–4 each gate their new code behind a flag** so an in-progress phase never becomes visible to real users prematurely.
- **Commit hygiene matters more than PR hygiene here.** One concept per commit, conventional-commit messages, so the final push log is auditable end-to-end.
- **Staging is the integration environment.** It runs `main` continuously, with all flags flipped on. If staging breaks, the breaking commit is reverted on `main`, not "fixed forward" — same-day cleanliness is what makes the final cutover safe.

---

## 11. Risk register

| Risk | Mitigation | Owner |
|---|---|---|
| Schema namespacing migration breaks Prisma client generation in CI | Run migration on a clone of prod data in staging first; have a one-line revert script ready | Backend |
| Faculty roster CSV is messy / inconsistent across departments | Strict Zod schema on upload + per-row error report; reject the whole file if > 5% rows fail | Backend |
| FCM delivery degrades under classroom-attendance push fanout | Batch via `sendEachForMulticast` (already used); rate-limit per device; fall back to in-app inbox | Backend |
| `(faculty)` + `(utility)` route groups balloon bundle past Play Store warnings | EAS bundle-size CI check fails the PR; lazy load per-group; defer heavy libs (charts, PDF) | Mobile |
| Outbox consumer falls behind, cross-check report goes stale | Cloud Logging alert on `dispatchedAt - occurredAt > 60s`; manual dispatch endpoint for ops | Backend |
| MFA re-enablement (0.1) locks out current admins | Phase 0.1 ships with a one-time enrollment flow and a documented break-glass `ADMIN_MFA_BYPASS_USER_ID` env var, removed within one release | Backend |
| ERP/SIS endpoint changes without notice (Phase 4) | Adapter writes raw response to GCS before normalization; nightly diff alert | Backend |

---

## 12. Decisions resolved

1. **Feature flag tooling:** DB-backed `FeatureFlag` table (Phase 2.3). No LaunchDarkly / Statsig. Audience JSON covers role/department/userId rollouts, which is sufficient for foreseeable needs.
2. **MFA enrollment:** **deferred to the final production push.** During build phase, the existing bypass at `admin-auth.middleware.ts:133` stays active so the engineering team is not locked out during iteration. Phase 0.1 only adds visibility (log + Sentry + `SECURITY_DEBT.md`). The actual revert + force-enrolment flow is a hard gate on the final push — see §13.

Phase 0 starts with item 0.2 (implement the 5 stub read methods in `attendance.service.ts`) as the first commit chain on `main` — it's the highest user-visible gap and unblocks every attendance-facing screen.

---

## 13. Final production push checklist (hard gate)

These items **must** be true before the system is opened to its full student/staff/faculty population. None of them can be skipped or deferred past this point.

| # | Gate | Owner | Verified by |
|---|---|---|---|
| 13.1 | **MFA bypass reverted.** `admin-auth.middleware.ts:133` returns to enforcing MFA when the admin has it enabled. | Backend | Code review + manual login test on staging with a fresh admin account |
| 13.2 | **Force-enrolment flow live.** First admin login after the revert routes to `/admin/mfa/enroll` if `mfaEnabled === false`. 7-day grace window controlled by `feature:mfa.grace_period` flag. | Backend + Admin SPA | E2E test: fresh admin → forced enrolment → backup codes issued |
| 13.3 | **Break-glass account documented.** One `ADMIN_MFA_BYPASS_USER_ID` env var, scoped to a single ops account, rotated on use, logged on every use. To be removed within one release after the rollout stabilises. | Backend | Runbook `docs/runbooks/admin-lockout-recovery.md` exists and references the env var |
| 13.4 | **`SECURITY_DEBT.md` MFA entry closed** with the commit hash of the revert. | Backend | Doc diff |
| 13.5 | **All Phase 0–4 feature flags at 100% or removed.** Any flag still at < 100% must have a written justification in the push checklist. | Whoever owns the flag | Flag table dump reviewed pre-push |
| 13.6 | **48h staging soak with production-shape traffic** (replayed access logs or synthetic load) — Sentry error rate < baseline + 5%, P99 check-in latency < 800ms. | Platform | Cloud Logging dashboard screenshot in the push PR |
| 13.7 | **Data inventory + retention audit signed off.** `docs/DATA_INVENTORY.md` complete; retention Cloud Task (§8) running on staging for at least one cycle. | Backend | Doc review + Cloud Task execution log |
| 13.8 | **Runbooks complete** for: admin lockout, Redis-A/B confusion, outbox stalled, Cloud SQL failover, feature flag rollback. | Platform | `docs/runbooks/` index updated |
| 13.9 | **Rollback plan documented** with the exact Cloud Run revision to revert to, the DNS swap procedure, and the data-compatibility window (any migrations in the push must be backward-compatible — invariant 19). | Platform | Deploy runbook `docs/runbooks/production-cutover.md` |
| 13.10 | **CLAUDE.md current.** Every architectural invariant in §3 of this plan is present in `CLAUDE.md §4`. | Reviewer | Doc diff |

**The production cutover cannot proceed until every box above is ticked in writing.** This is the one place in the plan where "we'll fix it after rollout" is not an option. The checklist lives in `docs/runbooks/production-cutover.md` and is signed off by name + date.

---

## Appendix A — Glossary

- **Outbox pattern:** writing domain events to a table inside the same DB transaction as the business write, then publishing them asynchronously. Guarantees "if the write happened, the event will fire."
- **Read-model:** a denormalized projection of one or more domain events, optimized for a specific query. Lives in its own table, rebuildable from the event stream.
- **Capability:** a typed permission like `classroom:session:mark` checked via `policy.can(actor, action, resource)`. Capabilities are role-derived but checked at the action site.
- **Audience (JWT):** the `aud` claim that names the intended consumer. Three values: `JWT_MOBILE_AUDIENCE`, `JWT_ADMIN_AUDIENCE`, `JWT_UNI_ADMIN_AUDIENCE`.
- **Schema (Postgres):** a namespace inside a single database. Six in this plan: `identity`, `transport`, `academic`, `comms`, `workflows`, `platform`.

---

## Appendix B — What this plan deliberately does **not** do

- **No microservices.** Modular monolith on Cloud Run. Domains can be extracted later if a measured scaling reason appears.
- **No second backend.** uni-admin and bus-admin share one Fastify binary.
- **No real-time class attendance.** Faculty marks; students get a push. No live socket for classroom — bus uses sockets because positions move; classrooms do not.
- **No cross-domain SQL joins.** Cross-checks go through outbox → read-model only.
- **No multi-tenancy code.** Single college. A second college means a new deployment, not new columns.
- **No vendor lock-in to GCP at the application layer.** Outbox, policy, workflow helpers, and adapters are pure TypeScript. The Cloud Tasks dispatcher and signed-URL helper are the only GCP-specific surfaces.
