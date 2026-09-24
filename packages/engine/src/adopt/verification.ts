/**
 * `runVerificationPhase` — `17` §17.2 phase 5 (VERIFICATION)'s own real, sandboxed half: the build and
 * test execution `@forge/kb/adopt/verification.ts`'s own module doc comment names as needing edges that
 * pure module deliberately does not have (a real git clone, a real subprocess, a real timeout — `vcs`,
 * subprocess execution). Confirmed directly before writing this piece: `tools/eslint-plugin-forge-
 * boundaries/src/graph.mjs`'s own `PACKAGE_GRAPH` gives `kb: ['core', 'schemas', 'diagrams']`, no `vcs`/
 * `engine` edge, while `engine: [..., 'kb', 'vcs', ...]` already runs the other way — so this file lives
 * in `@forge/engine`, calling into `@forge/kb/adopt`'s pure evidence-recheck/assembly logic, the identical
 * `engine -> kb` shape `PLAN-M10.md` P16 already established for CARTOGRAPHY/INFERENCE (`SPEC-QUESTIONS.md`
 * Q156) and P10 established for `engine -> sessions`.
 *
 * **Sandboxing pattern**: a clean, isolated checkout via a real `git clone` into a `mkdtemp` directory,
 * matching `@forge/vcs`'s own already-established `mkdtemp` + real git patterns and `packages/engine/test/
 * e2e/crash-resume.test.ts`'s own `createTempRepo` precedent directly, rather than `@forge/vcs`'s own
 * `createLaneWorktree`/lane machinery — that machinery manages worktrees *of FORGE's own project
 * repository* for parallel lane execution, a genuinely different operation from cloning an arbitrary
 * *target* repository being adopted for a one-shot, read-only build/test run with no lane, no branch, and
 * no commit. `execa`'s own `timeout` option (not a hand-rolled `setTimeout`/`kill`) is the real timeout
 * `17` §17.2 phase 5 requires — a build or test command that hangs is killed and reported as
 * `inconclusive`, never left to hang the whole adoption run.
 *
 * The clone lives under `<sourceRoot>/.forge/state/adopt-verify/`, not the OS temp directory: `QUALITY-
 * BAR.md` R10 forbids reading an ambient host fact such as `os.tmpdir()` from production code (a real
 * `no-restricted-imports` lint rule, not merely a convention) since it makes the exact location
 * machine-dependent — `@forge/vcs`'s own `createLaneWorktree` already establishes the identical pattern
 * for a different kind of temporary git state (`.forge/state/worktrees/<laneId>/`), so this reuses the
 * same project-relative, deterministic base rather than inventing a second one.
 *
 * Duration is deliberately not measured here: this codebase's own R10 rule also forbids `Date.now()`/
 * `performance.now()` outside a test file, and `input.clock` is `@forge/core`'s own ISO-8601-string
 * `Clock`, not a millisecond one — precise timing is a nicety a real command's own exit code and captured
 * output do not depend on, and reporting it just for prose would need an ambient timer this module has no
 * legitimate injected source for.
 *
 * **Failures are findings, not blockers** (`17` §17.2 phase 5's own literal rule): every code path below
 * — clone failure, non-zero exit, or timeout — resolves to a real `RawVerificationCheck`, never throws.
 * A `ForgeError` here would force a caller to choose between aborting adoption on an environment hiccup or
 * adding its own catch-and-degrade logic; resolving uniformly means `assembleVerification` (this file's
 * one real caller-facing contract, alongside the pure structural re-checks) always receives a complete,
 * uniform list regardless of what actually happened underneath.
 *
 * @see specs/17 §17.2
 * @see PLAN-M10.md P17
 * @see SPEC-QUESTIONS.md Q152
 * @see SPEC-QUESTIONS.md Q156
 */
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';

import type { Clock } from '@forge/core';
import {
  assembleVerification,
  buildEvidenceIndex,
  verifyCartographyFinding,
  verifyConventionFinding,
  type CartographyFinding,
  type InferenceFinding,
  type RawVerificationCheck,
  type Survey,
  type Inventory,
  type VerificationResult,
  type VerificationSubject,
} from '@forge/kb/adopt';
import { errorMessage } from '@forge/vcs';
import { execa } from 'execa';

import {
  PROPOSED_ENV_FIXED,
  runConfinedCommand,
  STORED_COMMAND_LIMITS,
  vetStoredCommand,
} from '../dispatch/confined-command.ts';

