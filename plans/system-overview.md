# SECTION 1 — SYSTEM OVERVIEW

## 1. Plain English System Explanation

**What the product is:**  
The College Bus Management System is a comprehensive transportation tracking and attendance verification solution designed for educational institutions. It manages student bus transportation by verifying student attendance through QR code check-ins, tracking bus locations in real-time, managing driver and student interactions, and providing administrative oversight through a web-based dashboard.

**Who uses it:**  
- **Students**: Use mobile app to scan QR codes for attendance verification, view bus locations, request corrections, and manage trip preferences
- **Drivers**: Use mobile app/kiosk to display rotating QR codes, report incidents, start/end trips, and communicate with administrators
- **Administrators/Coordinators**: Use web admin panel to manage users, routes, buses, view live operations, handle corrections, and oversee fleet management
- **Transport Officers/Faculty/Management**: Have varying levels of access to administrative functions based on role

**User roles:**  
- STUDENT (primary attendance verification)
- DRIVER (trip management, QR display, incident reporting)
- COORDINATOR (route oversight, correction approval, outage management)
- TRANSPORT_OFFICER (fleet management, elevated oversight)
- FACULTY (limited administrative access)
- MANAGEMENT (full system oversight)
- STAFF (general support role)
- NCC_OFFICER (specialized role)

**How the system behaves end-to-end:**  
1. **Nightly**: System pre-creates trip schedules for next day
2. **Morning**: Driver starts trip via mobile app, triggering QR code generation
3. **During trip**: Students scan QR codes to verify attendance with geofence validation
4. **Real-time**: Bus GPS updates flow to Firebase Realtime Database, visible to students on map
5. **College gate arrival**: System triggers arrival verification via silent socket or FCM push
6. **Trip end**: Driver ends trip, absent marking job processes non-attendees
7. **Throughout**: Administrators monitor live operations, handle corrections, manage fleet

**Operational workflows:**  
- **Attendance verification**: QR scan → JWT validation → nonce burn (GETDEL) → geofence check → transactional DB write → event logging
- **Location tracking**: Driver GPS ping → backend processing → Firebase RTDB update → student map subscription
- **Incident management**: Driver reports → immediate coordinator notification → escalation timer → resolution tracking
- **Corrections**: Student requests → coordinator reviews GPS evidence → approve/reject → attendance status update
- **Outage handling**: GPS loss detection → coordinator override option → student self-reporting window

**Critical business flows:**  
1. Student attendance verification (core value proposition)
2. Real-time bus location tracking (parent/student trust)
3. Driver trip lifecycle management (operational control)
4. Administrative oversight and exception handling (governance)
5. Communication and notification system (engagement)
6. Data integrity and audit trails (compliance)

## 2. High-Level Architecture

**Frontend apps:**  
- **Mobile App** (React Native/Expo): Student and driver interfaces with QR scanning, map viewing, trip management
- **Admin Panel** (React/Vite): Administrative dashboard for fleet management, corrections, live operations

**Backend services:**  
- **Node.js/Fastify API**: RESTful services organized by domain (auth, attendance, gps, trips, etc.)
- **Prisma ORM**: PostgreSQL database access layer
- **Redis**: Caching, rate limiting, QR nonce storage, real-time state
- **Firebase Admin SDK**: Realtime Database for live GPS, Cloud Messaging for push notifications
- **BullMQ**: Background job processing for notifications, absent marking, trip pre-creation
- **Socket.IO**: Real-time bidirectional communication (QR refresh, gate reached events)

**Mobile app:**  
- React Native with Expo
- AsyncStorage for offline queue
- Direct Firebase RTDB subscription for bus locations
- Background GPS tracking with adaptive intervals
- Deep link handling for arrival verification

**Admin panel:**  
- React with Vite
- TanStack Query for data fetching
- Socket.IO for live updates
- Role-based UI components
- CSV import/export capabilities

**Auth system:**  
- Firebase Authentication (phone/OTP) as identity provider
- Custom JWT tokens with session versioning and device binding
- Redis-based auth caching with fallback to PostgreSQL
- Role-based access control middleware
- Audit logging for all auth events

**Database:**  
- PostgreSQL 15 via Prisma ORM
- Flat User model with nullable role fields to avoid JOINs
- Event sourcing pattern: AttendanceLog (current state) + AttendanceEvent (immutable history)
- Proper indexing on hot query paths (tripId+status, busId+status, userId)
- Geographic data stored as Float lat/lon (not lng)
- Time stored as minutes since midnight for accurate calculations

**Cache:**  
- Redis for:
  - Active trip lookups (5-minute TTL)
  - Route/bus assignments (1-hour TTL)
  - QR nonce storage (40-second TTL with 5-second grace)
  - Rate limiting counters
  - GPS heartbeat tracking (120-second TTL)
  - Dashboard live seeding counters

**Realtime layer:**  
- Socket.IO with Redis adapter for horizontal scaling
- Room-based broadcasting: students join bus-specific rooms, admins join all bus rooms
- Events: gps:update, gate:reached, qr:refresh, trip:status changes
- Firebase RTDB for live GPS only (never historical storage)

