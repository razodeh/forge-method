/**
 * Story ordering on the compiled steps: a story's own steps are those a fanout over `stage.stories` produced for
 * it (`${workflowId}:${step}:${storyId}`), and "B depends on A" becomes an edge from every step where B's work
 * begins to every step where A's ends (`09` §9.3 `depends_on`, `06` §6.2).
 *
 * Shared by the stage run plan (`compileStageRunPlan`, which also serialises overlapping claims) and by
 * `compileRunPlan` itself (`PLAN-M13.md` P21), so a `forge run build-stage --stage X` orders dependent stories
 * exactly as the plan it was shown does: before, the run compiled the stories' steps with no edge between a story
 * and the one it depends on unless their file claims happened to overlap.
 *
 * @see specs/06 §6.2
 * @see specs/09 §9.3
 */
import type { ExpressionContext } from '../expr/index.ts';
import type { StepNode } from './types.ts';

/** A story's own steps: the compiled nodes whose id is `${workflowId}:${step}:${storyId}`, i.e. a fanout over
 * `stage.stories` with `itemKey: '{{item.id}}'`. Its *heads* are the ones that depend on no other step of the
 * same story (where the story's work begins), its *terminals* the ones no other step of the story depends on
 * (where its work ends). A workflow that keys per-story steps some other way (no `itemKey`, a prefixed key)
 * has no such nodes, and its stories cannot be ordered: the caller says so instead of pretending. */
export interface StoryChain {
  readonly heads: readonly StepNode[];
  readonly terminals: readonly StepNode[];
  /** Every step of the story, in plan order. */
  readonly all: readonly StepNode[];
}

export function storyChains(
  nodes: readonly StepNode[],
  workflowId: string,
  storyIds: ReadonlySet<string>,
): ReadonlyMap<string, StoryChain> {
  const prefix = `${workflowId}:`;
  const owned = new Map<string, StepNode[]>();
  for (const node of nodes) {
    if (!node.id.startsWith(prefix)) continue;
    const rest = node.id.slice(prefix.length);
    const at = rest.indexOf(':');
    if (at === -1) continue;
    const story = rest.slice(at + 1);
    if (storyIds.has(story)) owned.set(story, [...(owned.get(story) ?? []), node]);
  }
  const chains = new Map<string, StoryChain>();
  for (const [story, own] of owned) {
    const ids = new Set(own.map((node) => node.id));
    const dependedOn = new Set(own.flatMap((node) => node.dependsOn.filter((dep) => ids.has(dep))));
    chains.set(story, {
      all: own,
      heads: own.filter((node) => !node.dependsOn.some((dep) => ids.has(dep))),
      terminals: own.filter((node) => !dependedOn.has(node.id)),
    });
  }
  return chains;
}

/** Adds `B after A` to the plan: every head step of B depends on every terminal step of A, so B's work does
 * not start until A's has ended, whatever the steps in between are (and whether or not either story claims
 * files). It stops at A's last *per-story* step: a stage-wide `merge` step is a single node that follows every
 * story, so waiting for it would serialise the whole stage. */
export function applyStoryDependencies(
  nodes: readonly StepNode[],
  chains: ReadonlyMap<string, StoryChain>,
  predecessors: ReadonlyMap<string, readonly string[]>,
): readonly StepNode[] {
  const added = new Map<string, string[]>();
  for (const [story, chain] of chains) {
    for (const predecessor of predecessors.get(story) ?? []) {
      const terminals = chains.get(predecessor)?.terminals ?? [];
      for (const head of chain.heads) {
        added.set(head.id, [
          ...(added.get(head.id) ?? []),
          ...terminals.map((terminal) => terminal.id),
        ]);
      }
    }
  }
  return nodes.map((node) => {
    const extra = (added.get(node.id) ?? []).filter((id) => !node.dependsOn.includes(id));
    return extra.length === 0
      ? node
      : { ...node, dependsOn: [...node.dependsOn, ...new Set(extra)] };
  });
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * The story ordering of `context.stage.stories` (each `{id, runs_after}` or, without it, `{id, depends_on}`) applied to `nodes`. A
 * dependency on an id that is not in the collection is ignored (a story of another stage, or one already
 * delivered: the caller that built the collection has already decided those). Returns `nodes` itself when the
 * context carries no stage stories or none declares a dependency, so a workflow that never fans out over
 * `stage.stories` compiles exactly as before.
 */
export function applyDeclaredStoryOrder(
  nodes: readonly StepNode[],
  workflowId: string,
  context: ExpressionContext,
): readonly StepNode[] {
  const stage = context.stage;
  if (typeof stage !== 'object' || stage === null || !('stories' in stage)) return nodes;
  const stories: unknown = stage.stories;
  if (!Array.isArray(stories)) return nodes;
  const ids = new Set<string>();
  const declared = new Map<string, readonly string[]>();
  for (const story of stories as readonly unknown[]) {
    if (typeof story !== 'object' || story === null || !('id' in story)) continue;
    if (typeof story.id !== 'string') continue;
    ids.add(story.id);
    // `runs_after` is the plan's full ordering (declared dependencies plus serialised claim overlaps); a
    // context that carries only `depends_on` (a hand-built stage) is ordered by that.
    declared.set(
      story.id,
      'runs_after' in story && Array.isArray(story.runs_after)
        ? stringArray(story.runs_after)
        : 'depends_on' in story
          ? stringArray(story.depends_on)
          : [],
    );
  }
  const predecessors = new Map<string, readonly string[]>();
  for (const [id, deps] of declared) {
    const inside = deps.filter((dep) => dep !== id && ids.has(dep));
    if (inside.length > 0) predecessors.set(id, inside);
  }
  if (predecessors.size === 0) return nodes;
  return applyStoryDependencies(nodes, storyChains(nodes, workflowId, ids), predecessors);
}
