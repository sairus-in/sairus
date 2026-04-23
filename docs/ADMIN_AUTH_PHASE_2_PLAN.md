# Admin Auth Phase 2 Plan

## Status Summary

- Overall Phase 2 completion: `45-50%`
- Backend implementation completion: `65-70%`
- Frontend and integration completion: `15-25%`

## Phase 2 Scope

- Password reset plus token verification flow
- MFA setup and management
- Admin user CRUD with step-up protection
- Geo-velocity checks
- Device whitelist and trusted-device management
- Integration and regression test coverage
- Production hardening on the active admin-auth path

## What Is Already Completed

- Added trusted-device persistence to Prisma schema in [apps/backend/src/db/prisma/schema.prisma](/c:/Users/krist/Desktop/college-bus-system/apps/backend/src/db/prisma/schema.prisma)
- Added trusted-device migration in [apps/backend/src/db/prisma/migrations/20260407093000_add_admin_trusted_devices/migration.sql](/c:/Users/krist/Desktop/college-bus-system/apps/backend/src/db/prisma/migrations/20260407093000_add_admin_trusted_devices/migration.sql)
- Added device-hash and geo-velocity helper logic in [apps/backend/src/lib/admin-security.ts](/c:/Users/krist/Desktop/college-bus-system/apps/backend/src/lib/admin-security.ts)
- Extended admin auth repository for trusted devices, admin listing, admin updates, and login lookup in [apps/backend/src/modules/auth/admin-auth.repository.ts](/c:/Users/krist/Desktop/college-bus-system/apps/backend/src/modules/auth/admin-auth.repository.ts)
- Extended active admin auth service for trusted-device registration, geo checks, and step-up tokens in [apps/backend/src/modules/auth/admin-auth.service.ts](/c:/Users/krist/Desktop/college-bus-system/apps/backend/src/modules/auth/admin-auth.service.ts)
- Added step-up middleware in [apps/backend/src/modules/auth/admin-auth.middleware.ts](/c:/Users/krist/Desktop/college-bus-system/apps/backend/src/modules/auth/admin-auth.middleware.ts)
- Extended active auth routes in [apps/backend/src/modules/auth/admin-auth.routes.ts](/c:/Users/krist/Desktop/college-bus-system/apps/backend/src/modules/auth/admin-auth.routes.ts)
- Added admin-user CRUD routes in [apps/backend/src/modules/admin/admin.routes.ts](/c:/Users/krist/Desktop/college-bus-system/apps/backend/src/modules/admin/admin.routes.ts)
- Added shared `STEP_UP_REQUIRED` error code in [packages/shared/src/lib/error-codes.ts](/c:/Users/krist/Desktop/college-bus-system/packages/shared/src/lib/error-codes.ts)
- Added targeted tests in [apps/backend/src/lib/admin-security.test.ts](/c:/Users/krist/Desktop/college-bus-system/apps/backend/src/lib/admin-security.test.ts) and [apps/backend/src/modules/auth/admin-auth.middleware.test.ts](/c:/Users/krist/Desktop/college-bus-system/apps/backend/src/modules/auth/admin-auth.middleware.test.ts)

## What Is Partially Completed

- Password reset exists, but frontend verification and recovery UX are not wired
- MFA setup, enable, and disable exist, but backup-code lifecycle is not built
- Geo-velocity exists as a country-change heuristic, not full GeoIP speed analysis
- Device whitelist exists in backend, but no frontend device-management page exists yet
- Admin CRUD exists in backend, but no frontend admin-management flow exists yet

## What Is Still Left

- Apply the new Prisma migration to the target database
- Regenerate Prisma client in every environment that uses the backend
- Build frontend step-up flow and send `x-admin-step-up` on gated actions
- Build frontend admin-user management screens
- Build frontend trusted-device listing and revoke flow
- Add MFA backup codes and recovery flow
- Add integration tests for Phase 2 auth flows
- Add optional reactivation endpoint for disabled admins
- Replace header-based country detection with real GeoIP enrichment if required
- Resolve or isolate legacy broken files so full backend `tsc --noEmit` passes

