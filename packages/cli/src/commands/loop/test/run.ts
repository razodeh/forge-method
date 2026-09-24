/**
 * `testRun` — `forge test run [--rule lint|typecheck|oracle-lint]`, F-TEST-7. The library function
 * `G-Verify.gate.yaml`'s own `test:run`/`test:lint`/`test:typecheck`/`test:oracle-lint` (P5) checks
 * each shell (via `forge test run --json`/`forge test run --rule lint --json`/`--rule typecheck
 * --json`/`--rule oracle-lint --json`).
 *
 * @see specs/13 §13.1 F-TEST-7
 * @see PLAN-M8.md P4
 * @see PLAN-M8.md P5
 */
import type { ProjectPaths } from '@forge/core/fs';
import { runShellCommand } from '@forge/engine/dispatch';
import type { ForgeConfig } from '@forge/schemas/config';

import { detectEcosystem } from './ecosystem.ts';
import {
  readFlakyState,
  recordFlakeOutcome,
  writeFlakyState,
  DEFAULT_FLAKE_CONFIG,
  type FlakeConfig,
  type FlakyState,
  type FlakyTestRecord,
} from './flaky.ts';
import { runOracleLint } from './oracle-lint.ts';
import { runAndNormalize, writeNormalizedReport, type TestOutcome } from './reporter.ts';
import { containsShellChaining } from './shell-safety.ts';

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** `flaky.json`'s own real key for one outcome — never `outcome.name` alone. A fresh critic round
 * reproduced directly that two different tests sharing a literal title in two different files (an
 * entirely ordinary occurrence — `test_serialize`/`test_init`/etc. recur across real test suites
 * constantly) were silently conflated under a bare-name key: a real, deterministic failure in one
 * file was misclassified as "flaky" because a same-named *passing* test in another file made the
 * (then also name-only) retry-in-isolation step report a false pass, permanently quarantining a real
 * regression. `outcome.file` (`TestOutcome`'s own doc comment) is `undefined` only for the rare case
 * neither ecosystem's own tool output named a real file — falls back to the bare name there, the
 * same coarse identity this whole subsystem already inherited from `09` §9.5's AC-binding convention. */
function flakyKey(outcome: TestOutcome): string {
  return outcome.file === undefined ? outcome.name : `${outcome.file}::${outcome.name}`;
}

/** A hard ceiling on how many isolated retries one `forge test run` invocation will attempt — F-TEST-6
 * mandates retrying *each individual failure* once, not re-running the whole suite an unbounded
 * number of times. A fresh critic round measured this directly: retries scale linearly with failure
 * count (no cap, no per-retry timeout, fully sequential), so a single broken shared fixture that fails
 * hundreds of tests at once turns one `forge test run` into hundreds of extra full-suite-adjacent
 * subprocess spawns — on a suite that takes even a minute, a real, measured multi-hour stall. Beyond
 * this cap, remaining first-pass failures still count toward `failed` exactly as before (retrying is
 * never required for a failure to count); they are simply left unclassified for `flaky.json` this run
 * (any existing record for one of them is left untouched, not overwritten with a guess) rather than
 * silently treated as "not a flake." */
const MAX_RETRIES_PER_RUN = 50;

/** `execution.testCommands`'s own real, inferred shape (`configSchema`, `PLAN-M8.md` P3) — a record
 * keyed by F-TEST-1's seven layer names, each an optional shell-command string. Derived from
 * `ForgeConfig` directly rather than a second, hand-kept type, so the two can never drift apart. */
export type TestCommands = ForgeConfig['execution']['testCommands'];

/** `testRun`'s own real dependencies. `projectRoot` is a plain string (a shell `cwd`, never a write
 * target) alongside `paths` (a real `ProjectPaths`, used only for `detectEcosystem`'s own
 * containment-checked reads and `writeNormalizedReport`'s atomic write) — the identical split
 * `forge review`'s own `ReviewDeps` already establishes for the same reason. */
export interface TestRunContext {
  readonly paths: ProjectPaths;
  readonly projectRoot: string;
  readonly testCommands: TestCommands;
  /** `quality.flake` — F-TEST-6's own rolling-window/threshold/quarantine-cap config. Defaults to
   * `DEFAULT_FLAKE_CONFIG` (F-TEST-6's own literal defaults) when a caller has no real project config
   * to hand — a real caller (`bin.ts`) always passes the target project's own, already-read value. */
  readonly flakeConfig?: FlakeConfig;
  /** `false` runs the commands and reports, but leaves `docs/forge/reports/test-results.json` and `flaky.json`
   * untouched. `forge test run` is the one command that owns those two files (each run replaces the report and
   * prunes the flake records to what it saw); a caller that runs only ONE layer for its own purposes (`forge
   * story verify`) must not overwrite the project-wide report with a partial one or drop the flake and
   * quarantine history of the layers it did not run. Defaults to `true`. */
  readonly persistState?: boolean;
}

/** `rule` selects which of `G-Verify.gate.yaml`'s checks this call answers: absent runs the
 * default aggregation (`test:run`); `'lint'`/`'typecheck'` shell that one `testCommands` entry
 * directly (`test:lint`/`test:typecheck`) — neither has AC-bound "outcomes" the normalised reporter
 * shape fits, so each gets its own real diagnostic-counting path instead. `'oracle-lint'` (`test:
 * oracle-lint`, P5) needs no `testCommands` entry at all — it scans the project's own test files
 * directly, never shelling a project-authored command. */
export interface TestRunOptions {
  readonly rule?: 'lint' | 'typecheck' | 'oracle-lint';
  /** Scopes the default rule's own test-layer command(s) to exactly these already-validated,
   * project-relative test file paths (`PLAN-M14.md` P26, `story.ts`'s only real caller — its own
   * `validateTestPath`-checked expansion of a story's `files_expected`) — reaches `runAndNormalize`'s
   * own file-scoping seam as a closed positional list, never a pattern. Ignored when `rule` is set
   * (lint/typecheck/oracle-lint have no per-file form). `undefined` or `[]` runs the whole configured
   * layer command, unchanged. */
  readonly files?: readonly string[];
}

/** `failed`/`errors` are always both present (`test:run`'s own `failOn: 'failed > 0'` and `test:
 * lint`/`test:typecheck`'s own `failOn: 'errors > 0'` are two different, already-shipped gate
 * checks reading the same JSON envelope) — only one is ever semantically meaningful for a given
 * `options.rule`; the other stays `0`. `problems`, when non-empty, names every real reason the run
 * could not fully complete (an unrecognised ecosystem, a layer with no configured command, a tool
 * that failed to run) — `09` §9.5's own "a layer with no command reports as unable to verify, never
 * as passing" is enforced by forcing the relevant count to at least `1` whenever `problems` is
 * non-empty, never leaving a `0` that would read as a clean pass. */
export interface TestRunResult {
  readonly failed: number;
  readonly errors: number;
  readonly outcomes?: readonly TestOutcome[];
  readonly problems?: readonly string[];
}

/** F-TEST-1's own pyramid marks NFR as "out-of-band, nightly" — deliberately excluded from the
 * default `forge test run`'s own aggregation (`13` §13.1's own table), which runs every *other*
 * declared layer a project actually has. `lint`/`typecheck` are never part of this list: each is
 * its own explicit `--rule`, with no AC-bound "outcomes" the normalised reporter's shape fits. */
const DEFAULT_RUN_LAYERS = ['unit', 'integration', 'contract', 'e2e'] as const;

async function runDefaultRule(
  ctx: TestRunContext,
  options: TestRunOptions,
  createTempPath: () => string,
): Promise<TestRunResult> {
  // `[]` reads the same as absent: a caller narrowing to zero files has nothing to scope to, not a
  // request to run zero tests silently.
  const files = options.files !== undefined && options.files.length > 0 ? options.files : undefined;
  const ecosystem = await detectEcosystem(ctx.paths);
  if (ecosystem === 'unknown') {
    return {
      failed: 1,
      errors: 0,
      problems: [
        'could not determine the project ecosystem (no package.json, pyproject.toml, pytest.ini, or setup.cfg found)',
      ],
    };
  }

  const outcomes: TestOutcome[] = [];
  const problems: string[] = [];
  let declaredAny = false;
  // F-TEST-6's own retry-in-isolation classification (P7): flakyKey(outcome) -> whether the isolated
  // retry passed (a real flake occurrence) — populated only for outcomes that failed on the first
  // pass, retried through the *same* layer's own command, scoped to the *same* originating file
  // (`outcome.file`) whenever known. Never consulted for `realFailures` below (a first-pass failure
  // always counts there, retried or not — "retries are never used to make a gate pass," F-TEST-6's
  // own explicit rule); only `docs/forge/reports/flaky.json`'s own rolling window, further down, reads
  // it. A key absent here (the retry cap below was hit) means "not retried this run" — deliberately
  // distinct from "retried and reproduced," so this run's own flaky.json update can leave that test's
  // existing record untouched rather than guessing.
  const flakeOccurrence = new Map<string, boolean>();
  let retriesUsed = 0;
  let retryCapHit = false;

  for (const layer of DEFAULT_RUN_LAYERS) {
    const command = ctx.testCommands[layer];
    if (command === undefined) continue;
    declaredAny = true;
    const result = await runAndNormalize(
      command,
      ctx.projectRoot,
      ecosystem,
      createTempPath,
      undefined,
      undefined,
      files,
    );
    if (result.outcome === 'tool-error') {
      problems.push(`testCommands.${layer} ("${command}") failed to run: ${result.message}`);
      continue;
    }
    // A fresh critic round reproduced this directly: a real command that *runs* but matches zero
    // test files (a typo'd glob, a renamed test directory) reports `outcome: 'ran'` with an empty
    // `outcomes` array — indistinguishable, before this check, from "ran and everything passed."
    // Nothing was actually verified, so this is a real problem, not a silent pass.
    if (result.report.outcomes.length === 0) {
      problems.push(
        `testCommands.${layer} ("${command}") ran but matched or collected zero tests.`,
      );
      continue;
    }
    outcomes.push(...result.report.outcomes);

    for (const outcome of result.report.outcomes) {
      if (outcome.status !== 'fail') continue;
      if (retriesUsed >= MAX_RETRIES_PER_RUN) {
        retryCapHit = true;
        continue;
      }
      retriesUsed += 1;
      const retry = await runAndNormalize(
        command,
        ctx.projectRoot,
        ecosystem,
        createTempPath,
        outcome.name,
        outcome.file,
      );
      if (retry.outcome === 'tool-error') {
        problems.push(
          `could not retry "${outcome.name}" in isolation to classify it: ${retry.message}`,
        );
      }
      const retryPassed =
        retry.outcome === 'ran' &&
        retry.report.outcomes.some(
          (candidate) =>
            candidate.name === outcome.name &&
            candidate.status === 'pass' &&
            (outcome.file === undefined || candidate.file === outcome.file),
        );
      flakeOccurrence.set(flakyKey(outcome), retryPassed);
    }
  }
  if (retryCapHit) {
    problems.push(
      `more than ${String(MAX_RETRIES_PER_RUN)} tests failed on their first pass — retry-in-isolation classification was skipped for the rest this run (still counted as real failures below).`,
    );
  }

  if (!declaredAny) {
    problems.push(
      'no test-layer command is configured (execution.testCommands has none of unit/integration/contract/e2e)',
    );
  }

  const persistState = ctx.persistState !== false;
  if (persistState) await writeNormalizedReport(ctx.paths, { outcomes });

  // F-TEST-6's own rolling flake tracking — a real, separate durable-state file from
  // `test-results.json` above. A present-but-unusable `flaky.json` degrades to the empty state
  // rather than blocking `forge test run` itself (a different job than flake tracking), but is still
  // a real `problems` entry, never silently discarded — and, per `testCollectionWasClean` below,
  // never persisted over the top of a real, prior state it could not actually read.
  const testCollectionWasClean = problems.length === 0;
  let flakyState: FlakyState;
  try {
    flakyState = await readFlakyState(ctx.paths);
  } catch (cause) {
    problems.push(`could not read docs/forge/reports/flaky.json: ${describeCause(cause)}`);
    flakyState = { v: 1, tests: {} };
  }
  // F-TEST-6: "excluded from the gate" — a test already quarantined *before* this run started never
  // counts toward this invocation's own `failed`, regardless of whether it failed again just now. A
  // test crossing the threshold *during* this run is not excluded until the next one ("marked
  // quarantined... on the next forge test run" — F-TEST-6's own explicit phrasing) — read once, here,
  // before this run's own updates below. Keyed by `flakyKey`, not a bare test name — `flaky.ts`'s own
  // `FlakyState` doc comment has the fuller reasoning.
  const quarantinedAtStart = new Set(
    Object.entries(flakyState.tests)
      .filter(([, record]) => record.quarantined)
      .map(([key]) => key),
  );

  const seenThisRun = new Set(outcomes.map(flakyKey));
  // `Object.create(null)`, not a plain object literal: a fresh critic round reproduced directly that
  // a test literally named `__proto__` (a real, if unusual, string — nothing forbids it) silently
  // mutated the object's own prototype instead of adding an own key, when assigned via `obj[key] =`
  // on an ordinary `{}`. A null-prototype object has no such special key at all.
  const nextTests: Record<string, FlakyTestRecord> = Object.create(null) as Record<
    string,
    FlakyTestRecord
  >;
  // A fresh critic round reproduced directly that carrying `...flakyState.tests` forward
  // unconditionally lets a deleted/renamed test's own stale (possibly quarantined) record accumulate
  // forever — nothing else in this system ever removes one, and a quarantined-but-nonexistent test
  // permanently blocks both `test:flaky` and `test:quarantine-cap` with no way to fix it short of a
  // hand edit. Pruned here to exactly this run's own real outcomes — but **only** when this run's own
  // test collection was itself completely clean (`testCollectionWasClean`, captured before flaky.json
  // was even touched): a transient tool failure (a crashed layer, an undeclared command) must never
  // be misread as "this test no longer exists," which would prune away a real, still-valid latch.
  for (const [key, record] of Object.entries(flakyState.tests)) {
    if (seenThisRun.has(key) || !testCollectionWasClean) nextTests[key] = record;
  }
  const flakeConfig = ctx.flakeConfig ?? DEFAULT_FLAKE_CONFIG;
  for (const outcome of outcomes) {
    // A `skip`ped test was not actually exercised this run — nothing real to record either way.
    if (outcome.status === 'skip') continue;
    const key = flakyKey(outcome);
    // Not retried this run (the cap above was hit) — leave any existing record untouched rather than
    // guessing at a classification nothing actually observed.
    if (outcome.status === 'fail' && !flakeOccurrence.has(key)) continue;
    const isFlakeOccurrence = outcome.status === 'fail' && (flakeOccurrence.get(key) ?? false);
    nextTests[key] = recordFlakeOutcome(nextTests[key], isFlakeOccurrence, flakeConfig);
  }
  // Persisted only when nothing above already forced a `problems` entry: a present-but-unusable
  // `flaky.json` must never be silently overwritten with this run's own data computed against the
  // empty stand-in `readFlakyState`'s own failure degraded to — the identical "an unusable durable
  // state file is never the source a fresh write gets built from" principle `coverage.ts`'s own
  // `runRatchetCoverage` already establishes for its own baseline file, for the identical reason (a
  // fresh critic round reproduced this directly here too: doing otherwise let a real regression's own
  // quarantine latch get destroyed on the very run that discovered the file was unusable, laundered
  // clean on the next one).
  if (persistState && problems.length === 0) {
    try {
      await writeFlakyState(ctx.paths, { v: 1, tests: nextTests });
    } catch (cause) {
      problems.push(`could not write docs/forge/reports/flaky.json: ${describeCause(cause)}`);
    }
  }

  const realFailures = outcomes.filter(
    (outcome) => outcome.status === 'fail' && !quarantinedAtStart.has(flakyKey(outcome)),
  ).length;
  const failed = problems.length > 0 ? Math.max(realFailures, 1) : realFailures;
  return problems.length > 0
    ? { failed, errors: 0, outcomes, problems }
    : { failed, errors: 0, outcomes };
}

interface EslintFileResult {
  readonly errorCount?: unknown;
}

/** Returns `undefined`, never throws, when `raw` is not eslint's own real `--format json` array
 * shape — the caller reports this as a real `problems` entry itself rather than this function
 * raising a bare, uncaught-looking exception for what is, from here, an ordinary "the tool's output
 * did not parse" outcome. */
function countEslintErrors(raw: string): number | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  return (parsed as readonly EslintFileResult[]).reduce(
    (total, file) => total + (typeof file.errorCount === 'number' ? file.errorCount : 0),
    0,
  );
}

