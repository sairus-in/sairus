# Socket Event Registry

## Authentication

- Mobile clients authenticate with `socket.handshake.auth.token` using the mobile JWT.
- Admin clients authenticate with the `admin_jwt` cookie and must connect with credentials enabled.

## Join / Leave Events

| Event | Sender | Payload | Server Action |
|---|---|---|---|
| `join-admin` | Admin SPA | none | Canonical admin room join. Joins room `admin`. |
| `join_admin_room` | Admin SPA | none | Deprecated alias for `join-admin`. |
| `leave-admin` | Admin SPA | none | Canonical admin room leave. Leaves room `admin`. |
| `leave_admin_room` | Admin SPA | none | Deprecated alias for `leave-admin`. |
| `join-trip` | Driver kiosk / Student mobile / Admin SPA | `{ tripId }` | Canonical trip room join. Joins room `trip:{tripId}`. Driver sockets also receive rotating `qr:refresh` events. |
| `join_trip_room` | Driver kiosk / Admin SPA | `{ tripId }` | Deprecated alias for `join-trip`. |
| `leave-trip` | Driver kiosk / Student mobile / Admin SPA | `{ tripId }` | Canonical trip room leave. Leaves room `trip:{tripId}` and clears QR rotation timer for kiosk sockets. |
| `leave_trip_room` | Driver kiosk / Admin SPA | `{ tripId }` | Deprecated alias for `leave-trip`. |
| `join-bus` | Mobile / Admin as needed | `{ busId }` or `busId` | Canonical bus room join. Joins room `bus:{busId}`. |
| `join_bus_room` | Mobile / Admin as needed | `{ busId }` or `busId` | Deprecated alias for `join-bus`. |
| `leave-bus` | Mobile / Admin as needed | `{ busId }` or `busId` | Canonical bus room leave. Leaves room `bus:{busId}`. |
| `leave_bus_room` | Mobile / Admin as needed | `{ busId }` or `busId` | Deprecated alias for `leave-bus`. |
| `join-route` | Mobile / Admin as needed | `{ routeId }` or `routeId` | Canonical route room join. Joins room `route:{routeId}`. |
| `join_route_room` | Mobile / Admin as needed | `{ routeId }` or `routeId` | Deprecated alias for `join-route`. |
| `leave-route` | Mobile / Admin as needed | `{ routeId }` or `routeId` | Canonical route room leave. Leaves room `route:{routeId}`. |
| `leave_route_room` | Mobile / Admin as needed | `{ routeId }` or `routeId` | Deprecated alias for `leave-route`. |

## Server -> Client Events

| Event | Rooms | Payload | Source |
|---|---|---|---|
| `qr:refresh` | individual driver socket in `trip:{tripId}` | `{ tripId, qrToken, expiresAt }` | `apps/backend/src/websocket/socket.ts` |
| `checkin:success` | `trip:{tripId}`, `admin` | `{ tripId, userId, name, status, checkedInAt, distanceToStop }` | `apps/backend/src/modules/attendance/attendance.service.ts` |
| `wait:request` | `trip:{tripId}` | `{ tripId, userId, studentName, etaMinutes }` | `apps/backend/src/modules/attendance/attendance.service.ts` |
| `admin:message` | `trip:{tripId}` or `bus:{busId}` or `route:{routeId}` or `admin` | `{ body, isUrgent, busId, routeId, type, priority }` | `apps/backend/src/modules/admin/admin.service.ts` |
| `incident:reported` | `admin` | `{ incidentId, busId, type, severity, reportedAt }` | `apps/backend/src/modules/incidents/incidents.service.ts` |
| `incident:updated` | `admin` | incident lifecycle payload | `apps/backend/src/modules/admin/admin.service.ts` |
| `trip:started` | `admin`, `route:{routeId}` | `{ tripId, busId, routeId, startedAt }` | `apps/backend/src/modules/trips/trips.service.ts` |
| `trip:ended` | `admin`, `trip:{tripId}`, `route:{routeId}` | `{ tripId, busId?, routeId?, endedAt }` | `apps/backend/src/modules/trips/trips.service.ts` |
| `gps:status` | `admin`, `bus:{busId}` | `{ busId?, tripId?, status }` | `apps/backend/src/jobs/gps-heartbeat.job.ts` |
| `gps:status_update` | `bus:{busId}` | `{ message }` | `apps/backend/src/jobs/gps-delegate-heartbeat.job.ts` |
| `gps:update` | `bus:{busId}` | live GPS state payload | `apps/backend/src/modules/gps/gps.service.ts` |
| `gps:position` | `admin` | `{ busId, tripId, lat, lon, speed, heading, lastUpdated, gpsStatus }` | `apps/backend/src/modules/gps/gps.service.ts` |
| `delegate:activated` | `bus:{busId}`, `admin` | `{ tripId, busId, routeId, delegateType }` | `apps/backend/src/modules/trips/delegate.service.ts` |
| `delegation:ended` | `user:{userId}`, `admin` | `{ tripId, busId, userId, reason }` | `apps/backend/src/modules/trips/delegate.service.ts` |
| `gps:outage_review_updated` | `admin` | outage review payload | `apps/backend/src/modules/attendance/attendance.service.ts`, `apps/backend/src/modules/admin/admin.service.ts` |
| `trip:late-start` | `admin` | alert payload | `apps/backend/src/jobs/late-start-alert.job.ts` |
| `trip:absent_finalized` | `admin`, `user:{userId}` | `{ tripId, count }` | `apps/backend/src/jobs/gps-outage-absent.job.ts` |
| `outage:escalation` | `user:{userId}` | escalation payload | `apps/backend/src/jobs/gps-outage-escalation.job.ts` |

## Current Client Consumers

- Driver kiosk listens for `qr:refresh`, `checkin:success`, `wait:request`, and `admin:message`.
- Student mobile joins `trip:{tripId}`, `bus:{busId}`, and `route:{routeId}` and updates or invalidates home state on trip, GPS, delegate, message, and finalization events.
- Admin SPA listens for `checkin:success`, `gps:status`, `trip:started`, `trip:ended`, `incident:reported`, `incident:updated`, `delegate:activated`, `delegation:ended`, `gps:outage_review_updated`, `outage:escalation`, `trip:late-start`, and `trip:absent_finalized`.

## Contract Rule

- Canonical event names are `join-admin`, `leave-admin`, `join-trip`, `leave-trip`, `join-bus`, `leave-bus`, `join-route`, and `leave-route`.
- Snake-case join aliases remain only for backward compatibility and should not be used in new client code.
- Any socket event change must update this file and the consuming client in the same PR.
