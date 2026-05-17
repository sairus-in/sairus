# College Bus Management System: Config & Integration Guide

This guide outlines all the configuration settings, secrets, and environment variables required to run, build, and deploy the College Bus Management System across its four primary integrations: **Google Cloud Platform (GCP)**, **Google Maps**, **Redis**, and **Firebase Realtime Database (RTDB)**.

---

## 🗺️ Monorepo Architecture Overview

The project is structured as a `pnpm` monorepo:
*   **Backend (`apps/backend`):** Express & Fastify runtime managing core business logic, Prisma ORM (PostgreSQL), Redis caching/rate limiting, GCP Cloud Tasks scheduling, and Firebase Admin SDK credentials.
*   **Admin Panel (`apps/admin`):** React + Vite SPA showing operational control panels, auditing logs, and the Fleet Map (using Google Maps and Firebase RTDB).
*   **Mobile App (`apps/mobile`):** Expo-based React Native mobile app used by drivers (active trip location tracking) and students (live bus tracking Map with Reanimated dead-reckoning).

---

## 1. Google Cloud Platform (GCP) Configuration

GCP is utilized for two main functions: **Background Task Scheduling (Cloud Tasks)** and **Containerized Deployments (Cloud Run + Cloud Build)**.

### ⚡ Cloud Tasks (Background Queue)
The backend uses Cloud Tasks to schedule system jobs asynchronously (such as automatic trip cancellation, stale trip handling, and alert expirations).
*   **Target File:** `apps/backend/src/lib/cloud-tasks.ts`
*   **Required Variables (Backend):**
    *   `GOOGLE_CLOUD_PROJECT`: The ID of your GCP project (required in `production`).
    *   `CLOUD_TASKS_QUEUE`: The name of the Cloud Tasks queue (defaults to `system-jobs`).
    *   `CLOUD_TASKS_LOCATION`: The location region of your queue (defaults to `asia-south1`).
    *   `CLOUD_TASKS_SA_EMAIL`: The Google Service Account email used to authorize Cloud Tasks callbacks back to the backend service. (Required in `production`).
    *   `CLOUD_TASKS_SECRET`: A secure validation string (at least 16 chars) used to verify that inbound queue webhook requests are legitimately coming from your Cloud Tasks scheduler.

### 🚢 Production Deployment & Secrets
The production environment runs on **Google Cloud Run**.
*   **GCP Secret Manager:** To keep server-only secrets secure, do not configure them as plain environment variables in your Cloud Run instance. Store them in GCP Secret Manager and mount/inject them under the following names:
    *   `database-url` / `database-url-staging`
    *   `redis-url` / `redis-url-staging`
    *   `jwt-secret` / `jwt-secret-staging`
    *   `firebase-sa` / `firebase-sa-staging` (Service account JSON key)
    *   `admin-mfa-encryption-key` / `admin-mfa-encryption-key-staging`
    *   `cloud-tasks-secret` / `cloud-tasks-secret-staging`
*   **GitHub Actions Secrets:** If you are running CI/CD automation to build and deploy, the workflows expect:
    *   `GCP_SA_KEY`: Service Account JSON credentials for building/deploying.
    *   `GCP_PROJECT_ID`: Target GCP Project ID.

---

## 2. Firebase & Realtime Database (RTDB) Configuration

Firebase coordinates live coordination, telemetry (sending real-time GPS coordinates of the buses), and Push Notifications (FCM).

### 🖥️ Backend (Firebase Admin SDK)
The backend requires administrative credentials to write GPS telemetry updates, send alerts, and distribute Push Notifications.
*   **Target File:** `apps/backend/src/lib/firebase.ts`
*   **Required Variables (Backend):**
    *   `FIREBASE_PROJECT_ID`: The ID of the Firebase project.
    *   `FIREBASE_SERVICE_ACCOUNT_JSON`: The full private key JSON object provided by Firebase Console for the service account, formatted **as a single-line stringified JSON string**.
    *   `FIREBASE_DATABASE_URL`: The URL of your Firebase Realtime Database (e.g., `https://your-project-default-rtdb.firebaseio.com`).

