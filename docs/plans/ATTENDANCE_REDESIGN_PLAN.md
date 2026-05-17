# Attendance Screen Redesign — Implementation Plan

**Status:** Draft, pending confirmation
**Author:** Planning session 2026-05-13
**Scope:** Student mobile attendance screen (bus attendance only — in-person class attendance is out of scope, to be planned separately later)
**Owns:** `apps/mobile/app/(student)/attendance.tsx` (new), `apps/backend/src/modules/student/`, `apps/backend/src/modules/attendance/` (read-side), Prisma schema, `packages/shared`

---

## 1. Goal

Ship a 1:1 implementation of the redesigned student attendance screen (Images 1, 4, 5) that:

1. Reads **only real data** — no mock pills, no placeholder text, no fake holiday list.
2. Is reachable from (a) the bottom navigation **Profile/Me tab** and (b) tapping the black gradient `AttendanceGlossCard` on the home screen.
3. Is backed by an end-to-end working pipeline: `AttendanceLog` / `AttendanceEvent` → repository → service → BFF → mobile hook → screen.

This redesign is also the trigger to **fix the read-side stubs** in `attendance.service.ts:482–547` that currently return empty arrays. Without that, no real data ever reaches the screen.

---

## 2. What the design demands

### Image 1 / Image 4 — top half

| Visual | Data binding |
|---|---|
| Header `Attendance` + circular avatar `K` | `user.name[0]` from authenticated user |
| Month label `January-2026` | Active month state (default = current IST month) |
| 31 day-tiles, color-coded green/peach/blue/gray | Per-day rolled-up status from `AttendanceLog` for the active month |
| Legend `Present / Absent / OD / sat. sun. clgleave` | Static |
| `GOVT.Holidays` side card with 4–6 weekday-labelled dates | `Holiday` records intersected with the active month |
| Black gradient stats card `90% / 6 / 2` labelled `Attendance / Absent / OD` | Monthly aggregate from `AttendanceLog` |

### Image 5 — bottom half

| Visual | Data binding |
|---|---|
| Segmented pill `Absent / OD / Missing` | Local tab state |
| List card: peach date chip (`6 jan`) + `common leave: Informed leave` | `AttendanceCorrection.leaveType` + `informed` flag |
| List card: `Medical leave: Informed leave` | Same |
| List card: `common leave: not-informed leave` | Same with `informed=false` |
| Bottom nav (5 icons): Profile (active) · Map · Home · A · Settings | Expo Router `Tabs` |

---

## 3. Current state — what we have vs. what the design needs

Drawn from a fresh inspection of the attendance module (the reference 4-layer module per `CLAUDE.md` §5.2) plus the audit notes you provided.

### 3.1 What is solid (do not touch)

- **Event sourcing.** `AttendanceLog` (current state, unique `[userId, tripId]`) + `AttendanceEvent` (immutable audit) — `attendance.service.ts:217-250`.
- **Atomic QR nonce** via Redis `GETDEL` — no double-scan race.
- **IST date handling** through `getISODateIST()` in `packages/shared/src/utils/time.utils.ts`.
- **Idempotency cache** on the check-in path (`idempotency:checkin:*` keys).
- **Failed scans are persisted.** `attendance.service.ts:186-201` upserts a `PENDING` log with the geofence reason. This is the data source for the **Missing** tab.
- **Composite indexes** on hot paths: `[userId, dateKey]`, `[tripId, status]`, `[routeId, dateKey]`.
- **Joins to `User`** for `name / rollNumber / department` are already in `attendance.repository.ts:421, 943, 964, 1006`.

**Conclusion:** the write side is correct. The visible problem is the **read side**.

### 3.2 What is broken / missing

#### 3.2.1 Read-side stubs (THE blocker)

These five methods in `attendance.service.ts` return empty values today. They are the foundation the new screen reads:

| Method | Line | Current return | Required |
|---|---|---|---|
| `getStudentAttendanceHistory(studentId, filter, page, limit)` | 482 | `{ logs: [], total: 0 }` | Paginated month-aware log list |
| `getAttendanceLogDetails(logId, userId)` | 496 | `null` | Single log + events + correction |
| `listPendingCorrections(filter)` | 510 | `[]` | Student's own pending corrections |
| `selfReportCheckIn(tripId, studentId, gps?)` | 524 | `{ id: 'temp', status: 'PENDING' }` | Real self-report row |
| `listSelfReports(filter)` | 538 | `[]` | Student's own self-reports |

The mobile `history.tsx` already calls these via `studentService.getHistory`. The screen is reading air.

#### 3.2.2 Schema gaps

| Design field | DB today | Gap |
|---|---|---|
| `OD` status (legend, calendar color, tab, stats count `2`) | `AttendanceStatus` enum has `PRESENT / ABSENT / SELF_ARRANGED / LATE_BOARD / MANUAL / EXCUSED / PENDING`. No `OD`. | Add enum value `OD` (preferred) — see §5.1. |
| `common leave` / `Medical leave` (per list card) | `AttendanceCorrection.reason` is free text. | Add `leaveType` enum + `informed` boolean to `AttendanceCorrection`. |
| Government holidays panel | **No `Holiday` model exists.** | Add `Holiday` table. |
| `Missing` tab (unscanned school days) | `PENDING` logs with `failReason='GEOFENCE'` exist but are not exposed via any student read path. | Surface them through the new monthly endpoint. |

