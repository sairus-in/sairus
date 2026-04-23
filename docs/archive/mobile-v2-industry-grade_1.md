# Mobile App — Industry-Grade Hardening (V2)
**University Bus System · Addressing the Brutal Review**
*Supersedes V1 stabilization guide where sections conflict*

---

## What V1 Got Right and Where It Stopped Short

V1 fixed the visible failures: type errors, wrong token types, header placement, placeholder config. Those were all real and worth fixing. But the brutal review identified something deeper: **V1 was patching symptoms while leaving the structural causes intact.**

The core critique is accurate. After V1 you would have had:
- A type-clean mobile app that still guesses backend state
- An idempotency key in the right header but no persistence behind it
- A push pipeline that picks the right token type but drops messages silently
- An auth bootstrap that handles errors gracefully but isn't concurrency-safe
- A socket system with refreshed tokens but duplicate event listeners
- Tests that pass and still miss the failure modes that matter

This document addresses all ten issues from the review. Each section states the problem in plain terms, explains why the V1 fix was incomplete, and gives the real fix.

---

## Issue 1 — Frontend Is Still Guessing Backend State

### What V1 did
Introduced `TripScreenState` as a typed union and a `deriveScreenState()` function that maps raw API data to that union.

### Why that's still wrong
`deriveScreenState()` is frontend logic interpreting backend data. The backend is the authority on what a student's trip state actually is. The frontend is a rendering layer. When you put derivation logic on the frontend you get:

- A second place where business rules live (the first is the backend)
- Silent mis-derivation when the backend changes shape without a breaking type change
- Drift that TypeScript cannot catch because the types can still match while the logic is wrong

### The real fix — Backend-Driven UI State (BFF pattern, properly applied)

The student home BFF endpoint at `/v1/student/home` already exists. Make it return the resolved screen state, not raw data for the frontend to interpret.

**Backend — return resolved state:**

```typescript
// apps/backend/src/modules/student/student.routes.ts

// Instead of returning raw trip + attendance data, return a resolved screen state
interface StudentHomeResponse {
  screenState: StudentScreenState;
  meta: {
    studentName: string;
    avatarUrl: string | null;
    resolvedAt: string; // ISO timestamp
  };
}

type StudentScreenState =
  | { status: 'loading' }  // used only for optimistic FE rendering
  | { status: 'no_trip' }
  | { status: 'trip_upcoming'; tripId: string; departureAt: string; busNumber: string }
  | { status: 'trip_active'; tripId: string; busId: string; canCheckIn: boolean; busEta: number | null }
  | { status: 'checked_in'; tripId: string; busId: string; checkedInAt: string }
  | { status: 'trip_completed'; tripId: string; completedAt: string };
```

The backend already has all the information needed to resolve which state applies. It has the trip record, the attendance record, the schedule, and the current time. None of that should be re-derived on the frontend.

**Frontend — render only, no derivation:**

```typescript
// apps/mobile/hooks/useStudentHome.ts

export function useStudentHome({ enabled = true } = {}) {
  return useQuery<StudentHomeResponse>({
    queryKey: ['student', 'home'],
    queryFn: () => apiClient.get('/v1/student/home').then(r => r.data),
    enabled,
    staleTime: 30_000,
  });
}

// apps/mobile/app/(student)/index.tsx

const { data, isLoading, isError } = useStudentHome();

// No derivation. No interpretation. Direct render.
if (isLoading) return <LoadingView />;
if (isError)   return <ErrorView />;

const { screenState, meta } = data;

switch (screenState.status) {
  case 'no_trip':         return <NoTripView meta={meta} />;
  case 'trip_upcoming':   return <UpcomingTripView state={screenState} meta={meta} />;
  case 'trip_active':     return <ActiveTripView state={screenState} meta={meta} />;
  case 'checked_in':      return <CheckedInView state={screenState} meta={meta} />;
  case 'trip_completed':  return <CompletedView state={screenState} meta={meta} />;
}
```

The frontend now has zero business logic. It receives a `status` string and renders the right component. If the backend changes how it determines `trip_active`, the frontend does not change. The contract is the `StudentScreenState` type in `packages/shared` — both sides import from there.

**Move `StudentScreenState` to shared:**

