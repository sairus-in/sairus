# Bus Attendance App — Design System v2

> **The single source of truth for every visual, interaction, and behavioral decision in this app.**
> Designers execute from this. Developers reference this. Nobody invents anything outside of it.
>
> **What changed in v2:** The core philosophy from v1 is preserved. What's new: depth and material (Apple), confident motion and bold ETA presentation (Uber), and dense, learnable micro-interactions (Linear). Plus seven high-impact features the original spec didn't account for, woven into the existing flows rather than bolted on.

---

## 00. Design Philosophy — The Three Pulls

Every decision in this app is pulled in three directions at once. When in doubt, this hierarchy resolves the conflict:

**Apple-quiet** — Restraint, depth via material instead of decoration, calm typography, generous spacing. The app should feel premium even when nothing is happening.

**Uber-confident** — Bold motion, oversized hero numbers, decisive CTAs, instant feedback. The app should feel alive when something *is* happening.

**Linear-precise** — Tight density, keyboard/gesture shortcuts, micro-interactions that reward repeat use, predictable system states. The app should feel sharper the more you use it.

**Tiebreaker rule:** When two pulls conflict, choose the one that serves the *primary task on that screen*. The Map screen leans Uber. The History screen leans Linear. The Login screen leans Apple. Don't blend evenly — let each screen pick its dominant voice.

---

## 01. Product Identity

A **daily-use utility for students and drivers**, used in motion, under time pressure, sometimes in poor lighting. It must work in 2 seconds or it has failed.

The emotional contract:

- **Student:** "Tell me where my bus is, tell me if I'll make it, and let me check in. That's all."
- **Driver:** "Show me my job, count my passengers, get out of my way."
- **Parent (new in v2):** "Tell me my kid is safe, on the bus, and on the way home."

The design feels **calm, precise, and alive.** Not playful. Not corporate. Something between a premium transit app and a surgical instrument. Every element earns its place or it does not exist.

---

## 02. Visual Language

### Theme: Dark-first, with a true-black variant for OLED

**Standard dark** (default): Background `#F8F7F4`. Surface `#1565C0`. Elevated `#F1F0ED`. Layers stack via brightness, not shadow.

**True black** (OLED battery saver, auto-toggles in Profile → Display): Background `#F8F7F4`. Surface `#1565C0`. Elevated `#F1F0ED`. Borders bump up to `rgba(15,23,42,0.10)` so layering doesn't disappear on OLED.

There is no light mode. This app exists in motion, often outdoors at dawn or dusk, often in vehicles. Light mode would be hostile.

### Color System

| Role | Standard Dark | True Black | Usage |
|---|---|---|---|
| Background | `#F8F7F4` | `#F8F7F4` | Screen base |
| Surface | `#1565C0` | `#1565C0` | Cards, sheets |
| Elevated | `#F1F0ED` | `#F1F0ED` | Inputs, chips, kiosk QR card |
| Border subtle | `rgba(15,23,42,0.08)` | `rgba(15,23,42,0.10)` | Card outlines |
| Border active | `rgba(15,23,42,0.16)` | `rgba(15,23,42,0.20)` | Focused, hovered |
| Text primary | `#0F172A` | `#0F172A` | Headings, ETA, names |
| Text secondary | `#475569` | `#475569` | Labels, body meta |
| Text tertiary | `#94A3B8` | `#94A3B8` | Sub-meta |
| Text ghost | `#CBD5E1` | `#CBD5E1` | Placeholders, timestamps |
| Primary action | `#1565C0` | `#1565C0` | Scan, primary CTAs |

**Status colors — the only accent colors in the entire app:**

| Status | Background tint | Text / dot | Usage |
|---|---|---|---|
| On time | `rgba(74, 222, 128, 0.10)` | `#16A34A` | Bus is running on schedule |
| Arriving | `rgba(251, 191, 36, 0.10)` | `#D97706` | Bus < 3 min away |
| Delayed | `rgba(251, 146, 60, 0.10)` | `#EA580C` | Bus > 5 min behind schedule (new) |
| Missed | `rgba(248, 113, 113, 0.10)` | `#DC2626` | Bus has passed the stop |
| Warning | `rgba(251, 191, 36, 0.08)` | `#D97706` | System alerts, route changes |
| Info | `rgba(147, 197, 253, 0.10)` | `#2563EB` | Neutral notices |

**Hard rule:** Status colors appear *only* on status pills, alert cards, attendance values, and the contextual ETA glow (see Material Layer below). Nowhere else. The dark background makes them land hard without needing to shout.

### Material Layer (new in v2)

This is the Apple pull. We add three subtle material treatments, used sparingly:

**1. Glass surface** — Used only on the Map bottom sheet and the Scanner top/bottom overlays.
```
backdrop-filter: blur(24px) saturate(180%);
background: rgba(17, 17, 19, 0.72);
border-top: 1px solid rgba(255, 255, 255, 0.08);
```
Falls back to solid `#1565C0` on devices without backdrop-filter support.

**2. Contextual glow** — A 1px inner border on the main bus card that takes the status color at very low opacity. When status changes, the glow crossfades.
```
ON TIME:    box-shadow: inset 0 0 0 1px rgba(74, 222, 128, 0.10);
ARRIVING:   box-shadow: inset 0 0 0 1px rgba(251, 191, 36, 0.18);
DELAYED:    box-shadow: inset 0 0 0 1px rgba(251, 146, 60, 0.15);
MISSED:     box-shadow: inset 0 0 0 1px rgba(248, 113, 113, 0.12);
```
This replaces the v1 "card border lifts to amber when arriving" rule. Same idea, executed with more material discipline.

**3. Specular highlight on hero numbers** — The 56px ETA number gets a vertical linear gradient on its fill: `#0F172A` at top, `#D4D4D8` at bottom. Imperceptible at first glance, but the eye picks up the dimensionality. Number stays tabular and weight 500.

---

## 03. Typography System

The typeface is **Inter** (display variant for sizes ≥ 24px, regular for everything else). Inter Display has tighter spacing and refined letterforms at large sizes — this is a Linear/Vercel signature move and it elevates the hero numbers significantly.

Only three weights exist: **400, 500, 600.** Nothing below 400, nothing above 600.

### Type Scale

