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
import { runOracleLint } from './oracle-lint.ts';
import { runAndNormalize, writeNormalizedReport, type TestOutcome } from './reporter.ts';
import { containsShellChaining } from './shell-safety.ts';

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
}

/** `rule` selects which of `G-Verify.gate.yaml`'s checks this call answers: absent runs the
 * default aggregation (`test:run`); `'lint'`/`'typecheck'` shell that one `testCommands` entry
 * directly (`test:lint`/`test:typecheck`) — neither has AC-bound "outcomes" the normalised reporter
 * shape fits, so each gets its own real diagnostic-counting path instead. `'oracle-lint'` (`test:
 * oracle-lint`, P5) needs no `testCommands` entry at all — it scans the project's own test files
 * directly, never shelling a project-authored command. */
export interface TestRunOptions {
  readonly rule?: 'lint' | 'typecheck' | 'oracle-lint';
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
  createTempPath: () => string,
): Promise<TestRunResult> {
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

  for (const layer of DEFAULT_RUN_LAYERS) {
    const command = ctx.testCommands[layer];
    if (command === undefined) continue;
    declaredAny = true;
    const result = await runAndNormalize(command, ctx.projectRoot, ecosystem, createTempPath);
    if (result.outcome === 'tool-error') {
      problems.push(`testCommands.${layer} ("${command}") failed to run: ${result.message}`);
      continue;
    }
    if (result.outcome === 'missing-command') continue;
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
  }

  if (!declaredAny) {
    problems.push(
      'no test-layer command is configured (execution.testCommands has none of unit/integration/contract/e2e)',
    );
  }

  await writeNormalizedReport(ctx.paths, { outcomes });

  const realFailures = outcomes.filter((outcome) => outcome.status === 'fail').length;
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
  return runDefaultRule(ctx, createTempPath);
}
