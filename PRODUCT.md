# Product

## Register

product

## Users

- **Students** — Daily riders. They check the home screen first thing in the morning to see where the bus is, scan to board, and glance at attendance over the term.
- **Drivers** — Operate the bus. Open the kiosk before the trip, drive, end the trip. High-stakes glanceable interface.
- **Admins** — Live operations, fleet, attendance corrections, messaging, reports. Power-user console, kept in its current operational language.

## Product Purpose

College bus management system serving 180+ buses and thousands of students. The student-facing mobile app is part of a wider university utility platform; this app is the transit module today, with announcements / OD / notices to follow.

Core student journey:
- See where my bus is right now, and how long it'll be until my stop.
- Scan to check in when boarding.
- Glance at my attendance, leaves, OD.
- Get notified when something changes — substitute bus, missed scan, delay.

Success means: students trust the app enough to leave the house at the right time, board confidently, and never worry about whether their attendance was recorded.

## Brand Personality (Mobile)

**Playful campus utility.** Atmospheric, identity-forward, expressive. The mobile app feels like a student app — open it and you're greeted by an atmospheric blue sky with starbursts, big friendly typography, a coral CTA when something needs your attention. The interface has character because students notice character.

- **Friendly, not corporate.** "Hello Kristen" greets by name. No "Welcome to Bus Management Portal."
- **Confident, not loud.** Big type, generous spacing, one accent color. Not a carnival.
- **Calm in the steady state, urgent only when needed.** The coral accent shows up for action (notify, scan-required, alerts). Most of the screen is cool blues that fade into the background.
- **Specific to this campus.** Star pattern, blue palette, custom display type — designed for here, not a generic transit template.

## Brand Personality (Admin)

Admin retains its current operational language: data-dense, no decorative motion, power-user efficient. Admins are in workflow mode for full shifts; their interface optimizes for keyboard-driven density, not delight.

This is intentional — students and admins have different relationships with the product, and the design serves each.

## Anti-references (Mobile)

- **Generic SaaS dashboards** — Big number / small label / gradient accent / "Welcome back!" template. Reject.
- **Material Design defaults** — FABs, sheets, ripple animations that scream framework. Reject.
- **iOS settings-style lists** — Endless gray rows of disclosure indicators. The list views (history, notifications) need their own treatment.
- **Stock food-delivery template** — Big hero image, three cards below, bottom tab. Even though we have a bottom tab, the surface above it shouldn't be three identical cards.

## Anti-references (Admin)

Same as before: no decorative blur, no glassmorphism, no gradient hero cards in admin.

## Design Principles (Mobile)

1. **Greet, then guide.** Every screen opens with identity — who the user is, what's happening for them right now. Generic page headers are a smell.
2. **Big type, generous spacing.** Students glance, they don't read. The ETA is 72pt. The greeting is 44pt. White space is part of the design.
3. **One accent, used sparingly.** Coral `#FF9274` appears only when action is needed. If everything is highlighted, nothing is.
4. **Atmospheric, not decorative.** The starburst background is identity, not ornament. It doesn't compete with content because it sits behind a soft blue canvas.
5. **Motion that confirms, not entertains.** Cards fade up on mount. Numbers spring when they change. Stars are static. No layout-property animation, no bounce.

## Design Principles (Admin)

Unchanged. Operational clarity, precision over personality, workflow efficiency, trust through consistency, respect attention.

## Accessibility & Inclusion

- WCAG AA contrast for all text on the brand canvas. The blue canvas (`#4D95C3`) is checked against white headings (4.5:1 minimum body, 3:1 large).
- `useReducedMotion()` respected for every animation. Stars are static anyway, but card entrances and number ticks skip when the user prefers reduced motion.
- Semantic role labels on every pressable. Avatars, status pills, big-number stats all have `accessibilityLabel` and `accessibilityRole`.
- 44×44pt minimum touch targets on every CTA, scan button, tab bar item.
- Dynamic Type scaling supported up to 130%; layouts allow for text growth without truncation.

## Out of scope

- App icon and splash redesign — tracked separately.
- Web admin redesign — not happening.
- Backend or contract changes — the redesign reads from existing endpoints and schemas only.

