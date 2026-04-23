# Production Readiness Checklist

## Contracts

- Keep [API_CONTRACT_MATRIX.md](/c:/Users/krist/Desktop/college-bus-system/docs/API_CONTRACT_MATRIX.md) updated in the same PR as any API change.
- Keep [SOCKET_EVENT_REGISTRY.md](/c:/Users/krist/Desktop/college-bus-system/docs/SOCKET_EVENT_REGISTRY.md) updated in the same PR as any websocket change.
- Reject undocumented route or event changes during review.

## Security

- Enforce real Firebase auth in production. No mock mobile tokens outside non-production environments.
- Set strong production secrets:
  - `JWT_SECRET` length >= 32
  - `ADMIN_MFA_ENCRYPTION_KEY` length >= 32
  - `CLOUD_TASKS_SECRET` length >= 16
- Configure `CORS_ALLOWED_ORIGINS` explicitly for production.
- Configure `ADMIN_COOKIE_DOMAIN` for the deployed admin domain if cross-subdomain cookies are required.
- Require MFA enrollment for privileged admin roles before production launch (**CRITICAL: You must revert the MFA bypass around line 58 in `apps/backend/src/modules/auth/admin-auth.middleware.ts` before launch!**)
- Add CSRF protection for cookie-authenticated admin write actions before public launch.
- Review admin role scopes end-to-end on the backend, not just the UI capability layer.

## Runtime

- Deploy a staging environment with the same core services as production:
  - Postgres
  - Redis
  - Firebase
  - Cloud Tasks
  - Websockets
- Validate environment variables at boot and fail startup on invalid production config.
- Use graceful shutdown on deploys so Fastify, Redis, Prisma, workers, and sockets close cleanly.
- Keep readiness checks wired to both Redis and Postgres.

## Data and Migrations

- Use Prisma migrations for all schema changes. Avoid `db push` in production.
- Test forward migration and rollback procedures in staging.
- Seed only non-production environments.
- Define retention policies for GPS, notifications, attendance logs, and audit logs.

## Observability

- Emit structured logs with request ids through API, job, and websocket paths.
- Add dashboards and alerts for:
  - auth failures
  - check-in failures
  - job failures
  - Redis errors
  - websocket auth rejects
  - GPS outage counts
- Track p95/p99 latency for login, check-in, trip start, trip end, and admin dashboard reads.

## Testing

- Keep `pnpm turbo type-check`, `pnpm turbo test -- --run`, `pnpm --filter admin build`, and `pnpm --filter backend build` green on every merge.
- Add E2E coverage for the flows in [E2E_CRITICAL_PATHS.md](/c:/Users/krist/Desktop/college-bus-system/docs/E2E_CRITICAL_PATHS.md).
- Add authorization tests for every admin write endpoint.
- Add contract tests that assert frontend-known endpoints and socket events still exist.

## Delivery

- Run smoke tests after each deploy:
  - admin login
  - mobile login
  - active trip load
  - QR refresh
  - check-in
  - trip end
- Keep rollback steps documented and tested.
- Do not ship feature work that changes contracts without staging verification.