```typescript
// packages/shared/src/types/student.types.ts
// This is the contract both sides sign

export type StudentScreenStateStatus =
  | 'no_trip'
  | 'trip_upcoming'
  | 'trip_active'
  | 'checked_in'
  | 'trip_completed';

export type StudentScreenState =
  | { status: 'no_trip' }
  | { status: 'trip_upcoming'; tripId: string; departureAt: string; busNumber: string }
  | { status: 'trip_active'; tripId: string; busId: string; canCheckIn: boolean; busEta: number | null }
  | { status: 'checked_in'; tripId: string; busId: string; checkedInAt: string }
  | { status: 'trip_completed'; tripId: string; completedAt: string };

export interface StudentHomeResponse {
  screenState: StudentScreenState;
  meta: { studentName: string; avatarUrl: string | null; resolvedAt: string };
}
```

The frontend never imports `StudentScreenStateStatus` directly — it only uses the discriminated union via `switch (screenState.status)`. This means the TypeScript exhaustiveness check will catch any new state added to shared that the frontend hasn't handled.

---

## Issue 2 — State Transitions Are Not Validated

### What V1 did
Defined `TripScreenState` as a typed union. States are named. Types are correct.

### Why that's still wrong
TypeScript types only enforce shape at compile time. They do not prevent illegal runtime transitions. A student who has checked in can, through backend glitch or replay, appear to be back in `trip_active` and be shown the check-in button again. The type system will not catch this.

### The real fix — Validated State Machine

**Backend — enforce transitions at the service level:**

```typescript
// apps/backend/src/modules/attendance/attendance.service.ts

const VALID_TRANSITIONS: Record<StudentScreenStateStatus, StudentScreenStateStatus[]> = {
  no_trip:        ['trip_upcoming'],
  trip_upcoming:  ['trip_active', 'no_trip'],
  trip_active:    ['checked_in', 'trip_completed'],
  checked_in:     ['trip_completed'],
  trip_completed: [], // terminal state — no exits
};

async function assertTransitionValid(
  studentId: string,
  tripId: string,
  toStatus: StudentScreenStateStatus
): Promise<void> {
  const currentState = await resolveCurrentStudentState(studentId, tripId);
  const allowed = VALID_TRANSITIONS[currentState.status];

  if (!allowed.includes(toStatus)) {
    throw new InvalidStateTransitionError(
      `Cannot transition from '${currentState.status}' to '${toStatus}' ` +
      `for student ${studentId} on trip ${tripId}`
    );
  }
}

// Call before processing check-in
async function processCheckIn(studentId: string, tripId: string) {
  await assertTransitionValid(studentId, tripId, 'checked_in');
  // ... proceed with check-in
}
```

**Frontend — guard against rendering impossible states:**

Even with backend enforcement, add a frontend guard so that a state that "can't happen" doesn't silently render wrong UI:

```typescript
// apps/mobile/lib/state-machine.ts

const VALID_TRANSITIONS: Record<string, string[]> = {
  no_trip:        ['trip_upcoming'],
  trip_upcoming:  ['trip_active', 'no_trip'],
  trip_active:    ['checked_in', 'trip_completed'],
  checked_in:     ['trip_completed'],
  trip_completed: [],
};

let _lastStatus: string | null = null;

export function assertValidTransition(newStatus: string): void {
  if (_lastStatus === null) {
    _lastStatus = newStatus;
    return;
  }

  const allowed = VALID_TRANSITIONS[_lastStatus] ?? [];
  if (!allowed.includes(newStatus) && newStatus !== _lastStatus) {
    // Log for observability — do not crash the app
    console.error(
      `[StateMachine] Illegal transition: ${_lastStatus} → ${newStatus}. ` +
      `Ignoring update.`
    );
    // Optionally: report to error tracking service
    return;
  }

  _lastStatus = newStatus;
}
```

Use this in your query's `onSuccess` callback so that if the backend ever returns a state that doesn't follow valid transitions, the UI does not silently update to show wrong actions.

---

## Issue 3 — Idempotency Has No Persistence Window

### What V1 did
Moved the idempotency key from the request body to the `Idempotency-Key` header. Correct placement.

### Why that's still wrong
Idempotency only works if the backend *stores* the key and checks it before processing. If the backend restarts between a student's offline scan and the replay, the stored key is gone and the check-in processes again as a duplicate. Right now your "idempotency" is just a correctly-named header with nothing behind it.

### The real fix — Persisted Idempotency Key Store

**Backend — idempotency_keys table:**

```sql
-- Migration
CREATE TABLE idempotency_keys (
  key         VARCHAR(64)  PRIMARY KEY,
  user_id     UUID         NOT NULL REFERENCES users(id),
  route       VARCHAR(128) NOT NULL,  -- e.g. 'POST /v1/attendance/check-in'
  status_code SMALLINT     NOT NULL,
  response    JSONB        NOT NULL,
  expires_at  TIMESTAMPTZ  NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_idempotency_keys_expires ON idempotency_keys (expires_at);
```

