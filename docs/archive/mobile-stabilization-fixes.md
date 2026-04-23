# Mobile App — Industry-Grade Stabilization Guide
**University Bus System · Mobile Platform Fixes**
*Based on Full System Audit · April 2026*

---

## How to Use This Document

This is your execution playbook, not a summary. Every section maps to a real audit finding, gives you the *why* behind the problem, and shows the exact code change to make. Work through Phase 0 → Phase 4 in order. Do not skip ahead to Phase 2 or 3 while Phase 0 is broken — you will be building on a cracked foundation.

The four rules before you write a single line of new feature code:

1. Mobile must type-check cleanly.
2. Push tokens must be the right kind.
3. Offline idempotency key must be in the right place.
4. Delegation must either be fully supported or fully removed.

---

## Phase 0 — Stop the Bleeding: Fix the Student Home Flow

### Finding 1 — Student Home Screen Is Internally Broken

**What the audit found:**
`apps/mobile/app/(student)/index.tsx` passes props that its child components do not accept, branches on `TripScreenState` values that do not exist in the type, and uses theme tokens that no longer exist in the typed layer. `useStudentHome` only accepts `enabled`, but the screen passes extra query options. The result is that the primary student screen cannot type-check and its runtime behavior is undefined.

**Why this matters:**
Every new feature you add to the student home flow will inherit this broken contract. You are not fighting a single bug; you are fighting cascading drift across six files that have never been reconciled after a refactor.

**The fix — align all six files to a single contract:**

**Step 1: Audit and lock `TripScreenState`**

`apps/mobile/lib/trip-state.ts` — make this the single source of truth. Define every state the screen will ever branch on. Nothing else should define trip states.

```typescript
// apps/mobile/lib/trip-state.ts

export type TripScreenState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'no_trip' }
  | { status: 'trip_upcoming'; tripId: string; departureAt: string }
  | { status: 'trip_active'; tripId: string; busId: string; canCheckIn: boolean }
  | { status: 'checked_in'; tripId: string; busId: string }
  | { status: 'trip_completed'; tripId: string };
```

Remove any other status strings in the codebase that are not in this union. If the screen branches on a string that isn't here, delete that branch.

**Step 2: Fix `useStudentHome` signature**

```typescript
// apps/mobile/hooks/useStudentHome.ts

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api.client';
import { StudentHomeResponseV3 } from '@packages/shared/src/types/student.types';

interface UseStudentHomeOptions {
  enabled?: boolean;
}

export function useStudentHome({ enabled = true }: UseStudentHomeOptions = {}) {
  return useQuery<StudentHomeResponseV3>({
    queryKey: ['student', 'home'],
    queryFn: () => apiClient.get('/v1/student/home').then(r => r.data),
    enabled,
    staleTime: 30_000,
  });
}
```

The hook returns exactly what the API returns. Any field that the screen needs that isn't in `StudentHomeResponseV3` must be added to the shared type, not invented inside the hook.

**Step 3: Remove `query.data.meta` reference**

`useStudentHome.ts` currently reads `query.data.meta`, but `StudentHomeResponseV3` has no `meta` field. Either:
- Add `meta` to `StudentHomeResponseV3` in `packages/shared` if the backend already returns it, or
- Delete the reference if it was speculative.

Do not patch around this with `as any` or optional chaining. Fix the type.

**Step 4: Fix `index.tsx` to only branch on states in `TripScreenState`**

```typescript
// apps/mobile/app/(student)/index.tsx

const { data, isLoading, isError } = useStudentHome();
const screenState: TripScreenState = deriveScreenState(data, isLoading, isError);

// Only switch on .status — nothing else
switch (screenState.status) {
  case 'loading':     return <LoadingView />;
  case 'error':       return <ErrorView message={screenState.message} />;
  case 'no_trip':     return <NoTripView />;
  case 'trip_upcoming': return <UpcomingTripView tripId={screenState.tripId} />;
  case 'trip_active':   return <ActiveTripView state={screenState} />;
  case 'checked_in':    return <CheckedInView tripId={screenState.tripId} />;
  case 'trip_completed': return <CompletedView tripId={screenState.tripId} />;
}
```

Do not pass loose props down that aren't typed. Each view component should accept exactly the fields from its corresponding `TripScreenState` variant.

**Step 5: Fix `BusStatusCard`, `CheckInButton`, `StatCards`**

