# Secret Management

**Reviewed:** 2026-04-23

This repo has three config classes. Treat them differently.

## 1. Server-only secrets

These never belong in git and never belong in `VITE_*` or `EXPO_PUBLIC_*`.

- `DATABASE_URL`
- `REDIS_URL`
- `JWT_SECRET`
- `ADMIN_MFA_ENCRYPTION_KEY`
- `CLOUD_TASKS_SECRET`
- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `MSG91_AUTH_KEY`
- any future `METRICS_TOKEN`, `SENTRY_DSN`, SMTP credentials, or third-party private keys

Storage:

- local development: repo-root `.env` or `apps/backend/.env`
- GitHub Actions: GitHub Actions secrets only for CI/deploy credentials
- deployed backend runtime: GCP Secret Manager, injected with `gcloud run deploy --set-secrets`

## 2. Environment-specific but non-secret backend config

These are safe to document, but they still need per-environment values.

- `BACKEND_URL`
- `CORS_ALLOWED_ORIGINS`
- `GOOGLE_CLOUD_PROJECT`
- `CLOUD_TASKS_QUEUE`
- `CLOUD_TASKS_LOCATION`
- `CLOUD_TASKS_SA_EMAIL`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_DATABASE_URL`
- `ADMIN_COOKIE_DOMAIN`

Storage:

- local development: `.env`
- deploy workflows: GitHub Actions secrets or repo/environment variables
- runtime: plain env vars on Cloud Run

## 3. Public client config

These are exposed to shipped clients by design. Do not put secrets here.

Admin `VITE_*`:

- `VITE_API_URL`
- `VITE_FIREBASE_*`
- `VITE_GOOGLE_MAPS_API_KEY`

Mobile `EXPO_PUBLIC_*`:

- `EXPO_PUBLIC_API_URL`
- `EXPO_PUBLIC_SOCKET_URL`
- `EXPO_PUBLIC_FIREBASE_*`
- `EXPO_PUBLIC_PROJECT_ID`
- `EXPO_PUBLIC_SUPPORT_PHONE`
- `EXPO_PUBLIC_ENVIRONMENT`

These should live in local app `.env` files, EAS environment config, or CI/CD build args. They are configuration, not secret storage.

## Local files

Use these templates:

- backend/runtime: [`.env.example`](../.env.example)
- admin: [`apps/admin/.env.example`](../apps/admin/.env.example)
- mobile: [`apps/mobile/.env.example`](../apps/mobile/.env.example)

Keep ignored local files out of git:

- `.env`
- `apps/backend/.env`
- `apps/admin/.env`
- `apps/mobile/.env`
- `apps/mobile/google-play-key.json`

## GitHub Actions secrets expected

Current workflows assume these GitHub-side secrets exist:

- `GCP_SA_KEY`
- `GCP_PROJECT_ID`
- `HEALTH_CHECK_TOKEN`
- `EXPO_TOKEN`

Recommended additions if staging and production split into separate projects:

- `GCP_PROJECT_ID_STAGING`
- `GCP_PROJECT_ID_PRODUCTION`
- `CLOUD_TASKS_SA_EMAIL_STAGING`
- `CLOUD_TASKS_SA_EMAIL_PRODUCTION`
- environment-specific public build vars for admin/mobile if they differ

## GCP Secret Manager names expected by deploy workflows

Already referenced:

- staging: `database-url-staging`, `redis-url-staging`, `jwt-secret-staging`
- production: `database-url`, `redis-url`, `jwt-secret`, `firebase-sa`

Still missing from workflow wiring if production validation is enforced:

- `admin-mfa-encryption-key-staging`
- `admin-mfa-encryption-key`
- `cloud-tasks-secret-staging`
- `cloud-tasks-secret`
- `firebase-sa-staging`
- any MSG91 secret names if SMS stays enabled

## Current drift and not-yet-configured items

As of 2026-04-23:

- The backend code expects `FIREBASE_SERVICE_ACCOUNT_JSON` as one JSON string. The old root template documented split Firebase key fields; that drift is now fixed in the template.
- `apps/mobile/EAS_SETUP.md` previously implied `EXPO_PUBLIC_PROJECT_ID` was tied to Expo push token registration. That is inaccurate for the current FCM direction; it is now documented as EAS project wiring only.
- The backend production env validator requires more runtime config than the deploy workflows currently inject. Until those values are wired, deployment is not fully production-ready.
- `METRICS_TOKEN`, `SENTRY_DSN`, and a repo-wide secret-management automation path for EAS/mobile builds are still planned work, not complete work.
- Dual Redis (`REDIS_A_*` / `REDIS_B_*`) is documented in architecture notes but not fully standardized across the runtime/env path.

## Rules

- Never commit real secrets.
- Never put server credentials in `VITE_*` or `EXPO_PUBLIC_*`.
- Prefer Secret Manager for runtime secrets over long plaintext GitHub secrets.
- Keep the env templates honest. If code changes env names, update the template in the same change.
