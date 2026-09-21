/**
 * Landing one lane in the integration branch (`06` §6.5), and the engine's own integration of a lane no
 * `merge` step lands (`PLAN-M13.md` P19, `06` §6.4 rule 4, owner decision Q3, `SPEC-QUESTIONS.md` Q221).
 *
 * `landLane` is the body `runMergeStep` always had for one predecessor lane, moved here so the engine's
 * automatic integration and an explicit `merge` step are the same code: the same queue (serialised per
 * integration path), the same `MergeQueued` / `MergeStarted` / `MergeCompleted` / `MergeConflict` /
 * `MergeReverted` events, the same conflict policy dispatch, the same lane removal. Nothing here is a second
 * merge implementation.
 *
 * @see specs/06 §6.4, §6.5
 */
import { resolveMergeChecks } from './merge-checks.ts';
import type {
  ExecuteStepContext,
  LaneHandle,
  MergeCandidateChecks,
  MergeOutcome,
  StepFailureInfo,
} from './types.ts';
import { runVcsStep } from './vcs-step.ts';

/** `MergePolicy.conflict` and the config's `execution.conflictPolicy` (`18` §18.3) share this vocabulary. */
export type ConflictPolicy = 'agent' | 'human' | 'abort';

/** A pre/post check pair, resolved from the names a merge policy (or `execution.mergeChecks`) declares into the
 * commands that will run, and what a named set skipped for want of a configured layer. */
export interface ResolvedLaneChecks {
  readonly checks: MergeCandidateChecks;
  readonly skipped: { readonly pre: readonly string[]; readonly post: readonly string[] };
}

/**
 * Resolves `pre`/`post` (a merge policy's `preChecks`/`postChecks`, or `execution.mergeChecks`) against the run's
 * `execution.testCommands` (`merge-checks.ts`, `PLAN-M13.md` P38). A set nothing of which is configured, or a
 * command that cannot be trusted as one, is a failure as data before any lane is touched: the caller fails the step
 * with it and no merge event is recorded.
 */
export function resolveLaneChecks(
  ctx: ExecuteStepContext,
  declared: {
    readonly pre: string | undefined;
    readonly post: string | undefined;
    readonly preSource: string;
    readonly postSource: string;
  },
):
  | { readonly ok: true; readonly value: ResolvedLaneChecks }
  | { readonly ok: false; readonly failure: StepFailureInfo } {
  const testCommands = ctx.testCommands ?? {};
  const pre = resolveMergeChecks(declared.pre, testCommands, declared.preSource);
  if (!pre.ok) return pre;
  const post = resolveMergeChecks(declared.post, testCommands, declared.postSource);
  if (!post.ok) return post;
  return {
    ok: true,
    value: {
      checks: { preCommands: pre.commands, postCommands: post.commands },
      skipped: { pre: pre.skipped, post: post.skipped },
    },
  };
}

export interface LandLaneOptions {
  /** The step the `Merge*` events are recorded against: the `merge` step for an explicit merge, the lane's
   * own step for the engine's automatic integration. */
  readonly eventStepId: string;
  /** The lane's own step id: the queue candidate's `stepId` (it lands in the merge commit's trailer) and the
   * key the lane is registered under in `ctx.laneRegistry`. */
  readonly laneStepId: string;
  readonly lane: LaneHandle;
  readonly conflictPolicy: ConflictPolicy;
  readonly checks: MergeCandidateChecks;
  /** Layers of a named check set that had no configured command: recorded on `MergeStarted`, so a merge that ran
   * fewer checks than its set names says so. */
  readonly skippedLayers?: ResolvedLaneChecks['skipped'] | undefined;
}

export interface LandLaneResult {
  /** What the queue reported; absent when it threw (the throw is `failure`). */
  readonly outcome?: MergeOutcome;
  /** Why the lane did not land, absent when it did. */
  readonly failure?: StepFailureInfo;
  /** Present (and `true`) when the lane had nothing to land (its work is already in the integration branch, or it
   * changed nothing) and was only removed. Its content IS in the integration branch, so a lane built on it may
   * land: `outcome` is absent then, and `contentLanded` alone would read that as "did not land". */
  readonly alreadyIntegrated?: true;
}

/** Whether a queue outcome means the lane's content is now in the integration branch. A failed post-merge check
 * reverts the merge, so that content is not. */
export function contentLanded(outcome: MergeOutcome | undefined): boolean {
  return outcome?.kind === 'clean' || outcome?.kind === 'conflict-resolved';
}

