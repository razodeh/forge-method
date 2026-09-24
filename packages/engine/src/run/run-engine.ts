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
import { TelemetryError } from '@forge/telemetry/errors';
import { checkBudget } from '@forge/telemetry/ledger';

import type { ExpressionContext } from '../expr/index.ts';
import {
  computeLiveBudgetState,
  explainAdmission,
  onBudgetBreach,
  type BudgetConfig,
} from '../budget/index.ts';
import type { BudgetState } from '../budget/types.ts';
import { readRecordedAnswers } from '../dispatch/elicit.ts';
import { executeStep } from '../dispatch/execute.ts';
import { integrateLane, resolveLaneChecks } from '../dispatch/integrate.ts';
import type { ExecuteStepContext, StepFailureInfo, StepOutcome } from '../dispatch/types.ts';
import { compileRunPlan, stepsLandedByMerges, type StepNode } from '../plan/index.ts';
import { reconstructRunState } from '../resume/reconstruct.ts';
import type { RunState, StepReconstructedStatus } from '../resume/types.ts';
import { Scheduler } from '../scheduler/scheduler.ts';
import type { ConcurrencyLimits, StepStatus } from '../scheduler/types.ts';
import { parseWorkflow } from '../workflow/parse.ts';
import { resolveStepCostCeilings } from './cost-ceilings.ts';
import { diagnoseRun, type BudgetRefusal, type RunFailureRecord } from './failure.ts';

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
  /** `20` §20.10 S9 (`PLAN-M11.md` P11): when supplied, a real `BudgetState` — computed fresh from this
   * project's own real cost ledger before every scheduling tick, `../budget/live-state.ts`'s own
   * `computeLiveBudgetState` — is folded into scheduler admission via `@forge/engine/budget`'s own
   * `canAdmit`, composed with (never replacing) any `canAdmit` supplied above. Omitted entirely, this
   * run pays nothing for it and behaves exactly as before: the identical "a caller with no budget
   * concept pays nothing for it" shape `Scheduler`'s own constructor doc comment already establishes
   * one layer down — this field is where a real caller (`@forge/cli`'s own `buildRunEngineContext`,
   * from `.forge/config.yaml`'s own real `budget` block) now supplies one for the first time. */
  readonly budget?: BudgetConfig;
  // `conflictPolicy` moved to `ExecuteStepContext` (`PLAN-M14.md` P35, `dispatch/types.ts`'s own doc
  // comment on it) -- inherited from there, not redeclared here. `ctx.conflictPolicy` below is unchanged.
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
  answers?: ReadonlyMap<string, unknown>,
): void {
  for (const node of nodes) {
    const reconstructed = resumeFrom.stepStatuses.get(node.id);
    if (reconstructed === undefined) continue;
    const mapped = toSchedulerStatus(reconstructed);
    // A succeeded `elicit` step whose answers the log cannot give back (an unreadable or redacted record) is asked
    // again: its dependents read those answers, and a step that "succeeded" with none would leave them running
    // without (`PLAN-M13.md` P20). Only when the caller supplies the recorded answers.
    if (
      mapped === 'succeeded' &&
      node.kind === 'elicit' &&
      answers !== undefined &&
      !answers.has(node.id)
    ) {
      continue;
    }
    if (mapped === 'succeeded') scheduler.markSucceeded(node.id);
    // An `elicit` step fails only for want of a usable answer (`PLAN-M13.md` P20) and has no side effect to repeat:
    // its failure is "not asked yet", so a resume asks again (with `--answers`, or on a terminal). Every other
    // failed step stays failed.
    else if (mapped === 'failed' && node.kind === 'elicit') continue;
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
 * to stop at, not a deadlock to detect and reject. What this loop does *not* do is decide the outcome:
 * it returns with unfinished nodes whenever nothing more is admissible, and `runEngine` (below) diagnoses
 * every such node (`diagnoseRun`) into the `RunFailed` payload, so a node can never be dropped without a
 * recorded reason (`PLAN-M13.md` P12).
 *
 * `refreshBudget`, when supplied (`20` §20.10 S9), runs once at the top of every tick, before
 * `scheduler.next()` — a real `BudgetState` refresh is genuinely asynchronous I/O (a real ledger read),
 * unlike `Scheduler.next()`'s own synchronous decision, so it cannot itself be `canAdmit`'s own
 * per-node callback and must instead update the mutable state that callback closes over ahead of the
 * call that consults it. Once a real breach makes `canAdmit` refuse every remaining ready node, this
 * loop's own existing termination condition ("`next()` returns nothing more to admit") already stops
 * the run correctly with no further branching needed — `06`/`20`'s own three-way `onBreach` choice
 * (`pause`/`finish-lanes`/`abort`) has no distinguishable runtime effect in this loop's own synchronous,
 * fully-drained-batch-per-tick execution model: nothing is ever left "in flight" between one tick and
 * the next for `finish-lanes` to let drain that `abort` would not already have let finish, and `pause`
 * has no cooperative resume mechanism this milestone builds either (`run.ts`'s own doc comment, "no
 * cooperative mid-batch pause exists"). Recorded here, not silently assumed distinguishable. */
async function driveToCompletion(
  nodes: readonly StepNode[],
  scheduler: Scheduler,
  ctx: RunEngineContext,
  refreshBudget?: () => Promise<void>,
): Promise<void> {
  const landedByMerges = stepsLandedByMerges(nodes);
  for (;;) {
    if (refreshBudget !== undefined) await refreshBudget();
    await integrateSucceededLanes(nodes, scheduler, ctx, landedByMerges);
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

/**
 * `06` §6.4 rule 4, owner decision Q3 (`PLAN-M13.md` P19, `SPEC-QUESTIONS.md` Q221): a lane whose step
 * succeeded and which no `merge` step lands is integrated into the integration branch before the next tick
 * admits anything, so later lanes branch from a tip that holds it and gates and inline steps read it.
 *
 * Done between ticks, in plan order, never inside a step: a tick drains completely before the next starts, so
 * the lanes of one tick integrate one at a time in a fixed order (whichever session happened to finish first
 * does not decide who merges first, and so who conflicts), and a resumed run integrates the lanes its
 * predecessor finished but did not get to (`resumeRun` re-registers every `ready` lane) before it schedules
 * anything. A lane a `merge` step lands is left for that step (review before merge). A step whose lane cannot
 * be integrated is failed: it is `failed` in the scheduler, so its dependents never run, and a `StepFailed`
 * event follows its `StepSucceeded` (the last terminal event wins on resume).
 */
async function integrateSucceededLanes(
  nodes: readonly StepNode[],
  scheduler: Scheduler,
  ctx: RunEngineContext,
  landedByMerges: ReadonlySet<string>,
): Promise<void> {
  const conflictPolicy = ctx.conflictPolicy ?? 'abort';
  for (const node of nodes) {
    if (landedByMerges.has(node.id) || scheduler.status(node.id) !== 'succeeded') continue;
    const lane = ctx.laneRegistry.get(node.id);
    if (lane === undefined) continue;
    let failure: StepFailureInfo | undefined;
    try {
      failure = await integrateLane(ctx, node.id, lane, conflictPolicy);
    } catch (cause) {
      // The event log failing to write is the run's problem, not this lane's (`executeStep` treats it alike).
      if (cause instanceof TelemetryError) {
        throw new ForgeError(
          'RUN-038',
          { stepId: node.id, telemetryCode: cause.code, telemetryMessage: cause.message },
          { cause },
        );
      }
      throw cause;
    }
    if (failure === undefined) continue;
    scheduler.markFailed(node.id);
    await ctx.telemetry.emit({ type: 'StepFailed', stepId: node.id, payload: failure });
  }
}

/** The first merge check (of a `merge` step's policy or `execution.mergeChecks`) that cannot be resolved against the
 * run's `execution.testCommands`, with its message; `undefined` when every one can. */
function preflightMergeChecks(
  nodes: readonly StepNode[],
  ctx: RunEngineContext,
  resumeFrom: RunState | undefined,
): string | undefined {
  // A step a resumed run has already finished is not run again, so what it would have resolved no longer matters
  // (`execution.testCommands` may have been edited since).
  const pending = (node: StepNode): boolean =>
    resumeFrom?.stepStatuses.get(node.id) !== 'succeeded';
  // `execution.mergeChecks` matters only for a step with a lane that no `merge` step lands (`integrateLane`).
  const landedByMerges = stepsLandedByMerges(nodes);
  const hasLanes = nodes.some(
    (node) =>
      (node.kind === 'agent' || node.kind === 'command') &&
      node.laneAffinity !== 'inline' &&
      !landedByMerges.has(node.id) &&
      pending(node),
  );
  const declared = [
    ...(ctx.mergeChecks === undefined || !hasLanes
      ? []
      : [
          {
            pre: ctx.mergeChecks.pre,
            post: ctx.mergeChecks.post,
            preSource: 'execution.mergeChecks.pre',
            postSource: 'execution.mergeChecks.post',
          },
        ]),
    ...nodes.flatMap((node) =>
      node.kind === 'merge' && node.mergePolicy !== undefined && pending(node)
        ? [
            {
              pre: node.mergePolicy.preChecks,
              post: node.mergePolicy.postChecks,
              preSource: `the merge policy preChecks of ${node.id}`,
              postSource: `the merge policy postChecks of ${node.id}`,
            },
          ]
        : [],
    ),
  ];
  for (const entry of declared) {
    const resolved = resolveLaneChecks(ctx, entry);
    if (!resolved.ok) return resolved.failure.message;
  }
  return undefined;
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
  // The per-step cost ceiling is resolved here, once, before the scheduler or any dispatch sees a node
  // (`PLAN-M13.md` P12): admission control's reservation, block [6] of the compiled prompt and the cap
  // handed to the adapter all read this one number off the node.
  let nodes: readonly StepNode[];
  try {
    nodes = await resolveStepCostCeilings(compiled.nodes, ctx);
  } catch (cause) {
    // A failure other than "no such agent" (a transient I/O error reading an agent file) cannot be papered
    // over with a guessed ceiling, and must not leave a registered run with no events at all: the run starts
    // and fails on the record, with the reason, and can be started again.
    if (resumeFrom === undefined) {
      await ctx.telemetry.emit({ type: 'RunPlanned', payload: { planRef: parsed.workflow.id } });
      await ctx.telemetry.emit({ type: 'RunStarted' });
    }
    const message = cause instanceof Error ? cause.message : String(cause);
    const record: RunFailureRecord = {
      reason: 'setup',
      message: `the per-step cost ceilings could not be resolved: ${message}`,
      failedSteps: [],
      failedTotal: 0,
      unfinished: [],
      unfinishedTotal: 0,
    };
    await ctx.telemetry.emit({ type: 'RunFailed', payload: record });
    return reconstructRunState(readEvents(ctx.projectRoot, ctx.runId));
  }

  // The merge check sets are resolved once here too (`PLAN-M13.md` P38): a `merge` policy or `execution.mergeChecks`
  // that names a set the project's `execution.testCommands` cannot supply would otherwise be found only at the merge,
  // after every story lane has been built and paid for. The run fails on the record before anything is dispatched.
  const checkRefusal = preflightMergeChecks(nodes, ctx, resumeFrom);
  if (checkRefusal !== undefined) {
    if (resumeFrom === undefined) {
      await ctx.telemetry.emit({ type: 'RunPlanned', payload: { planRef: parsed.workflow.id } });
      await ctx.telemetry.emit({ type: 'RunStarted' });
    }
    const record: RunFailureRecord = {
      reason: 'setup',
      message: `the merge checks cannot run, so nothing was dispatched: ${checkRefusal}`,
      failedSteps: [],
      failedTotal: 0,
      unfinished: [],
      unfinishedTotal: 0,
    };
    await ctx.telemetry.emit({ type: 'RunFailed', payload: record });
    return reconstructRunState(readEvents(ctx.projectRoot, ctx.runId));
  }

  // `20` §20.10 S9 (`PLAN-M11.md` P11): `ctx.budget`, when supplied, gets a real, live `BudgetState`
  // refreshed from this project's own real ledger before every tick (`refreshBudget` below) — composed
  // with, never replacing, any caller-supplied `ctx.canAdmit`. Captured into locals rather than read
  // through `ctx.budget`/`ctx.canAdmit` again inside the closures below: the same "a closure re-reading
  // an optional member access re-widens past a narrowing check" reason `dispatch/steps.ts`'s own
  // `runCommandStep` already captures `mergePolicy` for.
  const budgetConfig = ctx.budget;
  const explicitCanAdmit = ctx.canAdmit;
  let liveBudgetState: BudgetState | undefined;
  let budgetBreachEmitted = false;

  // Admission control's own record of the last tick (`PLAN-M13.md` P12): `tickReservedUsd` is the sum of the
  // ceilings of the steps already admitted this tick, counted against the caps for the next candidate so
  // two steps that each fit alone cannot be admitted together past the cap (`20` §20.8: "a step is not
  // launched unless the remaining budget covers its cap"); `refusals` is what `diagnoseRun` reports if the
  // tick admits nothing. Both are reset by `refreshBudget` at the top of every tick.
  let tickReservedUsd = 0;
  const refusals = new Map<string, BudgetRefusal>();

  function budgetCanAdmit(node: StepNode): boolean {
    const state = liveBudgetState;
    if (state === undefined) return true;
    const decision = explainAdmission(node, {
      ...state,
      runSpentUsd: state.runSpentUsd + tickReservedUsd,
      dailySpentUsd: state.dailySpentUsd + tickReservedUsd,
    });
    if (decision.admit) {
      tickReservedUsd += node.limits.maxCostUsd;
      return true;
    }
    refusals.set(node.id, decision);
    return false;
  }

  const combinedCanAdmit: ((node: StepNode) => boolean) | undefined =
    budgetConfig === undefined
      ? explicitCanAdmit
      : explicitCanAdmit === undefined
        ? budgetCanAdmit
        : (node: StepNode) => explicitCanAdmit(node) && budgetCanAdmit(node);

  const scheduler = new Scheduler(
    nodes,
    ctx.limits,
    ctx.seed,
    ctx.resourceClassOf,
    combinedCanAdmit,
  );

  // `BudgetBreached` (`18` §18.4's own Cost event group) is emitted here once per run for a spend breach (a
  // refused admission at the end of the run adds one more, `trigger: 'admission'`), the first tick a real breach
  // is observed at either level — not on every tick a breach continues to hold, which would otherwise
  // write one event per scheduling tick for the remainder of an already-breached run. `onBudgetBreach`
  // is genuinely consulted here (not merely imported for its own type): its own returned `kind` is what
  // this event's `response` field reports, so a real caller inspecting the log can see which of
  // `06` §6.9's own three run-level responses actually applied, not just that a breach happened.
  const refreshBudget =
    budgetConfig === undefined
      ? undefined
      : async (): Promise<void> => {
          tickReservedUsd = 0;
          refusals.clear();
          liveBudgetState = await computeLiveBudgetState(
            ctx.projectRoot,
            ctx.runId,
            new Date(ctx.now()).toISOString(),
            budgetConfig,
          );
          if (budgetBreachEmitted) return;
          const state = liveBudgetState;
          const runBreached =
            checkBudget({ spent: state.runSpentUsd, cap: state.perRunUsd }) === 'breached';
          const periodBreached =
            checkBudget({ spent: state.dailySpentUsd, cap: state.dailyUsd }) === 'breached';
          if (!runBreached && !periodBreached) return;
          budgetBreachEmitted = true;
          const level = runBreached ? 'run' : 'period';
          await ctx.telemetry.emit({
            type: 'BudgetBreached',
            payload: {
              level,
              capUsd: runBreached ? state.perRunUsd : state.dailyUsd,
              spentUsd: runBreached ? state.runSpentUsd : state.dailySpentUsd,
              response: onBudgetBreach(level, state).kind,
            },
          });
        };

  // `runMergeStep` finds the lanes a merge lands in the compiled plan (`ExecuteStepContext.stepGraph`); the copy
  // shares every field, including the lane registry, with the caller's context.
  //
  // `answers` is the run's record of what the human said to its `elicit` steps (`PLAN-M13.md` P20). A resumed run
  // starts from the event log's `ElicitationAnswered` events, so an answered step is neither asked again nor
  // forgotten by the steps that read its answers; the caller's own map (a test's, or one it inspects afterwards)
  // is kept and filled, never replaced.
  const answers = ctx.answers ?? new Map<string, Readonly<Record<string, string>>>();
  if (resumeFrom !== undefined) {
    for (const [stepId, recorded] of await readRecordedAnswers(ctx.projectRoot, ctx.runId)) {
      if (!answers.has(stepId)) answers.set(stepId, recorded);
    }
  }
  if (resumeFrom === undefined) {
    await ctx.telemetry.emit({ type: 'RunPlanned', payload: { planRef: parsed.workflow.id } });
    await ctx.telemetry.emit({ type: 'RunStarted' });
  } else {
    seedScheduler(scheduler, nodes, resumeFrom, answers);
  }

  const runCtx: RunEngineContext = {
    ...ctx,
    stepGraph: new Map(nodes.map((node) => [node.id, node] as const)),
    answers,
  };
  await driveToCompletion(nodes, scheduler, runCtx, refreshBudget);

  if (allSucceeded(nodes, scheduler)) {
    await ctx.telemetry.emit({ type: 'RunCompleted' });
    return reconstructRunState(readEvents(ctx.projectRoot, ctx.runId));
  }

  // A run that did not complete always says why (`PLAN-M13.md` P12, `Q208` finding 1). When admission
  // control refused a ready step, that goes through the same machinery as any other budget breach: a
  // `BudgetBreached` naming the cap, the step, its reservation and what was spent, with `onBudgetBreach`'s
  // own response for that level. `RunFailed` then carries the diagnosis of every unfinished step.
  const failure = diagnoseRun({
    nodes,
    status: (id) => scheduler.status(id),
    budgetRefusals: refusals,
    limits: ctx.limits,
  });
  const liveState = liveBudgetState;
  // The same step the diagnosis names first, so the event and the `RunFailed` reason never disagree.
  const headline = failure.unfinished.find((entry) => entry.cause.kind === 'budget');
  const refusal = headline === undefined ? undefined : refusals.get(headline.stepId);
  if (liveState !== undefined && refusal !== undefined) {
    await ctx.telemetry.emit({
      type: 'BudgetBreached',
      stepId: refusal.stepId,
      payload: {
        trigger: 'admission',
        level: refusal.level,
        capUsd: refusal.capUsd,
        spentUsd: refusal.spentUsd,
        reservationUsd: refusal.reservationUsd,
        stepId: refusal.stepId,
        refusedSteps: refusals.size,
        // The configured response (`onBudgetBreach`). What the engine did is `applied`: no cooperative
        // pause exists (`driveToCompletion`), so every response ends the run `failed`; raising the budget
        // and `forge resume` continues it. `Q210` records the spec gap (`06` §6.3 `waiting-budget`).
        response: onBudgetBreach(refusal.level, liveState).kind,
        applied: 'run-stopped',
      },
    });
  }
  await ctx.telemetry.emit({ type: 'RunFailed', payload: failure });

  return reconstructRunState(readEvents(ctx.projectRoot, ctx.runId));
}
