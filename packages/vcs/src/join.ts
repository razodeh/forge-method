/**
 * In-lane joins (`PLAN-M14.md` P34, `06` §6.4): merging an unmerged predecessor's lane head into a
 * successor's own new lane, so a step built on several unmerged predecessors is built on all of them, not
 * just whichever single one the old stacking rule happened to pick (or none at all, for two or more).
 *
 * `mergeIntoLane` is `git merge <sha> -m <message>` in the lane's own worktree: fast-forward when the
 * lane's current HEAD is already an ancestor of `sha` (the one-predecessor, tip-unmoved case -- the lane
 * branch simply moves, byte-identical to the old stacking rule's own `git worktree add -b <branch> <path>
 * <predecessorHead>`); a real merge commit otherwise. Deliberately never `--no-ff`, so the common,
 * single-predecessor case costs nothing new. A conflict follows the caller's own conflict policy, the
 * identical `abort`/`agent`/`human` dispatch `processMergeCandidate` (`merge-queue.ts`) already
 * establishes for landing a lane -- reusing its own `MergeConflictDescription`/`MergeConflictResolver`
 * types and `conflictStatuses` helper directly: the shape a resolver needs is identical whether the
 * conflict is between two lanes at landing time or between a lane and a predecessor's head at join time.
 * Unlike `processMergeCandidate`'s own rebase loop, a merge is one commit, so at most one resolver call is
 * ever needed here.
 *
 * @see specs/06 §6.4
 * @see PLAN-M14.md P34
 */
import { execa } from 'execa';

import { assertSingleLine } from './commit.ts';
import { VcsError } from './errors.ts';
import { errorMessage, wrapGitFailure } from './git.ts';
import type { LaneHandle } from './lanes.ts';
import {
  conflictStatuses,
  type MergeConflictDescription,
  type MergeConflictResolver,
} from './merge-queue.ts';

export type JoinConflictPolicy = 'agent' | 'human' | 'abort';

export type JoinOutcome =
  | { readonly kind: 'fast-forward'; readonly sha: string }
  | { readonly kind: 'merge'; readonly sha: string }
  /** The join conflicted and was not resolved (`abort` policy, or a resolver that reported
   * `'unresolved'`): the merge was aborted, the lane worktree is clean at its pre-join HEAD, and `files`
   * names every conflicted path -- what the caller's own `LANE-JOIN-CONFLICT` failure names. */
  | { readonly kind: 'conflict'; readonly files: readonly string[] };

async function conflictedFilePaths(worktreePath: string): Promise<readonly string[]> {
  const { stdout } = await wrapGitFailure(
    () =>
      execa('git', ['diff', '--no-renames', '-z', '--name-only', '--diff-filter=U'], {
        cwd: worktreePath,
      }),
    `listing conflicted files in the lane worktree at "${worktreePath}"`,
  );
  return stdout.split('\0').filter((entry) => entry !== '');
}

async function describeJoinConflict(handle: LaneHandle): Promise<MergeConflictDescription> {
  const paths = await conflictedFilePaths(handle.path);
  const conflictedFiles = await conflictStatuses(handle.path, paths);
  const { stdout: diff } = await wrapGitFailure(
    () => execa('git', ['diff'], { cwd: handle.path }),
    `reading the join conflict diff in the lane worktree at "${handle.path}"`,
  );
  // No declared claim exists yet at join time (before the step itself has run) -- the identical "nothing
  // meaningful to forward" reasoning `runMergeStep`'s own `declaredClaim: []` already documents.
  return { laneId: handle.laneId, declaredClaim: [], conflictedFiles, diff, worktreePath: handle.path };
}

async function abortJoin(worktreePath: string): Promise<void> {
  await wrapGitFailure(
    () => execa('git', ['merge', '--abort'], { cwd: worktreePath }),
    `aborting the in-progress join in the lane worktree at "${worktreePath}"`,
  );
}

async function stageResolution(worktreePath: string): Promise<void> {
  await wrapGitFailure(
    () => execa('git', ['add', '-A'], { cwd: worktreePath }),
    `staging the join conflict resolution in the lane worktree at "${worktreePath}"`,
  );
}

