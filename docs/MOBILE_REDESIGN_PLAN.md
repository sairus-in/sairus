# Mobile Redesign — Master Plan

**Status:** In progress. Phase 0 + Phase 1 land in the initialization commit.
**Scope:** `apps/mobile` only. `apps/admin`, `apps/backend`, `packages/shared` are untouched.
**Rollout:** Screen-by-screen behind `EXPO_PUBLIC_NEW_HOME` env flag, then per-surface flags as we expand.

---

## 1. Why

The mobile app is a university utility used by thousands of students every day. The old design was operational/utilitarian (`#2C2520` brown surface, `#F5F0E8` cream text, indigo brand). The new direction is identity-forward: atmospheric blues, layered starburst pattern, expressive numeric typography, warm coral accents. The brand IS the design now.

Admin keeps its operational language because admin users are power users in a different mode.

## 2. Visual direction (one-liner per pillar)

- **Surface** — Atmospheric blue canvas with a static layered starburst pattern. Cards float on top in clean white or dark gloss.
- **Type** — Inter for everything default. Morne for the ETA hero block ("124mins / To your location") only. Bahnschrift for big numeric displays (`90%`, `10`, `9`). Ubuntu Mono for codes (`TN-21-CM-2026`).
- **Color** — Primary blues from `#356C8F` → `#67C0F9`. Warm coral `#FF9274` is the single attention accent. Greens for confirmation only.
- **Motion** — Static starfield. Card entrances stagger fade-up. Numeric ticks spring. No layout-property animation, no bounce, no glassmorphism.

## 3. Foundation (Phase 0 — this commit)

| Artifact | Purpose |
|---|---|
| `PRODUCT.md` (rewrite) | New playful university utility positioning |
| `DESIGN.md` (new) | Full design system: palette, gradients, type, motion, primitives |
| `apps/mobile/constants/brand.ts` | All design tokens — single source of truth |
| `apps/mobile/constants/typography.ts` | Font families, weights, type ramps |
| `apps/mobile/assets/fonts/README.md` | User-supplied font drop instructions |
| `apps/mobile/components/v2/StarBurst.tsx` | The three-layered star primitive |
| `apps/mobile/components/v2/AtmosphericBackground.tsx` | Full-screen blue canvas + starburst composition |
| `apps/mobile/components/v2/GradientText.tsx` | SVG-backed gradient text primitive |
| `apps/mobile/components/v2/GlossCard.tsx` | Dark gloss card with diagonal gradient + inner glow |

These primitives are reused across every screen we redesign.

## 4. Screen-by-screen rollout

Each phase is its own PR. Each screen swaps under a flag, legacy version kept side-by-side for one cycle.

### Phase 1 — Student Home (this commit)
- `apps/mobile/app/(student)/index.tsx` — full rebuild
- New components: `HomeHeader`, `TripCard`, `WaitNotifyPill`, `AttendanceGlossCard`, `HomeTabBar`
- Old file preserved as `index.legacy.tsx`
- Flag: `EXPO_PUBLIC_NEW_HOME`

### Phase 2 — Student secondary surfaces
- `(student)/map.tsx` — full-bleed white map, blue circular back, light-blue `BUS NO` pill, draggable `@gorhom/bottom-sheet` (3 snap points: peek `12%` shows only `Xmin (Ykm) | Checkin ✓`; mid `42%` reveals your-stop card; expanded `88%` reveals quick actions, route timeline, trip messages). No legacy file kept — project not yet public, no flag plumbing.
- `(student)/history.tsx` — attendance log with gloss cards per week
- `(student)/profile.tsx` — identity card + settings list
- `(student)/notifications.tsx` — notification stream with timestamps

