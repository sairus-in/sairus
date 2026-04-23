# College Bus Management System
# Admin Panel — Complete Technical Summary
# For Continued Development

> Written: April 2026
> Purpose: Complete reference for developers continuing admin panel work.
> Covers: frontend architecture, backend integration, tech stack, every decision made.

---

## Table of Contents

1. [What the Admin Panel Is](#1-what-the-admin-panel-is)
2. [Tech Stack — Locked](#2-tech-stack)
3. [Architecture Overview](#3-architecture-overview)
4. [Authentication — How It Actually Works](#4-authentication)
5. [Backend API — What Admin Consumes](#5-backend-api)
6. [Frontend Structure — Every File](#6-frontend-structure)
7. [Every Page and What It Does](#7-pages)
8. [Realtime Layer — Socket.io](#8-realtime)
9. [State Management](#9-state-management)
10. [Security Model](#10-security-model)
11. [Audit Findings — What Was Broken and Fixed](#11-audit-findings)
12. [What Is Complete vs What Remains](#12-completion-status)
13. [Build Rules — Non-Negotiables](#13-build-rules)
14. [Environment Variables](#14-environment-variables)

---

## 1. What the Admin Panel Is

The admin panel is a **React web application** used exclusively by transport staff:

| Role | What they do |
|---|---|
| Transport Officer | Full access — all routes, buses, students, reports, bulk import |
| Coordinator | Own routes only — corrections, student list, driver messages, incidents |
| Faculty | Read-only — own department attendance |
| Management | Analytics and summaries only |

It is **not** used by students or drivers. Those users use the mobile app.

### What it must do in production

- Show all 180 buses live on a Google Map with real-time positions
- Allow coordinators to review and approve/reject attendance correction requests
- Let transport officers bulk-import students from college ERP (CSV/Excel)
- Show breakdown incidents with escalation status
- Manage route stop editor (drag-drop reorder)
- Admin↔Driver messaging thread
- Live operations dashboard with fleet status

### The morning window rule

**Never deploy between 6:30am–10am IST.** Students are boarding buses. Even a perfect deployment causes 10–30 seconds of disruption during check-in. This window is inviolable.

---

## 2. Tech Stack

### Frontend (admin panel)

| Layer | Technology | Why |
|---|---|---|
| Framework | React 18 + Vite | Fast builds, HMR, TypeScript first |
| Routing | React Router v6 | File-based routes, nested layouts |
| Admin CRUD | Refine | Gives free DataTable, filtering, pagination, forms — saves weeks |
| API client | Axios | `withCredentials: true` for httpOnly cookie auth |
| Server state | TanStack Query v5 | Caching, background refetch, pagination, optimistic updates |
| Client state | Zustand | Fleet positions (from Socket.io), alerts, auth state |
| Charts | Recharts | Attendance trends, daily stats — embedded in React |
| Maps | Google Maps JS API | Fleet map, 180 bus markers, route editor |
| Realtime | Socket.io client | Fleet GPS updates, live alerts, incident notifications |
| Styling | Tailwind CSS | Utility-first, fast iteration |
| Types | TypeScript (strict) | All types imported from `packages/shared` |
| Language | TypeScript (100%) | Shared types from monorepo `packages/shared` |

### Backend (what admin consumes)

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 LTS |
| HTTP framework | Fastify 4 |
| ORM | Prisma 5 + PostgreSQL |
| Cache | Upstash Redis |
| Auth | httpOnly JWT cookie (admin) |
| Realtime | Socket.io + Redis adapter |
| Background jobs | GCP Cloud Tasks |
| Notifications | Firebase FCM + MSG91 |
| File storage | GCS (Google Cloud Storage) |
| Hosting | Cloud Run (min-instances=2) |

### Monorepo

Turborepo monorepo. Shared types live in `packages/shared`. Admin imports from `@bus/shared`.

```
college-bus-system/
├── apps/
│   ├── backend/         ← Fastify API
│   ├── mobile/          ← React Native + Expo
│   └── admin/           ← THIS — React + Vite
└── packages/
    └── shared/          ← Types, constants, validators, geo utils
```

---

## 3. Architecture Overview

### How admin connects to the system

```
Admin Panel (React + Vite)
    │
    ├─── HTTPS REST → Fastify backend /v1/admin/*
    │                  Auth: httpOnly cookie (admin_jwt)
    │                  withCredentials: true on every request
    │
    ├─── WebSocket → Socket.io (same backend)
    │                  Auth: cookie sent on handshake
    │                  Room: admin (receives all fleet events)
    │
    └─── (indirect) Firebase RTDB
                       Admin map reads /buses/{id} via backend
                       Not direct Firebase SDK in admin
```

### Key architectural decisions locked in

**1. Admin auth uses httpOnly cookie — never localStorage**
The JWT is in an httpOnly cookie set by the backend on login. JavaScript cannot read it. The browser sends it automatically on every request. `withCredentials: true` is the only config needed on the Axios client. This is XSS-proof by design.

**2. Refine for CRUD — not custom tables**
Refine provides the DataGrid, pagination, filtering, form validation pattern. The admin panel wraps Refine's primitives with custom components for domain-specific needs (attendance status badges, route editor, bulk import). Do not rebuild what Refine already provides.

**3. Socket.io for realtime — Zustand for fleet state**
GPS positions from 180 buses arrive via Socket.io events. They go directly into a Zustand `fleet.store.ts`. The Google Map reads from this store. React Query is NOT used for live GPS — it's too slow for 60 updates/second.

**4. Google Maps JS API — not react-google-maps**
Direct JS API for the fleet map. React wrappers add unnecessary overhead when managing 180 animated markers. The map instance is stored in a ref. Markers are managed imperatively.

---

## 4. Authentication

### The complete admin auth flow

```
1. Admin opens /login
2. Enters email + password
3. POST /v1/admin/auth/login  { email, password }
   withCredentials: true
4. Backend verifies:
   a. Check account-level lockout FIRST (before incrementing counter)
   b. Increment failed attempt counter
   c. Lock account after 5 failures (15-minute lockout)
   d. bcrypt.compare(password, hash) — always runs even if user not found (timing safety)
   e. On success: reset counter
5. Backend sets httpOnly cookie: admin_jwt
   - httpOnly: true       ← JS cannot read this
   - secure: true         ← HTTPS only
   - sameSite: 'strict'   ← CSRF mitigated
   - maxAge: 8h
   - path: /v1/admin      ← only sent on admin routes
6. Backend returns: { id, name, role } — NOT the token
7. Admin panel stores user object in Zustand auth store
   NO TOKEN IN JAVASCRIPT MEMORY. EVER.
8. Every subsequent API call: browser sends cookie automatically
9. Backend middleware reads cookie, verifies JWT, checks sessionVersion
10. 401 response → admin panel redirects to /login
```

### App startup flow

On every app open, admin panel calls `/v1/admin/auth/me`:
- 200 → set user in store → show dashboard
- 401 → redirect to /login

This replaces the old broken mock bypass (see audit findings).

### Session revocation

Three mechanisms exist:
1. **sessionVersion bump** — any sensitive change (password reset, role change, deactivation) increments `sessionVersion` in DB + clears Redis cache → next request rejected
2. **forcedReloginAt** — emergency: force all sessions created before a timestamp to re-auth
3. **JWT blacklist** — individual emergency: `jwt:admin:blacklist:{adminId}` in Redis

### What was wrong (fixed)

The original implementation had `App.tsx` auto-logging every visitor in as `TRANSPORT_OFFICER` with a dummy token. This was a complete auth bypass. Any visitor could see all privileged screens. Fixed by:
1. Removing auto-login from `App.tsx` entirely
2. Calling `/v1/admin/auth/me` on startup
3. Removing token from `auth.store.ts` (cookie handles it)
4. Removing `Authorization: Bearer` header from `api.client.ts` (cookie handles it)

---

## 5. Backend API

### What admin consumes — complete endpoint list

All routes are prefixed `/v1`. Admin cookie is sent automatically.

#### Auth

```
POST   /v1/admin/auth/login              Email + password login
POST   /v1/admin/auth/logout             Clear cookie
POST   /v1/admin/auth/forgot-password    Always returns 200 (no email enumeration)
POST   /v1/admin/auth/reset-password     Token from email
POST   /v1/admin/auth/invite             Create new admin (TRANSPORT_OFFICER only)
POST   /v1/admin/auth/set-password       Accept invite + set first password
GET    /v1/admin/auth/me                 Current admin profile + role
```

#### Dashboard

```
GET    /v1/admin/stats                   activeTrips, checkedIn, openCorrections, gpsOffline
GET    /v1/admin/active-trips            All active trips with bus, driver, route, GPS status
GET    /v1/admin/alerts                  Sorted set of pending alerts (from Redis)
```

#### Attendance

```
GET    /v1/attendance                    Filter: date, routeId, busId, status, page, limit
GET    /v1/admin/corrections             Pending correction requests
POST   /v1/admin/corrections/:id/review  { status: APPROVED|REJECTED, reviewNote }
GET    /v1/admin/defaulters              Students below threshold % this month
```

#### Students

```
GET    /v1/users                         Filter: role, department, routeId, search
GET    /v1/users/:id
POST   /v1/users                         Create individual student
PATCH  /v1/users/:id
POST   /v1/users/:id/assign-route        { routeId, stopId, effectiveFrom }
POST   /v1/users/bulk-import             CSV/Excel multipart upload
GET    /v1/admin/unassigned-students     Students who checked in without route assignment
POST   /v1/admin/bulk-assign-route       { userIds[], routeId }
```

#### Routes

```
GET    /v1/routes
POST   /v1/routes                        Create route with stops
GET    /v1/routes/:id                    Route + stops + current assignment
PATCH  /v1/routes/:id
POST   /v1/routes/:id/stops/reorder      Drag-drop reorder
POST   /v1/routes/:id/live-reroute       Emergency: push new stops to students
GET    /v1/routes/:id/students
```

#### Drivers & Buses

```
GET    /v1/users?role=DRIVER
PATCH  /v1/users/:id                     Update driver details
POST   /v1/admin/trips/:id/assign-substitute   { substituteDriverId, substituteBusId }
GET    /v1/buses
POST   /v1/buses
PATCH  /v1/buses/:id
```

#### Incidents

```
GET    /v1/incidents                     Filter: status, busId, routeId
GET    /v1/incidents/:id
POST   /v1/incidents/:id/resolve         { resolutionNotes, alternateBusId }
```

#### Messages

```
POST   /v1/messages                      Direct message to driver
POST   /v1/messages/broadcast            Broadcast to all/route/bus
GET    /v1/messages/:busId               Thread for a bus
POST   /v1/messages/:id/reply            Quick-tap reply from driver
```

#### Reports

```
GET    /v1/admin/reports/daily-trip-log  Date range + export
GET    /v1/admin/reports/late-arrivals
GET    /v1/admin/reports/driver-attendance
```

### API URL prefix — critical note

All admin API calls use `/v1` prefix. The Axios client `baseURL` is set to `${API_URL}/v1`. Individual calls then use relative paths like `/users`, `/routes`. A previous bug had admin pages calling `/users` without the prefix — all returning 404. Fixed by including `/v1` in `baseURL`.

```typescript
// api.client.ts — correct
export const adminApiClient = axios.create({
  baseURL: `${import.meta.env.VITE_API_URL}/v1`,  // /v1 baked into baseURL
  withCredentials: true,
})
// Calls: /users, /routes, /attendance — all resolve correctly
```

### Error response contract

Every backend error returns:
```typescript
interface ErrorResponse {
  error: string    // machine-readable: 'INVALID_CREDENTIALS', 'ACCOUNT_TEMPORARILY_LOCKED'
  message: string  // human-readable (for logs, not shown raw to users)
  requestId: string
}
```

Admin UI maps error codes to user-facing messages. Never shows raw error codes.

---

## 6. Frontend Structure

```
apps/admin/
├── src/
│   ├── pages/
│   │   ├── auth/
│   │   │   ├── Login.tsx              Email + password form
│   │   │   ├── ForgotPassword.tsx     Always shows "if email exists, link sent"
│   │   │   └── ResetPassword.tsx      Token from email URL param
│   │   ├── dashboard/
│   │   │   └── index.tsx              Live ops: stats + fleet map + alerts
│   │   ├── attendance/
│   │   │   ├── index.tsx              Attendance table with filters + export
│   │   │   └── corrections.tsx        Correction request queue
│   │   ├── students/
│   │   │   ├── index.tsx              Student list (Refine DataTable)
│   │   │   └── bulk-import.tsx        CSV upload → preview → confirm
│   │   ├── routes/
│   │   │   ├── index.tsx              Route list
│   │   │   └── editor.tsx             Route editor with drag-drop stops
│   │   ├── drivers/
│   │   │   └── index.tsx              Driver list + substitute assignment
│   │   ├── incidents/
│   │   │   └── index.tsx              Incident queue + resolution
│   │   ├── fleet/
│   │   │   └── index.tsx              All buses live (alternative to dashboard map)
│   │   ├── messages/
│   │   │   └── index.tsx              Admin↔Driver message threads
│   │   └── reports/
│   │       ├── daily-trip-log.tsx
│   │       ├── late-arrivals.tsx
│   │       └── driver-attendance.tsx
│   │
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx            Navigation sidebar with role-based menu items
│   │   │   ├── Header.tsx             Breadcrumb + admin name + logout
│   │   │   └── AlertBell.tsx          Live alert count badge
│   │   ├── dashboard/
│   │   │   ├── StatsBar.tsx           4 metric cards: active trips, checked-in, corrections, GPS offline
│   │   │   ├── FleetMap.tsx           Google Maps — 180 buses, animated markers
│   │   │   ├── AlertFeed.tsx          Live incident/alert list
│   │   │   └── BusDetailPanel.tsx     Slide-in panel on bus click
│   │   ├── attendance/
│   │   │   ├── AttendanceTable.tsx    Refine DataGrid with custom status badge column
│   │   │   ├── CorrectionCard.tsx     Single correction: student info + GPS evidence + approve/reject
│   │   │   └── StatusBadge.tsx        Color-coded status chip (PRESENT/ABSENT/PENDING/etc)
│   │   ├── students/
│   │   │   ├── BulkImportTable.tsx    Preview table before import confirm
│   │   │   └── RouteAssignDrawer.tsx  Assign route to unassigned student
│   │   └── shared/
│   │       ├── DataTable.tsx          Refine base table wrapper
│   │       ├── FilterBar.tsx          Date/route/status filters
│   │       └── ExportButton.tsx       CSV export trigger
│   │
│   ├── hooks/
│   │   ├── useAdminAuth.ts            Current admin + role check
│   │   ├── useFleetSocket.ts          Socket.io subscription → updates fleet store
│   │   ├── useLiveAlerts.ts           Socket.io subscription → updates alerts store
│   │   ├── useDashboardStats.ts       TanStack Query — polls every 30s
│   │   ├── useAttendance.ts           TanStack Query — paginated attendance
│   │   ├── useCorrections.ts          TanStack Query — pending corrections
│   │   └── useRoutes.ts               TanStack Query — routes CRUD
│   │
│   ├── store/
│   │   ├── auth.store.ts              Zustand — admin user object (no token)
│   │   ├── fleet.store.ts             Zustand — live bus positions (from Socket.io)
│   │   └── alerts.store.ts            Zustand — pending alerts sorted by time
│   │
│   ├── lib/
│   │   ├── api.client.ts              Axios with withCredentials + 401 redirect
│   │   ├── socket.ts                  Socket.io singleton with cookie auth
│   │   └── query-client.ts            TanStack Query config
│   │
│   ├── App.tsx                        Router + auth guard + startup /me call
│   └── main.tsx                       Vite entry point
│
├── index.html
├── vite.config.ts
├── tailwind.config.ts
└── tsconfig.json
```

---

## 7. Pages

### Dashboard (`/dashboard`)

The most important admin page. Opens by default after login.

**What it shows:**
- Stats bar: 4 live numbers — active trips, students checked in, open corrections, GPS offline buses
- Fleet map: All active buses on Google Maps. Color-coded:
  - Green: on time, GPS live
  - Amber: delayed >5min or GPS stale
  - Red: GPS offline or breakdown reported
  - Gray: not started
- Alert feed: Incidents, late starts, GPS offline — real-time via Socket.io
- Bus detail panel: Click any bus → slides in from right showing route, driver, student count, GPS details, message thread

**Realtime behavior:**
- Socket.io `join_admin_room` on connect
- `gps:position` events update `fleet.store.ts` → markers animate
- `incident:reported` events add to `alerts.store.ts` → alert feed updates
- `trip:late-start` events add to alerts
- Stats bar refetches every 30 seconds (TanStack Query)

**Map implementation:**
```typescript
// FleetMap.tsx — key decisions
// Direct Google Maps JS API — no React wrapper overhead
// Markers managed imperatively in a ref Map
// Smooth animation between GPS positions using requestAnimationFrame
// Bus icon rotates to face heading direction
// React.memo on bus marker component prevents unnecessary re-renders
```

### Attendance (`/attendance`)

**What it shows:**
- Filter bar: date picker, route select, status multi-select, search
- Paginated table: student name, roll no, bus, stop, time, status
- Export CSV button (calls backend, downloads file)
- Each row clickable → correction request detail

**Key behavior:**
- Default filter: today's date
- Status filter uses multi-select — can show PRESENT + MANUAL together
- Coordinator sees only their routes (backend enforces with scope middleware)
- Transport officer sees all routes

### Corrections (`/attendance/corrections`)

The daily workflow for coordinators.

**What it shows:**
- Queue of PENDING corrections, oldest first
- Each card shows:
  - Student name + roll number
  - Date of absence
  - Student's reason
  - GPS evidence: distance to bus + distance to stop at scan time
  - Text field for review note
  - Approve / Reject buttons

**Behavior:**
- Approve → attendance status changes from ABSENT to EXCUSED + student gets FCM notification
- Reject → correction marked REJECTED + student gets FCM notification
- Review note is optional
- After action: card removed from queue, count badge updates

### Students (`/students`)

**What it shows:**
- Refine DataTable with search + filters
- Columns: name, roll no, department, year, route, stop, last check-in, attendance %
- Actions: view, edit, assign route, deactivate
- Bulk import button → opens `/students/bulk-import`

**Bulk import (`/students/bulk-import`):**
1. Upload CSV/Excel from college ERP
2. PapaParse parses client-side → preview table (first 10 rows + count)
3. Validate required columns: name, phone, rollNumber, department, year, routeName, stopName
4. Confirm import → POST `/v1/users/bulk-import`
5. Result: `{ success: N, failed: N }` shown
6. Students get onboarding SMS via MSG91

### Route Editor (`/routes/editor`)

**What it shows:**
- Route name + area + active days
- Stop list — drag-to-reorder
- Each stop: name, lat/lon, scheduled morning time, scheduled return time
- "Push Live" button for emergency rerouting

**Implementation:**
- `@dnd-kit/sortable` for drag-drop stop reorder
- Google Maps minimap showing stop positions
- `POST /v1/routes/:id/stops/reorder` on save
- `POST /v1/routes/:id/live-reroute` triggers immediate Socket.io push to all students on route

### Incidents (`/incidents`)

**What it shows:**
- Table of reported incidents: bus, route, type, time, escalation level, status
- Color-coded by severity: ACCIDENT = immediate red, MECHANICAL = orange, etc.
- Click → incident detail: GPS location, description, escalation history, alternate bus assignment
- "Mark resolved" button with resolution notes

**Escalation display:**
- Shows current escalation level: Coordinator → Transport Officer → Principal
- Shows time elapsed since report
- Cloud Tasks handles automatic escalation at T+10min, T+20min

### Messages (`/messages`)

**What it shows:**
- Left panel: bus list with unread badge
- Right panel: message thread for selected bus
- Admin sends → driver sees on kiosk (as AdminMessageBar)
- Driver quick replies: ACK / On the way / Need help / Will be late
- Delivery status: sent → delivered → read
- System events (trip start/end, check-in counts) auto-post into thread

---

## 8. Realtime Layer

### Socket.io connection — admin

```typescript
// lib/socket.ts
import { io } from 'socket.io-client'

export const createAdminSocket = () => io(import.meta.env.VITE_API_URL, {
  withCredentials: true,  // sends admin_jwt cookie on handshake
  transports: ['websocket'],
})
```

### Room structure

Admin panel joins `admin` room on connect. This room receives:

| Event | What it carries | What admin does |
|---|---|---|
| `gps:position` | busId, lat, lon, speed, heading, gpsStatus, isLate | Update fleet store → map marker animates |
| `gps:status` | busId, status (LIVE/STALE/OFFLINE) | Update marker color + add alert if OFFLINE |
| `checkin:success` | tripId, userId | Increment stats counter |
| `incident:reported` | incidentId, busId, type, description | Add to alert feed (red) |
| `trip:late-start` | tripId, busNumber, minutesLate | Add to alert feed (amber) |
| `correction:submitted` | correctionId | Increment correction badge |
| `admin:message:read` | messageId, busId | Update delivery receipt in thread |

### Fleet store (Zustand)

```typescript
// store/fleet.store.ts
interface BusData {
  busId, busNumber, lat, lon, speed, heading,
  gpsStatus: 'LIVE' | 'STALE' | 'OFFLINE',
  isLate: boolean,
  tripId: string | null,
}

// Zustand — scoped selectors prevent full re-renders
// Map component subscribes to specific bus:
const bus = useFleetStore(s => s.buses.find(b => b.busId === id))
```

### Socket events the admin emits

```
join_admin_room     → joins admin room (sent on connect)
leave_admin_room    → on disconnect
```

### Known issue — socket event registry drift

`docs/SOCKET_EVENT_REGISTRY.md` was found to be missing `incident:reported` and `gps:position` events (audit finding). Both events are emitted by the backend but were not documented. Update the registry doc whenever adding/changing socket events.

---

## 9. State Management

### What lives where

| Data | Store | Why |
|---|---|---|
| Admin user (name, role) | Zustand `auth.store` | Persists across navigation |
| Live bus positions | Zustand `fleet.store` | Socket.io events, too fast for React Query |
| Live alerts | Zustand `alerts.store` | Socket.io events, needs ordering |
| Attendance table | TanStack Query | Server state, paginated, cached |
| Corrections queue | TanStack Query | Server state, real-time badge count |
| Dashboard stats | TanStack Query | Polls every 30s |
| Routes list | TanStack Query | Server state, rarely changes |
| Students list | TanStack Query | Server state, paginated, filterable |

### Auth store — what it holds

```typescript
interface AdminAuthStore {
  user: {
    id:    string
    name:  string
    email: string
    role:  AdminRole
  } | null
  isLoaded: boolean  // false until /me call completes
  setUser:  (user) => void
  clearUser: () => void
  // NO TOKEN — cookie handles auth, not JS memory
}
```

### TanStack Query config — admin

```typescript
// lib/query-client.ts
new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,       // 15s — admin data refreshes more aggressively than mobile
      gcTime: 2 * 60 * 1000,
      networkMode: 'online',   // Admin is always online — no offline mode
      retry: (count, err: any) => {
        if ([401, 403, 404].includes(err.response?.status)) return false
        return count < 2
      }
    }
  }
})
```

---

## 10. Security Model

### Admin-specific security decisions

**1. httpOnly cookie — never localStorage**
This is non-negotiable. The admin JWT is not accessible to JavaScript at all. If XSS hits the admin panel, the attacker cannot steal the token. `withCredentials: true` is the entire frontend auth implementation.

**2. Role is re-verified from cache on every request**
The JWT contains a role claim, but `requireAdminRole` middleware checks against Redis auth cache (which reflects current DB state), not the JWT role. This means role downgrades take effect immediately without waiting for token expiry.

Previously this was wrong — the middleware was checking `req.user.role` from the JWT instead of `authState.role` from cache. Fixed.

**3. Admin account lockout — correct order**

The rate limiting order matters:
```
1. Check lock flag (redis.get ratelimit:admin:locked:{emailHash}) — FIRST
2. If locked → return 429 immediately, don't increment counter
3. Increment attempt counter
4. If counter > 5 → set lock flag + DELETE counter
5. Run bcrypt (always — even if user not found)
6. On success → delete counter
```

Previously this was wrong — the counter was incremented before checking the lock flag, causing double-counting. Users were locked after ~3 attempts instead of 6. Fixed.

**4. Forgot password always returns 200**
Even if email doesn't exist. Prevents email enumeration. The response text is always "if this email is registered, a link has been sent."

**5. Reset token stored as SHA-256 hash**
Raw token goes in email. Hash goes in DB. Compare `sha256(incoming_token)` vs stored hash. Token set to null on first successful use — can't be reused.

**6. Security headers on all responses**
```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Strict-Transport-Security: max-age=31536000
```

### CSRF protection
`sameSite: 'strict'` on the cookie covers Phase 1. Cross-site requests don't include the cookie. Explicit CSRF tokens deferred to Phase 2.

### Role-based route guards

Frontend route guard:
```typescript
// App.tsx
const AdminRoute = ({ roles }: { roles: AdminRole[] }) => {
  const { user } = useAdminAuth()
  if (!user) return <Navigate to="/login" />
  if (!roles.includes(user.role)) return <Navigate to="/dashboard" />
  return <Outlet />
}

// Usage
<Route element={<AdminRoute roles={['TRANSPORT_OFFICER']} />}>
  <Route path="/students/bulk-import" element={<BulkImport />} />
</Route>
```

Backend enforces the same roles independently. Frontend guard is UX — backend guard is security.

---

## 11. Audit Findings — What Was Broken and Fixed

Three consecutive security audits were run. Here are all findings relevant to admin panel, with fix status.

### Round 1 Findings

**CRITICAL: Admin auth model internally broken**
- `App.tsx` auto-logged every visitor as `TRANSPORT_OFFICER` with dummy token
- Token sent as `Authorization: Bearer` but backend only reads cookie
- Result: privileged screens visible to anyone, but real API calls couldn't work
- **Fixed:** Removed auto-login, added `/me` call on startup, removed Bearer header

**HIGH: Wrong JWT field `userId` vs `sub`**
- JWT uses `sub` (standard), admin routes read `request.user.userId` (undefined)
- Audit logs corrupt, correction reviews fail
- **Fixed:** Added `userId: payload.sub` alias in auth middleware

**HIGH: WebSocket room name mismatch**
- Admin client emits `join-admin`, backend handles `join_admin_room`
- Admin realtime completely broken silently
- **Fixed:** Standardized to underscore convention, added missing handlers

**HIGH: Mock OTP in verify-otp.tsx**
- Mobile login sent `mock_${phone}_${code}` instead of real Firebase token
- **Fixed:** Implemented real Firebase credential flow

**MEDIUM: API URL prefix mismatch**
- Admin pages called `/users`, backend mounts at `/v1/users`
- All returning 404
- **Fixed:** Added `/v1` to `baseURL` in `api.client.ts`

**MEDIUM: `google-auth-library` missing from package.json**
- `cloud-task.middleware.ts` imports it, not in dependencies
- Runtime failure on Cloud Tasks jobs
- **Fixed:** Added to `apps/backend/package.json`

### Round 2 Findings

**HIGH: Stale cache on mobile deactivation**
- Deactivating a user in DB didn't invalidate Redis auth cache
- Deactivated users could keep using system for up to 24h
- **Fixed:** All deactivation paths now call `invalidateUserAuth(userId)` which bumps `sessionVersion` + deletes cache

**HIGH: Admin login double-counting rate limit**
- Route called `checkAdminLoginRateLimit` → incremented counter
- `adminLogin` service also incremented same counter
- Users locked after ~3 attempts instead of 6
- **Fixed:** Removed duplicate increment, lock check order corrected (lock first, then increment)

**HIGH: Admin frontend still mock bypass (same as Round 1)**
- Was not yet fixed in Round 2 codebase
- **Fixed:** Same fix as above — remove auto-login, add `/me` call

**MEDIUM: Admin role checked from JWT not cache**
- Role downgrade wouldn't take effect until token expiry
- **Fixed:** `requireAdminRole` now reads from `getAuthAdminState()` (cache), not JWT payload

**MEDIUM: `authStatus` vs `isActive` flag divergence**
- Login blocked `authStatus === DISABLED` but middleware only checked `isActive`
- Flags could diverge — disabled-but-active accounts could keep refreshing
- **Fixed:** All deactivation paths set both flags. Cache includes `authStatus`. Middleware checks both.

**LOW: Blacklist written but never read**
- `forceReloginAfter` writes `jwt:admin:blacklist:{id}` to Redis
- Neither middleware read it — emergency revocation incomplete
- **Fixed:** Added blacklist check to `admin-auth.middleware.ts`

### Round 3 Findings (System-wide audit)

**HIGH: Student home contract drift**
- Backend BFF doesn't return `attendance.percentage`, `presentCount`, `absentCount`, `pendingCorrections`
- Mobile hook synthesizes these from null — partial data
- **Status: P0 — not yet fixed**
- Fix: Lock the `/v1/student/home` BFF contract to return all required fields

**HIGH: Timezone inconsistency in backend**
- Several services use `new Date().toISOString().split('T')[0]` (UTC) instead of IST helper
- Date-sensitive operations wrong around IST day boundaries
- **Status: P0 — partially fixed, some files remain**
- Fix: Replace all UTC date splitting with `getIsoDateInIST()` from shared utils

**MEDIUM: Socket registry drift**
- `docs/SOCKET_EVENT_REGISTRY.md` missing `incident:reported` and `gps:position`
- **Status: P1 — documentation fix**

**MEDIUM: No mobile automated test suite**
- No visible mobile test files
- **Status: P1 — needs test infrastructure**

---

## 12. Completion Status

### Admin panel pages

| Page | Status | Notes |
|---|---|---|
| Login | ✅ Complete | Real auth, lockout handling |
| ForgotPassword | ✅ Complete | Always returns 200 |
| ResetPassword | ✅ Complete | Token from URL param |
| Dashboard — stats bar | ✅ Complete | TanStack Query, 30s poll |
| Dashboard — fleet map | ✅ Complete | 180 markers, Socket.io updates |
| Dashboard — alert feed | ✅ Complete | Socket.io, Zustand |
| Dashboard — bus detail panel | ✅ Complete | Click-to-expand |
| Attendance table | ✅ Complete | Filters, pagination, export |
| Corrections queue | ✅ Complete | GPS evidence, approve/reject |
| Student list | ✅ Complete | Refine DataTable, search, filters |
| Bulk import | ✅ Complete | CSV + Excel, preview, confirm |
| Route list | ✅ Complete | |
| Route editor | ⚠️ Partial | Drag-drop exists, live-reroute button pending |
| Driver list | ✅ Complete | |
| Substitute assignment | ⚠️ Partial | UI exists, backend endpoint needs wiring |
| Incidents | ✅ Complete | |
| Messages | ⚠️ Partial | Thread view exists, real-time delivery receipts pending |
| Reports | ⚠️ Partial | Daily trip log done, others pending |
| Socket registry doc | ❌ Needs update | Missing `incident:reported`, `gps:position` |

### Backend endpoints admin uses

| Endpoint group | Status |
|---|---|
| Auth (login/logout/forgot/reset/invite) | ✅ Complete |
| Dashboard stats | ✅ Complete |
| Attendance + corrections | ✅ Complete |
| Student CRUD + bulk import | ✅ Complete |
| Route CRUD + reorder + live-reroute | ✅ Complete |
| Driver CRUD + substitute | ⚠️ Substitute endpoint needs verification |
| Incidents | ✅ Complete |
| Messages | ✅ Complete |
| Reports | ⚠️ Daily trip log done, others pending |
| Unassigned students | ✅ Complete |

---

## 13. Build Rules

These are non-negotiable for every file in the admin panel.

### Auth rules

1. **Never store admin JWT in JavaScript.** Cookie handles it. `withCredentials: true` is the only config.
2. **Never send `Authorization: Bearer` header from admin panel.** The cookie does this automatically.
3. **Every API call must have `withCredentials: true`.** Set on the Axios instance, not per-call.
4. **401 response → navigate to `/login` immediately.** Set in the Axios response interceptor.
5. **App startup must call `/v1/admin/auth/me` before rendering any protected page.**

### API rules

6. **BaseURL includes `/v1`.** Individual calls use relative paths: `/users`, `/routes`, not `/v1/users`.
7. **Never call Axios directly in a component.** Use a hook that wraps TanStack Query.
8. **Every list endpoint uses pagination.** Default: 20, max: 100. Never unbounded queries.
9. **Error codes mapped to user-facing messages.** Never show raw error strings in UI.

### State rules

10. **Server state in TanStack Query only.** Never duplicate in Zustand.
11. **Fleet positions in Zustand only.** Too fast for React Query (60 updates/sec).
12. **Auth user object in Zustand.** No token in the store. No token anywhere in JS.

### Socket rules

13. **Socket events use underscore naming.** `join_admin_room`, not `join-admin`. Consistent everywhere.
14. **Every socket listener cleaned up in `useEffect` return.** No memory leaks.
15. **Socket authenticated via cookie on handshake.** `withCredentials: true` on socket init.

### Map rules

16. **Google Maps instance stored in `useRef`.** Never in state — would cause re-renders.
17. **Markers managed imperatively** via `markers.current.get(busId)`. Not as React components.
18. **`React.memo` on marker components** with custom equality comparing lat/lon/status only.
19. **Animate marker positions** with `requestAnimationFrame` — no teleporting.

### Role rules

20. **Frontend route guard is UX only.** Backend enforces all role checks independently.
21. **Coordinator scope enforced by backend `scope.middleware.ts`.** Frontend doesn't need to filter.
22. **Never derive permissions from JWT role in frontend.** Call `/me` for current state.

---

## 14. Environment Variables

```bash
# apps/admin/.env

# Backend API URL — includes protocol, no trailing slash
VITE_API_URL=https://bus-backend-xxx.run.app

# Google Maps API Key — restricted to admin domain in GCP Console
VITE_GOOGLE_MAPS_API_KEY=AIzaSy...

# Google Maps Map ID — for custom map styling
VITE_GOOGLE_MAPS_MAP_ID=...

# Sentry — error tracking
VITE_SENTRY_DSN=https://...@sentry.io/...

# Environment
VITE_APP_ENV=production  # or 'staging', 'development'
```

All secrets in GCP Secret Manager for production. Never commit `.env` to git. `.env.example` committed with empty values.

---

## Appendix: Key Architecture Decisions and Why

### Why Refine

Refine provides DataGrid, pagination, filtering, sorting, form validation, and CRUD mutations out of the box. Without it, each admin table would take a week to build properly. Refine is wrapped, not replaced — custom components for domain-specific needs (attendance status badges, correction cards, route editor) sit alongside Refine primitives.

### Why direct Google Maps JS API (not react-google-maps)

180 animated markers updating 3x per second. React wrappers re-render on every position change. Direct imperative API with `marker.setPosition()` and `requestAnimationFrame` interpolation is significantly faster. The map instance lives in a `ref`, not in state.

### Why Zustand for fleet — not TanStack Query

TanStack Query is designed for request-response patterns with caching. GPS positions arrive 60 times per second from Socket.io — no request/response, no caching needed, just the latest state. Zustand's `updateBus()` action handles this cleanly with selective re-renders using scoped selectors.

### Why cookies over localStorage for admin

localStorage is accessible to any JavaScript on the page — XSS can steal it. httpOnly cookies cannot be read by JavaScript at all. This is the industry standard for web admin authentication. The only cost is `withCredentials: true` on every request, which the Axios client handles centrally.

### Why separate admin panel (not embedded in mobile app)

The admin panel is a desktop-first web application used by coordinators and transport officers sitting at computers. The mobile app is optimized for standing at a bus stop in sunlight with one hand. Different form factors, different information density, different interaction patterns. They share a backend but nothing else.

---

*Admin Panel Technical Summary — College Bus Management System*
*April 2026 · Status: Active development*
