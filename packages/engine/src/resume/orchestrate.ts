/**
 * `resumeRun` — `06` §6.10 steps 1-4, made real: `reconstructRunState` (P18) → reclaim orphaned
 * worktrees (`@forge/vcs` P2, `20` §20.10 S12) → per-unresolved-step resume-or-reroll → artifact
 * reconciliation (`revalidateArtifacts`) → hand back a `RunState` ready for `@forge/engine/scheduler`
 * (P12) to re-seed and continue. This is M5's own defining criterion (`PLAN-M5.md` P19's own Mandate).
 *
 * Scoped to `agent`-kind unresolved steps for the actual resume-vs-reroll execution: a `command`-kind
 * step has no adapter session to resume at all, and a step this run's own compiled plan (`ctx.steps`)
 * or lane-origin record (`RunState.laneOrigins`) has nothing for — an even earlier crash than this piece
 * can safely reconstruct anything about — both fall back to the ordinary, already-safe path: reset to
 * `'scheduled'` in the returned `RunState`, so the caller's own scheduler loop re-runs it exactly the
 * way any other scheduled step already does (a fresh lane, `runCommandStep`/`runAgentStep` unchanged),
 * rather than this piece inventing a second, narrower re-run path duplicate of the one that already
 * exists for that.
 *
 * @see specs/06 §6.10
 * @see specs/20 §20.10
 * @see PLAN-M5.md P19
 */
import { existsSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import path from 'node:path';

import {
  laneBranchName,
  listOrphanedWorktrees,
  removeLaneWorktree,
  resolveRevision,
  slugifyStepId,
  type LaneHandle,
} from '@forge/vcs';
import { readEvents } from '@forge/telemetry/events';

import type { ExecuteStepContext, StepOutcome } from '../dispatch/index.ts';
import { runAgentWork, runLaneLifecycle } from '../dispatch/index.ts';
import type { StepNode } from '../plan/index.ts';
import { reconstructRunState } from './reconstruct.ts';
import { decideResumeStrategy } from './strategy.ts';
import { rollbackLaneToBase } from './rollback.ts';
import type { RunState, StepReconstructedStatus } from './types.ts';

/** `PLAN-M5.md`'s own literal `resumeRun(runId, ctx)` bullet undersells what a real call needs, the same
 * "the plan's own bullet undersells the signature" correction this whole package has already made once
 * per piece for many pieces (`Q70`/`Q71`/`Q73`/`Q75`/`Q76`/`Q77`/`Q79`): `ExecuteStepContext` alone
 * (`@forge/engine/dispatch`, P15) has everything needed to actually re-drive `runLaneLifecycle`/
 * `runAgentWork` against a resumed lane, but nothing in it can turn a bare `stepId` string back into the
 * compiled `StepNode` a real re-run needs (`kind`, `agent`, `brief`, `produces`, `limits`) — `RunState`
 * itself deliberately carries no such thing (`types.ts`'s own doc comment: re-compiling the workflow
 * fresh is the caller's job, not something duplicated into the append-only log). `steps` is that missing
 * piece, keyed by `StepNode.id`, exactly what re-compiling the same workflow source produces. */
export interface ResumeContext extends ExecuteStepContext {
  readonly steps: ReadonlyMap<string, StepNode>;
}

function laneWorktreePath(projectRoot: string, laneId: string): string {
  return path.join(projectRoot, '.forge', 'state', 'worktrees', laneId);
}

function emptySessionResult(): {
  readonly sessionId: string;
  readonly ok: false;
  readonly finalText: string;
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly turns: number;
  };
  readonly durationMs: number;
  readonly changedFiles: readonly string[];
  readonly controlTokens: readonly [];
} {
  return {
    sessionId: '',
    ok: false,
    finalText: '',
    usage: { inputTokens: 0, outputTokens: 0, turns: 0 },
    durationMs: 0,
    changedFiles: [],
    controlTokens: [],
  };
}