## Workstream Status

| Workstream | Status | Completion |
| --- | --- | --- |
| Password reset | Partial | 70% |
| MFA management | Partial | 55% |
| Step-up auth | Strong backend | 80% |
| Admin user CRUD | Strong backend | 75% |
| Trusted devices | Strong backend | 75% |
| Geo-velocity | Basic backend | 55% |
| Frontend integration | Early | 20% |
| Integration testing | Early | 25% |
| Production hardening | Partial | 30% |

## Execution Plan

### 1. Stabilize Active Backend Path

- Confirm the active implementation is the `admin-auth.routes.ts` and `admin-auth.service.ts` path
- Treat legacy `admin-auth-routes.ts` and `admin-auth-service-v2.ts` as non-authoritative until cleaned up
- Apply the trusted-device migration and verify Prisma reads and writes

### 2. Finish Password Reset and Invite Flows

- Keep `/forgot-password` and `/reset-password` as the source of truth
- Use the added token-verification endpoints to validate reset and invite tokens before final submission
- Build frontend states for expired token, invalid token, and success cases
- Add integration coverage for reset and invite acceptance flows

### 3. Complete MFA Phase 2

- Add backup-code generation on MFA enable
- Store backup codes hashed and single-use
- Add endpoint to regenerate backup codes
- Add recovery path using backup code when TOTP is unavailable
- Add frontend recovery UI

### 4. Finish Step-Up Enforcement

- Use `/v1/admin/auth/step-up` for high-risk actions
- Require `x-admin-step-up` for create, edit, delete, invite, and device revoke flows
- Extend step-up protection to any remaining sensitive security routes
- Add integration tests for valid, missing, expired, and reused step-up tokens

### 5. Finish Admin User Management

- Use the new backend routes for list, create, edit, and deactivate
- Add optional reactivate endpoint if soft-delete recovery is needed
- Build frontend admin-management table and forms
- Add audit verification for create, update, deactivate, and reactivate actions

### 6. Finish Trusted Device Management

- Use current backend device registration and listing logic
- Build frontend list and revoke actions
- Decide whether revoking a device should also revoke all active sessions for that admin
- Add integration coverage for device revoke behavior

### 7. Upgrade Geo-Velocity Logic

- Replace country-header heuristic with a real GeoIP source if production requires stronger checks
- Compute stronger risk based on distance and elapsed time
- Add review-only versus block thresholds
- Log geo anomalies consistently into audit events

### 8. Testing and Validation

- Add backend integration tests for:
- Login plus MFA plus trusted-device registration
- Step-up gated admin CRUD
- Password reset verify plus reset
- Invite verify plus set-password
- Trusted-device revoke
- Geo-velocity block and review cases

### 9. Production Hardening

- Fix or isolate legacy broken auth files so full type-check passes
- Document new routes, headers, and migration steps
- Validate required environment variables in staging
- Verify audit events for all Phase 2 sensitive paths

## Recommended Next Order

1. Apply migration and regenerate Prisma client
2. Wire frontend step-up flow
3. Build admin-user management UI
4. Build trusted-device management UI
5. Add MFA backup-code flow
6. Add integration tests
7. Clean legacy auth/type-check debt

## Key Risks

- The repo still contains legacy admin-auth files that break full type-check and can confuse future work
- Geo-velocity is currently heuristic and should not be treated as final fraud detection
- Step-up is implemented in backend, but it is not useful until the frontend sends the header
- Trusted-device revocation policy is not fully defined for active session invalidation

## Definition of Done

- Migration applied successfully in target environments
- Phase 2 backend endpoints verified through integration tests
- Frontend can perform step-up, admin CRUD, password reset, MFA management, and device revoke flows
- Backup-code MFA recovery is implemented
- Geo-velocity checks use a production-appropriate data source
- Full backend type-check passes or legacy auth code is formally isolated