**Backend — idempotency middleware:**

```typescript
// apps/backend/src/middleware/idempotency.middleware.ts

export async function idempotencyMiddleware(req: Request, res: Response, next: NextFunction) {
  const key = req.headers['idempotency-key'] as string | undefined;

  if (!key) return next(); // no key = not an idempotent request

  if (key.length < 16 || key.length > 64) {
    return res.status(400).json({ error: 'Idempotency-Key must be 16–64 characters' });
  }

  const existing = await db.query(
    'SELECT status_code, response FROM idempotency_keys WHERE key = $1 AND expires_at > NOW()',
    [key]
  );

  if (existing.rows.length > 0) {
    // Replay: return the stored response exactly
    const { status_code, response } = existing.rows[0];
    return res.status(status_code).json(response);
  }

  // Intercept the response to store it
  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    // Store asynchronously — don't block the response
    db.query(
      `INSERT INTO idempotency_keys (key, user_id, route, status_code, response)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (key) DO NOTHING`,
      [key, req.user.id, `${req.method} ${req.path}`, res.statusCode, body]
    ).catch(err => console.error('Failed to persist idempotency key:', err));

    return originalJson(body);
  };

  next();
}

// Register on attendance routes only (or any route that needs it)
// apps/backend/src/modules/attendance/attendance.routes.ts
router.post('/check-in', idempotencyMiddleware, checkInHandler);
```

**Add a cleanup job:**

```typescript
// apps/backend/src/jobs/cleanup.worker.ts

// Run every hour — delete expired keys
async function cleanupExpiredIdempotencyKeys() {
  const result = await db.query(
    'DELETE FROM idempotency_keys WHERE expires_at < NOW()'
  );
  console.log(`Cleaned up ${result.rowCount} expired idempotency keys`);
}
```

**Mobile — generate key once at enqueue time (V1 already says this, still correct):**

```typescript
// apps/mobile/lib/checkin-queue.ts
import { randomUUID } from 'expo-crypto';

export async function enqueueCheckin(tripId: string): Promise<void> {
  await persistCheckin({
    id: randomUUID(),
    idempotencyKey: randomUUID(), // locked at scan time, never changes on replay
    tripId,
    scannedAt: new Date().toISOString(),
    replayed: false,
  });
}
```

Now even if the backend restarts, the stored key prevents duplicate processing. The 24-hour window covers any realistic offline → back-online scenario for a student on a daily bus route.

---

## Issue 4 — Push Notifications Are Fire-and-Forget

### What V1 did
Correctly diagnosed the token type mismatch and gave two implementation options.

### Why that's still wrong
Even with the right token type, push systems fail silently. Firebase and Expo both return success responses for messages that are later dropped. Without delivery tracking, your system reports "notification sent" while the student never receives it.

### The real fix — Push Delivery Pipeline with Tracking

**Backend — push_notifications table:**

```sql
CREATE TABLE push_notifications (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID         NOT NULL REFERENCES users(id),
  push_token   TEXT         NOT NULL,
  title        TEXT         NOT NULL,
  body         TEXT         NOT NULL,
  data         JSONB,
  status       TEXT         NOT NULL DEFAULT 'pending',
    -- pending | sent | delivered | failed | invalid_token
  provider_id  TEXT,        -- Firebase message ID or Expo ticket ID
  attempts     SMALLINT     NOT NULL DEFAULT 0,
  last_error   TEXT,
  scheduled_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  sent_at      TIMESTAMPTZ,
  failed_at    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_push_pending ON push_notifications (status, scheduled_at)
  WHERE status = 'pending';
```

**Backend — push worker with retry:**

