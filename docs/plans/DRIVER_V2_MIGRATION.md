# Driver App — v2 Migration + Reliability Hardening

**Scope:** `apps/mobile/app/(driver)/*`, plus supporting components, hooks, store, and the GPS task.
**Phase:** This is the concrete spec for **Phase 5** of `docs/MOBILE_REDESIGN_PLAN.md`.
**Out of scope:** `apps/admin`, `apps/backend`, `packages/shared`. No data layer changes.
**Status:** Draft — awaiting approval before any code lands.

---

## 1. Why this exists

The user request was *"make the driver app match the student design system, and make it smoother, more reliable, and faster."* On audit:

- **Driver hasn't been migrated.** Every driver screen still ships a local `C = {...}` palette object using the legacy warm-earthy tokens (`#F5F0E8` / `#2C2520` / `#1A1A1C`). The same values are duplicated across **7 files**. No driver screen imports from `constants/brand.ts`.
- **The student app has already moved.** `(student)/index.tsx` and `(student)/map.tsx` consume `brand.blue.*`, `space`, `radius`, and the v2 primitive set in `components/v2/*` and `components/student/v2/*`. Nine v2 student components exist; **zero v2 driver components exist**.
- **`theme.ts` looks stale** because nothing consumes it for color anymore — the v2 source of truth is `brand.ts`. The repository's master plan (§5 rule 3) says don't touch `theme.ts`; let unredesigned screens point at it until cleanup.
- **The existing redesign plan (§Phase 5)** explicitly says drivers do **not** inherit the playful atmospheric+starburst student identity. Drivers get an *"op-focused dark surface"*.

Reliability + perf concerns surfaced during the audit are bundled here as a parallel sub-track so the visual PR stays reviewable.

---

## 2. Visual approach

### 2.1 What driver inherits from student

- Token sources: `brand`, `gradients`, `space`, `radius`, `elevation`, `pill` from `constants/brand.ts`.
- Type system: existing `typography` import stays (font family + weight + size scale).
- Composition primitives where reusable: `GlossCard` (kiosk only), `GradientText` (sparing — driver is utilitarian, not playful).

### 2.2 What driver does NOT inherit

- **No `AtmosphericBackground`.** Drivers need glanceable contrast in a moving cab; full-bleed gradient + starbursts compete with critical UI.
- **No `StarBurst` decorative pattern.** Same reason.
- **No expressive type heroes** (Morne / Bahnschrift gradient blocks). Drivers read numbers, not poems.

### 2.3 Driver visual language (proposed)

| Surface | Treatment | Token |
|---|---|---|
| Home, route-preview, summary, messages, breakdown, post-breakdown | Light canvas, dark blue ink, solid blue CTA | `brand.neutral[50]` bg, `brand.ink[800/900]` text, `brand.blue[700]` CTA |
| Assignment card (the dark "today's trip" card on home) | Dark navy with brand ramp, replaces warm `#2C2520` | `brand.deep[800]` bg, `brand.blue[50]` text |
| Kiosk | Stays dark for in-cab visibility. Switches from generic black to brand-aligned dark blue with optional `GlossCard` for the QR frame | `brand.ink[900]` bg, `brand.blue[700/800]` accent, optional `gradients.darkGloss` for QR card |
| Status pills | Use existing `pill.onTime` / `pill.scheduled` / `pill.gpsWeak` / `pill.completed` / `pill.noTrip` | from `brand.ts` |
| Late warning | Stays warm coral — already a brand accent | `brand.accent.warm` text on `brand.accent.warmTint` bg |
| Error banner | Semantic red (no brand token yet — keep existing `#991B1B/#FEE2E2` or add `brand.danger` if you want a token; recommend adding) | TBD — see §9 open question |

### 2.4 Token migration table (per-file)

Every driver screen has the same local palette shape. The replacement is mechanical:

| Local `C.*` key | Today | After |
|---|---|---|
| `bg` | `#F5F0E8` | `brand.neutral[50]` (`#F8F8F8`) |
| `ink` | `#1A1A1C` | `brand.ink[900]` (`#101010`) |
| `muted` | `#8A8A8F` | `brand.ink[500]` (`#565656`) |
| `ghost` | `#B5B5B8` | `brand.neutral[500]` (`#C9C9C9`) |
| `card` (dark card bg) | `#2C2520` | `brand.deep[800]` (`#1B435C`) |
| `cardText` | `#F5F0E8` | `brand.blue[50]` (`#BFE6FF`) |
| `cardMuted` | `rgba(245,240,232,0.55)` | `rgba(191,230,255,0.6)` |
| `cardSep` | `rgba(245,240,232,0.1)` | `rgba(191,230,255,0.12)` |
| `btnBg` | `#2C2520` | `brand.blue[700]` (`#356C8F`) |
| `btnText` | `#F5F0E8` | `brand.neutral[0]` (`#FFFFFF`) |
| `link` | `#2C2520` | `brand.blue[700]` |
| `lateBg` / `lateText` | `#FEF3C7` / `#78350F` | `brand.accent.warmTint` / `brand.accent.warm` |
| `errorBg` / `errorText` | `#FEE2E2` / `#991B1B` | keep, or new `brand.danger.*` (open question) |
| Spacing literals (`28`, `22`, `20`, `18`, `16`, `12`) | inline | `space.*` |
| Radius literals (`20`, `14`, `12`) | inline | `radius.*` |

---

## 3. Components to add — `components/driver/v2/`

| File | Replaces | Notes |
|---|---|---|
| `DriverHeader.tsx` | Identity block in `index.tsx` | Greeting + first name, optional avatar/initial |
| `AssignmentCard.tsx` | Dark "today's trip" card on home | Reuses `brand.deep[800]`; props: routeName, area, busNumber, scheduledTime, expectedCount, minutesLate, onPress |
| `StartTripButton.tsx` | The CTA on home | Brand blue, busy state, error state collapsed into it via prop |
| `RouteStopList.tsx` | Body of `route-preview.tsx` | Numbered stop badges using `brand.blue[700]` bg |
| `SummaryStatRow.tsx` | Summary metric rows | Boarded / absent / on-route / completed counts |
| `KioskShell.tsx` | Wrapper for `kiosk.tsx` | Dark surface + safe areas + brightness/keep-awake side effects extracted |
| `KioskQrFrame.tsx` | The big QR display | Wraps `QRCode` in a `GlossCard` for the brand look |
| `KioskBannerStack.tsx` | Admin messages + wait requests + GPS status banners | Bounded list (see §4.3) |
| `BreakdownOptionList.tsx` | Breakdown reason picker | Selectable rows with brand selected state |

All components: typed props, no `any`, no inline hex literals, use `useReducedMotion()` for any animation.

---

## 4. Reliability & performance sub-track

This is intentionally separate from the visual PR. Recommendation: ship visual first, reliability second, so each is independently reviewable.

### 4.1 GPS task — `apps/mobile/tasks/gps.task.ts`

| Today | Issue | Change |
|---|---|---|
| `notificationColor: '#1E3A8A'` | Wrong palette after migration | Use literal `brand.blue[700]` value (`#356C8F`) — task module can't import RN style modules safely, so duplicate the value with a `// keep in sync with brand.blue[700]` comment |
| Reads `GPS_CONTEXT_KEY` + `GPS_LAST_POS_KEY` from AsyncStorage **every tick** | Two async reads every 3 seconds | Cache `context` in a module-level `let` populated by `startGPSTask`, cleared by `stopGPSTask`. Cache `lastPosition` likewise in memory; AsyncStorage only persists on app death so writes still go through |
| Fixed `Accuracy.Balanced` + `timeInterval: 3000` + `distanceInterval: 5` | Battery burn when parked at a stop; under-samples at highway speed | Adaptive: if speed < 2 km/h for ≥30s, switch to `timeInterval: 10000` / `distanceInterval: 25`. If speed > 40 km/h, switch to `timeInterval: 2000` / `distanceInterval: 3`. Cap re-config rate at once per 30s. |
| No retry on failed `POST /v1/gps/ping` | A 30s LTE blip = 10 lost pings → backend marks bus GPS OFFLINE → driver gets `gps:status_update` banner | Bounded ring buffer (max 20 entries, 5-minute TTL). On next successful ping, drain queue oldest-first using `Promise.allSettled`; drop entries older than TTL. Server is idempotent on `(busId, tripId, timestamp)` per backend audit. Document the contract assumption. |
| `lastPosition` written before HTTP returns | Cosmetic — but on permanent network down we'd skip pings forever while the server thinks bus is offline | Only update `lastPosition` on **successful** POST; otherwise rely on the retry queue |
| Hardcoded delta threshold `5` | Same value at 5 km/h and 90 km/h | Use adaptive thresholds above |