#### 3.2.3 Bottom navigation

`apps/mobile/app/(student)/_layout.tsx` is a `Stack`, not `Tabs`. The design requires a 5-tab bottom bar. This is a structural refactor — every existing student screen (`scanner`, `verify-arrival`, `checkin-success`, `correction/[logId]`, `self-report-prompt`, `notifications`, `profile`, `map`, `history`) must remain reachable.

---

## 4. Architecture

### 4.1 Read pipeline

```
AttendanceLog + AttendanceEvent + AttendanceCorrection + Holiday
        │
        ▼
attendance.repository.ts            ◄── new helpers (§5.3)
        │
        ▼
attendance.service.ts               ◄── implement stubs (§5.4)
        │
        ▼
student-attendance.service.ts (new) ◄── BFF aggregator for the screen
        │
        ▼
student.routes.ts                   ◄── GET /v1/student/attendance/monthly
        │
        ▼
packages/shared (types + Zod)       ◄── single source of truth
        │
        ▼
mobile/services/student.service.ts  ◄── getMonthlyAttendance()
        │
        ▼
mobile/hooks/useStudentAttendance.ts
        │
        ▼
mobile/app/(student)/attendance.tsx
```

### 4.2 Why a BFF aggregator and not a flat list endpoint

The screen needs four logical payloads in one render: calendar days, holidays, summary stats, leave lists. Three round trips would slow first paint on mobile. One BFF response keyed by `month=YYYY-MM` is a single 304-cacheable read.

### 4.3 What does **not** change

- Write path of `checkIn` — untouched.
- Event sourcing rule (CLAUDE.md §4.3) — every new state still appends an `AttendanceEvent`.
- IST handling — every new query routes through `getISODateIST()`. No raw `new Date().toISOString().split('T')[0]`.
- Idempotency on writes (corrections, self-reports) — keep the existing pattern.

---

## 5. Backend changes

### 5.1 Prisma schema

**Migration 1 — `add_od_attendance_status`**

Add `OD` to `AttendanceStatus` enum. Rationale: the design treats OD as a first-class status (own color, own count, own tab). Repurposing `EXCUSED` would muddy semantics and break existing `EXCUSED` consumers (e.g. faculty excuse). Cost is one migration, zero data backfill.

**Migration 2 — `add_leave_request_model`** (replaces the earlier "extend AttendanceCorrection" idea — see §13 for the full leave-intimation flow)

```prisma
model LeaveRequest {
  id            String          @id @default(cuid())
  userId        String
  type          LeaveType
  fromDate      String          // YYYY-MM-DD IST inclusive
  toDate        String          // YYYY-MM-DD IST inclusive
  tripScope     LeaveTripScope  // BOTH | MORNING_ONLY | RETURN_ONLY
  reason        LeaveReason     // structured subreason
  notes         String?         // free text, optional
  attachmentUrl String?         // signed URL to medical cert / OD letter
  status        LeaveStatus
  source        LeaveSource
  informed      Boolean         // computed at creation (see §13.4)
  reviewedBy    String?
  reviewedAt    DateTime?
  reviewerNote  String?
  createdAt     DateTime        @default(now())
  updatedAt     DateTime        @updatedAt

  user          User            @relation(fields: [userId], references: [id])
  logs          AttendanceLog[] @relation("LeaveRequestLogs")
  reviewer      AdminUser?      @relation(fields: [reviewedBy], references: [id])

  @@index([userId, fromDate, toDate])
  @@index([status, fromDate])
  @@index([reviewedBy, status])
}

enum LeaveType      { COMMON MEDICAL OD OTHER }
enum LeaveTripScope { BOTH MORNING_ONLY RETURN_ONLY }
enum LeaveReason    { SICK FAMILY_FUNCTION TRAVEL EXAM SPORTS NCC CONFERENCE CULTURAL PERSONAL OTHER }
enum LeaveStatus    { PENDING AUTO_ACCEPTED APPROVED REJECTED CANCELLED }
enum LeaveSource    { STUDENT_APP COORDINATOR FACULTY ADMIN IMPORT }
```

Plus a nullable FK on the existing `AttendanceLog`:

```prisma
model AttendanceLog {
  // ...existing fields
  leaveRequestId String?
  leaveRequest   LeaveRequest? @relation("LeaveRequestLogs", fields: [leaveRequestId], references: [id])

  @@index([leaveRequestId])
}
```

`AttendanceCorrection` is **kept as-is** — it remains the model for ops-side corrections (driver-marked, GPS-outage reconciliation, manual ops fixes). The student-facing "I want to declare leave" flow now goes through `LeaveRequest`, not `AttendanceCorrection`. This separates "I'm intimating leave" from "the system got it wrong."

**Migration 3 — `add_holiday_model`**