/** Conservative defaults for a target repository this codebase has never seen before and cannot presume
 * anything about the scale of — `17` §17.2 gives no numbers for this budget, the identical spec-silence
 * shape `@forge/engine/adopt/analysis-node.ts`'s own `ANALYSIS_LIMITS` already resolves for a CARTOGRAPHY/
 * INFERENCE dispatch call's own turn/time budget. Both overridable per call, never hard-coded past the
 * caller's own choice. */
export const DEFAULT_BUILD_TIMEOUT_MS = 300_000;
export const DEFAULT_TEST_TIMEOUT_MS = 300_000;

/** Resolves `relativePath` against `sourceRoot` and confirms the *real* (symlink-resolved) result still
 * lands inside the *real* `sourceRoot` — `undefined` when it does not, or when either path cannot be
 * resolved at all (a dangling symlink, a race with something deleting the target). `relativePath` here
 * always comes from a prior SURVEY pass over the untrusted target repository (`ManifestSignal.path`), so
 * a `..`-laden value or a symlink planted inside the target repo pointing outside it must never be
 * followed for a real file read — a gauntlet critic found this containment check entirely absent from
 * the first version of `detectCommands` below, the same "resolve, then verify containment" discipline
 * `@forge/core/fs`'s own `ProjectPaths.resolveWithin` already applies to every ordinary project write,
 * applied here for a read of attacker-influenced repo content instead. Checked in two steps: the plain
 * lexical resolution first (rejects an absolute path or a `..` escape outright, cheaply, before any I/O),
 * then the real, symlink-resolved paths (rejects a symlink escape a purely lexical check cannot see). */
async function resolveContainedManifestPath(
  sourceRoot: string,
  relativePath: string,
): Promise<string | undefined> {
  const resolved = path.resolve(sourceRoot, relativePath);
  const lexicalRelative = path.relative(sourceRoot, resolved);
  if (lexicalRelative.startsWith('..') || path.isAbsolute(lexicalRelative)) return undefined;

  try {
    const [realSourceRoot, realResolved] = await Promise.all([
      realpath(sourceRoot),
      realpath(resolved),
    ]);
    const realRelative = path.relative(realSourceRoot, realResolved);
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) return undefined;
  } catch {
    return undefined;
  }
  return resolved;
}

/** `package.json`'s own `scripts.build`/`scripts.test` — the one build/test detection this piece
 * implements, matching `PLAN-M10.md` P15's own disclosed JS/TS-only scope narrowing for the dependency
 * graph extractor (`SPEC-QUESTIONS.md` Q152, point 2) rather than inventing a five-tool-per-ecosystem
 * detector `17` §17.2's own table gives no worked example for. A target repo in another toolchain
 * (`survey.manifests` names one other than `node`) contributes no `build` command from this function at
 * all; its own CI-detected test command (`survey.testSetup.ciTestCommands`, already real and
 * toolchain-agnostic since it comes from parsing the CI config file text, not the manifest) is still used
 * for `test` when present.
 *
 * The catch below is deliberately broad -- it also swallows a real I/O failure (a permission error, a
 * transient read failure) alongside a genuinely malformed `package.json`, both collapsing to "no command
 * detected" rather than a distinct, reported failure. Disclosed rather than distinguished: the *consequence*
 * either way is the same safe direction (a build/test check is silently skipped, never fabricated as
 * passing), matching this codebase's own `runShellCommand` precedent of resolving to data rather than
 * throwing for an environment-level hiccup -- a more precise split is additive work a future piece can add
 * without changing this function's own shape. */
async function detectCommands(
  sourceRoot: string,
  survey: Survey,
): Promise<{ readonly build: string | undefined; readonly test: string | undefined }> {
  const nodeManifest = survey.manifests.find((manifest) => manifest.toolchain === 'node');
  if (nodeManifest !== undefined) {
    const containedPath = await resolveContainedManifestPath(sourceRoot, nodeManifest.path);
    if (containedPath !== undefined) {
      try {
        const raw = await readFile(containedPath, 'utf8');
        const parsed = JSON.parse(raw) as { readonly scripts?: Readonly<Record<string, unknown>> };
        const scripts = parsed.scripts ?? {};
        return {
          build: typeof scripts['build'] === 'string' ? 'npm run build' : undefined,
          test:
            typeof scripts['test'] === 'string' ? 'npm test' : survey.testSetup.ciTestCommands[0],
        };
      } catch {
        // A malformed package.json (or a real I/O failure reading it) contributes no detected command --
        // see this function's own doc comment for why both collapse to the same safe outcome here.
      }
    }
  }
  return { build: undefined, test: survey.testSetup.ciTestCommands[0] };
}

