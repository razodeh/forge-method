/**
 * `06` §6.3's own four-level ordering tiebreak among ready nodes: (1) unblocks the most downstream work,
 * (2) on the critical path, (3) lowest estimated cost, (4) stable tie-break by `seed` + node id.
 *
 * @see specs/06 §6.3
 * @see specs/21 §21.1, §21.3
 * @see PLAN-M5.md P12
 */
import { computeCriticalPath, safeCost, type StepNode } from '../plan/index.ts';

/** "Unblocks the most downstream work" (rule 1) — the size of a node's own *transitive* descendant set
 * (every node that depends on it, directly or through any chain), not just its immediate dependents:
 * finishing a node earlier only actually accelerates the rest of the plan in proportion to how much of the
 * plan sits behind it. Computed once per call over the reverse-dependency graph, a plain BFS per node
 * guarded by a `visited` set — safe (terminates, does not double-count) even against a cyclic `dependsOn`
 * graph a caller failed to reject with `detectCycles` first, the same "does not require its input to
 * already be known-good" tolerance `@forge/engine/plan`'s own `computeCriticalPath` already documents for
 * itself. O(n²) worst case, the same complexity class `buildClaimIntervalMap`'s own pairwise checks
 * already accept for a realistic plan size.
 *
 * The queue is a plain, growing array walked with `for...of`, not `while (queue.length > 0) { const id =
 * queue.shift(); ... }`: the same choice `@forge/engine/plan`'s own `topologicalOrder` already documents
 * for itself, for the identical reason — a `for...of` over an array re-reads `.length` on every step, so an
 * element pushed *during* iteration is still visited, without ever needing a `noUncheckedIndexedAccess`
 * -style `undefined` guard for a `.shift()` call this loop could otherwise prove, but not express to the
 * compiler, always succeeds while `queue.length > 0`. */
function transitiveDescendantCounts(nodes: readonly StepNode[]): ReadonlyMap<string, number> {
  const dependents = new Map<string, string[]>();
  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      const list = dependents.get(dep) ?? [];
      list.push(node.id);
      dependents.set(dep, list);
    }
  }

  const counts = new Map<string, number>();
  for (const node of nodes) {
    const visited = new Set<string>();
    const queue = [...(dependents.get(node.id) ?? [])];
    for (const id of queue) {
      if (visited.has(id)) continue;
      visited.add(id);
      queue.push(...(dependents.get(id) ?? []));
    }
    counts.set(node.id, visited.size);
  }
  return counts;
}

/** Rule 4's own "stable tie-break by `seed` + node id" — FNV-1a (32-bit), a small, well-known, and above
 * all *pure* string hash: no `Math.random`, no wall-clock, nothing but its own two string inputs, per this
 * whole milestone's own determinism mandate (`21` §21.1: "a flaky scheduler test means the scheduler is
 * non-deterministic, which is a bug in the scheduler") — the same seed and id combination always produces
 * the same number, in this process or a fresh one, forever. */
function seededHash(seed: string, id: string): number {
  const input = `${seed}:${id}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** `06` §6.3's own four-level tiebreak, applied in order — each rule only breaks a tie the rule before it
 * left standing. A fifth, unnamed level (plain lexicographic id comparison) sits beneath even rule 4: a
 * genuine `seededHash` collision between two different ids is astronomically unlikely for any realistic
 * plan size but not impossible, and `Array.prototype.sort`'s own comparator contract requires returning
 * `0` only for values the caller genuinely considers interchangeable — two *different* step ids never are,
 * so leaving a same-hash pair to resolve however the sort algorithm's own tie-handling happens to land
 * would itself be a small, avoidable non-determinism, undermining the exact guarantee rule 4 exists for. */
export function orderReadyNodes(
  ready: readonly StepNode[],
  nodes: readonly StepNode[],
  seed: string,
): readonly StepNode[] {
  const unblocks = transitiveDescendantCounts(nodes);
  const onCriticalPath = new Set(computeCriticalPath(nodes).path);

  return [...ready].sort((a, b) => {
    const unblockDiff = (unblocks.get(b.id) ?? 0) - (unblocks.get(a.id) ?? 0);
    if (unblockDiff !== 0) return unblockDiff;

    const aOnPath = onCriticalPath.has(a.id);
    const bOnPath = onCriticalPath.has(b.id);
    if (aOnPath !== bOnPath) return aOnPath ? -1 : 1;

    // A critic round found this comparing the two raw `.maxCostUsd` values directly, with no guard against
    // either being `NaN` -- unlike `@forge/engine/plan`'s own `computeCriticalPath`, which already learned
    // this exact lesson for the identical field and now exports `safeCost` specifically so both places
    // share one fix rather than needing two. Left unguarded, a single `NaN`-costed ready node would return
    // `NaN` from this comparator, which `Array.prototype.sort` has no defined behaviour for -- confirmed
    // directly through `Scheduler.next()` to actually invert the intended cheapest-first order, and to do
    // so differently depending purely on the `ready` array's own input order, a real determinism-mandate
    // violation (`21` §21.1).
    //
    // Compared with `<`/`>`, not subtracted (`safeCost(a) - safeCost(b)`), even though `safeCost` itself
    // already guards `NaN`: `safeCost` deliberately still lets `Infinity`/`-Infinity` through untouched
    // (`critical-path.ts`'s own doc comment has the fuller reasoning), and two same-signed infinite costs
    // subtracted from each other (`Infinity - Infinity`) is itself `NaN` -- the identical sort-breaking
    // failure this whole guard exists to prevent, just reachable through a rarer trigger (two ready nodes
    // both genuinely costed at `Infinity`) than the one the critic round actually found. Direct comparison
    // has no such trap: `Infinity < Infinity`/`Infinity > Infinity` are both simply `false`, correctly
    // falling through to rule 4 as a genuine tie rather than ever producing a NaN comparator result.
    const costA = safeCost(a);
    const costB = safeCost(b);
    if (costA !== costB) return costA < costB ? -1 : 1;

    const hashDiff = seededHash(seed, a.id) - seededHash(seed, b.id);
    if (hashDiff !== 0) return hashDiff;

    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
}
