## Description
<!-- Describe the change -->

## Type of Change
- [ ] Bug fix (fix/*)
- [ ] New feature (feature/*)
- [ ] Infrastructure change (infra/*)
- [ ] Database migration (db/*)
- [ ] Hotfix

## Testing
<!-- How was this tested? -->
- [ ] Tested locally
- [ ] Tested on staging
- [ ] Tested on real Android device
- [ ] Unit tests added/updated

## Architecture Checklist (MANDATORY)

> Every item below must be verified before merging. If an item doesn't apply,
> mark it and write "N/A — [reason]". Do not leave items unchecked.

### Service Layer
- [ ] No `api.get` / `api.post` / `api.patch` / `api.delete` calls in screen files (`app/`)
- [ ] All API calls are in `services/*.service.ts`
- [ ] Hooks in `hooks/` consume services — not raw API calls

### State Management
- [ ] Zustand selectors are narrow (no `useStore()` — always `useStore((s) => s.field)`)
- [ ] No server state duplicated in Zustand (use React Query for server state)
- [ ] No hardcoded colors, spacing, or font sizes (all from theme tokens)

### Offline & Error Handling
- [ ] Works in airplane mode (tested — not assumed)
- [ ] No full-screen spinner after first load (skeleton or cached data only)
- [ ] All error states show human-readable messages (no raw error codes)
- [ ] Survives app restart mid-action
- [ ] Survives duplicate action (double-tap safe / rate limited)

### Optimistic Updates (if mutation)
- [ ] `onMutate` — sets optimistic state
- [ ] `onError` — rolls back to previous state
- [ ] `onSettled` — invalidates queries for fresh sync
- [ ] N/A — this PR has no mutations

### Contract Safety
- [ ] Shared contract changes updated in `packages/shared` AND consumers
- [ ] REST endpoint changes updated in `docs/API_CONTRACT_MATRIX.md`
- [ ] Socket event changes updated in `docs/SOCKET_EVENT_REGISTRY.md`
- [ ] Backend/mobile/admin type-check passes after contract changes

### Production Safety
- [ ] No `console.log` statements in production code
- [ ] Error handling for all async operations
- [ ] Not deploying during morning window (6:30am–10am IST)
- [ ] Database migration reviewed (if applicable)
- [ ] Manual testing for check-in flow (if touching attendance)

## Definition of Done

> A feature is **DONE** only when ALL of these are true:
> - [ ] Works online
> - [ ] Works offline
> - [ ] Survives app restart
> - [ ] Survives duplicate actions
> - [ ] Shows correct error states
> - [ ] Passes CI (typecheck + lint + architecture check)

## Deployment Notes
<!-- Any special deployment considerations? -->
