/**
 * `06` §6.2's own rule 6: "compute critical path and estimated cost; show both before execution."
 *
 * @see specs/06 §6.2
 * @see PLAN-M5.md P11
 */
import type { CriticalPathResult, StepNode } from './types.ts';

/** A `Map<K, number>` always answers `V | undefined` from `.get`, regardless of how confident the caller
 * is a given key was already initialised — consolidated into one shared helper, rather than an inline `??
 * fallback` at every call site, specifically so the one real question ("does this ever actually take the
 * fallback branch") only needs answering, and testing, once for this whole module, not once per call
 * site. */
function mapGetOr(map: ReadonlyMap<string, number>, key: string, fallback: number): number {
  return map.get(key) ?? fallback;
}

/** Kahn's algorithm — iterative, and naturally robust to being handed a cyclic graph directly (a node
 * inside a cycle simply never reaches in-degree zero and is silently excluded from the returned order,
 * rather than looping forever or crashing): a well-formed caller always runs `detectCycles` first and
 * never actually reaches `computeCriticalPath` with one, but this function's own algorithm choice means
 * it does not *need* that guarantee to behave safely if it ever is. Likewise robust to a `dependsOn` entry
 * naming a node not present in `nodes` at all (a genuinely dangling reference `@forge/engine/plan`'s own
 * `checkPlanConsistency`, P10, would already have caught earlier in the real pipeline, but this function
 * is also directly callable on its own): a dangling `dep` can receive entries in `dependents` but never in
 * `remainingInDegree`, so nothing referencing it ever reaches in-degree zero either — the identical
 * "excluded, not crashed" outcome a genuine cycle produces, for the identical underlying reason (a
 * dependency that can never resolve to a real, processed node).
 *
 * The queue is a plain, growing array processed with `for...of`, not `while (queue.length > 0) { const id
 * = queue.shift(); ... }`: a JS `for...of` over an array re-reads `.length` on every step, so an element
 * pushed *during* iteration (a newly-ready node) is still visited — the identical FIFO traversal order a
 * shift-based loop gives, without ever needing a `noUncheckedIndexedAccess`-style `undefined` guard for a
 * `.shift()` call this module could otherwise prove, but not express to the compiler, always succeeds
 * while the surrounding `while` condition holds. */
function topologicalOrder(nodes: readonly StepNode[]): readonly string[] {
  const dependents = new Map<string, string[]>();
  const remainingInDegree = new Map<string, number>();

  for (const node of nodes) {
    remainingInDegree.set(node.id, mapGetOr(remainingInDegree, node.id, 0));
    for (const dep of node.dependsOn) {
      remainingInDegree.set(node.id, mapGetOr(remainingInDegree, node.id, 0) + 1);
      const list = dependents.get(dep) ?? [];
      list.push(node.id);
      dependents.set(dep, list);
    }
  }

  const order: string[] = [];
  const queue = nodes.filter((node) => remainingInDegree.get(node.id) === 0).map((node) => node.id);
  for (const id of queue) {
    order.push(id);
    for (const dependentId of dependents.get(id) ?? []) {
      const next = mapGetOr(remainingInDegree, dependentId, 0) - 1;
      remainingInDegree.set(dependentId, next);
      if (next === 0) queue.push(dependentId);
    }
  }
  return order;
}

/** `06` §6.2's own rule 6, and `10` §10.1's own worked example already showing exactly this shape of
 * per-step declared cost (`limits: { maxTurns: 25, maxCostUsd: 1.5 }`) as the only budget figure available
 * pre-execution — the longest (by summed `limits.maxCostUsd`, not by step *count*, per this piece's own
 * Checks text: "proven by cost, not just length") root-to-sink chain through the compiled plan's own
 * `dependsOn` edges. An empty plan's own critical path is the empty path at zero cost, not an error —
 * there is nothing pathological about a workflow compiling to zero steps for a given context.
 *
 * If two nodes share the identical `id` (a real caller only reaches this after `@forge/engine/plan`'s own
 * `checkPlanConsistency` has already rejected that plan, P10, but this function is directly callable on
 * its own too), `byId`/`cost`/`predecessor` all key on that one shared id — whichever of the two duplicate
 * `StepNode` objects `nodes.map` happens to keep last in the `Map` constructor silently wins for every
 * purpose here. Not specially detected or rejected: this function's own job is computing a path over
 * whatever graph it is handed, not re-validating an invariant a different, already-run piece of this
 * pipeline owns. */
export function computeCriticalPath(nodes: readonly StepNode[]): CriticalPathResult {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const order = topologicalOrder(nodes);

  const cost = new Map<string, number>();
  const predecessor = new Map<string, string | undefined>();

  for (const id of order) {
    const node = byId.get(id);
    if (node === undefined) continue;
    let bestDepCost = 0;
    let bestDep: string | undefined;
    for (const dep of node.dependsOn) {
      const depCost = mapGetOr(cost, dep, 0);
      if (bestDep === undefined || depCost > bestDepCost) {
        bestDepCost = depCost;
        bestDep = dep;
      }
    }
    cost.set(id, bestDepCost + node.limits.maxCostUsd);
    predecessor.set(id, bestDep);
  }

  let bestId: string | undefined;
  let bestCost = 0;
  for (const [id, totalCost] of cost) {
    if (bestId === undefined || totalCost > bestCost) {
      bestId = id;
      bestCost = totalCost;
    }
  }
  if (bestId === undefined) return { path: [], estimatedCost: 0 };

  const path: string[] = [];
  for (let current: string | undefined = bestId; current !== undefined; current = predecessor.get(current)) {
    path.push(current);
  }
  path.reverse();

  return { path, estimatedCost: bestCost };
}