| Token | Size | Weight | Line height | Tracking | Usage |
|---|---|---|---|---|---|
| `display` | 56px | 500 | 0.95 | -0.04em | ETA number only |
| `title-xl` | 28px | 600 | 1.15 | -0.02em | Trip Summary "Boarded 42" hero |
| `title-lg` | 22px | 600 | 1.2 | -0.01em | Screen titles |
| `title-md` | 18px | 500 | 1.3 | -0.005em | Card headings |
| `title-sm` | 15px | 500 | 1.4 | 0 | Section labels |
| `body-lg` | 15px | 400 | 1.6 | 0 | Primary body text |
| `body-md` | 13px | 400 | 1.5 | 0 | Secondary body, list items |
| `label` | 11px | 500 | 1.3 | 0.05em | Pill labels |
| `caps` | 10px | 500 | 1.3 | 0.10em | Section labels ("NEXT STOP") |
| `caption` | 10px | 400 | 1.4 | 0 | Ghost text, timestamps |

### Typography Rules

- **ETA is always 56px, weight 500, tabular numerals, -0.04em tracking.** (Bumped from 52px → 56px and added negative tracking. The Uber pull. The number should be the loudest thing on the screen.)
- **Never center-align list content.** Lists are always left-aligned.
- **Caps labels** (`tracking: 0.10em`) are reserved for section labels like "NEXT STOP," "THIS WEEK," "TODAY'S ASSIGNMENT" — never general text.
- **The body of this app is 13px at weight 400.** Dense information sits comfortably without feeling cramped.
- **Tabular numerals** (`font-variant-numeric: tabular-nums`) on every number that updates — ETA, attendance %, boarded count, timestamps. Prevents jitter when digits change width.
- Minimum touch target for any interactive text: 44px tall.

---

## 04. Spacing and Layout

### Base unit: 4px

| Token | Value | Usage |
|---|---|---|
| `space-1` | 4px | Icon internal padding |
| `space-2` | 8px | Inline gaps, pill padding |
| `space-3` | 12px | Component internal gaps |
| `space-4` | 16px | Card internal padding |
| `space-5` | 20px | Screen edge margins |
| `space-6` | 24px | Between card groups |
| `space-8` | 32px | Section separators |
| `space-10` | 40px | Above hero number on Trip Summary |

### Screen edge margin: 20px on both sides. Always.

Cards never touch the screen edge. They sit 20px in from each side. This breathing room is what makes the dark background feel intentional, not empty.

### Corner Radius System

| Token | Value | Applied to |
|---|---|---|
| `radius-sm` | 8px | Pills, chips, small badges |
| `radius-md` | 12px | Inputs, small cards, buttons |
| `radius-lg` | 16px | Quick action chips, stat cards |
| `radius-xl` | 22px | Main bus card, bottom sheets |
| `radius-2xl` | 28px | Driver Kiosk QR card |
| `radius-full` | 9999px | Status pills, avatar, dots |

**Hard rule:** The main bus card is always `radius-xl` (bumped from 20px → 22px in v2). It is the most important card on the most important screen. It gets the softest corners to feel premium without being decorative.

---

## 05. Component Definitions

### StatusPill

```
Structure:     [pulsing dot] [LABEL TEXT]
Height:        24px
Padding:       4px 10px
Border radius: radius-full
Font:          11px, weight 500, tracking 0.05em
Dot size:      5px, border-radius 50%
Dot animation: ON TIME, ARRIVING, DELAYED → slow pulse (2s ease-in-out infinite)
               MISSED → static, no pulse (the bus is gone, don't keep pulsing)
State switch:  220ms crossfade, never a hard cut
```

### PrimaryButton

```
Used for:      Scan QR, Verify OTP, Start Trip, End Trip, Submit
Background:    #1565C0
Text color:    #F8F7F4
Height:        48px (bumped from 44px — Uber-scale CTAs)
Padding:       0 20px
Border radius: radius-md (12px)
Font:          14px, weight 500
Press state:   scale(0.97) + brightness(0.92), 120ms ease-out
Loading state: Text replaced by 16px spinner, button keeps width and height
Disabled:      Background rgba(15,23,42,0.12), text #52525B
```

### SecondaryButton

```
Used for:      Retry, Back, Resend OTP, Cancel
Background:    transparent
Border:        1px solid rgba(15,23,42,0.12)
Text color:    #475569
Height:        48px
Padding:       0 20px
Border radius: radius-md (12px)
Font:          14px, weight 400
Press state:   background rgba(255,255,255,0.04), border rgba(255,255,255,0.18)
```

### TertiaryButton (new in v2)

For low-emphasis actions like "Skip," "Maybe later," "Edit." Text-only with a generous touch target.

```
Background:    transparent
Text color:    #94A3B8
Height:        44px
Padding:       0 12px
Font:          13px, weight 500
Press state:   text color shifts to #0F172A
```

### Card (base)

```
Background:    #1565C0
Border:        1px solid rgba(15,23,42,0.08)
Border radius: radius-lg (16px) default, radius-xl (22px) for main bus card
Padding:       16px
```

### ETADisplay

```
Value:         2-digit number maximum (up to 99 min)
Font:          56px, weight 500, font-variant-numeric: tabular-nums, tracking -0.04em
Fill:          Linear gradient #0F172A → #D4D4D8 (vertical specular)
Animation:     Slot-machine roll — each digit rolls independently, top to bottom
               Easing: cubic-bezier(0.22, 1, 0.36, 1)
               Duration: 380ms per digit
               Stagger: tens digit leads by 70ms before ones digit
               Same value: no animation, skip silently
Below 1 min:   Replace digits with "Arriving" text at 22px weight 600, status color #D97706
0 min / "now": Replace with "At your stop" at 22px weight 600, color #16A34A
                + 1 light haptic when first appears
Stale (>30s no update): Number dims to #94A3B8 and a small ⚠ icon appears beside it
Unknown:       Show "—" with no animation
```

### BottomSheet (Map screen and elsewhere)

```
Snap points:   Three snaps instead of two (improvement over v1)
               Peek:     ~22% screen height — minimum useful info
               Default:  ~48% — ETA + bus card + next 3 stops
               Full:     ~88% — all stops + driver info + report issue
Trigger:       Tap to advance one snap up. Swipe to any snap.
               Drag handle is always grabbable.
Animation:     320ms cubic-bezier(0.32, 0.72, 0, 1)
Handle:        36px wide × 5px tall, radius-full, color rgba(255,255,255,0.18)
               Centered at top. Always visible.
Background:    Glass surface (see Material Layer)
Map response:  When sheet expands, map camera pulls back +1 zoom level for context.
               When sheet collapses, camera returns to bus-tracking zoom.
                Both: 320ms eased, runs in parallel with sheet motion.
```

### SegmentedControl (new in v2)

iOS-style segmented control for filter tabs (replaces the v1 underline tabs in History and elsewhere).

```
Container:     Background rgba(255,255,255,0.04), padding 3px, radius-md
Segment:       Padding 8px 14px, font 13px weight 500
Active:        Background #F1F0ED, text #0F172A, subtle 1px shadow
Inactive:      Text #94A3B8
Switch anim:   Active background slides between segments, 240ms cubic-bezier(0.32, 0.72, 0, 1)
```

