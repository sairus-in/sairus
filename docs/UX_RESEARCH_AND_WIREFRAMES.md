# College Bus System — UX Research & Wireframes
> Covers: Admin Panel (web) + Mobile App (student + driver)
> Stack: React + Vite + Tailwind (admin) · React Native + Expo (mobile)
> Date: April 2026

---

## Part 1 — UX Research

### 1.1 User Personas

---

**PERSONA: Transport Officer**
Role: Full system administrator — owns fleet, routes, all students
Goal: Know the state of all 180 buses at any point during the morning window (6:30–10am) and respond to issues fast
Context: Desk + laptop, dual monitor possible. High-stress during boarding window. Occasionally on phone/tablet
Pain points today:
- Hard to spot which buses are delayed vs broken when watching 180 markers
- Correction requests pile up and get lost in email
- Breakdown escalation chain is informal (WhatsApp)
Success: Zero missed incidents during morning window. Corrections processed same day.
Frequency: Daily, heavy use 6am–10am
Technical comfort: High

---

**PERSONA: Route Coordinator**
Role: Manages their assigned routes (subset of fleet)
Goal: Handle attendance corrections for their students, message their drivers
Context: Shared office laptop, less intense than officer. Some mobile use.
Pain points today:
- Can't filter to just their routes — sees everything
- No record of driver messages — ad-hoc
Success: Corrections resolved < 24 hours. Driver communication in one place.
Frequency: Daily, lighter use
Technical comfort: Medium

---

**PERSONA: Student**
Role: Passenger — checks in via QR scan
Goal: Know where their bus is and not miss it
Context: Walking to bus stop, phone in one hand, bag in other. Low attention. High urgency in the morning.
Pain points today:
- Don't know if bus is running late until it doesn't show up
- QR scan fails and they don't know why
- Missed check-in corrections are confusing to submit
Success: Boards bus without stress. Checkin works first try.
Frequency: Daily, 2 sessions/day (morning + evening)
Technical comfort: Medium (18–22 age group, smartphone native)

---

**PERSONA: Driver**
Role: GPS transmitter + QR kiosk operator
Goal: Complete the route without disruption. Handle incidents fast.
Context: Phone mounted on dashboard. Driving. Cannot type. One thumb available at best.
Pain points today:
- QR screen turns off mid-kiosk (screen timeout)
- Breakdown reporting requires too many taps while stressed
- No confirmation that admin saw their message
Success: Kiosk stays on. Breakdown reported in < 3 taps. Trip ends cleanly.
Frequency: Daily, all-day use
Technical comfort: Low–Medium

---

### 1.2 Critical User Journeys

---

**JOURNEY: Admin Morning Ops Check**
Persona: Transport Officer
Trigger: 6:30am, buses starting to roll
Steps:
  1. Open admin panel → Dashboard loads → [needs: active trips count, breakdown alerts, fleet health at a glance]
  2. Scan fleet map for red/yellow markers → click incident → [needs: bus ID, driver, location, issue]
  3. Jump to Corrections queue → batch approve/reject → [needs: fast inline actions, no modal hell]
  4. Message driver if bus is delayed → [needs: thread, read receipts]
  5. Confirm all trips ended at 10am → done
Failure modes:
- Map takes > 5s to load all 180 markers → officer is blind during crisis
- Correction queue has no filters → must scroll through 200 items to find today's
- Breakdown alert buried in notification bell → missed

---

**JOURNEY: Student Morning Bus Check**
Persona: Student
Trigger: Waking up / walking to stop
Steps:
  1. Open app → Home → Bus card shows status + ETA in < 2 seconds
  2. [optional] Tap map → full tracking screen with animated marker
  3. Bus arrives → tap Scanner tab → QR scan
  4. Success screen → done
Failure modes:
- Home screen loads but bus card is blank/loading → student panics
- QR scan fails silently → student doesn't know if they're checked in
- Checkin success screen disappears before student reads it

---

