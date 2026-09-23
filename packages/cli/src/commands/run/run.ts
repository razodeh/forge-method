/**
 * `forge run <workflow> [--dry-run]` — `03` §3.2.4. The first real caller of `@forge/engine`'s own
 * public entry point (`runEngine`, M5 P20) outside its own test suite.
 *
 * @see specs/03 §3.2.4
 * @see PLAN-M5.md P20
 */
import { ForgeError, SYSTEM_CLOCK, type Clock } from '@forge/core';
import { pathExists, readTextFile, writeFileAtomic, type ProjectPaths } from '@forge/core/fs';
import type { PlatformAdapter } from '@forge/adapter-kit/types';
import type { AskPort } from '@forge/engine/dispatch';
import type { ExpressionContext } from '@forge/engine/expr';
import { compileRunPlan, type RunPlanResult, type StepNode } from '@forge/engine/plan';
import { runEngine } from '@forge/engine/run';
import type { RunState } from '@forge/engine/resume';
import { parseWorkflow } from '@forge/engine/workflow';
import type { ForgeConfig } from '@forge/schemas/config';
import { assertCleanWorkingTree } from '@forge/vcs';

import {
  TRUNK,
  buildRunEngineContext,
  ensureIntegrationWorktree,
  integrationBranchFor,
  syncIntegrationBranchToTrunk,
} from './context.ts';
import {
  createLauncherShimOrWarn,
  removeLiveLauncherShims,
  type LauncherShim,
  type LauncherSpec,
} from './launcher-shim.ts';
import { acquireRunLock, releaseRunLock, type RunLock } from './lock.ts';

export interface RunWorkflowOptions {
  readonly workflowId: string;
  readonly expressionContext: ExpressionContext;
  readonly dryRun?: boolean;
  readonly runId?: string;
  readonly host: string;
  readonly clock?: Clock;
}

export interface RunDeps {
  readonly paths: ProjectPaths;
  readonly projectRoot: string;
  readonly config: ForgeConfig;
  readonly adapter: PlatformAdapter;
  readonly workflowsRoot: string;
  readonly checksRoot: string;
  /** Project-relative directory of materialized agent definitions (`.forge/agents`). */
  readonly agentsRoot: string;
  /** How to re-launch this CLI (`launcher-shim.ts`). When present, `command` steps find the `forge` that
   * started the run on `PATH` even if none is installed. Absent (tests, library callers): `PATH` is left as
   * the environment gave it. */
  readonly launcher?: LauncherSpec | undefined;
  /** Where a non-fatal warning goes (`forge: warning: ...`), e.g. the launcher shim could not be created. */
  readonly warn?: ((message: string) => void) | undefined;
  /** How an `elicit` step gets its answers (`--answers`, a terminal; `ask.ts`, `PLAN-M13.md` P20). Absent (tests,
   * library callers): an `elicit` step fails `RUN-101` instead of guessing. */
  readonly ask?: AskPort | undefined;
}

/** The project's own materialised copy of a workflow (`.forge/workflows/<id>.workflow.yaml`), `RUN-053` when absent. */
export async function readWorkflowSource(deps: RunDeps, workflowId: string): Promise<string> {
  const relPath = `${deps.workflowsRoot}/${workflowId}.workflow.yaml`;
  if (!(await pathExists(deps.paths.resolveWithin(relPath)))) {
    throw new ForgeError('RUN-053', { workflowId, path: relPath });
  }
  return readTextFile(deps.paths.resolveWithin(relPath));
}

export interface DryRunResult {
  readonly kind: 'dry-run';
  readonly plan: RunPlanResult;
}

/** `--dry-run`: `06` §6.2's own real compilation pipeline (`parseWorkflow` + `compileRunPlan`),
 * called directly rather than through `runEngine` — "plans and prints without spawning any session or
 * writing any file" (`03` §3.2's own `--dry-run` contract) means never reaching `runEngine`'s own
 * `driveToCompletion` at all, not merely a flag `runEngine` itself checks internally. */
