# Phase 1: Complete System Foundation & Code Explanation

This document provides a highly detailed, file-by-file breakdown of every single piece of code we have written and configured during Phase 1. The goal of this phase was to construct a production-ready Backend API and Database layer capable of handling the high throughput required for a college fleet of 180+ buses and thousands of students.

## 1. Local Infrastructure & Monorepo Setup

*   **`infra/docker/docker-compose.yml`**
    *   **Purpose:** Sets up the local development environment so we don't rely on expensive cloud databases while coding.
    *   **Explanation:** Defines two containers: `bus_postgres` (PostgreSQL 15 acting as our primary relational database) and `bus_redis` (Redis 7 used for WebSocket scaling, BullMQ job queuing, and temporary QR token storage). We mapped them to ports `5433` and `6380` on your machine to avoid conflicts.
*   **`.env` and `.env.example`**
    *   **Purpose:** Environment configuration.
    *   **Explanation:** Holds crucial connection strings (`DATABASE_URL`, `REDIS_URL`) and mock/real keys for external services like Firebase and MSG91.
*   **`CLAUDE.md`**
    *   **Purpose:** AI Project Memory.
    *   **Explanation:** Contains the system's architectural rules, constraints, and conventions (like using IST timezone, preferring Prisma, etc.) to ensure any future AI sessions understand the project deeply.
*   **`package.json` & `turbo.json` (Root)**
    *   **Purpose:** Turborepo workspace configuration.
    *   **Explanation:** Ties the `apps/backend` and `packages/shared` folders together, allowing us to build them in the correct dependency order.

## 2. packages/shared (The Common Domain)

*   **`src/types/` (Multiple Files)**
    *   **Purpose:** The single source of truth for the shape of our data.
    *   **Explanation:** We created explicit TypeScript interfaces for `User`, `Role`, `Bus`, `Route`, `Trip`, `Attendance`, `Incident`, and `Notifications`. By keeping these in a shared package, both the backend now, and the mobile/admin apps later, will use the exact same types, preventing bugs where the frontend expects a different shape than the backend sends.
*   **`src/constants/index.ts`**
    *   **Purpose:** Global magic numbers and enums.
    *   **Explanation:** Defines limits like `GEOFENCE_RADIUS_METRES = 100` and `QR_MAX_AGE_MS`.
*   **`src/utils/geo.utils.ts`**
    *   **Purpose:** Core geospatial logic.
    *   **Explanation:** Contains the `isWithinCheckinZone` function leveraging the Haversine formula to calculate the exact distance in meters between a student's phone and either (A) the bus's live GPS or (B) their assigned physical bus stop.

## 3. Database Layer

*   **`apps/backend/src/db/prisma/schema.prisma`**
    *   **Purpose:** The blueprint of our entire database.
    *   **Explanation:** This massive file defines 15 tables and their relationships.
        *   **Core Entities:** `User`, `Bus`, `Stop`, `Route`.
        *   **Profiles:** Breaks down a user into a `StudentProfile`, `DriverProfile`, or `CoordinatorProfile`.
        *   **Trips & Attendance:** The `Trip` tracks a specific bus run. `AttendanceLog` is the final result (Present/Absent). `AttendanceEvent` is an append-only ledger of how that result happened (e.g., QR scan, manual override) for strict auditing.
        *   **Operations:** `GpsLog` for historical tracking, `Incident` for breakdowns, and `Notification` for communication history.

## 4. Backend Library Wrappers (`apps/backend/src/lib/`)

*   **`prisma.ts`**
    *   **Purpose:** Singleton database client.
    *   **Explanation:** Ensures we don't accidentally open 100 database connections every time a file runs in development mode.
*   **`redis.ts` & `queue.ts`**
    *   **Purpose:** High-speed caching and background jobs.
    *   **Explanation:** Connects to Redis. `queue.ts` initializes BullMQ, which we use to offload heavy, slow tasks (like sending 5000 push notifications) so the main API doesn't crash or lag.