### LiveIndicator (new in v2)

A small "● LIVE" badge that appears on any screen showing real-time data. Reinforces the "this is fresh" feeling.

```
Structure:     [pulsing red dot] LIVE
Dot:           5px, #DC2626, pulse 1.4s
Text:          10px, weight 600, tracking 0.10em, color #94A3B8
Padding:       0 8px, height 18px
```

---

## 06. Screen-by-Screen Specification

---

### AUTH FLOW

#### Screen: Login

**The user's first impression.** Apple-quiet pull dominates.

**Layout top to bottom:**

1. **App mark** — centered, 56×56px (bumped from 48 for first-impression presence), top third of screen
2. **Title** — "Enter your number" — 22px, weight 600, centered
3. **Subtitle** — "We'll send a verification code" — 13px, weight 400, color `#94A3B8`, centered
4. **Phone input** — full width with 20px edge margin, 56px tall (bumped from 52 for first-impression generosity), `radius-md`
   - Left side: country code selector (`+91`) in a 64px-wide zone divided by a 1px vertical rule at `rgba(15,23,42,0.10)`
   - Right side: number input, 16px, weight 400, tabular-nums
   - Focus state: border lifts to `rgba(255,255,255,0.20)` with a 200ms ease-out, no glow, no color
5. **Continue button** — full width, 48px tall, sits 16px below input, primary style
6. **Helper line** (new) — "By continuing, you agree to our Terms" — 11px `#CBD5E1`, 16px below button, links to Terms in `#94A3B8`

**Behavior:**
- Auto-focus number input on mount; keyboard opens immediately
- Button enables the moment phone reaches 10 digits (India default; country code switcher updates the validation)
- No login illustration, no hero image, no decorative background — the dark background IS the design

**Feels like:** Opening a secure tool, not signing up for a newsletter.

---

#### Screen: OTP Verify

**Apple pull, with a Linear touch on the auto-advance.**

**Layout top to bottom:**

1. **Back arrow** — top left, 44×44px touch target
2. **Title** — "Check your messages" — 22px, weight 600
3. **Subtitle** — "Code sent to +91 98765 43210" — 13px, `#94A3B8`. The number is tappable to "Edit number" (returns to Login with number pre-filled)
4. **OTP Input** — 6 individual slots, 44×56px each, evenly spaced with 8px gap
   - Active slot: border `rgba(255,255,255,0.22)`, background slightly elevated to `#161618`, with a 1px caret blinking inside
   - Filled slot: border `rgba(15,23,42,0.12)`, text `#0F172A`, 18px weight 500
   - Error state: border `#DC2626`, all slots shake horizontally (4px × 3 cycles, 280ms), then auto-clear
5. **Auto-fill row** (new) — "Tap to use 482917 from Messages" — appears as a system-style banner above the keyboard when an SMS code is detected. Tapping fills all 6 slots and auto-submits.
6. **Timer** — "Resend in 0:28" — 13px, `#94A3B8`, centered, monospace digits to prevent jitter. Counts down from 30s.
7. **Resend button** — appears after timer hits 0:00 in the same position. Tertiary style, `#0F172A`, weight 500.
8. **Verify button** — full width, primary, enabled only when all 6 slots filled

**Behavior:**
- Auto-advance focus to next slot on each digit
- Auto-submit the moment slot 6 is filled — user never taps Verify manually
- Backspace on empty slot moves focus back to previous slot
- Paste a 6-digit code into any slot → distributes across all 6 slots
- On error: slots clear, first slot focuses, shake plays, light haptic

**Feels like:** A clean vault door that opens the moment you finish the combination.

---

#### Screen: Pending Assignment

**v1 was a calm waiting room. v2 makes that wait actually informative.**

**Layout:**

1. Centered abstract illustration — geometric, calm, not a spinner
2. **Status text** — "Waiting for your route" — 18px, weight 500, centered
3. **Live progress strip** (new) — A 4-step timeline showing: ① Account created → ② Phone verified → ③ Awaiting admin assignment → ④ Ready to ride. Current step pulses, completed steps show a checkmark. Tracking + transparency.
4. Supporting copy — "Your bus assignment will appear here once confirmed by admin. This usually takes a few hours." — 13px, `#94A3B8`, centered, max-width 280px
5. **Contact admin** button (new) — secondary style, "Message admin" — opens a pre-filled support thread
6. **Retry** — tertiary style, "Check again"

**Behavior:**
- Polls silently every 15s in background
- When assignment arrives: cross-dissolve to Home with a brief success haptic
- Never feels like a dead end

**Feels like:** A status page, not an empty room.

---

### STUDENT FLOW

---

#### Screen: Student Home — *the most important screen in the app*

**Uber pull on the ETA hero. Apple pull on the card material. Linear pull on the dense secondary info.**

**Three questions to answer before the user finishes blinking:**
1. Where is my bus?
2. Am I going to make it?
3. What do I do next?

**Layout top to bottom:**

**1. Status Bar** — system standard, no custom styling

**2. Header** — 20px edge margins
- Left: greeting block
  - "GOOD MORNING" — 10px caps label, color `#CBD5E1`
  - "Arjun" — 18px, weight 600, color `#0F172A`
  - Greeting updates: GOOD MORNING < 12, GOOD AFTERNOON 12–17, GOOD EVENING 17+
- Right: avatar + LiveIndicator stacked
  - LiveIndicator above avatar (right-aligned), shows when bus is in motion
  - Avatar circle 38px, initials, 13px weight 500, background `#F1F0ED`, border `1px solid rgba(15,23,42,0.10)`
  - Notification dot: 8px green `#16A34A`, top-right of avatar, 2px `#F8F7F4` border ring, visible only on unread alerts

**3. Bus Status Card** — 20px edge margins, `radius-xl`, `#1565C0`, contextual glow per status

The card has three internal zones separated by `1px solid rgba(255,255,255,0.05)` dividers:

**Zone A — Status Bar (top of card)**
- Left: StatusPill
- Right: Bus number — "TN-01-AB-1234" — 12px, weight 500, color `#CBD5E1`
- Padding: 14px 16px

**Zone B — ETA Hero (middle of card)**
- "NEXT STOP" — 10px caps label, `#CBD5E1`
- Stop name — "Anna Nagar West" — 14px, weight 400, `#475569`, marginTop 4px
- ETA Display — 56px slot machine, specular gradient, tabular nums
- ETA unit — "min" — 18px, weight 400, `#CBD5E1`, baseline-aligned to digits
- **Confidence band** (new) — A thin 2px line beneath the ETA showing range:
  ```
  ▒▒▒▒▒▒█████████████▒▒▒▒▒▒
        7 min      12 min
  ```
  The solid block is the high-confidence ETA range; tinted segments are the wider possibility window based on traffic. Subtle, but tells the user "the ETA might wobble — here's how much."