/** Every worktree `git` itself still knows about that matches this run's own `laneId` namespace
 * (`${runId}-...`) but is not among the lanes this run's own reconstructed log ever recorded — a lane a
 * killed process created (or was still using) that the log has no further trace of at all. Scoped to
 * `runId`'s own namespace deliberately: `listOrphanedWorktrees` itself has no per-run filter of its own
 * (`@forge/vcs`'s own doc comment: it reads *every* forge-managed worktree git knows about), and a
 * resume for one run must never reclaim a worktree a completely different, still-live run owns. */
async function reclaimOrphanedWorktrees(
  ctx: ResumeContext,
  runId: string,
  runState: RunState,
): Promise<readonly string[]> {
  const knownLaneIds = new Set(runState.laneStatuses.keys());
  const candidates = await listOrphanedWorktrees(ctx.projectRoot);
  const ownedOrphans = candidates.filter(
    (handle) => handle.laneId.startsWith(`${runId}-`) && !knownLaneIds.has(handle.laneId),
  );
  for (const handle of ownedOrphans) {
    await removeLaneWorktree(ctx.projectRoot, handle, { retain: false });
  }
  return ownedOrphans.map((handle) => handle.laneId);
}

/** `@forge/vcs`'s own `createLaneWorktree`/`removeLaneWorktree`/`listOrphanedWorktrees` all resolve
 * `cwd` through `realpath` before computing or comparing any worktree path against git's own reports —
 * `lanes.ts`'s own `resolveCwd` doc comment: confirmed empirically that `os.tmpdir()` itself is a
 * symlink on macOS, so an *unresolved* `ctx.projectRoot` and the identical real directory's own
 * `realpath`'d form compare unequal as plain strings even though they name the same location. A gauntlet
 * critic-round verify pass found this function skipped that resolution — computing a lane path directly
 * from `ctx.projectRoot`, unresolved — which silently mismatched `removeLaneWorktree`'s own internal
 * `isRegisteredWorktree` string comparison against git's real (already-realpath'd) worktree list,
 * causing `git worktree remove` to be skipped while `git branch -D` still ran, failing with "cannot
 * delete branch checked out at..." since the worktree was, genuinely, still there. */
async function laneHandleFor(
  ctx: ResumeContext,
  runId: string,
  stepId: string,
): Promise<LaneHandle> {
  const resolvedProjectRoot = await realpath(ctx.projectRoot);
  const laneId = `${runId}-${slugifyStepId(stepId)}`;
  return {
    laneId: laneId as LaneHandle['laneId'],
    path: laneWorktreePath(resolvedProjectRoot, laneId),
    branch: laneBranchName(runId, stepId),
  };
}

function runAgentAttempt(
  node: StepNode,
  ctx: ResumeContext,
  lane: LaneHandle,
  baseSha: string,
  source: { readonly kind: 'start' } | { readonly kind: 'resume'; readonly sessionId: string },
): Promise<StepOutcome> {
  return runLaneLifecycle(
    node,
    ctx,
    ctx.now(),
    { kind: 'agent', session: emptySessionResult() },
    (workLane, workBaseSha) => runAgentWork(node, ctx, workLane, workBaseSha, source),
    { lane, baseSha },
  );
}

