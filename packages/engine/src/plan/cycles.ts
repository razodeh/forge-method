/**
 * `06` §6.2's own rule 5: "topologically sort; reject cycles with a rendered Mermaid graph showing the
 * cycle." Operates on a compiled `StepNode[]` and its own flat `dependsOn` edges — a genuinely different
 * graph shape from `@forge/engine/workflow`'s own `checkNoCycles` (which walks a *nested tree* of
 * `WorkflowStep`s, following structural containment, not explicit edges), so this is a new, analogous
 * implementation for this shape, not a duplicate of that one.
 *
 * @see specs/06 §6.2
 * @see PLAN-M5.md P11
 */
import { ForgeError } from '@forge/core/errors';

import type { CycleResult, StepNode } from './types.ts';

/** Confirmed empirically that this codebase's own recursive-DFS instinct (natural for cycle detection)
 * blows the real call stack past a few thousand levels of chained `dependsOn` — `@forge/engine/workflow`'s
 * own `MAX_TRAVERSAL_DEPTH` documents the identical empirical finding for its own, differently-shaped
 * walk. This walk is iterative with an explicit stack specifically to avoid that failure mode, not merely
 * to guard against it after the fact; `MAX_CYCLE_SEARCH_DEPTH` exists only as a second, defense-in-depth
 * bound against a caller-supplied `StepNode[]` engineered to be pathologically deep regardless (`06` §6.2's
 * own worked example chains 9 steps deep at most). */
const MAX_CYCLE_SEARCH_DEPTH = 5000;

/** `06` §6.2's own rule 5, via iterative DFS over `dependsOn` edges (never real recursion — the doc
 * comment above has the fuller reasoning). Returns the *first* cycle found, as a closed loop (`cycle[0]
 * === cycle[cycle.length - 1]`, matching `@forge/engine/workflow`'s own `checkNoCycles` convention for the
 * identical concept, reused here rather than inventing a second "is the loop implicitly closed" convention
 * the two cycle-detectors in this codebase would then disagree about) — not every cycle; a caller fixing
 * one and re-running discovers the next, the same incremental discovery every cycle-detection tool offers.
 *
 * Throws `ForgeError('RUN-035')` — deliberately, unlike `@forge/engine/plan`'s own `compilePlan`/
 * `expandFanout` (which never throw) — if the search depth guard fires: a lower-level utility, not the
 * pipeline's own outward-facing promise. `compileRunPlan` (`run-plan.ts`) is the piece that actually makes
 * the "never throws" promise for the full pipeline, and it catches this specifically, folding it into an
 * ordinary `CompileIssue` the same way `@forge/engine/expr`'s own `resolveTemplate` throws are caught and
 * converted at `@forge/engine/plan`'s own `safeResolveTemplate` boundary (`Q71`, `Q72`). */
export function detectCycles(nodes: readonly StepNode[]): CycleResult | undefined {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const state = new Map<string, 'visiting' | 'done'>();

  for (const root of nodes) {
    if (state.get(root.id) === 'done') continue;

    // `remainingDeps` is a mutable queue each frame `.shift()`s from, not an index counted against a
    // fixed, immutable array: `.shift()` returning `undefined` for "no more deps" and "give me the next
    // one" are the *same* check, so there is only ever one place asking "is there more to do here" for
    // this frame, not two (an index-bounds check plus a separate indexed-access check) — and unlike an
    // index into an unchanging array, an empty queue after every element has been shifted off is a real,
    // ordinarily-reached outcome of normal traversal, not a `noUncheckedIndexedAccess` artifact needing
    // its own unreachable-by-construction justification.
    const stack: { readonly id: string; readonly remainingDeps: string[] }[] = [];
    const push = (id: string): void => {
      state.set(id, 'visiting');
      stack.push({ id, remainingDeps: [...(byId.get(id)?.dependsOn ?? [])] });
    };
    push(root.id);

    while (stack.length > 0) {
      if (stack.length > MAX_CYCLE_SEARCH_DEPTH) {
        throw new ForgeError('RUN-035', { maxDepth: MAX_CYCLE_SEARCH_DEPTH });
      }
      const frame = stack[stack.length - 1];
      // Always defined: the `while` guard above already proves `stack.length > 0`. A
      // `noUncheckedIndexedAccess` artifact, the same "runtime guard over cast" choice made throughout
      // this codebase for the identical shape.
      if (frame === undefined) break;

      const dep = frame.remainingDeps.shift();
      if (dep === undefined) {
        state.set(frame.id, 'done');
        stack.pop();
        continue;
      }

      const depState = state.get(dep);
      if (depState === 'done') continue;
      if (depState === 'visiting') {
        // `depState === 'visiting'` is only ever set immediately before pushing a frame onto *this*
        // stack, and only ever cleared (to 'done') when that same frame is popped -- in a single-stack
        // iterative DFS, "currently visiting" and "currently on the active stack" are the same set by
        // construction, so `dep` is provably present here. Asserted rather than silently falling back to
        // a fabricated one-node "cycle" if that invariant were ever violated: a wrong cycle report here
        // would be the exact silently-wrong-output failure mode `@forge/engine/workflow`'s own
        // `checkNoCycles` was fixed for once already this milestone (`Q70`) — worth a real internal-
        // invariant check, not a `noUncheckedIndexedAccess`-style cast, given the stakes of getting it
        // wrong silently rather than loudly.
        const cycleStart = stack.findIndex((entry) => entry.id === dep);
        if (cycleStart === -1) {
          throw new Error(
            `Internal error: detectCycles lost track of "visiting" node "${dep}" on its own stack.`,
          );
        }
        return { cycle: [...stack.slice(cycleStart).map((entry) => entry.id), dep] };
      }
      push(dep);
    }
  }

  return undefined;
}

