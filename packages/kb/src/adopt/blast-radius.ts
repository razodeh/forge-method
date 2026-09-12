/**
 * `computeBlastRadius`/`expandTestScope` — `17` §17.4 point 2: "any story touching a component
 * computes its dependents from the module graph and includes them in the test scope. This is the
 * brownfield equivalent of contract-freeze."
 *
 * Operates directly on P15's own `DependencyGraph` (`inventory.ts`): a real, already-computed,
 * forward-edge (`imports`) module graph from a target repository's own INVENTORY phase — never a
 * fresh scan of its own, and never LLM-derived (there is no CARTOGRAPHY/INFERENCE dependency here at
 * all, deliberately: a dependency edge is a structural fact INVENTORY already established, not a
 * claim that needs evidence or confirmation).
 *
 * **Scope note, disclosed rather than left for a future reader to discover by grepping for a caller.**
 * This module computes the real, transitive reverse-dependency set for one or more touched modules —
 * the actual "blast radius" fact — and nothing calls it yet: confirmed directly, immediately before
 * this piece's own commit, via `grep -rn "computeBlastRadius\|expandTestScope" packages` outside this
 * file and its own tests, which returns nothing. Automatically attaching that fact to a live story's
 * own compiled test scope at execution time would need a "component/module -> test file" association
 * this codebase has no mechanism for anywhere yet (confirmed directly: no `testScope`/`TestScope` type
 * exists anywhere under `packages/engine/src`) — building one is a separate, cross-cutting scheduler
 * feature (a real per-story compiled-test-file mapping, wired into `@forge/engine`'s own plan/scheduler
 * types), not a ~400-line piece's own scope. A future caller with a real module-to-test mapping can
 * call `expandTestScope` and fold its `testScope` result into whatever it already builds; this piece's
 * own job ends at making that real fact computable, correct, and tested — matching the identical
 * "produces a structured fact for a later phase to consume, does not itself wire the consumer" shape
 * `SPEC-QUESTIONS.md` Q159/Q167 already establish for CARTOGRAPHY/INFERENCE dispatch and the
 * actionable-gap-to-artifact boundary.
 *
 * @see specs/17 §17.4
 * @see PLAN-M10.md P20
 */
import type { DependencyGraph } from './inventory.ts';

/** Plain code-unit-order comparison, never `localeCompare` (`QUALITY-BAR.md` R10) — mirrors
 * `inventory.ts`'s own identical helper; not shared, for the same reason that file's own
 * `requiredGroup`/`isDotEnvFile` are not shared with `survey.ts`'s identical copies. */
function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export interface BlastRadiusResult {
  /** The touched module(s) themselves, as given — deduplicated and sorted, never re-derived. */
  readonly touched: readonly string[];
  /** Every module that transitively depends on any touched module, directly or indirectly — never
   * includes a touched module itself, even if two touched modules depend on each other. Sorted. */
  readonly dependents: readonly string[];
}

/** Builds the reverse-edge index once (`imported module -> the modules that import it`) so a
 * multi-module blast-radius query walks it in `O(nodes + edges)` rather than re-scanning `graph.nodes`
 * once per BFS/DFS step. */
function buildDependentsIndex(graph: DependencyGraph): ReadonlyMap<string, readonly string[]> {
  const index = new Map<string, string[]>();
  for (const node of graph.nodes) {
    for (const imported of node.imports) {
      const existing = index.get(imported);
      if (existing) existing.push(node.module);
      else index.set(imported, [node.module]);
    }
  }
  return index;
}

/**
 * The real, transitive reverse-dependency closure of `touchedModules` against `graph` — every module
 * that would need re-verifying if any touched module's own behaviour changed. A module absent from
 * `graph.nodes` entirely (never observed importing anything, or outside the JS/TS scope `inventory.ts`
 * itself already discloses) simply has no dependents recorded against it, which this function reports
 * honestly as zero dependents rather than treating as an error — the same "absent means no signal
 * recorded, not a fabricated one" stance `17` §17.1 asks of every phase in this pipeline.
 *
 * Cycle-safe: a module that is its own transitive dependent (`inventory.ts`'s own `cycles` list) is
 * visited at most once via the `visited` set seeded with `touchedModules` themselves, so a cyclic
 * graph terminates and never reports a touched module back as one of its own dependents.
 *
 * Iterative (an explicit work queue, not recursion): a real monorepo's own import chain can run far
 * deeper than V8's default call-stack budget — a gauntlet critic round found the first version of this
 * function used a recursive `visit()` with no depth bound at all, safe only against the small fixture
 * graphs its own tests happened to use, not against a real, deep `DependencyGraph` this function must
 * actually handle. `blast-radius.test.ts`'s own "a real, deep chain" test pins this against a
 * chain long enough to overflow the old recursive version's own stack.
 */
export function computeBlastRadius(
  graph: DependencyGraph,
  touchedModules: readonly string[],
): BlastRadiusResult {
  const dependentsOf = buildDependentsIndex(graph);
  const visited = new Set<string>(touchedModules);
  const dependents: string[] = [];
  const queue: string[] = [...touchedModules];

  let head = 0;
  while (head < queue.length) {
    const moduleName = queue[head];
    head += 1;
    if (moduleName === undefined) continue;
    for (const dependent of dependentsOf.get(moduleName) ?? []) {
      if (visited.has(dependent)) continue;
      visited.add(dependent);
      dependents.push(dependent);
      queue.push(dependent);
    }
  }

  return {
    touched: [...new Set(touchedModules)].sort(compareStrings),
    dependents: dependents.sort(compareStrings),
  };
}

export interface TestScopeExpansion extends BlastRadiusResult {
  /** `touched` plus `dependents`, deduplicated and sorted — the real, expanded test scope `17` §17.4
   * point 2 describes: "includes them in the test scope." */
  readonly testScope: readonly string[];
}

/** `computeBlastRadius` plus the one further step `17` §17.4 point 2 actually asks for: folding the
 * touched module(s) and their real dependents into one test-scope list. */
export function expandTestScope(
  graph: DependencyGraph,
  touchedModules: readonly string[],
): TestScopeExpansion {
  const radius = computeBlastRadius(graph, touchedModules);
  return {
    ...radius,
    testScope: [...radius.touched, ...radius.dependents].sort(compareStrings),
  };
}