- Meta line — "Last updated 12s ago · 1.2 km away" — 10px, `#27272A`
- Padding: 16px 16px 12px

**Zone C — Action Row (bottom of card)**
- Left: context text — "Board at Anna Nagar West" — 11px, `#CBD5E1`
- Right: PrimaryButton — "Scan QR" — 48px tall, 14×14 QR icon left of label
- Padding: 12px 16px

**Card behavior:**
- Status changes apply to contextual glow with 220ms crossfade
- When status is MISSED: glow goes red, Scan button disables and grays out, label changes to "Check-in closed" + a "Request correction" tertiary link appears below the card
- When status is DELAYED (new): glow goes orange, ETA confidence band widens visually, a small "Why?" link appears that opens a sheet with: traffic ahead, weather, or driver-reported delay reason

**4. Quick Actions Row** — 20px edge margins, 10px gap, marginTop 12px

Three chips (was two in v1, added "Notify Driver"):

| Chip | Icon | Label | Value | Action |
|---|---|---|---|---|
| 1 | Map pin | Live map | Track bus | Open Map |
| 2 | History | History | 18 days | Open History |
| 3 | Bell | Notify | Driver | New: see below |

Each chip:
- Background `#1565C0`, border `1px solid rgba(15,23,42,0.08)`, `radius-lg`
- Padding 12px 14px
- Icon in 28×28 box, `radius-md`, background `#F1F0ED`
- Two-line text: 11px label `#94A3B8` + 13px value weight 500 `#D4D4D8`

**Notify Driver** (new feature): Opens a sheet with three pre-set messages:
- "Running 2 min late, please wait"
- "I won't be on the bus today"
- "I'm at a different stop today" (opens a stop picker)

This eliminates 80% of "wait for me!" panics and reduces driver phone calls.

**5. Stats Row** — 20px edge margins, 10px gap, marginTop 10px

Two stat cards side by side:

Each card:
- Background `#0D0D0F`, border `1px solid rgba(255,255,255,0.05)`, `radius-lg`, padding 12px 14px
- Top: caps label `#CBD5E1`
- Middle: value 24px weight 500 (bumped from 22) `#0F172A`
- Bottom: sub-label 10px `#27272A`
- **Sparkline** (new): A 32×8px sparkline beneath the value showing the last 7 days. `#16A34A` for present, `#DC2626` for absent, `#CBD5E1` for non-school days. Visual at-a-glance pattern.
- Card 1: "ATTENDANCE" / "94%" / "This month" + sparkline
- Card 2: "THIS WEEK" / "4 / 5" / "Days present" + sparkline
- Attendance value color thresholds: ≥75% → `#0F172A`, 60–75% → `#D97706`, <60% → `#DC2626`
- Tappable — opens History filtered to current month

**6. Alert Card** — 20px edge margins, marginTop 10px — renders only when alerts exist

- Background `rgba(251,191,36,0.06)`, border `1px solid rgba(251,191,36,0.12)`, `radius-lg`
- Left: 6px amber dot, marginTop 5px, flex-shrink 0
- Right: alert text — 12px, `#475569`, line-height 1.5
- Type prefix in `#D97706` weight 500 — "Tomorrow:", "Notice:", "Alert:"
- Swipe right to dismiss (with spring-back if not far enough)
- Max 2 visible; if more, "2 more notices" in ghost text below
- Info alerts use blue dot and blue tint

**7. Bottom Navigation Bar**
- Background `#F8F7F4` with subtle blur `rgba(9,9,11,0.94)` + `backdrop-filter: blur(12px)`
- Top border `1px solid rgba(255,255,255,0.05)`
- 4 tabs: Home · Map · History · Profile
- Active tab: icon stroked `#0F172A`, label 10px `#0F172A`, 2px white indicator bar 24px wide above icon
- Inactive: icon `#CBD5E1`, label `#CBD5E1`
- **Tab change motion:** Indicator bar slides between tabs in 240ms cubic-bezier(0.32, 0.72, 0, 1) — Linear-precise micro-interaction

**Feels like:** Opening your phone at the bus stop and knowing in 1 second whether to run or walk.

---

#### Screen: Map

**Uber pull dominates here. The Map is a live radar.**

**Layout:**

**1. Full-screen map** — fills 100% behind everything

Map visual rules:
- Dark style — roads `#1C1C1E`, land `#141414`, water `#0A0A0F`, labels `#52525B`
- Minimum noise — no POI icons, no business labels
- Show only: bus marker, user marker, route polyline, stop dots

Map elements:
- **Route polyline** — `#D97706` at 35% opacity, 3px wide
- **Completed segment** — same line at 12% opacity (dimmer behind the bus)
- **Bus marker** — white rounded square 36×36px, small bus icon inside, drops a 40% opacity ghost behind it indicating direction of travel
- **User marker** — 12px white dot with a 24px pulsing ring (2s ease-out infinite, 0→1 opacity, 12px→28px)
- **Stop dots** — 6px white dots at 30% opacity along route; next stop at 60%

Bus marker movement:
- Smooth interpolation between GPS positions — never jumps
- Linear interpolation, duration = update interval (5s default)
- Stale GPS (>30s): marker stops, gains amber tint, tooltip "Signal weak"

**2. Top bar overlay** — sits on map, transparent
- Back arrow — top left, 44×44px target inside a 36px circle `rgba(0,0,0,0.60)` backdrop with `backdrop-filter: blur(20px)`
- LiveIndicator centered top
- **Recenter button** — top right, same 36px circle. Defaults to "fit bus + user." Long-press shows three options: "Bus only," "User only," "Bus + user."
- **Share trip button** (new) — top right next to recenter, same circle style. Generates a 2-hour live tracking link to share with parents/family. iOS/Android system share sheet.

**3. Bottom Sheet** — three snap points (Peek, Default, Full)

**Peek state (~22% screen):**
- ETA — 36px, weight 500, `#0F172A`, tabular nums
- Bus number — 13px, `#94A3B8`
- StatusPill
- Inline on one line with spacers

**Default state (~48% screen):**
- Drag handle
- ETA + bus number + status (same as peek)
- Divider
- Caps label "NEXT 3 STOPS"
- 3 stop rows: name (13px) + ETA (13px weight 500), current/next has 2px white left border
- "View full route" tertiary button

**Full state (~88% screen):**
- All stops in scrollable list
- Driver info card: avatar + name + rating (e.g. "★ 4.8") + small "Call driver" button
- "Report an issue" tertiary button (red text) — opens issue sheet
- "Share trip" duplicate access here