```typescript
// apps/backend/src/jobs/notification.worker.ts

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [0, 30_000, 300_000]; // immediate, 30s, 5min

async function processPendingNotifications(): Promise<void> {
  const pending = await db.query<PushNotification>(
    `SELECT * FROM push_notifications
     WHERE status = 'pending'
       AND attempts < $1
       AND scheduled_at <= NOW()
     ORDER BY scheduled_at
     LIMIT 100
     FOR UPDATE SKIP LOCKED`,
    [MAX_ATTEMPTS]
  );

  for (const notification of pending.rows) {
    await processNotification(notification);
  }
}

async function processNotification(notification: PushNotification): Promise<void> {
  try {
    const providerId = await sendViaPushProvider(notification);

    await db.query(
      `UPDATE push_notifications
       SET status = 'sent', provider_id = $1, sent_at = NOW(), attempts = attempts + 1
       WHERE id = $2`,
      [providerId, notification.id]
    );
  } catch (err) {
    const nextAttempt = notification.attempts + 1;
    const isInvalidToken = isInvalidTokenError(err);

    await db.query(
      `UPDATE push_notifications
       SET status = $1,
           attempts = attempts + 1,
           last_error = $2,
           failed_at = CASE WHEN $3 THEN NOW() ELSE NULL END,
           scheduled_at = CASE WHEN NOT $3 THEN NOW() + $4 * INTERVAL '1 millisecond' ELSE scheduled_at END
       WHERE id = $5`,
      [
        isInvalidToken || nextAttempt >= MAX_ATTEMPTS ? 'failed' : 'pending',
        err.message,
        isInvalidToken || nextAttempt >= MAX_ATTEMPTS,
        RETRY_DELAYS_MS[nextAttempt] ?? RETRY_DELAYS_MS.at(-1),
        notification.id,
      ]
    );

    // Invalid token = stale registration, remove it from the user record
    if (isInvalidToken) {
      await db.query(
        'UPDATE users SET push_token = NULL WHERE push_token = $1',
        [notification.push_token]
      );
    }
  }
}
```

**Admin visibility — failed deliveries surface to operators:**

```typescript
// apps/backend/src/modules/admin/notifications.routes.ts

// GET /v1/admin/notifications/delivery-report
router.get('/delivery-report', adminRoute(), async (req, res) => {
  const report = await db.query(
    `SELECT
       status,
       COUNT(*)          AS count,
       MAX(created_at)   AS latest
     FROM push_notifications
     WHERE created_at > NOW() - INTERVAL '24 hours'
     GROUP BY status`
  );
  res.json({ success: true, data: report.rows });
});
```

When a student says "I didn't get the alert," an operator can now check delivery status instead of guessing.

---

## Issue 5 — Auth Bootstrap Has a Concurrency Problem

### What V1 did
Differentiated between network errors (unverified state) and 401 errors (clear token). Logically correct.

### Why that's still wrong
During bootstrap, multiple API calls can fire before the auth state is resolved. On a flaky connection, some succeed and some fail, causing the auth state to flip between `authenticated` and `unverified` on each response. The result is inconsistent UI and partial data — both of which are much harder to debug than a clean failure.

### The real fix — Bootstrap Lock

```typescript
// apps/mobile/store/auth.store.ts

type AuthPhase = 'idle' | 'bootstrapping' | 'authenticated' | 'unverified' | 'unauthenticated';

interface AuthState {
  phase: AuthPhase;
  user: User | null;
  bootstrapPromise: Promise<void> | null;
}

// apps/mobile/lib/api.client.ts — intercept all requests during bootstrap

apiClient.interceptors.request.use(async (config) => {
  const { phase, bootstrapPromise } = useAuthStore.getState();

  if (phase === 'bootstrapping' && bootstrapPromise) {
    // Block this request until bootstrap resolves
    await bootstrapPromise;
  }

  return config;
});

// apps/mobile/app/_layout.tsx

async function bootstrapAuth(): Promise<void> {
  const store = useAuthStore.getState();

  // Prevent concurrent bootstraps
  if (store.phase === 'bootstrapping') return store.bootstrapPromise!;

  let resolveBootstrap!: () => void;
  const bootstrapPromise = new Promise<void>(resolve => { resolveBootstrap = resolve; });

  store.setPhase('bootstrapping');
  store.setBootstrapPromise(bootstrapPromise);

  try {
    const localToken = await getStoredToken();

    if (!localToken) {
      store.setPhase('unauthenticated');
      return;
    }

    try {
      const profile = await apiClient.get('/v1/auth/me');
      store.setPhase('authenticated');
      store.setUser(profile.data);
    } catch (err) {
      if (err.response?.status === 401) {
        await clearStoredToken();
        store.setPhase('unauthenticated');
      } else {
        // Network error — use local token payload but mark as unverified
        store.setPhase('unverified');
        store.setUser(decodeTokenPayload(localToken));
      }
    }
  } finally {
    store.setBootstrapPromise(null);
    resolveBootstrap(); // unblock any queued API calls
  }
}
```

Now all API calls that fire during bootstrap are held until the auth state is resolved. There is no race condition. The auth state changes exactly once per bootstrap cycle.

---

## Issue 6 — Socket Reconnects Cause Duplicate Event Listeners

### What V1 did
Fixed socket auth token refresh on login/logout.

