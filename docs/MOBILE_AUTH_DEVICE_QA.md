# Mobile Auth Device QA

Run this checklist on at least one physical Android device and one physical iPhone before calling mobile auth production-ready.

## Preconditions

- Firebase Phone Auth is enabled for the project.
- Native Firebase app config is present for the build being tested.
- Test accounts exist in the backend for the phone numbers below.
- Device build is a development build or production build, not Expo Go.

## OTP Cases

1. Valid registered phone:
   - Request OTP.
   - Enter correct code.
   - Confirm backend `/v1/auth/login` succeeds.
   - Confirm app routes to the correct post-login screen.

2. Wrong OTP:
   - Request OTP.
   - Enter an incorrect code.
   - Confirm UI shows the incorrect-code error and does not create a backend session.

3. Expired OTP:
   - Request OTP.
   - Wait for expiration.
   - Enter the old code.
   - Confirm UI shows the expired-code error.

4. Resend flow:
   - Request OTP.
   - Resend after the cooldown.
   - Confirm a new verification flow works and the old code no longer succeeds.

5. Unregistered phone:
   - Complete Firebase OTP verification with a number not provisioned in the backend.
   - Confirm backend rejects login and the UI shows the unregistered-number error.

## Session Cases

1. Relaunch after login:
   - Kill the app completely.
   - Reopen it.
   - Confirm persisted backend session bootstraps correctly through `/v1/auth/me`.

2. Logout:
   - Sign out from the profile screen.
   - Confirm backend logout is called.
   - Confirm local app session is cleared.
   - Confirm Firebase auth session is cleared.

3. Forced 401:
   - Expire or revoke the backend session.
   - Confirm the app clears local state and routes back to login.

## Routing Cases

1. Student with route assignment goes to `/(student)/`.
2. Student without route assignment goes to `/(auth)/pending`.
3. Driver goes to `/(driver)/`.

## Sign-off

- Android pass completed
- iOS pass completed
- Wrong-code handling confirmed
- Expired-code handling confirmed
- Unregistered-number handling confirmed
- Session restore confirmed
- Logout confirmed