*   **`firebase.ts`**
    *   **Purpose:** Connects to Google Firebase Admin SDK.
    *   **Explanation:** Used for two things: verifying login tokens securely without building our own password system, and pushing live GPS coordinates to the Realtime Database.
*   **`msg91.ts`**
    *   **Purpose:** SMS dispatcher wrapper.
    *   **Explanation:** Used for high-priority emergency texts (like a breakdown SOS sent to coordinators).

## 5. Backend Modules (The API Logic)

*   **Auth Module (`src/modules/auth/`)**
    *   **`auth.middleware.ts`:** Inspects incoming API requests for a Bearer token, verifies it against Firebase, fetches the user's role from Postgres, and attaches their details to the request. Also contains the `requireRole` function to block students from accessing driver endpoints.
    *   **`auth.routes.ts` & `.service.ts`:** Provides the `/me` endpoint which securely returns a user's nested profile data (e.g., what bus they are assigned to) based on their identity.
*   **QR Module (`src/modules/qr/`)**
    *   **`qr.service.ts`:** When a driver opens the app, this securely signs a cryptographic JWT containing a unique `nonce` (a random ID) and saves that nonce to Redis. When a student scans it, it "burns" (deletes) the nonce atomically from Redis. This mathematically guarantees a QR code cannot be passed to a friend or scanned twice.
*   **GPS Module (`src/modules/gps/`)**
    *   **`gps.service.ts` & `routes.ts`:** Exposes a high-throughput endpoint for the driver's phone to ping its location every few seconds. It saves this to PostgreSQL for historical record-keeping and instantly updates Firebase Realtime DB so students looking at the map see the bus moving smoothly.
*   **Trips Module (`src/modules/trips/`)**
    *   **`trips.service.ts` & `routes.ts`:** Manages the lifecycle of a bus journey. Drivers hit `/start` to begin tracking attendance and `/end` when they reach the terminal.
*   **Attendance Module (`src/modules/attendance/`)**
    *   **`attendance.service.ts` & `routes.ts`:** The heart of the system. A student's app hits `/checkin` with the QR token and their GPS coordinates. The service:
        1. Validates the QR signature.
        2. Checks the student's distance to the bus/stop (Geofencing).
        3. Transactionally records them as PRESENT.
        4. Writes an immutable `AttendanceEvent` ledger entry.
        5. Increments the total boarded count on the trip.
*   **Incidents Module (`src/modules/incidents/`)**
    *   **`incidents.service.ts` & `routes.ts`:** Allows drivers to report a breakdown (e.g., Flat Tyre). It instantly updates the trip status and triggers an emergency alert to route coordinators.
*   **Notifications Module (`src/modules/notifications/`)**
    *   **`notifications.service.ts` & `jobs/notification.worker.ts`:** Handles communication. Because sending thousands of push notifications at once would crash an HTTP server, the service simply chunks the users and drops them into a BullMQ queue. The background worker (`notification.worker.ts`) safely picks them up, chunks DB inserts, and triggers bulk FCM pushes without blocking the rest of the application.

## 6. App Assembly & Real-Time Setup

*   **`src/websocket/socket.ts`**
    *   **Purpose:** Bidirectional real-time communication.
    *   **Explanation:** Sits on top of the Fastify server using `@socket.io/redis-adapter` (ensuring it works even if we scale to 10 separate server instances). Clients can join logical rooms like `bus:123` or `route:45` to receive live streams of specific events.
*   **`src/app.ts`**
    *   **Purpose:** The Express/Fastify Application definition.
    *   **Explanation:** Wires every single route module (Auth, GPS, Attendance) into one global application router and sets up global error handling and CORS.
*   **`src/server.ts`**
    *   **Purpose:** The exact entry point.
    *   **Explanation:** Bootstraps Fastify, attaches the WebSocket listener, spins up the BullMQ background workers, and officially binds the app to port `3000` to start accepting internet traffic.

## Next Steps (Phase 2)
The backend is now completely robust and production-ready. The next logical step is to begin building the **Frontend Clients** (the React Native Mobile App for Students/Drivers, and the React Admin Web Panel for the Transport Office) to interact with this API!