### Why that's still wrong
On reconnect, if listeners are attached again without removing the old ones, the same event fires twice (or N times after N reconnects). This causes duplicate UI updates — a bus position that jumps back and forth, a check-in that shows twice in a list, a notification badge count that increments by two.

### The real fix — Idempotent Listener Registration

```typescript
// apps/mobile/lib/socket.ts

type EventHandler = (...args: unknown[]) => void;
const _registeredHandlers = new Map<string, EventHandler>();

export function safeOn(socket: Socket, event: string, handler: EventHandler): void {
  // Remove previous handler for this event if one exists
  if (_registeredHandlers.has(event)) {
    socket.off(event, _registeredHandlers.get(event)!);
  }

  socket.on(event, handler);
  _registeredHandlers.set(event, handler);
}

export function resetSocketListeners(socket: Socket): void {
  for (const [event, handler] of _registeredHandlers) {
    socket.off(event, handler);
  }
  _registeredHandlers.clear();
}

// Usage — replace all socket.on() calls with safeOn()
safeOn(socket, 'trip:state_updated', handleTripStateUpdate);
safeOn(socket, 'bus:position',       handleBusPosition);
safeOn(socket, 'attendance:updated', handleAttendanceUpdate);

// On reconnect (Socket.IO fires this automatically)
socket.on('connect', () => {
  // Re-register all handlers idempotently — no duplicates
  registerAllSocketHandlers(socket);
});

// On logout
function disconnectSocket(): void {
  resetSocketListeners(socket);
  socket.disconnect();
}
```

**Also — push realtime state changes through the BFF pattern from Issue 1:**

When a socket event arrives that should change the screen state, do not re-derive state from the event payload. Refetch the BFF endpoint:

```typescript
safeOn(socket, 'trip:state_updated', () => {
  // Don't try to interpret the event payload — let the backend resolve the new state
  queryClient.invalidateQueries({ queryKey: ['student', 'home'] });
});
```

This eliminates an entire class of "socket event + frontend derivation" bugs.

---

## Issue 7 — Fail-Fast Config Can Brick the App on OTA Updates

### What V1 did
Introduced `requireEnv()` that throws immediately if any env var is missing. Correct in intent.

### Why that's still wrong
With Expo OTA updates, the JS bundle can be updated independently of the native binary. If a new bundle is pushed that requires a new env var that the current native config doesn't have, `requireEnv()` crashes the app on launch — for every user, simultaneously, with no way to recover without a full app store release. That is a production incident.

### The real fix — Tiered Validation

Separate env vars into two tiers:

```typescript
// apps/mobile/lib/config.ts

// Tier 1: Critical — app cannot function without these
// These should have been set at native build time and should never be missing
// If they are missing, something has gone very wrong with the build itself
const CRITICAL_ENV_KEYS = [
  'EXPO_PUBLIC_API_URL',
  'EXPO_PUBLIC_SOCKET_URL',
] as const;

// Tier 2: Important but recoverable — app can start, specific features degrade
const IMPORTANT_ENV_KEYS = [
  'EXPO_PUBLIC_FIREBASE_API_KEY',
  'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
  'EXPO_PUBLIC_FIREBASE_APP_ID',
  'EXPO_PUBLIC_PROJECT_ID',
] as const;

function validateConfig() {
  const criticalErrors: string[] = [];
  const warnings: string[] = [];

  for (const key of CRITICAL_ENV_KEYS) {
    if (!process.env[key]) criticalErrors.push(key);
  }

  for (const key of IMPORTANT_ENV_KEYS) {
    if (!process.env[key]) warnings.push(key);
  }

  if (warnings.length > 0) {
    console.warn(`[Config] Missing optional env vars: ${warnings.join(', ')}. Affected features will be disabled.`);
    // Report to error tracking — this is worth knowing about
    errorTracker.captureMessage(`Missing env vars: ${warnings.join(', ')}`, 'warning');
  }

  if (criticalErrors.length > 0) {
    // This genuinely cannot be recovered — the app has no API to talk to
    // But log exhaustively before throwing so crash reports are useful
    errorTracker.captureMessage(`Critical env vars missing: ${criticalErrors.join(', ')}`, 'fatal');
    throw new Error(
      `App cannot start. Critical configuration missing: ${criticalErrors.join(', ')}. ` +
      `This is a build/deployment error, not a user error.`
    );
  }
}

export const config = {
  apiUrl: process.env.EXPO_PUBLIC_API_URL!,
  socketUrl: process.env.EXPO_PUBLIC_SOCKET_URL!,
  firebase: {
    apiKey:    process.env.EXPO_PUBLIC_FIREBASE_API_KEY    ?? null,
    projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? null,
    appId:     process.env.EXPO_PUBLIC_FIREBASE_APP_ID     ?? null,
  },
  pushEnabled: !!(
    process.env.EXPO_PUBLIC_FIREBASE_API_KEY &&
    process.env.EXPO_PUBLIC_PROJECT_ID
  ),
};

// Feature flags driven by config presence
export const features = {
  pushNotifications: config.pushEnabled,
  // Disable push feature gracefully if Firebase config is missing
};
```