/** A gauntlet critic round found this doc comment's own earlier claim (that a genuine runtime fallback
 * already existed) was aspirational, not real: `decideResumeStrategy`'s own upfront decision was final,
 * with no actual attempt-and-fall-back if a resume-session attempt failed for real, contradicting `06`
 * §6.10's own "if supported and still valid, else roll back... and re-run" language for exactly the case
 * that language exists to cover (a session that *looked* resumable but genuinely was not). Fixed here:
 * a `'resume-session'` attempt that comes back `'failed'` is retried once, fresh, via the identical
 * reroll path a `decideResumeStrategy() === 'reroll'` verdict would have taken from the start —
 * `PlatformAdapter` has no separate "probe a session id" method (`decideResumeStrategy`'s own doc
 * comment), so an actual attempt is the only way "still valid" can ever really be confirmed. A resumed
 * session that runs to completion but the *underlying task itself* genuinely fails (a real tool error,
 * not an invalid session) also takes this same retry — indistinguishable from here, and not a new
 * problem: `@forge/engine/failures`' own retry machinery already treats more than one `SessionStarted`/
 * `SessionEnded` pair for the identical step across attempts as ordinary, expected history, not
 * something this piece needs to avoid producing.
 *
 * A gauntlet verify round found the first version of this fallback rolled back to a *freshly re-resolved*
 * `'HEAD'`, resolved only after the failed resume attempt had already run — but `runAgentWork`'s own
 * documented behaviour (`steps.ts`) commits real partial writes even on a *failed* attempt ("a crash can
 * land here after real tool-use writes already reached the lane worktree... those writes still get
 * committed"), so a failed resume attempt that wrote and committed anything had already advanced HEAD by
 * the time the rollback ran, making `rollbackLaneToBase(lane, 'HEAD')` a no-op against exactly the stale
 * content the fallback exists to discard. Fixed by capturing the lane's HEAD *before* the resume attempt
 * is ever made, and rolling back to that captured value instead of re-deriving `'HEAD'` afterward. */
async function resumeAgentStep(
  node: StepNode,
  ctx: ResumeContext,
  lane: LaneHandle,
  baseSha: string,
  strategy: 'resume-session' | 'reroll',
  sessionId: string | undefined,
): Promise<StepOutcome> {
  if (strategy === 'resume-session' && sessionId !== undefined) {
    // Captured before the attempt, not after: see this function's own doc comment.
    const preAttemptHead = await resolveRevision(lane.path, 'HEAD');
    const attempt = await runAgentAttempt(node, ctx, lane, baseSha, { kind: 'resume', sessionId });
    if (attempt.status === 'succeeded') return attempt;
    await rollbackLaneToBase(lane, preAttemptHead);
    return runAgentAttempt(node, ctx, lane, baseSha, { kind: 'start' });
  }
  // "its last FORGE commit (or lane base)": resolved inside the lane's own worktree, HEAD already IS
  // whichever of the two is more recent -- a lane that never committed has HEAD still at its own base
  // (git worktree add checks it out there), and one that did has HEAD at that last real commit. No
  // separate "last known good commit" needs tracking anywhere for this to be correct. Safe to resolve
  // 'HEAD' directly here (unlike the fallback branch above): nothing has run against this lane yet on
  // this call, so there is no attempt of this call's own that could have moved it first.
  await rollbackLaneToBase(lane, 'HEAD');
  return runAgentAttempt(node, ctx, lane, baseSha, { kind: 'start' });
}

/** A gauntlet critic round found that falling an unresolved step back to `'scheduled'` (this function's
 * own `undefined` return) is only safe if no lane already exists for it — `runCommandStep`'s own
 * non-inline path creates a real lane exactly like an agent step does (`steps.ts`'s own
 * `runLaneLifecycle`), so a `command`-kind step interrupted after its own `LaneCreated` leaves a real
 * worktree/branch behind that a fresh `ctx.vcs.createLane` (the ordinary scheduled-step path) would
 * collide with — git's own "branch/worktree already exists" refusal, on a resume that had every chance
 * to avoid it. `resumeRun` now removes any such stale lane before resetting the step to `'scheduled'`
 * (`removeStaleLaneIfAny` below), for every one of this function's three "cannot safely resume" exits,
 * not only the ones this file happens to execute machinery for. */