#### Map architecture (Phase 2)
- **Live position source:** Firebase RTDB at `/buses/{busId}` (see `API_CONTRACT_MATRIX.md` → Firebase RTDB live state).
- **Smooth motion between pings:** `hooks/useAnimatedBusPosition.ts` projects forward 4.5s using current speed/heading; `withTiming(linear)` interpolates Reanimated shared values; `components/student/v2/BusMarker.tsx` bridges to native via `useAnimatedReaction` + `markerRef.setNativeProps({ coordinate })` so the marker moves without React re-renders.
- **Camera:** `hooks/useMapCamera.ts` — gesture pan suspends follow; recenter FAB resumes; inner-viewport ratio 0.3 triggers passive recenter when bus drifts off-screen.
- **Poster cache:** `lib/map-poster-cache.ts` saves a snapshot on unmount for instant re-entry.
- **Pre-warm:** hidden `MapView` mounted on home (`app/(student)/index.tsx`) when a trip is active/upcoming, so the dedicated map screen loads tiles instantly.
- **Mini-map preview:** `components/student/v2/TripCard.tsx` mapPreview slot renders a non-interactive `MapView` (liteMode) with a bus pin when live position is available; falls back to `MAP` text when no bus location is in cache.

### Phase 3 — Student transactional surfaces
- `(student)/scanner.tsx` — QR scanner with brand overlay
- `(student)/checkin-success.tsx` / `checkin-fail.tsx` — confirmation screens
- `(student)/verify-arrival.tsx` — arrival verification flow
- `(student)/self-report-prompt.tsx` — absence self-report
- `(student)/correction/[logId].tsx` — correction request

### Phase 4 — Auth + onboarding
- `(auth)/login.tsx` — phone entry with star-field hero
- `(auth)/verify-otp.tsx` — OTP entry
- `(auth)/pending.tsx` — unassigned student state

### Phase 5 — Driver surfaces (separate visual language sub-track)
Drivers operate the kiosk — high-stakes, glanceable, less playful. The atmospheric background drops for an op-focused dark surface. Driver redesign happens last so we can validate the brand approach with students first.

- `(driver)/index.tsx` — today's trip dashboard
- `(driver)/kiosk.tsx` — locked QR display (most critical)
- `(driver)/route-preview.tsx`, `summary.tsx`, `messages.tsx`, `breakdown.tsx`, `post-breakdown.tsx`

## 5. Migration safety rules

1. **No data layer changes.** Hooks, services, schemas, backend, sockets stay as-is. Each redesigned screen reads from the same source.
2. **Side-by-side files.** Old screen renamed to `*.legacy.tsx`. New screen is the default. Flag swaps between them.
3. **No edits to `apps/mobile/constants/theme.ts`.** It still backs unredesigned screens. Once every screen has migrated, we delete it in a cleanup PR.
4. **Type-check is the gate.** `pnpm --filter mobile type-check` must pass before each PR.
5. **No new packages without an explicit decision.** Phase 0 adds `expo-linear-gradient`, `@expo-google-fonts/inter`, `@expo-google-fonts/ubuntu-mono`. Nothing else without justification.
6. **Reduced-motion respected.** Every animation honors `useReducedMotion()`.

## 6. Definition of done (per screen)

- All visual states accounted for in the screen (loading, empty, error, offline, primary, success).
- Reads from existing hooks; no inline `api.client` calls.
- TypeScript strict, no `any`, props typed.
- Manual device check on iOS notch + Android with gesture nav.
- No layout-property animations.
- Passes type-check.
- Legacy file removed in cleanup PR after one release cycle.

## 7. Open items the user owns

- Drop `Morne.ttf` into `apps/mobile/assets/fonts/Morne.ttf` (used only by the ETA block).
- Drop `Bahnschrift.ttf` into `apps/mobile/assets/fonts/Bahnschrift.ttf` (used by big stat numbers). Confirm licensing for redistribution; Bahnschrift is Microsoft-licensed and shipping it in an Expo bundle for public distribution requires a license check.
- Decide on app icon refresh + splash screen refresh — both follow the same blue+star direction. Tracked as a separate ticket.

## 8. What this plan does NOT cover

- App icon / splash screen redesign (separate ticket)
- Admin panel redesign (out of scope — admin stays operational)
- New features or screens not currently in the route tree
- Backend changes to expose leave / OD counters (currently `StudentHomeHistory` exposes `presentCount`, `absentCount`, `percentage`, `pendingCorrections` only; `leaveRemaining` and `odLeft` in the design will render as `—` until a backend extension is scheduled)
