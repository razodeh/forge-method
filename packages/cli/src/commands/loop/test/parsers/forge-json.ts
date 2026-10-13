/**
 * `forge-json` — one of `13` F-TEST-7 point 2's built-in `forge-test-report` parsers. `09` §9.5's
 * own canonical shape, read directly: a project or translator that already emits `forge-test-report`
 * natively needs no further mapping.
 *
 * @see specs/09 §9.5
 * @see specs/13 F-TEST-7 point 2
 * @see specs/22 M17 P3
 */
import { parseForgeTestReport } from '@forge/schemas';

import type { ParseResult } from './types.ts';

/** Parses `raw` as a `forge-test-report` v1 document (`09` §9.5). */
export function parseForgeJson(raw: string): ParseResult {
  const result = parseForgeTestReport(raw);
  return result.ok
    ? { ok: true, tests: result.report.tests }
    : { ok: false, message: result.message };
}