### 🛠️ Admin Panel (Web Client)
The Fleet Map screen subscribes directly to Firebase Realtime Database nodes to display live bus movements.
*   **Target File:** `apps/admin/src/lib/firebase.ts`
*   **Required Variables (`apps/admin/.env`):**
    *   `VITE_FIREBASE_API_KEY`
    *   `VITE_FIREBASE_AUTH_DOMAIN`
    *   `VITE_FIREBASE_PROJECT_ID`
    *   `VITE_FIREBASE_DATABASE_URL`
    *   `VITE_FIREBASE_STORAGE_BUCKET`
    *   `VITE_FIREBASE_MESSAGING_SENDER_ID`
    *   `VITE_FIREBASE_APP_ID`

### 📱 Mobile Client (React Native / Expo)
Used to stream driver locations to Firebase RTDB and register for Push Notifications.
*   **Required Variables (`apps/mobile/.env`):**
    *   `EXPO_PUBLIC_FIREBASE_API_KEY`
    *   `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN`
    *   `EXPO_PUBLIC_FIREBASE_PROJECT_ID`
    *   `EXPO_PUBLIC_FIREBASE_DATABASE_URL`
    *   `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET`
    *   `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
    *   `EXPO_PUBLIC_FIREBASE_APP_ID`

---

## 3. Google Maps API Configuration

Google Maps is integrated into both the operational Admin dashboard and the Student mobile map screen.

### 🖥️ Admin Panel Fleet Map
Used to render the desktop vehicle tracking dashboard.
*   **Required Variable (`apps/admin/.env` or Docker Build Args):**
    *   `VITE_GOOGLE_MAPS_API_KEY`: A web-restricted Google Maps API key with **Maps JavaScript API** enabled.

### 📱 Mobile Map (`react-native-maps`)
The student UI uses React Native Maps to render live trip progressions.
*   **iOS Integration:** Uses Apple Maps (MapKit) by default, which does **not** require any API key.
*   **Android Integration:** Uses Google Maps, which **does** require a Google Maps Android SDK API key.
*   *Note:* To supply the Google Maps API Key on Android in Expo, you must configure the key under `android.config.googleMaps.apiKey` inside your `apps/mobile/app.config.ts` (or app.json if using standard setup). Currently, the codebase is using default providers, so you should add this config if building custom Android APKs/bundles.

---

## 4. Redis Configuration

Redis handles server-side token blacklists (auth-revocation), session storage, distributed locks (trip states), and API rate limiting.

### 💻 Local Development (Docker Compose)
A preconfigured Redis server is available for local work.
*   **Location:** `infra/docker/docker-compose.yml`
*   **Port Mapping:** Maps local port `6380` to containers internal `6379`.
*   **Required Variable (Root `.env`):**
    *   `REDIS_URL="redis://localhost:6380"`

### 🚀 Production Integration
*   Set `REDIS_URL` in GCP Secret Manager to point to a secure, password-protected Redis cluster (e.g., Memorystore or Redis Enterprise) using the `rediss://` protocol:
    *   `REDIS_URL="rediss://default:PASSWORD@HOST:PORT"`
*   **Dual-Redis Setup:** The environment supports an optional split production setup (`REDIS_A_URL` and `REDIS_B_URL`) in architecture plans, but standard implementations prioritize `REDIS_URL` for end-to-end routing.

---

## 📋 Comprehensive Environment Configuration Templates

Copy these templates to local files that are ignored by git (added to `.gitignore`):

### 1. Root Directory `.env` / `apps/backend/.env`
```ini
# --- Database ---
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/bus_management?schema=public"

# --- Redis ---
REDIS_URL="redis://localhost:6380"

# --- Authentication ---
JWT_SECRET="replace_me_with_a_local_secret_at_least_32_chars"
JWT_ISSUER="college-bus-system"
JWT_MOBILE_AUDIENCE="college-bus-mobile"
JWT_ADMIN_AUDIENCE="college-bus-admin"
ADMIN_MFA_ISSUER="College Bus Admin"
ADMIN_MFA_ENCRYPTION_KEY="replace_me_with_a_random_key_at_least_32_chars"
ADMIN_COOKIE_DOMAIN=""

# --- Server / routing ---
PORT=3000
HOST="0.0.0.0"
NODE_ENV="development"
BACKEND_URL="http://localhost:3000"
CORS_ALLOWED_ORIGINS="http://localhost:5173"

# --- Cloud Tasks / GCP ---
GOOGLE_CLOUD_PROJECT="your-gcp-project-id"
CLOUD_TASKS_QUEUE="system-jobs"
CLOUD_TASKS_LOCATION="asia-south1"
CLOUD_TASKS_SA_EMAIL="service-account@your-gcp-project-id.iam.gserviceaccount.com"
CLOUD_TASKS_SECRET="replace_me_with_a_secret_at_least_16_chars"

# --- Firebase Admin SDK (Secret) ---
FIREBASE_PROJECT_ID="your-firebase-project-id"
FIREBASE_DATABASE_URL="https://your-firebase-project-id-default-rtdb.firebaseio.com"
FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account","project_id":"...","private_key":"..."}'

# --- Optional Integrations ---
MSG91_AUTH_KEY=""
MSG91_ALERT_TEMPLATE_ID=""
```