async function resumeOneStep(
  ctx: ResumeContext,
  runId: string,
  runState: RunState,
  stepId: string,
): Promise<StepOutcome | undefined> {
  const node = ctx.steps.get(stepId);
  if (node?.kind !== 'agent' || node.agent === undefined) return undefined;

  const laneId = `${runId}-${slugifyStepId(stepId)}`;
  const origin = runState.laneOrigins.get(laneId);
  if (origin === undefined) return undefined;

  const lane = await laneHandleFor(ctx, runId, stepId);
  const capabilities = await ctx.adapter.capabilities();
  const sessionId = runState.sessionIds.get(stepId);
  const strategy = decideResumeStrategy(sessionId, capabilities);

  const outcome = await resumeAgentStep(node, ctx, lane, origin.baseSha, strategy, sessionId);
  // A gauntlet critic round (surfaced by P20's own crash-resume E2E test, not caught by this piece's
  // own unit tests -- those only ever checked resumeRun's in-memory *returned* RunState, never the
  // durable log a later, independent reconstruction reads) found this call bypasses `@forge/engine/
  // dispatch`'s own `executeStep` entirely (`runLaneLifecycle`/`runAgentWork` are called directly, so a
  // resume/reroll can reuse an *existing* lane rather than always creating a fresh one) -- and
  // `executeStep` is the one place `StepSucceeded`/`StepFailed` is ever emitted (`execute.ts`'s own doc
  // comment: "nothing else in this milestone's own built pieces ever emits either"). Without this, a
  // resumed step's own terminal status lives only in `resumeRun`'s in-memory return value, never in the
  // append-only log itself -- directly contradicting `18` §18.4's own "if a value cannot be derived from
  // the log, it does not exist" rule this whole event system is built on: a *second* reconstruction
  // later (`06` §6.10 step 4's own "re-enter the scheduler loop," done by re-reading the log, not by
  // trusting an in-memory value handed across a function call) would see the step stuck at `'running'`
  // forever. Emitted here, matching `executeStep`'s own exact shape, so every terminal `StepOutcome` this
  // whole package ever produces -- resumed or not -- reaches the log exactly once.
  await ctx.telemetry.emit({
    type: outcome.status === 'succeeded' ? 'StepSucceeded' : 'StepFailed',
    stepId,
    payload: outcome.status === 'failed' ? outcome.failure : undefined,
  });
  return outcome;
}

/** See `resumeOneStep`'s own doc comment: removes a lane this run's own log already recorded
 * (`RunState.laneStatuses`) but that `resumeOneStep` decided not to resume into, so the ordinary fresh-
 * lane scheduler path that follows a `'scheduled'` reset does not collide with it. A no-op, safely, for
 * a step whose crash happened before any lane ever existed at all (`removeLaneWorktree`'s own doc
 * comment: idempotent, checks the real worktree/branch state before touching anything). */
async function removeStaleLaneIfAny(
  ctx: ResumeContext,
  runId: string,
  stepId: string,
  runState: RunState,
): Promise<void> {
  const laneId = `${runId}-${slugifyStepId(stepId)}`;
  if (!runState.laneStatuses.has(laneId)) return;
  const lane = await laneHandleFor(ctx, runId, stepId);
  await removeLaneWorktree(ctx.projectRoot, lane, { retain: false });
}