Loading state: animated shimmer skeleton matching final content shape.

**Feels like:** A live radar. Calm, spatial, truthful.

---

#### Screen: Scanner

**Apple pull on the chrome, Uber pull on the feedback.**

**Layout:**

- **Camera view** — full screen, 100%
- **Scan frame overlay** — centered square, 240×240px, corners only — each is a 20px L-shaped white line, 2px wide
- **Top bar** (glass surface) — "Cancel" tertiary button top left, "Help" tertiary top right (opens "How to scan" sheet)
- **Bottom strip** — `rgba(0,0,0,0.70)` with 24px backdrop blur
  - "Scanning for bus QR" — 13px, `#475569`
  - Bus name and stop — 15px, weight 500, `#0F172A`
  - Confirms they're scanning the right thing before they scan

**Behavior:**
- Auto-detect on camera mount — no tap required
- On detection: frame corners flash green for 200ms, medium haptic, navigate to result in 300ms
- Wrong QR (not a bus QR): frame flashes amber, "Wrong QR" toast at bottom, camera stays open
- Bus QR for a different route: red flash + clearer error: "This QR is for Route 12. You're assigned to Route 7."
- **Torch toggle** (new) — small icon top-right of frame, only visible in low light (auto-detected), tapping toggles flashlight. Many evening scans require this.

**Feels like:** Pointing your phone, it just works.

---

#### Screen: Check-in Success

**Uber pull. A moment of relief done with confidence.**

**Layout — centered, vertically middle:**

1. Success icon — 64×64 circle, `rgba(74,222,128,0.12)`, checkmark `#16A34A`. Scales 0.6→1.0 with spring (240ms, stiffness 300, damping 20)
2. **"Checked in"** — 28px, weight 600, `#0F172A`, marginTop 24px (bumped from 22 → 28)
3. Name + bus — "Arjun · TN-01-AB-1234" — 14px, `#94A3B8`
4. Status note — "On time · 9:14 AM" — 12px, `#16A34A` if on time, `#EA580C` if late
5. **Seat suggestion** (new, optional) — "Seat 14B" — 13px, `#475569`. Only shown if the bus uses assigned seating; otherwise omitted entirely.
6. Auto-dismiss: fade out and return to Home after 2.5s — no tap required
7. Tap anywhere to dismiss early

**Feels like:** A gate that opens and closes cleanly. No ceremony.

---

#### Screen: Check-in Fail

**Apple pull on tone. The screen explains exactly what and gives one path forward.**

**Layout — centered:**

1. Error icon — 64×64 circle, `rgba(248,113,113,0.12)`, X mark `#DC2626`
2. Reason — 22px (bumped), weight 500, `#0F172A` — e.g. "Too far from stop"
3. Detail — 14px, `#475569`, max-width 280px, centered — e.g. "You're 340 m from Anna Nagar West. Move closer and try again."
4. **Map mini-preview** (new) — A 240×120 mini-map showing the user's location and the stop, with distance overlay. Visual context, not just words.
5. Retry button — full width, primary
6. Back button — secondary, "Go back to home"

**Never say:** "Check-in failed." "An error occurred." "Something went wrong."
**Always say:** The specific reason in plain language.

**Feels like:** A clear explanation from a calm person, not a system error.

---

#### Screen: History

**Linear pull. Dense, scannable, keyboard-shortcut-able.**

**Layout:**

**Header** — "Attendance" — 22px, weight 600
- Right: filter icon — opens a sheet for date range, route, status

**Calendar heatmap strip** (new) — Below the header, a 7×N grid showing the last 60 days. Each cell is a 14×14 square, color-coded:
- Present on time: `#16A34A` at 80% opacity
- Late: `#D97706`
- Absent: `#DC2626`
- Non-school day: `#F1F0ED`
- Tap a cell to jump the list to that date.

**SegmentedControl** below heatmap: All / Present / Absent / Corrections

**Attendance list** — each item:

```
[Date block]     [Status pill]     [Bus + Stop]     [Action]
Jan 14           ON TIME           TN-01 · Stop 3   →
Jan 13           MISSED            —                Request correction
Jan 12           ON TIME           TN-01 · Stop 3   →
```

- Row height: 60px (bumped from 56), bottom border `rgba(255,255,255,0.04)`
- Date: 13px weight 500, `#0F172A`
- Status pill: compact (no dot, static)
- Bus + Stop: 11px, `#94A3B8`
- Tap row → opens detail sheet (timestamp, GPS map, photo if available)
- "Request correction" link: 11px, `#2563EB` — only on MISSED rows
- Empty state per tab: "No absences this month" with subtle illustration

**Monthly summary card** (new) at top of list:
- "December at a glance" — caps label
- Three small stats inline: "94% attendance · 2 absences · 4 late"
- Tappable to expand into a per-day breakdown

**Feels like:** A clean ledger. Trustworthy, with a heatmap that makes you proud (or makes you worried) at a glance.

---

#### Screen: Profile

**Apple pull. Boring is good here.**

**Layout:**

1. Header — "Profile" — 22px, weight 600

2. **User info card** — radius-lg, padding 16px
   - Avatar 56px (bumped), initials, same style as header
   - Name — 18px (bumped), weight 600
   - Phone — 13px, `#94A3B8`
   - Student ID — 11px, `#CBD5E1`
   - Edit button top-right, tertiary "Edit"

3. **Settings groups** — each group is a card with rows; groups separated by 24px

   **Group 1: Preferences**
   - Notifications → toggle row + count
   - Language → English (chevron)
   - Display → Dark / True Black (auto on OLED) (new)
   - **Notify me when** (new) → expandable row with sub-toggles:
     - Bus is 5 min away
     - Bus is 1 min away
     - I've been marked absent
     - Route changes for tomorrow
     - Driver sends a message

   **Group 2: Family** (new)
   - **Trusted contacts** → row showing "2 contacts" — opens screen to add parents/guardians who can:
     - Receive arrival/departure notifications
     - View live trip via shared link
     - Receive emergency alerts
   - **Emergency SOS** → toggle to enable a "panic" gesture (triple-tap power button on Android, side-button squeeze on iOS) that immediately notifies all trusted contacts with current GPS

   **Group 3: Account**
   - Help & Support
   - Terms
   - Privacy
   - **Data export** (new) → "Download my attendance data" (CSV)
   - App version (caption, not tappable)

4. **Sign out** — full-width secondary button, 24px above bottom safe area, text color `#DC2626`

**Feels like:** iOS Settings. Nothing to admire, everything to find.

---

#### Screen: Correction Request

**Treat this with respect — do not make the user feel accused. Apple-quiet pull.**

**Layout:**