/** A compiled `StepNode.id` is not a valid bare Mermaid node reference on its own — it routinely contains
 * `:` (`06` §6.2's own `${workflowId}:${stepId}[:${itemKey}]` format), which happens to still parse, but a
 * verify round found that wrapping it in `JSON.stringify` (to handle the general case safely) produces a
 * bare quoted string as an edge endpoint, which Mermaid's own flowchart grammar rejects *unconditionally*
 * — confirmed directly against the real parser (`mermaid`, already vendored via `@forge/diagrams`): every
 * cycle this function ever rendered failed to parse, not merely ones with unusual characters in their own
 * ids. Fixed by giving each *distinct* real id its own synthetic, always-valid node reference (`n0`, `n1`,
 * ...) and carrying the real id as that node's own bracketed label instead (`n0["w:a:1"]`) — the form
 * Mermaid's own grammar actually accepts for arbitrary text, confirmed against the same real parser,
 * including for an id containing its own literal `"` or `[`/`]` characters (`escapeMermaidLabel`, below,
 * has the fuller reasoning for exactly how). The wrap-around element of
 * a closed `cycle` (`detectCycles`'s own convention: first and last ids equal) reuses the *same* synthetic
 * id as its own first occurrence, not a fresh one — the resulting graph is a genuine closed loop back to
 * one real node, the same closed shape `06` §6.2's own rule 5 asks this function to show, not two
 * different-looking nodes that merely share a label. */
export function renderCycleAsMermaid(cycle: readonly string[]): string {
  const syntheticId = new Map<string, string>();
  for (const id of cycle) {
    if (!syntheticId.has(id)) syntheticId.set(id, `n${String(syntheticId.size)}`);
  }
  // `syntheticId.get(id)` is always defined here: the loop just above populates one entry for every
  // distinct id in `cycle` before `render` is ever called, and `render` is only ever called with an id
  // from that same `cycle`. A `Map.get` artifact, the same "runtime guard over cast" choice made
  // throughout this codebase for the identical shape, rather than trusted with a bare `!`/`as` — `String`
  // rather than a fallback like `?? id` deliberately, so even the unreachable case stays a syntactically
  // harmless bare identifier ("undefined"), never the raw, potentially Mermaid-unsafe `id` this whole
  // function exists to keep out of a bare node-reference position.
  const render = (id: string): string =>
    `${String(syntheticId.get(id))}[${escapeMermaidLabel(id)}]`;
  const edges = cycle
    .slice(0, -1)
    .map((id, index) => `  ${render(id)} --> ${render(cycle[index + 1] ?? id)}`);
  return ['graph TD', ...edges].join('\n');
}

/** `JSON.stringify` alone (this function's own first version) is not enough: a verify round confirmed
 * against the real Mermaid parser that its own label lexer does *not* honor a backslash-escaped quote —
 * it terminates the label at the very first raw `"` byte it scans, backslash or no backslash, so
 * `JSON.stringify('a"b')` (`"a\"b"`) still breaks parsing exactly like an entirely-unescaped quote would.
 * Every other JSON escape (`\\`, `\n`, `\t`, ...) was independently confirmed to parse correctly, so only
 * `"` itself needs different handling: replaced with its HTML entity *before* JSON-encoding, so
 * `JSON.stringify` never has a literal `"` of its own left to escape into the one sequence Mermaid's
 * lexer cannot parse. Applied to the raw text first (not as a find-and-replace on the already-JSON-
 * encoded output) specifically to avoid having to reason about whether a replacement could ever
 * straddle or collide with an unrelated escape sequence `JSON.stringify` produced for some other
 * character next to it — confirmed empirically clean across quotes adjacent to backslashes, multiple
 * quotes, and quote-only strings. An empty `text` (structurally impossible for a real compiled `StepNode.
 * id`, which always contains at least one `:` from `06` §6.2's own id format, but this function is public
 * and independently callable) is also rejected by Mermaid's own label lexer (`[""]` fails to parse) —
 * substituted with a placeholder rather than left to fail. */
function escapeMermaidLabel(text: string): string {
  const label = text === '' ? '(empty)' : text.replaceAll('"', '&quot;');
  return JSON.stringify(label);
}
