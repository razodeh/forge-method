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
 *    unverifiable, not silently absent; read as one `kind: 'load'` failure.
 * 2. A `beforeAll`/`afterAll` hook that throws reports EVERY assertion in that file as
 *    `status: 'skipped'` — including one that was genuinely, deliberately `.skip()`-ed, which this
 *    format gives no way to tell apart from a hook's victim — disambiguated only by the file's own
 *    `message` being non-empty (an ordinary file where some other test merely failed also sets the
 *    file `status` to `'failed'`, but leaves `message` empty).
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

  if (assertions.length === 0) {
    if (!fileFailed) return [];
    const detail =
      typeof fileResult.message === 'string' && fileResult.message !== ''
        ? fileResult.message
        : 'failed to load';
    const name = `${file ?? '(unknown file)'} (file failed to load: ${detail})`;
    return [{ name, status: 'fail', kind: 'load', ...(file === undefined ? {} : { file }) }];
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