1. Header with back — "Request Correction"
2. Trip info card — date, bus, route, expected stop. 16px weight 500
3. **What happened** segmented control (new) — pre-set reasons for faster submission:
   - "I was on the bus" (system mismatch)
   - "Wrong stop recorded"
   - "Phone died"
   - "Other"
4. Explanation field — textarea, 120px min-height, `radius-md`, placeholder "Describe what happened (optional)"
5. **Add evidence** (new) — tap to attach a photo from camera roll (e.g. a photo from the bus). Max 2 attachments.
6. **GPS context block** — small card showing recorded location vs stop location on a mini-map. This is evidence context, not an accusation.
7. **Estimated review time** (new) — "Reviews typically complete within 24 hours" — 11px `#94A3B8`. Sets expectations.
8. Submit button — primary, "Submit Request"

Copy rule: every label uses neutral language. "Your recorded location" not "You were detected at." "Correction request" not "Dispute."

---

#### Screen: Notifications Inbox (new)

**An archive of every alert, message, and system notice. Linear-dense.**

**Layout:**

1. Header — "Notifications" — 22px weight 600
2. SegmentedControl: All / Trips / Messages / System
3. Grouped list — items grouped under date headers ("Today," "Yesterday," "Last 7 days," "Earlier")
4. Each item:
   - Left: 8px unread dot (visible only if unread)
   - Icon: 32px circle, type-coded background
   - Title: 13px weight 500
   - Preview: 12px `#94A3B8`, 1 line truncated
   - Timestamp: 11px `#CBD5E1`, top right
   - Swipe left: archive (with undo)
   - Tap: opens detail or relevant screen
5. Mark all as read — top right tertiary

**Feels like:** Gmail meets Linear's inbox. Calm, archivable, never noisy.

---

### DRIVER FLOW

---

#### Screen: Driver Home

**Uber pull. One card, one button. Done.**

**Layout:**

1. Header — "Good morning, Ravi" — same component as student
   - Right: LiveIndicator (visible only after Start Trip)

2. **Today's checklist** card (new, replaces the old single assignment card)
   - "TODAY'S TRIP" caps label
   - Bus number — 28px weight 600 (title-xl)
   - Route name — 14px `#475569`
   - Departure — "Departs 8:00 AM" — 13px `#475569`
   - Student count — "42 students expected" — 13px `#94A3B8`
   - Divider
   - **Pre-trip checklist** (new) — three checkable items, each 44px tall:
     - ☐ Vehicle inspection complete (Tap to mark)
     - ☐ Fuel level OK
     - ☐ Documents on board (RC, Insurance, etc.)
   - All three must be checked before Start Trip enables. Liability-critical.
   - Divider
   - Route preview — first stop → last stop with "→", 12px `#52525B`

3. **Start Trip** button — full width, primary, 56px tall (bumped from 52). The most important tap in the driver's day.
   - Disabled until checklist complete; disabled state shows "Complete checklist to start"
   - Pre-trip lock prevents skipping safety steps

4. **Yesterday's recap** card (new, collapsible)
   - "Yesterday: 41 / 42 boarded · On time"
   - Tap to expand into the Trip Summary for yesterday

No scrolling required to reach Start Trip. Ever. If checklist gets long, the recap card collapses out.

**Feels like:** A pre-flight checklist that takes 30 seconds, then go.

---

#### Screen: Route Preview

**A read-only list. Confirmation, not planning.**

**Layout:**

1. Header with back — "Route Preview"
2. **Route summary card** at top (new): "9 stops · 12 km · ~72 min" — caps stats inline
3. Numbered stop list:
   - Number badge: 24×24 circle, `#F1F0ED`, border `rgba(15,23,42,0.10)`, 11px text `#475569`
   - Stop name: 14px, `#D4D4D8`
   - **Expected pickups**: 11px, `#52525B`, "8 students" right-aligned (new)
   - ETA offset: 11px, `#52525B` "8:14 AM" beneath pickup count
   - Current/next: left border 2px `#0F172A`, name in `#0F172A`
4. "Start here" button — primary, optional if accessed pre-trip

**Feels like:** A departure board. Read it, confirm it, go.

---

#### Screen: Driver Kiosk — *the most operationally critical screen*

**Uber pull dominates. Used in a moving vehicle. Every element must be readable from arm's length.**