For each component, compare its current props interface against what `index.tsx` actually passes. The props interface is the contract — fix the call site to match the interface, or fix the interface to match what the screen actually needs. One or the other. Not both in a way that introduces new fields.

**Step 6: Fix `query-client.ts` dynamic import**

```typescript
// apps/mobile/lib/query-client.ts
// WRONG: dynamic import in module config position
const { QueryClient } = await import('@tanstack/react-query'); // ❌

// CORRECT: static import
import { QueryClient } from '@tanstack/react-query'; // ✅

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, staleTime: 30_000 },
    mutations: { retry: 0 },
  },
});
```

**Verification gate — do not leave Phase 0 until this passes:**

```bash
pnpm --filter mobile type-check
# Must exit 0 with no errors
```

---

## Phase 1 — Repair Cross-System Contracts

### Finding 2 — Push Notification Pipeline Is Using the Wrong Token Type

**What the audit found:**
Mobile calls `Notifications.getExpoPushTokenAsync()` and stores that token in a field called `fcmToken`. The backend then reads `fcmToken` and sends via Firebase Admin `sendEachForMulticast()`. Expo push tokens (starting with `ExponentPushToken[...]`) and Firebase Cloud Messaging registration tokens (a long base64 string) are completely different systems. They are not interchangeable. Firebase Admin will reject or silently fail on an Expo token.

**Why this matters:**
Arrival verification alerts, outage messages, and any push-dependent student workflow are broken in production right now. This is not a theoretical risk.

**You have two options. Pick one and commit:**

---

**Option A — Full Firebase (recommended for production scale)**

Keep Firebase Admin on the backend. Change the mobile side to register a real FCM token.

```typescript
// apps/mobile/lib/notifications.ts
import messaging from '@react-native-firebase/messaging';
import { apiClient } from '@/lib/api.client';

export async function registerPushToken(): Promise<void> {
  const permission = await messaging().requestPermission();
  if (!permission) return;

  // This returns an actual FCM registration token, not an Expo token
  const fcmToken = await messaging().getToken();

  await apiClient.post('/v1/users/fcm-token', { fcmToken });

  // Refresh token if Firebase rotates it
  messaging().onTokenRefresh(async newToken => {
    await apiClient.post('/v1/users/fcm-token', { fcmToken: newToken });
  });
}
```

Backend push worker stays the same — `sendEachForMulticast()` works correctly with real FCM tokens.

Dependencies to add to `apps/mobile/package.json`:
```json
"@react-native-firebase/app": "^20.x",
"@react-native-firebase/messaging": "^20.x"
```

---

**Option B — Expo Push everywhere (simpler for an Expo-managed workflow)**

Keep using `getExpoPushTokenAsync()` on mobile. Change the backend to route through Expo's push service instead of Firebase Admin.

```typescript
// apps/backend/src/jobs/notification.worker.ts
import { Expo, ExpoPushMessage } from 'expo-server-sdk';

const expo = new Expo();

async function sendPushNotification(expoPushToken: string, message: string) {
  if (!Expo.isExpoPushToken(expoPushToken)) {
    console.error(`Invalid Expo push token: ${expoPushToken}`);
    return;
  }

  const messages: ExpoPushMessage[] = [{
    to: expoPushToken,
    sound: 'default',
    body: message,
  }];

  const chunks = expo.chunkPushNotifications(messages);
  for (const chunk of chunks) {
    await expo.sendPushNotificationsAsync(chunk);
  }
}
```

Backend dependency: `expo-server-sdk`

---

**After either option — rename the database field to be honest:**

The column/field name `fcmToken` is misleading if you use Expo. Rename it to `pushToken` in both the DB schema and the API contract. Update `packages/shared` accordingly.

---

### Finding 3 — Offline Check-In Idempotency Key Is in the Wrong Place

**What the audit found:**
Mobile sends `idempotencyKey` in the JSON request body. The backend reads `Idempotency-Key` from the HTTP header. The shared contract in `packages/shared/src/schemas/common.ts` explicitly defines idempotency as a header. Body and header are different things. The backend will never see the mobile key, so every offline replay is treated as a fresh, unique request — meaning a student's check-in can be duplicated.

**Why this matters:**
Check-in is the most critical action in the entire student flow. A bus scan that gets replayed after connectivity is restored must not produce two attendance records. This is not a UX bug; it is a data integrity bug.

**The fix:**