export function dryRunWorkflow(
  workflowSource: string,
  expressionContext: ExpressionContext,
): DryRunResult {
  const parsed = parseWorkflow(workflowSource);
  if (!parsed.success) {
    throw new ForgeError('RUN-045', {
      issues: parsed.issues.map((issue) => issue.message).join('; '),
    });
  }
  const plan = compileRunPlan(parsed.workflow, expressionContext);
  return { kind: 'dry-run', plan };
}

export interface RealRunResult {
  readonly kind: 'run';
  readonly runId: string;
  readonly runState: RunState;
}

/** `forge pause`'s own real effect (`lock.ts`'s own doc comment: `SIGTERM` terminates this process
 * outright, no cooperative mid-batch pause exists to ask it to stop between batches gracefully instead)
 * — extracted to a named function so it is directly callable (with `process.exit` stubbed) rather than
 * only reachable by a real `SIGTERM` delivered to the test runner's own process, which no test here can
 * safely do. */
export function handleSigterm(): void {
  // `process.exit` skips `finally` blocks, so the launcher shim directory is removed here.
  removeLiveLauncherShims();
  process.exit(0);
}

/** Ctrl-C and a closed terminal end the run the same way (`128 + signal`, what the shell reports for a
 * signalled process): the shim directory is removed first, since `process.exit` runs no `finally` block. */
export function handleInterrupt(exitCode: number): void {
  removeLiveLauncherShims();
  process.exit(exitCode);
}

/** Installs the `SIGTERM`/`SIGINT`/`SIGHUP` handlers for the duration of one run and returns the function
 * that removes exactly those listeners again. Scoped, not permanent: a process that keeps living after the
 * run (a test worker, an embedder) gets its own signal behaviour back. Shared by `runWorkflow` and `forge
 * resume`, both of which own a shim directory while they run. */
export function installRunSignalHandlers(): () => void {
  const onInterrupt = (): void => {
    handleInterrupt(130);
  };
  const onHangup = (): void => {
    handleInterrupt(129);
  };
  process.on('SIGTERM', handleSigterm);
  process.on('SIGINT', onInterrupt);
  process.on('SIGHUP', onHangup);
  return () => {
    process.off('SIGTERM', handleSigterm);
    process.off('SIGINT', onInterrupt);
    process.off('SIGHUP', onHangup);
  };
}

/**
 * Real, in-process execution — no detached child process (a real `PlatformAdapter` cannot be
 * serialized across a process boundary, and no concrete adapter exists anywhere in this codebase to
 * reconstruct one from inside a spawned child regardless; the identical "adapter is always injected,
 * never spawned/discovered" stance `@forge/cli/init`'s own `RunInitDeps` already takes). The project
 * lock (`lock.ts`) is what makes a *separate* `forge status`/`forge pause`/`forge abort` invocation,
 * in a separate terminal, able to observe and control this one while it runs — `SIGTERM` (`forge
 * pause`) and `SIGKILL` (`forge abort`) both terminate this process outright (see `lock.ts`'s own
 * doc comment for why there is no cooperative mid-batch pause yet); either one leaves the event log
 * exactly where `@forge/engine`'s own crash-resume machinery (M5 P18-P20) already knows how to pick
 * up from via `forge resume`.
 */