**File processing/imports:**  
- Bulk CSV import for student roster with transactional safety
- File validation before DB writes
- Error reporting and rollback on failure

**Notifications:**  
- FCM push notifications for arrival verification and announcements
- MSG91 SMS for emergency alerts (breakdowns)
- Background worker processes notification queues
- Chunked delivery to prevent API overload

**Background jobs:**  
- Nightly trip pre-creation (11pm)
- Absent marking after trip end
- GPS heartbeat monitoring (60-second intervals)
- GPS log cleanup (30-day retention)
- Late start alerts (10-minute grace)
- Arrival verification fallback (2-minute gate check)
- GPS outage absence detection
- Redis reconciliation jobs

**Observability/security layers:**  
- Structured JSON logging with correlation IDs
- Health checks (liveness/readiness) verifying DB and Redis connectivity
- Rate limiting on sensitive endpoints (check-in: 3/min/user)
- JWT signature verification with grace periods
- Device binding enforcement
- Input validation via Zod schemas
- SQL injection prevention via Prisma parameterized queries
- CORS and security headers (X-Frame-Options, X-Content-Type-Options, etc.)
- Secret management via GCP Secret Manager (planned)

## 3. First Principles Explanation

**Core problem being solved:**  
Educational institutions need reliable verification that students who board buses actually arrive at school, prevent fraudulent check-ins, provide real-time visibility to stakeholders, and maintain auditable records for safety and compliance.

**Foundational assumptions:**  
1. Students carry smartphones capable of running apps and scanning QR codes
2. Drivers have smartphones capable of running background GPS tasks
3. Institutional WiFi/cellular coverage is generally available but unreliable in spots
4. GPS accuracy varies but is sufficient for geofencing within 100-150m tolerance
5. Battery life is a concern for background tracking
6. Fraud prevention requires cryptographic single-use tokens
7. Administrative oversight requires real-time visibility and exception handling
8. Data integrity requires immutable audit trails
9. System must handle 8am check-in spikes (500+ simultaneous validations)
10. Offline capability is essential for areas with poor connectivity

**Architectural decisions from first principles:**

**Separation of concerns:**  
- Backend: Business logic, data persistence, security, integration
- Frontend: User experience, presentation, offline handling
- Realtime: Live state distribution (Firebase RTDB, Socket.IO)
- Historical: Immutable audit trail (PostgreSQL + Event Sourcing)

**Technology choices justified:**  
- **PostgreSQL**: ACID compliance for financial/attendance integrity, JSONB for flexible metadata, proven at scale
- **Redis**: Sub-millisecond latency for hot paths, atomic operations (GETDEL) for race prevention, pub/sub capabilities
- **Firebase RTDB**: Optimized for high-frequency writes (GPS pings) and real-time listeners, automatic reconnection
- **Socket.IO**: Bidirectional communication with room scoping for efficient fanout
- **BullMQ**: Reliable job queuing with retry semantics, visibility into processing
- **React Native/Expo**: Cross-platform mobile development with access to native modules (camera, GPS, background tasks)
- **React/Vite**: Modern web admin interface with fast refresh and component reuse

**Scalability approach:**  
- Horizontal scaling via stateless API containers
- Redis as shared state layer for coordination
- Database read replicas for reporting (planned)
- Room-based Socket.IO to limit broadcast scope
- Background job processing to smooth traffic spikes
- Connection pooling (PgBouncer) for database connections
- CDN for static assets (planned)

**Reliability mechanisms:**  
- Idempotency tokens for retry safety
- Circuit breakers for external service dependencies
- Graceful degradation (stop-only geofence when GPS unavailable)
- Offline queues with temporal boundaries
- Health checks and automatic restart policies
- Backup and disaster recovery procedures (planned)
- Chaos engineering validation (planned)

**Security model:**  
- Defense in depth: network, application, data layers
- Zero trust principles: validate every request
- Least privilege: role-based access control
- Defense against common threats: rate limiting, input validation, output encoding
- Secure defaults: secure cookies, HTTPS-only, proper CORS
- Audit trail: immutable event sourcing for forensic analysis
- Secrets management: never in code or images, always in secret stores

**Data consistency model:**  
- Strong consistency for attendance transactions (Prisma transactions)
- Eventual consistency for real-time displays (Socket.IO/Firebase)
- Read-after-write consistency for critical paths (cache-aside patterns)
- Conflict resolution: last-write-wins with timestamps for non-critical data
- Manual reconciliation processes for discrepancies

**Failure handling:**  
- Fail-open for non-critical features (show last known position when GPS down)
- Fail-closed for security-critical paths (reject invalid tokens)
- Degraded mode: manual override capabilities during system issues
- Clear error messaging to users with actionable next steps
- Automatic retry with exponential backoff for transient failures
- Dead letter queues for permanently failed operations

This architecture represents a thoughtful balance between correctness, performance, usability, and operational simplicity, designed to handle the specific challenges of student transportation management at scale.