**Scale check (300 buses, 3s interval):** ≈100 pings/sec to backend, well within the existing buffered repository. Adaptive sampling brings the parked-at-stop subset down to ≈30 buses × 1 ping / 10s = 3 pings/sec, freeing capacity.

### 4.2 Kiosk socket — `hooks/useKioskSocket.ts`

| Today | Issue | Change |
|---|---|---|
| `joinRooms()` is called once on mount **and** again inside `handleConnect` | Double-emit on connect | Remove the eager call. Rely on `connect` handler. If socket is already connected when effect mounts, fire `joinRooms` synchronously then. |
| 9 separate `bindSocketHandler` / `socket.off` pairs | Easy to forget cleanup; lots of identical boilerplate | Map-based registration: `const handlers = { 'qr:refresh': handleQrRefresh, ... }`; loop bind on mount, loop off on cleanup |
| No staleness guard on `lastToast` after reconnect | Brief reconnect after backgrounding can replay a stale `checkin:success` and show a misleading toast | Server emits include their own timestamp via socket.io ACK metadata or payload field. If not, add a client-side ignore window: ignore any inbound event with `receivedAt < lastSeenAt - 5000ms`. Confirm payload field availability with backend audit before relying on server timestamp. |
| `socket.connect()` called inside effect every mount | Reconnect storm at shift start (all 300 drivers come online together) | Trust the global socket instance from `getSocket()`; let `lib/socket.ts` own connect lifecycle. Configure `reconnectionDelayMin: 1000`, `reconnectionDelayMax: 8000`, `randomizationFactor: 0.5` once in the singleton so 300 simultaneous reconnects don't synchronize. |

### 4.3 Trip store — `apps/mobile/store/trip.store.ts`

| Today | Issue | Change |
|---|---|---|
| `addWaitRequest` and `addAdminMessage` push to unbounded arrays | A long shift with frequent admin messages grows memory & re-renders | Cap each at **50 entries**. New entries displace oldest. |
| `setBoardedCount` with `prev + 1` on every `checkin:success` | If socket replays a checkin during reconnect, count drifts upward | Server already sends authoritative counts elsewhere; on reconnect, refetch from `/v1/driver/today-assignment`. (Already partially handled by `useQuery` `refetchInterval` on home; need to confirm count surface on the trip detail endpoint.) Mark this as **needs backend confirmation** — see §9 open question. |

### 4.4 Render-perf sweep (low-risk wins)

- `KioskScreen` re-renders on every Zustand field change because each selector subscribes separately — fine for the current 8 fields but the new banner stack subscribes individually too. Use `useShallow` (Zustand v4) on the banner stack selector to coalesce.
- `route-preview.tsx` renders the stop list as a `ScrollView` mapping over stops. At 30+ stops on long routes this is fine but converts to `FlatList` with `keyExtractor` + `getItemLayout` for free virtualization headroom.
- Animated entry on home (`FadeInDown` with `.delay(150/200)`) already respects `useReducedMotion`. Keep.

---

## 5. Phasing

Three PRs. Each independently revertable. Each behind `EXPO_PUBLIC_NEW_DRIVER` flag (matches `EXPO_PUBLIC_NEW_HOME` pattern from the master plan).

| PR | Scope | Files touched |
|---|---|---|
| **PR-1 — Driver v2 visual** | Add `components/driver/v2/*`, migrate all 7 screens. Keep originals as `*.legacy.tsx`. Flag-gate. | `app/(driver)/*.tsx`, `app/(driver)/*.legacy.tsx`, `components/driver/v2/**`, `app.config.ts` (notification/splash blues) |
| **PR-2 — GPS reliability** | Module-level context cache, adaptive sampling, bounded retry queue. Keep schema identical. | `tasks/gps.task.ts`, `lib/persisted-cache.ts` (add queue key) |
| **PR-3 — Socket + store hardening** | `useKioskSocket` restructure, trip store bounds, socket singleton reconnect tuning. | `hooks/useKioskSocket.ts`, `store/trip.store.ts`, `lib/socket.ts` |

