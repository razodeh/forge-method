/**
 * `testCoverage` — `story:ac-coverage`/`test:coverage`/`coverage:ratchet` (`G-Verify`), for real.
 * Never runs coverage collection itself — that stays the declared `testCommands` command's own job
 * (`13` §13.1 F-TEST-5's own framing: coverage is a floor detector, not something this layer
 * generates); this function only reads what a real coverage/test run already wrote.
 *
 * `specs/22` M17 P5: which file this reads, and in what shape, is now configurable
 * (`quality.coverage.{source,path}`) rather than a hard-coded assumption that coverage always
 * arrives as Istanbul/v8's own `coverage/coverage-summary.json` — `TestCoverageContext.coverage`
 * being entirely absent (every pre-M17 caller and test) reproduces that exact pre-M17 behaviour.
 *
 * @see specs/13 §13.1 F-TEST-5
 * @see specs/09 §9.5
 * @see specs/22 M17 P5
 * @see PLAN-M8.md P6
 */
import { realpath } from 'node:fs/promises';
import path from 'node:path';

import { XMLParser } from 'fast-xml-parser';

import { pathExists, readTextFile, writeFileAtomic, type ProjectPaths } from '@forge/core/fs';
import type { Story } from '@forge/schemas';
import type { CoverageSource } from '@forge/schemas/config';

import { loadDoneStories } from '../../shared.ts';
import {
  evaluateRatchet,
  packageTotals,
  type FileCoverageCounts,
  type FileMetric,
  type RatchetBaseline,
} from './ratchet.ts';
import { readNormalizedReport } from './reporter.ts';

/** `testCoverage`'s own real dependencies. `specsRoot` is only read by `--rule acceptance-criteria`
 * (loading every `done` story's own front matter); `projectRoot` is a plain string (never a write
 * target) used only to turn a coverage report's own real absolute-path keys into project-relative
 * ones for `--rule ratchet` — the identical `paths`/`projectRoot` split `run.ts`'s own
 * `TestRunContext` already establishes. */
export interface TestCoverageContext {
  readonly paths: ProjectPaths;
  readonly projectRoot: string;
  readonly specsRoot: string;
  /** `quality.coverage.{source,path}` (`specs/22` M17 P5). Absent (every pre-M17 caller and test)
   * resolves to `istanbul-json` at its own conventional path (`coverage/coverage-summary.json`) —
   * the exact pre-M17 hard-coded behaviour. `source` is which report shape to parse; `path` is a
   * project-relative OVERRIDE of that source's own conventional report location. `18` §18.3's own
   * normative text (committed by P1) names this second field `format`, not `path` — deliberately
   * renamed here: `schema.ts`'s own `quality.coverage.path` field doc comment has the full
   * naming-collision reasoning (a round-2 critic finding, not this piece's own first draft). */
  readonly coverage?: {
    readonly source?: CoverageSource | undefined;
    readonly path?: string | undefined;
  };
}

/** `rule` selects which of `G-Verify.gate.yaml`'s three coverage checks this call answers: absent
 * runs `test:coverage` (the flat, whole-project line-coverage floor); `'acceptance-criteria'` runs
 * `story:ac-coverage` (`09` §9.5's own binding metric); `'ratchet'` runs `coverage:ratchet`. */
export interface TestCoverageOptions {
  readonly rule?: 'acceptance-criteria' | 'ratchet';
}

/** `coverage`/`regressions` are always both present — mirrors `TestRunResult`'s own already-
 * established shape (`run.ts`, `PLAN-M8.md` P4) for the identical reason: `G-Verify.gate.yaml`'s own
 * `story:ac-coverage`/`test:coverage` checks read `failOn: 'coverage < 100'`/`'coverage < 80'`,
 * `coverage:ratchet` reads `failOn: 'regressions > 0'` — only one field is ever semantically
 * meaningful for a given `options.rule`, the other stays a neutral `0`. `missingAcIds`, only ever
 * populated by `--rule acceptance-criteria`, names every `done` story's AC with no passing bound test
 * — a real, computed shortfall (not a "could not verify" failure); `problems`, when non-empty, names
 * every real reason the check could not fully complete (missing/unreadable/malformed coverage data)
 * — `09` §9.5's own "a layer that cannot be verified must never read as passing" is enforced by
 * forcing the relevant count to `0`/`1` (whichever direction fails that check's own `failOn`)
 * whenever `problems` is non-empty. */