**JOURNEY: Driver Trip + Kiosk**
Persona: Driver
Trigger: Arrives at depot, starts morning route
Steps:
  1. Open app → Home → "Start Trip" → confirm route preview
  2. Begin driving → app goes to kiosk mode (large QR on screen)
  3. Students scan at each stop → counter increments
  4. [if breakdown] Long-press breakdown button → report screen → 3 taps → submitted
  5. Arrive at college → tap "End Trip" → summary shown
Failure modes:
- "Start Trip" not prominent enough → driver doesn't activate GPS
- Kiosk screen dims/locks during operation → QR invisible, students pile up
- Breakdown report > 3 taps while panicking → driver gives up

---

### 1.3 Pain Point Inventory

| Pain Point | Persona | Severity | Type |
|---|---|---|---|
| 180 bus markers look identical — hard to spot issues | Transport Officer | Critical | Confusion |
| Corrections queue has no date/route filter | Coordinator | High | Missing info |
| Map load time during peak window | Transport Officer | Critical | Latency |
| Bus status card slow to load on home screen | Student | Critical | Latency |
| QR scan failure gives no clear error | Student | High | Confusion |
| Kiosk screen dims during trip | Driver | Critical | Latency |
| Breakdown report requires too many taps | Driver | High | Error recovery |
| Driver message has no read receipt | Coordinator | Medium | Trust |
| Correction rejection reason not visible to student | Student | High | Missing info |
| No offline fallback for home screen | Student | High | Error recovery |

---

### 1.4 Research Synthesis

**Core insight:** Two products with opposite density needs share one codebase assumption.
The admin panel needs maximum data density (officer tracking 180 buses simultaneously).
The mobile app needs maximum glanceability (student checking ETA while walking).
Design decisions that work for one will actively harm the other. Treat them as completely separate design systems.

**Users ranked by design-criticality:**
1. Student — highest frequency, lowest attention, highest abandonment risk if UX fails
2. Driver — safety-critical context (driving), one-thumb operation required
3. Transport Officer — power user who can tolerate complexity but cannot tolerate slowness
4. Coordinator — secondary, tolerates moderate complexity

**Top 3 design mandates:**
1. Admin: Status must be scannable — color-coded bus states readable in 1 second, no hovering required
2. Mobile: Home screen ETA must load under 2 seconds and survive no-network with cached data
3. Driver: Every critical action (start trip, report breakdown) must be reachable in ≤ 3 taps, large touch targets

**Top 3 anti-patterns to avoid:**
1. Generic SaaS dashboard with equal-weight cards — admin needs clear hierarchy (map first)
2. Bottom-nav-heavy mobile UI where the primary action (QR scan) is buried
3. Modal-based approval workflows for corrections — inline table actions only

---

## Part 2 — Information Architecture

### 2.1 Admin Panel Navigation

```
Admin Panel (sidebar)
├── Dashboard              ← landing, overview stats + fleet health
├── Fleet Map              ← full-screen, 180 live markers
├── Operations
│   ├── Active Trips       ← live trip list with status
│   ├── Trip Detail        ← single trip drill-down
│   └── GPS Outage Queue   ← buses not reporting GPS
├── Attendance
│   ├── Corrections Queue  ← approve/reject
│   └── Audit Log          ← immutable history
├── Incidents              ← breakdown reports + escalation
├── Students               ← list, import, detail
├── Fleet
│   ├── Buses              ← bus inventory
│   └── Drivers            ← driver list
├── Routes                 ← route editor, stop sequences
├── Messages               ← admin↔driver threads
└── Settings (officer only)
    ├── Admin Users        ← invite/deactivate
    └── System Config
```

### 2.2 Mobile — Student Navigation

```
Student App (bottom nav)
├── Home          ← bus status, ETA, quick actions
├── Scanner       ← QR camera view (primary action tab)
├── Map           ← full live tracking map
├── History       ← past check-ins, corrections
└── Profile       ← account, notifications, help
```

### 2.3 Mobile — Driver Navigation

