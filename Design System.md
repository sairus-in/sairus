# FleetOps Command — Visual Language

**Design system · v1.0**

A muted, border-led system for an operations command surface. Depth comes from hairlines, not shadows. Color is reserved for status. Type does the heavy lifting.

Inspired by the precision of Linear and the calm of native macOS — built for screens that watch fleets in motion.

| | |
|---|---|
| Tokens | 62 |
| Typefaces | 3 |
| Components | 14 |
| Updated | Apr 2026 |

---

## 01 · Principles

**Quiet by default. Loud only when it matters.**

Operators stare at this surface for hours. Surfaces stay neutral; status colors stay muted; the only thing that pulses is an actual incident.

- **Border-led — hairlines, not shadows.** Every panel, card and divider is built from 1px borders in a tight grayscale ramp. No drop shadows, no glassmorphism.
- **Tonal whites — warm, never cold.** Whites carry a hint of warmth (`#fafaf7`). Pure `#ffffff` is reserved for surface accents only. No saturation above 0.02.
- **Mono for data — numbers want a grid.** JetBrains Mono with `tabular-nums` for IDs, counts, timestamps and coordinates. Display type stays out of its way.

---

## 02 · Color

A warm neutral spine. Surfaces ramp from canvas to ink in eight steps. Borders sit between surface-2 and surface-3 to keep edges crisp without drawing attention.

### Surfaces & ink

| Token | Hex | Role |
|---|---|---|
| `--bg` | `#FAFAF7` | Canvas |
| `--surface` | `#FFFFFF` | Surface |
| `--surface-2` | `#F5F5F2` | Surface 2 |
| `--surface-3` | `#EFEEE9` | Surface 3 |
| `--muted-2` | `#B5B5B8` | Muted 2 |
| `--muted` | `#8A8A8F` | Muted |
| `--ink-2` | `#3A3A3D` | Ink 2 |
| `--ink` / `--accent` | `#1A1A1C` | Ink |

### Borders & dividers

| Token | Hex | Role |
|---|---|---|
| `--divider` | `#ECECEA` | Divider |
| `--border` | `#E8E6DF` | Border |
| `--border-2` | `#DEDBD2` | Border 2 |
| `--border-3` | `#C9C6BC` | Border 3 |

---

## 03 · Status & priority

Earthy, never alarming. State colors are desaturated to sit alongside the neutral spine. Each has a paired soft tint for fills and a solid for type and dots.

| State | Solid | Soft | Tokens | Use |
|---|---|---|---|---|
| OK | `#3A7A5A` | `#E8EFE9` | `--ok` / `--ok-soft` | On route |
| Warn | `#A87437` | `#F3EBDC` | `--warn` / `--warn-soft` | Delayed |
| Err | `#A6423A` | `#F4E1DF` | `--err` / `--err-soft` | Incident |
| Info | `#3F5A7A` | `#E2E8EF` | `--info` / `--info-soft` | Boarding |
| Idle | `#8A8A8F` | `#ECECEA` | `--idle` / `--idle-soft` | Idle |

### Priority chips

| Chip | Hex | Token | Meaning |
|---|---|---|---|
| P1 | `#A6423A` | `--p1` | Critical |
| P2 | `#A87437` | `--p2` | Major |
| P3 | `#3F5A7A` | `--p3` | Minor |

---

## 04 · Typography

Three faces, three jobs.

| Role | Family | Token | Weights |
|---|---|---|---|
| Display · Headlines | Inter Tight | `--font-display` | 400 / 500 / 600 |
| Text · UI & body | Inter | `--font-text` | 400 / 500 |
| Mono · Data & code | JetBrains Mono | `--font-mono` | 400 / 500 |

---

## 05 · Type scale

Compact, dense, deliberate. Base is 13px — operations dashboards reward density.

| Style | Family · Weight | Size / Line | Tracking | Use |
|---|---|---|---|---|
| Display / XL | Inter Tight · 500 | 44 / 48 | -0.02em | Headlines |
| Display / L | Inter Tight · 500 | 24 / 30 | -0.015em | Section |
| Display / M | Inter Tight · 500 | 14 / 20 | -0.01em | Card title |
| Body | Inter · 400 | 13 / 19 | -0.005em | Default |
| Body / S | Inter · 400 | 11.5 / 17 | — | Caption |
| Eyebrow | Inter Tight · 500 | 11 | 0.08em UPPER | Section label |
| Mono / Data | JetBrains Mono · 400 | 13 | tabular-nums | Numbers & IDs |
| Mono / Tag | JetBrains Mono · 500 | 10.5 | 0.06em | Token |