export interface TestCoverageResult {
  readonly coverage: number;
  readonly regressions: number;
  readonly missingAcIds?: readonly string[];
  readonly problems?: readonly string[];
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** A fresh critic round reproduced this directly: `JSON.parse` happily returns `null`, an array, or
 * a bare number/string for a file that is syntactically valid JSON but not the real object shape
 * every reader below assumes — `summary['total']`/`Object.entries(summary)` throw on `null`
 * (`Object.entries` throws on `null`/`undefined` specifically) rather than degrading to a real
 * `problems` entry, falsifying `testCoverage`'s own "never throws" doc comment. Checked once here,
 * at every real JSON-parse boundary this file has. */
function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// --- the normalized, istanbul-shaped intermediate every format below converts into (real shape
// confirmed directly against a real istanbul-json run in this environment during this piece's own
// pre-M17 build: `{ [absolutePath]: { lines: {pct, covered, total, ...}, statements: {...},
// functions: {...}, branches: {...} }, total: {...same shape, plus branchesTrue} }`) — `runDefault
// Coverage`/`runRatchetCoverage` below read exactly this shape regardless of which real `source` the
// project configured, so adding a FIFTH format only ever means adding one new parser function below
// and one new `COVERAGE_PARSERS`/`CONVENTIONAL_COVERAGE_PATHS` entry, never touching either rule. ---

interface IstanbulMetric {
  readonly pct?: unknown;
  readonly covered?: unknown;
  readonly total?: unknown;
}
interface IstanbulFileSummary {
  readonly lines?: IstanbulMetric;
  readonly statements?: IstanbulMetric;
  readonly functions?: IstanbulMetric;
  readonly branches?: IstanbulMetric;
}
type IstanbulSummary = Readonly<Record<string, IstanbulFileSummary | undefined>>;

/** `quality.coverage.source`'s own real default (`specs/22` M17 P5) and every `source`'s own
 * conventional report location, read when `quality.coverage.path` (the path override) is unset —
 * `istanbul-json`'s entry is the exact pre-M17 hard-coded path, unconditionally. */
const CONVENTIONAL_COVERAGE_PATHS: Readonly<Record<CoverageSource, string>> = {
  'istanbul-json': 'coverage/coverage-summary.json',
  lcov: 'coverage/lcov.info',
  cobertura: 'coverage/cobertura-coverage.xml',
  jacoco: 'coverage/jacoco.xml',
};

/** `ctx.coverage` fully resolved against its own defaults — every real caller of `readCoverageData`/
 * the two rules below that need this path for a `problems` message shares this one resolution rather
 * than re-deriving it, so the two can never read a different path than the one actually read. */
function resolveCoveragePath(ctx: TestCoverageContext): {
  readonly source: CoverageSource;
  readonly relativePath: string;
} {
  const source = ctx.coverage?.source ?? 'istanbul-json';
  return { source, relativePath: ctx.coverage?.path ?? CONVENTIONAL_COVERAGE_PATHS[source] };
}

/** One format's own real parser: `raw`'s already-read text in, either the normalized summary or a
 * real, human-readable reason it could not be parsed (never a thrown exception — every format's own
 * parser below tolerates garbage input, matching `isPlainObject`'s own doc comment one scope up). */
type CoverageParser = (raw: string) => IstanbulSummary | string;

function parseIstanbulJsonSummary(raw: string): IstanbulSummary | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    return `is not valid JSON: ${describeCause(cause)}`;
  }
  if (!isPlainObject(parsed)) return 'is not a real JSON object.';
  return parsed as IstanbulSummary;
}

