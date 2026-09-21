/**
 * What a lane is branched from (`PLAN-M13.md` P38, `06` §6.4, owner decision taken from Q3, `SPEC-QUESTIONS.md`
 * Q226; the open item of Q221 section 7 / Q211 item 3).
 *
 * A lane a `merge` step lands is not integrated before that merge (review before merge), so a step that builds
 * on such a lane cannot see it by branching from the integration tip: `implement` would not see the tests
 * `generate-tests` wrote, a dependent story would not see its dependency's code. Such a lane is therefore
 * STACKED: created from the head of its predecessor's lane, so its session starts with the predecessor's
 * committed output. The merge lands the lanes in dependency order, and because the successor's lane contains the
 * predecessor's commits, landing the predecessor first makes the successor's rebase drop them and replay only its
 * own (`packages/vcs` `processMergeCandidate` rebases onto the integration head).
 *
 * Which lane, exactly. The candidates are the step's own `dependsOn` predecessors whose lane is still registered
 * (succeeded, not yet landed) and whose lane is landed by the same `merge` as this step's (`sharesMergeScope`); a
 * predecessor the engine integrated (no merge lands it) is in the integration tip already, and one that failed
 * never lets this step run. A candidate whose head is contained in another candidate's (a chain: `review` on
 * `implement` on `generate-tests`) adds nothing, so it is dropped.
 * - One candidate left: the lane is stacked on it.
 * - None: the lane branches from the integration tip, as before.
 * - Several unrelated ones (a join of two lanes that do not contain each other): the lane branches from the
 *   integration tip and does NOT see them. Combining them would need a merge commit inside the lane (a conflict
 *   policy of its own); the conservative reading is to branch from the tip and say so, in `LaneCreated`'s
 *   payload (`unstackedPredecessors`), rather than invent a synthetic merge. Recorded as an open item in Q226.
 *
 * The base is recorded as the lane's `baseSha` in `LaneCreated`, which is what a resumed run rolls the lane back
 * to and what claim enforcement diffs against: a stacked lane's claim covers only what the step itself changed.
 */
import { sharesMergeScope } from '../plan/merge-scope.ts';
import type { StepNode } from '../plan/index.ts';
import { runVcsStep } from './vcs-step.ts';
import type { ExecuteStepContext, StepFailureInfo } from './types.ts';

export interface LaneBase {
  /** The commit the lane is created from and its claim is enforced against. */
  readonly sha: string;
  /** The predecessor step whose lane this one is stacked on. */
  readonly stackedOn?: string;
  /** Unmerged predecessors this lane does not build on (an unstackable join). */
  readonly unstackedPredecessors?: readonly string[];
}

export async function resolveLaneBase(
  node: StepNode,
  ctx: ExecuteStepContext,
): Promise<
  | { readonly ok: true; readonly value: LaneBase }
  | { readonly ok: false; readonly failure: StepFailureInfo }
> {
  const graph = ctx.stepGraph;
  const candidates =
    graph === undefined
      ? []
      : node.dependsOn.filter(
          (id) => ctx.laneRegistry.has(id) && sharesMergeScope(graph, node.id, id),
        );
  return runVcsStep(node.id, async () => {
    if (candidates.length === 0) return { sha: await ctx.vcs.resolveRevision(ctx.integrationBase) };

    // The heads, one per distinct commit: two predecessors at the same commit (one changed nothing) are one.
    const heads: { readonly id: string; readonly sha: string }[] = [];
    for (const id of candidates) {
      const lane = ctx.laneRegistry.get(id);
      if (lane === undefined) continue;
      const sha = await ctx.vcs.resolveRevision(lane.branch);
      if (!heads.some((head) => head.sha === sha)) heads.push({ id, sha });
    }
    const isAncestor = ctx.vcs.isAncestor?.bind(ctx.vcs);
    const outermost: typeof heads = [];
    for (const head of heads) {
      let contained = false;
      if (isAncestor !== undefined) {
        for (const other of heads) {
          if (other !== head && (await isAncestor(head.sha, other.sha))) contained = true;
        }
      }
      if (!contained) outermost.push(head);
    }
    const [only, ...rest] = outermost;
    if (only !== undefined && rest.length === 0) return { sha: only.sha, stackedOn: only.id };
    return {
      sha: await ctx.vcs.resolveRevision(ctx.integrationBase),
      unstackedPredecessors: outermost.map((head) => head.id),
    };
  });
}
