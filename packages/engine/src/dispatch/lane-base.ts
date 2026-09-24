/**
 * What a lane is branched from (`PLAN-M14.md` P34, `06` §6.4, owner decision taken from Q3, `SPEC-QUESTIONS.md`
 * Q226; resolving Q226 open items (a) and (e) — `PLAN-M13.md` P38's own conservative "branch from the tip and
 * say so" choice for a join of several unmerged lanes, and a stacked lane missing what the engine integrated
 * after its predecessor's lane was created).
 *
 * A lane a `merge` step lands is not integrated before that merge (review before merge), so a step that builds
 * on such a lane cannot see it by branching from the integration tip alone: `implement` would not see the tests
 * `generate-tests` wrote, a dependent story would not see its dependency's code. The lane is therefore ALWAYS
 * created from the integration tip, and every one of the step's unmerged, same-scope predecessors is then
 * merged into it — an **in-lane join** (`VcsFacade.mergeIntoLane`, `createLaneForStep`, `steps.ts`) — so the
 * new lane's session starts with every predecessor's committed output, not just one, and never misses whatever
 * the engine integrated elsewhere while a predecessor's own lane sat unmerged.
 *
 * Which predecessors, exactly. The candidates are the step's own `dependsOn` predecessors whose lane is still
 * registered (succeeded, not yet landed) and whose lane is landed by the same `merge` as this step's
 * (`sharesMergeScope`); a predecessor the engine integrated (no merge lands it) is in the integration tip
 * already, and one that failed never lets this step run. A candidate whose head is contained in another
 * candidate's (a chain: `review` on `implement` on `generate-tests`) adds nothing, so it is dropped. What is
 * left — `heads`, below — is merged into the new lane in PLAN order (the compiled node order
 * `integrateSucceededLanes` sweeps, never `dependsOn` order): `dependsOn: ['y', 'x']` still joins `x` before
 * `y` when `x` is declared earlier in the workflow.
 *
 * This module only resolves the base, read-only (`resolveRevision`/`isAncestor`, no lane of its own is
 * created or touched): `swarm-review-step.ts` calls it directly, before any lane of the review's own exists,
 * to decide which lane (if any) its perspective sessions read from. `createLaneForStep` (`steps.ts`) is the
 * one that actually creates the lane and performs the joins.
 *
 * `stackedOn`, computed here, is a read-only PREDICTION for that one caller: whether joining the sole
 * candidate (when there is exactly one) will be a fast-forward — known without ever creating a lane, since a
 * fast-forward is exactly "the tip is already an ancestor of the head" (`isAncestor`). `createLaneForStep`'s
 * own eventual `LaneCreated.payload.stackedOn`/`joinedFrom` are decided independently, from the join's own
 * actual, observed outcome, not read from here — the two happen to agree by construction (both derive from
 * the identical ancestry fact), but are computed twice on purpose rather than threading one value across a
 * lane-creation boundary this module does not itself cross.
 */
import { sharesMergeScope } from '../plan/merge-scope.ts';
import type { StepNode } from '../plan/index.ts';
import { runVcsStep } from './vcs-step.ts';
import type { ExecuteStepContext, StepFailureInfo } from './types.ts';

export interface LaneBase {
  /** The integration tip's resolved sha: the lane is always created from this. */
  readonly tipSha: string;
  /** Every outermost same-scope predecessor head to merge into the new lane, in plan order. Empty when
   * the step has no such predecessor: the lane is created from `tipSha` alone, as before. */
  readonly heads: readonly { readonly id: string; readonly sha: string }[];
  /** The step id of `heads`' own sole entry when there is exactly one AND the lane's own tip already
   * contains it (so joining it is a fast-forward, byte-identical to the old stacking rule) — see this
   * module's own doc comment for why this is computed here, read-only, rather than reused from
   * `createLaneForStep`'s own later, independent computation. Absent for zero or several heads, or when
   * `VcsFacade.isAncestor` is unavailable (two lanes are then never known related). */
  readonly stackedOn?: string;
}

export async function resolveLaneBase(
  node: StepNode,
  ctx: ExecuteStepContext,
): Promise<
  | { readonly ok: true; readonly value: LaneBase }
  | { readonly ok: false; readonly failure: StepFailureInfo }
> {
  const graph = ctx.stepGraph;
  const candidateIds = new Set(
    graph === undefined
      ? []
      : node.dependsOn.filter(
          (id) => ctx.laneRegistry.has(id) && sharesMergeScope(graph, node.id, id),
        ),
  );
  return runVcsStep(node.id, async () => {
    const tipSha = await ctx.vcs.resolveRevision(ctx.integrationBase);
    if (candidateIds.size === 0) return { tipSha, heads: [] };

    // Plan order, never `dependsOn` order: `ctx.stepGraph`'s own Map iteration order is the compiled
    // node order (built as `new Map(nodes.map(...))`, `run-engine.ts`), the identical order
    // `integrateSucceededLanes` sweeps.
    const orderedIds = [...(graph?.keys() ?? [])].filter((id) => candidateIds.has(id));

    // One head per distinct commit: two predecessors at the same commit (one changed nothing) are one.
    const heads: { readonly id: string; readonly sha: string }[] = [];
    for (const id of orderedIds) {
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
    if (
      only !== undefined &&
      rest.length === 0 &&
      isAncestor !== undefined &&
      (await isAncestor(tipSha, only.sha))
    ) {
      return { tipSha, heads: outermost, stackedOn: only.id };
    }
    return { tipSha, heads: outermost };
  });
}