function numberFrom(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** A real percentage from a covered/total pair — `0` total reads as `100%` (vacuously fully covered),
 * the identical convention `ratchet.ts`'s own `packageTotals` already establishes for the same real
 * case (a package with no branches at all). */
function pctFrom(covered: number, total: number): number {
  return total === 0 ? 100 : Number(((covered / total) * 100).toFixed(2));
}

/** Every non-`istanbul-json` format below (`lcov`'s `SF:`, Cobertura's `filename`, JaCoCo's
 * `package`/`sourcefile` names) reports its own per-file path as a bare string this process never
 * controlled the writing of — a round-2 critic reproduced directly that a real Windows-shaped path
 * (Coverlet/.NET-style tools on Windows CI write `SF:src\a.ts`/`filename="src\a.ts"`) survives
 * untouched all the way through `absolutizeFileKeys`/`fileCoverageCountsFrom` on a POSIX host
 * (`path.isAbsolute`/`path.relative`/`path.sep` all only ever know `/` there), landing as one
 * literal-backslash top-level `packageKeyFor` bucket instead of the real nested package/file it
 * names — silent corruption, not a crash, and permanent baseline churn once it happens. Normalized
 * to forward slashes at the one real boundary where an untrusted report's own path strings enter
 * this file, matching the standard, unconditional convention cross-platform tools already use for a
 * declared/reported path (never applied to a real OS path this process itself composed, which
 * `istanbul-json`'s own keys already are). */
function normalizeReportPathSeparators(raw: string): string {
  return raw.replaceAll('\\', '/');
}

/** `lcov.info` (genhtml/lcov's own text format, emitted by Istanbul's `lcov`/`lcovonly` reporters,
 * `pytest-cov --cov-report=lcov`, Go's `gocov-to-lcov`, …): one `SF:<path>` block per file, terminated
 * by `end_of_record`, with `LF`/`LH` (lines found/hit), `FNF`/`FNH` (functions), `BRF`/`BRH`
 * (branches) counters, and one `DA:<line>,<hits>[,<checksum>]` per instrumented line, in between —
 * no per-file "statements" concept at all, omitted entirely from every file entry this produces
 * (`fileCoverageEntry`'s own established "omit an absent metric, never fabricate a zero" convention,
 * reused here rather than invented). A trailing block with no final `end_of_record` (a truncated
 * write) is still flushed: real lcov writers always end with one, but tolerating its absence costs
 * nothing and loses no real data either way.
 *
 * Lines are counted from the real per-line `DA:` records, never from the declared `LF:`/`LH:`
 * aggregate alone — a round-2 critic reproduced directly that trusting `LF:`/`LH:` exclusively
 * (defaulting to `0` when either is absent) silently reports 100% for a real file whose own `DA:`
 * records show a genuine miss, whenever a writer omits the aggregate line: `LF:`/`LH:` are a
 * convention, not a guarantee (several real lcov consumers, e.g. npm's `lcov-parse`, recompute from
 * `DA:` for exactly this reason). `LF:`/`LH:` are read only as a fallback for a file with no `DA:`
 * records of its own, so a minimal, aggregate-only report still parses. */
function parseLcovSummary(raw: string): IstanbulSummary | string {
  const files: Record<string, IstanbulFileSummary> = {};
  let totalLinesFound = 0;
  let totalLinesHit = 0;
  let currentFile: string | undefined;
  let aggregateLf = 0;
  let aggregateLh = 0;
  let linesFromDa = 0;
  let hitsFromDa = 0;
  let fnf = 0;
  let fnh = 0;
  let brf = 0;
  let brh = 0;

  const flush = (): void => {
    if (currentFile === undefined) return;
    // `DA:` records are the ground truth whenever any exist for this file; `LF:`/`LH:` are read
    // only as a fallback when a writer gave no `DA:` records at all (this file's own header comment
    // has the fuller reasoning).
    const lf = linesFromDa > 0 ? linesFromDa : aggregateLf;
    const lh = linesFromDa > 0 ? hitsFromDa : aggregateLh;
    const entry: { -readonly [K in keyof IstanbulFileSummary]?: IstanbulMetric } = {
      lines: { covered: lh, total: lf },
    };
    if (fnf > 0 || fnh > 0) entry.functions = { covered: fnh, total: fnf };
    if (brf > 0 || brh > 0) entry.branches = { covered: brh, total: brf };
    files[currentFile] = entry;
    totalLinesFound += lf;
    totalLinesHit += lh;
    currentFile = undefined;
  };

  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith('SF:')) {
      flush();
      currentFile = normalizeReportPathSeparators(line.slice('SF:'.length).trim());
      aggregateLf = 0;
      aggregateLh = 0;
      linesFromDa = 0;
      hitsFromDa = 0;
      fnf = 0;
      fnh = 0;
      brf = 0;
      brh = 0;
    } else if (line.startsWith('DA:')) {
      const hits = numberFrom(line.slice('DA:'.length).split(',')[1]);
      if (hits !== undefined) {
        linesFromDa += 1;
        if (hits > 0) hitsFromDa += 1;
      }
    } else if (line.startsWith('LF:')) aggregateLf = numberFrom(line.slice('LF:'.length)) ?? 0;
    else if (line.startsWith('LH:')) aggregateLh = numberFrom(line.slice('LH:'.length)) ?? 0;
    else if (line.startsWith('FNF:')) fnf = numberFrom(line.slice('FNF:'.length)) ?? 0;
    else if (line.startsWith('FNH:')) fnh = numberFrom(line.slice('FNH:'.length)) ?? 0;
    else if (line.startsWith('BRF:')) brf = numberFrom(line.slice('BRF:'.length)) ?? 0;
    else if (line.startsWith('BRH:')) brh = numberFrom(line.slice('BRH:'.length)) ?? 0;
    else if (line.trim() === 'end_of_record') flush();
  }
  flush();

  if (Object.keys(files).length === 0) {
    return 'names no real "SF:"/"end_of_record" records -- not a real lcov report.';
  }
  return {
    total: {
      lines: {
        covered: totalLinesHit,
        total: totalLinesFound,
        pct: pctFrom(totalLinesHit, totalLinesFound),
      },
    },
    ...files,
  };
}

/** `fast-xml-parser`'s own real, confirmed behaviour (`parsers/junit-xml.ts`'s own identical
 * precedent, reused rather than re-derived): a repeated element becomes an array, a single occurrence
 * stays a bare object. */
