/**
 * `PARSERS` — `13` F-TEST-7 point 2's built-in `forge-test-report` parsers, dispatched by a
 * structured `testCommands.<layer>`'s own declared `format` (`18` §18.3).
 *
 * @see specs/09 §9.5
 * @see specs/13 F-TEST-7 point 2
 * @see specs/22 M17 P3
 */
import type { TestReportFormat } from '@forge/schemas/config';

import { parseForgeJson } from './forge-json.ts';
import { parseGoTestJson } from './go-test-json.ts';
import { parseJestJson } from './jest-json.ts';
import { parseJunitXml } from './junit-xml.ts';
import { parseTap } from './tap.ts';
import type { TestReportParser } from './types.ts';
import { parseVitestJson } from './vitest-json.ts';

export type { ParseResult, TestReportParser } from './types.ts';
export { parseForgeJson } from './forge-json.ts';
export { parseGoTestJson } from './go-test-json.ts';
export { parseJestJson } from './jest-json.ts';
export { parseJunitXml } from './junit-xml.ts';
export { parseTap } from './tap.ts';
export { parseVitestJson } from './vitest-json.ts';

/** One built-in parser per `TEST_REPORT_FORMATS` entry (`@forge/schemas/config`) — `pnpm typecheck`
 * itself proves this table is exhaustive: `Record<TestReportFormat, ...>` rejects a missing or
 * extra key at compile time, so a future seventh format cannot silently fall through unparsed. */
export const PARSERS: Record<TestReportFormat, TestReportParser> = {
  'junit-xml': parseJunitXml,
  tap: parseTap,
  'forge-json': parseForgeJson,
  'vitest-json': parseVitestJson,
  'jest-json': parseJestJson,
  'go-test-json': parseGoTestJson,
};
