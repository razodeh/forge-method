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
import type { ExpressionContext } from '@forge/engine/expr';
import { compileRunPlan, type RunPlanResult, type StepNode } from '@forge/engine/plan';
import { runEngine } from '@forge/engine/run';
import type { RunState } from '@forge/engine/resume';
import { parseWorkflow } from '@forge/engine/workflow';
import type { ForgeConfig } from '@forge/schemas/config';

import { buildRunEngineContext } from './context.ts';
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
}

async function readWorkflowSource(deps: RunDeps, workflowId: string): Promise<string> {
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

let signalHandlersInstalled = false;

/** `forge pause`'s own real effect (`lock.ts`'s own doc comment: `SIGTERM` terminates this process
 * outright, no cooperative mid-batch pause exists to ask it to stop between batches gracefully instead)
 * — extracted to a named function so it is directly callable (with `process.exit` stubbed) rather than
 * only reachable by a real `SIGTERM` delivered to the test runner's own process, which no test here can
 * safely do. */
export function handleSigterm(): void {
  process.exit(0);
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

  const clock = options.clock ?? SYSTEM_CLOCK;
  // No `Math.random()` (`QUALITY-BAR.md` R10: a seeded/injected source only) — derived instead from
  // the injected clock plus the workflow id, real enough for real uniqueness (millisecond wall-clock
  // resolution) and fully deterministic for a test that injects a fixed clock.
  const runId = options.runId ?? `run-${options.workflowId}-${clock.now().replace(/[^0-9]/g, '')}`;

  const lock: RunLock = { pid: process.pid, host: options.host, runId, startedAt: clock.now() };
  await acquireRunLock(deps.paths, lock);

  // Persisted so a later `forge resume` can re-compile the identical plan (`runEngine`'s own
  // `resumeFrom` path needs the same `workflowSource`/`expressionContext` this invocation used —
  // neither is recoverable from the event log alone, which records only that a run happened, not
  // what was fed into compiling its plan).
  const manifestPath = deps.paths.resolveState(`runs/${runId}/manifest.json`);
  await writeFileAtomic(
    manifestPath,
    JSON.stringify({
      workflowId: options.workflowId,
      expressionContext: options.expressionContext,
    }),
  );
  // `forge resume`'s own "the last (or given) run" (`03` §3.2.4) needs a real way to find "the
  // last" one — this is that pointer, updated every time a new run actually starts.
  await writeFileAtomic(deps.paths.resolveState('last-run.json'), JSON.stringify({ runId }));

  if (!signalHandlersInstalled) {
    signalHandlersInstalled = true;
    process.once('SIGTERM', handleSigterm);
  }

  try {
    const ctx = await buildRunEngineContext({
      paths: deps.paths,
      projectRoot: deps.projectRoot,
      config: deps.config,
      runId,
      adapter: deps.adapter,
      checksRoot: deps.checksRoot,
      clock,
    });
    const runState = await runEngine(workflowSource, options.expressionContext, ctx);
    return { kind: 'run', runId, runState };
  } finally {
    await releaseRunLock(deps.paths);
  }
}

export type { StepNode };