/** Puts `options.lane` through the merge queue and, when it lands, removes the lane. A failure is returned as
 * data, never thrown (this file's header contract for every handler): a conflict, a failed check, an
 * unconfigured resolver, a git failure. A lane that did not land is kept for inspection, exactly as
 * an explicit merge step always kept it. */
export async function landLane(
  ctx: ExecuteStepContext,
  options: LandLaneOptions,
): Promise<LandLaneResult> {
  const { eventStepId, laneStepId, lane, conflictPolicy, checks, skippedLayers } = options;
  // Nothing to land: the lane's step changed no file, or a crash left it merged but not removed. Merging it
  // again would report a "merge" whose commit is some other lane's (git says "already up to date" and makes no
  // commit), and a failed post-merge check would then revert THAT lane's merge. Applies to a `merge` step's
  // lanes as much as to the engine's own.
  const queue = ctx.mergeQueue;
  if (queue.isIntegrated !== undefined) {
    const isIntegrated = queue.isIntegrated.bind(queue);
    const integrated = await runVcsStep(eventStepId, () => isIntegrated(lane));
    if (!integrated.ok) return { failure: integrated.failure };
    if (integrated.value) {
      await removeIntegratedLane(ctx, eventStepId, laneStepId, lane);
      return { alreadyIntegrated: true };
    }
  }
  await ctx.telemetry.emit({ type: 'MergeQueued', stepId: eventStepId, laneId: lane.laneId });
  // `18` §18.4's own Merge event row names five types; only four have an explicit firing point in
  // `06` §6.5's own numbered steps (`MergeCompleted`/`MergeReverted` at step 6, `MergeQueued` and
  // `MergeConflict` inferred from steps 1-2). `MergeStarted` is spec-silent on exactly when — read
  // here as "the queue has now actually begun working the candidate," distinct from "was handed to
  // the queue," per `CLAUDE.md`'s rule for spec silence (`SPEC-QUESTIONS.md` Q77). A `pre-check-failed`
  // outcome (`06` §6.5 step 3) gets no further dedicated event of its own beyond this: the vocabulary
  // has no sixth name for it, and the real signal is the step's own `StepOutcome{status:'failed'}`,
  // the same place every other handler in this module surfaces a failure that is not one of its own
  // already-registered event types.
  // What the checks are (labels, never the commands: they may hold secrets) and what a named set could not run.
  const checkPayload = describeChecks(checks, skippedLayers);
  await ctx.telemetry.emit({
    type: 'MergeStarted',
    stepId: eventStepId,
    laneId: lane.laneId,
    ...(checkPayload === undefined ? {} : { payload: checkPayload }),
  });
  // `ctx.mergeQueue.process` can throw a real VcsError -- e.g. `@forge/vcs`'s own
  // `processMergeCandidate` refuses a non-`'abort'` conflictPolicy with no `conflictResolver`
  // configured, which is every real `'agent'`/`'human'` policy for now, since M5's own scope builds
  // no resolver at all (`Q77`). Wrapped through `runVcsStep` like every other `ctx.vcs`/`ctx.mergeQueue`
  // call in this module, so that gap surfaces as ordinary failed-outcome data, not an uncaught
  // exception escaping this step (this file's own header contract).
  const mergeResult = await runVcsStep(eventStepId, () =>
    ctx.mergeQueue.process(
      {
        handle: lane,
        stepId: laneStepId,
        runId: ctx.runId,
        declaredClaim: [],
        conflictPolicy,
      },
      checks,
    ),
  );
  if (!mergeResult.ok) return { failure: mergeResult.failure };
  const merge = mergeResult.value;

  if (merge.kind === 'clean' || merge.kind === 'conflict-resolved') {
    await ctx.telemetry.emit({
      type: 'MergeCompleted',
      stepId: eventStepId,
      laneId: lane.laneId,
      payload: { mergeCommitSha: merge.mergeCommitSha },
    });
    await removeIntegratedLane(ctx, eventStepId, laneStepId, lane);
    return { outcome: merge };
  }
  if (merge.kind === 'already-integrated') {
    // The rebase dropped every commit of the lane (all already upstream): nothing to merge, and no merge commit
    // exists that could be mistaken for this lane's. Removed like a lane found integrated up front.
    await removeIntegratedLane(ctx, eventStepId, laneStepId, lane);
    return { outcome: merge, alreadyIntegrated: true };
  }
  if (merge.kind === 'post-check-failed-reverted') {
    await ctx.telemetry.emit({
      type: 'MergeReverted',
      stepId: eventStepId,
      laneId: lane.laneId,
      payload: { revertCommitSha: merge.revertCommitSha },
    });
    return {
      outcome: merge,
      failure: {
        source: 'merge',
        // A structured code, not just a message: P16's own classifyFailure (PLAN-M5.md P16) needs to
        // tell this apart from the other two merge failure modes below without sniffing message text,
        // this codebase's own established preference (GateNotFoundError's own doc comment names the
        // same reasoning for a different case).
        code: 'MERGE-POST-CHECK-FAILED',
        message: `Post-merge check failed for lane ${lane.laneId}: ${merge.checkResult.summary || '(no output)'}`,
      },
    };
  }
  if (merge.kind === 'conflict-unresolved') {
    await ctx.telemetry.emit({
      type: 'MergeConflict',
      stepId: eventStepId,
      laneId: lane.laneId,
      payload: { reason: merge.reason },
    });
    return {
      outcome: merge,
      failure: {
        source: 'merge',
        code: 'MERGE-CONFLICT-UNRESOLVED',
        message: `Unresolved merge conflict for lane ${lane.laneId} (${merge.reason}).`,
      },
    };
  }
  return {
    outcome: merge,
    failure: {
      source: 'merge',
      code: 'MERGE-PRE-CHECK-FAILED',
      message: `Pre-merge check failed for lane ${lane.laneId}: ${merge.checkResult.summary || '(no output)'}`,
    },
  };
}