Then in the push registration code:

```typescript
// apps/mobile/lib/notifications.ts
import { features } from '@/lib/config';

export async function registerPushToken(): Promise<void> {
  if (!features.pushNotifications) {
    console.warn('[Push] Push notifications disabled — Firebase config missing');
    return; // graceful no-op, not a crash
  }
  // ... proceed with registration
}
```

---

## Issue 8 — Tests Don't Cover the Failure Modes That Matter

### What V1 did
Wrote tests for happy path and basic error cases (network failure, 409 conflict).

### Why that's still wrong
The failures that happen at 2AM are not happy-path failures. They are concurrency failures, race conditions, offline/online transitions, and retry edge cases. The review is correct that the V1 test suite would pass and still miss every real production failure.

### The real fix — Test the Scenarios That Actually Break

**Concurrency test — multiple bootstrap calls:**

```typescript
// apps/mobile/__tests__/auth-bootstrap.test.ts

it('handles concurrent bootstrap calls — only one executes', async () => {
  let resolveApiCall!: (v: unknown) => void;
  mockApiClient.get.mockReturnValue(
    new Promise(resolve => { resolveApiCall = resolve; })
  );

  // Fire three simultaneous bootstraps (simulates app re-render during startup)
  const [p1, p2, p3] = [bootstrapAuth(), bootstrapAuth(), bootstrapAuth()];

  resolveApiCall({ data: { id: 'user-1', name: 'Test Student' } });
  await Promise.all([p1, p2, p3]);

  // API must have been called exactly once despite three concurrent callers
  expect(mockApiClient.get).toHaveBeenCalledTimes(1);
  expect(getAuthState().phase).toBe('authenticated');
});
```

**Race condition test — API calls during bootstrap are held:**

```typescript
it('queued API calls wait for bootstrap to complete before firing', async () => {
  let resolveBootstrap!: (v: unknown) => void;
  mockApiClient.get.mockImplementationOnce(
    () => new Promise(resolve => { resolveBootstrap = resolve; })
  );

  const bootstrapTask = bootstrapAuth(); // starts but doesn't resolve yet

  // This should block until bootstrap is done
  const dataTask = apiClient.get('/v1/student/home');

  // Bootstrap hasn't resolved — data call should be pending
  expect(mockApiClient.get).toHaveBeenCalledTimes(1); // only the auth call

  resolveBootstrap({ data: { id: 'user-1' } });
  await bootstrapTask;

  // Now the data call should have fired
  await dataTask;
  expect(mockApiClient.get).toHaveBeenCalledTimes(2);
});
```

**Offline → online transition test:**

```typescript
// apps/mobile/__tests__/checkin-queue.test.ts

it('replays all pending check-ins in order when coming back online', async () => {
  // Enqueue three check-ins while "offline"
  await enqueueCheckin('trip-1');
  await enqueueCheckin('trip-1');
  await enqueueCheckin('trip-1');

  mockApiClient.post.mockResolvedValue({ status: 200, data: { success: true } });

  await replayPendingCheckins();

  expect(mockApiClient.post).toHaveBeenCalledTimes(3);

  // All three should be marked as replayed
  const pending = await getPendingCheckins();
  expect(pending).toHaveLength(0);
});

it('stops replaying on network error — does not partially flush', async () => {
  await enqueueCheckin('trip-1');
  await enqueueCheckin('trip-1');

  // Second call fails with network error
  mockApiClient.post
    .mockResolvedValueOnce({ status: 200 })
    .mockRejectedValueOnce(new NetworkError());

  await replayPendingCheckins();

  // First is done, second is still pending
  const pending = await getPendingCheckins();
  expect(pending).toHaveLength(1);
});
```

**Socket duplicate event test:**