Estimate: PR-1 ~600-line diff, PR-2 ~120, PR-3 ~80. Each fits a normal review.

---

## 6. Definition of done (per PR)

Inherits from `MOBILE_REDESIGN_PLAN.md` §6 plus:

- `pnpm --filter mobile type-check` clean.
- `pnpm --filter mobile lint` clean.
- Manual smoke on iOS + Android: start trip → QR rotates → simulated check-in toast → end trip → summary screen. Done with location services both on and off.
- For PR-2: airplane mode for 60s mid-trip → re-enable → verify queue drained, no duplicate pings server-side.
- For PR-3: kill socket, backgroud app 90s, foreground → verify single rejoin emit, no stale toast.
- No new `console.log` left in shipping code.
- `EXPO_PUBLIC_NEW_DRIVER=0` cleanly renders legacy screens.

---

## 7. Non-goals

- Backend changes. GPS ping schema is unchanged; socket event names unchanged.
- Touching `apps/admin` or `packages/shared`.
- Modifying or deleting `constants/theme.ts` — the master plan owns that cleanup.
- Replacing the QR rotation contract / nonce flow.
- Redesigning `(auth)` screens (master plan Phase 4 owns those).
- Adding new driver features (e.g. mid-trip messaging UI, expanded delegation flow).

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Drivers report the new dark blue kiosk feels colder / less legible at night than the current near-black | Side-by-side flag means we can A/B before flipping default. Keep `brand.ink[900]` fallback ready. |
| Adaptive GPS sampling masks real coverage gaps (slows pings just before a stop incident) | Always log the chosen interval in the GPS task; surface to admin via existing `gps:status_update` socket event metadata — needs one backend field addition, defer to PR-4 if scope-creeping. For PR-2 keep the floor at 10s — that's still well under the 30s server-side offline threshold. |
| Socket retry-queue dedup depends on server idempotency on `(busId, tripId, timestamp)` | Confirm in `apps/backend/src/modules/gps/gps.service.ts` (audit says yes) before shipping PR-2. Block PR-2 on this. |
| Bounded admin-message array drops important late messages | 50 entries × frequency means ≥a few hours of headroom for normal traffic. Add a "messages truncated" indicator if cap is hit. |

---

## 9. Open questions for you

1. **Error semantic token.** Add `brand.danger.{fg,bg}` to `constants/brand.ts` now, or leave error states on existing `#991B1B`/`#FEE2E2` hexes? Recommend adding — costs nothing and unblocks consistent error states everywhere.
2. **Kiosk QR background.** Use `GlossCard` (matches student attendance card) or a flatter solid dark surface? `GlossCard` looks great in screenshots but is SVG-heavy — there's a perf cost on older Android phones some drivers use. Recommend solid `brand.ink[900]` with a thin `brand.blue[700]` ring; reserve `GlossCard` for the summary screen instead.
3. **PR sequencing.** Ship visual (PR-1) first while reliability simmers in review, or hold visual until GPS reliability lands so the new release is "all wins"? Recommend visual-first — it's the bigger user-facing change and reliability fixes ride a follow-up.
4. **`*.legacy.tsx` retention.** Master plan keeps legacy "for one release cycle." For driver, do you want that, or hard-cut to new since we'll be flag-gating anyway? Recommend keeping legacy — drivers are safety-critical and a rollback path is cheap insurance.
5. **`addBoardedCount` drift on reconnect.** I want to confirm whether the trip detail endpoint returns a canonical boarded count we can refetch on socket reconnect, or whether the only source is the running tally over `checkin:success` events. If the latter, the right fix is server-side idempotent count + a `trip:counts` snapshot emit, which is a backend change — out of scope here. I'll confirm before PR-3.

---

## 10. What I want from you before I start coding

Just answers to §9, or a redirect on §2.3 (visual treatment) if the proposed dark-blue direction isn't what you envisioned.

Once approved, I'll start with PR-1 (visual). I'll call the advisor once before committing to the component shape and once before declaring PR-1 done, per the project's review discipline.