function toArray(value: unknown): readonly unknown[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** A discriminated result, not a bare `unknown | string` union: `unknown` already absorbs `string`
 * (`@typescript-eslint/no-redundant-type-constituents`), so a plain union could not actually tell a
 * genuine string-shaped XML parse apart from this function's own error message. */
type XmlParseResult =
  | { readonly ok: true; readonly document: unknown }
  | { readonly ok: false; readonly message: string };

function parseXmlDocument(raw: string): XmlParseResult {
  try {
    return {
      ok: true,
      document: new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' }).parse(raw),
    };
  } catch (cause) {
    return { ok: false, message: `could not be parsed as XML: ${describeCause(cause)}` };
  }
}

interface CoberturaLine {
  readonly '@_hits'?: unknown;
}
interface CoberturaClass {
  readonly '@_filename'?: unknown;
  readonly lines?: { readonly line?: unknown };
}
interface CoberturaPackage {
  readonly classes?: { readonly class?: unknown };
}
interface CoberturaRoot {
  readonly '@_lines-covered'?: unknown;
  readonly '@_lines-valid'?: unknown;
  readonly '@_branches-covered'?: unknown;
  readonly '@_branches-valid'?: unknown;
  readonly packages?: { readonly package?: unknown };
}

/** Cobertura XML (pytest-cov's `--cov-report=xml`, Istanbul's `cobertura` reporter, JUnit's
 * `cobertura-maven-plugin`, …): the `<coverage>` root's own `lines-covered`/`lines-valid`/
 * `branches-covered`/`branches-valid` attributes give the real, already-aggregated total directly
 * (the identical "the tool computed this, do not re-derive it" choice `parseIstanbulJsonSummary`
 * already makes for `total.lines.pct`); per file, each `<class filename="...">`'s own `<line
 * number hits>` children are counted directly -- Cobertura's DTD gives per-class branch coverage only
 * as a ratio (`condition-coverage="50% (1/2)"` on individual branch lines), not raw counts, so
 * per-file branches are left unset here (omitted, never fabricated) while the real project-wide
 * total above still carries them. */
function parseCoberturaSummary(raw: string): IstanbulSummary | string {
  const parsed = parseXmlDocument(raw);
  if (!parsed.ok) return parsed.message;
  const document = parsed.document as { readonly coverage?: unknown };
  if (!isPlainObject(document.coverage)) {
    return 'has no real "coverage" root element at all -- not a real Cobertura report.';
  }
  const root = document.coverage as CoberturaRoot;
  const linesValid = numberFrom(root['@_lines-valid']);
  const linesCovered = numberFrom(root['@_lines-covered']);
  if (linesValid === undefined || linesCovered === undefined) {
    return 'has no real "lines-valid"/"lines-covered" attributes on its own <coverage> root.';
  }
  const branchesValid = numberFrom(root['@_branches-valid']);
  const branchesCovered = numberFrom(root['@_branches-covered']);
  const total: { -readonly [K in keyof IstanbulFileSummary]?: IstanbulMetric } = {
    lines: { covered: linesCovered, total: linesValid, pct: pctFrom(linesCovered, linesValid) },
  };
  if (branchesValid !== undefined && branchesCovered !== undefined) {
    total.branches = { covered: branchesCovered, total: branchesValid };
  }

  const files: Record<string, IstanbulFileSummary> = {};
  for (const pkg of toArray(root.packages?.package) as readonly CoberturaPackage[]) {
    for (const cls of toArray(pkg.classes?.class) as readonly CoberturaClass[]) {
      const filename =
        typeof cls['@_filename'] === 'string'
          ? normalizeReportPathSeparators(cls['@_filename'])
          : undefined;
      if (filename === undefined) continue;
      const lineElements = toArray(cls.lines?.line) as readonly CoberturaLine[];
      if (lineElements.length === 0) continue;
      let covered = 0;
      for (const lineEntry of lineElements) {
        if ((numberFrom(lineEntry['@_hits']) ?? 0) > 0) covered += 1;
      }
      files[filename] = { lines: { covered, total: lineElements.length } };
    }
  }
  if (Object.keys(files).length === 0) {
    return 'names no real per-file <class filename="..."> entries with any <line> children.';
  }
  return { total, ...files };
}

interface JacocoCounter {
  readonly '@_type'?: unknown;
  readonly '@_missed'?: unknown;
  readonly '@_covered'?: unknown;
}
interface JacocoSourcefile {
  readonly '@_name'?: unknown;
  readonly counter?: unknown;
}
interface JacocoPackage {
  readonly '@_name'?: unknown;
  readonly sourcefile?: unknown;
}
interface JacocoReport {
  readonly counter?: unknown;
  readonly package?: unknown;
}

function jacocoCounterMetric(
  counters: readonly JacocoCounter[],
  type: string,
): IstanbulMetric | undefined {
  const counter = counters.find((candidate) => candidate['@_type'] === type);
  if (counter === undefined) return undefined;
  const missed = numberFrom(counter['@_missed']);
  const covered = numberFrom(counter['@_covered']);
  if (missed === undefined || covered === undefined) return undefined;
  const total = missed + covered;
  return { covered, total, pct: pctFrom(covered, total) };
}

/** JaCoCo XML (`jacoco:report`'s own `xml` format): the `<report>` root's own DIRECT `<counter
 * type="LINE"/"METHOD"/"BRANCH" missed covered>` children give the real project-wide total (`missed +
 * covered` is the real denominator JaCoCo itself uses — there is no separate "valid" attribute the
 * way Cobertura has one); per file, each `<package name>`'s own `<sourcefile name>` children carry
 * the identical counter shape for that one file. The file key is `<package name>/<sourcefile name>`
 * verbatim — JaCoCo's own XML never records a build's source-root prefix (e.g. Maven's
 * `src/main/java/`), so this key matches the project's own real file layout only when that layout is
 * flat from the project root; a disclosed, real limitation for a nested source-root build, not
 * attempted here (this piece's own report has the fuller note). No native "statements" counter type
 * exists in JaCoCo at all — omitted entirely, the identical choice lcov's own parser above makes. */
function parseJacocoSummary(raw: string): IstanbulSummary | string {
  const parsed = parseXmlDocument(raw);
  if (!parsed.ok) return parsed.message;
  const document = parsed.document as { readonly report?: unknown };
  if (!isPlainObject(document.report)) {
    return 'has no real "report" root element at all -- not a real JaCoCo report.';
  }
  const root = document.report as JacocoReport;
  const rootCounters = toArray(root.counter) as readonly JacocoCounter[];
  const totalLines = jacocoCounterMetric(rootCounters, 'LINE');
  if (totalLines === undefined) {
    return 'has no real <counter type="LINE" missed="..." covered="..."/> on its own <report> root.';
  }
  const total: { -readonly [K in keyof IstanbulFileSummary]?: IstanbulMetric } = {
    lines: totalLines,
  };
  const totalFunctions = jacocoCounterMetric(rootCounters, 'METHOD');
  if (totalFunctions !== undefined) total.functions = totalFunctions;
  const totalBranches = jacocoCounterMetric(rootCounters, 'BRANCH');
  if (totalBranches !== undefined) total.branches = totalBranches;

  const files: Record<string, IstanbulFileSummary> = {};
  for (const pkg of toArray(root.package) as readonly JacocoPackage[]) {
    const pkgName =
      typeof pkg['@_name'] === 'string' ? normalizeReportPathSeparators(pkg['@_name']) : '';
    for (const src of toArray(pkg.sourcefile) as readonly JacocoSourcefile[]) {
      const srcName =
        typeof src['@_name'] === 'string'
          ? normalizeReportPathSeparators(src['@_name'])
          : undefined;
      if (srcName === undefined) continue;
      const fileCounters = toArray(src.counter) as readonly JacocoCounter[];
      const lines = jacocoCounterMetric(fileCounters, 'LINE');
      if (lines === undefined) continue;
      const entry: { -readonly [K in keyof IstanbulFileSummary]?: IstanbulMetric } = { lines };
      const functions = jacocoCounterMetric(fileCounters, 'METHOD');
      if (functions !== undefined) entry.functions = functions;
      const branches = jacocoCounterMetric(fileCounters, 'BRANCH');
      if (branches !== undefined) entry.branches = branches;
      files[pkgName === '' ? srcName : `${pkgName}/${srcName}`] = entry;
    }
  }
  if (Object.keys(files).length === 0) {
    return 'names no real per-file <sourcefile> entries with a real LINE counter.';
  }
  return { total, ...files };
}

/** One parser per `COVERAGE_SOURCES` entry (`@forge/schemas/config`) — `pnpm typecheck` itself proves
 * this table is exhaustive: `Record<CoverageSource, ...>` rejects a missing or extra key at compile
 * time, the identical `PARSERS` (`loop/test/parsers/index.ts`) precedent this table is modelled on. */
const COVERAGE_PARSERS: Record<CoverageSource, CoverageParser> = {
  'istanbul-json': parseIstanbulJsonSummary,
  lcov: parseLcovSummary,
  cobertura: parseCoberturaSummary,
  jacoco: parseJacocoSummary,
};

/** Reads and parses a project's own configured coverage report (`quality.coverage.{source,path}`,
 * `resolveCoveragePath` above), tolerating every real way it can fail to exist or be usable (never
 * present at all — coverage was never collected; present but unreadable; present but not a real
 * report in its own declared `source` shape) as a `problems` entry rather than a thrown exception,
 * matching every other `forge test *` piece's own "fail closed, report honestly" discipline
 * (`run.ts`/`oracle-lint.ts`). Produces byte-identical `problems` text to this function's own pre-M17
 * `readCoverageSummary` for the default, no-config case (`istanbul-json` at its own conventional
 * path) — confirmed directly by `coverage.test.ts`'s own pre-existing assertions, left unedited by
 * this piece. */
async function readCoverageData(
  ctx: TestCoverageContext,
  problems: string[],
): Promise<IstanbulSummary | undefined> {
  const { source, relativePath } = resolveCoveragePath(ctx);
  const target = ctx.paths.resolveWithin(relativePath);
  if (!(await pathExists(target))) {
    problems.push(
      `no coverage data found at ${relativePath} — run the project's own configured test command with coverage enabled first.`,
    );
    return undefined;
  }
  let raw: string;
  try {
    raw = await readTextFile(target);
  } catch (cause) {
    problems.push(`could not read ${relativePath}: ${describeCause(cause)}`);
    return undefined;
  }
  const result = COVERAGE_PARSERS[source](raw);
  if (typeof result === 'string') {
    problems.push(`${relativePath} ${result}`);
    return undefined;
  }
  return result;
}

/** Normalizes every per-file key in `summary` to an absolute path before `fileCoverageCountsFrom`'s
 * own escape-checked relative conversion runs: `istanbul-json`'s own real keys are already absolute
 * (left untouched here — `path.isAbsolute` is true, so this is a genuine no-op, preserving
 * `fileCoverageCountsFrom`'s pre-existing behaviour exactly, including its own "escapes the project
 * root" detection against a key that is absolute but NOT realpath-canonicalised); `lcov`/`cobertura`/
 * `jacoco` report project-relative paths, resolved here against `realRoot` (the SAME already-
 * realpath'd root `fileCoverageCountsFrom` itself compares every key against) so a relative key never
 * spuriously reads as "escapes the project root" merely because `realRoot` and a raw, non-realpath'd
 * `projectRoot` disagree (`fileCoverageCountsFrom`'s own doc comment has the fuller symlink
 * reasoning this mirrors). */
function absolutizeFileKeys(summary: IstanbulSummary, realRoot: string): IstanbulSummary {
  const result: Record<string, IstanbulFileSummary | undefined> = {};
  for (const [key, value] of Object.entries(summary)) {
    result[key === 'total' || path.isAbsolute(key) ? key : path.join(realRoot, key)] = value;
  }
  return result;
}

// --- default rule: test:coverage (flat, whole-project line coverage) ------------------------------

async function runDefaultCoverage(ctx: TestCoverageContext): Promise<TestCoverageResult> {
  const problems: string[] = [];
  const summary = await readCoverageData(ctx, problems);
  if (summary === undefined) return { coverage: 0, regressions: 0, problems };
  const pct = summary['total']?.lines?.pct;
  if (typeof pct !== 'number') {
    const { relativePath } = resolveCoveragePath(ctx);
    problems.push(`${relativePath} has no real "total.lines.pct" number.`);
    return { coverage: 0, regressions: 0, problems };
  }
  return { coverage: pct, regressions: 0 };
}

// --- --rule acceptance-criteria: story:ac-coverage -------------------------------------------------

/** **Known, disclosed limitation (`SPEC-QUESTIONS.md` Q127):** this reads `docs/forge/reports/
 * test-results.json` verbatim, with no freshness check against `test:run`'s own most recent
 * invocation — `evaluateGate` (`@forge/engine/gates`) runs every `G-Verify` deterministic check
 * concurrently, with no declared ordering between `test:run` and `story:ac-coverage`, so a first-ever
 * gate run can race `test:run`'s own write, and every later run trusts whatever the file's own most
 * recent write happened to be, stale or not. Fixing this needs either a declared check-ordering
 * mechanism in the gate schema or a run-id/freshness stamp on the report — both real, cross-cutting
 * changes to `evaluateGate` itself, out of this piece's own scope; not attempted here rather than
 * half-built. */

async function runAcceptanceCriteriaCoverage(
  ctx: TestCoverageContext,
): Promise<TestCoverageResult> {
  let doneStories: readonly Story[];
  try {
    doneStories = await loadDoneStories(ctx.paths, ctx.specsRoot);
  } catch (cause) {
    // A fresh critic round reproduced this directly: one malformed spec doc (unterminated front
    // matter, e.g.) throws straight out of `listSpecArtifacts`, falsifying `testCoverage`'s own
    // "never throws" doc comment — this must never read as the vacuous "no done stories" 100% below.
    return {
      coverage: 0,
      regressions: 0,
      problems: [`could not load ${ctx.specsRoot}'s own story documents: ${describeCause(cause)}`],
    };
  }
  // `SPEC-023` (`@forge/core/graph`) already makes a second story claiming the same AC id a real,
  // reported graph violation at `spec validate` — deduplicated here defensively too, so a project
  // that has not yet run that check does not double-count one AC id claimed by two `done` stories.
  const acIds = [
    ...new Set(doneStories.flatMap((story) => story.acceptance.map((criterion) => criterion.id))),
  ];
  // Vacuously covered with no real test-results.json read at all: whether that file exists is
  // irrelevant when there is nothing here to check it against — a project with no `done` story yet
  // must not be forced to run `forge test run` first just to learn "100, trivially" about zero ACs.
  if (acIds.length === 0) return { coverage: 100, regressions: 0 };

  const problems: string[] = [];
  const testResults = await readNormalizedReport(ctx.paths).catch((cause: unknown) => {
    problems.push(
      `could not read docs/forge/reports/test-results.json (run "forge test run" first): ${describeCause(cause)}`,
    );
    return undefined;
  });
  if (testResults === undefined) return { coverage: 0, regressions: 0, problems };

  const passingAcIds = new Set(
    testResults.outcomes
      .filter((outcome) => outcome.status === 'pass' && outcome.acId !== undefined)
      .map((outcome) => outcome.acId),
  );
  const missingAcIds = acIds.filter((acId) => !passingAcIds.has(acId));
  const coverage = Number((((acIds.length - missingAcIds.length) / acIds.length) * 100).toFixed(2));
  return missingAcIds.length === 0
    ? { coverage, regressions: 0 }
    : { coverage, regressions: 0, missingAcIds };
}

// --- --rule ratchet: coverage:ratchet --------------------------------------------------------------

const BASELINE_RELATIVE_PATH = 'docs/forge/reports/coverage-baseline.json';
const METRIC_KEYS = ['lines', 'statements', 'functions', 'branches'] as const;

/** A real percentage: `evaluateRatchet`/`packageTotals` never produce anything outside `[0, 100]`, so
 * a value outside that range can only be a hand-edit or a foreign schema version — real, but not
 * trustworthy as a coverage percentage. */
function isPercentage(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

function isCoverageMetrics(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return METRIC_KEYS.every((key) => isPercentage(value[key]));
}

/** A real, malformed-tolerant shape check — `docs/forge/reports/coverage-baseline.json` is written
 * only by this function's own sibling `writeBaseline`, but nothing stops a hand edit or a truncated
 * write, matching `reporter.ts`'s own `isTestResultsFile` precedent for the identical reason.
 * `isPlainObject` (not a bare `typeof value === 'object'`) rejects a JSON array: `Object.values([])`
 * passes an *empty* array's own vacuous `.every` for free, and a non-empty array's own numeric keys
 * would otherwise silently read as a baseline keyed `"0"`, `"1"`, ... */
function isRatchetBaseline(value: unknown): value is RatchetBaseline {
  if (!isPlainObject(value)) return false;
  return Object.values(value).every(isCoverageMetrics);
}

/** Reads the stored baseline, tolerating "never collected yet" (an empty baseline, the correct
 * starting point for a project's very first ratchet run — `scripts/lib/coverage-ratchet.mjs`'s own
 * `readMarks` establishes the identical convention) as distinct from "a real file exists but is
 * unusable" (a real `problems` entry, never silently reset to empty — silently discarding a real,
 * already-recorded high-water mark would itself be a regression this check exists to catch). */
async function readBaseline(paths: ProjectPaths, problems: string[]): Promise<RatchetBaseline> {
  const target = paths.resolveWithin(BASELINE_RELATIVE_PATH);
  if (!(await pathExists(target))) return {};
  let raw: string;
  try {
    raw = await readTextFile(target);
  } catch (cause) {
    problems.push(`could not read ${BASELINE_RELATIVE_PATH}: ${describeCause(cause)}`);
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    problems.push(`${BASELINE_RELATIVE_PATH} is not valid JSON: ${describeCause(cause)}`);
    return {};
  }
  if (!isRatchetBaseline(parsed)) {
    problems.push(`${BASELINE_RELATIVE_PATH} does not have the real per-package metrics shape.`);
    return {};
  }
  return parsed;
}

async function writeBaseline(paths: ProjectPaths, baseline: RatchetBaseline): Promise<void> {
  const target = paths.resolveWithin(BASELINE_RELATIVE_PATH);
  await writeFileAtomic(target, `${JSON.stringify(baseline, null, 2)}\n`);
}

function fileMetricFrom(metric: IstanbulMetric | undefined): FileMetric | undefined {
  if (!isPlainObject(metric)) return undefined;
  const { covered, total } = metric;
  if (typeof covered !== 'number' || typeof total !== 'number') return undefined;
  return { covered, total };
}

/** Builds one file's own `FileCoverageCounts[string]` entry, omitting a metric key entirely rather
 * than setting it to `undefined` — `tsconfig.json`'s own `exactOptionalPropertyTypes` treats the two
 * as genuinely different types, and `ratchet.ts`'s own `packageTotals` already tolerates a metric
 * being absent (it just skips that metric for that file, per its own loop). */
function fileCoverageEntry(fileSummary: IstanbulFileSummary): FileCoverageCounts[string] {
  const entry: { -readonly [K in keyof FileCoverageCounts[string]]?: FileMetric } = {};
  const lines = fileMetricFrom(fileSummary.lines);
  const statements = fileMetricFrom(fileSummary.statements);
  const functions = fileMetricFrom(fileSummary.functions);
  const branches = fileMetricFrom(fileSummary.branches);
  if (lines !== undefined) entry.lines = lines;
  if (statements !== undefined) entry.statements = statements;
  if (functions !== undefined) entry.functions = functions;
  if (branches !== undefined) entry.branches = branches;
  return entry;
}

/** Converts a coverage report's own real absolute-path keys into project-relative, forward-slash
 * paths `ratchet.ts`'s own `packageTotals` groups by. `realpath`s `projectRoot` first: the coverage
 * report records real (symlink-resolved) paths while a project root a caller passes in may not be —
 * `scripts/check-coverage-ratchet.mjs`'s own doc comment records the identical, real gotcha this is
 * ported from (on macOS, `/var` is itself a symlink to `/private/var`, and the mismatch silently
 * produces `../../..`-prefixed keys that match no real package).
 *
 * A fresh critic round found this guarded only *that* direction: a summary whose own keys are
 * **not** realpath-canonicalised (a collector that never resolves symlinks itself, reached through a
 * project root that is itself a symlink — the exact shape `mkdtemp`'s own real temp directories have
 * on macOS) produces the identical `../..`-prefixed relative path, which `packageKeyFor` (`ratchet.ts`)
 * then silently collapses every such file into one `".."`-keyed bucket — masking any real per-package
 * regression underneath it, with no error at all. Any relative path that escapes the project root
 * (starts with `..`, or is still absolute — a foreign drive on Windows, e.g.) is therefore excluded
 * from aggregation and named in `problems` instead of silently merged into a nonsense bucket.
 *
 * `reportRelativePath` names the real, configured report file in that `problems` message — a round-2
 * critic reproduced directly that this hardcoded `coverage-summary.json` unconditionally even when
 * `quality.coverage.source` names `lcov`/`cobertura`/`jacoco` and the real file read was
 * `coverage/lcov.info` (or a `path` override): the caller's own already-resolved path is threaded
 * through instead, matching `runRatchetCoverage`'s own sibling "no real per-file entries" message one
 * scope up, which already did this correctly. */
function fileCoverageCountsFrom(
  summary: IstanbulSummary,
  realRoot: string,
  reportRelativePath: string,
  problems: string[],
): FileCoverageCounts {
  const counts: Record<string, FileCoverageCounts[string]> = {};
  for (const [absolutePath, fileSummary] of Object.entries(summary)) {
    if (absolutePath === 'total' || !isPlainObject(fileSummary)) continue;
    const relative = path.relative(realRoot, absolutePath).split(path.sep).join('/');
    if (relative.startsWith('../') || relative === '..' || path.isAbsolute(relative)) {
      problems.push(
        `${reportRelativePath} names a file outside the project root, excluded from the ratchet: ${absolutePath}`,
      );
      continue;
    }
    counts[relative] = fileCoverageEntry(fileSummary);
  }
  return counts;
}

async function runRatchetCoverage(ctx: TestCoverageContext): Promise<TestCoverageResult> {
  const problems: string[] = [];
  const summary = await readCoverageData(ctx, problems);
  if (summary === undefined) return { coverage: 0, regressions: 1, problems };

  const { relativePath: reportRelativePath } = resolveCoveragePath(ctx);
  const realRoot = await realpath(ctx.projectRoot);
  const counts = fileCoverageCountsFrom(
    absolutizeFileKeys(summary, realRoot),
    realRoot,
    reportRelativePath,
    problems,
  );
  // A fresh critic round reproduced this directly: a coverage report that parses but names zero real
  // per-file entries (every file excluded as an escaped path above; a `coverage.include` glob that
  // matched nothing; a provider that wrote only its own `total` key) produced an empty `achieved`,
  // so `evaluateRatchet` found nothing to compare and reported a clean `regressions: 0` —
  // indistinguishable from "collected everything, nothing regressed." The identical gap `run.ts`'s
  // own default rule already closes for "ran but matched zero tests."
  if (Object.keys(counts).length === 0) {
    problems.push(
      `${reportRelativePath} names no real per-file coverage entries — nothing was actually compared against the baseline.`,
    );
  }
  const achieved = packageTotals(counts);
  const baseline = await readBaseline(ctx.paths, problems);
  const { regressions, next } = evaluateRatchet(achieved, baseline);

  // A fresh critic round reproduced this directly, as a real two-invocation sequence: `readBaseline`
  // returning `{}` for a present-but-unusable baseline file (a hand edit, a truncated write) let a
  // *previous* run's genuine regression get silently written back as the new, "clean" baseline —
  // laundered on the very next invocation, which would read that now-valid file and find nothing to
  // compare against. Persisting is therefore skipped entirely whenever `problems` is non-empty (the
  // baseline was unusable, the coverage data was incomplete, or a file's own path escaped the
  // project) — this run's own `regressions` count already reports the failure below; there is
  // nothing safe to write back until the next real, complete, readable run. Persisted unconditionally
  // otherwise — not gated behind a separate "--update" step the way FORGE's own internal `scripts/
  // check-coverage-ratchet.mjs` gates it for a human to run deliberately: a genuine regression can
  // never lower a stored mark (`ratchet.ts`'s own header comment traces every branch), so
  // auto-persisting `next` here, once the baseline itself is known-good, only ever raises marks on
  // real improvement — safe for an unattended `G-Verify` run, and necessary for one, since nothing
  // else in this product ever invokes a second, human-run "update" command (`SPEC-QUESTIONS.md`
  // Q127).
  if (problems.length === 0) {
    try {
      await writeBaseline(ctx.paths, next);
    } catch (cause) {
      problems.push(`could not write ${BASELINE_RELATIVE_PATH}: ${describeCause(cause)}`);
    }
  }

  // `regressions` itself is the genuine, meaningful signal here (the same role `errors` plays for
  // `runLintRule`/`runTypecheckRule`) — a real regression is never routed through `problems`, which
  // stays reserved for "this check could not be trusted to reflect the real answer" (a malformed
  // baseline file, missing coverage data). Whenever `problems` is non-empty for any reason above,
  // `regressions` is forced to at least 1 too: a ratchet that could not fully verify this run must
  // never silently report a clean pass.
  const count = problems.length > 0 ? Math.max(regressions.length, 1) : regressions.length;
  return problems.length > 0
    ? { coverage: 0, regressions: count, problems }
    : { coverage: 0, regressions: count };
}

/** `forge test coverage [--rule acceptance-criteria|ratchet]`'s own library function — dispatches to
 * whichever of `G-Verify.gate.yaml`'s three coverage checks `options.rule` names. Never throws for an
 * ordinary, real-world failure (no coverage data collected yet, a malformed baseline, no test results
 * recorded): every one becomes a real `problems` entry with the relevant count forced to fail its own
 * check's `failOn`, never a thrown exception or a silent pass. */
export async function testCoverage(
  ctx: TestCoverageContext,
  options: TestCoverageOptions,
): Promise<TestCoverageResult> {
  if (options.rule === 'acceptance-criteria') return runAcceptanceCriteriaCoverage(ctx);
  if (options.rule === 'ratchet') return runRatchetCoverage(ctx);
  return runDefaultCoverage(ctx);
}
