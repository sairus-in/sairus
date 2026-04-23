# Admin Portal Audit And Execution Plan

Date: 2026-03-31

## Product Verdict

The next major focus should be the admin portal, but not as a generic UI polish effort.

The highest-value work now is:

1. Complete the operator action workflows in `apps/admin`
2. Close admin workflow gaps between existing backend capability and the web UI
3. Defer deep infra/runtime validation until credentials and secrets are provisioned

Security and reliability should not be ignored, but they are no longer the immediate product bottleneck. The system already has meaningful security and ops foundations. What is still incomplete is the control surface that transport staff actually use to run the system.

## What Is Already Built

The admin app is not a blank slate. It already has:

- Session bootstrap, role/capability gating, login, and MFA screens
- Two shells: live operations and data admin
- Live dashboard, fleet map, trip detail, messages, incidents, GPS outage queue
- Student list, CSV import wizard, route editor, bus list, driver list, corrections, attendance reports
- React Query data layer and admin socket wiring

Static health today:

- `pnpm.cmd --filter admin type-check` passes
- `pnpm.cmd --filter admin build` did not complete in this sandbox because Vite/esbuild hit `spawn EPERM`, so build output was not verified here

## PM Assessment

The control tower exists, but several of the most important workflows are still incomplete or partially simulated.

This means the correct priority is not "UI/UX vs security vs reliability" as three equal lanes.
The correct priority is:

1. Admin feature completeness for live operations
2. Admin feature completeness for data operations
3. Reliability hardening of admin-backed workflows
4. Visual/interaction polish after the workflows are truly operable

## Highest-Risk Gaps

### P0: Operator actions are weaker than operator visibility

The app can see a lot, but it cannot yet resolve enough.

- Incidents screen is mostly read-only. It exposes `View Trip` and a non-wired `Contact` button, but no clear resolve/escalate/substitute workflow.
- GPS outage queue supports coordinator override, but there is no admin UI for delegate/substitute selection even though delegation logic exists in the backend.
- Messages exist, but they are still a lightweight thread UI rather than an operational comms console tied to incidents and outages.

Impact:

- Transport staff can detect problems but still need side channels to recover operations.

### P0: The substitution/delegate engine has backend support but no admin control surface

Verified from code:

- Delegation exists in backend under `apps/backend/src/modules/trips/delegate.service.ts`
- Admin UI currently only surfaces delegate state in outage cards
- No admin workflow exists to choose a substitute bus/driver or activate a delegation path

Impact:

- One of the most important morning-ops workflows is missing from the admin product.

### P0: Reporting is not production-real yet

Verified from code:

- `apps/admin/src/pages/data/AttendanceReports.tsx` still uses mock trend data
- `apps/backend/src/modules/admin/reports.service.ts` simulates async work with Redis plus `setTimeout`
- Returned report URLs are placeholder GCS links

Impact:

- Reporting exists as a prototype, not an operational export system.

### P1: Data admin is functional but incomplete as a system-of-record UI

Current data pages are mostly list and mutation surfaces, but not full management consoles.

- Student list has search/filter/import, but no row detail editor
- Bus and driver pages support listing and deactivation, but not add/edit flows in the UI
- Route editor supports stop reorder/time edits, but not route creation, stop creation, or geographic editing
- Unassigned student assignment is executed sequentially one student at a time

Impact:

- Common admin tasks still feel like partial tools rather than complete workflows.

### P1: Route concurrency protection exists in backend but is not honored by the UI

Verified from code:

- Backend expects `If-Unmodified-Since` or `expectedUpdatedAt` for route stop updates
- Current route editor does not send either value

Impact:

- Concurrent route edits can still surprise admins from the UI layer even though the backend was designed to prevent that.

### P1: Fleet map is a strong surface but depends on credentials later

The map and Firebase listener architecture are already in place, which is good.
But full runtime validation still depends on Google Maps and Firebase configuration.

Impact:

- The screen is worth building now, but final acceptance waits on environment setup.

## Recommended Focus Order

### Phase 1: Live Ops Completion

Goal: make the admin portal capable of handling real morning incidents without external coordination.

Build next:

- Incident action panel: resolve, annotate, escalate, open message thread
- Substitute/delegate command flow from outage and incident screens
- Trip-level operator actions in trip detail
- Better linkage between alerts, incidents, outages, and active comms

Definition of done:

- An operator can move from alert to decision to action from inside the admin portal
- No major outage or breakdown workflow requires manual database work or an out-of-band process

### Phase 2: Data Console Completion

Goal: make transport office setup and maintenance self-serve.

Build next:

- Add/edit bus flows
- Add/edit driver flows
- Student detail/edit panel
- Bulk assignment improvements
- Route management expansion: create route, create/edit stop, map coordinates, route metadata

Definition of done:

- Core transport data can be created, edited, assigned, and deactivated fully from the web UI

### Phase 3: Reporting And Operational Backoffice

Goal: convert prototype admin reporting into actual institutional tooling.

Build next:

- Real report generation pipeline
- Real downloadable artifacts
- Filterable analytics instead of mock trend cards
- Import session drill-down with row-level failures and retry paths

Definition of done:

- Attendance and operations reporting can be used by transport office and management without engineering support

### Phase 4: UX Polish And Workflow Compression

Goal: improve speed and clarity for staff after the workflows are complete.

Build next:

- Faster cross-navigation between live ops entities
- Clearer action hierarchy on dense screens
- Better empty/error/loading states
- Reduced polling where sockets can drive state
- More intentional visual prioritization for urgent conditions

Definition of done:

- The portal feels fast and decisive under morning operations load

## Concrete Backlog

### Sprint A: Must Do Next

- Build substitute/delegate admin workflow
- Add incident resolution and escalation actions
- Add trip command panel in trip detail
- Replace the non-functional incident `Contact` affordance with a real action path
- Wire route editor concurrency token handling

### Sprint B: Complete Data Admin

- Add create/edit forms for buses and drivers
- Add student detail drawer with edit and assignment controls
- Replace sequential unassigned-student assignment with bulk-capable backend/UI flow
- Expand route management beyond reorder-only editing

### Sprint C: Replace Simulations

- Replace mocked attendance reporting path
- Replace mock attendance trend chart with backend-backed metrics
- Add import failure drill-down and retry actions

## What Not To Prioritize First

- Pure visual redesign before action workflows are complete
- Deep infra automation before the admin product loop is usable end to end
- Late-stage load testing before operator workflows are done

Those are important, but they are not the current bottleneck to making the product complete.

## Final Recommendation

Focus now on `apps/admin`, with the first milestone centered on live operations actions, not just more screens.

If we want the product to feel complete, the next question is not "How do we make the UI prettier?"
It is:

"Can a transport officer detect, decide, and recover from a real bus operation failure entirely from the admin portal?"

Right now the answer is close, but still not fully yes.
