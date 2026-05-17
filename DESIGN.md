# Design System — Mobile

The mobile app's visual language. Admin has its own. This document is the source of truth for tokens, type, motion, and component primitives.

The canonical implementation lives in `apps/mobile/constants/brand.ts` and `apps/mobile/constants/typography.ts`. This file describes the system; the code enforces it.

---

## 1. Identity at a glance

- **Surface** — atmospheric blue canvas with static layered starburst pattern
- **Card style** — high-contrast white cards floating on the canvas, plus one dark-gloss card for personal stats
- **Type** — Inter default, Morne for the ETA hero, Bahnschrift for big numbers, Ubuntu Mono for codes
- **Color** — blues (`#356C8F` → `#67C0F9`), warm coral `#FF9274` as single accent, greens for confirmation only
- **Motion** — static stars, fade-up entrances, spring on numeric changes

## 2. Color tokens

All values are hex (React Native StyleSheet doesn't accept OKLCH; SVG attributes don't either). Neutral tints are intentionally warm (`#F3EFE6` cream) rather than blue-tinted, because warm cream against cool blue is part of the visual identity.

### Primary blues

| Token | Hex | Role |
|---|---|---|
| `brand.blue.50` | `#BFE6FF` | Atmospheric highlight, soft surfaces |
| `brand.blue.100` | `#A8DDFF` | |
| `brand.blue.200` | `#85C7F2` | Star outer ring |
| `brand.blue.300` | `#76BFEF` | Star mid ring |
| `brand.blue.400` | `#67C0F9` | Star inner mid, link text |
| `brand.blue.500` | `#5CB5EF` | |
| `brand.blue.600` | `#4D95C3` | App canvas base, primary brand |
| `brand.blue.700` | `#356C8F` | Active states, deep brand |
| `brand.blue.800` | `#225373` | |
| `brand.blue.900` | `#103E5B` | Deepest brand text |

### Deep / secondary

| Token | Hex |
|---|---|
| `brand.deep.500` | `#327DAD` |
| `brand.deep.600` | `#3E7AA1` |
| `brand.deep.700` | `#115E8F` |
| `brand.deep.800` | `#1B435C` |

### Neutrals

| Token | Hex | Role |
|---|---|---|
| `brand.neutral.0` | `#FFFFFF` | Card background |
| `brand.neutral.50` | `#F8F8F8` | Subtle elevation |
| `brand.neutral.100` | `#F3EFE6` | Map placeholder, warm cream surfaces |
| `brand.neutral.200` | `#EFEFE7` | |
| `brand.neutral.300` | `#E9E9E9` | Dividers |
| `brand.neutral.400` | `#D9D9D9` | |
| `brand.neutral.500` | `#C9C9C9` | Borders |
| `brand.neutral.600` | `#ADADAD` | Muted text on white |

### Ink / text

| Token | Hex | Role |
|---|---|---|
| `brand.ink.900` | `#101010` | Primary text, "Hello" heading |
| `brand.ink.800` | `#2A2218` | Warm body text |
| `brand.ink.700` | `#424242` | |
| `brand.ink.600` | `#4E4E4E` | |
| `brand.ink.500` | `#565656` | Muted labels |
| `brand.ink.400` | `#5D5D5D` | |

### Semantic

| Token | Hex | Role |
|---|---|---|
| `brand.success.fg` | `#5A9268` | ON TIME pill text + dot |
| `brand.success.bg` | `#B1D1B7` | ON TIME pill background |
| `brand.accent.warm` | `#FF9274` | Notify CTA, action accent (the single coral) |
| `brand.accent.warmSoft` | `#FFB5A2` | Hover/pressed for accent |
| `brand.accent.warmTint` | `#F1CBC1` | Accent surface tint |

## 3. Gradients

### Dark Gloss (`brand.gradients.darkGloss`)

Used on the attendance stats card. Diagonal sweep, slight reflection.

```
linear-gradient(
  216deg,
  #000000 0%,
  #404040 46.4%,
  #535353 50.8%,
  #666666 55.3%,
  #4D4D4D 57.7%,
  #000000 97.7%
)
```

Implemented via `react-native-svg` `<LinearGradient>` over a clipped `<Rect>` because RN's StyleSheet doesn't support multi-stop gradients. A soft inner stroke with `feGaussianBlur` stdDeviation=5 gives the glossy edge glow.

### Soft Pastel (`brand.gradients.softPastel`)

Used for wordmark text like "SEC25IT291" / "SCHOOLDAYS".

```
linear-gradient(110deg, #FFFFFF 0%, #90A9E9 36%, #E0AEF9 64%, #999999 100%)
```

Implemented via SVG `<Text>` with a `<LinearGradient>` fill. RN doesn't have `background-clip: text`.

### App canvas (`brand.gradients.appCanvas`)

Used behind the starburst pattern for subtle depth.

```
linear-gradient(180deg, #5CB5EF 0%, #4D95C3 50%, #356C8F 100%)
```

## 4. Typography

| Family | File | Weights | Use |
|---|---|---|---|
| Inter | `@expo-google-fonts/inter` | 400, 500, 600, 700, 800 | Everything default — headings, body, labels, buttons |
| Morne | `apps/mobile/assets/fonts/Morne.ttf` (user-supplied) | Display | ONLY the ETA hero block: "124mins" + "To your location" |
| Bahnschrift | `apps/mobile/assets/fonts/Bahnschrift.ttf` (user-supplied) | Regular, SemiBold | Big numeric stats — "90%", "10", "9" |
| Ubuntu Mono | `@expo-google-fonts/ubuntu-mono` | 400, 700 | Codes — "TN-21-CM-2026", "SEC25IT291" |