**Design rules specific to this screen:**
- Nothing smaller than 14px (was 13 in v1; bumped for arm's-length readability)
- Touch targets minimum 56px
- High contrast — no subtle colors, no ghost text
- Feedback under 100ms
- No animation that isn't direct feedback

**Layout:**

**1. Top Status Bar** — full width, `#0D0D0F`, 48px tall, padding 0 16px

```
[GPS dot] Active    [WiFi dot] Online    [32 / 45 boarded]    [⏸ Pause]
```

- GPS Active: green. GPS Weak: amber + "Weak signal"
- Online: green. Offline: red + "Offline · 3 queued"
- Boarded count: "32 / 45" — 16px weight 600 (bumped), `#0F172A`, tabular nums, updates in real time
- **Pause Trip button** (new): 32×32 circle, tertiary. Pauses scan acceptance for fuel breaks, washroom stops, or break-downs. Pause state turns the QR card grayscale and shows a "Trip paused — tap to resume" overlay.
- Offline state: top bar shifts to `rgba(248,113,113,0.08)` background

**2. QR Card** — centered, dominant element

- Background `#1565C0`, `radius-2xl` (28px — softest in the app, premium feel)
- Width 300×300px (bumped from 280)
- QR fills 240×240
- White on `#1565C0` for max scan contrast
- **Bus + Route label above QR** (new) — "TN-01-AB-1234 · Route 7" — 14px `#94A3B8` — for student verification
- Below QR: 30s timer bar, thin 2px line animating left to right, resets every 30s
- QR rotates every 30s; rotation: 150ms fade out → new QR → 150ms fade in
- **Tap QR to enlarge** (new) — taps card → QR scales to 90% screen width for hard-to-scan situations (low light, cracked phone screen)

**3. Recent Scans Strip** (new) — 56px tall row beneath QR card

A horizontally-scrolling strip of the last 5 successful scans:
- Each pill: avatar (24px) + first name + tiny green checkmark
- Tap pill to undo (within 30s of scan, in case of accidental scan)
- Provides driver visual confirmation that scans are landing

**4. Scan Feedback Zone** — 64px tall, centered, beneath strip

Toast behavior:
- Successful: slide up, "Arjun Kumar · Boarded · Seat 14B" — green left border, 2.5s, slide out
- Failed: same but red left border, "Invalid QR · Not on this route"
- Wrong stop: amber left border, "Arjun Kumar · Wrong stop — currently at Anna Nagar West"
- Toasts never stack; new replaces current with 100ms crossfade
- Font 14px weight 500, background `#F1F0ED`, `radius-md`, padding 12px 16px

**5. Bottom Control Bar** — full width, `#0D0D0F`, 80px tall (bumped from 72), padding 0 16px

Four buttons (was three; added Manual Override):

| Button | Label | Style | Action |
|---|---|---|---|
| Next Stop | "Next" + stop name | Secondary, 56px | Mark current stop completed, advance route |
| Manual | "Manual" | Secondary, 56px | Open manual student entry sheet |
| Report | "Report" | Secondary, 56px | Open Breakdown/Issue sheet |
| End Trip | "End Trip" | `rgba(248,113,113,0.15)` bg, `#DC2626` text | Confirmation sheet |

End Trip is visually separated — slightly narrower, clearly different color — because it is destructive and irreversible.

**Manual Entry sheet** (new behavior): A search field + scrollable student list. Tap a student to mark them boarded with a one-tap confirmation. For when a student's QR won't scan or phone is dead.

**Feels like:** An aircraft instrument panel. Dense, precise, zero ambiguity.

---

#### Screen: Breakdown / Issue Report

**Get the report in under 10 seconds.**

**Layout:**

1. Header — "Report Issue" with X to dismiss
2. "What's the problem?" — 16px, weight 500
3. **Issue grid** (new — was a list in v1) — a 2×3 grid of large icon-buttons, each 80×80px, `radius-lg`, with icon + label below:
   - 🔧 Engine
   - ⚙️ Flat tyre
   - 🚨 Accident
   - 🚧 Road blocked
   - 🌧️ Weather
   - ⋯ Other
4. **Severity selector** (new) — three chips: "Minor · Major · Emergency"
   - Emergency triggers immediate admin call + SMS to all students' guardians
5. Optional note field — single line input, "Add details (optional)"
6. **Photo attach** (new) — tap to attach photo of the issue
7. Confirm button — full width, primary, "Send Report"

On submit: button shows loading spinner, transitions to Post-breakdown.

**Feels like:** A fast triage form, not a bureaucratic process.

---

#### Screen: Post-Breakdown

**Confirmation. Driver knows what happens next.**

**Layout — centered:**

1. Icon — amber circle, success-style
2. "Report received" — 22px (bumped), weight 600
3. "Admin notified. Wait for instructions." — 14px, `#475569`
4. **Status updates feed** (new) — a live-updating list of admin responses, in chat-like bubbles. "Admin: We're sending another bus, 15 min ETA." Real-time updates, removes the "what's happening" anxiety.
5. "Open Messages" — secondary button
6. "Return to Kiosk" — tertiary

---

#### Screen: Trip Summary

**End of trip. Numbers and close-out. Apple-quiet with Uber-bold hero numbers.**

**Layout:**

1. Header — "Trip Complete" — 22px weight 600
2. **Hero stat row** — three big numbers, equally weighted:
   - "Boarded" — number 28px weight 600 (`title-xl`)
   - "Absent" — same size, amber if above expected threshold
   - "Total" — same size
3. Timestamp inline — "Started 8:02 AM · Ended 9:14 AM · 72 min" — 12px, `#94A3B8`
4. **Route map snapshot** (new) — 240px tall mini-map showing the completed route with all stops dotted. Visual recap.
5. **Performance card** (new) — caps "PERFORMANCE":
   - On-time arrival: 8/9 stops (✓ green)
   - Average stop dwell: 1.2 min
   - Distance: 12.4 km
6. Absentees section — collapsible, default collapsed
   - "4 absent" — 14px, `#D97706`, tappable to expand
   - Each row: student name + stop name + "Notify guardian" tertiary button (new)
7. **Notes field** (new) — optional textarea for driver to log anything noteworthy ("Heavy traffic on MG Road, suggest alt route tomorrow")
8. **Complete & Submit** button — primary, full width

This screen is a recap. Don't make it a dashboard.

**Feels like:** A signed-off shift report.

---

#### Screen: Driver Messages

**Operator messages. Not chat.**

**Layout:**

1. Header — "Messages"
2. **Pinned admin contact card** (new) at top — quick "Call Admin" + "Open thread" buttons. One tap to admin in an emergency.
3. Message list — each item 64px tall:
   - Icon: operator avatar or system icon, 36px
   - Sender: 13px weight 500
   - Preview: 12px `#94A3B8`, 1 line truncated
   - Timestamp: 11px `#CBD5E1`, top right
   - Unread: 6px white dot, left of row
4. Empty state — "No messages" — centered, ghost text

Tap → read-only detail view of full message.

---

## 07. New Features Introduced in v2 — Summary

These weren't in v1. Each one earned its place by solving a specific real-world problem the original spec didn't address:

| # | Feature | Solves | Where it lives |
|---|---|---|---|
| 1 | **Notify Driver** quick actions | "Wait for me!" panic calls | Home quick actions |
| 2 | **Trusted contacts + parent live link** | Parents asking "where is my kid" | Profile + Map share |
| 3 | **Emergency SOS gesture** | Real safety incidents | Profile setting |
| 4 | **Driver pre-trip checklist** | Liability + safety compliance | Driver Home |
| 5 | **Pause Trip on Kiosk** | Fuel/break stops without ending trip | Kiosk top bar |
| 6 | **Recent scans strip + undo** | Driver visual confirmation | Kiosk |
| 7 | **Calendar heatmap on History** | Pattern-spotting at a glance | History header |
| 8 | **ETA confidence band** | Honest uncertainty on Home | Bus card |
| 9 | **Why delayed?** explainer | Trust during delays | Tap on delayed status |
| 10 | **Notifications Inbox screen** | Archive of every alert | New screen |
| 11 | **Issue severity + photo** | Faster admin triage | Breakdown report |
| 12 | **Live admin response feed** | Reduce post-breakdown anxiety | Post-breakdown |
| 13 | **Manual entry from Kiosk** | Dead phone or broken QR | Kiosk bottom bar |
| 14 | **Notify-me-when granular settings** | Stop notification fatigue | Profile preferences |
| 15 | **True Black mode** | OLED battery saving | Profile display |
| 16 | **Data export** | User data portability | Profile account |
| 17 | **SMS auto-fill on OTP** | Faster login | OTP screen |

---

## 08. System States — Every Screen

### Loading State

Use **skeleton loaders**, not spinners.

Skeleton rules:
- Match the shape of real content exactly
- Color: `#F1F0ED` base, `#222225` highlight, animated shimmer left to right
- Duration: 1.5s loop
- Never longer than 5s — after 5s, switch to error state with "Slow connection, retrying..."

### Empty State

Every list, every section. Each is contextual:
- Illustration: simple, abstract, 80×80px max, `#F1F0ED` fill — not a sad face
- Text: one line explaining why — "No absences this month" not "Nothing here"
- Action: only if useful — don't add a button just to fill space

### Error State

- Icon: `#DC2626` X circle, 48px
- Title: what went wrong — plain language
- Body: what to do — one sentence
- Button: one action — usually "Try again"
- **Plus**: a tertiary "Get help" link that opens a pre-filled support thread (new in v2)

Never: "Something went wrong. Please try again."

### Offline Banner

- Persistent top bar, 36px tall, `rgba(251,191,36,0.10)` background, `rgba(251,191,36,0.15)` bottom border
- Text: "You're offline · Showing last known data" — 11px, `#D97706`, centered
- **Reconnection animation**: banner morphs to "Back online · Syncing..." then fades over 1s. New: a thin progress bar fills underneath while syncing queued data (e.g. driver scans queued offline).
- Banner slides in, never hard cuts

### Permission-needed state (new in v2)

When the app needs camera, location, or notifications and they're denied:
- A clear "We need [permission] for [reason]" card
- Direct deep-link to the OS settings screen for that permission
- Never a generic "Please enable permissions" with no context

---

## 09. Motion Principles

### Core rule: animate meaning, not decoration.

| What | How | Why |
|---|---|---|
| ETA update | Slot machine digit roll | Live counter, confirms data freshness |
| Status pill state change | 220ms crossfade | Prevents jarring jumps |
| Bus marker movement | Linear interpolation | Smooth real-time, not teleporting |
| Screen transitions | Slide left/right; sheets slide up | Native platform feel |
| Success icon entrance | Scale 0.6→1.0 with spring | Physical, confirms action |
| Bottom sheet | 320ms cubic-bezier(0.32, 0.72, 0, 1) | Premium pull |
| SegmentedControl active slide | 240ms cubic-bezier(0.32, 0.72, 0, 1) | Linear-precise micro-interaction |
| Tab indicator slide | 240ms same curve | Cohesive across nav |
| Alert dismiss | Swipe + spring-back | Familiar, satisfying |
| Toasts | Slide up in, fade out | Unobtrusive, readable |
| Status glow crossfade | 220ms | Material change, not a color flash |
| Map camera response to sheet | 320ms parallel | Coordinated, not sequential |

### Reduced Motion (new in v2)

If `prefers-reduced-motion` is set:
- Slot-machine roll → instant value swap with 100ms fade
- Spring entrances → simple 200ms fade
- Sheet transitions → 200ms ease, no spring
- Pulsing dots → static
- Map camera → instant snap

### Never animate:
- Text the user is mid-reading
- Navigation mid-transition
- Anything delaying the user's primary task
- Anything on the Kiosk that isn't direct feedback

---

## 10. Interaction Principles

**Touch targets** — minimum 44×44 for everything. Minimum 56×56 for Scan QR, Start Trip, End Trip, Kiosk controls.

**Press states** — every interactive element responds in under 50ms. Buttons: `scale(0.97)`. Rows/chips: background lightens by 4%.

**Haptics — four levels** (was three in v1):

| Level | When |
|---|---|
| Light (selection) | Tab switches, list selection, slot-machine digit settles |
| Soft (rigid) | Toggle flip, segmented control switch |
| Medium | Successful scan, check-in confirmation |
| Heavy | Error, trip end, emergency SOS triggered |

**Gestures:**
- Swipe right on alert → dismiss
- Swipe left on notification → archive
- Swipe down on full sheet → collapse one snap
- Swipe up from peek sheet → expand one snap
- Long-press recenter button (Map) → camera options
- Pull to refresh on Home, History, Notifications
- No horizontal swipe on main screens — would conflict with iOS edge gestures

**Keyboard / accessibility:**
- All interactive elements reachable via VoiceOver / TalkBack
- ETA value is announced as "Bus arriving in 8 minutes" not "8" — context for screen readers
- Status pills have semantic labels — "Status: on time," not just "on time"
- All status colors paired with text — never color alone for state communication

---

## 11. Design Don'ts

These are decisions that will make the app feel cheap. Do not do them.

- Do not add decorative gradients to cards or backgrounds (specular gradient on the ETA number is the only exception)
- Do not use more than 3 accent colors on any single screen
- Do not center-align list items
- Do not use a spinner where a skeleton can go
- Do not toast for every micro-action — only things that need confirmation
- Do not use the word "Error" as a heading — use the actual reason
- Do not pad bus card content "to make it look bigger" — whitespace is earned
- Do not animate anything on the Kiosk that isn't feedback
- Do not use border-radius below 8px anywhere
- Do not add background illustrations or abstract shapes to empty states
- Do not blur the entire screen — material blur is for sheet/overlay surfaces only
- Do not show two simultaneous toasts
- Do not use light mode (this app does not have one)
- Do not put critical actions (Start Trip, End Trip, Scan QR) below the fold

---

## 12. Recommended Design Order

Start with what is hardest and carries the most trust:

1. **Student Home** — establishes the visual system for everything else
2. **Map** — hardest interaction, most trust-critical
3. **Driver Kiosk** — most operationally critical, unique design language
4. **Scanner + Check-in states** — micro-interaction focused
5. **History + Profile** — utility, lower complexity
6. **Auth flow** — last, because the system is now defined
7. **Driver Home + Summary + Route Preview** — execute with established system
8. **Notifications Inbox + Trusted Contacts + new feature screens**
9. **All empty / error / loading / permission states** — fill in every screen's secondary states

---

## 13. Implementation Notes for Engineering Handoff

A short bridge from design to your existing codebase:

**Design tokens** — encode all values from sections 02–04 as a single TypeScript object exported from `packages/shared/design-tokens.ts`. Both the React Native app and the React admin portal consume from this single source. Token names match this doc exactly so a designer and a developer can refer to "radius-xl" in the same conversation without translation.

**Status color tokens** drive both the StatusPill component and the contextual glow on the bus card. One source, two surfaces. Don't hardcode `#16A34A` in components.

**Inter Display vs Inter** — use a font-family fallback chain: `'Inter Display', 'Inter', system-ui`. On platforms without Inter Display, the regular Inter will render — slightly less refined but acceptable.

**Reduced motion** — wire to `useReducedMotion()` hook from `react-native-reanimated` (or equivalent web hook). Every animation in section 09 should branch on this hook.

**True black mode** — implemented as a second theme object, not by overriding individual values. Toggle in Profile flips the theme; auto-detect OLED from device characteristics where the OS exposes it.

**Performance budget for Home** — first meaningful paint within 800ms on a mid-range Android. The slot-machine animation must not block the JS thread; run it on the UI thread via Reanimated worklets.

---

*This document defines the product. If a question cannot be answered by reading this, the answer is: do less.*