```typescript
// apps/mobile/lib/checkin-queue.ts

async function replayPendingCheckins(): Promise<void> {
  const pending = await getPendingCheckins();

  for (const checkin of pending) {
    try {
      await apiClient.post(
        '/v1/attendance/check-in',
        {
          tripId: checkin.tripId,
          scannedAt: checkin.scannedAt,
        },
        {
          headers: {
            // ✅ Key goes in the header, not the body
            'Idempotency-Key': checkin.idempotencyKey,
          },
        }
      );
      await markCheckinReplayed(checkin.id);
    } catch (err) {
      if (isNetworkError(err)) break; // stop replaying, still offline
      // 409 Conflict = already processed = safe to mark done
      if (err.response?.status === 409) {
        await markCheckinReplayed(checkin.id);
      }
    }
  }
}
```

**Also wire the queue into app startup:**

The audit found that `init()` exists on the queue but is not clearly called on cold start. Add this to your root layout bootstrap:

```typescript
// apps/mobile/app/_layout.tsx (bootstrap section)

useEffect(() => {
  async function bootstrap() {
    await checkinQueue.init();      // load persisted queue from storage
    await replayPendingCheckins();  // attempt to flush if online
  }
  bootstrap();
}, []);
```

**Also generate idempotency keys at scan time, not replay time:**

```typescript
// apps/mobile/lib/checkin-queue.ts
import { randomUUID } from 'expo-crypto'; // ✅ declared dep

export async function enqueueCheckin(tripId: string): Promise<void> {
  const checkin = {
    id: randomUUID(),
    idempotencyKey: randomUUID(), // generated once, at enqueue time
    tripId,
    scannedAt: new Date().toISOString(),
    replayed: false,
  };
  await persistCheckin(checkin);
}
```

---

### Finding 6 — Admin List Envelope Is Inconsistent

**What the audit found:**
The backend returns `{ success, data, pagination }`. The admin client unwraps `response.data.data` and throws away pagination. Admin screens type list responses as `{ data, total, page, limit }`. The shared `AdminListResponse<T>` type is stale. Result: pagination in admin is meaningless, and admin-side student/assignment views show wrong state.

**This matters for mobile** because the admin panel is the operational control plane — it is where school staff fix assignment problems that directly block students from using the app.

**Fix the shared type first (all other fixes follow from this):**

```typescript
// packages/shared/src/types/admin-api.types.ts

export interface PaginatedResponse<T> {
  success: true;
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

// Deprecate AdminListResponse<T> or alias it:
export type AdminListResponse<T> = PaginatedResponse<T>;
```

**Fix the admin client unwrap:**

```typescript
// apps/admin/src/lib/api.client.ts

// WRONG — throws away pagination
const items = response.data.data;

// CORRECT — keep the full envelope
const { data: items, pagination } = response.data;
```

**Update admin list screens** to use `pagination.total` instead of a stale `total` field they invented locally.

---

### Finding 7 — Admin Socket Listeners Don't Match Backend Emitters

**What the audit found:**
Backend emits `gps:position` but admin subscribes to `gps:status`. Backend emits `incident:escalated` but admin has no subscription for it.

**The fix:**

```typescript
// apps/admin/src/hooks/useAdminSocket.ts

socket.on('gps:position', (payload: GpsPositionPayload) => {
  // was: gps:status — this event doesn't exist on the backend
  dispatch(updateBusPosition(payload));
});

socket.on('incident:escalated', (payload: IncidentPayload) => {
  // this was missing entirely
  dispatch(addEscalatedIncident(payload));
  showIncidentAlert(payload);
});
```

Update `docs/SOCKET_EVENT_REGISTRY.md` to match the live backend emitters. Then add a test that imports both the backend emit names and the client subscribe names and asserts they are identical strings (see Phase 4).

---

## Phase 2 — Fix Auth, Session, and Persona Boundaries

### Finding 5 — Session Lifecycle Is Brittle

**What the audit found three separate problems:**

1. Auth bootstrap marks a token as "synced" after non-auth fetch failures — this can lock the app into a stale local session if startup hits a transient network error.
2. The socket singleton captures the auth token at creation time and never refreshes it when auth changes.
3. Logout/401 handling clears local auth state but does not reset the socket lifecycle.

**Fix 1 — Don't mark tokens synced on non-auth failures:**