async function runLintRule(ctx: TestRunContext): Promise<TestRunResult> {
  const command = ctx.testCommands.lint;
  if (command === undefined) {
    return {
      failed: 0,
      errors: 1,
      problems: ['no lint command configured (execution.testCommands.lint)'],
    };
  }
  // A fresh critic round reproduced this directly: `testCommands.lint` is a project-authored shell
  // string, and a real, ordinary one (`"eslint . && echo done"`) breaks blind flag-appending —
  // `shell-safety.ts`'s own doc comment has the full reasoning for why this is reported as a real
  // problem rather than silently run and misread.
  if (containsShellChaining(command)) {
    return {
      failed: 0,
      errors: 1,
      problems: [
        `testCommands.lint ("${command}") contains shell chaining (&&, ||, ;, |, redirection, or command substitution) — cannot safely append --format json to it.`,
      ],
    };
  }
  const result = await runShellCommand(`${command} --format json`, ctx.projectRoot);
  const errors = countEslintErrors(result.stdout);
  if (errors === undefined) {
    return {
      failed: 0,
      errors: 1,
      problems: [
        `testCommands.lint ("${command}") produced unparseable output (exit ${String(result.exitCode)}).`,
      ],
    };
  }
  return { failed: 0, errors };
}

/** `tsc` has no real JSON output mode at all (confirmed directly — its own real CLI emits plain
 * text diagnostics, one real error per line, no machine-readable summary line either in the
 * version this environment runs). Counting real `error TS\d+:` lines is the closest real,
 * deterministic signal its own output actually offers — a genuine diagnostic always starts a new
 * line with this exact shape; a continuation of a long message never does.
 *
 * The leading group is optional: a fresh critic round reproduced a real, mixed case directly — a
 * broken `tsconfig.json` (`"extends"` pointing at a moved/renamed file) alongside a real type error
 * in an included file produces *both* a file-prefixed diagnostic (`a.ts(1,7): error TS2322: ...`)
 * *and* a bare, global one with no file:line prefix at all (`error TS5083: Cannot read file ...`).
 * The original, `\S.*: `-required pattern only matched the first shape, silently under-counting
 * the second whenever at least one file-prefixed diagnostic also existed in the same run. */
