/**
 * `runEngine` — `PLAN-M5.md` P20's own "small harness gluing every earlier piece into one runnable
 * engine entry point": parses a workflow (`@forge/engine/workflow`, P8), compiles it into a `StepNode[]`
 * (`@forge/engine/plan`, P10/P11), then drives `@forge/engine/scheduler`'s own `Scheduler` (P12) and
 * `@forge/engine/dispatch`'s own `executeStep` (P15) to completion, emitting the Run-group's own events
 * (`18` §18.4) through `@forge/telemetry` (P6) — the one event group nothing else in this milestone's own
 * built pieces ever emits (`executeStep` already closes the identical gap for the Step group; P15/P18's
 * own doc comments already note this).
 *
 * Also `06` §6.10 step 4's own "re-enter the scheduler loop": the optional `resumeFrom` parameter lets a
 * caller continue driving a plan whose `RunState` already has some steps resolved (typically
 * `@forge/engine/resume`'s own `resumeRun`, P19, called first against the same `runId`) rather than
 * starting a fresh run from nothing — the crash-resume capstone's own real use of this piece.
 *
 * @see specs/06 §6.10
 * @see specs/10 §10.1
 * @see specs/18 §18.4
 * @see specs/21 §21.1, §21.3
 * @see PLAN-M5.md P20
 */
import { ForgeError } from '@forge/core/errors';
import { readEvents } from '@forge/telemetry/events';

import type { ExpressionContext } from '../expr/index.ts';
import { executeStep } from '../dispatch/execute.ts';
import type { ExecuteStepContext, StepOutcome } from '../dispatch/types.ts';
import { compileRunPlan, type StepNode } from '../plan/index.ts';
import { reconstructRunState } from '../resume/reconstruct.ts';
import type { RunState, StepReconstructedStatus } from '../resume/types.ts';
import { Scheduler } from '../scheduler/scheduler.ts';
import type { ConcurrencyLimits, StepStatus } from '../scheduler/types.ts';
import { parseWorkflow } from '../workflow/parse.ts';

/** `PLAN-M5.md`'s own literal `runEngine(workflow, context, ctx)` bullet undersells what a real call
 * needs, the same "the plan's own bullet undersells the signature" correction this whole package has
 * made once per piece for many pieces: `ExecuteStepContext` alone has everything `executeStep` itself
 * needs, but nothing to construct or drive a `Scheduler` with — `limits`/`seed` are `06` §6.3's own
 * required scheduler inputs, and `resourceClassOf`/`canAdmit` are the identical optional seams
 * `Scheduler`'s own constructor already takes (P12/P17), surfaced here rather than hidden behind a
 * hardcoded default a caller who *does* care about them (a real budget, a real resource-class policy)
 * would have no way to reach. */
export interface RunEngineContext extends ExecuteStepContext {
  readonly limits: ConcurrencyLimits;
  readonly seed: string;
  readonly resourceClassOf?: (node: StepNode) => string | undefined;
  readonly canAdmit?: (node: StepNode) => boolean;
}

function formatIssues(issues: readonly { readonly message: string }[]): string {
  return issues.map((issue) => issue.message).join('; ');
}

/** `06` §6.10 step 4's own resume: a reconstructed `RunState`'s own 7-value `StepReconstructedStatus`
 * (P18) is wider than `Scheduler`'s own 5-value `StepStatus` (`'pending'|'running'|'succeeded'|'failed'|
 * 'skipped'`, P12) — a gap `@forge/engine/resume`'s own P19 research explicitly flagged as "not yet
 * decided" when that piece was built, resolved here, the one place a `RunState` is ever actually handed
 * to a `Scheduler` to seed. `'aborted'`/`'escalated'` both fold to `'failed'`: neither is going to run
 * any further on its own (an aborted step is abandoned; an escalated one is waiting on a human/stronger-
 * model review this milestone builds no mechanism for yet), and `Scheduler`'s own `computeReadySet`
 * already treats anything other than `'succeeded'` identically for a dependent's own readiness check — so
 * `'failed'` is the one existing status that correctly keeps every downstream dependent permanently
 * un-ready without inventing a new one. `'scheduled'`/`'running'` (the latter provably never appears in a
 * `resumeRun`-returned `RunState`, its own doc comment) both map to `undefined` — `Scheduler`'s own
 * default, unmarked state, "still pending," which is exactly right for a step reset to `'scheduled'` so
 * the ordinary fresh-lane path picks it up again. */
export function toSchedulerStatus(status: StepReconstructedStatus): StepStatus | undefined {
  switch (status) {
    case 'succeeded':
      return 'succeeded';
    case 'failed':
    case 'aborted':
    case 'escalated':
      return 'failed';
    case 'skipped':
      return 'skipped';
    case 'scheduled':
    case 'running':
      return undefined;
  }
}

