/**
 * `jest-json` — one of `13` F-TEST-7 point 2's built-in `forge-test-report` parsers. Structurally
 * close to `vitest-json.ts`'s own shape (`assertionResults` nested under a per-file `testResults`
 * entry) — Jest's own JSON reporter was the template Vitest's was modelled after — but confirmed
 * directly, during this piece's own build, to differ in two real ways:
 *
 * 1. Jest's own "this did not run" status is the literal string `"pending"`, not `"skipped"`.
 * 2. Unlike Vitest, Jest needs no hook-exception reclassification: a real `beforeAll` throw next to
 *    a deliberately `.skip()`-ed test was confirmed to report the real test that never ran as
 *    `status: "failed"` DIRECTLY (its own `failureMessages` carrying the hook's error), while the
 *    genuinely skipped one still reads `status: "pending"` — Jest already tells the two apart on its
 *    own, so this parser trusts `status` as given.
 *
 * @see specs/09 §9.5
 * @see specs/13 F-TEST-7 point 2
 * @see specs/22 M17 P3
 */
import type { ForgeTestReportEntry } from '@forge/schemas';

import type { ParseResult } from './types.ts';

interface JestAssertionResult {
  readonly fullName?: unknown;
  readonly title?: unknown;
  readonly status?: unknown;
}
interface JestFileResult {
  readonly assertionResults?: unknown;
  readonly status?: unknown;
  readonly message?: unknown;
  readonly name?: unknown;
}
interface JestJsonReport {
  readonly testResults?: unknown;
}

function mapStatus(status: unknown): 'pass' | 'fail' | 'skip' {
  if (status === 'passed') return 'pass';
  if (status === 'failed') return 'fail';
  return 'skip'; // 'pending', 'disabled', a not-yet-implemented placeholder, or anything else this parser has not seen.
}

function entriesFromFile(fileResult: JestFileResult): readonly ForgeTestReportEntry[] {
  const assertions = Array.isArray(fileResult.assertionResults) ? fileResult.assertionResults : [];
  const fileFailed = fileResult.status === 'failed';
  const file = typeof fileResult.name === 'string' ? fileResult.name : undefined;

  if (assertions.length === 0) {
    if (!fileFailed) return [];
    const detail =
      typeof fileResult.message === 'string' && fileResult.message !== ''
        ? fileResult.message
        : 'failed to run';
    const name = `${file ?? '(unknown file)'} (file failed to load: ${detail})`;
    return [{ name, status: 'fail', kind: 'load', ...(file === undefined ? {} : { file }) }];
  }

  const entries: ForgeTestReportEntry[] = [];
  for (const assertion of assertions as readonly JestAssertionResult[]) {
    const name =
      typeof assertion.fullName === 'string'
        ? assertion.fullName
        : typeof assertion.title === 'string'
          ? assertion.title
          : '';
    if (name === '') continue;
    const status = mapStatus(assertion.status);
    const fileField = file === undefined ? {} : { file };
    entries.push(
      status !== 'fail'
        ? { name, status, ...fileField }
        : { name, status: 'fail', kind: 'assertion', ...fileField },
    );
  }
  return entries;
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Parses `raw` as Jest's own real `--json` output. */
export function parseJestJson(raw: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    return { ok: false, message: `not valid JSON: ${describeCause(cause)}` };
  }
  const report = parsed as JestJsonReport;
  if (!Array.isArray(report.testResults)) {
    return {
      ok: false,
      message: 'has no real "testResults" array at all -- not a real jest --json report.',
    };
  }
  const tests: ForgeTestReportEntry[] = [];
  for (const fileResult of report.testResults as readonly JestFileResult[]) {
    tests.push(...entriesFromFile(fileResult));
  }
  return { ok: true, tests };
}