function describeChecks(
  checks: MergeCandidateChecks,
  skipped: ResolvedLaneChecks['skipped'] | undefined,
): Record<string, unknown> | undefined {
  const label = (commands: MergeCandidateChecks['preCommands']): readonly string[] =>
    (commands ?? []).map((entry) => entry.label ?? 'literal command');
  const pre = label(checks.preCommands);
  const post = label(checks.postCommands);
  const skippedPre = skipped?.pre ?? [];
  const skippedPost = skipped?.post ?? [];
  if (pre.length + post.length + skippedPre.length + skippedPost.length === 0) return undefined;
  return {
    preChecks: pre,
    postChecks: post,
    ...(skippedPre.length + skippedPost.length === 0
      ? {}
      : { skippedLayers: { pre: skippedPre, post: skippedPost } }),
  };
}

/** Removes a lane whose content is in the integration branch and forgets it. A removal that fails does NOT fail
 * the step: the work is integrated, and failing the step would kill a run (and, on resume, keep a failed step
 * that is not retried) over a leftover worktree. The lane is forgotten (it must not be landed again), kept on
 * disk for the next run's orphan reclamation, and a `LaneAbandoned` event records why. */
async function removeIntegratedLane(
  ctx: ExecuteStepContext,
  eventStepId: string,
  laneStepId: string,
  lane: LaneHandle,
): Promise<undefined> {
  const removal = await runVcsStep(eventStepId, () =>
    ctx.vcs.removeLane(lane, ctx.retainLaneWorktrees),
  );
  ctx.laneRegistry.delete(laneStepId);
  if (!removal.ok) {
    await ctx.telemetry.emit({
      type: 'LaneAbandoned',
      stepId: eventStepId,
      laneId: lane.laneId,
      payload: { reason: 'integrated-but-not-removed', message: removal.failure.message },
    });
    return undefined;
  }
  await ctx.telemetry.emit({ type: 'LaneRemoved', stepId: eventStepId, laneId: lane.laneId });
  return undefined;
}

/**
 * The engine's own integration of one lane whose step succeeded and which no `merge` step lands
 * (`06` §6.4 rule 4: "on success → enqueue in merge queue"). A lane with nothing to land (its step changed
 * no file, so its branch never left its base; or a crash left it merged but not removed) is removed without
 * a merge: no commit, no `Merge*` event, one `LaneRemoved`. Otherwise it is `landLane` with the run's
 * configured conflict policy and the run's `execution.mergeChecks` (the check set a lane no `merge` step
 * declares one for; none configured means none run, `PLAN-M13.md` P38). Returns the failure when the lane
 * could not be integrated.
 */
export async function integrateLane(
  ctx: ExecuteStepContext,
  laneStepId: string,
  lane: LaneHandle,
  conflictPolicy: ConflictPolicy,
): Promise<StepFailureInfo | undefined> {
  const resolved = resolveLaneChecks(ctx, {
    pre: ctx.mergeChecks?.pre,
    post: ctx.mergeChecks?.post,
    preSource: 'execution.mergeChecks.pre',
    postSource: 'execution.mergeChecks.post',
  });
  if (!resolved.ok) return resolved.failure;
  const result = await landLane(ctx, {
    eventStepId: laneStepId,
    laneStepId,
    lane,
    conflictPolicy,
    checks: resolved.value.checks,
    skippedLayers: resolved.value.skipped,
  });
  return result.failure;
}
