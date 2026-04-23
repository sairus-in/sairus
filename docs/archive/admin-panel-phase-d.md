# College Bus Management System
# Admin Panel — Phase D: Master Data Management
# Complete Implementation Guide

> This document covers the strategy, architecture, and implementation
> details for Phase D of the admin panel build.
> Phase D touches live operational data — every decision here
> has direct consequences for system integrity and student records.

---

## Why Phase D Needs Special Treatment

Phase A/B/C dealt with reading and reacting to operational data.
Phase D writes the foundational data the entire system runs on.

```
Student record wrong        → Student can't log in, attendance not tracked
Route stop deleted wrong    → 47 students lose their stop assignment
Bulk import half-complete   → 200 students in DB, 300 missing, no way to tell which
Route edited during trip    → Active trip references deleted stop
Coordinator sees all routes → Privacy violation, wrong correction approvals
```

Every decision in this phase needs to account for failure modes first.

---

## Table of Contents

1. [Security Boundaries](#1-security-boundaries)
2. [Soft Delete — The Only Delete](#2-soft-delete)
3. [Student Management (D1)](#3-student-management)
4. [Bulk CSV Import (D2)](#4-bulk-csv-import)
5. [Route Management (D3)](#5-route-management)
6. [Bus and Driver Management (D4)](#6-bus-and-driver-management)
7. [Backend Endpoints — Phase D Complete](#7-backend-endpoints)
8. [Build Order](#8-build-order)
9. [Prompt for Claude Code](#9-prompt-for-claude-code)

---

## 1. Security Boundaries

### What each role sees in Phase D

```
TRANSPORT OFFICER:
  Students:  Full CRUD — create, edit, deactivate, reassign route, bulk import
  Routes:    Full CRUD — create, edit stops, reorder, assign bus/driver
  Buses:     Full CRUD — create, edit, deactivate
  Drivers:   Full CRUD — create, edit, deactivate, assign to route

COORDINATOR:
  Students:  Read only — can see students on own routes only
             Can see: name, roll number, department, year, stop, status
             Cannot see: phone number (login credential — privacy)
             Cannot edit: anything
  Routes:    No access — cannot view or edit
  Buses:     No access
  Drivers:   No access

FACULTY:
  Students:  Read only — own department only
             Can see: name, roll number, attendance summary
             Cannot see: phone, route, stop assignment

MANAGEMENT:
  Students:  No access to individual student records
             Can see aggregate counts only (via reports)
```

### Phone number visibility rule

Phone numbers are login credentials. They are also personal data.

```typescript
// Backend: two different response shapes for the same endpoint

GET /v1/users?role=STUDENT

If requester is TRANSPORT_OFFICER:
  Returns: { id, name, rollNumber, phone, department, year,
             routeId, stopId, busNumber, isActive }

If requester is COORDINATOR:
  Returns: { id, name, rollNumber, department, year,
             stopId, busNumber, isActive }
  // phone field is omitted — never sent, not just hidden in UI

// This is enforced in the Fastify route handler, not just the frontend
```

### Coordinator route scoping

Every student query from a coordinator is automatically filtered:

```typescript
// Backend middleware applied to all /v1/users endpoints
if (req.user.role === 'COORDINATOR') {
  const coordinatorRouteIds = await getCoordinatorRoutes(req.user.id)
  req.studentFilter = {
    routeAssignments: {
      some: {
        routeId: { in: coordinatorRouteIds },
        isActive: true,
      }
    }
  }
}
// Applied to every prisma.user.findMany call
```

---

## 2. Soft Delete — The Only Delete

Hard deletes are permanently banned in this system.

```
Why:
  Student deactivated → attendance history must be preserved for audits
  Route deactivated → historical trip data references this route
  Bus deactivated → GPS logs reference this busId
  Driver deactivated → trip records reference this driverId

What "deactivate" means in each case:
  User (student/driver): isActive = false
    → Cannot log in (Firebase Auth disabled via Admin SDK)
    → Does not appear in active lists
    → All historical data preserved

  Route: isActive = false
    → No new trips created for this route
    → Historical trips preserved
    → Students on this route shown as "Route inactive" on their home screen

  Bus: isActive = false
    → Not assignable to new trips
    → Historical GPS logs preserved

  Stop: cannot be deleted if students are assigned
    → Must reassign students first
    → System blocks deletion and shows: "47 students assigned. Reassign before removing."
```

### Deactivation confirmation flow

Every deactivation requires:
1. Confirmation modal showing impact: "Deactivating Priya S will prevent her from logging in. Her attendance history is preserved."
2. Explicit checkbox: "I understand this student will lose access"
3. Reason input (optional but logged): for audit trail

```typescript
// PATCH /v1/users/:id
Body: {
  isActive: false,
  deactivationReason: "Student left college",
  deactivatedBy: coordinatorId  // logged in audit trail
}

// Also disables Firebase Auth account
await admin.auth().updateUser(user.firebaseUid, { disabled: true })
```

---

## 3. Student Management (D1)

### Page layout: split view

```
Left panel (40%):
  Search bar (name, roll number, department)
  Filter bar: Status | Route | Department | Year
  Paginated student list (Refine useTable)
  Each row: avatar initials | name | roll | dept | bus | status badge
  Click row → detail loads in right panel (no page navigation)

Right panel (60%):
  Student detail + edit panel
  Sections: Personal Info | Route Assignment | Attendance Summary | Actions
```

### Student detail panel — what's shown by role

```typescript
// components/students/StudentDetailPanel.tsx

const StudentDetailPanel = ({ student }) => {
  const { capabilities } = useAuthStore()

  return (
    <div>
      {/* Always visible */}
      <StudentInfoSection student={student} />
      <AttendanceSummarySection studentId={student.id} />

      {/* Transport Officer only — phone number */}
      {capabilities.canManageStudents && (
        <div>Phone: {student.phone}</div>
      )}

      {/* Transport Officer only — edit actions */}
      {capabilities.canManageStudents && (
        <StudentEditActions
          student={student}
          onRouteChange={handleRouteChange}
          onDeactivate={handleDeactivate}
        />
      )}
    </div>
  )
}
```

### Unassigned students section

This is the most common daily workflow. It gets a dedicated section.

```
When unassigned count > 0:
  Amber banner at top of student list:
  "32 students need route assignment — checked in without assignment"

  [Bulk assign] button → enters select mode
  In select mode:
    Checkboxes appear on all rows
    [Select all on this page] option
    Filter still works in select mode (filter then select all = efficient)
    Bottom action bar appears: "12 selected · [Assign to route] [Clear selection]"

  [Assign to route] → BottomDrawer slides up:
    Route selector dropdown (Transport Officer sees all routes)
    Stop selector (filtered to stops on selected route)
    Preview: "This will assign 12 students to Tambaram Route · Tambaram Station stop"
    [Confirm assignment] button

  On confirm:
    POST /v1/admin/bulk-assign-route { userIds, routeId, stopId }
    Backend: prisma.$transaction — all or nothing
    Progress: "Assigning... 8/12"
    On complete: banner count decreases, rows move to "Active" status
    FCM sent to each student: "You've been assigned to Tambaram Route (Bus 12)"
    Socket: home:refresh to connected students
```

### Change route for individual student

```
In Student Detail panel → [Change route] button

Opens inline form in the panel:
  Route selector (dropdown, searchable)
  Stop selector (filtered by route, shows stop name + expected time)
  Effective from: [Today] (default) | [Custom date]
  [Save] [Cancel]

On save:
  PATCH /v1/users/:id/assign-route
  Backend:
    Creates new RouteAssignment (isActive: true)
    Sets previous RouteAssignment.isActive = false
    Keeps history — never deletes old assignment
  Student receives FCM: "Your route has been updated to Tambaram Route"
  No disruption to current day's trip — change takes effect from effective date
```

### Student list — performance considerations

At 6000 students, the list needs virtual scrolling or proper pagination.

```typescript
// Use Refine's useTable with server-side pagination
// Never load all 6000 students at once

const { tableProps } = useTable({
  resource: 'students',
  pagination: { pageSize: 50 },
  sorters: { initial: [{ field: 'name', order: 'asc' }] },
  filters: {
    initial: [{ field: 'isActive', operator: 'eq', value: true }]
  },
})

// Search is server-side — POST /v1/users?search=priya
// Full-text index on (name, rollNumber) handles this efficiently
// Client-side search is NOT used — too slow for 6000 records
```

---

## 4. Bulk CSV Import (D2)

### The two-pass validation architecture

This is the most important architectural decision in Phase D.

```
Pass 1 — Client-side format validation (instant, no network):
  Papa Parse reads the CSV
  Checks: required columns exist, correct types, no internal duplicates
  Does NOT check: whether phone/roll already exists in DB
  Shows format errors immediately as user browses the file

Pass 2 — Server-side database validation (dry run, no writes):
  POST /v1/users/bulk-import/validate
  Body: { students: ParsedRow[] }
  Backend checks against DB:
    - phone already exists → "Row 12: phone already registered"
    - rollNumber already exists → "Row 34: roll number already registered"
    - routeName not found → "Row 56: route 'XYZ Route' not found"
    - stopName not on route → "Row 78: stop 'ABC' not on Tambaram Route"
  Returns: { valid: 485, errors: [{row, field, value, reason}] }
  NO database writes in this pass

Pass 3 — Actual import (only if Pass 2 returned 0 errors):
  POST /v1/users/bulk-import
  Backend:
    prisma.$transaction — all or nothing
    Creates User records in batches of 100
    Creates RouteAssignment records
    Creates Firebase Auth accounts (batch via Admin SDK)
    Queues welcome FCM notifications (separate async job — not in transaction)
  Returns: { operationId }
  Frontend polls GET /v1/admin/operations/:operationId for progress
```

### Import wizard — 5 steps

```
STEP 1: Upload
  Drag zone: drop CSV here or click to browse
  Accepts: .csv only (reject .xlsx, .xls with clear message)
  Max file size: 5MB
  On upload → immediately parse with Papa Parse (client side)

STEP 2: Column Mapping
  Auto-detect columns by header name
  If headers don't match exactly, show mapping UI:
    "Which column is the student's name?"
    Dropdown per required field
  Preview: first 5 rows shown with mapped data

STEP 3: Client Validation (Pass 1)
  Show: 485 rows ready, 3 format errors
  Error rows highlighted in red with inline reason
  [Fix errors in CSV] link + re-upload button
  User can fix and re-upload without leaving the page
  [Continue to server check] only enabled if 0 client errors

STEP 4: Server Validation (Pass 2)
  Loading: "Checking against existing records..."
  Shows result: "485 rows valid — ready to import"
  OR: error list with row numbers and reasons
  Each error row: expandable to show full row data
  [Download error report] → CSV of just the error rows
  [Continue to import] only enabled if 0 server errors

STEP 5: Import + Progress
  Confirmation: "Import 485 students to [College Name]?"
  [Confirm import] button
  Progress bar: "Importing... 234/485"
  Live log (optional, collapsible): shows each batch as it completes
  On complete: "Import complete · 485 imported · Welcome notifications queued"
  [View imported students] → navigates to student list filtered to today's imports
```

### CSV column schema (exact header names)

```
Required columns:
  name          String, min 2 chars
  phone         String, exactly 10 digits, numeric only
  rollNumber    String, must be unique in the system
  department    String, must match: CSE|ECE|EEE|ME|CE|IT|MCA|MBA (fetch from /v1/departments)
  year          Integer, 1-4
  routeName     String, must match an active route name (fetch from /v1/routes/names)
  stopName      String, must be a stop on the specified route

Optional columns (imported if present):
  email         String, valid email format
  gender        String, M|F|Other
  parentPhone   String, 10 digits

Example valid row:
  name, phone, rollNumber, department, year, routeName, stopName
  Priya S, 9876543210, 21CS041, CSE, 2, Tambaram Route, Tambaram Station
```

### Backend: bulk import endpoint

```typescript
// POST /v1/users/bulk-import
// Auth: TRANSPORT_OFFICER only

async function bulkImport(req, reply) {
  const { students } = req.body
  const operationId = `import-${Date.now()}-${req.user.id}`

  // Initialize operation in Redis
  await redis.hset(`admin:operation:${operationId}`, {
    status: 'PROCESSING', total: students.length, progress: 0, errors: 0
  })

  // Run import as background job via Cloud Tasks
  await cloudTasks.createTask({
    body: { operationId, students, initiatedBy: req.user.id }
  })

  reply.code(202).send({ operationId, status: 'PROCESSING', total: students.length })
}

// Cloud Tasks worker: bulk-import.job.ts
async function runBulkImport({ operationId, students, initiatedBy }) {
  const BATCH_SIZE = 100
  let imported = 0
  const errors: ImportError[] = []

  for (let i = 0; i < students.length; i += BATCH_SIZE) {
    const batch = students.slice(i, i + BATCH_SIZE)

    try {
      await prisma.$transaction(async (tx) => {
        for (const student of batch) {
          // 1. Create Firebase Auth account
          const firebaseUser = await admin.auth().createUser({
            phoneNumber: `+91${student.phone}`,
            displayName: student.name,
          })

          // 2. Create User record
          const user = await tx.user.create({
            data: {
              name: student.name,
              phone: student.phone,
              rollNumber: student.rollNumber,
              department: student.department,
              year: Number(student.year),
              role: 'STUDENT',
              firebaseUid: firebaseUser.uid,
              isActive: true,
            }
          })

          // 3. Create RouteAssignment
          const route = await tx.route.findUnique({
            where: { name: student.routeName },
            include: { stops: { where: { name: student.stopName } } }
          })

          await tx.routeAssignment.create({
            data: {
              userId: user.id,
              routeId: route.id,
              stopId: route.stops[0].id,
              isActive: true,
            }
          })

          imported++
        }
      })

      // Update progress in Redis
      await redis.hset(`admin:operation:${operationId}`, {
        progress: imported
      })

    } catch (err) {
      // Batch failed — log but continue with next batch
      errors.push({ batchStart: i, error: err.message })
      await redis.hset(`admin:operation:${operationId}`, {
        errors: errors.length
      })
    }
  }

  // Queue welcome notifications (separate from import — never blocks it)
  await queueWelcomeNotifications(operationId)

  // Finalize operation
  await redis.hset(`admin:operation:${operationId}`, {
    status: errors.length === 0 ? 'DONE' : 'DONE_WITH_ERRORS',
    imported,
    errors: JSON.stringify(errors),
    completedAt: Date.now(),
  })
}
```

---

## 5. Route Management (D3)

### Route editing safety rules

Not all route edits are equal. Some are safe anytime, some need warnings,
some are blocked while a trip is active.

```
SAFE ANYTIME (no confirmation needed):
  Edit route display name
  Edit route area/description
  Toggle active days (Mon-Sat)
  Add a new stop at the end of the sequence

REQUIRES CONFIRMATION (impact warning shown):
  Add a new stop in the middle of the sequence:
    "This will change the sequence for all stops after it.
     Scheduled times will need to be updated."
  Change bus assignment:
    Check if today's trip is active → warn if yes
    "Bus 12 has an active trip right now.
     This change will take effect from tomorrow."
  Change driver assignment:
    Same check as bus assignment

BLOCKED WHEN TRIP IS ACTIVE:
  Remove a stop
  Reorder stops
  Error: "Cannot edit stop sequence while trip is active.
          Try again after 10 AM when all trips have ended."

REQUIRES STUDENT REASSIGNMENT FIRST:
  Remove a stop that has assigned students
  Block with: "47 students are assigned to this stop.
               You must reassign them before removing the stop."
  Shows list of affected students with [Reassign] action per student
```

### Stop sequence editor

```typescript
// components/routes/StopSequenceEditor.tsx
// Uses @dnd-kit/sortable

import { DndContext, SortableContext, verticalListSortingStrategy } from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'

const StopSequenceEditor = ({ route, stops, onSave }) => {
  const [items, setItems] = useState(stops)
  const [isDirty, setIsDirty] = useState(false)
  const { hasActiveTrip } = useRouteActiveStatus(route.id)

  const handleDragEnd = ({ active, over }) => {
    if (hasActiveTrip) {
      toast.error('Cannot reorder stops while trip is active')
      return
    }
    if (!over || active.id === over.id) return

    const oldIndex = items.findIndex(s => s.id === active.id)
    const newIndex = items.findIndex(s => s.id === over.id)
    const reordered = arrayMove(items, oldIndex, newIndex)
      .map((stop, index) => ({ ...stop, sequence: index + 1 }))

    setItems(reordered)
    setIsDirty(true)
  }

  const handleSave = async () => {
    if (hasActiveTrip) {
      // Double check — should never get here but just in case
      toast.error('Cannot save while trip is active')
      return
    }

    await onSave(items.map(s => ({
      stopId: s.id,
      sequence: s.sequence,
      scheduledTimeMorning: s.scheduledTimeMorning,
    })))
    setIsDirty(false)
  }

  return (
    <div>
      {hasActiveTrip && (
        <div className="amber-banner">
          Stop reordering is disabled while a trip is active.
          Available after {route.estimatedEndTime}.
        </div>
      )}

      <DndContext onDragEnd={handleDragEnd}>
        <SortableContext items={items.map(s => s.id)} strategy={verticalListSortingStrategy}>
          {items.map(stop => (
            <SortableStop
              key={stop.id}
              stop={stop}
              disabled={hasActiveTrip}
              onTimeChange={(newTime) => {
                setItems(prev => prev.map(s =>
                  s.id === stop.id ? { ...s, scheduledTimeMorning: newTime } : s
                ))
                setIsDirty(true)
              }}
              onRemove={() => handleRemoveStop(stop)}
              studentCount={stop.studentCount}
            />
          ))}
        </SortableContext>
      </DndContext>

      {isDirty && (
        <div>
          <button onClick={handleSave}>Save sequence</button>
          <button onClick={() => { setItems(stops); setIsDirty(false) }}>Discard</button>
        </div>
      )}
    </div>
  )
}
```

### Backend: route stop update

```typescript
// PATCH /v1/routes/:id/stops
// Auth: TRANSPORT_OFFICER only

async function updateRouteStops(req, reply) {
  const { id: routeId } = req.params
  const stops: StopUpdate[] = req.body  // [{ stopId, sequence, scheduledTimeMorning }]

  // Safety check: no active trip for this route right now
  const activeTrip = await prisma.trip.findFirst({
    where: { routeId, status: 'ACTIVE', date: getTodayDateKey() }
  })
  if (activeTrip) {
    return reply.code(409).send({
      error: 'ROUTE_HAS_ACTIVE_TRIP',
      message: 'Cannot edit stop sequence while trip is active'
    })
  }

  // Atomic replacement
  await prisma.$transaction([
    prisma.routeStop.deleteMany({ where: { routeId } }),
    prisma.routeStop.createMany({
      data: stops.map(s => ({
        routeId,
        stopId: s.stopId,
        sequence: s.sequence,
        scheduledTimeMorning: s.scheduledTimeMorning,
      }))
    })
  ])

  // Invalidate any cached route data
  await redis.del(`route:${routeId}:stops`)

  reply.send({ success: true })
}
```

### Remove stop — safety check

```typescript
// DELETE /v1/routes/:routeId/stops/:stopId
// Auth: TRANSPORT_OFFICER only

async function removeRouteStop(req, reply) {
  const { routeId, stopId } = req.params

  // Check 1: No active trip
  const activeTrip = await prisma.trip.findFirst({
    where: { routeId, status: 'ACTIVE', date: getTodayDateKey() }
  })
  if (activeTrip) {
    return reply.code(409).send({ error: 'ROUTE_HAS_ACTIVE_TRIP' })
  }

  // Check 2: No students assigned to this stop
  const assignedStudents = await prisma.routeAssignment.count({
    where: { stopId, isActive: true }
  })
  if (assignedStudents > 0) {
    return reply.code(409).send({
      error: 'STOP_HAS_ASSIGNED_STUDENTS',
      count: assignedStudents,
      message: `${assignedStudents} students assigned to this stop. Reassign before removing.`
    })
  }

  await prisma.routeStop.delete({ where: { routeId_stopId: { routeId, stopId } } })
  reply.send({ success: true })
}
```

---

## 6. Bus and Driver Management (D4)

### Bus management

```
Bus list table:
  Columns: Bus number | Plate | Capacity | Route | Driver | Today's status | Actions
  
  Today's status (from Redis):
    Active trip (real-time boarded count)
    GPS status indicator
    No trip assigned today

Add bus:
  Required: busNumber (unique), plateNumber (unique), capacity
  Optional: assign to route immediately

Edit bus:
  Edit any field
  Deactivate: requires no active trip right now
  Cannot deactivate a bus with an active trip — show error

Driver management (same pattern):
  Columns: Name | License | Phone | Assigned bus | Today's trip status
  
  Today's trip status:
    Started at X:XX AM (green)
    Not started (amber if >10 min late)
    Breakdown reported (red)
    No trip assigned (gray)

  Add driver:
    Required: name, phone, licenseNumber
    Optional: assign to bus/route immediately
    Backend: creates User with role: DRIVER + Firebase Auth account

  Deactivate driver:
    Block if driver has an active trip right now
    Error: "Driver Rajan Kumar has an active trip. Cannot deactivate during trip."
```

---

## 7. Backend Endpoints — Phase D Complete

### New endpoints needed for Phase D

```
STUDENT MANAGEMENT
──────────────────────────────────────────────────────────────────
GET    /v1/users?role=STUDENT&page&limit&search&routeId&status
       Auth: Transport Officer (returns phone), Coordinator (no phone, own routes)
       Response shape differs by role (phone omitted for Coordinator)

POST   /v1/users
       Body: { name, phone, rollNumber, department, year, role: STUDENT }
       Auth: TRANSPORT_OFFICER only
       Creates User + Firebase Auth account

PATCH  /v1/users/:id
       Body: { name?, department?, year? }
       Auth: TRANSPORT_OFFICER only

PATCH  /v1/users/:id/assign-route
       Body: { routeId, stopId, effectiveFrom? }
       Auth: TRANSPORT_OFFICER only
       Creates new RouteAssignment, deactivates previous

PATCH  /v1/users/:id/deactivate
       Body: { reason? }
       Auth: TRANSPORT_OFFICER only
       Sets isActive: false + disables Firebase Auth account

POST   /v1/admin/bulk-assign-route
       Body: { userIds: string[], routeId: string, stopId: string }
       Auth: TRANSPORT_OFFICER only
       Returns: { operationId } — tracks in Redis

BULK IMPORT
──────────────────────────────────────────────────────────────────
POST   /v1/users/bulk-import/validate
       Body: { students: StudentImportRow[] }
       Auth: TRANSPORT_OFFICER only
       DRY RUN — no writes — validates against DB
       Returns: { valid: number, errors: [{row, field, value, reason}] }

POST   /v1/users/bulk-import
       Body: { students: StudentImportRow[] }
       Auth: TRANSPORT_OFFICER only
       Only call after validate returns 0 errors
       Returns: { operationId }

GET    /v1/admin/operations/:operationId
       Auth: Transport Officer (own operations only — check initiatedBy)
       Returns: { status, progress, total, errors?, completedAt? }

ROUTE MANAGEMENT
──────────────────────────────────────────────────────────────────
GET    /v1/routes
       Auth: TRANSPORT_OFFICER only
       Returns: routes with stop count, student count, bus, driver

GET    /v1/routes/:id
       Returns: full route with stops (sequence, times, student count per stop)

GET    /v1/routes/names
       Auth: all admin roles (used for import validation)
       Returns: [{ id, name }] — minimal, for dropdown/validation

POST   /v1/routes
       Body: { name, area, activeDays: DayOfWeek[] }
       Auth: TRANSPORT_OFFICER only

PATCH  /v1/routes/:id
       Body: { name?, area?, activeDays? }
       Auth: TRANSPORT_OFFICER only

PATCH  /v1/routes/:id/stops
       Body: [{ stopId, sequence, scheduledTimeMorning }]
       Auth: TRANSPORT_OFFICER only
       Full replacement — validates no active trip first

DELETE /v1/routes/:routeId/stops/:stopId
       Auth: TRANSPORT_OFFICER only
       Validates: no active trip, no assigned students

PATCH  /v1/routes/:id/assign-bus
       Body: { busId, effectiveFrom? }
       Auth: TRANSPORT_OFFICER only
       Warns if bus has active trip today

PATCH  /v1/routes/:id/assign-driver
       Body: { driverId, effectiveFrom? }
       Auth: TRANSPORT_OFFICER only

BUS + DRIVER MANAGEMENT
──────────────────────────────────────────────────────────────────
GET    /v1/buses
       Auth: TRANSPORT_OFFICER only
       Returns: buses with route, driver, today's trip status

POST   /v1/buses
       Body: { busNumber, plateNumber, capacity }
       Auth: TRANSPORT_OFFICER only

PATCH  /v1/buses/:id
       Auth: TRANSPORT_OFFICER only

PATCH  /v1/buses/:id/deactivate
       Validates: no active trip right now
       Auth: TRANSPORT_OFFICER only

GET    /v1/users?role=DRIVER
       Auth: TRANSPORT_OFFICER only
       Returns: drivers with assigned bus, today's trip status

POST   /v1/users (role: DRIVER)
       Body: { name, phone, licenseNumber, role: DRIVER }
       Auth: TRANSPORT_OFFICER only

PATCH  /v1/users/:id/deactivate (for drivers)
       Validates: no active trip right now
       Auth: TRANSPORT_OFFICER only

UTILITY
──────────────────────────────────────────────────────────────────
GET    /v1/departments
       Auth: all admin roles
       Returns: [{ value, label }] for department enum
       Cached: 24 hours (changes never)

GET    /v1/stops/search?query=tambaram&routeId=xxx
       Auth: TRANSPORT_OFFICER only
       Returns: stops matching query, filtered to route if routeId provided
```

---

## 8. Build Order

```
D1A — Backend endpoints for student management
      GET /v1/users (with role-scoped response)
      PATCH /v1/users/:id/assign-route
      PATCH /v1/users/:id/deactivate
      Verify: Coordinator cannot see phone numbers in response

D1B — Student list page (split view)
      Refine useTable with server-side search + pagination
      Student detail panel (role-gated fields)
      Verify: Coordinator sees own routes only, no phone visible

D1C — Unassigned students bulk assign flow
      Amber banner + bulk select mode
      Route + stop selector drawer
      POST /v1/admin/bulk-assign-route with operationId tracking
      Verify: bulk assign 5 test students, confirm FCM sent, banner count decreases

D2A — Backend: bulk import validate endpoint (dry run)
      POST /v1/users/bulk-import/validate
      Validates phone, roll number, route name, stop name against DB
      Verify: submit a file with 2 duplicate phones, confirm errors returned

D2B — Backend: bulk import execution + Cloud Tasks job
      POST /v1/users/bulk-import → returns operationId
      bulk-import.job.ts: batched prisma transaction + Firebase Auth creation
      GET /v1/admin/operations/:operationId: progress polling
      Verify: import 50 test students, all records created, Firebase accounts exist

D2C — Import wizard frontend (5 steps)
      Papa Parse + column mapping
      Client validation step (format errors)
      Server validation step (DB errors with inline display)
      Import with progress bar
      Verify: end-to-end 50 student import

D3A — Backend: route management endpoints
      All CRUD + stop sequence update + safety checks
      Verify: attempt stop deletion with assigned students → blocked with count

D3B — Route list + route detail page
      Refine useTable for list
      Stop sequence editor (DnD) with active-trip lock
      Bus + driver assignment section
      Verify: reorder stops during active trip → blocked with message

D4A — Bus + Driver management
      Standard Refine CRUD pages
      Today's operational status column (from Redis via live endpoint)
      Deactivation safety check (no active trip)
      Verify: deactivate bus with active trip → blocked with error
```

---

## 9. Prompt for Claude Code

```
You are implementing Phase D (Master Data Management) of the admin panel
for a college bus management system. Phases A, B, C are already built
and compiling cleanly.

Phase D covers: student management, bulk CSV import, route management,
bus and driver management.

CRITICAL: This phase writes foundational data that the entire system
runs on. Every operation must be safe, reversible, and auditable.

Read admin-panel-phase-d.md completely before writing any code.

SECURITY RULES — enforce these on every file:

1. Phone numbers are NEVER returned for Coordinator role.
   The backend sends different response shapes by role.
   Never trust frontend-only filtering — the backend must omit the field.

2. Coordinator sees only students on their assigned routes.
   This is enforced by backend middleware, not frontend filtering.
   Frontend just renders what the backend returns.

3. TRANSPORT_OFFICER only: create, edit, deactivate any entity.
   Coordinator: read only on students (own routes), no access to routes/buses/drivers.
   Use RequireCapability wrapper on all mutating UI elements.

SOFT DELETE RULE — absolute:
4. NEVER hard delete any record in this system.
   Students, routes, buses, drivers, stops — all use isActive = false.
   Deactivation also disables the Firebase Auth account for users.
   Attendance history, GPS logs, trip records are never touched by deactivation.

DATA SAFETY RULES:

5. Route stop edits are BLOCKED while a trip is active.
   Before any stop sequence save or stop deletion:
     Check: no active trip for this route today
     If active: return 409 ROUTE_HAS_ACTIVE_TRIP

6. Stop deletion is BLOCKED if students are assigned.
   Before deleting a stop:
     Check: RouteAssignment count for this stopId where isActive = true
     If > 0: return 409 STOP_HAS_ASSIGNED_STUDENTS with count

7. Bus/driver deactivation is BLOCKED during active trip.
   Check: no active trip for this bus/driver today
   If active: return 409 ENTITY_HAS_ACTIVE_TRIP

BULK IMPORT RULES:

8. Two-pass validation — never skip Pass 2.
   Pass 1: client-side format validation (Papa Parse)
   Pass 2: POST /v1/users/bulk-import/validate (dry run, no DB writes)
   Pass 3: actual import (only if Pass 2 returned 0 errors)
   [Import] button is disabled until Pass 2 returns 0 errors.

9. Import is transactional in batches of 100.
   If a batch fails, log the error, continue with next batch.
   Report final count: "imported X, errors Y".
   Never leave half a batch in the DB — each batch is all-or-nothing.

10. Firebase Auth account creation happens inside the import job.
    If Firebase account creation fails for a student:
    Roll back that student's DB record too (they're in the same transaction).
    Log the failure. Continue with next student.

11. Welcome FCM notifications are sent AFTER import completes.
    Never in the same transaction as the DB writes.
    Queue as a separate Cloud Tasks job after import job finishes.

ROUTE STOP SEQUENCE:

12. Stop sequence updates use full replacement.
    PATCH /v1/routes/:id/stops sends the complete new sequence.
    Backend: delete all existing RouteStops, create new ones.
    This is atomic via prisma.$transaction.
    RouteAssignment still references stopId (not sequence) — students keep their stop.

OPERATION TRACKING:

13. All bulk operations return an operationId.
    Frontend polls GET /v1/admin/operations/:operationId every 2s.
    Show progress bar: "X / Y complete".
    On DONE: show result summary + [View results] link.
    On DONE_WITH_ERRORS: show error count + [Download error report] link.

Build in this order:
  D1A → D1B → D1C → D2A → D2B → D2C → D3A → D3B → D4A

Run tsc --noEmit after every file. Zero errors, zero any types.
```

---

*Phase D Implementation Guide — College Bus Management System*
*March 2026 · Status: Ready for implementation*
