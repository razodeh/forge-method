/**
 * `forge resume [runId]` — `03` §3.2.4: "Resume the last (or given) run." `06` §6.10 step 4's own
 * real machinery: `resumeRun` (`@forge/engine/resume`, P19) patches up whatever was in flight, then
 * `runEngine` (P20) continues the identical scheduler loop to completion — the exact composition
 * `PLAN-M5.md` P20's own crash-resume capstone test already proves against a real `SIGKILL`.
 *
 * @see specs/03 §3.2.4
 * @see specs/06 §6.10
 */
import { ForgeError, SYSTEM_CLOCK, type Clock } from '@forge/core';
import { pathExists, readTextFile, type ProjectPaths } from '@forge/core/fs';
import type { ExpressionContext } from '@forge/engine/expr';
import { compileRunPlan } from '@forge/engine/plan';
import { resumeRun } from '@forge/engine/resume';
import type { RunState } from '@forge/engine/resume';
import { resolveStepCostCeilings, runEngine } from '@forge/engine/run';
import { parseWorkflow } from '@forge/engine/workflow';

import { buildRunEngineContext } from './context.ts';
import { createLauncherShimOrWarn, type LauncherShim } from './launcher-shim.ts';
import {
  acquireRunLock,
  isProcessAlive,
  readRunLock,
  releaseRunLock,
  type RunLock,
} from './lock.ts';
import { installRunSignalHandlers, type RunDeps } from './run.ts';

export interface RunManifest {
  readonly workflowId: string;
  readonly expressionContext: ExpressionContext;
}

async function readLastRunId(paths: ProjectPaths): Promise<string> {
  const pointer = paths.resolveState('last-run.json');
  if (!(await pathExists(pointer))) {
    throw new ForgeError('RUN-048', undefined);
  }
  const { runId } = JSON.parse(await readTextFile(pointer)) as { readonly runId: string };
  return runId;
}

/** Exported (`PLAN-M14.md` P40) so `@forge/cli`'s own `commands/run/merge.ts` can recompile a run's plan
 * the identical way `resumeWorkflow` below does, from the identical durable source (`workflowId` +
 * `expressionContext`) -- rather than a second, drifting copy of this same read. `merge.ts` checks the
 * manifest exists itself before ever calling this (its own "no manifest at all" case tolerates that and
 * falls back; this function's own missing-file throw below is for `resumeWorkflow`, which has nothing to
 * resume without one). A manifest that exists but cannot be read or parsed is `RUN-054` with the parse/read
 * failure as `cause` -- the identical "missing is a guess, corrupt is not" distinction
 * `context.ts`'s own `integrationBranchOfRun` already draws for the identical file. */
export async function readManifest(paths: ProjectPaths, runId: string): Promise<RunManifest> {
  const manifestPath = paths.resolveState(`runs/${runId}/manifest.json`);
  if (!(await pathExists(manifestPath))) {
    throw new ForgeError('RUN-054', { runId });
  }
  try {
    return JSON.parse(await readTextFile(manifestPath)) as RunManifest;
  } catch (cause) {
    throw new ForgeError('RUN-054', { runId }, { cause });
  }
}

export interface ResumeOptions {
  readonly runId?: string;
  readonly host: string;
  readonly clock?: Clock;
}

export async function resumeWorkflow(
  deps: RunDeps,
  options: ResumeOptions,
): Promise<{ readonly runId: string; readonly runState: RunState }> {
  const runId = options.runId ?? (await readLastRunId(deps.paths));

  const existingLock = await readRunLock(deps.paths);
  if (existingLock !== undefined && isProcessAlive(existingLock.pid)) {
    throw new ForgeError('CFG-002', { pid: existingLock.pid, host: existingLock.host });
  }

  const manifest = await readManifest(deps.paths, runId);
  const workflowSource = await readTextFile(
    deps.paths.resolveWithin(`${deps.workflowsRoot}/${manifest.workflowId}.workflow.yaml`),
  );

  const clock = options.clock ?? SYSTEM_CLOCK;
  const lock: RunLock = { pid: process.pid, host: options.host, runId, startedAt: clock.now() };
  await acquireRunLock(deps.paths, lock);
  const removeSignalHandlers = installRunSignalHandlers();

  let shim: LauncherShim | undefined;
  try {
    // `runId` is real by this point (the resumed run's own id), so every shell command a resumed run
    // spawns -- `command` steps, gate checks, merge checks -- carries the FORGE run marker
    // (`@forge/core/session-marker`, `PLAN-M14.md` P4) via `commandEnvFor`, the same as a fresh run
    // (`run.ts`'s own identical call). Gate/merge checks read `ctx.commandEnv` directly (`context.ts`'s
    // own `createGateEvaluator`/`createMergeQueueFacade` calls) with no per-step stamping fallback of
    // their own, so a resumed run must supply this here, not rely on it having been true before the
    // crash/pause that made resuming necessary in the first place.
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
      // The integration branch the run started on (`forge run --stage`): its lanes and merges are there.
      expressionContext: manifest.expressionContext,
      lanesFromIntegration: true,
    });
    // `resumeRun`'s own `ResumeContext` needs the compiled plan's real `StepNode`s (keyed by id) to
    // turn a bare, resumed `stepId` back into something re-dispatchable — re-compiled fresh from the
    // identical workflow source and expression context this run started with, never duplicated into
    // the append-only event log itself (`ResumeContext`'s own doc comment).
    const parsed = parseWorkflow(workflowSource);
    if (!parsed.success) {
      throw new ForgeError('RUN-045', {
        issues: parsed.issues.map((issue) => issue.message).join('; '),
      });
    }
    const compiled = compileRunPlan(parsed.workflow, manifest.expressionContext);
    if (!compiled.success) {
      throw new ForgeError('RUN-045', {
        issues: compiled.issues.map((issue) => issue.message).join('; '),
      });
    }
    // The same resolved per-step cost ceilings `runEngine` schedules with (`PLAN-M13.md` P12): a resumed
    // session is handed the cap of the plan it is resuming, not the compile-time placeholder.
    const resolvedNodes = await resolveStepCostCeilings(compiled.nodes, ctx);
    const steps = new Map(resolvedNodes.map((node) => [node.id, node]));

    const afterResume = await resumeRun(runId, { ...ctx, steps });
    const runState = await runEngine(workflowSource, manifest.expressionContext, ctx, afterResume);
    return { runId, runState };
  } finally {
    removeSignalHandlers();
    await shim?.cleanup();
    await releaseRunLock(deps.paths);
  }
}
