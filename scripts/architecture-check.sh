#!/bin/bash
# scripts/architecture-check.sh — Automated architecture enforcement
# Runs in CI. If any rule is violated, the build FAILS.
# No exceptions. No "just this once." No bypasses.
#
# RULES ENFORCED:
# 1. No raw API calls in screen files (app/)
# 2. No hardcoded hex colors in components (components/)
# 3. No full-store Zustand reads (useStore() without selector)
# 4. No raw UTC date splits in backend business logic
# 5. No console.log in mobile production code

set -e

PASS=true
ERRORS=()

echo "╔══════════════════════════════════════════════════════════╗"
echo "║          ARCHITECTURE ENFORCEMENT CHECK                 ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# ─── LAW 1: No API calls in screen files ─────────────────────
echo "► LAW 1: No raw API calls in screens (app/)"
# Screens must use hooks. Hooks use services. Services use api.
# If you see api.get/api.post in app/, the rule is broken.

SCREEN_API_CALLS=$(grep -rn --include="*.ts" --include="*.tsx" \
  -E "api\.(get|post|patch|put|delete)" \
  apps/mobile/app/ 2>/dev/null || true)

if [ -n "$SCREEN_API_CALLS" ]; then
  PASS=false
  ERRORS+=("LAW 1 VIOLATED: Raw API calls found in screen files:")
  ERRORS+=("$SCREEN_API_CALLS")
  ERRORS+=("FIX: Move API calls to services/*.service.ts, consume via hooks.")
  echo "  ❌ FAIL — Raw API calls found in screens"
else
  echo "  ✅ PASS — No raw API calls in screens"
fi

echo ""

# ─── LAW 2: No hardcoded hex colors in components ────────────
echo "► LAW 2: No hardcoded hex colors in components"
# All colors must come from theme tokens.
# Whitelist: theme.ts, constants/theme.ts (where tokens are defined)

HARDCODED_COLORS=$(grep -rn --include="*.ts" --include="*.tsx" \
  -E "'#[0-9A-Fa-f]{6}'|\"#[0-9A-Fa-f]{6}\"" \
  apps/mobile/components/ 2>/dev/null | \
  grep -v "theme\." | \
  grep -v "// THEME-SAFE" || true)

if [ -n "$HARDCODED_COLORS" ]; then
  PASS=false
  ERRORS+=("LAW 2 VIOLATED: Hardcoded hex colors found in components:")
  ERRORS+=("$HARDCODED_COLORS")
  ERRORS+=("FIX: Use colors from constants/theme.ts instead.")
  echo "  ❌ FAIL — Hardcoded colors found"
else
  echo "  ✅ PASS — No hardcoded colors in components"
fi

echo ""

# ─── LAW 3: No full-store Zustand reads ──────────────────────
echo "► LAW 3: No full-store Zustand reads"
# useStore() without a selector causes re-renders on ANY state change.
# Always use: useStore((s) => s.specificField)

FULL_STORE=$(grep -rn --include="*.ts" --include="*.tsx" \
  -E "useAuthStore\(\)|useTripStore\(\)" \
  apps/mobile/app/ apps/mobile/components/ 2>/dev/null | \
  grep -v "\.getState()" || true)

if [ -n "$FULL_STORE" ]; then
  PASS=false
  ERRORS+=("LAW 3 VIOLATED: Full-store reads found (causes re-render on any state change):")
  ERRORS+=("$FULL_STORE")
  ERRORS+=("FIX: Use selector pattern: useStore((s) => s.field)")
  echo "  ❌ FAIL — Full-store reads found"
else
  echo "  ✅ PASS — All store reads use selectors"
fi

echo ""

# ─── LAW 4: No raw UTC date splits in backend ────────────────
echo "► LAW 4: No raw UTC date splits in backend business logic"
# Must use getTodayDateKey() from shared utils.
# toISOString().split('T')[0] returns wrong date between 18:30 UTC and 00:00 UTC.

UTC_SPLITS=$(grep -rn --include="*.ts" \
  -E "toISOString\(\)\.split|\.split\('T'\)\[0\]" \
  apps/backend/src/ 2>/dev/null | \
  grep -v "node_modules" | \
  grep -v "test" | \
  grep -v "spec" | \
  grep -v "// UTC-SAFE" || true)