```typescript
// apps/mobile/app/_layout.tsx (bootstrap logic)

async function bootstrapAuth() {
  const localToken = await getStoredToken();
  if (!localToken) {
    setAuthState({ status: 'unauthenticated' });
    return;
  }

  try {
    const profile = await apiClient.get('/v1/auth/me');
    // Only mark synced on a successful auth verification
    setAuthState({ status: 'authenticated', user: profile.data });
  } catch (err) {
    if (err.response?.status === 401) {
      // Server says token is invalid — clear it
      await clearStoredToken();
      setAuthState({ status: 'unauthenticated' });
    } else {
      // Network error, server down, etc.
      // Use local token but mark as unverified — do NOT treat as synced
      setAuthState({ status: 'unverified', user: localTokenPayload(localToken) });
    }
  }
}
```

**Fix 2 — Refresh socket auth on token change:**

```typescript
// apps/mobile/lib/socket.ts

// WRONG — captures token once at module load time
const socket = io(BASE_URL, { auth: { token: getTokenSync() } }); // ❌

// CORRECT — token is fetched dynamically per connection attempt
export function getSocket(): Socket {
  if (!_socket) {
    _socket = io(BASE_URL, {
      auth: (cb) => {
        getStoredToken().then(token => cb({ token }));
      },
      autoConnect: false,
    });
  }
  return _socket;
}
```

**Fix 3 — Reset socket on logout:**

```typescript
// apps/mobile/store/auth.store.ts

async function logout() {
  const socket = getSocket();
  socket.disconnect();    // close the connection
  socket.removeAllListeners(); // clear all event handlers
  _socket = null;         // force recreation on next login

  await clearStoredToken();
  setAuthState({ status: 'unauthenticated' });

  queryClient.clear();    // also clear cached API data
}

// Also handle server-side 401 in the API client interceptor:
apiClient.interceptors.response.use(null, async (error) => {
  if (error.response?.status === 401) {
    await logout();
    router.replace('/login');
  }
  return Promise.reject(error);
});
```

---

### Finding 4 — Delegation Feature Is a Design-Level Mismatch

**What the audit found:**
The delegation screen lives under the student route group. The backend guards delegation endpoints with `adminRoute()`, not `mobileRoute()`. The mobile router sends all staff roles (COORDINATOR, TRANSPORT_OFFICER, etc.) to an unsupported-role screen. The feature is effectively dead in all three layers simultaneously.

**This is not a bug to patch. It is a decision to make.**

**Option A — Remove delegation from mobile for now (recommended):**

```typescript
// apps/mobile/app/_layout.tsx

// Remove: apps/mobile/app/(student)/delegate-takeover.tsx
// Remove: apps/mobile/hooks/useDelegation.ts

// Add a placeholder route that explains the feature isn't mobile-ready yet:
// apps/mobile/app/(student)/delegate-takeover.tsx
export default function DelegateTakeoverScreen() {
  return (
    <InfoScreen
      title="Delegation Unavailable"
      body="Trip delegation is managed from the admin panel. Contact your transport officer."
    />
  );
}
```

**Option B — Properly implement staff mobile access (more work, do this in a separate sprint):**

If staff roles need mobile access, you must:
1. Add dedicated staff route group in mobile: `app/(staff)/`
2. Update root layout routing to send COORDINATOR, TRANSPORT_OFFICER etc. to `(staff)/` not `unsupported-role`
3. Change backend delegation routes from `adminRoute()` to either `mobileRoute()` or a new `staffRoute()` guard
4. Update `mobileRoleSchema` in shared to explicitly list staff roles if they are mobile-supported
5. Implement a full staff experience (trip list, delegation flow, etc.)

Do not do Option B as a side task during a student-flow sprint. It is its own work stream.

---

### Finding 9 — Role Definitions Drift Across Three Packages

**The problems:**
- `mobileRoleSchema` includes `PARENT` but there is no parent flow in mobile
- Admin shared enum uses `NCC`, mobile/router uses `NCC_OFFICER`
- These inconsistencies mean the TypeScript types lie to you

**The fix — normalize in shared, cascade everywhere:**

```typescript
// packages/shared/src/schemas/common.ts

// Define the canonical role enum once
export const RoleSchema = z.enum([
  'STUDENT',
  'DRIVER',
  'COORDINATOR',
  'TRANSPORT_OFFICER',
  'FACULTY',
  'MANAGEMENT',
  'NCC_OFFICER',   // canonical — never 'NCC'
  // 'PARENT',     // removed until parent flow is built
]);

export type Role = z.infer<typeof RoleSchema>;

// Mobile-supported roles — subset of all roles
export const MobileRoleSchema = z.enum(['STUDENT', 'DRIVER']);
export type MobileRole = z.infer<typeof MobileRoleSchema>;

// Admin-supported roles
export const AdminRoleSchema = z.enum([
  'COORDINATOR', 'TRANSPORT_OFFICER', 'FACULTY', 'MANAGEMENT', 'NCC_OFFICER'
]);
```

