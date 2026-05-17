# Policy Parity Baselines

Baseline JSON files are captured locally and gitignored. They are not committed — they are artifacts of your local environment.

## Capture a baseline

Ensure the backend is running locally and seed has been applied:

```bash
pnpm tsx apps/backend/scripts/policy-parity/seed.ts
pnpm tsx apps/backend/scripts/policy-parity/parity.ts capture --label <label>
```

Labels follow the convention: `NN-description` e.g. `00-pre-c6`, `01-post-c6a-users`.

## Diff against a baseline

Against live backend:

```bash
pnpm tsx apps/backend/scripts/policy-parity/parity.ts diff --against <label>
```

Against another baseline file (for determinism checks):

```bash
pnpm tsx apps/backend/scripts/policy-parity/parity.ts diff --against <baseline> --current <current>
```

Exit code 0 = clean. Exit code 1 = regressions found (printed to stdout).

## Baseline lifecycle

| Commit | Label | Expected diff vs previous |
|--------|-------|--------------------------|
| pre-C6 | 00-pre-c6 | — (initial) |
| C6 users.routes | 01-post-c6-users | field removals for mobile_student on /v1/users |
| C6 student routes | 02-post-c6-student | field removals for mobile_student on attendance routes |
| C6 driver routes | 03-post-c6-driver | field removals for mobile_driver on trip routes |

Add a row here when capturing each new baseline. Verify the actual diff matches the expected diff before treating a baseline as trusted.

## Determinism check

Before capturing a real baseline, verify the script is deterministic:

```bash
pnpm tsx apps/backend/scripts/policy-parity/seed.ts
pnpm tsx apps/backend/scripts/policy-parity/parity.ts capture --label determinism-run1
pnpm tsx apps/backend/scripts/policy-parity/parity.ts capture --label determinism-run2
pnpm tsx apps/backend/scripts/policy-parity/parity.ts diff --against determinism-run1 --current determinism-run2
# must be empty
```

If empty, delete the determinism baselines (`rm baselines/determinism-*.json`) and capture your real baseline.

## What gets compared

- **Status codes**: HTTP response status (200, 401, 403, etc.)
- **Response bodies**: Full JSON body is stored and compared

Timestamp fields (`createdAt`, `updatedAt`, `startedAt`, etc.) are normalized to `__TIMESTAMP__` before comparison to avoid false positives from time-varying data.