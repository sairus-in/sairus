# Repository Bootstrap

**Reviewed:** 2026-04-23

This is the GitHub setup needed to move this codebase into its long-term repo and preserve the workflow already documented in [`docs/GIT_WORKFLOW.md`](./GIT_WORKFLOW.md).

## Current state

- local git history exists, but this checkout has **no configured remotes**
- on 2026-04-23, `git ls-remote https://github.com/sairus-in/sairus.git` returned `Repository not found`
- that means the codebase can be prepared locally, but the migration to `sairus-in/sairus` is not complete until the repo exists and the current credentials can access it

## Branch model

Use the existing documented model:

- `main`: production
- `develop`: staging / integration
- short-lived branches from `develop`: `feature/*`, `fix/*`, `infra/*`, `db/*`
- emergency production branches from `main`: `hotfix/*`

## GitHub settings to apply

1. Set the default branch to `main`.
2. Create `develop` immediately after the first push.
3. Protect `main`:
   - block direct pushes
   - require pull request reviews
   - require status checks before merge
   - require branch to be up to date before merge
4. Protect `develop`:
   - block direct pushes unless the team intentionally wants maintainer bypass
   - require CI checks before merge
5. Create GitHub environments:
   - `staging`
   - `production`
6. Require manual approval on the `production` environment.

## Required status checks

Match the workflow job names exactly:

- `TypeScript`
- `ESLint`
- `Tests`
- `Security audit`
- `Architecture Laws`

## First push sequence

```bash
git checkout -b main
git remote add origin https://github.com/sairus-in/sairus.git
git push -u origin main
git checkout -b develop
git push -u origin develop
```

After that, do normal feature work from `develop`.

## Repo-level configuration still needed

- GitHub Actions secrets for deploy/auth
- Cloud Run services and jobs
- GCP Secret Manager entries for backend runtime secrets
- branch protection rules
- environment approvals
- Expo/EAS project linkage for mobile

## What is now in-repo

The repo itself now contains the missing pieces needed for a cleaner migration:

- backend env template aligned to actual runtime validation
- admin env template
- secret-management documentation
- explicit bootstrap guidance for branch protection and environments

What is still external by nature:

- the actual GitHub repo
- cloud credentials
- secret values
- Expo account/project ownership
