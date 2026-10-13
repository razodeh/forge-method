/**
 * `go-test-json` — one of `13` F-TEST-7 point 2's built-in `forge-test-report` parsers:
 * `go test -json`'s own NDJSON event stream (one JSON object per line: `{Time, Action, Package,
 * Test?, Output?, Elapsed?}`, produced by Go's standard-library `cmd/test2json`).
 *
 * DISCLOSED (`specs/22` M17 P3's own report): this environment has no Go toolchain, so — unlike
 * every other built-in parser in this directory — this one is built from `cmd/test2json`'s own
 * long-stable, widely-documented event schema rather than a captured real run.
 *
 * `Action` is one of `run|pause|cont|bench|start|output|pass|fail|skip`; only the three terminal
 * actions (`pass`/`fail`/`skip`) become entries. `Test` absent names a PACKAGE-level event, not a
 * test — a package-level `fail` with no per-test event at all (a compile error before any test could
 * even run) is the identical "stillborn, nothing was actually exercised" case
 * `vitest-json.ts`/`jest-json.ts` already name `kind: 'load'`, read the same way here; a package-level
 * `fail` alongside real per-test failures is not synthesised again (the real failures already explain
 * it). `Package` is an import path, never a file — `13` F-TEST-7 point 5's own degradation rule
 * (every entry omits `file`, same as `junit-xml.ts`'s own reasoning for an unreliable cross-dialect
 * signal, for the identical reason: inventing a file from something that is not one is a guess).
 *
 * NDJSON: a line that is not valid JSON is skipped, never a whole-stream tool-error — one bad or
 * truncated line should not void every other real result this run produced.
 *
 * @see specs/09 §9.5
 * @see specs/13 F-TEST-7 point 2, point 5
 * @see specs/22 M17 P3
 */
import type { ForgeTestReportEntry } from '@forge/schemas';

import type { ParseResult } from './types.ts';

interface GoTestEvent {
  readonly Action?: unknown;
  readonly Package?: unknown;
  readonly Test?: unknown;
  readonly Elapsed?: unknown;
}

const TERMINAL_ACTIONS = new Set(['pass', 'fail', 'skip']);

/** `Elapsed`, in seconds (go's own unit), converted to milliseconds. Omitted when absent or not a
 * real, finite number -- a missing duration is honestly absent, never a guessed zero. */
function durationMsFrom(elapsed: unknown): number | undefined {
  return typeof elapsed === 'number' && Number.isFinite(elapsed) ? elapsed * 1000 : undefined;
}

/** Parses `raw` as `go test -json`'s own NDJSON event stream. Never throws. */
export function parseGoTestJson(raw: string): ParseResult {
  const tests: ForgeTestReportEntry[] = [];
  const packagesWithTestEvents = new Set<string>();
  const packageLevelFailures = new Map<string, number | undefined>();

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // NDJSON: one malformed line is skipped, never voids the whole stream.
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue;
    const event = parsed as GoTestEvent;
    const action = typeof event.Action === 'string' ? event.Action : undefined;
    if (action === undefined || !TERMINAL_ACTIONS.has(action)) continue;
    const pkg = typeof event.Package === 'string' ? event.Package : undefined;
    const testName = typeof event.Test === 'string' ? event.Test : undefined;
    const durationMs = durationMsFrom(event.Elapsed);

    if (testName === undefined) {
      if (pkg === undefined) continue;
      if (action === 'fail') packageLevelFailures.set(pkg, durationMs);
      continue;
    }

    if (pkg !== undefined) packagesWithTestEvents.add(pkg);
    if (action === 'fail') {
      tests.push({
        name: testName,
        status: 'fail',
        kind: 'assertion',
        ...(durationMs === undefined ? {} : { durationMs }),
      });
    } else if (action === 'skip') {
      tests.push({
        name: testName,
        status: 'skip',
        ...(durationMs === undefined ? {} : { durationMs }),
      });
    } else {
      tests.push({
        name: testName,
        status: 'pass',
        ...(durationMs === undefined ? {} : { durationMs }),
      });
    }
  }

  for (const [pkg, durationMs] of packageLevelFailures) {
    // A real per-test failure already explains this package's own non-zero exit -- nothing to
    // synthesise. Only a package that failed with NO per-test event at all (a build failure before
    // any test could run) gets the one synthetic load-kind entry.
    if (packagesWithTestEvents.has(pkg)) continue;
    tests.push({
      name: `${pkg} (package failed to build or run)`,
      status: 'fail',
      kind: 'load',
      ...(durationMs === undefined ? {} : { durationMs }),
    });
  }

  return { ok: true, tests };
}
