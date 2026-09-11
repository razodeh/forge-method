/**
 * `rollbackLaneToBase` — `06` §6.10 step 2's own "else roll the lane worktree back to its last FORGE
 * commit (or lane base)... and re-run from the step's own `idempotencyKey`" half, for a step
 * `decideResumeStrategy` decided is not resumable. A thin wrapper over `@forge/vcs`'s own real worktree
 * primitive (`resetLaneWorktree`, P2/P19) — this module has no opinion of its own on the actual
 * mechanism, the same "this piece has no opinion on the real mechanism, only on how to interpret its
 * result" stance `@forge/engine/dispatch`'s own `VcsFacade` (P15) already takes for the identical reason.
 *
 * `lastKnownGoodCommit` is the caller's own choice of target, not computed here: `resumeRun` supplies
 * it, ordinarily `RunState.laneOrigins`' own recorded lane HEAD if the lane ever committed real work, or
 * the lane's own recorded `baseSha` if it never did — "last FORGE commit (or lane base)" read literally.
 *
 * A stale git lock left behind by the crashed process this resume is recovering from (`06` §6.10) could
 * otherwise make this very call's own `git reset --hard` fail outright — `resumeRun`'s own doc comment
 * has the fuller reasoning for why that is swept once, up front, for the whole resume, rather than
 * chased at each individual call site (this one included) that happens to touch git state afterward.
 *
 * @see specs/06 §6.10
 * @see PLAN-M5.md P19
 */
import { resetLaneWorktree, type LaneHandle } from '@forge/vcs';

export async function rollbackLaneToBase(
  handle: LaneHandle,
  lastKnownGoodCommit: string,
): Promise<void> {
  await resetLaneWorktree(handle, lastKnownGoodCommit);
}
