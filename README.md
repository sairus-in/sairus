# College Bus Management System

Internal monorepo for the college bus management platform. Production target: **180+ buses, thousands of students**. Phase 1 is bus-focused (QR attendance, live GPS, trip lifecycle, breakdowns, admin ops); phase 2 grows the same repo into a broader **university utility platform**.

This is a private, internal project — there is no public README, no contribution flow, no issue template. If you're reading this you already have write access.

---

## What's in here

```
apps/
  backend/    Fastify API + Socket.IO + Cloud Tasks jobs + Prisma
  admin/      React + Vite SPA for bus operations staff
  mobile/     Expo + React Native app for students and drivers
packages/
  shared/     Types, Zod schemas, constants, validators, policy, utils
infra/
  docker/     docker-compose.yml for local Postgres + Redis
  cloudbuild/ GCP Cloud Build pipelines
  gcp/        GCP infra scripts
docs/         Architecture, runbooks, contracts, audits
.github/workflows/   CI + deploy-staging + deploy-production
```

- **Package manager:** pnpm 10.32.1 with workspaces.
- **Build orchestration:** Turborepo.
- **Language:** TypeScript (strict) end-to-end.

---

## Stack (one-liner)

TypeScript + Fastify + Prisma/Postgres + Redis + Socket.IO + Firebase RTDB/FCM + GCP Cloud Tasks. Admin is React+Vite, mobile is Expo. Deployed on Cloud Run + Cloud SQL + Memorystore in `asia-south1`.

Full stack rationale and invariants: [`CLAUDE.md`](CLAUDE.md).
Architecture diagrams and data flows: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Local setup

### Prerequisites

- Node.js 20.x
- pnpm 10.32.1 (`corepack enable` is enough)
- Docker Desktop (for Postgres + Redis)
- GCP `gcloud` CLI (only needed when testing Cloud Tasks end-to-end)
- Firebase project with Admin SDK credentials (only needed for auth / push testing)

### First-time setup

```bash
# from repo root
pnpm install

# start local Postgres (5433) + Redis (6380)
docker compose -f infra/docker/docker-compose.yml up -d

# copy backend env template and fill it in
cp .env.example .env
# optional: also copy to apps/backend/.env if you run backend commands from
# apps/backend directly instead of the repo root
cp .env.example apps/backend/.env

# copy frontend env templates as needed
cp apps/admin/.env.example apps/admin/.env
cp apps/mobile/.env.example apps/mobile/.env

# generate Prisma client and run migrations
pnpm --filter backend db:generate
pnpm --filter backend db:migrate

# optional: Prisma Studio for poking at data
pnpm --filter backend db:studio   # http://localhost:5555
```

### Running the apps

```bash
# all apps in parallel (Turbo persistent task)
pnpm dev

# or individually:
pnpm --filter backend dev          # http://localhost:3000
pnpm --filter admin dev            # http://localhost:5173
cd apps/mobile && pnpm start       # Expo dev server
```

Health probes on the backend:

- `GET /v1/live` — liveness (always 200 if the process is up)
- `GET /v1/ready` — readiness (DB + Redis checks)

---

## Common commands

```bash
# type-check everything
pnpm --filter backend type-check
pnpm --filter admin build          # vite build includes tsc
cd apps/mobile && pnpm type-check  # (currently fails — see PLANNED_NOT_IMPLEMENTED.md)

# unit + integration tests (backend + shared)
pnpm --filter backend test -- --run
pnpm --filter shared test -- --run

# backend smoke suite — exercises auth, trip start, QR refresh, check-in, trip end
pnpm --filter backend e2e:smoke

# formatting
pnpm format

# Prisma workflow
pnpm --filter backend db:migrate     # create + apply a dev migration
pnpm --filter backend db:generate    # regenerate the client
pnpm --filter backend db:studio      # open Prisma Studio
```

---

## Environment

The backend Zod-validates its env at boot ([`apps/backend/src/lib/env.ts`](apps/backend/src/lib/env.ts)) and **throws on invalid production config** — don't work around it, fix the env.

Templates:

- backend/runtime: [`.env.example`](.env.example)
- admin SPA: [`apps/admin/.env.example`](apps/admin/.env.example)
- mobile app: [`apps/mobile/.env.example`](apps/mobile/.env.example)

Detailed policy and deployment mapping: [`docs/SECRET_MANAGEMENT.md`](docs/SECRET_MANAGEMENT.md).

Backend production requirements include:

- `JWT_SECRET` ≥ 32 chars
- `ADMIN_MFA_ENCRYPTION_KEY` ≥ 32 chars
- `CLOUD_TASKS_SECRET` ≥ 16 chars
- `CORS_ALLOWED_ORIGINS` (comma-separated, no trailing slash)
- Full Firebase triple (`FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `FIREBASE_DATABASE_URL`)
- `GOOGLE_CLOUD_PROJECT`, `CLOUD_TASKS_QUEUE`, `CLOUD_TASKS_LOCATION`, `CLOUD_TASKS_SA_EMAIL`

Local dev works with only `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`.

Public client config is intentionally separate:

- admin uses `VITE_*` values at build time
- mobile uses `EXPO_PUBLIC_*` values at build time
- neither namespace should contain server-only secrets

---

## Repo conventions

Read [`CLAUDE.md`](CLAUDE.md) before writing code. The non-negotiables (short version):

- `packages/shared` is the single source of truth for cross-app types/schemas/constants.
- Backend modules follow a strict 4-layer pattern: **routes → service → repository**.
- Attendance is event-sourced (`AttendanceEvent` is append-only).
- Idempotency is mandatory on mutations.
- Background work runs on **Cloud Tasks, never `node-cron`**.
- All routes live under `/v1/*`.
- Any route change updates [`docs/API_CONTRACT_MATRIX.md`](docs/API_CONTRACT_MATRIX.md) in the same PR.
- Any socket event change updates [`docs/SOCKET_EVENT_REGISTRY.md`](docs/SOCKET_EVENT_REGISTRY.md) in the same PR.

Forbidden patterns are listed in [`CLAUDE.md` §16](CLAUDE.md#16-forbidden-patterns).

---

## Git workflow

Branching and PR policy: [`docs/GIT_WORKFLOW.md`](docs/GIT_WORKFLOW.md).
Repository bootstrap for GitHub environments, branch protection, and required checks: [`docs/REPO_BOOTSTRAP.md`](docs/REPO_BOOTSTRAP.md).

- Default branch: `main`.
- Feature branches branch off `develop` (current working branch in this checkout).
- CI (type-check + tests + build) must be green before merge.
- Contract doc updates ship in the same PR as the code change.

---

## Docs index

| Document                                                                           | Purpose                                                                                |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [`CLAUDE.md`](CLAUDE.md)                                                           | **Start here for any code change.** Rules, invariants, codebase map, extending safely. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)                                     | System context, component boundaries, data flows, deployment, phase-2 roadmap.         |
| [`docs/API_CONTRACT_MATRIX.md`](docs/API_CONTRACT_MATRIX.md)                       | Authoritative route inventory.                                                         |
| [`docs/SOCKET_EVENT_REGISTRY.md`](docs/SOCKET_EVENT_REGISTRY.md)                   | Authoritative socket event inventory.                                                  |
| [`docs/E2E_CRITICAL_PATHS.md`](docs/E2E_CRITICAL_PATHS.md)                         | P0/P1 flows and failure drills.                                                        |
| [`docs/PRODUCTION_READINESS_CHECKLIST.md`](docs/PRODUCTION_READINESS_CHECKLIST.md) | Pre-launch gate.                                                                       |
| [`docs/PRODUCTION_READINESS_STATUS.md`](docs/PRODUCTION_READINESS_STATUS.md)       | Dated snapshot — completed and in-progress work.                                       |
| [`docs/PLANNED_NOT_IMPLEMENTED.md`](docs/PLANNED_NOT_IMPLEMENTED.md)               | Gap audit: what was planned/documented but is not yet built.                           |
| [`docs/GIT_WORKFLOW.md`](docs/GIT_WORKFLOW.md)                                     | Branching and PR policy.                                                               |
| [`docs/REPO_BOOTSTRAP.md`](docs/REPO_BOOTSTRAP.md)                                 | GitHub repo setup, branch protection, environments, and required checks.               |
| [`docs/SECRET_MANAGEMENT.md`](docs/SECRET_MANAGEMENT.md)                           | Secret boundaries, env files, GitHub Actions secrets, and GCP Secret Manager mapping.  |
| [`docs/runbooks/`](docs/runbooks/)                                                 | Operational playbooks for real incidents.                                              |
| [`docs/module-audits/`](docs/module-audits/)                                       | Per-module audit notes.                                                                |
| [`docs/post-mortems/`](docs/post-mortems/)                                         | Incident post-mortems.                                                                 |
| [`docs/archive/`](docs/archive/)                                                   | Superseded plans / historical drafts.                                                  |

Dated audit snapshots (**not policy** — kept for context):

- [`docs/SYSTEM_FULL_ANALYSIS.md`](docs/SYSTEM_FULL_ANALYSIS.md) (2026-03-24)
- [`docs/ARCHITECTURE_STANDARDIZATION_ROADMAP.md`](docs/ARCHITECTURE_STANDARDIZATION_ROADMAP.md) (2026-04-04)
- [`docs/MOBILE_SYSTEM_FULL_AUDIT_2026-04-13.md`](docs/MOBILE_SYSTEM_FULL_AUDIT_2026-04-13.md) (2026-04-13)

---

## Status

This system is **pre-launch**. Backend core is materially production-capable; mobile has known contract gaps; admin is feature-complete but needs MFA re-enabled. Current state lives in [`docs/PRODUCTION_READINESS_STATUS.md`](docs/PRODUCTION_READINESS_STATUS.md) and the outstanding-work punch list is in [`docs/PLANNED_NOT_IMPLEMENTED.md`](docs/PLANNED_NOT_IMPLEMENTED.md).