const TSC_ERROR_LINE = /^(?:\S.*: )?error TS\d+:/gm;

function countTscErrors(output: string): number {
  return [...output.matchAll(TSC_ERROR_LINE)].length;
}

async function runTypecheckRule(ctx: TestRunContext): Promise<TestRunResult> {
  const command = ctx.testCommands.typecheck;
  if (command === undefined) {
    return {
      failed: 0,
      errors: 1,
      problems: ['no typecheck command configured (execution.testCommands.typecheck)'],
    };
  }
  const result = await runShellCommand(command, ctx.projectRoot);
  const errors = countTscErrors(result.stdout) + countTscErrors(result.stderr);
  if (errors === 0 && result.exitCode !== 0) {
    return {
      failed: 0,
      errors: 1,
      problems: [
        `testCommands.typecheck ("${command}") exited ${String(result.exitCode)} with no real diagnostic lines: ${describeShellFailure(result.stdout, result.stderr)}`,
      ],
    };
  }
  return { failed: 0, errors };
}

function describeShellFailure(stdout: string, stderr: string): string {
  const text = stderr.trim() !== '' ? stderr : stdout;
  return text.length > 500 ? `${text.slice(0, 500)}…` : text;
}

/** `test:oracle-lint` (P5) needs no `testCommands` entry at all — `runOracleLint` scans the
 * project's own test files directly, never shelling a project-authored command. Its own real
 * `problems` (a directory/file this process could not read) are forwarded verbatim, so a scan that
 * could not fully complete never reads as a silent, clean `errors: 0`. */