/** `<sourceRoot>/.forge/state/adopt-verify/` — project-relative, not the OS temp directory. See this
 * file's own module doc comment for why.
 *
 * `mkdtemp` itself creates a real, empty directory on disk *before* `git clone` ever runs into it — a
 * gauntlet critic found a first version of this function left that directory behind permanently when the
 * clone step itself failed (a non-git `sourceRoot`, a permission error), since the caller's own
 * `try`/`catch` around this whole function had no path back to the partially-created directory to remove
 * it. Cleaned up here, at the one place that knows the directory exists, rather than leaking that
 * knowledge out to every caller. */
async function createSandboxClone(sourceRoot: string): Promise<string> {
  const base = path.join(sourceRoot, '.forge', 'state', 'adopt-verify');
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(path.join(base, 'clone-'));
  try {
    await execa('git', ['clone', '--quiet', '--no-hardlinks', sourceRoot, dir]);
  } catch (cause) {
    await rm(dir, { recursive: true, force: true });
    throw cause;
  }
  return dir;
}

/**
 * Runs one real command (`npm run build`/`npm test`, or whatever `detectCommands` found) in a clean,
 * isolated clone of `sourceRoot`, with a real timeout, and reports the result as a `RawVerificationCheck`
 * — never throwing, per this file's own module doc comment.
 *
 * The command was DERIVED FROM THE TARGET REPOSITORY (`package.json`, a CI config file) — text a third
 * party wrote, not FORGE's own — so it runs through the identical confinement `PLAN-M14.md` P28 gives a
 * model-proposed command: `vetStoredCommand` (the syntax/network/package-manager/git/argument/path-
 * containment stages, rooted at the sandbox clone, so a path-escape check contains the command to the
 * clone rather than `sourceRoot` itself), then `runConfinedCommand` (the scrubbed environment — `env`,
 * never read ambiently here, R10 — closed stdin, the clone as cwd, a timeout and an output cap). A
 * refused command never runs at all: reported as `inconclusive`, per this file's own "failures are
 * findings, not blockers" rule, with a detail that starts `refused (<reason>)` so a caller can tell a
 * genuine drift finding from a command this repository's own text could not be trusted to run.
 */
async function runCommandCheck(
  kind: 'build' | 'test',
  sourceRoot: string,
  command: string,
  timeoutMs: number,
  clock: Clock,
  env: Readonly<Record<string, string | undefined>>,
): Promise<RawVerificationCheck> {
  const subject: VerificationSubject = {
    origin: 'repository',
    statement: kind === 'build' ? 'the build succeeds' : 'the test suite passes',
  };

  let cloneDir: string | undefined;
  try {
    cloneDir = await createSandboxClone(sourceRoot);
  } catch (cause) {
    return {
      kind,
      subject,
      outcome: 'inconclusive',
      detail: `could not create an isolated clone of the target repository to verify this: ${errorMessage(cause)}`,
      command,
      measuredAt: clock.now(),
    };
  }

  try {
    const refusal = await vetStoredCommand(command, cloneDir);
    if (refusal !== undefined) {
      return {
        kind,
        subject,
        outcome: 'inconclusive',
        detail: `refused (${refusal.reason}): ${refusal.detail}`,
        command,
        measuredAt: clock.now(),
      };
    }

    const result = await runConfinedCommand(command, cloneDir, {
      limits: { timeoutMs, maxOutputBytes: STORED_COMMAND_LIMITS.maxOutputBytes },
      parentEnv: env,
      extraEnv: PROPOSED_ENV_FIXED,
    });

    if (result.timedOut) {
      return {
        kind,
        subject,
        outcome: 'inconclusive',
        detail: `"${command}" did not finish within ${String(timeoutMs)}ms and was killed.`,
        command,
        measuredAt: clock.now(),
      };
    }

    if (result.exitCode === 0) {
      return {
        kind,
        subject,
        outcome: 'pass',
        detail: `"${command}" exited 0.`,
        command,
        measuredAt: clock.now(),
      };
    }
    // Truncated: a genuinely broken build/test command's own output can run to many kilobytes (a full
    // TypeScript error dump, a stack trace per failing test) -- the fact that it failed, and enough of
    // the output to act on, matters far more here than every byte of it.
    const output = (result.stderr || result.stdout).slice(0, 2000);
    return {
      kind,
      subject,
      outcome: 'fail',
      detail: `"${command}" exited ${String(result.exitCode)}: ${output}`,
      command,
      measuredAt: clock.now(),
    };
  } catch (cause) {
    return {
      kind,
      subject,
      outcome: 'inconclusive',
      detail: `"${command}" could not be run: ${errorMessage(cause)}`,
      command,
      measuredAt: clock.now(),
    };
  } finally {
    await rm(cloneDir, { recursive: true, force: true });
  }
}

