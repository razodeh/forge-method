/**
 * `executeStep` — the one function `@forge/engine/scheduler`'s own `Scheduler` (P12) calls for every
 * admitted node, dispatching on `StepNode.kind` to the matching real handler (`steps.ts`).
 *
 * @see specs/10 §10.1
 * @see PLAN-M5.md P15
 */
import { ForgeError } from '@forge/core/errors';
import { TelemetryError } from '@forge/telemetry/errors';

import type { StepNode } from '../plan/index.ts';
import { runSessionStep } from '../interaction/session.ts';
import { isAssemblyRefusal, refusalFailure } from './assemble.ts';
import {
  runAgentStep,
  runCheckpointStep,
  runCommandStep,
  runGateStep,
  runMergeStep,
} from './steps.ts';
import type { ExecuteStepContext, StepOutcome } from './types.ts';

/** A `TelemetryError` escaping any handler (the event log itself failing to write — a full disk, a
 * permissions problem) is deliberately *not* folded into a `StepOutcome{status:'failed'}` the way a
 * `VcsError` is (`steps.ts`'s own `runVcsStep`): the event log being unwritable is an infrastructure
 * failure affecting every future step in this run, not this one step's own work having gone wrong — P16's
 * own retry machinery exists to retry a step whose *work* failed, and retrying cannot fix a full disk.
 * Wrapped into the registered `RUN-038` here, once, at the one place every handler's own call ultimately
 * passes through, rather than at each of the dozens of individual `ctx.telemetry.emit` call sites inside
 * `steps.ts` — still thrown, not returned as data, matching this reasoning.
 *
 * The trailing `StepSucceeded`/`StepFailed` emit below is this function's own, not any one handler's:
 * `18` §18.4's own event catalogue registers both, and nothing else in this milestone's own built pieces
 * ever emits either (`@forge/engine/scheduler`, P12, tracks `StepOutcome` only in memory, via
 * `markSucceeded`/`markFailed` — it never touches the event log itself). Without this, the durable log a
 * real crash-resume reads back (`06` §6.10) has no terminal event distinguishing a successful step from a
 * failed one — `LaneReady`, the last event a lane-based handler itself emits, fires even when
 * `work.failure` is set, by design (`steps.ts`'s own `runLaneLifecycle`: the lane itself really is "ready,"
 * i.e. claim-enforced and inspectable, regardless of whether the *work* inside it succeeded), but not when
 * the output contract check (`PLAN-M13.md` P7) fails an otherwise-ok session: resume re-registers every
 * `ready` lane for merging, and a lane missing its declared output must not be.
 * `executeStep` is the one place every real `StepOutcome`, from every kind, already passes through once
 * dispatch finishes — the natural, single point to close this gap rather than duplicating it per handler. */
export async function executeStep(node: StepNode, ctx: ExecuteStepContext): Promise<StepOutcome> {
  try {
    const outcome = await dispatch(node, ctx);
    await ctx.telemetry.emit({
      type: outcome.status === 'succeeded' ? 'StepSucceeded' : 'StepFailed',
      stepId: node.id,
      payload: outcome.status === 'failed' ? outcome.failure : undefined,
    });
    return outcome;
  } catch (cause) {
    if (cause instanceof TelemetryError) {
      throw new ForgeError(
        'RUN-038',
        { stepId: node.id, telemetryCode: cause.code, telemetryMessage: cause.message },
        { cause },
      );
    }
    throw cause;
  }
}

const EMPTY_SESSION = {
  sessionId: '',
  ok: false,
  finalText: '',
  usage: { inputTokens: 0, outputTokens: 0, turns: 0 },
  durationMs: 0,
  changedFiles: [],
  controlTokens: [],
} as const;

async function dispatch(node: StepNode, ctx: ExecuteStepContext): Promise<StepOutcome> {
  switch (node.kind) {
    case 'agent':
      return runAgentStep(node, ctx);
    case 'command':
      return runCommandStep(node, ctx);
    case 'gate':
      return runGateStep(node, ctx);
    case 'merge':
      return runMergeStep(node, ctx);
    case 'checkpoint':
      return runCheckpointStep(node, ctx);
    // `PLAN-M10.md` P10: `session` now has a real handler (`@forge/engine/interaction`'s own
    // `runSessionStep`), driving `@forge/sessions`'s pure phase machine through real agent turns
    // (`dispatchAgentStep`). Only this one node's own `.outcome` half matters to `executeStep`'s own
    // return type here -- a caller who wants the assembled `SessionRecord` too calls `runSessionStep`
    // directly, the same "wrap, do not touch the closed `StepOutcomeDetail` union" choice
    // `InteractionOutcome` (`interaction/types.ts`) already makes for the identical reason.
    case 'session':
      try {
        return (await runSessionStep(node, ctx)).outcome;
      } catch (cause) {
        // A participant session refused by prompt assembly (`PLAN-M13.md` P5: an unmapped model tier, a
        // missing role prompt, an adapter that cannot carry a system prompt) throws out of the session
        // machinery having dispatched nothing. Folded into a typed failed outcome here so it fails this
        // one step like an agent step's refusal does, instead of rejecting the whole scheduler batch
        // and orphaning its sibling steps.
        if (!isAssemblyRefusal(cause)) throw cause;
        const at = ctx.now();
        return {
          stepId: node.id,
          status: 'failed',
          startedAt: at,
          finishedAt: at,
          detail: { kind: 'agent', session: EMPTY_SESSION },
          failure: refusalFailure(cause),
        };
      }
    // `elicit`/`subworkflow` each still need infrastructure this milestone does not build (a real
    // interactive human-input channel; recursive workflow invocation) -- unchanged, still refused with
    // the identical `RUN-039` this piece's own scope is exactly `session`, not these two.
    case 'elicit':
    case 'subworkflow':
      throw new ForgeError('RUN-039', { stepId: node.id, kind: node.kind });
    case 'fanout':
      // Structurally excluded from ever surviving `@forge/engine/plan`'s own `compilePlan` (P10) — a
      // fanout step always expands into per-item children carrying their own, different kind, confirmed
      // directly in `compile.ts`. Reachable here only if a caller hand-builds a `StepNode[]` bypassing that
      // pipeline entirely, the same "kept as a real runtime check, documented, over provably unreachable
      // through this module's own real callers" choice made throughout this codebase for identically-
      // shaped guards (`RUN-036`'s own reasoning, `@forge/engine/scheduler`, P12).
      throw new ForgeError('RUN-039', { stepId: node.id, kind: node.kind });
  }
}
