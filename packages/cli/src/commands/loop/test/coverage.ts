/**
 * `testCoverage` — `story:ac-coverage`/`test:coverage`/`coverage:ratchet` (`G-Verify`), for real.
 * Never runs coverage collection itself — that stays the declared `testCommands` command's own job
 * (`13` §13.1 F-TEST-5's own framing: coverage is a floor detector, not something this layer
 * generates); this function only reads what a real coverage/test run already wrote.
 *
 * @see specs/13 §13.1 F-TEST-5
 * @see specs/09 §9.5
 * @see PLAN-M8.md P6
 */
import { realpath } from 'node:fs/promises';
import path from 'node:path';

import { pathExists, readTextFile, writeFileAtomic, type ProjectPaths } from '@forge/core/fs';
import { storySchema, type Story } from '@forge/schemas';

import { listSpecArtifacts } from '../../shared.ts';
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
 * target) used only to turn `coverage-summary.json`'s own real absolute-path keys into
 * project-relative ones for `--rule ratchet` — the identical `paths`/`projectRoot` split `run.ts`'s
 * own `TestRunContext` already establishes. */
export interface TestCoverageContext {
  readonly paths: ProjectPaths;
  readonly projectRoot: string;
  readonly specsRoot: string;
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

// --- coverage-summary.json (istanbul-shaped, real shape confirmed directly against a real run in
// this environment during this piece's own build: `{ [absolutePath]: { lines: {pct, covered,
// total, ...}, statements: {...}, functions: {...}, branches: {...} }, total: {...same shape, plus
// branchesTrue} }`) --------------------------------------------------------------------------------

const COVERAGE_SUMMARY_RELATIVE_PATH = 'coverage/coverage-summary.json';

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

/** Reads and parses `coverage/coverage-summary.json`, tolerating every real way it can fail to exist
 * or be usable (never present at all — coverage was never collected; present but unreadable; present
 * but not real JSON) as a `problems` entry rather than a thrown exception, matching every other `forge
 * test *` piece's own "fail closed, report honestly" discipline (`run.ts`/`oracle-lint.ts`). */
async function readCoverageSummary(
  paths: ProjectPaths,
  problems: string[],
): Promise<IstanbulSummary | undefined> {
  const target = paths.resolveWithin(COVERAGE_SUMMARY_RELATIVE_PATH);
  if (!(await pathExists(target))) {
    problems.push(
      `no coverage data found at ${COVERAGE_SUMMARY_RELATIVE_PATH} — run the project's own configured test command with coverage enabled first.`,
    );
    return undefined;
  }
  let raw: string;
  try {
    raw = await readTextFile(target);
  } catch (cause) {
    problems.push(`could not read ${COVERAGE_SUMMARY_RELATIVE_PATH}: ${describeCause(cause)}`);
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    problems.push(`${COVERAGE_SUMMARY_RELATIVE_PATH} is not valid JSON: ${describeCause(cause)}`);
    return undefined;
  }
  if (!isPlainObject(parsed)) {
    problems.push(`${COVERAGE_SUMMARY_RELATIVE_PATH} is not a real JSON object.`);
    return undefined;
  }
  return parsed as IstanbulSummary;
}

// --- default rule: test:coverage (flat, whole-project line coverage) ------------------------------

async function runDefaultCoverage(ctx: TestCoverageContext): Promise<TestCoverageResult> {
  const problems: string[] = [];
  const summary = await readCoverageSummary(ctx.paths, problems);
  if (summary === undefined) return { coverage: 0, regressions: 0, problems };
  const pct = summary['total']?.lines?.pct;
  if (typeof pct !== 'number') {
    problems.push(`${COVERAGE_SUMMARY_RELATIVE_PATH} has no real "total.lines.pct" number.`);
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
 * half-built.
 *
 * `09` §9.3's own status enum (`draft`/`ready`/`in-progress`/`in-review`/`verified`/`done`/
 * `blocked`) has nothing after `'done'` except the lateral `'blocked'` state — so `13` §13.1's own
 * "every AC of every `done` story" (F-TEST-5) and this piece's own "`done`(+)" phrasing
 * (`PLAN-M8.md` P6) collapse to exactly `status === 'done'`; there is no further, higher status to
 * include. */
function isDoneStory(story: Story): boolean {
  return story.status === 'done';
}

async function loadDoneStories(paths: ProjectPaths, specsRoot: string): Promise<readonly Story[]> {
  const docs = await listSpecArtifacts(paths, specsRoot);
  const stories: Story[] = [];
  for (const doc of docs) {
    const result = storySchema.safeParse(doc.frontMatter);
    if (result.success && isDoneStory(result.data)) stories.push(result.data);
  }
  return stories;
}

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

/** Converts `coverage-summary.json`'s own real absolute-path keys into project-relative, forward-
 * slash paths `ratchet.ts`'s own `packageTotals` groups by. `realpath`s `projectRoot` first: the
 * coverage summary records real (symlink-resolved) paths while a project root a caller passes in may
 * not be — `scripts/check-coverage-ratchet.mjs`'s own doc comment records the identical, real gotcha
 * this is ported from (on macOS, `/var` is itself a symlink to `/private/var`, and the mismatch
 * silently produces `../../..`-prefixed keys that match no real package).
 *
 * A fresh critic round found this guarded only *that* direction: a summary whose own keys are
 * **not** realpath-canonicalised (a collector that never resolves symlinks itself, reached through a
 * project root that is itself a symlink — the exact shape `mkdtemp`'s own real temp directories have
 * on macOS) produces the identical `../..`-prefixed relative path, which `packageKeyFor` (`ratchet.ts`)
 * then silently collapses every such file into one `".."`-keyed bucket — masking any real per-package
 * regression underneath it, with no error at all. Any relative path that escapes the project root
 * (starts with `..`, or is still absolute — a foreign drive on Windows, e.g.) is therefore excluded
 * from aggregation and named in `problems` instead of silently merged into a nonsense bucket. */
function fileCoverageCountsFrom(
  summary: IstanbulSummary,
  realRoot: string,
  problems: string[],
): FileCoverageCounts {
  const counts: Record<string, FileCoverageCounts[string]> = {};
  for (const [absolutePath, fileSummary] of Object.entries(summary)) {
    if (absolutePath === 'total' || !isPlainObject(fileSummary)) continue;
    const relative = path.relative(realRoot, absolutePath).split(path.sep).join('/');
    if (relative.startsWith('../') || relative === '..' || path.isAbsolute(relative)) {
      problems.push(
        `coverage-summary.json names a file outside the project root, excluded from the ratchet: ${absolutePath}`,
      );
      continue;
    }
    counts[relative] = fileCoverageEntry(fileSummary);
  }
  return counts;
}

async function runRatchetCoverage(ctx: TestCoverageContext): Promise<TestCoverageResult> {
  const problems: string[] = [];
  const summary = await readCoverageSummary(ctx.paths, problems);
  if (summary === undefined) return { coverage: 0, regressions: 1, problems };

  const realRoot = await realpath(ctx.projectRoot);
  const counts = fileCoverageCountsFrom(summary, realRoot, problems);
  // A fresh critic round reproduced this directly: a coverage-summary.json that parses but names
  // zero real per-file entries (every file excluded as an escaped path above; a `coverage.include`
  // glob that matched nothing; a provider that wrote only its own `total` key) produced an empty
  // `achieved`, so `evaluateRatchet` found nothing to compare and reported a clean
  // `regressions: 0` — indistinguishable from "collected everything, nothing regressed." The
  // identical gap `run.ts`'s own default rule already closes for "ran but matched zero tests."
  if (Object.keys(counts).length === 0) {
    problems.push(
      `${COVERAGE_SUMMARY_RELATIVE_PATH} names no real per-file coverage entries — nothing was actually compared against the baseline.`,
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
