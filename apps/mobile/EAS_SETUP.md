# EAS Setup

This app already has EAS build profiles. The remaining setup is linking it to your Expo account and supplying the project-specific values.

## 1. Create the mobile env file

Copy [`.env.example`](./.env.example) to `.env` inside `apps/mobile` and fill in:

- `EXPO_OWNER`
- `EXPO_PUBLIC_PROJECT_ID`
- `EXPO_PUBLIC_API_URL`
- Firebase `EXPO_PUBLIC_*` values used by the app

`EXPO_PUBLIC_PROJECT_ID` is the EAS project ID, not the Firebase project ID.

## 2. Log in and link the Expo project

From the repo root:

```powershell
pnpm.cmd --filter mobile run eas:whoami
pnpm.cmd --filter mobile exec eas login
pnpm.cmd --filter mobile run eas:init
```

`eas project:init` / `eas init` will create or link the Expo project. After that, copy the real project ID into `apps/mobile/.env` as `EXPO_PUBLIC_PROJECT_ID` if it is not already there.

## 3. Verify the resolved Expo config

```powershell
pnpm.cmd --filter mobile run config:public
```

Check that the output shows:

- the correct `owner`
- `updates.url` pointing to `https://u.expo.dev/<your-project-id>`
- `extra.eas.projectId` with the same ID

## 4. Build

```powershell
pnpm.cmd --filter mobile run build:dev
pnpm.cmd --filter mobile run build:preview
pnpm.cmd --filter mobile run build:prod
```

Profiles:

- `development`: internal dev client build on channel `development`
- `preview`: internal APK / TestFlight-style preview build on channel `preview`
- `production`: store build on channel `production`

## 5. Android submit

For Play Store submission, place the service account key at:

```text
apps/mobile/google-play-key.json
```

That file is gitignored. Then run:

```powershell
pnpm.cmd --filter mobile run submit:android
```

## Notes

- `app.config.ts` now drives Expo config. The old placeholder `app.json` has been removed.
- OTA updates are disabled until `EXPO_PUBLIC_PROJECT_ID` is set, which avoids publishing builds against a fake Expo URL.
- `EXPO_PUBLIC_PROJECT_ID` is for EAS project linkage and update wiring. It is not a substitute for native FCM token setup.