Grep the entire repo for `NCC` (without `_OFFICER`) and `PARENT` in role contexts and replace with the canonical names. Run type-check across all packages after.

---

## Phase 3 — Fix Configuration and Build Reliability

### Finding 10 — Mobile Has Undeclared Runtime Dependencies

**The audit found** that `apps/mobile/lib/firebase.ts` imports from `firebase/*` and `apps/mobile/lib/checkin-queue.ts` imports `uuid`, but neither is in `apps/mobile/package.json`. This works today via hoisting but will silently break on CI or clean installs.

**Fix — declare everything mobile actually uses:**

```json
// apps/mobile/package.json — add to dependencies
{
  "dependencies": {
    "uuid": "^9.0.0",
    "expo-crypto": "~13.x",
    "@react-native-firebase/app": "^20.x",
    "@react-native-firebase/messaging": "^20.x"
  }
}
```

Replace the `uuid` import with `expo-crypto`'s `randomUUID()` — it is already a stable Expo API and avoids a non-Expo dependency in a React Native context:

```typescript
import { randomUUID } from 'expo-crypto';
```

---

### Finding 11 — Expo Config Has Placeholder Values

**The audit found** that `app.json` still has `YOUR_EXPO_USERNAME` as the owner, a placeholder OTA URL, and a reference to `./assets/notification-icon.png` that does not exist.

**Fix — replace all placeholder values before any EAS build:**

```json
// apps/mobile/app.json
{
  "expo": {
    "owner": "your-actual-expo-org-slug",
    "updates": {
      "url": "https://u.expo.dev/YOUR-ACTUAL-PROJECT-ID"
    },
    "notification": {
      "icon": "./assets/notification-icon.png",
      "color": "#ffffff"
    }
  }
}
```

Create `apps/mobile/assets/notification-icon.png` — it must be a 96×96 PNG. If you do not have one, use your app icon temporarily but do not leave the reference broken.

---

### Finding 12 — Silent Environment Fallbacks Are Dangerous

**What the audit found:**
If env vars are missing, the API client silently falls back to `http://10.147.55.103:3000` (a developer LAN IP), Firebase config silently falls back to empty strings, and the push project ID is optional at runtime. The app can start and appear to work while pointing at nothing real.

**Fix — fail fast on missing config:**

```typescript
// apps/mobile/lib/config.ts

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${key}. ` +
      `Check your .env file and app.config.js.`
    );
  }
  return value;
}

export const config = {
  apiUrl: requireEnv('EXPO_PUBLIC_API_URL'),
  socketUrl: requireEnv('EXPO_PUBLIC_SOCKET_URL'),
  firebase: {
    apiKey: requireEnv('EXPO_PUBLIC_FIREBASE_API_KEY'),
    projectId: requireEnv('EXPO_PUBLIC_FIREBASE_PROJECT_ID'),
    appId: requireEnv('EXPO_PUBLIC_FIREBASE_APP_ID'),
  },
  expo: {
    projectId: requireEnv('EXPO_PUBLIC_PROJECT_ID'),
  },
};
```

Create `apps/mobile/.env.example` with all required keys documented. Add `apps/mobile/.env` to `.gitignore` (it should already be there, but verify).

---

### Finding 13 — Shared Package Resolution Is Inconsistent

**The audit found:**
Mobile resolves `packages/shared` from source. Backend and admin resolve from `dist`. This means:
- Mobile can see type-level changes immediately
- Backend/admin can be stale after shared changes if `dist` hasn't been rebuilt
- Type errors can exist in one app but not another for the same change

**Fix — standardize on one strategy:**

For a monorepo with a proper build pipeline, resolve from `dist` everywhere and add a shared rebuild as a prerequisite:

```json
// turbo.json
{
  "pipeline": {
    "build": {
      "dependsOn": ["^build"]
    },
    "type-check": {
      "dependsOn": ["^build"]
    }
  }
}
```

This forces `packages/shared` to be built before any app that depends on it is type-checked or built.

If you want to keep hot-reload during development (source resolution for mobile), use path aliases only in development tsconfig and keep production tsconfig pointing to `dist`:

```json
// apps/mobile/tsconfig.json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "paths": {
      "@packages/shared": ["../../packages/shared/src/index.ts"]
    }
  }
}
```

```json
// apps/mobile/tsconfig.build.json (used in CI)
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "paths": {
      "@packages/shared": ["../../packages/shared/dist/index.d.ts"]
    }
  }
}
```

---

### Finding 14 — CI Does Not Validate Mobile

**The audit found:**
The root `build` depends on package `build` tasks. Mobile doesn't expose a standard `build` task. CI can report all-green while mobile is broken.

**Fix — add mobile to CI explicitly:**

```json
// turbo.json
{
  "pipeline": {
    "mobile#type-check": {
      "dependsOn": ["shared#build"],
      "outputs": []
    }
  }
}
```

```yaml
# .github/workflows/ci.yml — add a mobile validation job
- name: Mobile type-check
  run: pnpm --filter mobile type-check