```prisma
model Holiday {
  id        String   @id @default(cuid())
  date      String   @unique         // YYYY-MM-DD (IST)
  name      String
  weekday   String                   // Monday / Tuesday / ... (denormalized for UI)
  createdAt DateTime @default(now())
  createdBy String?

  @@index([date])
}
```

V1 source-of-truth = admin seeding via a tiny admin endpoint (`POST /v1/admin/holidays`, `DELETE /v1/admin/holidays/:id`, `GET /v1/admin/holidays`). Static seed file for the academic calendar lives in `apps/backend/prisma/seed/holidays-2026.json` and is loaded once.

### 5.2 Shared package — `packages/shared/`

New files:

```
src/types/student-attendance.types.ts
src/schemas/student-attendance.ts
```

Public types (sketch):

```ts
type CalendarDayStatus =
  | 'PRESENT'        // green
  | 'ABSENT'         // peach
  | 'OD'             // blue
  | 'WEEKEND'        // gray (sat/sun)
  | 'HOLIDAY'        // gray (govt holiday)
  | 'COLLEGE_LEAVE'  // gray (college-declared)
  | 'NO_TRIP'        // gray (no scheduled trip — e.g. before assignment start)
  | 'FUTURE';        // gray (after today)

interface MonthlyAttendanceResponse {
  month: string;                         // "2026-01"
  days: Array<{ date: string; status: CalendarDayStatus; logId: string | null }>;
  holidays: Array<{ date: string; name: string; weekday: string }>;
  summary: {
    attendancePct: number;               // 0–100, integer
    presentCount: number;
    absentCount: number;
    odCount: number;
    schoolDaysInMonth: number;           // excludes weekends + holidays
  };
  leaves: {
    absent:  LeaveItem[];                // ABSENT logs in the month
    od:      LeaveItem[];                // OD logs in the month
    missing: MissingItem[];              // school days with no SUCCESS log
  };
}

interface LeaveItem {
  logId: string;
  date: string;                          // YYYY-MM-DD
  leaveType: 'COMMON' | 'MEDICAL' | 'OD' | 'OTHER';
  informed: boolean;
  correctionStatus: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';
}

interface MissingItem {
  date: string;
  reason: 'GEOFENCE' | 'GPS_OUTAGE' | 'NO_SCAN' | 'OTHER';
  logId: string | null;                  // PENDING log id if one exists
  canSelfCorrect: boolean;
}
```

Zod schemas mirror these and are exported from `packages/shared/src/index.ts`.

### 5.3 `attendance.repository.ts` additions

- `getMonthlyLogs(userId, monthStartIST, monthEndIST)` — returns logs for the user inside `[start, end]` ordered by `dateKey`. Indexed on `[userId, dateKey]` (already exists).
- `getMonthlyCorrections(userId, monthStartIST, monthEndIST)` — joins corrections to logs to attach `leaveType`/`informed`/`correctionStatus`.
- `getHolidaysInRange(startDate, endDate)` — reads from new `Holiday` table.
- `getMonthlyMissingCandidates(userId, monthStartIST, monthEndIST)` — `PENDING` logs with `failReason IN ('GEOFENCE', 'GPS_OUTAGE')` for the user in range, plus computed school-days-with-no-log (handled in service).

### 5.4 `attendance.service.ts` — implement the stubs

Concrete implementations replace the empty-returns at lines 482–547. Minimum viable contract:

- `getStudentAttendanceHistory(studentId, filter?, page?, limit?)` — paginated logs joined with corrections; supports `filter ∈ { ABSENT, CORRECTIONS, OD, MISSING }`.
- `getAttendanceLogDetails(logId, userId)` — log + last event + any correction. **Authorization:** caller's `userId` must own the log.
- `listPendingCorrections(filter)` — caller's own pending corrections.
- `selfReportCheckIn(tripId, studentId, gps?)` — atomic append of a `SELF_ARRANGED` log + audit event + correction request when applicable. Idempotent on `idempotency:self-report:<tripId>:<studentId>`.
- `listSelfReports(filter)` — caller's own self-reports.

Auth posture: every method narrows by `studentId === request.user.sub`. No cross-user reads from the student app.

### 5.5 `student-attendance.service.ts` (new) — BFF for the screen

A thin aggregator that calls repository helpers in parallel and assembles `MonthlyAttendanceResponse`. Computes:

- `summary.attendancePct = round(presentCount / (presentCount + absentCount) * 100)` — `OD` is **not** counted as absence. Holidays/weekends are not denominators.
- `days[].status` resolution priority: `FUTURE > HOLIDAY > WEEKEND > log.status > NO_TRIP`.
- `leaves.missing` = `(school days in month, ≤ today, no log row) ∪ (PENDING logs with failReason in {GEOFENCE, GPS_OUTAGE})`.

### 5.6 Routes — `student.routes.ts`

```
GET  /v1/student/attendance/monthly?month=YYYY-MM
GET  /v1/student/attendance/logs/:logId
POST /v1/student/attendance/self-report           (idempotent)
POST /v1/student/attendance/corrections           (idempotent)
GET  /v1/student/attendance/corrections           (caller's own)
```