```
Driver App (bottom nav)
├── Home          ← trip start, pre-departure info
├── Kiosk         ← QR display for student scans (primary)
├── Route         ← route preview, stop list
├── Messages      ← admin↔driver thread
└── Profile       ← account, trip history
```

---

## Part 3 — Admin Panel Wireframes

### 3.1 Login

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│           [College Name] · Bus Management            │
│                                                      │
│         ┌────────────────────────────────┐           │
│         │  Email address                 │           │
│         └────────────────────────────────┘           │
│         ┌────────────────────────────────┐           │
│         │  Password                 [👁] │           │
│         └────────────────────────────────┘           │
│                                                      │
│         [         Sign In         ]  ← primary CTA  │
│                                                      │
│              Forgot password?                        │
│                                                      │
│  ─────────────────────────────────────────────────  │
│  [Error banner: "Too many attempts. Try in 12m."]   │
└──────────────────────────────────────────────────────┘

States: default / loading / error (wrong creds) / locked (rate limit)
Notes:
[A] Email field — autofocus on load
[B] Password field — toggle visibility, no autocomplete on shared devices
[C] Error banner — anchored to top of form, not toast (can't dismiss)
[D] Locked state — shows countdown, disables button
```

---

### 3.2 Dashboard (Transport Officer view)

```
┌─────────┬──────────────────────────────────────────────────┐
│  SIDEBAR│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐           │
│         │  │ 164  │ │  12  │ │   3  │ │  47  │  STAT STRIP│
│  Dash.  │  │Active│ │Delay │ │Break │ │ Corr.│           │
│  Fleet  │  └──────┘ └──────┘ └──────┘ └──────┘           │
│  Ops ▼  │                                                  │
│  Attend.│  ┌──────────────────────────────────────────┐   │
│  Incid. │  │                                          │   │
│  Stud.  │  │           FLEET MAP (primary)            │   │
│  Fleet  │  │       180 bus markers, live              │   │
│  Routes │  │       green/yellow/red states            │   │
│  Msg.   │  │                                          │   │
│  ─────  │  │                                          │   │
│  [Role] │  └──────────────────────────────────────────┘   │
│  [Name] │                                                  │
│  Logout │  ┌──────────────────┐ ┌───────────────────┐     │
└─────────┘  │ CORRECTIONS      │ │ INCIDENTS         │     │
             │ [3 pending items]│ │ [1 active]        │     │
             │ > View all       │ │ > View all        │     │
             └──────────────────┘ └───────────────────┘     │
```

**Annotations:**
```
[A] Stat strip — 4 KPIs: Active Trips | Delayed Buses | Breakdowns | Pending Corrections
    Colors: Delayed = yellow bg, Breakdowns = red bg (when > 0)
    All are clickable — navigate to relevant section
[B] Fleet map — occupies ~60% of viewport height
    Loads immediately with cached positions, updates via Socket.io
    Marker colors: green (on-route) | yellow (delayed >5min) | red (breakdown)
[C] Corrections preview — latest 3 pending items, "View all" links to full queue
[D] Incidents preview — active incidents with severity badges
[E] Sidebar — collapsible on smaller screens. Role label shows current permissions scope
```

---

### 3.3 Fleet Map (full page)

```
┌─────────┬──────────────────────────────────────────────────┐
│  SIDEBAR│  [Search bus / driver...]  [Filter: All Routes ▼]│
│         │                                                   │
│         │  ┌───────────────────────────────────────────┐   │
│         │  │                                           │   │
│         │  │         FULL SCREEN MAP                   │   │
│         │  │                                           │   │
│         │  │  🟢 🟢 🟡 🟢 🔴 🟢 🟢 🟢 🟡 🟢         │   │
│         │  │     (180 animated bus markers)            │   │
│         │  │                                           │   │
│         │  └───────────────────────────────────────────┘   │
│         │                                                   │
│         │  ┌──────────────────────────────────────────┐    │
│         │  │ [Bus #23 · Route 5A]            [×]      │    │
│         │  │ Driver: Rajan Kumar                       │    │
│         │  │ Speed: 42 km/h  Last ping: 8s ago         │    │
│         │  │ Status: On Route · ETA college: 18 min    │    │
│         │  │ Students checked in: 34                   │    │
│         │  │  [View Trip]  [Message Driver]            │    │
│         │  └──────────────────────────────────────────┘    │
└─────────┘                                                   │
```

**Annotations:**
```
[A] Search — filters visible markers to matching bus/driver
[B] Route filter — show all OR filter to single route's buses
[C] Bus marker popup — appears on click, not hover (mobile admin possible)
    Shows: driver name, speed, last GPS ping age, ETA, checkin count
[D] "View Trip" → Trip Detail page
[E] "Message Driver" → opens message thread in drawer (no page navigation)
[F] Popup auto-closes if user clicks elsewhere
[G] Stale GPS (> 60s) → marker turns grey with warning icon
```

---

### 3.4 Corrections Queue

```
┌─────────┬─────────────────────────────────────────────────┐
│  SIDEBAR│  Corrections                    [Export CSV]    │
│         │                                                  │
│         │  Filter: [Status: Pending ▼] [Route: All ▼] [Date: Today ▼]│
│         │                                                  │
│         │  ┌──────────────────────────────────────────┐   │
│         │  │ □  Student    │ Date  │ Requested │ Reason│ Actions │
│         │  ├──────────────────────────────────────────┤   │
│         │  │ □  Arjun K.   │ Apr 17│ Present   │ Was  │[✓][✗] │
│         │  │               │       │ (was: Abs)│ there│       │
│         │  ├──────────────────────────────────────────┤   │
│         │  │ □  Priya S.   │ Apr 17│ Excused   │ Sick │[✓][✗] │
│         │  ├──────────────────────────────────────────┤   │
│         │  │ □  Karthik M. │ Apr 16│ Present   │ QR   │[✓][✗] │
│         │  │               │       │           │ fail │       │
│         │  └──────────────────────────────────────────┘   │
│         │                                                  │
│         │  [Select All]  [Bulk Approve]  [Bulk Reject]     │
│         │                      Showing 1–20 of 47          │
└─────────┘                                                  │
```

**Annotations:**
```
[A] Filter bar — Status (Pending/Approved/Rejected/All), Route, Date range
    Filters persist in URL so coordinators can bookmark their view
[B] Table rows — expandable on click to show full reason + evidence
[C] Approve/Reject inline buttons — no modal. Confirm on first click only
[D] Bulk actions — only visible when ≥ 1 row selected
[E] Rejection requires a reason (inline input, not modal)
[F] Approved/Rejected rows show who actioned them and when
```

---

### 3.5 Incidents

```
┌─────────┬─────────────────────────────────────────────────┐
│  SIDEBAR│  Incidents                                       │
│         │                                                  │
│         │  [Filter: Active ▼]  [Severity: All ▼]          │
│         │                                                  │
│         │  ┌────────────────────────────────────────┐     │
│         │  │ 🔴  Bus #47 · Route 3B                 │     │
│         │  │     Mechanical breakdown — Engine fail  │     │
│         │  │     Driver: Murugan P. · 7:23am         │     │
│         │  │     Location: Near Tambaram signal      │     │
│         │  │     [Acknowledge]  [View on Map]        │     │
│         │  ├────────────────────────────────────────┤     │
│         │  │ 🟡  Bus #12 · Route 1A                 │     │
│         │  │     Flat tyre — Waiting for support     │     │
│         │  │     Driver: Selvam K. · 7:41am          │     │
│         │  │     ✓ Acknowledged by: Priya (7:43am)   │     │
│         │  │     [Mark Resolved]  [Message Driver]   │     │
│         │  └────────────────────────────────────────┘     │
└─────────┘                                                  │
```

**Annotations:**
```
[A] Status colors: Red = Reported (unack'd) | Yellow = Acknowledged | Green = Resolved
[B] Each card shows: bus, route, incident type, driver, time, location, who ack'd
[C] "Acknowledge" → marks incident + records who/when → changes to "Mark Resolved"
[D] "View on Map" → Fleet Map, zoomed to that bus
[E] "Message Driver" → thread drawer, no page leave
[F] Resolved incidents collapse into history section at bottom
```

---

### 3.6 Students List

```
┌─────────┬─────────────────────────────────────────────────┐
│  SIDEBAR│  Students           [Import CSV]  [+ Add Student]│
│         │                                                  │
│         │  [Search name / ID...]  [Route: All ▼]  [Dept ▼]│
│         │                                                  │
│         │  ┌──────────────────────────────────────────┐   │
│         │  │  Name         │ ID     │ Route │ Bus │ Status│
│         │  ├──────────────────────────────────────────┤   │
│         │  │  Arjun Kumar  │ CS2023 │ 5A    │ #23 │ 🟢    │
│         │  │  Priya S.     │ ME2022 │ 2B    │ #11 │ 🔴 Abs│
│         │  │  Karthik M.   │ CS2024 │ 5A    │ #23 │ 🟢    │
│         │  └──────────────────────────────────────────┘   │
│         │                    Showing 1–50 of 2,847         │
│         │                                                  │
│         │  Bulk Import — CSV format:                       │
│         │  name, roll_no, department, route_id, phone      │
└─────────┘                                                  │
```

---

### 3.7 Messages (Admin ↔ Driver)

```
┌─────────┬──────────────────┬─────────────────────────────┐
│  SIDEBAR│  THREAD LIST     │  THREAD: Bus #23 · Rajan K. │
│         │                  │                             │
│         │  [Search driver] │  Apr 17, 7:42am             │
│         │                  │  ┌─────────────────────┐    │
│         │  Bus #23 · Rajan │  │ You: ETA update?    │    │
│         │  "Running 10min" │  └─────────────────────┘    │
│         │  7:44am     ●    │          ┌──────────────┐    │
│         │  ─────────────── │          │ Rajan: 10min │    │
│         │  Bus #11 · Selvam│          │ delay, tyre  │    │
│         │  "All good"      │          └──────────────┘    │
│         │  6:58am          │  ┌─────────────────────┐    │
│         │                  │  │ You: Acknowledged,  │    │
│         │                  │  │ support on way      │    │
│         │                  │  └─────────────────────┘    │
│         │                  │                             │
│         │                  │  ─────────────────────────  │
│         │                  │  [Type a message...  ] [Send]│
└─────────┘                  └─────────────────────────────┘
```

---

## Part 4 — Mobile Wireframes

### 4.1 Student: Home Screen

```
┌──────────────────────────┐
│  Good morning, Arjun 👋  │  ← greeting + avatar (top-right)
│                          │
│  ┌────────────────────┐  │
│  │  Bus #23 · Route 5A│  │  ← primary bus card
│  │                    │  │
│  │  🟢 On the way     │  │  ← status badge (color-coded)
│  │                    │  │
│  │  Arriving in       │  │
│  │     12 min         │  │  ← ETA (large, most prominent)
│  │                    │  │
│  │  [──────────●──────│  │  ← mini route progress bar
│  │  Stop 3 of 8       │  │
│  └────────────────────┘  │
│                          │
│  ┌───────┐  ┌──────────┐ │
│  │ Skip  │  │ Wait for │ │  ← soft secondary actions
│  │ today │  │   me     │ │
│  └───────┘  └──────────┘ │
│                          │
│  Tap to track live →     │  ← link to map screen
│                          │
├──────────────────────────┤
│  🏠    📷    🗺    📋  👤  │  ← bottom nav
│ Home Scanner Map Hist Profile│
└──────────────────────────┘

States:
- Loading: skeleton card, shimmer
- No bus assigned: "No bus assigned — contact coordinator" + action button
- Bus breakdown: 🔴 card, "Your bus reported a breakdown. Alternate arrangement pending."
- Offline: cached ETA shown with "Last updated 3 min ago" banner
```

**Annotations:**
```
[A] Bus card — entire card tappable → goes to Map screen
[B] ETA — largest text on screen, updates in real-time via Firebase
[C] Route progress bar — shows bus position relative to student's stop
[D] Skip today — POST /attendance/skip-today, confirmation bottom sheet
[E] Wait for me — POST /attendance/wait-for-me, notifies driver
[F] Bottom nav — Scanner is tab 2 (second most important action after home)
```

---

### 4.2 Student: QR Scanner

```
┌──────────────────────────┐
│  ←  Scan QR Code         │  ← back button
│                          │
│  ┌────────────────────┐  │
│  │  Bus #23 · Route 5A│  │  ← pre-filled from student's route
│  └────────────────────┘  │
│                          │
│  ┌────────────────────┐  │
│  │                    │  │
│  │    [CAMERA VIEW]   │  │  ← full camera
│  │                    │  │
│  │    ┌──────────┐    │  │
│  │    │          │    │  │  ← QR target overlay (animated corners)
│  │    │          │    │  │
│  │    └──────────┘    │  │
│  │                    │  │
│  └────────────────────┘  │
│                          │
│  Point camera at the QR  │
│  code on the bus kiosk   │
│                          │
│  Having trouble?         │
│  [Request manual check-in]│
└──────────────────────────┘

Error states (bottom sheet, not navigation):
- "Wrong bus — you're assigned to Bus #23, this is Bus #11"
- "Already checked in today at 7:34am"
- "QR code expired — ask driver to refresh"
- "No internet — scan will retry when connected"
```

---

### 4.3 Student: Check-in Success

```
┌──────────────────────────┐
│                          │
│                          │
│         ✅               │  ← large, animated checkmark (green)
│                          │
│   Checked in!            │
│                          │
│   Bus #23 · Route 5A     │
│   7:34 AM · Apr 17       │
│                          │
│   Driver: Rajan Kumar    │
│   Stop: Tambaram         │
│                          │
│                          │
│   [  Done  ]             │  ← returns to Home
│   [View trip on map]     │  ← secondary
│                          │
└──────────────────────────┘

Notes:
- Auto-dismisses to Home after 4 seconds if no interaction
- Green background or large checkmark (not both — not celebratory)
- Never auto-dismiss with a countdown that can't be paused
```

---

### 4.4 Student: Check-in Fail

```
┌──────────────────────────┐
│                          │
│         ❌               │  ← red X, no animation (not celebratory)
│                          │
│   Check-in failed        │
│                          │
│   [Reason displayed here]│  ← clear, plain English reason
│   e.g., "QR code expired.│
│   Ask your driver to     │
│   refresh the screen."   │
│                          │
│   [Try again]            │  ← returns to scanner
│   [Report an issue]      │  ← opens correction request flow
│                          │
└──────────────────────────┘
```

---

### 4.5 Student: Map (Live Tracking)

```
┌──────────────────────────┐
│  ←  Bus #23 · Route 5A   │
│                          │
│  ┌────────────────────┐  │
│  │                    │  │
│  │    [FULL MAP]      │  │
│  │                    │  │
│  │  🚌 ←→ animated   │  │  ← bus marker, smooth animation
│  │                    │  │
│  │  📍 (my stop)      │  │  ← user's stop highlighted
│  │                    │  │
│  │  Route stops shown │  │  ← route polyline + stop markers
│  └────────────────────┘  │
│                          │
│  ┌────────────────────┐  │  ← bottom sheet
│  │  Arriving in 12min │  │  ← ETA
│  │  Current stop: #3  │  │
│  │  Speed: 38 km/h    │  │
│  └────────────────────┘  │
└──────────────────────────┘
```

---

### 4.6 Student: Attendance History

```
┌──────────────────────────┐
│  Attendance History      │
│                          │
│  [This week ▼]           │  ← date filter
│                          │
│  ┌────────────────────┐  │
│  │  Mon Apr 14   ✅   │  │
│  │  Tue Apr 15   ✅   │  │
│  │  Wed Apr 16   ❌ Abs│  │
│  │               [Request correction →]│
│  │  Thu Apr 17   ✅   │  │
│  └────────────────────┘  │
│                          │
│  Present: 3  Absent: 1   │
│  Corrections pending: 0  │
└──────────────────────────┘
```

---

### 4.7 Student: Correction Request Flow

```
Screen 1: Select Date
┌──────────────────────────┐
│  ← Request Correction    │
│                          │
│  Which date?             │
│  [Calendar — last 7 days]│
│                          │
│  [Next →]                │
└──────────────────────────┘

Screen 2: Reason
┌──────────────────────────┐
│  ← Request Correction    │
│                          │
│  What happened?          │
│                          │
│  ○ I was present but     │
│    QR scan failed        │
│  ○ I boarded a           │
│    substitute bus        │
│  ○ Other                 │
│                          │
│  [Describe in detail...] │
│                          │
│  [Submit Request]        │
└──────────────────────────┘

Screen 3: Confirmation
┌──────────────────────────┐
│         ✅               │
│  Correction submitted    │
│                          │
│  Your coordinator will   │
│  review within 24 hours  │
│                          │
│  You'll get a            │
│  notification when done  │
│                          │
│  [Back to History]       │
└──────────────────────────┘
```

---

### 4.8 Driver: Home (Pre-Trip)

```
┌──────────────────────────┐
│  Good morning, Rajan 👋  │
│                          │
│  ┌────────────────────┐  │
│  │  Today's Trip      │  │
│  │  Route 5A          │  │
│  │  Bus #23           │  │
│  │  Expected: 87 students│
│  │  Depart: 7:00 AM   │  │
│  └────────────────────┘  │
│                          │
│  ┌────────────────────┐  │
│  │                    │  │
│  │    START TRIP      │  │  ← large primary button, full width
│  │                    │  │
│  └────────────────────┘  │
│                          │
│  [Preview Route]         │  ← secondary
│                          │
├──────────────────────────┤
│  🏠   📟   🗺   💬   👤  │
│Home Kiosk Route Msgs Profile│
└──────────────────────────┘

Notes:
- GPS activation starts on "Start Trip" tap, not before
- Route preview opens sheet with stop list + map
- "Start Trip" button disabled if no trip assigned for today
```

---

### 4.9 Driver: Kiosk Mode (Full Screen)

```
┌──────────────────────────┐
│  Bus #23 · Route 5A      │  ← small header, dims after 5s
│                          │
│  ┌────────────────────┐  │
│  │                    │  │
│  │    [QR CODE]       │  │  ← large, centered, full-width
│  │                    │  │
│  │  Refreshes in 28s  │  │  ← countdown timer below QR
│  │                    │  │
│  └────────────────────┘  │
│                          │
│  Students: 47 / 87       │  ← checkin counter
│                          │
│  ┌─────┐       ┌───────┐ │
│  │ End │       │ 🚨    │ │  ← End trip (left) · Breakdown (right, red)
│  │Trip │       │Report │ │  ← Both require confirmation tap
│  └─────┘       └───────┘ │
└──────────────────────────┘

Notes:
[A] Screen stays on — expo-keep-awake + expo-brightness max enabled in this mode
[B] QR auto-refreshes on a timer — matches backend TTL
[C] Checkin counter increments in real-time via Socket.io
[D] End Trip + Breakdown require a 2nd confirmation to prevent accidents
[E] Entire screen is the "kiosk" — no other nav accessible without unlocking
[F] Unlock gesture: swipe down from top × 3 (prevents accidental exits)
```

---

### 4.10 Driver: Breakdown Report

```
┌──────────────────────────┐
│  🚨 Report Breakdown     │  ← red accent, serious context
│                          │
│  Location               │
│  📍 Auto-detected        │  ← from GPS, editable
│  "Tambaram Signal, OMR" │
│                          │
│  What happened?          │
│  ○ Mechanical failure    │
│  ○ Flat tyre             │
│  ○ Accident              │
│  ○ Fuel empty            │
│  ○ Other                 │
│                          │
│  [Optional: add details] │  ← text field, not required
│                          │
│  ┌────────────────────┐  │
│  │   REPORT BREAKDOWN │  │  ← full-width, red
│  └────────────────────┘  │
└──────────────────────────┘

After submit:
┌──────────────────────────┐
│  ✅ Admin notified       │
│  Students being alerted  │
│                          │
│  Support is on the way.  │
│  Stay with the vehicle.  │
│                          │
│  Admin will message you. │
│  [View Messages]         │
└──────────────────────────┘

Notes:
- Location auto-filled, must be editable (GPS may be wrong)
- Incident type radio — required field, tap to select
- Details — optional, soft keyboard optional
- Max 3 taps from kiosk to report submitted (kiosk → report type select → confirm)
```

---

## Part 5 — Component Inventory

### Admin Panel Components

| Component | Status | Screens |
|---|---|---|
| Sidebar nav | Likely exists | All |
| Stat strip (KPI cards) | Likely exists | Dashboard |
| Fleet map + markers | Exists (needs UX polish) | Dashboard, Fleet Map |
| Bus marker popup | New | Fleet Map |
| Corrections table | Likely exists | Corrections |
| Inline approve/reject | New (likely modal now) | Corrections |
| Incident card | New | Incidents |
| Student data table | Likely exists | Students |
| CSV import modal | Likely exists | Students |
| Messaging thread | New | Messages |
| Route filter dropdown | New | Fleet Map, Corrections |
| Status badges (bus states) | New | Fleet Map, Dashboard |

### Mobile Components

| Component | Status | Screens |
|---|---|---|
| Bus status card | Likely exists | Home |
| ETA display | Likely exists | Home, Map |
| Route progress bar | New | Home |
| QR camera scanner | Exists | Scanner |
| Checkin result screen | Exists | Checkin success/fail |
| Live map | Likely exists | Map |
| Bottom sheet (bus info) | New | Map |
| Attendance list | Likely exists | History |
| Correction flow (multi-step) | Likely exists | Correction |
| Driver kiosk screen | Exists | Kiosk |
| Breakdown report form | Likely exists | Breakdown |
| Confirmation bottom sheet | New | Kiosk (End trip, breakdown) |

---

## Part 6 — Design Direction (Pre-Consultation Notes)

### Admin Panel Visual Direction

- **Aesthetic:** Industrial/Utilitarian — data-dense, function-first, no decoration
- **Color system:** Dark sidebar + white content area. Status colors are the only accent: green/yellow/red for bus states
- **Typography:** Geist (data tables, monospace numbers) + DM Sans (labels, UI text)
- **Density:** Compact — coordinators need to see 50+ corrections without scrolling
- **Motion:** Minimal — only map marker animation, no page transitions

### Mobile Visual Direction

- **Aesthetic:** Clean and direct — students are stressed in the morning, not looking for beauty
- **Color system:** Light mode primary (outdoor readability). Green/yellow/red for bus status. Blue for actions.
- **Typography:** Plus Jakarta Sans (body, labels) — friendly, readable at small sizes
- **Density:** Spacious — large touch targets (min 48px), generous padding
- **Motion:** Purposeful — bus marker animation, checkin success animation only

---

## Build Priority Order

### Admin Panel
1. Login + auth guard (already exists but had auth bypass — verify fixed)
2. Dashboard stat strip + fleet map (core daily use)
3. Corrections queue with inline approve/reject
4. Incidents with acknowledge/resolve
5. Messages (admin↔driver thread)
6. Students list + CSV import
7. Fleet/drivers/routes management

### Mobile — Student
1. Home screen bus card + ETA (highest frequency, highest impact)
2. QR scanner + checkin success/fail
3. Map (live tracking)
4. History + correction request flow
5. Profile

### Mobile — Driver
1. Home + Start Trip
2. Kiosk mode (QR display, keep-awake)
3. Breakdown report
4. Route preview
5. Messages