/**
 * Joins `sha` into `handle`'s own current HEAD. `message` is already fully formatted (trailers
 * included) by the caller -- this function never builds or inspects its content, the same "trusted once
 * formatted" stance `commitInLane` already takes for its own `message` parameter.
 *
 * `handle.laneId` is validated for a newline the identical way `processMergeCandidate` validates the
 * same field for the identical reason (`merge-queue.ts`'s own doc comment): a reconstructed `LaneHandle`
 * is not provably the untouched output of `createLaneWorktree`.
 *
 * A real content conflict is not this function's own failure to report as a `VcsError` -- it is one of
 * the expected outcomes the conflict-policy dispatch below handles, the identical "an expected outcome,
 * not a failure" stance `processMergeCandidate` already takes for the analogous case. A `git merge`
 * failure with no unmerged path at all (a rejecting hook, a corrupt object) is NOT a content conflict and
 * is reported as `VCS-GIT-OPERATION-FAILED` after aborting, so the worktree is never left stuck either
 * way.
 */
export async function mergeIntoLane(
  handle: LaneHandle,
  sha: string,
  message: string,
  conflictPolicy: JoinConflictPolicy,
  resolver?: MergeConflictResolver,
): Promise<JoinOutcome> {
  assertSingleLine('laneId', handle.laneId);

  try {
    await execa('git', ['merge', sha, '-m', message], { cwd: handle.path });
  } catch (cause) {
    const files = await conflictedFilePaths(handle.path);
    if (files.length === 0) {
      let cleanupNote = '';
      try {
        await abortJoin(handle.path);
      } catch (cleanupCause) {
        cleanupNote = ` (cleanup afterward also failed: ${errorMessage(cleanupCause)})`;
      }
      throw new VcsError(
        {
          code: 'VCS-GIT-OPERATION-FAILED',
          message:
            `git merge failed in the lane worktree at "${handle.path}" while joining "${sha}", for a ` +
            `reason other than a content conflict (no unmerged paths were found): ${errorMessage(cause)}` +
            cleanupNote,
          remedy:
            'This is not an ordinary merge conflict -- inspect the lane worktree directly. See the ' +
            'underlying cause for the exact git error.',
        },
        { cause },
      );
    }
    if (conflictPolicy === 'abort') {
      await abortJoin(handle.path);
      return { kind: 'conflict', files };
    }
    if (resolver === undefined) {
      await abortJoin(handle.path);
      throw new VcsError({
        code: 'VCS-MISSING-CONFLICT-RESOLVER',
        message:
          `conflictPolicy is "${conflictPolicy}", which requires a conflict resolver for a join, but ` +
          'none was supplied.',
        remedy: 'Pass a conflictResolver, or set the conflict policy to "abort".',
      });
    }
    let resolution: 'resolved' | 'unresolved';
    try {
      resolution = await resolver(await describeJoinConflict(handle));
    } catch (resolverCause) {
      try {
        await abortJoin(handle.path);
      } catch {
        // Best-effort cleanup; the resolver's own failure is what the caller most needs to see -- the
        // identical stance `processMergeCandidate` already takes for its own resolver-throws case.
      }
      throw resolverCause;
    }
    if (resolution === 'unresolved') {
      await abortJoin(handle.path);
      return { kind: 'conflict', files };
    }
    await stageResolution(handle.path);
    await wrapGitFailure(
      () => execa('git', ['commit', '-m', message], { cwd: handle.path }),
      `committing the resolved join in the lane worktree at "${handle.path}"`,
    );
  }

  const { stdout: headAfter } = await wrapGitFailure(
    () => execa('git', ['rev-parse', 'HEAD'], { cwd: handle.path }),
    `resolving the lane worktree's own new HEAD at "${handle.path}"`,
  );
  const finalSha = headAfter.trim();
  // A fast-forward moves HEAD to exactly `sha` (git makes no new commit); anything else -- a real merge
  // commit, or a conflict resolved by committing -- produces a new sha distinct from `sha`.
  return finalSha === sha ? { kind: 'fast-forward', sha: finalSha } : { kind: 'merge', sha: finalSha };
}