```typescript
// apps/mobile/__tests__/socket.test.ts

it('does not fire duplicate handlers after reconnect', () => {
  const handler = jest.fn();
  safeOn(mockSocket, 'trip:state_updated', handler);

  // Simulate reconnect
  mockSocket.emit('connect');
  // Re-registering (as connect handler does)
  safeOn(mockSocket, 'trip:state_updated', handler);

  // Fire the event once
  mockSocket.emit('trip:state_updated', { tripId: 'trip-1' });

  // Handler should fire exactly once
  expect(handler).toHaveBeenCalledTimes(1);
});
```

---

## Issue 9 — CI Validates Syntax, Not Behavior

### What V1 did
Added `pnpm --filter mobile type-check` to CI. Necessary but not sufficient.

### Why that's still wrong
A type-clean app can still have a completely broken API contract with the backend. The backend can change a response shape in a way that is type-safe (adding a new required field) and the mobile app will type-check clean but render wrong data.

### The real fix — Contract Tests

Contract tests verify that the actual HTTP responses the backend returns match the types the frontend expects. They run against a real (test) database and fail if the contract drifts.

```typescript
// apps/backend/__tests__/contracts/student-home.contract.test.ts

import { StudentHomeResponse } from '@packages/shared/src/types/student.types';
import { z } from 'zod';

// Build the Zod schema from the TypeScript type
// (or use a schema-first approach and derive the TS type from the schema)
const StudentHomeResponseSchema = z.object({
  screenState: z.discriminatedUnion('status', [
    z.object({ status: z.literal('no_trip') }),
    z.object({
      status: z.literal('trip_upcoming'),
      tripId: z.string().uuid(),
      departureAt: z.string().datetime(),
      busNumber: z.string(),
    }),
    z.object({
      status: z.literal('trip_active'),
      tripId: z.string().uuid(),
      busId: z.string().uuid(),
      canCheckIn: z.boolean(),
      busEta: z.number().nullable(),
    }),
    z.object({
      status: z.literal('checked_in'),
      tripId: z.string().uuid(),
      busId: z.string().uuid(),
      checkedInAt: z.string().datetime(),
    }),
    z.object({
      status: z.literal('trip_completed'),
      tripId: z.string().uuid(),
      completedAt: z.string().datetime(),
    }),
  ]),
  meta: z.object({
    studentName: z.string(),
    avatarUrl: z.string().url().nullable(),
    resolvedAt: z.string().datetime(),
  }),
});

describe('GET /v1/student/home contract', () => {
  it('returns a response that matches the shared StudentHomeResponse schema', async () => {
    const { token } = await createTestStudent();
    const response = await testApp.get('/v1/student/home')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);

    // This parse throws a detailed error if the response shape is wrong
    const parsed = StudentHomeResponseSchema.safeParse(response.body);
    expect(parsed.success).toBe(true);

    if (!parsed.success) {
      // Print the Zod errors so CI output is useful
      console.error(parsed.error.format());
    }
  });
});
```

Add this to CI:

```yaml
# .github/workflows/ci.yml
- name: Contract tests
  run: pnpm --filter backend test:contracts
```

Now if a backend developer changes the `/v1/student/home` response shape without updating the shared type, CI catches it before it reaches mobile.

---

## Issue 10 — The Architectural Boundary Is Leaky

### What the review said
"You don't have a true boundary. Frontend couples UI logic, API response shape, and business logic."

This is the root cause of all the other issues. Every time business logic lives in both the backend and the frontend, you get drift. Every time the frontend interprets API data instead of rendering resolved state, you get inconsistency. The fix is not more patches — it is a cleaner boundary.

### The real fix — Enforced Layer Contract

The rule is simple to state and hard to maintain without tooling:

> **The backend owns all business logic and state resolution. The frontend owns all rendering. The shared package owns the contract between them.**

Enforce this as a lint rule so it cannot be accidentally violated:

```javascript
// .eslintrc.js — in the mobile app config

rules: {
  // No importing business logic utilities from shared
  'no-restricted-imports': ['error', {
    patterns: [
      {
        group: ['@packages/shared/src/lib/*'],
        message: 'Mobile must not import business logic from shared. Use the API response directly.',
      },
      {
        group: ['@packages/shared/src/services/*'],
        message: 'Mobile must not import service logic from shared.',
      },
    ],
    // Types and schemas are fine — they are the contract
    // paths: shared/types/*, shared/schemas/* are allowed
  }],
}
```

This makes the boundary machine-enforced, not just convention. A PR that tries to import a business logic function from shared into mobile will fail the lint check.

**Document the contract layers explicitly:**