export function seedScheduler(
  scheduler: Scheduler,
  nodes: readonly StepNode[],
  resumeFrom: RunState,
): void {
  for (const node of nodes) {
    const reconstructed = resumeFrom.stepStatuses.get(node.id);
    if (reconstructed === undefined) continue;
    const mapped = toSchedulerStatus(reconstructed);
    if (mapped === 'succeeded') scheduler.markSucceeded(node.id);
    else if (mapped === 'failed') scheduler.markFailed(node.id);
    else if (mapped === 'skipped') scheduler.markSkipped(node.id);
  }
}

/** One full pass to completion: repeatedly asks the scheduler for the next admissible batch, runs the
 * whole batch concurrently (`Promise.all`, `06` §6.3's own concurrency limits are what bound how large a
 * batch can be, not this loop), and folds each real `StepOutcome` back in before asking again. Every
 * batch fully resolves before the next `next()` call — the simplest correct reading of "one scheduling
 * tick" that still exercises real concurrent execution (more than one node admitted together really does
 * run via one shared `Promise.all`), without needing to interleave a fresh `next()` call while an earlier
 * batch is still in flight. Terminates the moment `next()` returns nothing more to admit: since nothing
 * here ever leaves a node `'running'` between calls (every batch is awaited in full first), an empty
 * batch means nothing could *ever* become newly ready again — whether because every node reached a real
 * terminal status, or because a permanently-blocked dependent (a failed ancestor) can never satisfy
 * `computeReadySet`'s own "dependencies succeeded" rule — both are legitimate, final states for this loop
 * to stop at, not a deadlock to detect and reject. */
async function driveToCompletion(
  nodes: readonly StepNode[],
  scheduler: Scheduler,
  ctx: RunEngineContext,
): Promise<void> {
  for (;;) {
    const admitted = scheduler.next();
    if (admitted.length === 0) return;

    for (const node of admitted) {
      scheduler.markRunning(node.id);
      await ctx.telemetry.emit({ type: 'StepScheduled', stepId: node.id });
    }

    const outcomes = await Promise.all(admitted.map((node) => executeStep(node, ctx)));
    admitted.forEach((node, index) => {
      // noUncheckedIndexedAccess: `outcomes` is `Promise.all`'s own result over `admitted.map(...)`,
      // always exactly one entry per `admitted` element in the same order -- never actually undefined.
      // `as`, not `!` (banned in src/**): the more succinct style the linter suggests is exactly what
      // is not allowed here (the identical exception `lanes.ts`'s own `parseLaneWorktrees` already uses).
      // eslint-disable-next-line @typescript-eslint/non-nullable-type-assertion-style
      const outcome = outcomes[index] as StepOutcome;
      if (outcome.status === 'succeeded') scheduler.markSucceeded(node.id);
      else scheduler.markFailed(node.id);
    });
  }
}

function allSucceeded(nodes: readonly StepNode[], scheduler: Scheduler): boolean {
  return nodes.every((node) => scheduler.status(node.id) === 'succeeded');
}

/** Parses `workflowSource` (raw YAML, `@forge/engine/workflow` P8) and compiles it (`@forge/engine/plan`
 * P10/P11) against `context`, then drives the result to completion. Throws `ForgeError('RUN-045')` for a
 * parse or compile failure — a malformed fixture/workflow is a caller bug this milestone's own
 * "structural/config errors throw; expected runtime outcomes are data" split (established throughout
 * `@forge/engine/dispatch`) already treats the identical way, not a `StepOutcome`-shaped runtime result:
 * there is no step yet to attribute a failure to.
 *
 * `resumeFrom`, when supplied, skips emitting a fresh `RunPlanned`/`RunStarted` (already durable from
 * before the crash this run is resuming past) and seeds the scheduler from its own `stepStatuses`
 * instead (`seedScheduler`) — `06` §6.10 step 4's own "re-enter the scheduler loop", picking up exactly
 * where a prior `reconstructRunState` (P18) plus `resumeRun` (P19) left off. */
export async function runEngine(
  workflowSource: string,
  context: ExpressionContext,
  ctx: RunEngineContext,
  resumeFrom?: RunState,
): Promise<RunState> {
  const parsed = parseWorkflow(workflowSource);
  if (!parsed.success) throw new ForgeError('RUN-045', { issues: formatIssues(parsed.issues) });

  const compiled = compileRunPlan(parsed.workflow, context);
  if (!compiled.success) throw new ForgeError('RUN-045', { issues: formatIssues(compiled.issues) });

  const scheduler = new Scheduler(
    compiled.nodes,
    ctx.limits,
    ctx.seed,
    ctx.resourceClassOf,
    ctx.canAdmit,
  );

  if (resumeFrom === undefined) {
    await ctx.telemetry.emit({ type: 'RunPlanned', payload: { planRef: parsed.workflow.id } });
    await ctx.telemetry.emit({ type: 'RunStarted' });
  } else {
    seedScheduler(scheduler, compiled.nodes, resumeFrom);
  }

  await driveToCompletion(compiled.nodes, scheduler, ctx);

  await ctx.telemetry.emit({
    type: allSucceeded(compiled.nodes, scheduler) ? 'RunCompleted' : 'RunFailed',
  });

  return reconstructRunState(readEvents(ctx.projectRoot, ctx.runId));
}