async function runOracleLintRule(ctx: TestRunContext): Promise<TestRunResult> {
  const result = await runOracleLint(ctx.paths);
  return result.problems === undefined
    ? { failed: 0, errors: result.errors }
    : { failed: 0, errors: result.errors, problems: result.problems };
}

/** `forge test run [--rule lint|typecheck|oracle-lint]`'s own library function — dispatches to
 * whichever of `G-Verify.gate.yaml`'s checks `options.rule` names. Never throws for an ordinary,
 * real-world failure (a tool that fails to run, a layer with no configured command, a command that
 * matched zero tests): every one becomes a real `problems` entry with the relevant count forced to
 * at least `1`, never a thrown exception or a silent `0` that would read as a clean pass.
 * `createTempPath` must be injected per `QUALITY-BAR.md` R10 (`system-temp.ts`'s own doc comment has
 * the full reasoning) — a real caller passes `createSystemTempPath`; a test injects a fake. */
export async function testRun(
  ctx: TestRunContext,
  options: TestRunOptions,
  createTempPath: () => string,
): Promise<TestRunResult> {
  if (options.rule === 'lint') return runLintRule(ctx);
  if (options.rule === 'typecheck') return runTypecheckRule(ctx);
  if (options.rule === 'oracle-lint') return runOracleLintRule(ctx);
  return runDefaultRule(ctx, options, createTempPath);
}
