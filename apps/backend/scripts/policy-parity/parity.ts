/**
 * Policy parity runner.
 *
 * Usage:
 *   # Capture a baseline (run against the pre-migration backend):
 *   pnpm tsx apps/backend/scripts/policy-parity/parity.ts capture --label 00-pre-migration
 *
 *   # After migrating, diff against the saved baseline:
 *   pnpm tsx apps/backend/scripts/policy-parity/parity.ts diff --against 00-pre-migration
 *
 *   # Seed DB/Redis with fixture data first:
 *   pnpm tsx apps/backend/scripts/policy-parity/seed.ts
 *
 * Output format:
 *   baselines/<label>.json — matrix of { fixture -> { route -> { status, body } } }
 *
 * Exit codes:
 *   0 — capture succeeded / diff shows no regressions
 *   1 — diff found status-code differences (regressions)
 *   2 — usage error or unrecoverable I/O problem
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { fixtures, type FixtureName } from './fixtures';
import { routeSpecs } from './routes';

// ── Config ────────────────────────────────────────────────────────────────────

const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const BASELINES_DIR = path.join(__dirname, 'baselines');
const REQUEST_TIMEOUT_MS = 10_000;

// ── Types ─────────────────────────────────────────────────────────────────────

interface RouteResult {
  status: number;
  body: unknown;
}

type FixtureRow = Record<string, RouteResult>;
type BaselineMatrix = Record<FixtureName, FixtureRow>;

// ── Body Normalization ───────────────────────────────────────────────────────

const TIMESTAMP_FIELDS = [
  'createdAt',
  'updatedAt',
  'lastLoginAt',
  'startedAt',
  'endedAt',
  'timestamp',
  'timestamp_',
  'deletedAt',
  'resolvedAt',
];

function normalizeBody(body: unknown): unknown {
  if (typeof body !== 'object' || body === null) {
    return body;
  }

  if (Array.isArray(body)) {
    return body.map(normalizeBody);
  }

  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (TIMESTAMP_FIELDS.includes(key) && (typeof value === 'string' || value !== null)) {
      masked[key] = '__TIMESTAMP__';
    } else if (typeof value === 'object' && value !== null) {
      masked[key] = normalizeBody(value);
    } else {
      masked[key] = value;
    }
  }
  return masked;
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function probe(
  method: string,
  urlPath: string,
  headers: Record<string, string>,
): Promise<RouteResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${BACKEND_URL}${urlPath}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      signal: controller.signal,
    });

    const contentType = res.headers.get('content-type') ?? '';
    let body: unknown;

    if (contentType.includes('application/json')) {
      const text = await res.text();
      try {
        body = normalizeBody(JSON.parse(text));
      } catch {
        body = text;
      }
    } else {
      body = await res.text();
    }

    return { status: res.status, body };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      return { status: 0, body: { error: 'timeout' } };
    }
    return { status: -1, body: { error: 'network_error', message: String(err) } };
  } finally {
    clearTimeout(timer);
  }
}

// ── Capture ───────────────────────────────────────────────────────────────────

async function capture(label: string): Promise<void> {
  console.log(`[parity:capture] Backend: ${BACKEND_URL}`);
  console.log(`[parity:capture] Fixtures: ${fixtures.length}  Routes: ${routeSpecs.length}`);
  console.log(`[parity:capture] Label: ${label}\n`);

  const matrix: Partial<BaselineMatrix> = {};

  for (const fixture of fixtures) {
    const headers = fixture.headers();
    const row: FixtureRow = {};

    for (const spec of routeSpecs) {
      const result = await probe(spec.method, spec.path, headers);
      row[spec.label] = result;
      process.stdout.write(
        `  ${fixture.name.padEnd(22)} ${spec.method} ${spec.path.padEnd(55)} → ${result.status}\n`,
      );
    }

    matrix[fixture.name as FixtureName] = row;
  }

  const outPath = path.join(BASELINES_DIR, `${label}.json`);
  fs.writeFileSync(outPath, JSON.stringify(matrix, null, 2));
  console.log(`\n[parity:capture] Saved to ${outPath}`);
}

// ── Diff ──────────────────────────────────────────────────────────────────────

interface DiffEntry {
  fixture: FixtureName;
  route: string;
  baseline: number;
  current: number;
  bodyBaseline?: unknown;
  bodyCurrent?: unknown;
}

async function diff(against: string, current?: string): Promise<void> {
  const baselinePath = path.join(BASELINES_DIR, `${against}.json`);
  if (!fs.existsSync(baselinePath)) {
    console.error(`[parity:diff] Baseline not found: ${baselinePath}`);
    process.exit(2);
  }

  const baseline: BaselineMatrix = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));

  // If --current is not provided, run against live backend
  const currentMatrix: BaselineMatrix | null = current
    ? JSON.parse(fs.readFileSync(path.join(BASELINES_DIR, `${current}.json`), 'utf8'))
    : null;

  console.log(`[parity:diff] Backend: ${BACKEND_URL}`);
  console.log(`[parity:diff] Comparing against: ${against}`);

  if (current) {
    console.log(`[parity:diff] Current: ${current}`);
  }
  console.log();

  const regressions: DiffEntry[] = [];
  const improvements: DiffEntry[] = [];

  for (const fixture of fixtures) {
    const headers = fixture.headers();
    const baselineRow = baseline[fixture.name];

    if (!baselineRow) {
      console.warn(`[parity:diff] Warning: fixture '${fixture.name}' not in baseline — skipping`);
      continue;
    }

    for (const spec of routeSpecs) {
      if (!(spec.label in baselineRow)) {
        continue;
      }

      let currentResult: RouteResult;

      if (currentMatrix) {
        const currentRow = currentMatrix[fixture.name];
        if (!currentRow || !(spec.label in currentRow)) {
          continue;
        }
        currentResult = currentRow[spec.label];
      } else {
        currentResult = await probe(spec.method, spec.path, headers);
      }

      const expectedStatus = baselineRow[spec.label].status;
      const currentStatus = currentResult.status;

      // Status code diff
      if (currentStatus !== expectedStatus) {
        const entry: DiffEntry = {
          fixture: fixture.name,
          route: spec.label,
          baseline: expectedStatus,
          current: currentStatus,
        };

        const isRegression =
          expectedStatus >= 200 && expectedStatus < 300 &&
          (currentStatus === 401 || currentStatus === 403);

        const isNewlyAllowed =
          (expectedStatus === 401 || expectedStatus === 403) &&
          currentStatus >= 200 && currentStatus < 300;

        if (isRegression) {
          regressions.push(entry);
        } else if (isNewlyAllowed) {
          improvements.push(entry);
        } else {
          regressions.push(entry);
        }
      }

      // Body diff (only when status both 2xx)
      const baselineBody = baselineRow[spec.label].body;
      const currentBody = currentResult.body;

      if (
        expectedStatus >= 200 && expectedStatus < 300 &&
        currentStatus >= 200 && currentStatus < 300
      ) {
        const baselineJson = JSON.stringify(baselineBody);
        const currentJson = JSON.stringify(currentBody);

        if (baselineJson !== currentJson) {
          const entry: DiffEntry = {
            fixture: fixture.name,
            route: spec.label,
            baseline: expectedStatus,
            current: currentStatus,
            bodyBaseline: baselineBody,
            bodyCurrent: currentBody,
          };

          // Body changes are always regressions that need review
          regressions.push(entry);
        }
      }
    }
  }

  if (regressions.length === 0 && improvements.length === 0) {
    console.log('[parity:diff] ✓ All status codes and bodies match baseline. No regressions.');
    return;
  }

  if (improvements.length > 0) {
    console.log('\n[parity:diff] ⚠ Newly-allowed paths (review intentionality):');
    for (const e of improvements) {
      console.log(`  ${e.fixture.padEnd(22)} ${e.route.padEnd(30)} ${e.baseline} → ${e.current}`);
    }
  }

  if (regressions.length > 0) {
    console.log('\n[parity:diff] ✗ Regressions detected:');
    for (const e of regressions) {
      console.log(`\n  ${e.fixture.padEnd(22)} ${e.route}`);
      console.log(`    Status: ${e.baseline} → ${e.current}`);

      if (e.bodyBaseline !== undefined && e.bodyCurrent !== undefined) {
        console.log('    Body mismatch:');
        console.log(`    Expected: ${JSON.stringify(e.bodyBaseline, null, 2).split('\n').map(l => '      ' + l).join('\n')}`);
        console.log(`    Actual:   ${JSON.stringify(e.bodyCurrent, null, 2).split('\n').map(l => '      ' + l).join('\n')}`);
      }
    }
    console.log(`\n${regressions.length} regression(s). Fix before merging.`);
    process.exit(1);
  }
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function usage(): void {
  console.error(`
Usage:
  pnpm tsx parity.ts capture --label <label>
  pnpm tsx parity.ts diff    --against <label> [--current <label>]
`.trim());
  process.exit(2);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    usage();
  }

  const command = args[0];
  const flag = args[1];
  const value = args[2];

  if (command === 'capture' && flag === '--label') {
    await capture(value);
  } else if (command === 'diff' && flag === '--against') {
    // Optional --current flag
    let currentLabel: string | undefined;
    const currentFlagIdx = args.indexOf('--current');
    if (currentFlagIdx !== -1 && currentFlagIdx + 1 < args.length) {
      currentLabel = args[currentFlagIdx + 1];
    }
    await diff(value, currentLabel);
  } else {
    usage();
  }
}

main().catch((err) => {
  console.error('[parity] Fatal:', err);
  process.exit(2);
});