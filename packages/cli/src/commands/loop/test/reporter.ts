/**
 * `runAndNormalize` — `09` §9.5's own normalised test-result reporter, for real: shells one
 * `testCommands` entry, reads the tool's own real machine output, and normalises it into one shared
 * shape both ecosystems produce. Also `writeNormalizedReport`/`readNormalizedReport`, the
 * `docs/forge/reports/test-results.json` round-trip every later `forge test *` piece reads from.
 *
 * @see specs/09 §9.5
 * @see PLAN-M8.md P3
 */
import { readFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';

import { ForgeError } from '@forge/core';
import { readTextFile, writeFileAtomic, type ProjectPaths } from '@forge/core/fs';
import { runShellCommand } from '@forge/engine/dispatch';
import { XMLParser } from 'fast-xml-parser';

import { extractAcId } from './ac-binding.ts';
import { containsShellChaining } from './shell-safety.ts';

/** Why a `'fail'` outcome failed (`specs/22` M16 P10, `13` F-TEST-10's own load-failure rule, which
 * needs to tell "the file would not load" from "an assertion ran and lost" to decide a hunk's verdict
 * by the KIND of mutant, not the bare fact of failure): `'assertion'` — a test body ran to completion
 * and an assertion (or an ordinary thrown error inside it) failed; `'load'` — the file could not be
 * imported/collected at all, before any test body ran (vitest's own synthetic file-level failure, or
 * pytest's own whole-module collection error); `'timeout'` — the test command itself was killed for
 * outliving its limit, so NOTHING about this outcome was actually observed; `'crash'` — the runner or
 * a lifecycle hook (vitest's `beforeAll`/`afterAll`, pytest's own setup/fixture) died with something
 * that is not an assertion, for a test that WAS otherwise named and collected. `undefined` for
 * `'pass'`/`'skip'` — there is nothing to classify about a outcome that did not fail. */
export type TestFailureKind = 'assertion' | 'load' | 'timeout' | 'crash';

/** One test's own real outcome — `09` §9.5's own binding rule made concrete. `acId` is `undefined`
 * when `extractAcId` finds no AC id in `name` at all (not every test proves an AC; F-TEST-1's own
 * pyramid has plenty of tests with no AC binding). `file` — vitest's own real absolute file path, or
 * pytest's own real junit-xml `classname` attribute (a dotted module path, e.g. `sub.dir.test_foo`
 * for `sub/dir/test_foo.py`) — qualifies `name`, which is **not** unique on its own: a fresh critic
 * round (P7) reproduced directly that two different tests sharing a literal title/name in two
 * different files (an entirely ordinary occurrence — `test_serialize`/`test_init`/etc. recur across
 * real Python test modules constantly) were silently conflated by every consumer that keyed off
 * `name` alone, letting a real, deterministic failure in one file get misclassified as "flaky" by a
 * same-named passing test in another. `file` is `undefined` only when the underlying tool's own
 * output did not name a real file for this outcome (an edge case, not the common path). `kind` is an
 * ADDITIVE field (`specs/22` M16 P10): present only for `status: 'fail'`, absent for `'pass'`/`'skip'`
 * — an existing caller that reads only `status` (every M15 caller) keeps working unchanged. */
export interface TestOutcome {
  readonly name: string;
  readonly acId: string | undefined;
  readonly status: 'pass' | 'fail' | 'skip';
  readonly file?: string;
  readonly kind?: TestFailureKind;
}

/** Builds a `TestOutcome`, omitting `file`/`kind` entirely rather than setting them `undefined` —
 * `exactOptionalPropertyTypes` treats the two differently, and this project's own convention (already
 * established by this file's pre-existing `file === undefined ? {...} : {...file}` branches) is to
 * omit, never to assign `undefined` to an optional key. One shared builder rather than four duplicated
 * ternaries (one per vitest/pytest call site, now that `kind` doubles the branching), so the omission
 * rule is enforced in one place. */
function makeOutcome(
  name: string,
  status: 'pass' | 'fail' | 'skip',
  file?: string,
  kind?: TestFailureKind,
): TestOutcome {
  return {
    name,
    acId: extractAcId(name),
    status,
    ...(file === undefined ? {} : { file }),
    ...(kind === undefined ? {} : { kind }),
  };
}

/** The per-run timeout `runAndNormalize` applies when its caller does not override it (`specs/22` M16
 * P10's own "every run of the project's test command gets a timeout" fix). 1,200,000 ms (20 minutes):
 * the SAME number `@forge/engine/dispatch`'s own `ENGINE_COMMAND_LIMITS` (`confined-command.ts`)
 * already uses, whose own doc comment names exactly these two callers — "`forge test run`, the revert
 * check" — as what it is for. Not imported from there (that constant is not re-exported through the
 * `@forge/engine/dispatch` barrel today, and adding it would mean editing `dispatch/index.ts`, a file
 * this milestone's OTHER, concurrently-built chain (the parity-oracle pieces) may also be touching in
 * a sibling worktree): this is the same number, deliberately not the same import, to keep this piece's
 * diff inside the files its own brief names. */
export const DEFAULT_TEST_RUN_TIMEOUT_MS = 1_200_000;

/** The synthetic outcome `runVitest`/`runPytest` return for a whole-run timeout, in place of whatever
 * partial, truncated stdout or on-disk report the killed process left behind — `ShellCommandResult`'s
 * own doc comment (`@forge/engine/dispatch`) is explicit that `timedOut` fires only once the WHOLE
 * process group has been sent `SIGKILL`, so nothing after this point is real data from a completed
 * run. Carries no `file`: the run was scoped to however many files `files`/`fileFilter` named, and
 * which of them (if any) had already finished when the kill landed is genuinely unknown — inventing a
 * file would let this outcome be credited as binding evidence for tests that may never have run at
 * all (`13` F-TEST-10's own "do not let a timeout masquerade as a fail that then gets credited"),
 * which omitting `file` prevents structurally (`namesFailedUnderMutation`'s own file-matching never
 * fires for an outcome with no file) as well as by `runBindingCheck`'s own explicit check. */
function timeoutOutcome(timeoutMs: number): TestOutcome {
  return makeOutcome(
    `test command timed out after ${String(timeoutMs)}ms and was killed`,
    'fail',
    undefined,
    'timeout',
  );
}

/** `runAndNormalize`'s own real, normalised result — the one shape both ecosystems produce. */
export interface NormalizedTestReport {
  readonly outcomes: readonly TestOutcome[];
}

/** `runAndNormalize`'s own return value — never throws for an ordinary, real-world failure (a
 * layer with no configured command, a tool that fails to run, a tool that produces unparseable
 * output): each becomes a real, typed outcome a caller can act on. `'tool-error'` carries enough of
 * the underlying command's own real stdout/stderr for a caller to actually diagnose what happened,
 * not just that something did. */
export type RunAndNormalizeResult =
  | { readonly outcome: 'ran'; readonly report: NormalizedTestReport }
  | { readonly outcome: 'missing-command' }
  | { readonly outcome: 'tool-error'; readonly message: string };

// --- vitest (js) ---------------------------------------------------------------------------------

/** vitest's own real `--reporter=json` shape, confirmed directly against real runs in this
 * environment during this piece's own build (not assumed from documentation):
 * `{ testResults: [ { assertionResults: [ { title, fullName, status: 'passed'|'failed'|'skipped' } ], status: 'passed'|'failed', message } ] }`.
 * A fresh critic round confirmed two real gaps a purely-`assertionResults`-shaped read misses
 * entirely: (1) a file that fails to *load* (an unresolved import) reports `assertionResults: []`
 * with the file's own `status: 'failed'` — dropping every one of that file's ACs from the report
 * with zero signal, rather than a real failure; (2) a test that never ran because a `beforeAll`
 * hook threw reports `status: 'skipped'`, indistinguishable from a deliberate `test.skip()`, unless
 * the file's own `message` field (non-empty only on a genuine hook-level exception — verified
 * directly against both a throwing-hook fixture and an ordinary mixed pass/fail/skip fixture) says
 * otherwise. Both are handled below rather than read defensively-into-silence. */
interface VitestAssertionResult {
  readonly title?: unknown;
  readonly fullName?: unknown;
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

function mapVitestStatus(status: unknown): 'pass' | 'fail' | 'skip' {
  if (status === 'passed') return 'pass';
  if (status === 'failed') return 'fail';
  return 'skip';
}

function outcomesFromVitestFileResult(fileResult: VitestFileResult): readonly TestOutcome[] {
  const assertions = Array.isArray(fileResult.assertionResults) ? fileResult.assertionResults : [];
  const fileFailed = fileResult.status === 'failed';
  const fileName = typeof fileResult.name === 'string' ? fileResult.name : undefined;
  // A genuine hook-level exception (verified directly): the file's own `message` is non-empty. An
  // ordinary file where *some other* test simply failed also reports the file `status` as
  // `'failed'` (the aggregate reflects its worst test), but leaves `message` empty — the
  // distinguishing signal this reclassification relies on, so a real, deliberate `test.skip()`
  // sitting next to an unrelated failing test in the same file is never wrongly reclassified.
  const hookThrew =
    fileFailed && typeof fileResult.message === 'string' && fileResult.message !== '';

  if (assertions.length === 0) {
    if (!fileFailed) return [];
    // The whole file failed to load (an unresolved import, a syntax error) — every AC any of its
    // tests would have proven is unverifiable, not silently absent from the report. `kind: 'load'`
    // (`specs/22` M16 P10): the file never got far enough to run a single test body, so this is the
    // "stillborn mutant" case `13` F-TEST-10's load-failure rule names, not an assertion failure.
    const detail =
      typeof fileResult.message === 'string' && fileResult.message !== ''
        ? fileResult.message
        : 'failed to load';
    const outcomeName = `${fileName ?? '(unknown file)'} (file failed to load: ${detail})`;
    return [makeOutcome(outcomeName, 'fail', fileName, 'load')];
  }

  const outcomes: TestOutcome[] = [];
  for (const assertion of assertions as readonly VitestAssertionResult[]) {
    const name =
      typeof assertion.fullName === 'string'
        ? assertion.fullName
        : typeof assertion.title === 'string'
          ? assertion.title
          : '';
    const rawStatus = mapVitestStatus(assertion.status);
    // A hook exception (`hookThrew`) reclassifies a reported 'skip' into a real 'fail' — `kind:
    // 'crash'` (`specs/22` M16 P10): the test body never ran either, but not because the FILE failed
    // to load (it loaded fine); a lifecycle hook died with something that is not an assertion, which
    // is exactly what 'crash' names. An ordinary failing assertionResult (the test body ran and lost)
    // is 'assertion'; 'pass'/unreclassified 'skip' carry no kind at all.
    const hookReclassified = rawStatus === 'skip' && hookThrew;
    const status = hookReclassified ? 'fail' : rawStatus;
    const kind: TestFailureKind | undefined =
      status !== 'fail' ? undefined : hookReclassified ? 'crash' : 'assertion';
    outcomes.push(makeOutcome(name, status, fileName, kind));
  }
  return outcomes;
}

function outcomesFromVitestJson(raw: string): readonly TestOutcome[] {
  const parsed = JSON.parse(raw) as VitestJsonReport;
  // `specs/22` M16 P10 (a fresh critic round): `JSON.parse` happily accepts any real JSON at all —
  // `'{}'`, `'[]'`, `'42'` — none of which is a real vitest `--reporter=json` report. Confirmed
  // directly that, before this check, each of those silently produced `outcomes: []` (every
  // `fileResults` entry defaulting away a MISSING `testResults`, never a real one that happens to be
  // empty — confirmed separately that a real, zero-tests-matched run always still reports
  // `testResults: []`, a real array, not an absent key) — indistinguishable from "ran and found
  // nothing to do," which is a real binding/pass verdict this is not entitled to report. Thrown here,
  // not swallowed: both real callers (`runVitest`'s own try/catch) already convert any thrown error
  // into a real, diagnosable `'tool-error'`.
  if (!Array.isArray(parsed.testResults)) {
    throw new Error(
      'vitest JSON output has no real "testResults" array at all -- not a real vitest --reporter=json report.',
    );
  }
  const outcomes: TestOutcome[] = [];
  for (const fileResult of parsed.testResults as readonly VitestFileResult[]) {
    outcomes.push(...outcomesFromVitestFileResult(fileResult));
  }
  return outcomes;
}

/** Escapes every real JS regex metacharacter in `text` — vitest's own real `-t`/`--testNamePattern`
 * flag (confirmed directly against a real run in this environment during this piece's own build)
 * takes the raw string as a **regex**, not a literal substring: a test name containing any of these
 * characters (an ordinary `expect(x)`-shaped title, e.g.) silently matches nothing at all — reported
 * as `status: "skipped"`, not an error — unless every metacharacter is escaped first. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function runVitest(
  command: string,
  cwd: string,
  timeoutMs: number,
  testNameFilter?: string,
  fileFilter?: string,
  files?: readonly string[],
): Promise<
  | { readonly ok: true; readonly outcomes: readonly TestOutcome[] }
  | { readonly ok: false; readonly message: string }
> {
  // A fresh critic round (P4) reproduced this directly against this exact append-a-flag pattern: a
  // real, ordinary `testCommands` value that chains shell commands (`"vitest run && echo done"`)
  // silently misroutes `--reporter=json` onto whichever command ends up last — `shell-safety.ts`'s
  // own doc comment has the full reasoning.
  if (containsShellChaining(command)) {
    return {
      ok: false,
      message: `testCommands value ("${command}") contains shell chaining (&&, ||, ;, |, redirection, or command substitution) — cannot safely append --reporter=json to it.`,
    };
  }
  // `testNameFilter` (P7's own retry-in-isolation, `run.ts`) is anchored (`^...$`) and regex-escaped
  // so it matches this one exact test name, verbatim — confirmed directly against a real run: an
  // un-anchored, un-escaped pattern can match more than the one intended test (a shorter test name
  // that is itself a substring of a longer one, e.g.), silently retrying the wrong set. `fileFilter`
  // (`TestOutcome.file`, when known — a real absolute path) additionally scopes the run to just that
  // one real file — a fresh critic round reproduced directly that a name-only `-t` filter alone still
  // matches every file sharing that literal test title, silently retrying the wrong one. Passed to
  // vitest as a path *relative to `cwd`*, not the absolute path verbatim: a second, separate critic
  // reproduction confirmed directly that vitest treats a positional file argument as a pattern
  // matched against paths relative to its own `--root`, not a literal absolute path — an absolute
  // path positional silently matched zero files (`numTotalTests: 0`), not an error. `cwd` is
  // realpath-resolved before computing that relative path: a *third* reproduction (the identical
  // symlink-mismatch class `coverage.ts`'s own `fileCoverageCountsFrom` already documents for
  // `PLAN-M8.md` P6) confirmed vitest's own `fileResult.name` is always realpath-resolved, while
  // `cwd` (`run.ts`'s own `ctx.projectRoot`) is not guaranteed to be — on macOS, where `/tmp`/`/var`
  // are themselves symlinks (exactly what `mkdtemp`'s own real temp directories sit behind), the
  // un-resolved mismatch produced a `path.relative` result matching zero real files, silently
  // defaulting every retry on that host to "not a flake" with no error at all.
  // `files` (`PLAN-M14.md` P26, `story.ts`'s own validated test-path list — plural, no `testNameFilter`,
  // never combined with the single-file `fileFilter` above) is already project-relative, exactly the
  // form `validateTestPath` returns: unlike `fileFilter` (an absolute path off vitest's own prior JSON
  // output) it needs no `realpath`/`relative` conversion, just one shell-quoted positional argument per
  // file, space-joined — vitest accepts any number of positional file arguments in one invocation.
  const fileArg =
    files !== undefined && files.length > 0
      ? ` ${files.map((file) => shellQuote(file)).join(' ')}`
      : fileFilter === undefined
        ? ''
        : ` ${shellQuote(path.relative(await realpath(cwd), fileFilter))}`;
  const filterFlag =
    testNameFilter === undefined ? '' : ` -t ${shellQuote(`^${escapeRegExp(testNameFilter)}$`)}`;
  const result = await runShellCommand(
    `${command}${fileArg} --reporter=json${filterFlag}`,
    cwd,
    undefined,
    { timeoutMs },
  );
  // Checked BEFORE any attempt to parse `stdout` (`specs/22` M16 P10): confirmed directly against a
  // real, killed vitest run that a `SIGKILL` mid-test leaves `stdout` empty, never a truncated JSON
  // fragment — parsing it anyway would either throw (routing a real timeout through the generic
  // "unparseable output" tool-error, indistinguishable from any other crash) or, worse, succeed on
  // some unrelated leftover content and silently misreport. A real timeout is never a pass and never
  // a guess at truncated data; it is the one, typed `timeoutOutcome` below.
  if (result.timedOut === true) {
    return { ok: true, outcomes: [timeoutOutcome(timeoutMs)] };
  }
  try {
    return { ok: true, outcomes: outcomesFromVitestJson(result.stdout) };
  } catch (cause) {
    return {
      ok: false,
      message: `vitest produced unparseable output (exit ${String(result.exitCode)}): ${describeCause(cause)}. stderr: ${truncate(result.stderr)}`,
    };
  }
}

// --- pytest (python) ------------------------------------------------------------------------------

/** pytest's own real, **built-in** JUnit-XML writer (`--junitxml=<path>`, no plugin required),
 * confirmed directly against a real run in this environment during this piece's own build — the
 * plan's own first draft assumed `--json-report` (needs the third-party `pytest-json-report`
 * plugin, confirmed **not installed** here); this is the zero-extra-dependency, equally-real
 * alternative, per `PLAN-M8.md` P3's own corrected Surface text. Real, confirmed shape (via
 * `fast-xml-parser`, `ignoreAttributes: false, attributeNamePrefix: '@_'`):
 * `testsuites.testsuite.testcase` (a bare object for exactly one testcase, an array for more than
 * one — normalised via `toArray` below), each carrying `@_name` and, only on a real failure/skip/
 * error, a child `failure`/`skipped`/`error` object. A fresh critic round confirmed directly that a
 * setup/fixture/collection error produces a child `error` element, **not** `failure` — a missing
 * fixture or a `conftest.py` exception was previously falling through to `'pass'` because neither
 * of the two fields this code checked was ever set.
 *
 * `@_classname` carries a SECOND, distinct real shape, confirmed directly against pytest 8.4.2 (a
 * real broken-import fixture, run with `--junitxml`, `specs/22` M16 P10): a whole-MODULE collection
 * failure (an import that throws before pytest can even discover that module's own real tests) is
 * reported as one pseudo-`<testcase>` whose `@_classname` is the EMPTY STRING and whose `@_name` is
 * what every REAL test in that module would otherwise carry as ITS OWN `@_classname` — the dotted
 * module path (`sub.dir.test_broken`, confirmed directly, not `sub/dir/test_broken.py`) — with the
 * error nested inside it. This is backwards from every other row's convention (`@_classname` is the
 * module, `@_name` is the one test) and is pytest's only signal that this is not a real, collected
 * test at all; `outcomesFromJunitXml` below reads it to recover vitest-equivalent "the whole file
 * failed to load" crediting (`13` F-TEST-10's load-failure rule). An ORDINARY per-test setup/fixture
 * error (the one this doc comment's own prior paragraph already covers — a real, named, collected
 * test whose OWN `@_classname` is non-empty) is a DIFFERENT, narrower case and is not this one. */
interface JunitTestCase {
  readonly '@_name'?: unknown;
  readonly '@_classname'?: unknown;
  readonly failure?: unknown;
  readonly error?: unknown;
  readonly skipped?: unknown;
}

/** The detail text inside a junit-xml `<failure>`/`<error>` element, read exactly the way
 * `fast-xml-parser`'s own `ignoreAttributes: false` shapes one with both a `message` attribute and
 * text content: `{ '@_message': string, '#text': string }` (confirmed directly: pytest's own
 * collection-failure element sets `@_message` to the fixed, uninformative literal `"collection
 * failure"` while `#text` carries the real traceback, so `#text` is preferred when present).
 * `value` can also be a bare string (an element with no attributes at all) or `undefined` (no such
 * child) — both handled defensively, the same "never assume a shape sight-unseen" stance this file's
 * `VitestFileResult`/`JunitTestCase` fields already take. */
function detailOfJunitError(value: unknown): string | undefined {
  if (typeof value === 'string' && value !== '') return value;
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = value as Readonly<Record<string, unknown>>;
  const text = candidate['#text'];
  if (typeof text === 'string' && text !== '') return text;
  const message = candidate['@_message'];
  return typeof message === 'string' && message !== '' ? message : undefined;
}
interface JunitTestSuite {
  readonly testcase?: unknown;
}
interface JunitTestSuites {
  readonly testsuite?: unknown;
}
interface JunitDocument {
  readonly testsuites?: unknown;
}

/** `fast-xml-parser`'s own real, confirmed behaviour: a repeated element becomes an array, a single
 * occurrence stays a bare object — normalised here once rather than at every call site. Typed
 * `unknown` deliberately (not a generic `T`): the caller already casts the *result*, and a generic
 * parameter here fights `Array.isArray`'s own narrowing for no real benefit. */
function toArray(value: unknown): readonly unknown[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function outcomesFromJunitXml(xml: string): readonly TestOutcome[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const parsed = parser.parse(xml) as JunitDocument;
  // `specs/22` M16 P10 (a fresh critic round): `fast-xml-parser` never throws, confirmed directly
  // against an empty string, garbage text and a well-formed-but-unrelated document — each parses to
  // `{}` (or, for a totally-empty `<testsuites/>` no real pytest run ever produces, the bare string
  // `""`), never an exception. Before this check, `toArray(testsuites?.testsuite)` silently read
  // either shape as "zero testsuites" and returned `outcomes: []` — indistinguishable from a real,
  // completed run that happened to collect nothing, confirmed separately to always report a real
  // `<testsuite tests="0" .../>` object, never an absent or stringified `testsuites`. Thrown here,
  // not swallowed: `runPytest`'s own try/catch already converts any thrown error into a real,
  // diagnosable `'tool-error'`.
  if (
    typeof parsed.testsuites !== 'object' ||
    parsed.testsuites === null ||
    Array.isArray(parsed.testsuites)
  ) {
    throw new Error(
      'pytest junit-xml output has no real "testsuites" element at all -- not a real pytest --junitxml report.',
    );
  }
  // Sound: the guard just above refuses every shape other than a real, non-array object -- the one
  // real, confirmed shape pytest's own junit-xml root element ever parses to.
  const testsuites = parsed.testsuites as JunitTestSuites;
  const outcomes: TestOutcome[] = [];
  for (const suite of toArray(testsuites.testsuite) as readonly JunitTestSuite[]) {
    for (const testcase of toArray(suite.testcase) as readonly JunitTestCase[]) {
      const name = typeof testcase['@_name'] === 'string' ? testcase['@_name'] : '';
      // `@_classname` — a real, dotted module path (`sub.dir.test_foo` for `sub/dir/test_foo.py`) —
      // qualifies `name`, which pytest itself never guarantees unique across files (`TestOutcome`'s
      // own doc comment has the fuller reasoning).
      const classname =
        typeof testcase['@_classname'] === 'string' ? testcase['@_classname'] : undefined;

      // pytest's own whole-module collection-failure shape (`JunitTestCase`'s own doc comment has the
      // real, confirmed XML): `classname` EMPTY and an `error` child, with `name` carrying what a REAL
      // test from this module would otherwise report as ITS OWN `classname`. Reclassified into the
      // SAME role vitest's own synthetic file-failure outcome already plays (`kind: 'load'`, `file`
      // set to that module path) so `binding.ts`'s `namesFailedUnderMutation` credits every one of
      // the module's baseline-passing tests exactly as a vitest run already does for the identical
      // shape (`13` F-TEST-10, Q294 Decision 8) — the asymmetry this piece fixes.
      if (classname === '' && testcase.error !== undefined) {
        const detail = detailOfJunitError(testcase.error) ?? 'collection failure';
        const outcomeName = `${name} (file failed to load: ${detail})`;
        outcomes.push(makeOutcome(outcomeName, 'fail', name, 'load'));
        continue;
      }

      const status: 'pass' | 'fail' | 'skip' =
        testcase.failure !== undefined || testcase.error !== undefined
          ? 'fail'
          : testcase.skipped !== undefined
            ? 'skip'
            : 'pass';
      // `'assertion'` — a real, named test ran and its own `<failure>` fired. `'crash'` — a real,
      // named, COLLECTED test's own setup/fixture died (`<error>`, non-empty classname: a narrower
      // case than the whole-module collection failure just above, which this branch never reaches).
      const kind: TestFailureKind | undefined =
        testcase.failure !== undefined
          ? 'assertion'
          : testcase.error !== undefined
            ? 'crash'
            : undefined;
      outcomes.push(makeOutcome(name, status, classname, kind));
    }
  }
  return outcomes;
}

/** POSIX single-quoting: wraps `value` in `'...'`, escaping any embedded `'` as `'\''` — the
 * standard technique for a shell-safe literal. `xmlPath` is FORGE's own, not project-authored, but a
 * fresh critic round found it was still being interpolated unquoted (`R11`): `os.tmpdir()` commonly
 * contains a space on real systems (a per-user macOS/Windows temp root, e.g.), which an unquoted
 * interpolation would split into two shell arguments. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Converts `TestOutcome.file`'s own real, dotted junit `classname` (`sub.dir.test_foo`) back into a
 * real, addressable pytest file path (`sub/dir/test_foo.py`) — the reverse of what pytest's own
 * junit-xml writer does going the other way. A real, disclosed edge case: a directory or module name
 * that itself contains a literal `.` would round-trip incorrectly (indistinguishable from a package
 * separator) — accepted as out of scope, matching this codebase's own "a real, disclosed limitation,
 * not a silent guess" convention elsewhere in this file. */
function classnameToPath(classname: string): string {
  return `${classname.replaceAll('.', '/')}.py`;
}

async function runPytest(
  command: string,
  cwd: string,
  createTempPath: () => string,
  timeoutMs: number,
  testNameFilter?: string,
  fileFilter?: string,
  files?: readonly string[],
): Promise<
  | { readonly ok: true; readonly outcomes: readonly TestOutcome[] }
  | { readonly ok: false; readonly message: string }
> {
  if (containsShellChaining(command)) {
    return {
      ok: false,
      message: `testCommands value ("${command}") contains shell chaining (&&, ||, ;, |, redirection, or command substitution) — cannot safely append --junitxml to it.`,
    };
  }
  // `files` (`PLAN-M14.md` P26): pytest's own real positional form — one or more file paths given
  // directly on the command line, each shell-quoted — rather than `-k`/a node id (that form still needs
  // `testNameFilter`, below, which `files` is never combined with). Unlike the `-k`/node-id filter flag,
  // this positional form works with no test name at all: `fileFilter` alone, with no `testNameFilter`,
  // is never a real call shape below and stays ignored, exactly as before.
  const fileArgs =
    files !== undefined && files.length > 0
      ? ` ${files.map((file) => shellQuote(file)).join(' ')}`
      : '';
  // `testNameFilter` (P7's own retry-in-isolation, `run.ts`) is addressed by a real, exact pytest
  // node id (`<file>::<name>`) whenever `fileFilter` (`TestOutcome.file`) is also known — a fresh
  // critic round reproduced directly that the first draft's `-k <name>` substring/expression match
  // (a) selects every test whose name merely *contains* `name` as a substring, not just the one
  // intended, (b) fails outright with a real pytest parse error for an entirely ordinary parametrized
  // test id containing `[`/`]`/a space (`test_param[a b]`), and pytest still exits with a *valid*,
  // empty junit-xml in that failure case — silently recorded as "not flaky" rather than a real
  // problem. A node id has none of these failure modes: it is matched as a literal path, never
  // parsed as an expression. Falls back to the old `-k` form only when `fileFilter` is unavailable
  // (an edge case — `TestOutcome.file` is populated for every real junit-xml `testcase` this codebase
  // has ever observed, confirmed directly against real pytest 8.4.2 output). */
  const xmlPath = `${createTempPath()}.xml`;
  const filterFlag =
    testNameFilter === undefined
      ? ''
      : fileFilter === undefined
        ? ` -k ${shellQuote(testNameFilter)}`
        : ` ${shellQuote(`${classnameToPath(fileFilter)}::${testNameFilter}`)}`;
  try {
    // `--continue-on-collection-errors` (`specs/22` M16 P10): confirmed directly against a real
    // pytest 8.4.2 run that WITHOUT this flag, one file's collection error ("ImportError while
    // importing test module ...") makes pytest print "Interrupted: 1 error during collection" and
    // refuse to run ANY other file at all — a sibling, otherwise-healthy file's own tests are then
    // completely absent from the junit-xml (not failed, not skipped — simply never attempted), the
    // exact opposite of vitest's own shipped, per-file-independent behaviour (confirmed directly:
    // vitest still runs and reports a sibling file normally when one file fails to load). With the
    // flag, pytest collects and runs every other file normally and reports only the one broken
    // module as a collection failure — the real parity this piece's own asymmetry fix needs, since
    // `binding.ts`/`run.ts` can scope one invocation to more than one file.
    const result = await runShellCommand(
      `${command}${fileArgs} --continue-on-collection-errors --junitxml=${shellQuote(xmlPath)}${filterFlag}`,
      cwd,
      undefined,
      { timeoutMs },
    );
    // Checked BEFORE any attempt to read `xmlPath` (`specs/22` M16 P10): confirmed directly against a
    // real, killed pytest run that a `SIGKILL` mid-test leaves no junit-xml file at all (pytest writes
    // it only once, from its own session-finish hook, which a kill never lets run) — reading it would
    // throw into the generic "no real junit-xml output" tool-error, indistinguishable from any other
    // reason pytest might not have written one. The same reasoning as `runVitest`'s identical check.
    if (result.timedOut === true) {
      return { ok: true, outcomes: [timeoutOutcome(timeoutMs)] };
    }
    let xml: string;
    try {
      xml = await readTextFileAt(xmlPath);
    } catch (cause) {
      return {
        ok: false,
        message: `pytest produced no real junit-xml output (exit ${String(result.exitCode)}): ${describeCause(cause)}. stderr: ${truncate(result.stderr)}`,
      };
    }
    try {
      return { ok: true, outcomes: outcomesFromJunitXml(xml) };
    } catch (cause) {
      return {
        ok: false,
        message: `pytest's own junit-xml output could not be parsed: ${describeCause(cause)}.`,
      };
    }
  } finally {
    await rm(xmlPath, { force: true });
  }
}

/** A plain, unbranded read: the junit-xml file lives outside the target project's own
 * `ProjectPaths`-contained tree entirely (a fresh OS temp path this function owns start to finish),
 * so `@forge/core/fs`'s `AbsolutePath`/`resolveWithin` containment (for paths *inside* a project)
 * does not apply here. */
async function readTextFileAt(absolutePath: string): Promise<string> {
  return readFile(absolutePath, 'utf8');
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function truncate(text: string): string {
  return text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
}

// --- dispatch --------------------------------------------------------------------------------

/** `createTempPath` — `QUALITY-BAR.md` R10: this function's own pytest branch needs a real, unique
 * OS temp file path, and R10 forbids reading `crypto.randomUUID()`/`os.tmpdir()` directly in
 * production code. A real caller passes `createSystemTempPath` (`system-temp.ts`, this package's
 * one narrowly-exempted source of that fact — the identical `Clock`/`SYSTEM_CLOCK` split
 * `@forge/core/clock.ts` already establishes); a test injects a deterministic fake. Unused on the
 * JS/vitest branch, but still required unconditionally — one plain, uniform signature rather than
 * an ecosystem-conditional one for a single extra argument.
 *
 * `ecosystem` is deliberately `'js' | 'python'`, not the full `Ecosystem` type `detectEcosystem`
 * returns (`'js' | 'python' | 'unknown'`) — a fresh critic round found the first draft silently
 * routed anything that wasn't `'python'` into the vitest branch, meaning an `'unknown'` project got
 * a real command run and its output blindly parsed as vitest JSON. Resolving what to do about an
 * unrecognised ecosystem is a real, project-facing decision that belongs to this function's own
 * caller (the `forge test run` CLI layer, `PLAN-M8.md` P4), not something this function should ever
 * see as a valid input to guess through.
 *
 * `testNameFilter`/`fileFilter`, when given, scope this exact invocation to the one real test named,
 * in the one real file named (`TestOutcome.file`) — `run.ts`'s own retry-in-isolation step
 * (`PLAN-M8.md` P7, F-TEST-6) is this pair's only real caller. `fileFilter` alone (with no
 * `testNameFilter`) is never a real call shape and is ignored.
 *
 * `files` (`PLAN-M14.md` P26), when given, scopes this invocation to exactly that closed, already
 * project-relative list of real test files, positionally — `run.ts`'s own `TestRunOptions.files` is
 * this parameter's only real caller (`story.ts`'s own validated story test-path list); never combined
 * with `testNameFilter`/`fileFilter` above, a different pair with a different real caller.
 *
 * Overloaded, not one flat `string | undefined` signature: `'missing-command'` is only ever real for
 * a caller that genuinely does not have a command yet (`run.ts`'s own `command === undefined`
 * continue-guard runs *before* either of its own two call sites here) — encoding that at the type
 * level lets a caller who already has a real `string` command narrow `RunAndNormalizeResult` down to
 * `'ran' | 'tool-error'` itself, rather than needing a defensive `'missing-command'` check of its own
 * that could never actually fire.
 *
 * `timeoutMs` (`specs/22` M16 P10), when given, overrides `DEFAULT_TEST_RUN_TIMEOUT_MS` for this one
 * invocation — `bin.ts`'s own `--timeout-ms` flag on `forge test run`/`forge test binding` is the
 * real caller that ever passes one; every other caller omits it and gets the default. A run that
 * outlives it is killed (the whole process group, `@forge/engine/dispatch`'s own `ShellLimits`) and
 * reported as a typed `'timeout'`-kind outcome, never a pass and never a guess at partial output. */
export async function runAndNormalize(
  command: string,
  cwd: string,
  ecosystem: 'js' | 'python',
  createTempPath: () => string,
  testNameFilter?: string,
  fileFilter?: string,
  files?: readonly string[],
  timeoutMs?: number,
): Promise<Exclude<RunAndNormalizeResult, { readonly outcome: 'missing-command' }>>;
export async function runAndNormalize(
  command: string | undefined,
  cwd: string,
  ecosystem: 'js' | 'python',
  createTempPath: () => string,
  testNameFilter?: string,
  fileFilter?: string,
  files?: readonly string[],
  timeoutMs?: number,
): Promise<RunAndNormalizeResult>;
export async function runAndNormalize(
  command: string | undefined,
  cwd: string,
  ecosystem: 'js' | 'python',
  createTempPath: () => string,
  testNameFilter?: string,
  fileFilter?: string,
  files?: readonly string[],
  timeoutMs?: number,
): Promise<RunAndNormalizeResult> {
  if (command === undefined) return { outcome: 'missing-command' };
  const effectiveTimeoutMs = timeoutMs ?? DEFAULT_TEST_RUN_TIMEOUT_MS;
  const result =
    ecosystem === 'python'
      ? await runPytest(
          command,
          cwd,
          createTempPath,
          effectiveTimeoutMs,
          testNameFilter,
          fileFilter,
          files,
        )
      : await runVitest(command, cwd, effectiveTimeoutMs, testNameFilter, fileFilter, files);
  if (!result.ok) return { outcome: 'tool-error', message: result.message };
  return { outcome: 'ran', report: { outcomes: result.outcomes } };
}

// --- test-results.json round-trip --------------------------------------------------------------

const TEST_RESULTS_RELATIVE_PATH = 'docs/forge/reports/test-results.json';

interface TestResultsFile {
  readonly v: 1;
  readonly outcomes: readonly TestOutcome[];
}

function isTestFailureKind(value: unknown): value is TestFailureKind {
  return value === 'assertion' || value === 'load' || value === 'timeout' || value === 'crash';
}

function isTestOutcome(value: unknown): value is TestOutcome {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Readonly<Record<string, unknown>>;
  return (
    typeof candidate['name'] === 'string' &&
    (candidate['acId'] === undefined || typeof candidate['acId'] === 'string') &&
    (candidate['status'] === 'pass' ||
      candidate['status'] === 'fail' ||
      candidate['status'] === 'skip') &&
    (candidate['file'] === undefined || typeof candidate['file'] === 'string') &&
    (candidate['kind'] === undefined || isTestFailureKind(candidate['kind']))
  );
}

function isTestResultsFile(value: unknown): value is TestResultsFile {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Readonly<Record<string, unknown>>;
  return (
    candidate['v'] === 1 &&
    Array.isArray(candidate['outcomes']) &&
    candidate['outcomes'].every(isTestOutcome)
  );
}

/** Writes `report` to `docs/forge/reports/test-results.json`, atomically. */
export async function writeNormalizedReport(
  paths: ProjectPaths,
  report: NormalizedTestReport,
): Promise<void> {
  const target = paths.resolveWithin(TEST_RESULTS_RELATIVE_PATH);
  const file: TestResultsFile = { v: 1, outcomes: report.outcomes };
  await writeFileAtomic(target, JSON.stringify(file, null, 2));
}

/** Reads `docs/forge/reports/test-results.json` back. `@throws {ForgeError} RUN-058` if the file is
 * not real JSON, or does not have this function's own real shape — this file is written only by
 * `writeNormalizedReport`, but nothing stops a hand edit, a truncated write, or a future,
 * incompatible schema version; a fresh critic round found the first draft cast the parsed JSON
 * straight into the caller's hands with no shape check at all. */
export async function readNormalizedReport(paths: ProjectPaths): Promise<NormalizedTestReport> {
  const source = paths.resolveWithin(TEST_RESULTS_RELATIVE_PATH);
  const raw = await readTextFile(source);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new ForgeError('RUN-058', {
      path: TEST_RESULTS_RELATIVE_PATH,
      detail: `not valid JSON: ${describeCause(cause)}`,
    });
  }
  if (!isTestResultsFile(parsed)) {
    throw new ForgeError('RUN-058', {
      path: TEST_RESULTS_RELATIVE_PATH,
      detail: 'does not have the real { v: 1, outcomes: [...] } shape',
    });
  }
  return { outcomes: parsed.outcomes };
}
