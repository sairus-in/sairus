# Fonts

The mobile app loads four font families. Two come from `@expo-google-fonts` (no files needed). Two are user-supplied and must live in this directory.

## Required local files

| File | Source | Status |
|---|---|---|
| `Morne.ttf` | User-supplied | Required |
| `Bahnschrift.ttf` | User-supplied (Microsoft) | Required |
| `Bahnschrift-SemiBold.ttf` | User-supplied (Microsoft) | Required |

Drop the TTF files into this directory exactly as named. Bundler resolves them via `require()` from `apps/mobile/constants/typography.ts`.

## Licensing note (Bahnschrift)

Bahnschrift ships with Windows and is **licensed by Microsoft, not redistributable** without a license. If this app goes to the App Store / Play Store publicly, replace Bahnschrift with a free condensed alternative:

- **Saira Condensed** (Google Fonts) — closest free match for the segmented numeric look
- **Barlow Condensed** (Google Fonts) — slightly less geometric, also good
- **IBM Plex Sans Condensed** (Google Fonts) — more humanist

To swap, replace `Bahnschrift.ttf` with the alternative's TTF (renamed) and the imports continue working.

## Google Fonts (auto-loaded)

- `Inter` — `@expo-google-fonts/inter`
- `Ubuntu Mono` — `@expo-google-fonts/ubuntu-mono`

These are installed as npm packages; no file drop required. Loading is wired in `apps/mobile/app/_layout.tsx`.

## Test that fonts loaded

Open the app in dev. If a font failed to load, headings render in the system fallback (San Francisco on iOS, Roboto on Android) — visually identifiable because spacing and weight won't match the mockups. Check Metro logs for `Failed to load font: <name>`.