export async function runWorkflow(
  deps: RunDeps,
  options: RunWorkflowOptions,
): Promise<DryRunResult | RealRunResult> {
  const workflowSource = await readWorkflowSource(deps, options.workflowId);

  if (options.dryRun === true) {
    return dryRunWorkflow(workflowSource, options.expressionContext);
  }

  // `20` §20.10 S8 -- "the user's uncommitted work is sacred": `@forge/vcs`'s own
  // `assertCleanWorkingTree` is real and correct, but had zero production call sites anywhere in this
  // codebase (confirmed by grep, `PLAN-M11.md` P11's own investigation) -- a lane worktree is created
  // fresh from `integrationBase` regardless of the *main* working tree's own state, so a real `forge
  // run` never actually halted for a dirty tree, it simply never looked. Checked here, before the run
  // lock/manifest/lane machinery starts (and before any lane worktree is created), so a dirty tree halts
  // the whole run rather than silently proceeding against a stale base while the user's own uncommitted
  // edits sit untouched and unmentioned. Never applies to `--dry-run` (already returned above): a
  // dry-run performs no real work and needs no clean tree to plan against.
  await assertCleanWorkingTree(deps.projectRoot);

  const clock = options.clock ?? SYSTEM_CLOCK;
  // No `Math.random()` (`QUALITY-BAR.md` R10: a seeded/injected source only) — derived instead from
  // the injected clock plus the workflow id, real enough for real uniqueness (millisecond wall-clock
  // resolution) and fully deterministic for a test that injects a fixed clock.
  const runId = options.runId ?? `run-${options.workflowId}-${clock.now().replace(/[^0-9]/g, '')}`;

  const lock: RunLock = { pid: process.pid, host: options.host, runId, startedAt: clock.now() };
  await acquireRunLock(deps.paths, lock);

  let removeSignalHandlers: (() => void) | undefined;
  let shim: LauncherShim | undefined;
  try {
    // `SPEC-QUESTIONS.md` Q221's own disclosed gap (d) / Q232 decision 18: "the integration branch is
    // fast-forwarded to `main` at run start[, and] the run refuses if they have diverged." Run here --
    // after the lock (so a refusal below leaves it released, via `finally`) but before the manifest,
    // `last-run.json`, or anything else this run creates -- so a refusal (a diverged branch, `RUN-107`;
    // a dirty integration worktree, a typed `VcsError`) leaves nothing behind for this run at all: no
    // `runs/<id>/`, no changed `last-run.json`, and (once `finally` below runs) no held lock either.
    // Only `runWorkflow` does this: `resumeWorkflow` continues the plan a run already started against
    // whatever the branch was synced to then, and `forge merge`/`forge review`/`debug`/`session`/`panel`
    // build a context of their own without ever calling this.
    const integrationBranch = integrationBranchFor(deps.config, options.expressionContext);
    const integrationPath = await ensureIntegrationWorktree(
      deps.paths,
      deps.projectRoot,
      integrationBranch,
      TRUNK,
    );
    const sync = await syncIntegrationBranchToTrunk(integrationPath, TRUNK);

    // Persisted so a later `forge resume` can re-compile the identical plan (`runEngine`'s own
    // `resumeFrom` path needs the same `workflowSource`/`expressionContext` this invocation used —
    // neither is recoverable from the event log alone, which records only that a run happened, not
    // what was fed into compiling its plan). `integrationTipAtStart`/`syncedFromTrunk` record the sync
    // just performed above, for audit — never read back by `resumeWorkflow`, which never re-syncs.
    const manifestPath = deps.paths.resolveState(`runs/${runId}/manifest.json`);
    await writeFileAtomic(
      manifestPath,
      JSON.stringify({
        workflowId: options.workflowId,
        expressionContext: options.expressionContext,
        integrationTipAtStart: sync.integrationTipAtStart,
        syncedFromTrunk: sync.syncedFromTrunk,
      }),
    );
    // `forge resume`'s own "the last (or given) run" (`03` §3.2.4) needs a real way to find "the
    // last" one — this is that pointer, updated every time a new run actually starts.
    await writeFileAtomic(deps.paths.resolveState('last-run.json'), JSON.stringify({ runId }));

    removeSignalHandlers = installRunSignalHandlers();

    // `runId` is real by this point (computed above), so every shell command this run spawns --
    // `command` steps, gate checks, merge checks -- carries the FORGE run marker
    // (`@forge/core/session-marker`, `PLAN-M14.md` P4) via `commandEnvFor`.
    shim = await createLauncherShimOrWarn(deps.launcher, deps.warn, runId);
    const ctx = await buildRunEngineContext({
      paths: deps.paths,
      projectRoot: deps.projectRoot,
      config: deps.config,
      runId,
      adapter: deps.adapter,
      checksRoot: deps.checksRoot,
      agentsRoot: deps.agentsRoot,
      clock,
      commandEnv: shim?.commandEnv,
      ask: deps.ask,
      expressionContext: options.expressionContext,
      lanesFromIntegration: true,
    });
    const runState = await runEngine(workflowSource, options.expressionContext, ctx);
    return { kind: 'run', runId, runState };
  } finally {
    removeSignalHandlers?.();
    await shim?.cleanup();
    await releaseRunLock(deps.paths);
  }
}

export type { StepNode };