```
packages/shared/src/
  types/      ← contract types (both sides import these)
  schemas/    ← Zod schemas for validation (both sides can use)
  events.ts   ← socket event name constants (both sides import)

  lib/        ← backend-only utilities (mobile lint rule blocks import)
  services/   ← backend-only service logic (mobile lint rule blocks import)
```

---

## Revised Execution Order

Given all ten issues, here is the corrected work sequence. It differs from V1 because it addresses root causes in the right order.

### Step 1 — Move state authority to the backend (Issue 1 first)
This is the foundation. If you fix type errors before fixing where state lives, you will fix them in the wrong architecture. Change the BFF endpoint to return `screenState` directly. Update the shared types. Remove `deriveScreenState()`. Now the frontend is truly just a renderer.

### Step 2 — Fix type errors against the new architecture (V1 Phase 0)
Now fix the type errors. They are smaller and cleaner because you are not fighting a broken model, you are aligning with a correct one.

### Step 3 — Add state transition validation (Issue 2)
Add the backend transition guard. Add the frontend guard as a secondary safety net.

### Step 4 — Fix idempotency with persistence (Issue 3)
Create the `idempotency_keys` table. Add the middleware. Now the header fix from V1 Phase 1 is actually meaningful.

### Step 5 — Fix push delivery pipeline (Issue 4)
Create the `push_notifications` table. Add the retry worker. Now the token type fix from V1 Phase 1 is actually reliable.

### Step 6 — Fix auth bootstrap with concurrency lock (Issue 5)
Add the bootstrap lock. This replaces the V1 bootstrap logic.

### Step 7 — Fix socket listener idempotency (Issue 6)
Add `safeOn()`. Update reconnect handler to use it.

### Step 8 — Fix env validation to tiered approach (Issue 7)
Replace `requireEnv()` with the tiered system.

### Step 9 — Write the behavior-level tests (Issue 8)
Write concurrency tests, race condition tests, offline transition tests, socket duplicate tests.

### Step 10 — Add contract tests to CI (Issue 9)
Add Zod contract schemas. Add contract test job to pipeline.

### Step 11 — Enforce the boundary with lint rules (Issue 10)
Add the `no-restricted-imports` rule. Reorganize `packages/shared` to make the boundary explicit.

---

## Revised Quality Gate Checklist

### Gate 1 — Architecture is correct
- [ ] `/v1/student/home` returns `screenState` directly
- [ ] `StudentScreenState` type is in `packages/shared`
- [ ] `deriveScreenState()` is deleted
- [ ] Mobile screen has zero business logic — only rendering

### Gate 2 — Contracts are enforced
- [ ] `idempotency_keys` table exists with expiry
- [ ] Idempotency middleware wired on check-in route
- [ ] `push_notifications` table exists
- [ ] Push worker has retry logic and failure tracking
- [ ] Contract tests pass for every BFF endpoint mobile consumes

### Gate 3 — Concurrency is safe
- [ ] Auth bootstrap lock prevents concurrent execution
- [ ] API calls during bootstrap are queued and released
- [ ] Socket listeners are idempotent across reconnects
- [ ] No duplicate event handler registrations possible

### Gate 4 — Configuration is safe
- [ ] Critical env vars crash the app with a clear message
- [ ] Non-critical env vars disable features gracefully (not crash)
- [ ] `features.*` flags drive feature availability from config presence

### Gate 5 — Tests cover real failure modes
- [ ] Concurrent bootstrap test passes
- [ ] Queued-during-bootstrap API call test passes
- [ ] Offline queue replay order test passes
- [ ] Replay stops correctly on network error test passes
- [ ] Socket duplicate handler test passes
- [ ] State transition rejection test passes

### Gate 6 — CI is behavior-aware
- [ ] `pnpm --filter mobile type-check` in CI
- [ ] `pnpm --filter backend test:contracts` in CI
- [ ] Lint rule blocking business logic imports into mobile

---

## What Industry-Grade Actually Means

The review's final observation is worth repeating plainly:

> "Industry-grade systems are hard to misuse, not just well-designed."

That means:
- A developer cannot accidentally put derivation logic in the frontend because the architecture has no place for it
- A backend change that breaks the mobile contract fails CI before it reaches anyone's device
- An offline check-in that replays after a server restart produces the correct result automatically, not because someone remembered to handle it
- A bad env var produces a clear error in logs and disables the affected feature — it does not silently point at a developer's laptop IP

This is the bar. The checklists above, completed in order, get you there.

---

*V2 — Addresses all 10 issues from the brutal review. Supersedes V1 on Issues 1–10.*
*All code examples are illustrative and assume the current monorepo structure.*