- name: Mobile lint
  run: pnpm --filter mobile lint
```

This does not run an Expo build on every PR (that's slow). It does verify that mobile's types are clean, which is the minimum acceptable gate.

---

## Phase 4 — Add Quality Gates

### Test Coverage You Need Before Any Feature Work

These are not nice-to-haves. They are the safety net that prevents the same drift from happening again.

**1. Auth bootstrap test**

```typescript
// apps/mobile/__tests__/auth-bootstrap.test.ts
describe('auth bootstrap', () => {
  it('marks session as unverified (not synced) when API call fails with network error', async () => {
    mockApiClient.get.mockRejectedValue(new NetworkError());
    await bootstrapAuth();
    expect(getAuthState().status).toBe('unverified'); // NOT 'authenticated'
  });

  it('clears token and sets unauthenticated on 401', async () => {
    mockApiClient.get.mockRejectedValue({ response: { status: 401 } });
    await bootstrapAuth();
    expect(getAuthState().status).toBe('unauthenticated');
    expect(await getStoredToken()).toBeNull();
  });
});
```

**2. Offline check-in replay test**

```typescript
// apps/mobile/__tests__/checkin-queue.test.ts
describe('offline check-in replay', () => {
  it('sends idempotency key in the header, not the body', async () => {
    await enqueueCheckin('trip-123');
    await replayPendingCheckins();

    const call = mockApiClient.post.mock.calls[0];
    const body = call[1];
    const headers = call[2].headers;

    expect(body).not.toHaveProperty('idempotencyKey');
    expect(headers['Idempotency-Key']).toBeTruthy();
  });

  it('marks checkin as replayed on 409 (already processed)', async () => {
    mockApiClient.post.mockRejectedValue({ response: { status: 409 } });
    await enqueueCheckin('trip-123');
    await replayPendingCheckins();

    const pending = await getPendingCheckins();
    expect(pending).toHaveLength(0);
  });
});
```

**3. WebSocket event parity test**

```typescript
// packages/shared/__tests__/socket-events.test.ts

// Import the actual event name constants from both sides
import { BACKEND_EMITTED_EVENTS } from '@/apps/backend/src/websocket/events';
import { ADMIN_SUBSCRIBED_EVENTS } from '@/apps/admin/src/hooks/socket-events';
import { MOBILE_SUBSCRIBED_EVENTS } from '@/apps/mobile/lib/socket-events';

describe('socket event parity', () => {
  it('admin subscribes to all events the backend emits for admin rooms', () => {
    for (const event of BACKEND_EMITTED_EVENTS.admin) {
      expect(ADMIN_SUBSCRIBED_EVENTS).toContain(event);
    }
  });

  it('mobile subscribes to all events the backend emits for mobile rooms', () => {
    for (const event of BACKEND_EMITTED_EVENTS.mobile) {
      expect(MOBILE_SUBSCRIBED_EVENTS).toContain(event);
    }
  });
});
```

This test cannot be written if your event names are scattered as inline strings. Before writing this test, extract all socket event names to constants in `packages/shared/src/events.ts`.

**4. Student home rendering test**

```typescript
// apps/mobile/__tests__/student-home.test.tsx
describe('student home screen', () => {
  it('renders the check-in button when trip is active and canCheckIn is true', async () => {
    mockUseStudentHome.mockReturnValue({
      data: buildStudentHomeFixture({ status: 'trip_active', canCheckIn: true }),
      isLoading: false,
      isError: false,
    });

    const { getByTestId } = render(<StudentHomeScreen />);
    expect(getByTestId('check-in-button')).toBeTruthy();
  });

  it('does not render check-in button when already checked in', async () => {
    mockUseStudentHome.mockReturnValue({
      data: buildStudentHomeFixture({ status: 'checked_in' }),
      isLoading: false,
      isError: false,
    });

    const { queryByTestId } = render(<StudentHomeScreen />);
    expect(queryByTestId('check-in-button')).toBeNull();
  });
});
```

---

## Security Notes

### Finding 8 — Socket Room Authorization Is Too Permissive

**What the audit found:**
After a valid auth handshake, any authenticated client can join any room by supplying a room ID. There is no resource-level authorization — a student could join a room for a trip they are not assigned to.

**The fix:**

```typescript
// apps/backend/src/websocket/socket.ts