### Type ramp

| Token | Size | Family | Weight | Use |
|---|---|---|---|---|
| `display.xl` | 44 | Inter | 800 | "Hello" greeting |
| `display.lg` | 32 | Inter | 700 | Section headers |
| `eta.hero` | 72 | Morne | Regular | "124" — ETA number |
| `eta.unit` | 24 | Morne | Regular | "mins" |
| `eta.label` | 14 | Morne | Regular | "To your location" |
| `stat.value` | 32 | Bahnschrift | SemiBold | "90%" |
| `code.md` | 13 | Ubuntu Mono | 700 | "TN-21-CM-2026" |
| `body.lg` | 18 | Inter | 500 | Sub-greeting (name) |
| `body.md` | 14 | Inter | 500 | Default body |
| `body.sm` | 13 | Inter | 500 | Card labels |
| `body.xs` | 11 | Inter | 600 | Pill labels, micro-labels |

Body line-length cap remains 65-75ch (irrelevant for the home screen; relevant when we redo notifications/history with longer text).

### Hierarchy ratio

Each step in the ramp is ≥1.25× the previous step at the relevant level. Display 44 → Body 18 (2.4×) is contrast-driven, not gradual.

## 5. Spacing

| Token | px |
|---|---|
| `space.micro` | 4 |
| `space.xs` | 8 |
| `space.sm` | 12 |
| `space.md` | 16 |
| `space.lg` | 20 |
| `space.xl` | 24 |
| `space.2xl` | 32 |
| `space.3xl` | 40 |
| `space.4xl` | 56 |

Rhythm rule: outer screen padding 20, card-internal padding 16, vertical gap between cards 12 or 20 (never uniform across the whole screen — vary deliberately).

## 6. Radii

| Token | px | Use |
|---|---|---|
| `radius.sm` | 12 | Pills inside cards |
| `radius.md` | 16 | Inner panels |
| `radius.lg` | 24 | Inner cards (map preview) |
| `radius.xl` | 32 | Outer cards (trip card) |
| `radius.2xl` | 38 | Attendance gloss card |
| `radius.pill` | 999 | Pills, CTAs, tab bar |

## 7. Elevation

The mobile design uses **subtle shadow**, not heavy blur. Cards float, they don't pop.

| Token | offset | radius | color |
|---|---|---|---|
| `elevation.card` | (0, 4) | 16 | rgba(16, 16, 16, 0.06) |
| `elevation.cardHover` | (0, 8) | 24 | rgba(16, 16, 16, 0.10) |
| `elevation.tabBar` | (0, -4) | 24 | rgba(16, 16, 16, 0.08) |
| `elevation.button` | (0, 6) | 14 | rgba(53, 108, 143, 0.30) |

## 8. Motion

| Animation | Spec |
|---|---|
| Card entrance | `FadeInDown` from Reanimated, 12px travel, 400ms, easing easeOutQuart, stagger 100ms |
| Numeric tick | `withSpring(value, { stiffness: 80, damping: 18 })` |
| Pressable scale | `scale: 0.94` on press, 120ms in / 200ms out, easeOutQuad |
| Center tab button | Same as pressable + haptic medium impact on press |
| Stars | **No motion** |
| Gloss sweep | Optional 8s loop, 1.2s sweep duration, easeInOutQuart — disabled under reduced motion |

**Never animated:** `width`, `height`, `top`, `left`, `padding`, `margin`, `fontSize`, `borderWidth`. Use `transform: scale/translate`, `opacity`, `clipPath`.

**Every motion respects `useReducedMotion()`** — when true, all card entrances skip the translate and play opacity-only at 0ms duration; numeric changes update without spring; gloss sweep is disabled.

## 9. Primitives

These are the reusable building blocks for every screen. Source: `apps/mobile/components/v2/`.

### `<AtmosphericBackground />`
Full-screen blue canvas with the layered starburst pattern composed in. Renders behind the screen's safe area. Static — no animation.

### `<StarBurst />`
The three-concentric-star primitive (`#BFE6FF` → `#76BFEF` → `#4D95C3`). Parameterized by size, rotation, and opacity for placement across the canvas.

### `<GradientText />`
SVG-text gradient primitive. Used for wordmark and identity labels with the soft pastel gradient.

### `<GlossCard />`
The dark gloss surface. Wraps children with the diagonal gradient + inner stroke glow. Used by `AttendanceGlossCard` and reusable for any future "personal stats" surfaces (driver kiosk summary, for example).

## 10. Anti-patterns (rejected in this system)

- Pure black `#000` on a colored background — use `brand.ink.900` (`#101010`)
- Glassmorphism / backdrop blur — not in this system
- Side-stripe colored borders on cards — full borders or no borders
- Gradient text via `background-clip: text` — RN has no equivalent; use SVG text
- Same padding everywhere — vary per zone
- Identical card grids with icon + heading + text — forbidden
- "Hero metric" template (big number + small label + supporting stats with a gradient accent) — exactly what we're not doing for the attendance card; the gloss card has its own dedicated treatment
- More than one accent color in the same screen — only coral
- Decorative motion that doesn't serve a state change — forbidden

## 11. Where to find what

| Thing | File |
|---|---|
| Color & gradient tokens | `apps/mobile/constants/brand.ts` |
| Type ramp + font families | `apps/mobile/constants/typography.ts` |
| Primitives | `apps/mobile/components/v2/*` |
| Student home components | `apps/mobile/components/student/v2/*` |
| Rollout plan | `docs/MOBILE_REDESIGN_PLAN.md` |
