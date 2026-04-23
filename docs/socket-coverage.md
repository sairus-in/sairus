# Socket Coverage

## Backend Event Inventory

| Event | Room(s) | Source |
|---|---|---|
| `qr:refresh` | driver socket in `trip:{tripId}` | `apps/backend/src/websocket/socket.ts` |
| `checkin:success` | `trip:{tripId}`, `admin` | `apps/backend/src/modules/attendance/attendance.service.ts` |
| `wait:request` | `trip:{tripId}` | `apps/backend/src/modules/attendance/attendance.service.ts` |
| `admin:message` | `trip:{tripId}`, `bus:{busId}`, `route:{routeId}`, `admin` | `apps/backend/src/modules/admin/admin.service.ts` |
| `incident:reported` | `admin` | `apps/backend/src/modules/incidents/incidents.service.ts` |
| `incident:updated` | `admin` | `apps/backend/src/modules/admin/admin.service.ts` |
| `trip:started` | `admin`, `route:{routeId}` | `apps/backend/src/modules/trips/trips.service.ts` |
| `trip:ended` | `admin`, `trip:{tripId}`, `route:{routeId}` | `apps/backend/src/modules/trips/trips.service.ts` |
| `gps:status` | `admin`, `bus:{busId}` | `apps/backend/src/jobs/gps-heartbeat.job.ts` |
| `gps:status_update` | `bus:{busId}` | `apps/backend/src/jobs/gps-delegate-heartbeat.job.ts` |
| `gps:update` | `bus:{busId}` | `apps/backend/src/modules/gps/gps.service.ts`, `apps/backend/src/jobs/gps-delegate-heartbeat.job.ts` |
| `gps:position` | `admin` | `apps/backend/src/modules/gps/gps.service.ts` |
| `delegate:activated` | `bus:{busId}`, `admin` | `apps/backend/src/modules/trips/delegate.service.ts` |
| `delegation:ended` | `user:{userId}`, `admin` | `apps/backend/src/modules/trips/delegate.service.ts` |
| `gps:outage_review_updated` | `admin` | `apps/backend/src/modules/attendance/attendance.service.ts`, `apps/backend/src/modules/admin/admin.service.ts` |
| `trip:late-start` | `admin` | `apps/backend/src/jobs/late-start-alert.job.ts` |
| `trip:absent_finalized` | `admin`, `user:{userId}` | `apps/backend/src/jobs/gps-outage-absent.job.ts` |
| `outage:escalation` | `user:{userId}` | `apps/backend/src/jobs/gps-outage-escalation.job.ts` |

## Room Joins

| Join event | Room |
|---|---|
| `join-admin` | `admin` |
| `join-trip` | `trip:{tripId}` |
| `join-bus` | `bus:{busId}` |
| `join-route` | `route:{routeId}` |

Snake-case join aliases still exist for backward compatibility, but new client code should use the hyphenated names.

## Admin Coverage

| Hook / Screen | Live source | Polling status after Phase 4 |
|---|---|---|
| `useAdminSocket` | socket invalidations and cache patches for check-ins, GPS status, trip lifecycle, incidents, delegation, outage review, late starts, and messages | active |
| `useCommandCenter` | HTTP initial fetch + socket-driven refetch | polling removed |
| `useActiveTrips` | HTTP initial fetch + socket-driven refetch | polling removed |
| `useTripLive` | HTTP initial fetch + socket-driven refetch | polling removed |
| `useAlerts` | HTTP initial fetch + socket-driven refetch | polling removed |
| `useIncidents` | HTTP initial fetch + socket-driven refetch | polling removed |
| `useGpsOutageQueue` / `useGpsOutageCorrections` | HTTP initial fetch + socket-driven refetch | polling removed |
| `useMessages` | HTTP initial fetch + `admin:message` invalidation | no polling |

## Mobile Coverage

| Hook / Screen | Live source | Notes |
|---|---|---|
| `useStudentSocket` | joins trip, bus, and route rooms | updates home cache for GPS and delegate state, invalidates on trip lifecycle changes |
| `useStudentHome` | HTTP initial fetch + socket invalidation | background polling removed |
| `useCheckin` | optimistic cache update + socket/server reconciliation | history cache is invalidated alongside home |
| `useKioskSocket` | joins trip and bus rooms | now consumes bus-room notices in addition to QR, check-in, wait, and admin events |

## Known Boundaries

- Admin fleet-map motion still relies on Firebase live bus state rather than Socket.IO.
- The pending mobile assignment screen still uses timed profile refresh because there is no backend assignment socket event yet.
- Data-admin corrections and import flows still retain their own non-live polling where they are not mounted under the live socket shell.