socket.on('join:trip', async (tripId: string) => {
  const user = socket.data.user;

  // Verify the user is actually authorized for this trip
  const authorized = await tripsService.isUserAuthorizedForTrip(user.id, tripId);
  if (!authorized) {
    socket.emit('error', { code: 'UNAUTHORIZED_ROOM' });
    return;
  }

  socket.join(`trip:${tripId}`);
});
```

Apply the same pattern for `bus` and `route` rooms. This is especially important if you eventually add staff mobile access — staff should only see their assigned routes.

### Finding 15 — Admin MFA Bypass Is Still Open

This is outside the mobile scope but it is the control plane for your mobile users. The admin bypass allows anyone with a valid admin password to skip MFA. Until this is removed, your admin panel does not meet the bar for managing a student transport system. Address it in the admin panel hardening pass.

---

## Execution Checklist

Use this as your PR review gate. Each item must be ✅ before merging the phase.

### Phase 0
- [ ] `pnpm --filter mobile type-check` exits 0
- [ ] `TripScreenState` is defined in one place only
- [ ] `index.tsx` only branches on status values that exist in `TripScreenState`
- [ ] `useStudentHome` hook signature matches its usage
- [ ] No `as any` casts introduced to paper over type errors

### Phase 1
- [ ] Push token strategy decision made and documented
- [ ] Mobile registers the correct token type for the chosen strategy
- [ ] Offline check-in sends `Idempotency-Key` in the HTTP header
- [ ] Check-in queue `init()` is called on app cold start
- [ ] Admin list envelope aligned with backend response shape
- [ ] Admin subscribes to `gps:position` and `incident:escalated`

### Phase 2
- [ ] Auth bootstrap does not mark session synced on network errors
- [ ] Socket auth token refreshes on login/logout
- [ ] Socket is fully reset on logout (no stale listeners)
- [ ] Delegation either removed or fully routed (no half-implementation)
- [ ] Role enum normalized in shared, cascade verified in all apps

### Phase 3
- [ ] All mobile runtime deps declared in `apps/mobile/package.json`
- [ ] Expo config has no placeholder values
- [ ] App fails fast on missing env vars (no silent fallback to LAN IP)
- [ ] Shared package resolution strategy is consistent across apps
- [ ] CI validates mobile type-check in every PR pipeline

### Phase 4
- [ ] Auth bootstrap tests written and passing
- [ ] Offline replay idempotency tests written and passing
- [ ] Socket event parity test written and passing
- [ ] Student home rendering tests for at least 3 `TripScreenState` variants

---

## What You Should Not Do

These are the traps to avoid during stabilization:

**Do not add new screens before Phase 0 is complete.** Every screen you add while the home flow is broken inherits the broken theme tokens and query patterns.

**Do not use `as any` to pass type-check.** That is not passing type-check; that is disabling it. Any `as any` in the Phase 0 fix is a red flag that you found a contract inconsistency you haven't resolved yet.

**Do not put the push token fix in the backlog.** It looks like infrastructure work but it is currently causing silent data loss in your most important operational workflows.

**Do not start the delegation feature while it is in a half-state.** Either it belongs in mobile with full routing and backend support, or it does not. Leaving it half-implemented means it will confuse every engineer who touches that code going forward.

**Do not treat passing CI as proof that mobile is healthy.** Until Finding 14 is fixed, CI does not check mobile. A green build badge means backend and admin are healthy; it says nothing about mobile.

---

*End of stabilization guide. All findings reference the full system audit dated 2026-04-13.*
