/**
 * `runAndNormalize` — `09` §9.5's own normalised test-result reporter, for real: shells one
 * `testCommands` entry, reads the tool's own real machine output, and normalises it into one shared
 * shape both ecosystems produce. Also `writeNormalizedReport`/`readNormalizedReport`, the
 * `docs/forge/reports/test-results.json` round-trip every later `forge test *` piece reads from.
 *
 * @see specs/09 §9.5
 * @see PLAN-M8.md P3
 */
import { readFile, rm } from 'node:fs/promises';

import { ForgeError } from '@forge/core';
import { readTextFile, writeFileAtomic, type ProjectPaths } from '@forge/core/fs';
import { runShellCommand } from '@forge/engine/dispatch';
import { XMLParser } from 'fast-xml-parser';

import { extractAcId } from './ac-binding.ts';

/** One test's own real outcome — `09` §9.5's own binding rule made concrete. `acId` is `undefined`
 * when `extractAcId` finds no AC id in `name` at all (not every test proves an AC; F-TEST-1's own
 * pyramid has plenty of tests with no AC binding). */
export interface TestOutcome {
  readonly name: string;
  readonly acId: string | undefined;
  readonly status: 'pass' | 'fail' | 'skip';
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
    // tests would have proven is unverifiable, not silently absent from the report.
    const name = typeof fileResult.name === 'string' ? fileResult.name : '(unknown file)';
    const detail =
      typeof fileResult.message === 'string' && fileResult.message !== ''
        ? fileResult.message
        : 'failed to load';
    const outcomeName = `${name} (file failed to load: ${detail})`;
    return [{ name: outcomeName, acId: extractAcId(outcomeName), status: 'fail' }];
  }

  const outcomes: TestOutcome[] = [];
  for (const assertion of assertions as readonly VitestAssertionResult[]) {
    const name =
      typeof assertion.fullName === 'string'
        ? assertion.fullName
        : typeof assertion.title === 'string'
          ? assertion.title
          : '';
    let status = mapVitestStatus(assertion.status);
    if (status === 'skip' && hookThrew) status = 'fail';
    outcomes.push({ name, acId: extractAcId(name), status });
  }
  return outcomes;
}

function outcomesFromVitestJson(raw: string): readonly TestOutcome[] {
  const parsed = JSON.parse(raw) as VitestJsonReport;
  const fileResults = Array.isArray(parsed.testResults) ? parsed.testResults : [];
  const outcomes: TestOutcome[] = [];
  for (const fileResult of fileResults as readonly VitestFileResult[]) {
    outcomes.push(...outcomesFromVitestFileResult(fileResult));
  }
  return outcomes;
}

async function runVitest(
  command: string,
  cwd: string,
): Promise<
  | { readonly ok: true; readonly outcomes: readonly TestOutcome[] }
  | { readonly ok: false; readonly message: string }
> {
  const result = await runShellCommand(`${command} --reporter=json`, cwd);
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
 * of the two fields this code checked was ever set. */
interface JunitTestCase {
  readonly '@_name'?: unknown;
  readonly failure?: unknown;
  readonly error?: unknown;
  readonly skipped?: unknown;
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
  const testsuites = parsed.testsuites as JunitTestSuites | undefined;
  const outcomes: TestOutcome[] = [];
  for (const suite of toArray(testsuites?.testsuite) as readonly JunitTestSuite[]) {
    for (const testcase of toArray(suite.testcase) as readonly JunitTestCase[]) {
      const name = typeof testcase['@_name'] === 'string' ? testcase['@_name'] : '';
      const status: 'pass' | 'fail' | 'skip' =
        testcase.failure !== undefined || testcase.error !== undefined
          ? 'fail'
          : testcase.skipped !== undefined
            ? 'skip'
            : 'pass';
      outcomes.push({ name, acId: extractAcId(name), status });
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

async function runPytest(
  command: string,
  cwd: string,
  createTempPath: () => string,
): Promise<
  | { readonly ok: true; readonly outcomes: readonly TestOutcome[] }
  | { readonly ok: false; readonly message: string }
> {
  const xmlPath = `${createTempPath()}.xml`;
  try {
    const result = await runShellCommand(`${command} --junitxml=${shellQuote(xmlPath)}`, cwd);
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
 * see as a valid input to guess through. */
export async function runAndNormalize(
  command: string | undefined,
  cwd: string,
  ecosystem: 'js' | 'python',
  createTempPath: () => string,
): Promise<RunAndNormalizeResult> {
  if (command === undefined) return { outcome: 'missing-command' };
  const result =
    ecosystem === 'python'
      ? await runPytest(command, cwd, createTempPath)
      : await runVitest(command, cwd);
  if (!result.ok) return { outcome: 'tool-error', message: result.message };
  return { outcome: 'ran', report: { outcomes: result.outcomes } };
}

// --- test-results.json round-trip --------------------------------------------------------------

const TEST_RESULTS_RELATIVE_PATH = 'docs/forge/reports/test-results.json';

interface TestResultsFile {
  readonly v: 1;
  readonly outcomes: readonly TestOutcome[];
}

function isTestOutcome(value: unknown): value is TestOutcome {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Readonly<Record<string, unknown>>;
  return (
    typeof candidate['name'] === 'string' &&
    (candidate['acId'] === undefined || typeof candidate['acId'] === 'string') &&
    (candidate['status'] === 'pass' ||
      candidate['status'] === 'fail' ||
      candidate['status'] === 'skip')
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