/** `ctx.laneRegistry` (`@forge/engine/dispatch`'s own `ExecuteStepContext`) is purely in-memory — "a
 * caller constructs one empty `Map` per run and reuses it across every `executeStep` call in that run"
 * (its own doc comment) — and a resume, by construction, is a *new* process with a *new*, empty one. A
 * gauntlet critic round (P20's own crash-resume E2E test) found this meant a step that had already
 * reached `LaneReady`/`StepSucceeded` *before* the crash, but whose lane a later `merge` step had not
 * yet consumed, silently vanished from `runMergeStep`'s own view: `ctx.laneRegistry.get(predecessorId)`
 * found nothing, and `runMergeStep`'s own "no predecessor lane to merge" case (a legitimate, different
 * scenario — a `dependsOn` entry whose step never actually got a lane at all) silently swallowed it,
 * merging every *other* lane but dropping this one's real, already-committed content with no error at
 * all. Fixed by repopulating `ctx.laneRegistry` from `RunState.laneStatuses`/`laneOrigins` before
 * anything else runs: every lane still `'ready'` (committed and claim-enforced, but not yet `'removed'`
 * by a real merge) gets a real, deterministically-reconstructed `LaneHandle` set back in, keyed by the
 * step id `laneOrigins` recorded for it — exactly what a normal, uninterrupted run would already have
 * in memory at this same point.
 *
 * A second gauntlet critic round found this first version trusted `laneStatuses === 'ready'`
 * unconditionally, with no check against real git state — but `runMergeStep` (`dispatch/steps.ts`)
 * writes `MergeCompleted` *before* the real `ctx.vcs.removeLane` call, and only writes `LaneRemoved`
 * *after* that removal actually completes, so a crash landing in that exact gap durably logs `'ready'`
 * for a lane whose real worktree is already gone. Repopulating a handle for it unconditionally would
 * hand a later merge attempt a path that no longer exists. Fixed by checking the real worktree still
 * exists on disk (`existsSync`) before trusting `laneStatuses` at all — the identical "cross-check
 * against real git/filesystem state, never trust the log alone for something a crash could have
 * outpaced" discipline `reclaimOrphanedWorktrees` (above) already applies for the analogous orphaned-
 * worktree case. Returns every laneId found stale this way, so `resumeRun` can correct its own returned
 * `laneStatuses` to `'removed'` for them too — the log said `'ready'`, but reality already disagreed. */
async function repopulateLaneRegistry(
  ctx: ResumeContext,
  runId: string,
  runState: RunState,
): Promise<ReadonlySet<string>> {
  const staleLaneIds = new Set<string>();
  for (const [laneId, status] of runState.laneStatuses) {
    if (status !== 'ready') continue;
    const origin = runState.laneOrigins.get(laneId);
    if (origin === undefined) continue;
    const lane: LaneHandle = {
      laneId: laneId as LaneHandle['laneId'],
      path: laneWorktreePath(await realpath(ctx.projectRoot), laneId),
      branch: laneBranchName(runId, origin.stepId),
    };
    if (!existsSync(lane.path)) {
      staleLaneIds.add(laneId);
      continue;
    }
    ctx.laneRegistry.set(origin.stepId, lane);
  }
  return staleLaneIds;
}

export async function resumeRun(runId: string, ctx: ResumeContext): Promise<RunState> {
  const runState = await reconstructRunState(readEvents(ctx.projectRoot, runId));
  await reclaimOrphanedWorktrees(ctx, runId, runState);
  const staleReadyLaneIds = await repopulateLaneRegistry(ctx, runId, runState);

  const stepStatuses = new Map<string, StepReconstructedStatus>(runState.stepStatuses);
  const laneStatuses = new Map(runState.laneStatuses);
  for (const laneId of staleReadyLaneIds) laneStatuses.set(laneId, 'removed');
  for (const stepId of runState.unresolvedStepIds) {
    const outcome = await resumeOneStep(ctx, runId, runState, stepId);
    if (outcome === undefined) {
      await removeStaleLaneIfAny(ctx, runId, stepId, runState);
      const laneId = `${runId}-${slugifyStepId(stepId)}`;
      if (laneStatuses.has(laneId)) laneStatuses.set(laneId, 'removed');
      stepStatuses.set(stepId, 'scheduled');
    } else {
      stepStatuses.set(stepId, outcome.status === 'succeeded' ? 'succeeded' : 'failed');
    }
  }

  // Provably empty, not merely expected to be: every id that was 'running' going into the loop above
  // just got set to 'scheduled'/'succeeded'/'failed' (resumeOneStep's own return type -- a real
  // StepOutcome's own `status` is never 'running', and `undefined` maps to 'scheduled'), and nothing
  // else in this function ever sets a status to 'running' at all -- so recomputing this by filtering
  // stepStatuses again would only ever produce an unreachable branch, not a real safety net.
  return { ...runState, stepStatuses, laneStatuses, unresolvedStepIds: [] };
}
