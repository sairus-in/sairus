# Admin Auth Alignment Status

Last updated: 2026-04-13

## Scope of this status

This document describes alignment between:

- the maintained admin-auth implementation path in the codebase
- the original long-form admin auth specification
- the implementation roadmap

It is intentionally practical. It reflects what is actually wired into the active backend and admin app today.

## Maintained implementation path

Active backend path:

- `apps/backend/src/modules/auth/admin-auth.routes.ts`
- `apps/backend/src/modules/auth/admin-auth.service.ts`
- `apps/backend/src/modules/auth/admin-auth.middleware.ts`
- `apps/backend/src/modules/auth/admin-auth.repository.ts`
- `apps/backend/src/modules/auth/admin-fingerprint.service.ts`
- `apps/backend/src/modules/auth/admin-anomaly.service.ts`

Active admin frontend path:

- `apps/admin/src/pages/auth/Login.tsx`
- `apps/admin/src/pages/auth/ForgotPassword.tsx`
- `apps/admin/src/pages/auth/ResetPassword.tsx`
- `apps/admin/src/pages/auth/AcceptInvite.tsx`
- `apps/admin/src/pages/auth/Security.tsx`
- `apps/admin/src/pages/auth/AdminUsers.tsx`
- `apps/admin/src/components/auth/AdminStepUpModal.tsx`
- `apps/admin/src/lib/api.client.ts`

Excluded legacy reference path:

- `apps/backend/src/modules/auth/admin-auth-routes.ts`
- `apps/backend/src/modules/auth/admin-auth-service-v2.ts`
- `apps/backend/src/lib/admin-rate-limiter.ts`
- `apps/backend/src/lib/admin-audit-logger.ts`
- `apps/backend/src/lib/redis-client.ts`

Those files are not the maintained path and should not be treated as the source of truth.

## Aligned and implemented now

### Phase 2 capabilities active on maintained path

- Cookie-based admin login with JWT session validation
- MFA challenge flow
- backup-code login and regeneration
- trusted-device tracking and revocation
- step-up authentication for sensitive actions
- invite acceptance
- forgot-password and reset-password flows
- admin create, update, deactivate, reactivate

### Phase 3 capabilities active on maintained path

- multi-signal browser fingerprint capture from the admin frontend
- fingerprint baseline persistence in `AdminFingerprint`
- fingerprint drift evaluation on authenticated requests
- adaptive response:
  - low risk: allow
  - medium risk: force re-login
  - high risk: revoke all admin sessions
- anomaly scoring backed by Redis and persisted behavior events
- authenticated admin API burst detection
- failed step-up anomaly escalation
- unusual-hour anomaly scoring
- authenticated admin API rate limiting
- RBAC enforcement through `adminRoute(...)`, `getAdminAccessContext(...)`, and `assertAdminAction(...)`

### Phase 4 capabilities active on maintained path

- admin invitation flow with step-up protection
- explicit admin suspension and unsuspension with reason capture
- suspended-account login blocking with `ACCOUNT_SUSPENDED`
- TOTP setup, enable, disable, and validation
- backup-code generation, regeneration, and single-use consumption
- forgot-password, reset-password, invite-token verification, and set-password flows
- admin lifecycle state exposed in the admin management UI

## Important deviations from the original long-form spec

These are not hidden bugs. They are differences between the broad target design and the maintained implementation that exists now.

### Not fully implemented on the maintained path yet

- Refresh-token family rotation is not active on the maintained admin path.
- Absolute 24-hour server-enforced admin session lifetime is not active on the maintained admin path.
- GeoIP / ASN are currently derived from trusted proxy headers when available, not from a local MaxMind-style server lookup.
- Audit logging uses the existing shared `AuthAuditEventType` enum and metadata enrichment, not the larger expanded event taxonomy described in the spec.
- Immutable external audit streaming and Redis-A / Redis-B infrastructure separation are design targets, not fully enforced in local maintained code.

### Why this matters

The backend Phase 3 security work that was implemented is valid and active.
But the original spec is still a broader end-state document, not a perfect one-to-one reflection of the active codebase.

## What the added tests protect

- `admin-auth.service.test.ts`
  Validates core auth service behavior such as MFA backup-code login, geo-policy blocking, and step-up token creation.

- `admin-auth.middleware.test.ts`
  Validates request-path enforcement such as JWT/session validation, CSRF checks, authenticated rate limiting, forced re-login, and step-up header handling.

- `admin-fingerprint.service.test.ts`
  Validates that fingerprint baselines are stored correctly and that drift/mismatch scoring behaves as intended.

- `admin-anomaly.service.test.ts`
  Validates anomaly score transitions, reauth marking, session revocation on high-risk signals, and failed step-up escalation.

- `admin-security.test.ts`
  Validates trusted-device hash normalization and geo-velocity policy behavior.

- `admin-mfa.test.ts`
  Validates MFA helper correctness such as secret encryption/decryption and TOTP challenge behavior.

## Phase 5 frontend validation status

### Implemented now

- The admin frontend test harness is active through `apps/admin/vite.config.ts` and `apps/admin/src/test/setup.ts`.
- The React workspace graph was deduplicated so the admin frontend now resolves a single hoisted `react` and `react-dom` tree from the workspace root.
- `apps/admin/node_modules` was removed from the maintained install path and the workspace was reinstalled cleanly under the hoisted pnpm layout.
- Frontend auth flow tests now cover:
  - `Login.test.tsx`
  - `ForgotPassword.test.tsx`
  - `ResetPassword.test.tsx`
  - `AcceptInvite.test.tsx`
  - `AdminStepUpModal.test.tsx`
  - `smoke.test.tsx`

### Verification snapshot

- `pnpm --filter admin type-check` passes
- `pnpm --filter admin exec vitest run` passes
- `pnpm --filter admin build` passes

### What this closes

- The previous Vitest invalid-hook-call / `Proxy.useState` failures were caused by duplicate React resolution in the monorepo test environment, not by the admin auth components themselves.
- That frontend Phase 5 blocker is now resolved on the maintained path.

## Recommended next focus: remaining Phase 5 validation

Frontend auth test infrastructure is now in place and green. The remaining high-value validation work is:

- manual end-to-end verification of login, MFA, backup-code login, invite acceptance, reset password, and step-up flows in a running app
- broader frontend auth UX polish for forced-reauth, suspended-account, and security-state messaging
- backend and environment-level security validation that is still outside the current frontend unit test scope:
  - refresh-family rotation and token-reuse flows if that path is revived on the maintained implementation
  - load/rate-limit validation
  - staging penetration-style checks