All under `mobileRoute(['STUDENT'])`. Existing `/v1/attendance/*` admin-facing routes are untouched.

Admin holiday CRUD (separate PR is acceptable, but blocking the holidays panel):

```
GET    /v1/admin/holidays?year=YYYY
POST   /v1/admin/holidays                          (idempotent)
DELETE /v1/admin/holidays/:id
```

### 5.7 Contract docs

`docs/API_CONTRACT_MATRIX.md` updated in the same PR with the five new student routes and three admin routes (CLAUDE.md §4.8 invariant). No new socket events.

---

## 6. Mobile changes

### 6.1 Bottom navigation refactor

`apps/mobile/app/(student)/_layout.tsx` switches from `Stack` to `Tabs`. Tab assignments (proposed, pending confirmation of icon → screen mapping):

| Icon | Tab | Route |
|---|---|---|
| Person (active in design) | **Me / Attendance** | `app/(student)/attendance.tsx` (new) |
| Map pin | Live map | `app/(student)/map.tsx` (existing) |
| Heart / home | Home | `app/(student)/index.tsx` (existing) |
| `A` in circle | _Confirm with user_ — Announcements? | placeholder, hidden if no content |
| Gear | Settings / Profile | `app/(student)/profile.tsx` (existing) |

Non-tab screens stay in a nested `Stack` per tab so deep links (e.g. `/(student)/correction/[logId]`, `/(student)/scanner`, `/(student)/verify-arrival`, `/(student)/checkin-success`, `/(student)/checkin-fail`, `/(student)/self-report-prompt`) keep working. **Smoke test every existing screen reachability after the refactor.**

### 6.2 New screen — `app/(student)/attendance.tsx`

Composed of:

- `<AttendanceHeader />` — title + avatar bubble.
- `<MonthCalendarCard />` — `January-2026` label + month switcher + 6-row tile grid + legend.
- `<HolidaysCard />` — list of holidays for the visible month. On phone widths the design's side-by-side layout stacks vertically (calendar first, holidays beneath); confirm acceptability.
- `<StatsGradientCard />` — black gradient with 3 columns. Replaces the existing `AttendanceGlossCard` look on this screen but reuses the gradient component.
- `<LeaveTabs />` — segmented pill `Absent / OD / Missing`. Counts on each tab from `summary` / `leaves[*].length`.
- `<LeaveList />` — FlashList of cards; date chip + leave-type label + informed status. Tap behavior:
  - `Absent` / `OD` tab cards → log detail screen (existing `correction/[logId]` path, repurposed to render the linked `LeaveRequest` if present).
  - `Missing` tab cards → opens `<ApplyLeaveSheet />` in retroactive mode (channel 3, §13.1).
- `<ApplyLeavePill />` — a new pill on the Attendance screen header area for channel 1 (planned leave). Visual language matches the existing home-screen `WaitNotifyPill`. Tapping opens `<ApplyLeaveSheet />` with channel 1 defaults.

Empty states:

- No logs in month → calendar renders all-gray + stats card shows `0% / 0 / 0` + leave list shows `No records this month`.
- Network error → existing `ScreenErrorBoundary` + `ScreenErrorState`.

### 6.3 Hook — `hooks/useStudentAttendance.ts`

```ts
useQuery({
  queryKey: ['student', 'attendance', month],
  queryFn: () => studentService.getMonthlyAttendance({ month }),
  staleTime: 5 * 60_000,
  placeholderData: keepPreviousData,
});
```

Month change re-keys. `keepPreviousData` keeps the calendar mounted during fetches.

### 6.4 Service — `services/student.service.ts`

Add `getMonthlyAttendance({ month })` Zod-parsed against the shared schema. Remove `getHistory` once `history.tsx` is retired (Phase 7).

### 6.5 Home wiring — `AttendanceGlossCard` + `WaitNotifyPill`

Two changes on `(student)/index.tsx`, neither introduces a new visual element:

1. **`AttendanceGlossCard`** — wrap with `Pressable` → `router.push('/(student)/attendance')`. Drop the existing aggregate-only numbers and bind to the same monthly summary (single source of truth — both screens render from one query key, so they stay in sync).
2. **`WaitNotifyPill`** — keep the component, change `handleNotifyPress` (currently at `index.tsx:74`) to open a new `<WaitOrLeaveSheet />` exposing the two intents:
   - `Hold the bus / I'm running late` → existing `/(student)/self-report-prompt` flow (unchanged).
   - `Skip today / Apply same-day leave` → opens `<ApplyLeaveSheet />` with channel 2 defaults (§13.1.1).

   This is channel 2 of the leave-intimation flow. No new pill is added to the home screen.

### 6.6 Retire `history.tsx`

After Phase 6 ships and the new screen is verified, delete `app/(student)/history.tsx` and the associated `getHistory` method. Keep `correction/[logId]` reachable from the new list.

---

## 7. Phasing

