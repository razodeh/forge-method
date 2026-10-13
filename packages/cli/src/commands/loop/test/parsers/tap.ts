/**
 * `tap` — one of `13` F-TEST-7 point 2's built-in `forge-test-report` parsers (`09` §9.5, `18`
 * §18.3). TAP13's own test-point line (`ok`/`not ok`, an optional number, an optional `- description`,
 * an optional directive comment -- `SKIP`, or the TAP spec's own not-yet-implemented marker, below
 * this file's own `TAP_DIRECTIVE` regex) is this parser's only real signal; a YAML diagnostic
 * block (` ---` … ` ...`, confirmed directly against real `node --test` output) is recognised and
 * skipped over so its own content is never mistaken for a new test point, but is otherwise never
 * read — TAP carries no file concept and no failure-kind signal finer than pass/fail, so every entry
 * this parser returns omits `file` and reads a real failure as `kind: 'assertion'`, `09` §9.5's own
 * conservative default for exactly this format.
 *
 * Deliberately permissive: an unrecognised line (a bare comment, the version line, the `1..N` plan
 * line, anything else) is silently ignored rather than refused — TAP producers vary, and `13`
 * F-TEST-7 point 2's own "never guess, never crash" contract applies as much to "is this even TAP"
 * as it does to any one line's content. A stream with zero recognised test points parses to zero
 * tests, not a tool-error; the zero-tests guard (`loop/test/run.ts`) is a separate, higher-level
 * concern.
 *
 * @see specs/09 §9.5
 * @see specs/13 F-TEST-7 point 2
 * @see specs/22 M17 P3
 */
import type { ForgeTestReportEntry } from '@forge/schemas';

import type { ParseResult } from './types.ts';

const TAP_POINT = /^(not )?ok\b(?:\s+\d+)?(?:\s*-?\s*(.*))?$/;
const TAP_DIRECTIVE = /^(.*?)\s*#\s*(skip|todo)\b.*$/i;

/** Splits a test point's own trailing description from a directive comment matching
 * `TAP_DIRECTIVE` above (`SKIP`, or the TAP spec's own not-yet-implemented marker) -- TAP13's own
 * two ways of saying "this did not really run as pass or fail." Case-insensitive, per the TAP13
 * spec. */
function splitDirective(description: string): {
  readonly name: string;
  readonly directed: boolean;
} {
  const match = TAP_DIRECTIVE.exec(description);
  if (match === null) return { name: description.trim(), directed: false };
  return { name: (match[1] ?? '').trim(), directed: true };
}

/** Parses `raw` as a TAP (Test Anything Protocol) stream. Never throws. */
export function parseTap(raw: string): ParseResult {
  const tests: ForgeTestReportEntry[] = [];
  const lines = raw.split(/\r?\n/);
  let inDiagnosticBlock = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (inDiagnosticBlock) {
      if (trimmed === '...') inDiagnosticBlock = false;
      continue;
    }
    if (trimmed === '---') {
      inDiagnosticBlock = true;
      continue;
    }
    const pointMatch = TAP_POINT.exec(trimmed);
    if (pointMatch === null) continue; // Version line, plan line, a bare comment -- not a test point.
    const notOk = pointMatch[1] !== undefined;
    const { name, directed } = splitDirective(pointMatch[2] ?? '');
    if (name === '') continue; // No real description at all -- nothing to report.
    if (directed) {
      tests.push({ name, status: 'skip' });
    } else if (notOk) {
      tests.push({ name, status: 'fail', kind: 'assertion' });
    } else {
      tests.push({ name, status: 'pass' });
    }
  }
  return { ok: true, tests };
}
