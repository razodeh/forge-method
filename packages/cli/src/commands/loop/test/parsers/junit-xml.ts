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
 * `message` (Q346, post-v1.0, `specs/22` M17 P21) IS read from `<failure>`/`<error>`/`<skipped>`'s
 * own `message` attribute or text content (`detailOfJunitElement`, below) — unlike this field's own
 * first cut, which deferred every built-in parser's own capture of it; wired here once delivery past
 * the schema was proven end to end, since the data was already sitting right there, read the same
 * way `durationMs`'s own `@_time` already is.
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

/** The detail text inside a `<failure>`/`<error>`/`<skipped>` element — read exactly the way
 * `fast-xml-parser`'s own `ignoreAttributes: false` shapes one with both a `message` attribute and
 * text content: `{ '@_message': string, '#text': string }` (mirrors `reporter.ts`'s own, pre-existing
 * `detailOfJunitError`, for the legacy path: "pytest's own collection-failure element sets
 * `@_message` to the fixed, uninformative literal 'collection failure' while `#text` carries the
 * real traceback, so `#text` is preferred when present" — confirmed directly there, re-used here
 * rather than re-derived, since the real shape is identical). `value` can also be a bare string (an
 * element with no attributes at all, confirmed directly against this parser's own fixtures: e.g.
 * `<failure>boom</failure>`) or `undefined` (no such child) — both handled defensively. Q346, post-
 * v1.0, `specs/22` M17 P21 (round-3 critic): this is the one capture this parser's own doc comment
 * used to disclose as unread; wired through now that delivery (`outcomeFromReportEntry` ->
 * `TestOutcome` -> `story.ts`'s `namedOutcome`) is proven end to end. */
function detailOfJunitElement(value: unknown): string | undefined {
  if (typeof value === 'string' && value !== '') return value;
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = value as Readonly<Record<string, unknown>>;
  const text = candidate['#text'];
  if (typeof text === 'string' && text !== '') return text;
  const message = candidate['@_message'];
  return typeof message === 'string' && message !== '' ? message : undefined;
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
    const message = detailOfJunitElement(testcase.failure);
    return {
      name,
      status: 'fail',
      kind: 'assertion',
      ...(durationMs === undefined ? {} : { durationMs }),
      ...fileField,
      ...(message === undefined ? {} : { message }),
    };
  }
  if (testcase.error !== undefined) {
    const message = detailOfJunitElement(testcase.error);
    return {
      name,
      status: 'fail',
      kind: 'crash',
      ...(durationMs === undefined ? {} : { durationMs }),
      ...fileField,
      ...(message === undefined ? {} : { message }),
    };
  }
  if (testcase.skipped !== undefined) {
    // `message` (Q346) is valid on `'skip'` too (09 §9.5): a real skip reason, when the dialect
    // gives one. Confirmed directly across all five dialects this parser's own fixtures capture:
    // pytest gives a real reason (`message="demo"`, text "test_sample.py:12: demo" -- text wins);
    // Node's own `--test-reporter=junit` gives the literal, not-very-useful string `"true"`
    // (`<skipped type="skipped" message="true"/>`) -- transcribed honestly, the identical "real but
    // unhelpful" shape `reporter.ts`'s own `detailOfJunitError` already discloses for pytest's
    // collection-failure message; jest-junit's and this monorepo's own Vitest's `<skipped/>` carry
    // neither an attribute nor text at all, so `message` is honestly `undefined` there, never
    // guessed; Mocha drops a deliberate skip from the report entirely (this file's own top doc
    // comment), so there is no `<skipped>` element to read from at all.
    const message = detailOfJunitElement(testcase.skipped);
    return {
      name,
      status: 'skip',
      ...(durationMs === undefined ? {} : { durationMs }),
      ...fileField,
      ...(message === undefined ? {} : { message }),
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