| Phase | Deliverable | Validation |
|---|---|---|
| 1 | **Decisions locked** (§9) | This document signed off |
| 2 | **Shared types + Zod** in `packages/shared` | Monorepo `pnpm type-check` clean |
| 3 | **Prisma migrations** (`OD` enum, `AttendanceCorrection` cols, `Holiday` model) + seed | `pnpm --filter backend db:migrate`, smoke run |
| 4 | **Read-side stubs implemented** in `attendance.service.ts` + repository helpers | New Vitest unit tests for each method; `pnpm --filter backend test` |
| 5 | **BFF aggregator + `/v1/student/attendance/monthly`** + admin holidays CRUD | `e2e:smoke` extended; `API_CONTRACT_MATRIX.md` updated |
| 6 | **Mobile tabs layout refactor** | Manual reachability check on every existing student screen |
| 7 | **New attendance screen + hook + service** | Visual diff against Images 1/4/5 |
| 8 | **Home card → push navigation, retire `history.tsx`** | No dead imports, monorepo type-check clean |
| 9 | **Mockup audit pass** | Every visible field traceable to a backend field. Documented in PR description. |

Phases 2–5 are backend-only and can be reviewed independently. Phases 6–8 are mobile-only.

---

## 8. Risks

| Severity | Risk | Mitigation |
|---|---|---|
| HIGH | Tabs refactor breaks a mid-flow screen (scanner, verify-arrival) | Phase 6 standalone PR; explicit screen-reachability checklist before merge |
| HIGH | Adding `OD` to `AttendanceStatus` enum requires Prisma migration on a populated DB | Migration is additive (enum value append), no rewrite; verify on staging clone |
| HIGH | Implementing stubs touches an event-sourced module — must not mutate `AttendanceEvent` rows | Code review enforces append-only; CLAUDE.md §4.3 invariant |
| MEDIUM | Calendar tile color must use IST date math | Every new query goes through `getISODateIST`; lint rule (optional) |
| MEDIUM | Holiday source-of-truth scope creep — admin UI for CRUD | V1 ships with backend + seed JSON only; admin UI is a follow-up |
| MEDIUM | Phone viewport (~360–414dp) can't fit calendar + holidays side-by-side | Stack vertically on small viewports; document in PR |
| LOW | Payload size for the month endpoint | Bounded: ≤31 days + ≤6 holidays + ≤~30 leave items. < 4 KB |
| LOW | "A" tab purpose | Hidden placeholder until decided |

---

## 9. Decisions to confirm before Phase 2

1. **OD as a new enum value** in `AttendanceStatus` — agreed?
2. **New `LeaveRequest` model** as the unified intimation entity (§13), instead of extending `AttendanceCorrection`. `AttendanceCorrection` stays for ops-driven corrections. Agreed? (Alternative: cram everything into `AttendanceCorrection`. Not recommended — conflates reactive corrections with proactive leave intent.)
   - 2a. Confirm `LeaveReason` enum coverage: `SICK / FAMILY_FUNCTION / TRAVEL / EXAM / SPORTS / NCC / CONFERENCE / CULTURAL / PERSONAL / OTHER`.
   - 2b. Confirm auto-accept policy thresholds in §13.3 (COMMON ≤ 2 days, ≥ 12 h before cutoff).
   - 2c. Confirm attachments are mandatory for `MEDICAL > 1 day` and **all** `OD`.
3. **`Holiday` model + admin seed** — agreed? (Alternative: static constants file in `packages/shared`. Faster but loses operability for the transport office.)
4. **"Missing" semantics** — surface PENDING/geofence-rejected logs **and** computed school-days-with-no-log, both routed through `leaves.missing[]`. Agreed?
5. **`OD` is not absence** — `attendancePct` denominator excludes OD days. Agreed?
6. **Tabs refactor** — OK to convert `(student)/_layout.tsx` from `Stack` to `Tabs`, with per-tab nested `Stack` for non-tab screens?
7. **Bottom-nav icon → screen mapping** in §6.1 — confirm the "A" tab's purpose. (If undecided: ship as hidden placeholder.)
8. **Calendar + Holidays vertical stack on phone widths** — acceptable, or do we want a horizontal-scroll holiday strip instead?

---

## 13. Leave intimation — the full flow

This is the workflow that produces the labels on every list card in the design ("common leave: Informed leave", "Medical leave: Informed leave", "common leave: not-informed leave"). Without this, the labels are mockup text.

### 13.1 The intimation channels

A student tells the system they will not be on the bus through one of three channels. All three converge on a single `LeaveRequest` row — the model is unified; the entry point is not.

| # | When | UX entry point | What is created | `informed` flag |
|---|---|---|---|---|
| 1 | **Before the trip date** (planned absence) | New `Apply Leave` pill button on the Attendance screen (mirrors the existing `WaitNotifyPill` visual language) | `LeaveRequest` covering one or more future dates | `true` |
| 2 | **Same day, before the trip starts** (sick this morning) | **Reuse the existing `WaitNotifyPill`** on `(student)/index.tsx` (currently below the trip card, routes to `self-report-prompt`). Replace its single-action behavior with a bottom sheet exposing two intents (§13.1.1) | `LeaveRequest` with `fromDate = toDate = today`, scoped to the relevant trip type | `true` |
| 3 | **After the fact** (system marked me absent, I had a reason) | Attendance screen → tap a `Missing` tab list item → "Request leave" | `LeaveRequest` linked to the existing `AttendanceLog`, retroactive | `false` |

