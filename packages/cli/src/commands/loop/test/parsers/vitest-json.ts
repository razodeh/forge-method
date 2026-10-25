/**
 * `vitest-json` — one of `13` F-TEST-7 point 2's built-in `forge-test-report` parsers, for a
 * structured `testCommands.<layer>` layer that declares `format: vitest-json` directly. An
 * independent reimplementation of `reporter.ts`'s own pre-existing, legacy-path vitest-JSON reading
 * (`outcomesFromVitestJson`) — not a refactor of it: that function's own exact behaviour is required
 * to stay byte-identical for every project still on the legacy bare-string `testCommands` form (`18`
 * §18.3), so this parser is deliberately a fresh, separate module the structured path alone calls,
 * ported faithfully from the SAME two real, confirmed edge cases that function's own doc comments
 * already document (re-confirmed directly against this monorepo's own installed Vitest during this
 * piece's own build, not merely copied):
 *
 * 1. A file that fails to load (an unresolved import, a syntax error) reports `assertionResults: []`
 *    with the file's own `status: 'failed'` — every AC that file's tests would have proven is
 *    unverifiable, not silently absent; read as one `kind: 'load'` failure. The file's own real
 *    `message` (Q346, round 6) is carried onto that one synthetic entry too, not only folded into
 *    its `name` — a round-6 critic found this branch alone still dropped it after round 2 wired
 *    `message` into every OTHER branch this parser has.
 * 2. A **top-level** `beforeAll`/`afterAll` hook that throws (one declared outside any `describe()`)
 *    reports EVERY assertion in that file as `status: 'skipped'` — including one that was genuinely,
 *    deliberately `.skip()`-ed, which this format gives no way to tell apart from a hook's victim at
 *    the per-assertion level — disambiguated only by the file's own `message` being non-empty. That
 *    same `message` (Q346, post-v1.0, `specs/22` M17 P21) is attached to every entry this
 *    reclassification touches, rather than computed once to decide `status` and then discarded.
 *
 * DISCLOSED LIMIT, confirmed two ways (a real run against this monorepo's own installed Vitest
 * 4.1.11, and reading that exact version's bundled `JsonReporter.onTestRunEnd`,
 * `vitest/dist/chunks/index.*.js`): the hook-throw reclassification above fires ONLY for a top-level
 * hook. The realistic, common case — a hook declared INSIDE a `describe()` block, which this
 * codebase's own fixtures use throughout — does not: `message` is computed as
 * `file.result?.errors?.[0]?.message ?? ''`, read off the FILE task's own `errors` alone, and a
 * nested suite's hook failure is recorded on the SUITE's task, never the file's — so `message` is the
 * empty string for a nested hook throw, structurally indistinguishable from an ordinary file where no
 * hook failed. Verified directly: a `beforeAll` thrown inside a `describe()`, next to a deliberately
 * `.skip()`-ed test, produces `message: ""` and `status: "skipped"` for BOTH tests, with no other
 * field (per-test `failureMessages` included) carrying the hook's error anywhere in the JSON. This
 * parser therefore does the only honest thing available from this data: it reads both as `'skip'`,
 * exactly as `09` §9.5's own "degrade to a stated outcome rather than guessing" principle requires,
 * rather than claiming a disambiguation Vitest's own `--reporter=json` does not actually carry for
 * this case. `format: junit-xml` (Vitest's own `--reporter=junit`) does carry it, confirmed directly
 * against the identical fixture: a nested hook failure adds one EXTRA `<testcase>`, named after the
 * `describe()` block itself, with a real `<failure message="...">` — alongside the two genuinely
 * `<skipped/>` testcases for the tests that never ran — so `parseJunitXml` (this directory's own
 * `junit-xml.ts`) surfaces it as a real `fail`/`kind: 'assertion'` entry (oddly named after the suite,
 * not a real test, but visible) rather than silently losing it. A project that needs this
 * disambiguation reliably from Vitest should prefer `format: junit-xml` over `format: vitest-json`.
 *
 * @see specs/09 §9.5
 * @see specs/13 F-TEST-7 point 2
 * @see specs/22 M17 P3
 */
import type { ForgeTestReportEntry } from '@forge/schemas';