---

## 06 · Radius

Soft, but not bubbly. Most surfaces sit at `--r-lg` (16px); buttons and inputs at `--r-md` (12px).

| Token | Size |
|---|---|
| `--r-xs` | 6px |
| `--r-sm` | 8px |
| `--r-md` | 12px |
| `--r-lg` | 16px |
| `--r-xl` | 20px |
| `--r-2xl` | 28px |
| `--r-pill` | 999px |

---

## 07 · Layout

Three rails, three jobs. The shell is fixed:

- **Status bar** — 32px, tops every screen, live alerts
- **Nav rail** — 56px, anchors the left
- **Topbar** — 52px, breadcrumb · search · mode
- **Right rail** — 320px (optional)

### Spacing scale

| Token | Px |
|---|---|
| `--space-1` | 4 |
| `--space-2` | 6 |
| `--space-3` | 8 |
| `--space-4` | 12 |
| `--space-5` | 16 |
| `--space-6` | 24 |
| `--space-7` | 32 |
| `--space-8` | 48 |

---

## 08 · Motion

Functional, never decorative. Three durations, two easings. Anything longer than 360ms feels slow.

### Durations

| Token | Duration | Use |
|---|---|---|
| `--t-fast` | 120ms | Hover · feedback |
| `--t` | 200ms | Default · transitions |
| `--t-slow` | 360ms | Slow · reveals |

### Easing

| Token | Curve | Use |
|---|---|---|
| `--ease` | `cubic-bezier(0.22, 0.61, 0.36, 1)` | Default — most state changes |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | Reveals — palettes, panels, fade-ins |

---

## 09 · Buttons

Three weights. One primary per view.

- **Primary** — ink-on-canvas (`background: --ink`, `color: --accent-ink`)
- **Default** — bordered surface (`background: --surface`, `border: --border-2`)
- **Ghost** — transparent, for repeated actions in dense rows

Sizes: `.sm` · default · `.lg` · `.icon-only`. Radius `--r-md`.

### Mode toggle

A pill-shaped segmented control (`.mode-toggle`) — active segment is ink-filled; inactive segments use `--muted` text on `--surface-2`.

---

## 10 · Badges & chips

Status, then count, then label. Pills with a 6px dot, readable at row-height.

```
.badge.ok    · .badge.warn · .badge.err · .badge.info · .badge.idle
```

The status bar (`.statusbar`) has two states:
- **Alert** — `--err-soft` background with a pulsing `--err` dot
- **Calm** — `--surface-2` background with `--muted` text

---

## 11 · Cards & KPIs

One border. Always 16px radius. Cards never stack shadows.

- `.card` — base container
- `.card-head` — title + dim subtitle, divider beneath
- `.card-body` — 16px padding
- `.stat-card` — KPI: mono label, display value, mono delta tinted by state

Deltas pick up `--ok` (positive) or `--err` (negative).

---

## 12 · Inputs & search

Pill search, square fields.

- `.searchbar` — pill (`--r-pill`), kbd hint, ink border on focus
- `.input` — `--r-md`, 1px `--border-2` border, goes to ink on focus
- `.cmd-palette` — modal at 15vh, blurred backdrop, mono kbd hints

---

## 13 · Tables

Dense, sortable, mono where it counts.

- Header — sticky, uppercase mono (11px / 0.04em / `--muted`), `--surface-2` background
- Rows — 12.5px Inter, hover → `--surface-2`, selected → `--surface-3`
- IDs and numbers fall back to mono with `tabular-nums`

---

## 14 · Mark & lockup

Ink on canvas. The mark is a 22px square containing a smaller square — a vehicle inside a depot. The wordmark is **Inter Tight 500** at 0.08em tracking.

Approved backgrounds:
- On surface (`--surface`)
- On warm gray (`--surface-3`)
- On ink (`--ink`) — mark and wordmark switch to `--accent-ink`

---

*FLEETOPS · COMMAND SYSTEM · v1.0 — 62 tokens · 14 components · last edit 25 Apr 2026*