### 2. Admin Panel `apps/admin/.env`
```ini
VITE_API_URL=http://localhost:3000

# Firebase configuration for Fleet Map
VITE_FIREBASE_API_KEY="AIzaSy..."
VITE_FIREBASE_AUTH_DOMAIN="your-firebase-project-id.firebaseapp.com"
VITE_FIREBASE_PROJECT_ID="your-firebase-project-id"
VITE_FIREBASE_DATABASE_URL="https://your-firebase-project-id-default-rtdb.firebaseio.com"
VITE_FIREBASE_STORAGE_BUCKET="your-firebase-project-id.appspot.com"
VITE_FIREBASE_MESSAGING_SENDER_ID="1234567890"
VITE_FIREBASE_APP_ID="1:12345:web:abcd123"

# Google Maps Javascript API
VITE_GOOGLE_MAPS_API_KEY="AIzaSy..."
```

### 3. Mobile Client `apps/mobile/.env`
```ini
APP_ENV=development

# Expo EAS Project configuration
EXPO_OWNER="your-expo-account-or-org"
EXPO_PUBLIC_PROJECT_ID="your-eas-project-id"

# Backend Endpoints
EXPO_PUBLIC_API_URL=http://localhost:3000
EXPO_PUBLIC_SOCKET_URL=http://localhost:3000

# Firebase configuration
EXPO_PUBLIC_FIREBASE_API_KEY="AIzaSy..."
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN="your-firebase-project-id.firebaseapp.com"
EXPO_PUBLIC_FIREBASE_PROJECT_ID="your-firebase-project-id"
EXPO_PUBLIC_FIREBASE_DATABASE_URL="https://your-firebase-project-id-default-rtdb.firebaseio.com"
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET="your-firebase-project-id.appspot.com"
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID="1234567890"
EXPO_PUBLIC_FIREBASE_APP_ID="1:12345:web:abcd123"
```

---

## 🏁 Step-by-Step Initial Configuration Checklist

1.  **Spin Up Local Infrastructure:**
    Ensure Docker is running and run the compose command to launch PostgreSQL & Redis:
    ```bash
    docker compose -f infra/docker/docker-compose.yml up -d
    ```
2.  **Generate Local Secrets:**
    *   Create a random 32-character string for `JWT_SECRET` and `ADMIN_MFA_ENCRYPTION_KEY`.
    *   Create a random 16-character string for `CLOUD_TASKS_SECRET`.
3.  **Download Firebase Credentials:**
    *   Go to **Firebase Console** -> **Project Settings** -> **Service Accounts**.
    *   Generate a new Private Key, copy the raw JSON, and stringify it on a single line (removing newlines) to populate `FIREBASE_SERVICE_ACCOUNT_JSON`.
    *   Retrieve the client-side config snippet and copy those values to `apps/admin/.env` (`VITE_FIREBASE_*`) and `apps/mobile/.env` (`EXPO_PUBLIC_FIREBASE_*`).
4.  **Set Up Google Maps Credentials:**
    *   Go to **Google Cloud Console** -> **APIs & Services** -> **Credentials**.
    *   Create an API Key and restrict it to **Maps JavaScript API** (for Web) and **Maps SDK for Android** (for Mobile).
5.  **Expo EAS Project Linkage (Mobile):**
    From the root directory, authenticate and link mobile to Expo:
    ```bash
    pnpm.cmd --filter mobile run eas:whoami
    pnpm.cmd --filter mobile exec eas login
    pnpm.cmd --filter mobile run eas:init
    ```
    Copy the generated project ID from `eas.json` and paste it into `apps/mobile/.env` as `EXPO_PUBLIC_PROJECT_ID`.