import type { ParseResult } from './types.ts';

interface VitestAssertionResult {
  readonly fullName?: unknown;
  readonly title?: unknown;
  readonly status?: unknown;
}
interface VitestFileResult {
  readonly assertionResults?: unknown;
  readonly status?: unknown;
  readonly message?: unknown;
  readonly name?: unknown;
}
interface VitestJsonReport {
  readonly testResults?: unknown;
}

function mapStatus(status: unknown): 'pass' | 'fail' | 'skip' {
  if (status === 'passed') return 'pass';
  if (status === 'failed') return 'fail';
  return 'skip';
}

function entriesFromFile(fileResult: VitestFileResult): readonly ForgeTestReportEntry[] {
  const assertions = Array.isArray(fileResult.assertionResults) ? fileResult.assertionResults : [];
  const fileFailed = fileResult.status === 'failed';
  const file = typeof fileResult.name === 'string' ? fileResult.name : undefined;
  const hookThrew =
    fileFailed && typeof fileResult.message === 'string' && fileResult.message !== '';
  // Guaranteed a non-empty string whenever `hookThrew` is true (its own condition above); re-checked
  // rather than cast, so this stays sound if that condition's shape ever changes independently.
  const hookMessage =
    hookThrew && typeof fileResult.message === 'string' ? fileResult.message : undefined;

  if (assertions.length === 0) {
    if (!fileFailed) return [];
    // `message` (Q346, round 6): `rawDetail` is the real, possibly-absent captured text, threaded
    // through separately rather than folded into `name` -- `reporter.ts`'s own identical branch
    // (`outcomesFromVitestFileResult`) used to fold it into the name text alone, which round 6 fixed
    // there after a critic found this structured parser's own twin had the identical gap: `name`
    // never carried the detail AND `message` was never populated at all, dropping the real text
    // silently. `name` keeps its own unqualified "file failed to load" shape so the real detail (when
    // there is one) reaches a consumer exactly once, via `message` alone.
    const rawDetail =
      typeof fileResult.message === 'string' && fileResult.message !== ''
        ? fileResult.message
        : undefined;
    const name = `${file ?? '(unknown file)'} (file failed to load)`;
    return [
      {
        name,
        status: 'fail',
        kind: 'load',
        ...(file === undefined ? {} : { file }),
        ...(rawDetail === undefined ? {} : { message: rawDetail }),
      },
    ];
  }

  const entries: ForgeTestReportEntry[] = [];
  for (const assertion of assertions as readonly VitestAssertionResult[]) {
    const name =
      typeof assertion.fullName === 'string'
        ? assertion.fullName
        : typeof assertion.title === 'string'
          ? assertion.title
          : '';
    if (name === '') continue;
    const rawStatus = mapStatus(assertion.status);
    const hookReclassified = rawStatus === 'skip' && hookThrew;
    const status = hookReclassified ? 'fail' : rawStatus;
    const fileField = file === undefined ? {} : { file };
    if (status !== 'fail') {
      entries.push({ name, status, ...fileField });
    } else {
      entries.push({
        name,
        status: 'fail',
        kind: hookReclassified ? 'crash' : 'assertion',
        ...fileField,
        // `hookMessage` (Q346): the hook's own error text is already captured above for
        // `hookThrew`'s own condition -- carried onto every test it reclassified, rather than
        // computed and then discarded, the real gap a round-2 critic found in this exact branch.
        ...(hookReclassified && hookMessage !== undefined ? { message: hookMessage } : {}),
      });
    }
  }
  return entries;
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Parses `raw` as vitest's own real `--reporter=json` output. */
export function parseVitestJson(raw: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    return { ok: false, message: `not valid JSON: ${describeCause(cause)}` };
  }
  const report = parsed as VitestJsonReport;
  if (!Array.isArray(report.testResults)) {
    return {
      ok: false,
      message:
        'has no real "testResults" array at all -- not a real vitest --reporter=json report.',
    };
  }
  const tests: ForgeTestReportEntry[] = [];
  for (const fileResult of report.testResults as readonly VitestFileResult[]) {
    tests.push(...entriesFromFile(fileResult));
  }
  return { ok: true, tests };
}
