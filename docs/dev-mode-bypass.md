# Dev Mode Bypass — Documentation

This document describes the dev-only authentication bypass implemented for local development without Firebase/backend dependencies.

## ⚠️ Security Warning

The changes below intentionally bypass authentication and security controls. **MUST be reverted before production build.**

---

## What Was Added

### 1. `apps/mobile/app/(auth)/dev-bypass.tsx` (NEW FILE)

A screen that lets you select Student or Driver role with mock data.

**To remove for production:**
- Delete this file
- Remove from `apps/mobile/app/(auth)/_layout.tsx` (Stack.Screen line)

### 2. `apps/mobile/app/_layout.tsx` (MODIFIED)

**Change A — Skip profile fetch in dev mode** (lines ~63-72):
```typescript
// DEV MODE: Skip profile fetch, trust the user set via dev-bypass
// Also guard: if we have a dev_token_*, bypass the profile fetch even if user is still being set
if (__DEV__ && token && token.startsWith('dev_token_')) {
  syncedTokenRef.current = token;
  setIsProfileSyncing(false);
  if (user) {
    setPhase('authenticated');
  }
  return;
}
```

**Change B — Guard against auth screen navigation** (lines ~153-169):
```typescript
// DEV MODE: Guard against navigating to auth screens when we have a dev session
useEffect(() => {
  if (!__DEV__ || !isLoaded) return;
  if (!user && token?.startsWith('dev_token_')) {
    return;
  }
  if (user && token?.startsWith('dev_token_')) {
    const currentPath = segments.join('/');
    if (currentPath === 'login' || currentPath === 'verify-otp' || currentPath === 'pending') {
      if (user.role === 'DRIVER') {
        router.replace('/(driver)/');
      } else if (user.role === 'STUDENT' && user.routeAssignment) {
        router.replace('/(student)/');
      }
    }
  }
}, [user, token, isLoaded, segments, router]);
```

---

## How to Revert for Production

### Option A: Find and remove all `__DEV__` blocks (Recommended)

Search for `__DEV__` in these files and remove the dev-specific blocks:

```bash
# Find all __DEV__ occurrences in mobile app
grep -rn "__DEV__" apps/mobile/
```

Expected locations to clean up:
1. `apps/mobile/app/_layout.tsx` — Remove the two useEffect blocks marked "DEV MODE"
2. `apps/mobile/app/(auth)/_layout.tsx` — Remove `<Stack.Screen name="dev-bypass" ... />`
3. `apps/mobile/app/(auth)/dev-bypass.tsx` — Delete entire file
4. `apps/mobile/app/(auth)/dev-bypass.tsx` — Remove from Stack in `_layout.tsx`

### Option B: Use git to revert

```bash
git checkout HEAD -- apps/mobile/app/_layout.tsx
git checkout HEAD -- apps/mobile/app/\(auth\)/_layout.tsx
# Then manually add back the dev-bypass.tsx file if needed later
```

### Option C: Conditional compilation (Alternative approach)

Instead of removing code, wrap dev-only screens in a build flag. This keeps the bypass available for future dev sessions:

```typescript
// In _layout.tsx, change the conditional from:
// if (segments[1] !== 'dev-bypass')
// To:
if (__DEV__ && segments[1] !== 'dev-bypass')
```

---

## What Still Needs Firebase (Even in Dev)

Even with this bypass, these still require Firebase config:
- Push notifications setup (`lib/notifications.ts`)
- Real-time database features (`lib/firebase.ts`)
- Phone OTP verification (`lib/phone-auth.ts`)

The warning `"Firebase app not initialized and config missing"` will appear in logs but is non-blocking.

---

## Testing the Bypass

1. Run `pnpm start` in `apps/mobile`
2. App opens at dev-bypass screen
3. Click "Student" or "Driver"
4. Should redirect to respective home screen
5. All features work with mock data