### 13.1.1 Repurposing the home `WaitNotifyPill` for channel 2

The pill currently has one action: push to `/(student)/self-report-prompt`. That collapses two distinct intents into one screen. The redesign splits them:

- **`Hold the bus / I'm running late`** → existing self-report / wait flow, unchanged. Driver kiosk sees the existing wait request.
- **`Skip today / Apply same-day leave`** → opens the same `<ApplyLeaveSheet />` used by channel 1, pre-filled with `fromDate = toDate = today` and `tripScope` defaulted from the next scheduled trip type (MORNING vs RETURN).

Implementation: replace `handleNotifyPress` in `apps/mobile/app/(student)/index.tsx:74` with a sheet that presents the two options. The pill component itself stays — only its `onPress` handler changes and a new `<WaitOrLeaveSheet />` is introduced. No new pill on the home screen; the design language stays consistent with what's already there.

The same `<ApplyLeaveSheet />` is reused across channels 1, 2, and 3 — only the default values differ:

| Channel | Default `fromDate` / `toDate` | Default `tripScope` | Default `type` |
|---|---|---|---|
| 1 (planned, attendance screen) | today + 1 / today + 1 (user adjusts) | `BOTH` | `COMMON` |
| 2 (same-day, via home pill) | today / today | derived from next trip (MORNING_ONLY if before morning, RETURN_ONLY if after) | `COMMON` |
| 3 (retroactive, Missing list) | the log's date / the log's date | derived from the log's `tripType` | `COMMON` |

This keeps the form, validation, and POST logic in one place — three entry points, one sheet, one endpoint.

Channel 3 is the new "not-informed leave" — it replaces the existing student-facing `AttendanceCorrection` UX for leave-shaped corrections. `AttendanceCorrection` rows are still produced by ops-side flows (driver mark-present, GPS-outage finalization) and continue to feed admin queues.

### 13.2 What the student supplies

A single form, fields chosen so every visible label on the screen has a real source:

| Field | Required | Notes |
|---|---|---|
| `type` | yes | `COMMON` / `MEDICAL` / `OD` / `OTHER` — drives the card title |
| `fromDate` | yes | IST date, ≥ today for channels 1 and 2 |
| `toDate` | yes | IST date, ≥ `fromDate` |
| `tripScope` | yes | `BOTH` default; `MORNING_ONLY` / `RETURN_ONLY` for partial days |
| `reason` | yes | One of `LeaveReason` enum — keeps the data analyzable |
| `notes` | no | Free text, ≤ 280 chars |
| `attachmentUrl` | conditional | **Required** for `MEDICAL` with `toDate − fromDate ≥ 1` day, and for **all** `OD` requests. Uploaded via signed URL to Cloud Storage; URL stored on the row. |

Server-side validation in `packages/shared/src/schemas/leave-request.ts` rejects:

- past dates on channels 1 and 2,
- ranges > 14 days without coordinator review,
- `MEDICAL > 1 day` without an attachment,
- any `OD` without an attachment,
- overlapping `APPROVED` / `PENDING` ranges for the same `userId`.

### 13.3 Approval policy

Lives in `packages/shared/src/constants/leave-policy.ts` so both backend and admin UI see the same thresholds:

| Type | Duration | Cutoff | Outcome |
|---|---|---|---|
| `COMMON` | ≤ 2 consecutive days | ≥ 12 h before trip start | `AUTO_ACCEPTED` |
| `COMMON` | 3 – 7 days | any | `PENDING` → coordinator |
| `COMMON` | > 7 days | any | `PENDING` → transport officer |
| `MEDICAL` | any | any | `PENDING` → coordinator |
| `OD` | any | any | `PENDING` → faculty + coordinator |
| `OTHER` | any | any | `PENDING` → coordinator |
| Any | submitted < cutoff | — | `informed = false`, status follows the matrix above |

`AUTO_ACCEPTED` short-circuits the review queue. Audit-tracked the same way as `APPROVED`.

### 13.4 How `informed` is computed (server-side, never trusted from the client)

```
informed = (request.createdAt < tripStartIST(request.fromDate, request.tripScope))
        && (request.source IN { STUDENT_APP, COORDINATOR, FACULTY })
```

Retroactive requests (channel 3) are filed after the trip start by definition — `informed = false`. Same-day "skip today" filed before the bus rolls — `informed = true`. The field is set once at creation and never recomputed.

### 13.5 Storage — what gets written where

On `LeaveRequest` create:

1. Insert `LeaveRequest` row with `status = PENDING | AUTO_ACCEPTED` per policy.
2. Append an `AuditLog` row (`LEAVE_REQUEST_CREATED`).
3. If `AUTO_ACCEPTED` or `APPROVED`: expand to existing primitives so no downstream job needs to learn about leave:
   - For each date in `[fromDate, toDate]` matching `tripScope`, upsert a `TripSkip` row (the `mark-absent.job` already honors `TripSkip`).
   - If a trip already exists for that date, upsert an `AttendanceLog` with `status = EXCUSED` (for COMMON/MEDICAL/OTHER) or `status = OD` (for OD) and set `leaveRequestId`.
   - If the trip does not yet exist, the daily-trip-creation job (`create-daily-trips.job.ts`) reads `LeaveRequest` at materialization time and pre-seeds the log.
