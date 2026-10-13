/**
 * `junit-xml` — one of `13` F-TEST-7 point 2's built-in `forge-test-report` parsers (`09` §9.5, `18`
 * §18.3). A real producer's `<testsuites>` either wraps one or more `<testsuite>` elements (pytest,
 * Jest+jest-junit, Mocha, this monorepo's own installed Vitest) or carries `<testcase>` children
 * directly, with no `<testsuite>` at all (Node's own `--test-reporter=junit`) — both confirmed
 * directly against a real run of each during this piece's own build, so both are walked here.
 *
 * `file` is NEVER read from `classname`: that attribute — the one candidate most JUnit XML consumers
 * reach for — means something DIFFERENT, and sometimes actively misleading, in every one of the five
 * real dialects confirmed directly: pytest/Vitest use it as the real test module; Jest+jest-junit
 * duplicates `name` into it verbatim (with a stray leading space); Mocha puts the BARE test title
 * there while `name` carries the describe-block-prefixed full title (the reverse of pytest's own
 * convention); Node sets it to the literal, useless string `"test"` for every case. Guessing which
 * convention a given producer follows is exactly the kind of guess `13` F-TEST-7 point 5's own
 * degradation rule exists to prevent.
 *
 * `file` IS read from a `<testsuite file="...">` attribute, when present, and attributed to every
 * `<testcase>` that suite directly contains — confirmed real and dialect-unambiguous (unlike
 * `classname`, no producer this parser was built against gives a literal `file` attribute any other
 * meaning): Mocha's own `mocha-junit-reporter` sets it to the real spec file's path. pytest,
 * Jest+jest-junit, this monorepo's own Vitest and Node's `--test-reporter=junit` were each confirmed
 * directly to never set it at all (absent, not merely empty) — this parser attributes nothing by file
 * for those, exactly as the degradation rule requires; it reads the one case that is real.
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
  readonly '@_file'?: unknown;
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

/** `file`, when given, is the enclosing `<testsuite file="...">` attribute (confirmed real for
 * Mocha's own `mocha-junit-reporter`, confirmed absent for every other dialect this parser was built
 * against) — never derived from `classname`, this file's own doc comment has the full reasoning. */
function entryFrom(
  testcase: JunitTestCase,
  file: string | undefined,
): ForgeTestReportEntry | undefined {
  const rawName = testcase['@_name'];
  const name = typeof rawName === 'string' ? rawName.trim() : '';
  // A testcase element with no real name names nothing `forge-test-report` (09 §9.5, name required,
  // non-blank) can report — no real producer this parser was built against ever omits it; dropped
  // rather than fabricated.
  if (name === '') return undefined;
  const durationMs = durationMsFrom(testcase);
  const fileField = file === undefined ? {} : { file };
  if (testcase.failure !== undefined) {
    return {
      name,
      status: 'fail',
      kind: 'assertion',
      ...(durationMs === undefined ? {} : { durationMs }),
      ...fileField,
    };
  }
  if (testcase.error !== undefined) {
    return {
      name,
      status: 'fail',
      kind: 'crash',
      ...(durationMs === undefined ? {} : { durationMs }),
      ...fileField,
    };
  }
  if (testcase.skipped !== undefined) {
    return {
      name,
      status: 'skip',
      ...(durationMs === undefined ? {} : { durationMs }),
      ...fileField,
    };
  }
  return {
    name,
    status: 'pass',
    ...(durationMs === undefined ? {} : { durationMs }),
    ...fileField,
  };
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
  const tests: ForgeTestReportEntry[] = [];
  // Node's own `--test-reporter=junit`: <testcase> children live directly under <testsuites>, with
  // no <testsuite> wrapper at all -- confirmed directly -- so there is no suite-level `file` either.
  for (const testcase of toArray(testsuites.testcase) as readonly JunitTestCase[]) {
    const entry = entryFrom(testcase, undefined);
    if (entry !== undefined) tests.push(entry);
  }
  for (const suite of toArray(testsuites.testsuite) as readonly JunitTestSuite[]) {
    const suiteFile = typeof suite['@_file'] === 'string' ? suite['@_file'] : undefined;
    for (const testcase of toArray(suite.testcase) as readonly JunitTestCase[]) {
      const entry = entryFrom(testcase, suiteFile);
      if (entry !== undefined) tests.push(entry);
    }
  }
  return { ok: true, tests };
}
