# Engineering Operations Guide
## College Bus Management System
### Git, CI/CD, SRE, DevOps — How Real Systems Are Managed

> Written specifically for this system. Not generic theory.
> A solo developer running a production system that 6,000 students depend on at 8am.

---

## Table of Contents

1. [How the system is managed day to day](#1-day-to-day-management)
2. [Git branching strategy](#2-git-branching-strategy)
3. [How changes are made safely](#3-how-changes-are-made-safely)
4. [CI/CD pipelines — complete setup](#4-cicd-pipelines)
5. [How deployments work without downtime](#5-zero-downtime-deployments)
6. [SRE — what it means for your system](#6-site-reliability-engineering)
7. [Monitoring and alerting setup](#7-monitoring-and-alerting)
8. [Incident response — when things break at 8am](#8-incident-response)
9. [Database migrations without downtime](#9-database-migrations)
10. [Feature flags — ship code without turning it on](#10-feature-flags)
11. [Environment strategy](#11-environment-strategy)
12. [On-call and runbooks](#12-runbooks)

---

## 1. Day to Day Management

### What "managing a production system" actually means

When your system is live and students are using it, you are responsible for:

```
Morning (7am–9:30am):
  Watch Sentry for new errors
  Watch UptimeRobot for health check failures
  Watch GCP Cloud Monitoring for GPS offline alerts
  Be available to respond if something breaks
  DO NOT deploy during this window

Daytime (10am–5pm):
  Normal development — write code, test locally
  Code review (even solo — review your own PRs before merging)
  Respond to support tickets from transport office

Evening (6pm–10pm):
  Deploy changes (safe window)
  Monitor after deploy for 30 minutes
  Run database migrations if needed

Night (11pm):
  Cloud Scheduler runs create-daily-trips job
  Verify it ran successfully (check logs next morning)
```

### The morning window rule

**Never deploy between 6:30am and 10am.**

This is non-negotiable. Even a perfect deployment causes 10–30 seconds of
elevated latency during Cloud Run instance swap. During student check-in,
that 30 seconds affects 500+ students. Not worth it.

Set a calendar reminder: "🔴 No deploys 6:30am–10am" every weekday.

---

## 2. Git Branching Strategy

### The branch model for a solo production system

```
main                    ← production. what's live on Cloud Run.
  └── develop           ← integration branch. staging environment.
        ├── feature/qr-per-scan-fix
        ├── feature/add-wait-for-me
        ├── fix/attendance-timezone-bug
        └── fix/redis-startup-race
```

**Rules:**
- `main` = what's deployed. Never commit directly to main.
- `develop` = what's tested and ready. Deployed to staging automatically.
- Feature branches = where you work. Short-lived. Never more than 2–3 days.
- Hotfix branches = emergency fixes that go directly to main.

### Branch naming convention

```bash
# New features
git checkout -b feature/add-correction-request-email
git checkout -b feature/driver-substitute-flow

# Bug fixes
git checkout -b fix/qr-nonce-race-condition
git checkout -b fix/ist-timezone-attendance-date

# Hotfixes (production emergency)
git checkout -b hotfix/checkin-500-error

# Infrastructure / DevOps
git checkout -b infra/add-github-actions-pipeline
git checkout -b infra/cloud-run-min-instances

# Database changes
git checkout -b db/add-arrival-verified-field
```

### Commit message convention (Conventional Commits)

```bash
# Format: type(scope): description

feat(attendance): add arrival verification endpoint
fix(qr): use getdel instead of get+del for atomic nonce burn
fix(jobs): resolve N+1 query in create-daily-trips
perf(gps): pipeline redis reads in heartbeat check
chore(deps): update prisma to 5.10.0
docs(api): add openapi schema for check-in endpoint
test(attendance): add geofence boundary test cases
refactor(auth): extract jwt verification to shared util
security(jobs): add oidc verification to cloud task middleware
db(schema): add arrivalVerified field to AttendanceLog
```

Why this matters:
- Auto-generates changelogs
- Makes git history searchable ("why did this break?" → search commits)
- CI/CD can detect what changed and run only relevant tests

---

## 3. How Changes Are Made Safely

### The full lifecycle of a code change

```
1. Create feature branch
   git checkout develop
   git pull origin develop
   git checkout -b fix/qr-nonce-race-condition

2. Write the code
   Make changes in small, logical commits
   Test locally against docker-compose (Postgres + Redis)

3. Write tests
   At minimum: test the happy path and the main failure case
   For attendance check-in: test all 6 validation checks

4. Self-review (yes, even solo)
   git diff develop..HEAD
   Read every line you changed as if you're reviewing someone else's code
   Ask: could this break anything that currently works?

5. Push and create PR
   git push origin fix/qr-nonce-race-condition
   Open PR: feature branch → develop
   CI/CD runs automatically (tests, type check, lint)

6. Merge to develop
   PR passes CI → merge
   Staging deploys automatically
   Test on staging with real-ish data

7. Promote to main
   Open PR: develop → main
   Review what's in this batch of changes
   Merge (choose safe window — not morning)
   Production deploys automatically
   Watch logs for 30 minutes
```

### What to check before merging to main

```
□ All CI checks green (tests, lint, typecheck)
□ Tested on staging environment
□ No migration pending that hasn't been reviewed
□ Not during morning window (6:30am–10am)
□ Sentry has no new open errors from staging deploy
□ If touching attendance/QR logic: manually tested the check-in flow
□ If touching background jobs: manually triggered the job on staging
```

### The rule of small PRs

A PR that changes 1 thing is 10x easier to review and debug than a PR
that changes 10 things.

```
Bad PR:
  "Add wait-for-me feature, fix timezone bug, update Redis caching,
   add pagination to corrections endpoint, bump dependencies"

Good PRs (5 separate ones):
  PR 1: "feat(student): add wait-for-me request flow"
  PR 2: "fix(attendance): use IST timezone for date strings"
  PR 3: "perf(cache): cache student home response for 60s"
  PR 4: "feat(admin): add pagination to corrections endpoint"
  PR 5: "chore(deps): update prisma, fastify, zod to latest"
```

If something breaks after merging PR 2, you know exactly what caused it.
If all 10 changes were in one PR, you're guessing.

---

## 4. CI/CD Pipelines

### What CI/CD actually does

```
CI = Continuous Integration
  Every time you push code, automated checks run:
  - Does it compile? (TypeScript type check)
  - Does it pass tests?
  - Does it follow code style? (ESLint)
  - Are there security vulnerabilities? (npm audit)
  This catches bugs before they reach production.

CD = Continuous Deployment
  If CI passes, code is automatically deployed:
  - develop branch → staging environment
  - main branch → production environment
  No manual "upload to server" step. Ever.
```

### Complete GitHub Actions setup

**File: `.github/workflows/ci.yml`**
Runs on every push to any branch.

```yaml
name: CI

on:
  push:
    branches: ['**']
  pull_request:
    branches: [main, develop]

jobs:
  # ─── Type Check ───────────────────────────────────────────
  typecheck:
    name: TypeScript
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci

      - name: Type check all workspaces
        run: npx turbo type-check

  # ─── Lint ─────────────────────────────────────────────────
  lint:
    name: ESLint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npx turbo lint

  # ─── Tests ────────────────────────────────────────────────
  test:
    name: Tests
    runs-on: ubuntu-latest

    services:
      # Real PostgreSQL for tests — not mocked
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: bus_management_test
        ports:
          - 5433:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

      # Real Redis for tests — not mocked
      redis:
        image: redis:7-alpine
        ports:
          - 6380:6379
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s

    env:
      DATABASE_URL: postgresql://postgres:postgres@localhost:5433/bus_management_test
      REDIS_URL: redis://localhost:6380
      JWT_SECRET: test-secret-not-for-production
      QR_SECRET: test-qr-secret
      NODE_ENV: test

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci

      - name: Run Prisma migrations on test DB
        run: |
          cd apps/backend
          npx prisma migrate deploy
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5433/bus_management_test

      - name: Run tests
        run: npx turbo test

  # ─── Security ─────────────────────────────────────────────
  security:
    name: Security audit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm audit --audit-level=high
        # Fails if high or critical vulnerabilities found
```

---

**File: `.github/workflows/deploy-staging.yml`**
Runs when develop branch changes.

```yaml
name: Deploy to Staging

on:
  push:
    branches: [develop]

jobs:
  deploy-backend-staging:
    name: Backend → Staging
    runs-on: ubuntu-latest
    needs: []  # Runs independently of CI (CI runs in parallel)

    steps:
      - uses: actions/checkout@v4

      - name: Authenticate to GCP
        uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY }}

      - name: Set up Cloud SDK
        uses: google-github-actions/setup-gcloud@v2

      - name: Build and push Docker image
        run: |
          gcloud builds submit \
            --tag gcr.io/${{ secrets.GCP_PROJECT_ID }}/bus-backend:staging-${{ github.sha }} \
            --file apps/backend/Dockerfile \
            .

      - name: Run migrations on staging DB
        run: |
          gcloud run jobs execute prisma-migrate-staging \
            --args="migrate,deploy" \
            --region asia-south1 \
            --wait
        # If migration fails, deployment is blocked

      - name: Deploy to Cloud Run staging
        run: |
          gcloud run deploy bus-backend-staging \
            --image gcr.io/${{ secrets.GCP_PROJECT_ID }}/bus-backend:staging-${{ github.sha }} \
            --region asia-south1 \
            --min-instances 1 \
            --max-instances 3 \
            --set-secrets "DATABASE_URL=DATABASE_URL_STAGING:latest,REDIS_URL=REDIS_URL_STAGING:latest"

      - name: Verify staging health
        run: |
          sleep 15  # Wait for instance to start
          STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://bus-backend-staging-xxx.run.app/v1/health)
          if [ "$STATUS" != "200" ]; then
            echo "Health check failed: $STATUS"
            exit 1
          fi
          echo "Staging healthy ✓"

  deploy-admin-staging:
    name: Admin Panel → Staging
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY }}
      - uses: google-github-actions/setup-gcloud@v2
      - name: Build and deploy admin
        run: |
          cd apps/admin
          npm ci
          VITE_API_URL=https://bus-backend-staging-xxx.run.app npm run build
          gcloud builds submit \
            --tag gcr.io/${{ secrets.GCP_PROJECT_ID }}/bus-admin:staging-${{ github.sha }} \
            --file Dockerfile .
          gcloud run deploy bus-admin-staging \
            --image gcr.io/${{ secrets.GCP_PROJECT_ID }}/bus-admin:staging-${{ github.sha }} \
            --region asia-south1 \
            --min-instances 0 \
            --max-instances 1
```

---

**File: `.github/workflows/deploy-production.yml`**
Runs when main branch changes.

```yaml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  # Safety check: don't deploy during morning window
  check-deploy-window:
    name: Check deploy window
    runs-on: ubuntu-latest
    steps:
      - name: Check time (IST)
        run: |
          HOUR=$(TZ='Asia/Kolkata' date +%H)
          MINUTE=$(TZ='Asia/Kolkata' date +%M)
          echo "Current IST time: ${HOUR}:${MINUTE}"

          # Block deploys from 6:30am to 10:00am IST
          if [ "$HOUR" -ge 6 ] && [ "$HOUR" -lt 10 ]; then
            if [ "$HOUR" -gt 6 ] || [ "$MINUTE" -ge 30 ]; then
              echo "🔴 BLOCKED: Cannot deploy during morning window (6:30am–10:00am IST)"
              echo "Students are boarding buses. Try after 10:00am."
              exit 1
            fi
          fi
          echo "✅ Deploy window is safe"

  deploy-backend:
    name: Backend → Production
    runs-on: ubuntu-latest
    needs: [check-deploy-window]
    environment: production  # Requires manual approval in GitHub

    steps:
      - uses: actions/checkout@v4

      - name: Authenticate to GCP
        uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY }}

      - uses: google-github-actions/setup-gcloud@v2

      - name: Build Docker image
        run: |
          gcloud builds submit \
            --tag gcr.io/${{ secrets.GCP_PROJECT_ID }}/bus-backend:${{ github.sha }} \
            --file apps/backend/Dockerfile \
            .

      - name: Run database migrations
        run: |
          gcloud run jobs execute prisma-migrate-prod \
            --args="migrate,deploy" \
            --region asia-south1 \
            --wait
        # Blocks deployment if migration fails

      - name: Deploy to Cloud Run (rolling)
        run: |
          gcloud run deploy bus-backend \
            --image gcr.io/${{ secrets.GCP_PROJECT_ID }}/bus-backend:${{ github.sha }} \
            --region asia-south1 \
            --min-instances 2 \
            --max-instances 10 \
            --concurrency 80 \
            --cpu 1 \
            --memory 512Mi \
            --no-cpu-throttling \
            --no-allow-unauthenticated \
            --set-secrets "DATABASE_URL=DATABASE_URL:latest,REDIS_URL=REDIS_URL:latest,JWT_SECRET=JWT_SECRET:latest,FIREBASE_SERVICE_ACCOUNT_JSON=FIREBASE_SERVICE_ACCOUNT_JSON:latest" \
            --tag latest

      - name: Verify production health
        run: |
          sleep 20
          for i in {1..5}; do
            STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
              -H "Authorization: Bearer ${{ secrets.HEALTH_CHECK_TOKEN }}" \
              https://bus-backend-xxx.run.app/v1/health)
            if [ "$STATUS" = "200" ]; then
              echo "✅ Production healthy"
              exit 0
            fi
            echo "Attempt $i failed ($STATUS), retrying..."
            sleep 10
          done
          echo "❌ Production health check failed after 5 attempts"
          exit 1

      - name: Notify on success
        if: success()
        run: |
          echo "🚌 Production deployed successfully"
          echo "SHA: ${{ github.sha }}"
          echo "Time: $(TZ='Asia/Kolkata' date)"
          # Could send to Slack/email here

      - name: Auto-rollback on failure
        if: failure()
        run: |
          echo "🔴 Deploy failed — rolling back to previous version"
          gcloud run services update-traffic bus-backend \
            --to-revisions=PREVIOUS=100 \
            --region asia-south1
          echo "Rollback complete"

  deploy-admin:
    name: Admin Panel → Production
    runs-on: ubuntu-latest
    needs: [check-deploy-window, deploy-backend]
    steps:
      - uses: actions/checkout@v4
      - uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY }}
      - uses: google-github-actions/setup-gcloud@v2
      - name: Build and deploy admin
        run: |
          cd apps/admin
          npm ci
          VITE_API_URL=https://bus-backend-xxx.run.app npm run build
          gcloud builds submit \
            --tag gcr.io/${{ secrets.GCP_PROJECT_ID }}/bus-admin:${{ github.sha }} \
            --file Dockerfile .
          gcloud run deploy bus-admin \
            --image gcr.io/${{ secrets.GCP_PROJECT_ID }}/bus-admin:${{ github.sha }} \
            --region asia-south1 \
            --min-instances 1 \
            --max-instances 5

  deploy-mobile-preview:
    name: Mobile → Expo Preview
    runs-on: ubuntu-latest
    needs: [check-deploy-window]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - uses: expo/expo-github-action@v8
        with:
          expo-version: latest
          token: ${{ secrets.EXPO_TOKEN }}
      - run: npm ci
      - name: Publish OTA update
        run: |
          cd apps/mobile
          # OTA update — no app store submission needed for JS changes
          # Students get update next time they open the app
          expo publish --release-channel production
```

### GitHub Secrets to configure

```
Go to: GitHub repo → Settings → Secrets and variables → Actions

Required secrets:
  GCP_SA_KEY              → GCP service account JSON (download from GCP Console)
  GCP_PROJECT_ID          → your GCP project ID
  EXPO_TOKEN              → from expo.dev account
  HEALTH_CHECK_TOKEN      → a special JWT for health check calls
```

---

## 5. Zero-Downtime Deployments

### How Cloud Run handles deployments

Cloud Run uses **rolling deployments** by default:

```
Before deploy:
  Instance 1 (old code) → serving 100% traffic
  Instance 2 (old code) → serving 100% traffic

During deploy:
  New image is built
  New instances start with new code
  Cloud Run waits until health check passes on new instances
  Traffic gradually shifts:
    Old: 80%, New: 20%
    Old: 40%, New: 60%
    Old: 0%,  New: 100%
  Old instances shut down gracefully

After deploy:
  Instance 1 (new code) → serving 100% traffic
  Instance 2 (new code) → serving 100% traffic
```

Students in the middle of a check-in on an old instance complete it.
New check-ins go to new instances. Zero dropped requests.

### What can cause downtime during a deployment

1. **Database migrations that lock tables**
   If you add a NOT NULL column without a default, PostgreSQL locks
   the entire table while it back-fills. 6,000 students' check-ins fail.
   Solution: always use safe migration patterns (see Section 9).

2. **The new code crashing on startup**
   If your new code has a bug that crashes the process, Cloud Run
   won't route traffic to it. But the health check takes 10–20 seconds
   to detect this. During that time, traffic might hit the broken instance.
   Solution: `--failure-threshold 3` in health check config.

3. **Cold start latency spike**
   `min-instances=2` prevents this. New instances are always warm.

### Traffic splitting for risky deploys

For major changes (new attendance logic, schema changes), use traffic splitting:

```bash
# Deploy new version but send only 10% of traffic to it
gcloud run services update-traffic bus-backend \
  --to-revisions=LATEST=10,PREVIOUS=90 \
  --region asia-south1

# Watch error rates in Sentry and Cloud Monitoring
# If clean after 30 minutes, shift to 100%
gcloud run services update-traffic bus-backend \
  --to-revisions=LATEST=100 \
  --region asia-south1

# If errors spike, instantly roll back
gcloud run services update-traffic bus-backend \
  --to-revisions=PREVIOUS=100 \
  --region asia-south1
```

---

## 6. Site Reliability Engineering

### What SRE actually means for your system

SRE (Site Reliability Engineering) is the discipline of keeping production
systems reliable. At Google scale it's a whole team. For your system as a
solo developer, it means having answers to these questions:

```
1. How do you know the system is working right now?
   → Monitoring and alerting (Section 7)

2. How do you know when something breaks?
   → Alerting that pages you before students notice

3. How quickly can you fix something when it breaks?
   → Runbooks that tell you exactly what to do at 8am half-asleep

4. How do you prevent the same thing from breaking twice?
   → Post-mortems after every incident

5. How much downtime is acceptable?
   → Error budget and SLOs
```

### SLOs — Service Level Objectives

An SLO is a target for your system's reliability. It's a promise to yourself.

```
For college bus management system:

SLO 1: Availability
  Target: 99.5% uptime during morning window (7am–9:30am, Mon–Fri)
  Meaning: max 45 seconds of downtime per morning
  Measurement: UptimeRobot checks /v1/health every 60 seconds

SLO 2: Check-in latency
  Target: 95% of check-ins complete in < 500ms end-to-end
  Measurement: durationMs in checkin_attempt structured log
  Alert: if p95 exceeds 500ms for 2 consecutive minutes

SLO 3: Check-in success rate
  Target: > 95% of check-in attempts succeed (excluding intentional rejections)
  Intentional rejections: wrong bus, too far, already checked in
  Real failures: DB errors, Redis errors, crashes
  Alert: if success rate drops below 95% for 1 minute

SLO 4: Background jobs
  Target: 100% of nightly jobs complete successfully
  Measurement: job_complete log event
  Alert: any job_failed event triggers immediate alert

SLO 5: GPS coverage
  Target: < 5% of active buses are GPS-OFFLINE at any time during morning
  Alert: if gpsOffline counter in dashboard:stats exceeds 10 buses
```

### Error budget

```
SLO: 99.5% uptime
Error budget: 0.5% = 45 seconds per morning

If you've used 30 seconds of your error budget this week:
  → Be conservative. Delay risky deploys.
  → No experimental changes during morning window.

If error budget is fresh:
  → Safe to try new approaches
  → More room for controlled experiments
```

---

## 7. Monitoring and Alerting

### Alert types and what to do

**Tier 1 — Wake you up at 8am (PagerDuty / SMS)**
```
These require immediate action:
  - /v1/health returns 503
  - check_success_rate < 85% for 2 minutes
  - Database connection failed
  - create-daily-trips job failed (students can't check in)
  - mark-absent job failed (attendance data corrupt)
```

**Tier 2 — Email/Slack (respond within 1 hour)**
```
These are serious but not immediately breaking:
  - check_p95_latency > 500ms for 5 minutes
  - GPS offline buses > 10
  - Redis memory > 80%
  - Any job failed (non-critical jobs)
  - Sentry new error (first occurrence of a new error type)
```

**Tier 3 — Daily review**
```
  - GPS cleanup deleted 0 rows (might mean cleanup job isn't running)
  - Check-in success rate between 90-95%
  - Redis key count growing unexpectedly
  - Cloud Run instance count at max (approaching scaling limit)
```

### GCP Cloud Monitoring alert setup

```yaml
# Create these alerts in GCP Console → Monitoring → Alerting

Alert 1: Health check failure
  Condition: HTTP check on /v1/health returns non-200
  Duration: 2 consecutive failures (2 minutes)
  Notification: SMS + email

Alert 2: High check-in latency
  Condition: log-based metric "checkin_duration_ms" p95 > 500
  Duration: 2 minutes
  Notification: email

Alert 3: Job failure
  Condition: log contains event: "job_failed"
  Duration: immediately (0 minutes)
  Notification: SMS + email

Alert 4: GPS mass offline
  Condition: metric "gps_offline_count" > 10
  Duration: 5 minutes
  Notification: email
```

### UptimeRobot setup (free)

```
Go to: uptimerobot.com
Create monitor:
  Type: HTTP(s)
  URL: https://bus-backend-xxx.run.app/v1/health
  Check interval: every 60 seconds
  Alert contacts: your phone number + email

This gives you 60-second resolution on downtime.
If the system goes down, you know within 60 seconds.
```

### Dashboard to watch every morning

Build this in GCP Cloud Monitoring or watch directly from the admin panel:

```
Morning dashboard metrics:
  Active trips (should match number of buses running)
  Students checked in (growing through 7am–9am)
  GPS offline count (should be near 0)
  Open incidents (should be 0)
  Check-in p95 latency (should be < 200ms)
  Error rate (should be < 1%)
```

---

## 8. Incident Response

### What happens when something breaks at 8am

**Step 1: Detect (should be automatic — alerts fire)**
```
UptimeRobot texts you: "Your monitor bus-backend is DOWN"
OR
Sentry emails you: "New error: Cannot read property of undefined"
OR
Transport office calls: "Students can't check in"
```

**Step 2: Assess (< 2 minutes)**
```bash
# What's broken?
curl https://bus-backend-xxx.run.app/v1/health

# Check recent logs (last 5 minutes)
gcloud logging read \
  'resource.type="cloud_run_revision" severity>=ERROR' \
  --limit=50 \
  --freshness=5m \
  --project=YOUR_PROJECT_ID

# Check Cloud Run status
gcloud run services describe bus-backend --region asia-south1

# Is it a recent deploy?
gcloud run revisions list --service bus-backend --region asia-south1
```

**Step 3: Mitigate first, debug later**
```
If the last deploy caused it:
  IMMEDIATELY roll back:
  gcloud run services update-traffic bus-backend \
    --to-revisions=PREVIOUS=100 \
    --region asia-south1
  Takes 30-60 seconds. System recovers.
  Now you have time to debug without students waiting.

If Redis is down:
  Students might be getting rate limit errors on check-in
  Redis degradation is designed — check-in falls back to PostgreSQL
  But rate limiting is disabled — watch for check-in spam

If PostgreSQL is down:
  Everything stops. This is the worst case.
  Check Cloud SQL health in GCP Console
  Alert your college IT team if it's infrastructure
  Paper fallback: instruct coordinators to mark attendance manually
```

**Step 4: Communicate**
```
Text the transport officer:
  "Check-in system has an issue. Investigating.
   Please use paper attendance for now.
   Will update in 10 minutes."

This is critical. If they know you're working on it,
they won't panic and start calling you repeatedly.
```

**Step 5: Fix and verify**
```
After rollback or fix:
  1. Verify health endpoint returns 200
  2. Test check-in manually (use your test student account)
  3. Watch check-in success rate return to >95%
  4. Text transport officer: "System restored. Check-in working."
```

**Step 6: Post-mortem (within 24 hours)**
```
Write down:
  What happened?
  When did it start?
  When did we detect it?
  What was the impact (how many students affected)?
  What caused it?
  How did we fix it?
  How do we prevent it next time?

Store this in docs/post-mortems/ in the repo.
```

### Rollback commands (memorize these)

```bash
# Instant rollback to previous version
gcloud run services update-traffic bus-backend \
  --to-revisions=PREVIOUS=100 \
  --region asia-south1

# List recent revisions (to pick specific one)
gcloud run revisions list --service bus-backend --region asia-south1

# Roll back to a specific revision
gcloud run services update-traffic bus-backend \
  --to-revisions=bus-backend-00042-xyz=100 \
  --region asia-south1

# Verify it worked
curl https://bus-backend-xxx.run.app/v1/health
```

---

## 9. Database Migrations Without Downtime

### The danger of migrations in production

A wrong migration can lock your PostgreSQL table for seconds or minutes.
During that time, every check-in returns an error.
Here's how to do migrations safely.

### Safe migration patterns

**Adding a nullable column — SAFE**
```sql
-- PostgreSQL adds this instantly, no lock
ALTER TABLE attendance_logs ADD COLUMN arrival_verified BOOLEAN;
```

**Adding a NOT NULL column with default — SAFE (PostgreSQL 11+)**
```sql
-- PostgreSQL stores the default in catalog, doesn't rewrite table
ALTER TABLE attendance_logs ADD COLUMN arrival_verified BOOLEAN NOT NULL DEFAULT false;
```

**Adding a NOT NULL column without default — DANGEROUS**
```sql
-- NEVER do this in production:
ALTER TABLE attendance_logs ADD COLUMN arrival_verified BOOLEAN NOT NULL;
-- This locks the table while it validates every existing row
```

**Adding an index — SAFE with CONCURRENTLY**
```sql
-- Normal index: locks table (dangerous)
CREATE INDEX idx_attendance_user_date ON attendance_logs(user_id, date);

-- Concurrent index: no lock (takes longer but safe)
CREATE INDEX CONCURRENTLY idx_attendance_user_date ON attendance_logs(user_id, date);
```

**In Prisma migrations — how to write safe SQL**
```typescript
// prisma/migrations/20240315_add_arrival_verified/migration.sql

-- Add column safely (nullable first)
ALTER TABLE "attendance_logs" ADD COLUMN "arrival_verified" BOOLEAN;
ALTER TABLE "attendance_logs" ADD COLUMN "arrival_verified_at" TIMESTAMP(3);

-- Add index concurrently (safe for production)
CREATE INDEX CONCURRENTLY "idx_attendance_logs_arrival"
  ON "attendance_logs"("trip_id", "arrival_verified");
```

### The expand-contract pattern

For risky schema changes, use three phases:

```
Phase 1 (Expand): Add new column, keep old column
  - Deploy code that writes to BOTH old and new columns
  - Backfill new column from old data

Phase 2 (Migrate): Stop writing to old column
  - Deploy code that reads from new column, writes only to new column
  - Verify everything is correct

Phase 3 (Contract): Remove old column
  - Deploy migration to drop old column
  - Old column is now gone

This way, you can always roll back Phase 1 or Phase 2.
Never stuck with broken data.
```

---

## 10. Feature Flags

### What are feature flags

Feature flags let you deploy code to production but keep a feature hidden
until you're ready to turn it on. This separates deployment from release.

```
Without feature flags:
  Code is deployed → feature is immediately live → 6000 students see it
  If it's broken → you must redeploy to fix (takes 5-10 minutes)

With feature flags:
  Code is deployed with flag OFF → feature is invisible
  Turn flag ON for 10 test students → verify it works
  Turn flag ON for 100 students → monitor
  Turn flag ON for everyone → done
  If broken → turn flag OFF (instant, no redeploy)
```

### Simple feature flag implementation for your system

```typescript
// packages/shared/src/constants/flags.ts

export const FEATURE_FLAGS = {
  WAIT_FOR_ME_ENABLED:        'flag:wait-for-me',
  ARRIVAL_VERIFY_ENABLED:     'flag:arrival-verify',
  OFFLINE_QUEUE_ENABLED:      'flag:offline-queue',
  GPS_INTERPOLATION_ENABLED:  'flag:gps-interpolation',
} as const

// lib/flags.ts — check flag state from Redis
export const isFeatureEnabled = async (flag: string): Promise<boolean> => {
  const value = await redis.get(flag)
  return value === 'true'
}

// Enable a flag (run in GCP Cloud Shell or local with prod Redis)
// redis.set('flag:wait-for-me', 'true')

// Disable a flag instantly
// redis.set('flag:wait-for-me', 'false')
```

**Using in code:**
```typescript
// attendance.service.ts
import { isFeatureEnabled, FEATURE_FLAGS } from '../../lib/flags'

// Inside check-in handler:
const waitForMeEnabled = await isFeatureEnabled(FEATURE_FLAGS.WAIT_FOR_ME_ENABLED)
if (waitForMeEnabled) {
  // new wait-for-me logic
}
```

**Enabling flags:**
```bash
# Via GCP Cloud Shell (direct Redis access)
redis-cli -u $REDIS_URL SET flag:wait-for-me true

# Or via a protected admin endpoint:
POST /v1/admin/flags
body: { flag: 'wait-for-me', enabled: true }
auth: TRANSPORT_OFFICER role only
```

---

## 11. Environment Strategy

### Three environments

```
local (your laptop)
  → docker-compose Postgres + Redis
  → Firebase emulator (or real Firebase in dev mode)
  → No real students
  → Seed data only

staging (GCP — separate project or same project, separate services)
  → bus-backend-staging Cloud Run service
  → bus-admin-staging Cloud Run service  
  → Staging Cloud SQL database (separate from prod)
  → Staging Upstash Redis
  → Firebase test project
  → Where you test before production
  → Auto-deploys from develop branch

production (GCP — what students use)
  → bus-backend Cloud Run service
  → bus-admin Cloud Run service
  → Production Cloud SQL database
  → Production Upstash Redis
  → Real Firebase project
  → Auto-deploys from main branch (with time guard)
  → The one that matters
```

### Environment variables per environment

```
Never share secrets between environments.
Staging has its own DATABASE_URL, its own JWT_SECRET.
If staging is compromised, production is safe.

GCP Secret Manager:
  DATABASE_URL           → production DB
  DATABASE_URL_STAGING   → staging DB
  JWT_SECRET             → production JWT secret
  JWT_SECRET_STAGING     → staging JWT secret
  (etc.)

GitHub Secrets:
  GCP_SA_KEY            → same service account (has access to both)
  GCP_PROJECT_ID        → same project (or different if you separate them)
```

---

## 12. Runbooks

### What is a runbook

A runbook is a step-by-step guide for handling a specific situation.
Written when you're calm so you can follow it when you're panicking at 8am.

### Runbook template

**File: `docs/runbooks/checkin-failures.md`**

```markdown
# Runbook: Check-in Failures

## Symptoms
- Students reporting "check-in failed" errors
- Sentry showing checkin_attempt with result: FAIL at high rate
- check_success_rate < 90%

## Step 1: Identify which check is failing
Search logs:
  gcloud logging read 'jsonPayload.event="checkin_attempt" jsonPayload.result="FAIL"' --limit=20

Look at failReason field:
  QR_EXPIRED         → QR TTL too short or clock skew
  QR_ALREADY_USED    → Double-scan (usually fine)
  TRIP_NOT_ACTIVE    → Trip not started or already ended
  ROUTE_MISMATCH     → Student on wrong bus
  TOO_FAR            → Geofence rejection (expected if students far from bus)
  ALREADY_CHECKED_IN → Idempotency (fine)
  DB_ERROR           → Database problem (serious)
  REDIS_ERROR        → Redis problem (serious)

## Step 2: DB_ERROR path
  Check Cloud SQL health: GCP Console → SQL → bus-mgmt-db → Overview
  Check connection count: should be < 50
  If connection count is maxed: Cloud Run has too many instances open
    → gcloud run services update bus-backend --max-instances=5 --region=asia-south1

## Step 3: QR_EXPIRED at high rate
  Check system time on Cloud Run instances
  Check REDIS_QR_TTL_SECONDS in constants — should be 120
  If students are far from bus stops, geofence check passes but QR scan is slow

## Step 4: If nothing obvious — rollback
  gcloud run services update-traffic bus-backend \
    --to-revisions=PREVIOUS=100 --region=asia-south1
```

### Runbooks to write

```
docs/runbooks/
  checkin-failures.md
  gps-offline.md
  database-connection-exhausted.md
  redis-restart-recovery.md
  daily-trips-job-failed.md
  mark-absent-job-failed.md
  cloud-run-instance-crash.md
  morning-complete-outage.md
```

---

## Summary — The Daily Reality

```
As a solo developer running a production system used by 6,000 students:

You are:
  The developer (writing features)
  The DevOps engineer (managing infrastructure)
  The SRE (maintaining reliability)
  The on-call engineer (responding at 8am when things break)

The good news:
  At 70 req/sec, this system is simple
  Cloud Run and Cloud SQL do 90% of the ops work for you
  Good CI/CD means deploys are safe and automatic
  Good monitoring means you know before students do

The key habits:
  Never deploy during morning window (6:30am–10am)
  Always deploy to staging first
  Watch logs for 30 min after every production deploy
  Keep PRs small — one thing at a time
  Write runbooks when things break (not before — write after the incident)
  Post-mortem every outage — even a 2-minute one

The tools:
  GitHub → code + CI/CD
  GCP Cloud Run → hosting + rolling deploys
  GCP Cloud Monitoring → metrics + alerts
  Sentry → error tracking
  UptimeRobot → uptime monitoring
  GCP Cloud Logging → log search during incidents
```
