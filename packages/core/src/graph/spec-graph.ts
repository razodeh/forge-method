/**
 * `SpecGraph` — `09` §9.4's typed traceability graph, built once from a project's artifacts and
 * queried by the gates that need it.
 *
 * @see specs/09 §9.4
 * @see PLAN-M1.md P14
 */
import type { ArtifactDocument } from '../artifacts/document.ts';
import { type GraphData, buildGraphData } from './build.ts';
import { compareStrings } from './compare.ts';
import type { Cycle, GraphEdge, GraphNode, GraphViolation, Orphan } from './types.ts';

export class SpecGraph {
  private readonly data: GraphData;

  private constructor(data: GraphData) {
    this.data = data;
  }

  /**
   * Builds the graph from `docs`. Deterministic regardless of `docs`' order (`QUALITY-BAR.md` R10):
   * every accessor below sorts its own output rather than trusting insertion order.
   */
  static build(docs: readonly ArtifactDocument[]): SpecGraph {
    return new SpecGraph(buildGraphData(docs));
  }

  nodes(): readonly GraphNode[] {
    return this.data.nodes;
  }

  edges(): readonly GraphEdge[] {
    return this.data.edges;
  }

  /**
   * The nodes `id` points to — its typed-edge targets (its parents, in every `09` §9.4 row).
   *
   * No sort: every row in `REQUIRED_EDGES` names a distinct `from` type, so a node has at most one
   * outgoing typed edge and this can never return more than one result — unlike `childrenOf`, which
   * genuinely needs its own sort since many nodes commonly share one parent.
   */
  parentsOf(id: string): readonly GraphNode[] {
    const nodeIndex = new Map(this.data.nodes.map((node) => [node.id, node] as const));
    return this.data.edges
      .filter((edge) => edge.from === id)
      .map((edge) => nodeIndex.get(edge.to))
      .filter((node): node is GraphNode => node !== undefined);
  }

  /** The nodes that point to `id` — its typed-edge sources (its children). */
  childrenOf(id: string): readonly GraphNode[] {
    const nodeIndex = new Map(this.data.nodes.map((node) => [node.id, node] as const));
    return this.data.edges
      .filter((edge) => edge.to === id)
      .map((edge) => nodeIndex.get(edge.from))
      .filter((node): node is GraphNode => node !== undefined)
      .sort((a, b) => compareStrings(a.kind, b.kind) || compareStrings(a.id, b.id));
  }

  /** `09` §9.4's matrix line: `Orphans: 0 stories · 1 test (TEST-198 proves no AC)`. */
  orphans(): readonly Orphan[] {
    return this.data.orphans;
  }

  /** Every required-edge violation, as `SPEC-` `ForgeError`s with the offending ids in `details`. */
  missingRequiredEdges(): readonly GraphViolation[] {
    return this.data.violations;
  }

  /**
   * Every `Story.depends_on` cycle, via DFS over the depends-on graph — not one of `09` §9.4's typed
   * edges (`EdgeKind` has no `dependsOn` member), and required separately by M5's plan compilation,
   * which "rejects cycles with a rendered graph."
   */
  detectCycles(): readonly Cycle[] {
    const state = new Map<string, 'visiting' | 'done'>();
    const stack: string[] = [];
    const cycles: Cycle[] = [];

    const visit = (storyId: string): void => {
      state.set(storyId, 'visiting');
      stack.push(storyId);
      for (const nextId of this.data.dependsOn.get(storyId) ?? []) {
        const nextState = state.get(nextId);
        if (nextState === 'visiting') {
          const start = stack.indexOf(nextId);
          cycles.push({ path: [...stack.slice(start), nextId] });
        } else if (nextState !== 'done') {
          visit(nextId);
        }
      }
      stack.pop();
      state.set(storyId, 'done');
    };

    for (const storyId of [...this.data.dependsOn.keys()].sort(compareStrings)) {
      if (!state.has(storyId)) visit(storyId);
    }
    return cycles;
  }

  /** Renders a cycle as `STORY-A → STORY-B → STORY-A`. */
  renderCycle(cycle: Cycle): string {
    return cycle.path.join(' → ');
  }
}