if [ -n "$UTC_SPLITS" ]; then
  PASS=false
  ERRORS+=("LAW 4 VIOLATED: Raw UTC date splits found in backend:")
  ERRORS+=("$UTC_SPLITS")
  ERRORS+=("FIX: Use getTodayDateKey() from @bus/shared instead.")
  echo "  ❌ FAIL — UTC date splits found"
else
  echo "  ✅ PASS — No raw UTC date splits"
fi

echo ""

# ─── LAW 5: No console.log in mobile production code ─────────
echo "► LAW 5: No console.log in mobile production code"
# console.warn and console.error are acceptable.
# console.log is debug noise that should never reach production.

CONSOLE_LOGS=$(grep -rn --include="*.ts" --include="*.tsx" \
  "console\.log" \
  apps/mobile/app/ apps/mobile/components/ apps/mobile/hooks/ apps/mobile/services/ 2>/dev/null | \
  grep -v "node_modules" | \
  grep -v "// DEBUG-SAFE" || true)

if [ -n "$CONSOLE_LOGS" ]; then
  PASS=false
  ERRORS+=("LAW 5 VIOLATED: console.log found in production code:")
  ERRORS+=("$CONSOLE_LOGS")
  ERRORS+=("FIX: Remove console.log or replace with structured logging.")
  echo "  ❌ FAIL — console.log found"
else
  echo "  ✅ PASS — No console.log in production code"
fi

echo ""

# ─── LAW 6: Mutations must have analytics tracking ──────────
echo "► LAW 6: Mutations must have analytics tracking"

VIOLATIONS=""
# Temporarily set +e so grep returning 1 doesn't kill the loop
set +e
while IFS= read -r match; do
  if [ -z "$match" ]; then continue; fi
  file=$(echo "$match" | cut -d: -f1)
  lineno=$(echo "$match" | cut -d: -f2)
  start_line=$((lineno-5))
  if [ "$start_line" -lt 1 ]; then start_line=1; fi
  context=$(sed -n "${start_line},$((lineno+40))p" "$file" 2>/dev/null || true)
  if ! echo "$context" | grep -q "analytics\.track"; then
    VIOLATIONS="$VIOLATIONS\n$match"
  fi
done < <(grep -rn "useMutation" apps/mobile/hooks/ 2>/dev/null || true)
set -e

if [ -n "$VIOLATIONS" ] && [ "$VIOLATIONS" != "\n" ]; then
  PASS=false
  ERRORS+=("LAW 6 VIOLATED: Mutations missing analytics.track:")
  ERRORS+=("$VIOLATIONS")
  ERRORS+=("FIX: Every useMutation must have an adjacent analytics.track call.")
  echo "  ❌ FAIL — Mutations missing analytics tracking"
else
  echo "  ✅ PASS — All mutations have analytics tracking"
fi

echo ""

# ─── LAW 7: GPS offline is amber, never red ─────────────────
echo "► LAW 7: GPS offline is amber, never red"

set +e
GPS_RED=$(grep -rn -i -E "GPS_OFFLINE|gps_offline|status.*offline" apps/mobile/ 2>/dev/null | \
  grep -i -E "error|#FCEBEB|#A32D2D|#E24B4A" || true)
set -e

if [ -n "$GPS_RED" ]; then
  PASS=false
  ERRORS+=("LAW 7 VIOLATED: GPS offline uses error color instead of warning/amber:")
  ERRORS+=("$GPS_RED")
  ERRORS+=("FIX: GPS offline is not the student's fault. Use theme.warning.*")
  echo "  ❌ FAIL — GPS offline uses red/error color"
else
  echo "  ✅ PASS — GPS offline correctly avoids red/error colors"
fi

echo ""

# ─── VERDICT ──────────────────────────────────────────────────
echo "════════════════════════════════════════════════════════════"

if [ "$PASS" = true ]; then
  echo "✅ ALL ARCHITECTURE LAWS PASS"
  echo "════════════════════════════════════════════════════════════"
  exit 0
else
  echo "❌ ARCHITECTURE VIOLATIONS DETECTED"
  echo ""
  for err in "${ERRORS[@]}"; do
    echo "  $err"
  done
  echo ""
  echo "These are NON-NEGOTIABLE. Fix violations before merging."
  echo "════════════════════════════════════════════════════════════"
  exit 1
fi
