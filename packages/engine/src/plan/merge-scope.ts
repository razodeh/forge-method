/**
 * Which lanes a `merge` step lands, and which lanes therefore wait for one (`PLAN-M13.md` P19, `06` §6.4-§6.5,
 * `10` §10.1, owner decision Q3, `SPEC-QUESTIONS.md` Q221).
 *
 * A `merge` node is "merge-queue processing for a *set* of lanes" (`10` §10.1); a workflow does not name the
 * lanes, it names the work the merge closes (`dependsOn`, one entry per fanout item after compilation, see
 * `mergeDependsOn` in `compile.ts`). In the shipped `build-stage` that work is the per-story `review` steps,
 * but what has to reach the integration branch is what the reviews approved: the `implement` (and
 * `generate-tests`) lanes behind them. So a merge lands the lanes of every step in its dependency closure,
 * except those behind an *integration checkpoint*.
 *
 * A checkpoint is a `gate` (which reads the integrated tree, so what it checks must already be integrated) or
 * another `merge` (which lands its own closure). A step that is upstream of a checkpoint that is itself
 * upstream of this merge is not this merge's: it is integrated before that checkpoint runs (by the earlier
 * merge, or, when no merge lands it, by the engine as soon as it succeeds). "Upstream of" is transitive over
 * every `dependsOn` edge, including the implicit ones the compiler adds (`10` §10.1, `06` §6.6: `implement`
 * depends on `freeze-contracts` directly, as well as through `contracts-gate`), which is why this is "behind a
 * checkpoint on some path" and not "reached without crossing one".
 *
 * Pure functions over the compiled plan; the runtime (`runMergeStep`, `runEngine`) is the only consumer.
 */
import type { StepNode } from './types.ts';

/** Kinds that are integration checkpoints: where the integrated tree is read or written, not work. */
function isCheckpoint(node: StepNode): boolean {
  return node.kind === 'gate' || node.kind === 'merge';
}

/** Every step `id` transitively waits for (`dependsOn`), not `id` itself. A dependency naming a step that is
 * not in `nodes` is skipped (the compiler rejects those; a hand-built graph may not). */
export function upstreamOf(nodes: ReadonlyMap<string, StepNode>, id: string): ReadonlySet<string> {
  const seen = new Set<string>();
  const stack = [...(nodes.get(id)?.dependsOn ?? [])];
  for (let dep = stack.pop(); dep !== undefined; dep = stack.pop()) {
    if (seen.has(dep) || dep === id) continue;
    const node = nodes.get(dep);
    if (node === undefined) continue;
    seen.add(dep);
    stack.push(...node.dependsOn);
  }
  return seen;
}

/**
 * The steps whose lanes `mergeId` lands, dependencies before dependents (post-order over `dependsOn`, in the
 * order each list names them), each once. Excludes `mergeId` itself, every checkpoint upstream of it and
 * everything upstream of those. Empty for an unknown or non-merge id.
 */
export function mergeLandingScope(
  nodes: ReadonlyMap<string, StepNode>,
  mergeId: string,
): readonly string[] {
  const merge = nodes.get(mergeId);
  if (merge?.kind !== 'merge') return [];
  const upstream = upstreamOf(nodes, mergeId);
  const behindCheckpoint = new Set<string>();
  for (const id of upstream) {
    const node = nodes.get(id);
    if (node === undefined || !isCheckpoint(node)) continue;
    behindCheckpoint.add(id);
    for (const before of upstreamOf(nodes, id)) behindCheckpoint.add(before);
  }

  const ordered: string[] = [];
  const seen = new Set<string>([mergeId]);
  // Iterative post-order: a workflow can be thousands of steps deep once fanouts expand.
  const stack: { readonly id: string; readonly deps: readonly string[]; index: number }[] = [
    { id: mergeId, deps: merge.dependsOn, index: 0 },
  ];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame === undefined) break;
    const depId = frame.deps[frame.index];
    if (depId === undefined) {
      stack.pop();
      if (frame.id !== mergeId) ordered.push(frame.id);
      continue;
    }
    frame.index += 1;
    if (seen.has(depId) || behindCheckpoint.has(depId)) continue;
    seen.add(depId);
    const dep = nodes.get(depId);
    if (dep === undefined) continue;
    stack.push({ id: depId, deps: dep.dependsOn, index: 0 });
  }
  return ordered;
}

/**
 * Every step whose lane some `merge` step lands: the union of `mergeLandingScope` over the plan's merge nodes.
 * A lane whose step is not in this set is integrated by the engine as soon as the step succeeds.
 */
export function stepsLandedByMerges(nodes: readonly StepNode[]): ReadonlySet<string> {
  const byId = new Map(nodes.map((node) => [node.id, node] as const));
  const landed = new Set<string>();
  for (const node of nodes) {
    if (node.kind !== 'merge') continue;
    for (const id of mergeLandingScope(byId, node.id)) landed.add(id);
  }
  return landed;
}