4. Enqueue a Cloud Task for notification dispatch.

On reviewer decision (`APPROVED` / `REJECTED`):

1. Update `LeaveRequest.status`, `reviewedBy`, `reviewedAt`, `reviewerNote`.
2. Append `AttendanceEvent` rows for every affected log (never mutate prior events — CLAUDE.md §4.3).
3. Emit `leave:status-changed` on `user:{userId}` and on the admin route room.
4. Cloud Task → push notification.

This means existing background jobs (`mark-absent.job`, `arrival-push-fallback`, `create-daily-trips`) **do not need to know what a LeaveRequest is** — they keep operating on `TripSkip` and `AttendanceLog`, which the leave flow materializes.

### 13.6 Endpoints (under `/v1/student/leave-requests/*`, all `mobileRoute(['STUDENT'])`)

```
POST   /v1/student/leave-requests                       (idempotent: idempotency:leave:<userId>:<key>)
GET    /v1/student/leave-requests?status=&month=        (caller's own)
GET    /v1/student/leave-requests/:id
POST   /v1/student/leave-requests/:id/cancel            (only if PENDING)
POST   /v1/student/leave-requests/attachment-url        (returns signed Cloud Storage upload URL)
```

Admin / coordinator surface (separate PR acceptable, but blocking real approvals):

```
GET    /v1/admin/leave-requests?status=&routeId=&type=
POST   /v1/admin/leave-requests/:id/approve
POST   /v1/admin/leave-requests/:id/reject
```

Capability gates: `leave_requests.review` for COORDINATOR-scoped, `leave_requests.review.all` for TRANSPORT_OFFICER. UI gate is advisory; backend re-checks (CLAUDE.md §10.1).

### 13.7 How the screen reads it back

The monthly endpoint from §5.6 already joins `AttendanceLog → LeaveRequest`. Each entry in `leaves.absent[]` / `leaves.od[]` returns:

```ts
interface LeaveItem {
  logId: string;
  date: string;
  leaveType: 'COMMON' | 'MEDICAL' | 'OD' | 'OTHER';   // from LeaveRequest.type
  informed: boolean;                                   // from LeaveRequest.informed
  reason: LeaveReason | null;
  status: LeaveStatus;                                 // PENDING / APPROVED / AUTO_ACCEPTED / REJECTED
  hasAttachment: boolean;
  correctionStatus: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';
}
```

Card rendering rules:

| Card label | Source |
|---|---|
| `common leave:` | `leaveType === 'COMMON'` |
| `Medical leave:` | `leaveType === 'MEDICAL'` |
| `OD:` | `leaveType === 'OD'` (also surfaces under the OD tab, not Absent) |
| `Informed leave` (subtitle) | `informed === true && status IN { APPROVED, AUTO_ACCEPTED }` |
| `not-informed leave` (subtitle) | `informed === false` (retroactive request) |
| `Pending review` (subtitle) | `status === 'PENDING'` |
| `Rejected` (subtitle, muted) | `status === 'REJECTED'` |

**Every label on the list cards now has exactly one backend field behind it.** The mockup-elimination audit table in §11 is updated accordingly.

### 13.8 What happens to `ABSENT` logs with no `LeaveRequest`

They live in the **Missing** tab — that's their definition. The screen shows them as date-only cards with a `Request leave` action that opens the retroactive form (channel 3). Filing one transitions the log from "absent without intimation" to "absent with not-informed leave" and the card moves from `Missing` → `Absent` with a `not-informed leave` subtitle on the next refresh.

### 13.9 Notifications

| Trigger | Recipient | Channel |
|---|---|---|
| `LeaveRequest` created, `AUTO_ACCEPTED` | Student | Push (`leave.accepted`) |
| `LeaveRequest` created, `PENDING` | Student | Push (`leave.received`) |
| `LeaveRequest` created, `PENDING` | Coordinator of student's route | Push + admin socket |
| `APPROVED` / `REJECTED` | Student | Push (`leave.decided`) |
| `MEDICAL > 1 day` without attachment uploaded within 24 h | Student | Push reminder |

### 13.10 What this replaces

- The current free-text-only `AttendanceCorrection` route from the student app is **deprecated for leave shapes.** Existing rows survive (the column is untouched). New student-initiated leave-shaped intent goes through `LeaveRequest`. Driver/coordinator-initiated corrections continue to use `AttendanceCorrection`.
- `TripSkip` stays as the low-level "skip morning/return today" primitive — `LeaveRequest` writes to it on approval. Long-term, `TripSkip` could be derived from `LeaveRequest`; not in this PR.

### 13.11 Phasing impact

Insert two phases between current Phase 5 and Phase 6:

| Phase | Deliverable | Validation |
|---|---|---|
| 5a | `LeaveRequest` model + leave-policy constants + student POST/GET/cancel endpoints + signed-URL upload + materialization into `TripSkip` / `AttendanceLog` | Unit tests for each policy branch; e2e smoke for student-app channel |
| 5b | Admin approve/reject endpoints + notification wiring + socket event registration | Update `SOCKET_EVENT_REGISTRY.md`; admin queue surfaces in command center |

Mobile screen work (current Phase 7) gains:

- `<ApplyLeaveSheet />` modal — type, dates, scope, reason, notes, attachment picker.
- Retroactive entry from Missing tab list items.
- `useLeaveRequest` hook (mutation + invalidation of `['student', 'attendance', month]`).

### 13.12 Risks specific to this flow

| Severity | Risk | Mitigation |
|---|---|---|
| HIGH | Approving a leave on a date that already had a successful check-in would silently overwrite a real attendance | Service refuses to attach to a log whose current `status` is `PRESENT` / `LATE_BOARD` / `MANUAL`. Reviewer sees a "conflicting attendance" warning |
| HIGH | A student spams `OD` requests with fake attachments | Attachments are reviewed; `OD` always requires faculty co-sign; abuse surfaces in audit log |
| MEDIUM | Attachments are PHI-adjacent (medical certs) | Signed URLs with 15-min TTL; bucket has uniform bucket-level access; admin download is audited |
| MEDIUM | A leave spanning a long range pre-empts attendance for too many days | 14-day soft cap before transport-officer escalation; admin can override |
| MEDIUM | Race between `mark-absent.job` and a same-day "skip today" leave filed at the cutoff | `mark-absent.job` re-reads `TripSkip` at execution time, not at enqueue time — already its existing behavior |
| LOW | Auto-accept policy too generous and abused | Policy lives in shared constants; tunable without code-side migration |

---

## 14. Out of scope (planned separately)

- **In-person class attendance.** Different data source (faculty marks, period-level), separate Prisma models, separate screen. To be planned in a follow-up doc.
- **Reconciliation endpoint** (`GET /v1/admin/attendance/reconcile?date=…` comparing `AttendanceEvent` vs Redis dashboard counters). Mentioned in the audit notes; valuable but not part of this redesign.
- **Partial index on `[userId, status]`** for monthly aggregate speedup — adds value when faculty role lands; defer.
- **Caching the RTDB read on the check-in hot path** behind a Redis TTL — write-path optimization, separate PR.
- **Admin holidays management UI** in `apps/admin` — backend ships now, admin UI follows.
- **Faculty/teacher view of student attendance** — separate role-scoped endpoint, not part of this PR.

---

## 15. Mockup-elimination audit (acceptance gate)

Every field on the screen must trace to a real backend field before merge:

| Visible element | Source |
|---|---|
| Avatar initial `K` | `user.name[0]` |
| Month label | Active state, defaulted from `getTodayDateKey()` |
| Day tile color | `days[i].status` |
| Holiday list | `holidays[]` from `Holiday` table |
| `90%` | `summary.attendancePct` |
| `6 Absent` | `summary.absentCount` |
| `2 OD` | `summary.odCount` |
| Tab counts | `leaves.absent.length` etc. |
| List date chip | `leaveItem.date` |
| List title (`common leave`, `Medical leave`, `OD`) | `LeaveRequest.type` joined via `AttendanceLog.leaveRequestId` |
| List subtitle (`Informed leave` / `not-informed leave`) | `LeaveRequest.informed` (server-computed, see §13.4) |
| List subtitle (`Pending review` / `Rejected`) | `LeaveRequest.status` |
| Tap action on a `Missing` card | Opens `<ApplyLeaveSheet />` in retroactive mode (channel 3, §13.1) — produces a `LeaveRequest` with `informed=false` |
| `Apply Leave` pill on the Attendance screen | Opens `<ApplyLeaveSheet />` in channel-1 mode → POST `/v1/student/leave-requests` |
| Home `WaitNotifyPill` (existing) | Opens `<WaitOrLeaveSheet />`; `Skip today` branch opens `<ApplyLeaveSheet />` in channel-2 mode; `Hold the bus` branch routes to existing `self-report-prompt` |

Any field that cannot be sourced is a blocker.

---

## 16. References

- `CLAUDE.md` §4 (architectural invariants), §5.2 (attendance is the reference module), §15.1 (how to add a backend route).
- `apps/backend/src/modules/attendance/attendance.service.ts:482–547` — stubs to implement.
- `apps/backend/src/modules/attendance/attendance.service.ts:186–201` — failed scans persisted (data source for `Missing` tab).
- `apps/backend/src/modules/attendance/attendance.service.ts:217–250` — write path (do not touch).
- `apps/backend/src/db/prisma/schema.prisma` — `AttendanceLog`, `AttendanceEvent`, `AttendanceCorrection`, `AttendanceStatus` enum.
- `packages/shared/src/utils/time.utils.ts` — `getISODateIST`, `getTodayDateKey`, `minutesToTimeString`.
- Images: `Screenshot 2026-05-13 150013.png`, `Screenshot 2026-05-13 150032.png` (and original full-screen reference).

---

**Awaiting confirmation on §9 before any code change.**
