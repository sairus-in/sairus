# Git Workflow

## Branch Structure

```
main                    ← production. what's live on Cloud Run.
  └── develop           ← integration branch. staging environment.
        ├── feature/qr-per-scan-fix
        ├── feature/add-wait-for-me
        ├── fix/attendance-timezone-bug
        └── fix/redis-startup-race
```

## Rules

- `main` = what's deployed. **Never commit directly to main.**
- `develop` = what's tested and ready. Deployed to staging automatically.
- Feature branches = where you work. Short-lived. Never more than 2–3 days.
- Hotfix branches = emergency fixes that go directly to main.

## Branch Naming Convention

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

## Commit Message Convention (Conventional Commits)

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

## Full Change Lifecycle

```bash
# 1. Create feature branch
git checkout develop
git pull origin develop
git checkout -b fix/qr-nonce-race-condition

# 2. Make changes in small, logical commits

# 3. Self-review
git diff develop..HEAD

# 4. Push and create PR
git push origin fix/qr-nonce-race-condition
# Open PR: feature branch → develop

# 5. Merge to develop (after CI passes)
# Staging deploys automatically

# 6. Promote to main
# Open PR: develop → main
# Production deploys automatically (during safe window)
```

## Checklist Before Merging to Main

- [ ] All CI checks green (tests, lint, typecheck)
- [ ] Tested on staging environment
- [ ] No migration pending that hasn't been reviewed
- [ ] Not during morning window (6:30am–10am IST)
- [ ] Sentry has no new open errors from staging deploy
- [ ] If touching attendance/QR logic: manually tested the check-in flow
- [ ] If touching background jobs: manually triggered the job on staging
