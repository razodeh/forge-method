/**
 * `junit-xml` — one of `13` F-TEST-7 point 2's built-in `forge-test-report` parsers (`09` §9.5, `18`
 * §18.3). A real producer's `<testsuites>` either wraps one or more `<testsuite>` elements (pytest,
 * Jest+jest-junit, Mocha, this monorepo's own installed Vitest) or carries `<testcase>` children
 * directly, with no `<testsuite>` at all (Node's own `--test-reporter=junit`) — both confirmed
 * directly against a real run of each during this piece's own build, so both are walked here.
 *
 * `file` is never set on an entry this parser produces: `classname` — the one candidate most JUnit
 * XML consumers read as a file hint — means something DIFFERENT, and sometimes actively misleading,
 * in every one of the five real dialects confirmed directly: pytest/Vitest use it as the real test
 * module; Jest+jest-junit duplicates `name` into it verbatim (with a stray leading space); Mocha
 * puts the BARE test title there while `name` carries the describe-block-prefixed full title (the
 * reverse of pytest's own convention); Node sets it to the literal, useless string `"test"` for
 * every case. Guessing which convention a given producer follows is exactly the kind of guess `13`
 * F-TEST-7 point 5's own degradation rule exists to prevent — every entry this parser returns
 * attributes by name alone.
 *
 * @see specs/09 §9.5
 * @see specs/13 F-TEST-7 point 2, point 5
 * @see specs/22 M17 P3
 */
import { XMLParser } from 'fast-xml-parser';
import type { ForgeTestReportEntry } from '@forge/schemas';

import type { ParseResult } from './types.ts';

interface JunitTestCase {
  readonly '@_name'?: unknown;
  readonly '@_time'?: unknown;
  readonly failure?: unknown;
  readonly error?: unknown;
  readonly skipped?: unknown;
}
interface JunitTestSuite {
  readonly testcase?: unknown;
}
interface JunitTestSuites {
  readonly testsuite?: unknown;
  readonly testcase?: unknown;
}
interface JunitDocument {
  readonly testsuites?: unknown;
}

/** `fast-xml-parser`'s own real, confirmed behaviour: a repeated element becomes an array, a single
 * occurrence stays a bare object. */
function toArray(value: unknown): readonly unknown[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** `@_time`, when a real, finite number of seconds, converted to milliseconds — confirmed present,
 * in seconds, on every one of the five real dialects this parser's own tests capture. Omitted
 * (rather than `NaN`/`0`) when absent or unparseable: a missing duration is honestly absent, never a
 * guessed zero. */
function durationMsFrom(testcase: JunitTestCase): number | undefined {
  const raw = testcase['@_time'];
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

function entryFrom(testcase: JunitTestCase): ForgeTestReportEntry | undefined {
  const rawName = testcase['@_name'];
  const name = typeof rawName === 'string' ? rawName.trim() : '';
  // A testcase element with no real name names nothing `forge-test-report` (09 §9.5, name required,
  // non-blank) can report — no real producer this parser was built against ever omits it; dropped
  // rather than fabricated.
  if (name === '') return undefined;
  const durationMs = durationMsFrom(testcase);
  if (testcase.failure !== undefined) {
    return {
      name,
      status: 'fail',
      kind: 'assertion',
      ...(durationMs === undefined ? {} : { durationMs }),
    };
  }
  if (testcase.error !== undefined) {
    return {
      name,
      status: 'fail',
      kind: 'crash',
      ...(durationMs === undefined ? {} : { durationMs }),
    };
  }
  if (testcase.skipped !== undefined) {
    return { name, status: 'skip', ...(durationMs === undefined ? {} : { durationMs }) };
  }
  return { name, status: 'pass', ...(durationMs === undefined ? {} : { durationMs }) };
}

/** Parses `raw` as a JUnit XML report (any of the real dialects this parser's own tests capture). */
export function parseJunitXml(raw: string): ParseResult {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  let parsed: unknown;
  try {
    parsed = parser.parse(raw);
  } catch (cause) {
    return { ok: false, message: `could not be parsed as XML: ${describeCause(cause)}` };
  }
  // `fast-xml-parser` never throws on malformed-but-syntactically-valid-enough XML (confirmed
  // directly, matching this codebase's own pre-existing `outcomesFromJunitXml` precedent,
  // `reporter.ts`): garbage parses to `{}`, never an exception, so the real "is this JUnit XML at
  // all" check is this explicit shape guard, not a try/catch around the call above.
  const document = parsed as JunitDocument;
  // A genuinely empty, self-closing `<testsuites/>` (no attributes, no children) parses to the bare
  // string `''`, not an object -- confirmed directly. A real, if unusual, report naming zero
  // testsuites, not a malformed one: zero tests, never a tool-error.
  if (document.testsuites === '') return { ok: true, tests: [] };
  if (
    typeof document.testsuites !== 'object' ||
    document.testsuites === null ||
    Array.isArray(document.testsuites)
  ) {
    return {
      ok: false,
      message: 'has no real "testsuites" root element at all -- not a real JUnit XML report.',
    };
  }
  const testsuites = document.testsuites as JunitTestSuites;
  const testcases: JunitTestCase[] = [
    // Node's own `--test-reporter=junit`: <testcase> children live directly under <testsuites>,
    // with no <testsuite> wrapper at all -- confirmed directly, so both shapes are walked.
    ...(toArray(testsuites.testcase) as readonly JunitTestCase[]),
  ];
  for (const suite of toArray(testsuites.testsuite) as readonly JunitTestSuite[]) {
    testcases.push(...(toArray(suite.testcase) as readonly JunitTestCase[]));
  }

  const tests: ForgeTestReportEntry[] = [];
  for (const testcase of testcases) {
    const entry = entryFrom(testcase);
    if (entry !== undefined) tests.push(entry);
  }
  return { ok: true, tests };
}
