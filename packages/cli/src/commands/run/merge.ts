/**
 * `forge merge` — `03` §3.2.4: "Drive the merge queue manually; `--lane`, `--all`, `--abort`."
 *
 * `--abort` is not implemented: `10`/`06`'s own spec text gives no further detail on what "abort"
 * means for a command that (unlike `forge abort [runId]`, a real, unrelated command a few rows above
 * this one in the same table) is not itself killing a process — a merge already has its own real
 * abort-on-conflict/abort-on-failure policy inside `processMergeCandidate` (`@forge/vcs`), applied
 * automatically per candidate, not as a separate manual step this command would drive. Refused
 * (`USR-003`) rather than guessed at. See `SPEC-QUESTIONS.md`.
 *
 * @see specs/03 §3.2.4
 */
import { ForgeError, type Clock } from '@forge/core';
import type { ProjectPaths } from '@forge/core/fs';
import { createMergeQueueFacade } from '@forge/engine/dispatch';
import type { MergeCandidateLike, MergeOutcome } from '@forge/engine/dispatch';
import { reconstructRunState } from '@forge/engine/resume';
import { readEvents } from '@forge/telemetry/events';
import { laneBranchName } from '@forge/vcs';

export interface MergeContext {
  readonly paths: ProjectPaths;
  readonly projectRoot: string;
  readonly runId: string;
  readonly integrationPath: string;
  readonly clock?: Clock;
}

async function laneCandidate(ctx: MergeContext, laneId: string): Promise<MergeCandidateLike> {
  const runState = await reconstructRunState(readEvents(ctx.projectRoot, ctx.runId));
  const origin = runState.laneOrigins.get(laneId);
  if (origin === undefined) {
    throw new ForgeError('RUN-051', { laneId });
  }
  // `laneId` itself (`<runId>-<stepId-slug>`, `@forge/vcs`'s own `lanes.ts`) is not the lane's real git
  // branch name (`forge/<runId>/<stepId-slug>`, from the same module's `laneBranchName`) — a critic-
  // round-shaped bug caught before commit: `candidate.handle.branch` is what `processMergeCandidate`
  // itself actually reaches with `git merge`/`git rebase` (`merge-queue.ts`'s own doc comment), so using
  // the bare `laneId` there would target a branch that never exists.
  const laneDir = ctx.paths.resolveState(`worktrees/${laneId}`);
  return {
    handle: { laneId, path: laneDir, branch: laneBranchName(ctx.runId, origin.stepId) },
    stepId: origin.stepId,
    runId: ctx.runId,
    // `runMergeStep`'s own real usage always passes `[]` here too — no real `conflictResolver` exists
    // yet for either caller to hand a declared claim to (`MergeCandidateLike`'s own doc comment).
    declaredClaim: [],
    conflictPolicy: 'abort',
  };
}

export async function mergeLane(ctx: MergeContext, laneId: string): Promise<MergeOutcome> {
  const facade = createMergeQueueFacade(ctx.integrationPath, undefined);
  const candidate = await laneCandidate(ctx, laneId);
  return facade.process(candidate, {});
}

export async function mergeAllReady(
  ctx: MergeContext,
): Promise<readonly { readonly laneId: string; readonly outcome: MergeOutcome }[]> {
  const runState = await reconstructRunState(readEvents(ctx.projectRoot, ctx.runId));
  const readyLaneIds = [...runState.laneStatuses.entries()]
    .filter(([, status]) => status === 'ready')
    .map(([laneId]) => laneId);

  const results: { readonly laneId: string; readonly outcome: MergeOutcome }[] = [];
  for (const laneId of readyLaneIds) {
    results.push({ laneId, outcome: await mergeLane(ctx, laneId) });
  }
  return results;
}

export function mergeAbort(): never {
  throw new ForgeError('USR-003', { feature: 'forge merge --abort' });
}