/** Runs the real, mandatory build and test checks (`17` §17.2 phase 5: "running the build and the test
 * suite is mandatory"), skipping either one this repository has no detected command for at all — an
 * absent command is not itself reported as a failed check (there is nothing to run), a disclosed,
 * intentional gap rather than a fabricated result.
 *
 * `env` is the real process environment the confined command is scrubbed FROM (`runCommandCheck`'s own
 * doc comment) — required, and never read ambiently here (R10): the one real caller allowed to read
 * `process.env` is the CLI composition root that calls this. */
export async function runBuildAndTestChecks(
  sourceRoot: string,
  survey: Survey,
  clock: Clock,
  env: Readonly<Record<string, string | undefined>>,
  buildTimeoutMs: number = DEFAULT_BUILD_TIMEOUT_MS,
  testTimeoutMs: number = DEFAULT_TEST_TIMEOUT_MS,
): Promise<readonly RawVerificationCheck[]> {
  const { build, test } = await detectCommands(sourceRoot, survey);
  const checks: RawVerificationCheck[] = [];
  if (build !== undefined) {
    checks.push(await runCommandCheck('build', sourceRoot, build, buildTimeoutMs, clock, env));
  }
  if (test !== undefined) {
    checks.push(await runCommandCheck('test', sourceRoot, test, testTimeoutMs, clock, env));
  }
  return checks;
}

export interface VerificationPhaseInput {
  /** The real, on-disk target repository being adopted — must be a real git repository (a plain
   * directory with no commits cannot be `git clone`d), matching every other real signal this adoption
   * pipeline already requires one for. */
  readonly sourceRoot: string;
  readonly survey: Survey;
  readonly inventory: Inventory;
  readonly cartographyFindings: readonly CartographyFinding[];
  readonly inferenceFindings: readonly InferenceFinding[];
  readonly clock: Clock;
  /** The real process environment a detected build/test command is confined to (`runCommandCheck`'s own
   * doc comment, `PLAN-M14.md` P28) — required, injected rather than read ambiently here (R10). */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly buildTimeoutMs?: number;
  readonly testTimeoutMs?: number;
}

/**
 * Runs every `17` §17.2 phase 5 check this piece implements and assembles the combined result through
 * `@forge/kb`'s own `assembleVerification`: the pure structural re-checks (every CARTOGRAPHY finding,
 * every `convention`-kind INFERENCE finding — `intent`/`nfr`/`glossary` findings have no structural test
 * and are deliberately never given one, see `@forge/kb/adopt/verification.ts`'s own module doc comment),
 * plus the real, sandboxed build/test execution above.
 *
 * `input.survey`/`input.inventory` are *not* re-derived here — a caller re-running SURVEY/INVENTORY
 * itself before calling this (`17` §17.5's own `--incremental` re-run) is what gives the structural
 * re-checks their real drift-detection value; supplying the identical `Survey`/`Inventory` CARTOGRAPHY/
 * INFERENCE already used (an ordinary, single-pass `forge adopt` run) makes them act as an internal
 * consistency check instead, which is still a real, if less eventful, thing to confirm.
 *
 * Convention re-verification is disclosed, not silently faked: recomputing a fresh adherence ratio needs
 * a real grep re-scan of the target repository's own source files, which this piece does not implement
 * (a convention statement is free text with no fixed extraction rule the way a build/test command is) —
 * every `convention`-kind INFERENCE finding is therefore verified as `inconclusive` by this real
 * orchestration today, recorded honestly as a gap rather than a guessed pass or fail.
 * `@forge/kb/adopt/verification.ts`'s own `verifyConventionFinding` is fully implemented and tested for
 * the case a fresh ratio *is* supplied — a future piece can wire a real recount in without changing this
 * function's own shape.
 */
export async function runVerificationPhase(
  input: VerificationPhaseInput,
): Promise<VerificationResult> {
  const measuredAt = input.clock.now();
  const freshIndex = buildEvidenceIndex(input.survey, input.inventory);

  const structuralChecks: RawVerificationCheck[] = [
    ...input.cartographyFindings.map((finding) =>
      verifyCartographyFinding(finding, freshIndex, measuredAt),
    ),
    ...input.inferenceFindings
      .filter(
        (finding): finding is InferenceFinding & { readonly kind: 'convention' } =>
          finding.kind === 'convention',
      )
      .map((finding) => verifyConventionFinding(finding, undefined, measuredAt)),
  ];

  const commandChecks = await runBuildAndTestChecks(
    input.sourceRoot,
    input.survey,
    input.clock,
    input.env,
    input.buildTimeoutMs,
    input.testTimeoutMs,
  );

  return assembleVerification([...structuralChecks, ...commandChecks]);
}
