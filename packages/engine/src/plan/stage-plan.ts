/**
 * The run plan for one stage (`03` §3.2.3 "produce the run plan DAG", `06` §6.2, `09` §9.3, `10` §10.2 P5).
 *
 * `06` §6.2 defines a run plan as a workflow compiled against project state: for a stage, the
 * implementation workflow (`build-stage`) fanned out over the stage's stories. `compileRunPlan` already does
 * that compilation (fanout expansion, contract-freeze dependencies, claim-overlap serialisation, cycle
 * rejection, critical path) but knows nothing about a *story's* own declared `depends_on`, and nothing built
 * the `stage.stories` collection it fans out over. This module is that missing layer, and it stays
 * deterministic (no clock, no randomness, no I/O: the caller reads the stories).
 *
 * Three things happen here, in this order:
 *
 * 1. **Story graph.** Declared dependencies, and (`06` §6.2 rule 3) an ordering for every pair of stories
 *    whose `files_expected` claims may overlap and that no dependency already orders, become waves: wave `n`
 *    is every story whose predecessors all sit in earlier waves. Unknown dependencies, self dependencies and
 *    cycles are reported as findings, never thrown: a contradiction in the inputs is something the caller
 *    must show, not a crash. The waves also fix the order the stories are fed to the workflow, because
 *    `applyClaimOverlaps` serialises overlapping steps in declaration order, and declaration order must never
 *    contradict a declared dependency (that would invent a cycle the inputs do not contain).
 * 2. **Workflow compile.** `compileRunPlan` over the workflow with `stage.stories` set to those stories
 *    (each `{id, owner_role, depends_on, files_expected, test_paths}`, the fields `build-stage` templates on).
 * 3. **Story dependencies onto steps.** For each ordering edge `B after A`, every step where B's work begins
 *    (a per-story step that depends on no other step of B) gains a `dependsOn` edge to every step where A's work
 *    ends (a per-story step no other step of A depends on), so B never starts before A has finished, whether or
 *    not either claims files. This stops at A's last *per-story* step: a stage-wide `merge` is one node that
 *    follows every story, and waiting for it would serialise the whole stage. It needs the workflow's
 *    per-story steps keyed by story id (`itemKey: '{{item.id}}'`); one that is not has no steps to order and is
 *    reported as `step-plan-unavailable`. The critical path is recomputed over the result.
 *
 * **The story-level plan (1) is the plan of record; the step-level one (2, 3) is best effort.** The shipped
 * `build-stage` compiles (`PLAN-M13.md` P13, Q211), so a real stage gets its step graph and critical path. A
 * project's own workflow that does not (a customised `build-stage` with an unresolvable reference, or one whose
 * per-story steps are not keyed by story id) is still reported, not fatal: a stage's stories are plannable
 * without it, and failing the plan for a defect that is not in the stories would be wrong. That case is a
 * `step-plan-unavailable` *warning* with the compiler's own messages, `stepPlan: 'unavailable'`, and no steps,
 * cost or step-level critical path (unknown, not zero).
 *
 * **Overlap is decided by static path prefix, not glob intersection.** `globsOverlap` (literal against
 * pattern, both ways) misses real overlaps (`src/auth` against `src/auth/login.ts`, `src/**\/*.ts` against
 * `src/billing/**`, brace sets) and returns `false` without a word for a glob it will not analyse. A false
 * "no overlap" puts two stories in the same wave to write the same files, so this asks a cheaper, sound
 * question instead: two claims may overlap unless their fixed leading path segments (everything before the
 * first segment containing a glob character) diverge. That is a superset of true intersection, so the plan
 * only ever serialises too much, never too little, and the story-level check never calls `minimatch` (no
 * adversarial-pattern cost; `compileRunPlan`'s own step-level claim check still does). It also over-flags a few disjoint pairs (`src/*.ts` against `src/a/b.ts`); the finding says "may". The rule itself lives in `claim-overlap.ts` (`claimsMayOverlap`) and is shared with `forge spec validate --rule file-claim-overlap` (`G-Ready`), so a pair of claims the gate reports is a pair the plan serialises. They still differ in which stories they compare (the gate every story that can still write, project-wide; the plan one stage) and in what they do with a hit, and the step-level check in `compileRunPlan` (and the scheduler) still uses `globsOverlap` (`PLAN-M13.md` P24, Q214).
 *
 * @see specs/03 §3.2.3
 * @see specs/06 §6.2
 * @see specs/09 §9.3
 * @see PLAN-M13.md P10
 */
import { resolveTemplate } from '../expr/index.ts';
import type { ExpressionContext } from '../expr/index.ts';
import type { Workflow } from '../workflow/index.ts';
import { claimFixedPrefix, prefixesNest } from './claim-overlap.ts';
import { computeCriticalPath } from './critical-path.ts';
import { detectCycles, renderCycleAsMermaid } from './cycles.ts';
import { compileRunPlan } from './run-plan.ts';
import type { ClaimOverlap, CriticalPathResult, StepNode } from './types.ts';

/** `{{stageId}}` (a workflow's declared run input) resolves at the top level of the expression context, the
 * same narrow extension the CLI's own plan/implement contexts declare. */
interface StageExpressionContext extends ExpressionContext {
  readonly stageId: string;
}

/** The roles that write a story's failing tests (`sdet`) and review it (`reviewer`), identified by name the way
 * `protectionReason` (`@forge/extensions`) identifies the protected `red`/`review` steps (`SPEC-QUESTIONS.md`
 * Q36: no workflow field marks a step's phase). `10` §10.6 "Enforced separations": the agent that writes a story's
 * tests never makes them pass, and the reviewer is never the implementer. The check (`separationFindings`) looks at
 * the compiled per-story steps: a story is refused when one of these roles would run two of its steps (its
 * implementation, taken from the story's own `owner_role`, and its tests or its review). It is the story-owner
 * half of the rule only; whether an implementer's file claim covers a test path is a different rule
 * (`checkTestImplementationSeparation`), not decided here. */
const SEPARATED_ROLES: ReadonlySet<string> = new Set(['sdet', 'reviewer']);

/** One story of the stage, in the structural shape the run plan needs (deliberately not the KB `Story`
 * type: the plan needs a few of its fields, and a hand-built value in a test says exactly which). */
export interface StageStory {
  readonly id: string;
  readonly ownerRole: string;
  readonly dependsOn: readonly string[];
  readonly blockedBy: readonly string[];
  /** `09` §9.3's ownership claim: the globs the story writes. */
  readonly filesExpected: readonly string[];
  /** The subset of the claim that is tests, for the workflow's own test-writing step. */
  readonly testPaths: readonly string[];
}

/** What the caller knows about a story that is *not* part of this stage's plan and that a stage story
 * depends on: `satisfied` (already delivered, so nothing to wait for) or `pending` (not delivered yet). An id
 * absent from the map is unknown to the project altogether. */
export type OutsideStageStatus = 'satisfied' | 'pending';

export interface StageRunPlanOptions {
  readonly outsideStage?: ReadonlyMap<string, OutsideStageStatus> | undefined;
}

export type StageFindingSeverity = 'error' | 'warning';

/** One thing wrong or noteworthy about the stage's inputs. `subjects` are story ids (or step ids for a
 * workflow-level finding), in a stable order, so a caller can group and a test can assert on them. */
export interface StageRunPlanFinding {
  readonly code: string;
  readonly severity: StageFindingSeverity;
  readonly message: string;
  readonly subjects: readonly string[];
}

export interface StoryOverlap {
  readonly storyA: string;
  readonly storyB: string;
  readonly globA: string;
  readonly globB: string;
  /** `already-ordered`: declared dependencies (or an earlier serialisation) already order them.
   * `serialised`: nothing did, so `storyA` (the lower id) runs first (`06` §6.2 rule 3). */
  readonly ordering: 'already-ordered' | 'serialised';
}

export interface StageRunPlan {
  readonly stageId: string;
  readonly workflowId: string;
  /** The stories planned, deduplicated by id and sorted by id. */
  readonly stories: readonly StageStory[];
  /** Story ids per wave: a wave's stories have no ordering between them; every story's predecessors are in
   * earlier waves. Empty when the story graph has a cycle (no order exists). */
  readonly waves: readonly (readonly string[])[];
  /** Overlapping claim pairs, at most `MAX_REPORTED_OVERLAPS` of them (sorted by story id);
   * `overlapCount` is the true total. */
  readonly storyOverlaps: readonly StoryOverlap[];
  readonly overlapCount: number;
  /** The longest chain of stories that must run one after another (declared dependencies plus serialised
   * overlaps), by story count, ties broken by lowest id. Empty when the story graph has a cycle. */
  readonly storyCriticalPath: readonly string[];
  /** Planned stories that cannot start yet: they are blocked (`blocked_by`), or depend on a story of another
   * stage that is not delivered. They keep their place in the waves so nothing that follows them moves. */
  readonly blocked: readonly string[];
  /** `compiled` when the workflow compiled and `nodes` is the step graph; `unavailable` otherwise (a
   * `step-plan-unavailable` warning says why, or a story cycle made a step graph meaningless). */
  readonly stepPlan: 'compiled' | 'unavailable';
  /** The compiled steps, with story dependencies applied. Empty when `stepPlan` is `unavailable`. */
  readonly nodes: readonly StepNode[];
  /** The critical path over `nodes` by declared step cost. Meaningful only when `stepPlan` is `compiled`. */
  readonly criticalPath: CriticalPathResult;
  /** Step-level claim overlaps in the compiled plan (`06` §6.7's interval map). */
  readonly stepOverlaps: readonly ClaimOverlap[];
  readonly findings: readonly StageRunPlanFinding[];
  /** True when no finding has `error` severity: the plan is safe to schedule from. */
  readonly ok: boolean;
}

/** A stage this large is not a stage anyone can plan in one sitting; the cap keeps a pathological stage's
 * output bounded rather than quadratic in the story count. */
export const MAX_REPORTED_OVERLAPS = 100;

/** Code-unit order, never `localeCompare`: the output must be identical on every machine and locale. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function finding(
  code: string,
  severity: StageFindingSeverity,
  message: string,
  subjects: readonly string[],
): StageRunPlanFinding {
  return { code, severity, message, subjects };
}

// --- overlap ------------------------------------------------------------------------------------

interface ClaimPrefixes {
  readonly pattern: string;
  readonly prefix: readonly string[];
}

function claimPrefixes(globs: readonly string[]): readonly ClaimPrefixes[] {
  return globs.map((pattern) => ({ pattern, prefix: claimFixedPrefix(pattern) }));
}

function firstOverlap(
  a: readonly ClaimPrefixes[],
  b: readonly ClaimPrefixes[],
): readonly [string, string] | undefined {
  for (const claimA of a) {
    for (const claimB of b) {
      if (prefixesNest(claimA.prefix, claimB.prefix)) return [claimA.pattern, claimB.pattern];
    }
  }
  return undefined;
}

// --- story graph --------------------------------------------------------------------------------

interface StoryGraph {
  readonly waves: readonly (readonly string[])[];
  readonly overlaps: readonly StoryOverlap[];
  readonly overlapCount: number;
  readonly findings: readonly StageRunPlanFinding[];
  readonly blocked: readonly string[];
  /** `id -> ids it must follow` (declared plus serialisation edges), for known, non-self dependencies. */
  readonly predecessors: ReadonlyMap<string, readonly string[]>;
  readonly hasCycle: boolean;
}

/** Whether `target` is reachable from `from` by following predecessor edges. Iterative: a stage with
 * thousands of chained stories must not blow the call stack. */
function reaches(
  edges: ReadonlyMap<string, ReadonlySet<string>>,
  from: string,
  target: string,
): boolean {
  const seen = new Set<string>();
  const stack = [from];
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    if (id === target) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of edges.get(id) ?? []) stack.push(next);
  }
  return false;
}

/** A cycle in the declared dependencies, as a loop with its first and last id equal (the convention
 * `detectCycles` uses), or `undefined`. A deterministic, iterative depth-first walk (ids and edges visited in
 * codepoint order), so it neither depends on iteration order nor overflows the stack on a long chain. */
function findStoryCycle(
  ids: readonly string[],
  predecessors: ReadonlyMap<string, ReadonlySet<string>>,
): readonly string[] | undefined {
  const done = new Set<string>();
  for (const root of ids) {
    if (done.has(root)) continue;
    const path: string[] = [];
    const onPath = new Set<string>();
    const pending: string[][] = [];
    const enter = (id: string): void => {
      path.push(id);
      onPath.add(id);
      pending.push([...(predecessors.get(id) ?? [])].sort(compareIds).reverse());
    };
    enter(root);
    while (pending.length > 0) {
      const frame = pending[pending.length - 1];
      const next = frame?.pop();
      if (next === undefined) {
        pending.pop();
        const finished = path.pop();
        if (finished !== undefined) {
          onPath.delete(finished);
          done.add(finished);
        }
        continue;
      }
      if (onPath.has(next)) return [...path.slice(path.indexOf(next)), next];
      if (!done.has(next)) enter(next);
    }
  }
  return undefined;
}

/** Kahn's algorithm by levels: linear in stories plus edges. Ids within a wave keep `ids` order. */
function buildWaves(
  ids: readonly string[],
  predecessors: ReadonlyMap<string, ReadonlySet<string>>,
): readonly (readonly string[])[] {
  const remaining = new Map<string, number>();
  const followers = new Map<string, string[]>();
  for (const id of ids) {
    const preds = predecessors.get(id) ?? new Set<string>();
    remaining.set(id, preds.size);
    for (const pred of preds) followers.set(pred, [...(followers.get(pred) ?? []), id]);
  }
  const waves: string[][] = [];
  let level = ids.filter((id) => remaining.get(id) === 0);
  while (level.length > 0) {
    waves.push(level);
    const next = new Set<string>();
    for (const id of level) {
      for (const follower of followers.get(id) ?? []) {
        const left = (remaining.get(follower) ?? 0) - 1;
        remaining.set(follower, left);
        if (left === 0) next.add(follower);
      }
    }
    level = ids.filter((id) => next.has(id));
  }
  return waves;
}

function analyseStoryGraph(
  stories: readonly StageStory[],
  outsideStage: ReadonlyMap<string, OutsideStageStatus>,
): StoryGraph {
  const findings: StageRunPlanFinding[] = [];
  const ids = stories.map((story) => story.id);
  const known = new Set(ids);
  const declared = new Map<string, Set<string>>();
  const blocked = new Set<string>();

  for (const story of stories) {
    const deps = new Set<string>();
    for (const dep of story.dependsOn) {
      if (dep === story.id) {
        findings.push(
          finding('self-dependency', 'error', `${story.id} lists itself in depends_on.`, [
            story.id,
          ]),
        );
      } else if (known.has(dep)) {
        deps.add(dep);
      } else {
        const outside = outsideStage.get(dep);
        if (outside === 'satisfied') continue;
        if (outside === 'pending') {
          blocked.add(story.id);
          findings.push(
            finding(
              'dependency-outside-stage',
              'warning',
              `${story.id} depends on ${dep}, which is not part of this plan and is not delivered yet (another stage's story, or one that could not be planned), so ${story.id} cannot start until it is.`,
              [story.id, dep],
            ),
          );
        } else {
          findings.push(
            finding(
              'unknown-dependency',
              'error',
              `${story.id} depends on ${dep}, which is not a story of this project.`,
              [story.id, dep],
            ),
          );
        }
      }
    }
    declared.set(story.id, deps);
    if (story.blockedBy.length > 0) {
      blocked.add(story.id);
      findings.push(
        finding(
          'story-blocked',
          'warning',
          `${story.id} is blocked by ${story.blockedBy.join(', ')} and cannot start until that is resolved (it keeps its place in the plan).`,
          [story.id],
        ),
      );
    }
    if (story.filesExpected.length === 0) {
      findings.push(
        finding(
          'story-without-file-claims',
          'warning',
          `${story.id} declares no files_expected, so the plan cannot tell whether it conflicts with another story.`,
          [story.id],
        ),
      );
    }
  }

  // Cycle in the declared dependencies: no order exists, so nothing further can be computed honestly.
  const declaredCycle = findStoryCycle(ids, declared);
  if (declaredCycle !== undefined) {
    findings.push(
      finding(
        'dependency-cycle',
        'error',
        `A dependency cycle was found among the stage's stories: ${declaredCycle.join(' -> ')}.\n\n${renderCycleAsMermaid(declaredCycle)}`,
        [...new Set(declaredCycle)].sort(compareIds),
      ),
    );
    return {
      waves: [],
      overlaps: [],
      overlapCount: 0,
      findings,
      blocked: [...blocked].sort(compareIds),
      predecessors: new Map([...declared].map(([id, set]) => [id, [...set].sort(compareIds)])),
      hasCycle: true,
    };
  }

  // `06` §6.2 rule 3: overlapping claims are serialised, the lower id first. Each story is compared with the
  // earlier ones from the nearest down, and an ordering edge is added only when no path already orders the
  // pair either way: so an added edge can never close a cycle, and a run of mutually overlapping stories
  // becomes a chain (one edge each) rather than every pair.
  const edges = new Map<string, Set<string>>(
    [...declared].map(([id, deps]) => [id, new Set(deps)] as const),
  );
  const claims = new Map(stories.map((story) => [story.id, claimPrefixes(story.filesExpected)]));
  const overlaps: StoryOverlap[] = [];
  let overlapCount = 0;
  for (const [index, later] of stories.entries()) {
    for (let earlierIndex = index - 1; earlierIndex >= 0; earlierIndex -= 1) {
      const earlier = stories[earlierIndex];
      if (earlier === undefined) continue;
      const hit = firstOverlap(claims.get(earlier.id) ?? [], claims.get(later.id) ?? []);
      if (hit === undefined) continue;
      const alreadyOrdered =
        reaches(edges, later.id, earlier.id) || reaches(edges, earlier.id, later.id);
      if (!alreadyOrdered) edges.get(later.id)?.add(earlier.id);
      overlapCount += 1;
      if (overlaps.length < MAX_REPORTED_OVERLAPS) {
        overlaps.push({
          storyA: earlier.id,
          storyB: later.id,
          globA: hit[0],
          globB: hit[1],
          ordering: alreadyOrdered ? 'already-ordered' : 'serialised',
        });
      }
    }
  }
  overlaps.sort((x, y) => compareIds(x.storyA, y.storyA) || compareIds(x.storyB, y.storyB));
  for (const overlap of overlaps) {
    findings.push(
      finding(
        'file-claim-overlap',
        'warning',
        `${overlap.storyA} ("${overlap.globA}") and ${overlap.storyB} ("${overlap.globB}") may claim overlapping files; ` +
          (overlap.ordering === 'already-ordered'
            ? 'dependencies already order them.'
            : `they are serialised, ${overlap.storyA} first, not run in parallel.`),
        [overlap.storyA, overlap.storyB],
      ),
    );
  }
  if (overlapCount > overlaps.length) {
    findings.push(
      finding(
        'file-claim-overlap-truncated',
        'warning',
        `${String(overlapCount)} pairs of stories may claim overlapping files; only the first ${String(overlaps.length)} are listed. Every one is ordered in the plan.`,
        [],
      ),
    );
  }

  const waves = buildWaves(ids, edges);
  const predecessors = new Map([...edges].map(([id, set]) => [id, [...set].sort(compareIds)]));
  return {
    waves,
    overlaps,
    overlapCount,
    findings,
    blocked: [...blocked].sort(compareIds),
    predecessors,
    hasCycle: false,
  };
}

/** Longest chain by story count over `predecessors`; every tie goes to the lowest id, so it is stable. */
function longestStoryChain(
  waves: readonly (readonly string[])[],
  predecessors: ReadonlyMap<string, readonly string[]>,
): readonly string[] {
  const length = new Map<string, number>();
  const via = new Map<string, string>();
  let best: string | undefined;
  for (const id of waves.flat()) {
    let bestPred: string | undefined;
    for (const pred of predecessors.get(id) ?? []) {
      const predLength = length.get(pred) ?? 0;
      const bestPredLength = bestPred === undefined ? 0 : (length.get(bestPred) ?? 0);
      if (
        bestPred === undefined ||
        predLength > bestPredLength ||
        (predLength === bestPredLength && compareIds(pred, bestPred) < 0)
      ) {
        bestPred = pred;
      }
    }
    const thisLength = (bestPred === undefined ? 0 : (length.get(bestPred) ?? 0)) + 1;
    length.set(id, thisLength);
    if (bestPred !== undefined) via.set(id, bestPred);
    const bestLength = best === undefined ? 0 : (length.get(best) ?? 0);
    if (
      best === undefined ||
      thisLength > bestLength ||
      (thisLength === bestLength && compareIds(id, best) < 0)
    ) {
      best = id;
    }
  }
  const path: string[] = [];
  for (let id = best; id !== undefined; id = via.get(id)) path.unshift(id);
  return path;
}

function storyItem(story: StageStory): Readonly<Record<string, unknown>> {
  return {
    id: story.id,
    owner_role: story.ownerRole,
    depends_on: [...story.dependsOn],
    files_expected: [...story.filesExpected],
    test_paths: [...story.testPaths],
  };
}

/** A story's own steps: the compiled nodes whose id is `${workflowId}:${step}:${storyId}`, i.e. a fanout over
 * `stage.stories` with `itemKey: '{{item.id}}'`. Its *heads* are the ones that depend on no other step of the
 * same story (where the story's work begins), its *terminals* the ones no other step of the story depends on
 * (where its work ends). A workflow that keys per-story steps some other way (no `itemKey`, a prefixed key)
 * has no such nodes, and its stories cannot be ordered: the caller says so instead of pretending. */
interface StoryChain {
  readonly heads: readonly StepNode[];
  readonly terminals: readonly StepNode[];
  /** Every step of the story, in plan order. */
  readonly all: readonly StepNode[];
}

function storyChains(
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
function applyStoryDependencies(
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

/** `10` §10.6 "Enforced separations" (see `SEPARATED_ROLES`), from what the workflow actually compiled to: the
 * implementing agent is a template over the story's own `owner_role`, so only the plan can see it. A story is
 * refused when its owner role is a protected one and two of its own agent steps would run under that role. */
function separationFindings(
  stories: readonly StageStory[],
  chains: ReadonlyMap<string, StoryChain>,
  workflowId: string,
): readonly StageRunPlanFinding[] {
  const found: StageRunPlanFinding[] = [];
  for (const story of stories) {
    const role = story.ownerRole.trim().toLowerCase();
    if (!SEPARATED_ROLES.has(role)) continue;
    const running = (chains.get(story.id)?.all ?? []).filter(
      (node) => node.kind === 'agent' && String(node.agent).trim().toLowerCase() === role,
    );
    if (running.length < 2) continue;
    found.push(
      finding(
        'owner-role-breaks-separation',
        'error',
        `Story ${story.id} is owned by "${story.ownerRole}", so the ${workflowId} workflow would run ` +
          `${running.map((node) => node.id).join(' and ')} under that one role: the agent that ` +
          `${role === 'sdet' ? 'writes the failing tests' : 'reviews the work'} would also implement it ` +
          '(10 §10.6 enforced separations). Give the story an implementing owner_role.',
        [story.id],
      ),
    );
  }
  return found;
}

/** Sorts by id, and by content among equal ids, so which of two same-id stories is planned never depends on
 * the order the caller supplied them in. */
function compareStories(a: StageStory, b: StageStory): number {
  return compareIds(a.id, b.id) || compareIds(JSON.stringify(a), JSON.stringify(b));
}

/**
 * Compiles the run plan for one stage. Never throws for bad inputs: an unresolvable workflow, a cycle, an
 * unknown dependency all come back as findings (`error` ones set `ok: false`).
 */
export function compileStageRunPlan(
  workflow: Workflow,
  stageId: string,
  stories: readonly StageStory[],
  options: StageRunPlanOptions = {},
): StageRunPlan {
  const findings: StageRunPlanFinding[] = [];
  const unique: StageStory[] = [];
  const seen = new Set<string>();
  for (const story of [...stories].sort(compareStories)) {
    if (seen.has(story.id)) {
      findings.push(
        finding(
          'duplicate-story-id',
          'error',
          `Story id ${story.id} appears more than once; only one copy is planned.`,
          [story.id],
        ),
      );
      continue;
    }
    seen.add(story.id);
    unique.push(story);
  }

  const graph = analyseStoryGraph(unique, options.outsideStage ?? new Map());
  findings.push(...graph.findings);

  // The order stories are declared to the workflow: wave by wave (ids ascending within a wave), so the
  // engine's declaration-order serialisation agrees with the declared dependencies.
  const byId = new Map(unique.map((story) => [story.id, story]));
  const ordered = graph.hasCycle
    ? unique
    : graph.waves.flat().flatMap((id) => {
        const story = byId.get(id);
        return story === undefined ? [] : [story];
      });

  let nodes: readonly StepNode[] = [];
  let criticalPath: CriticalPathResult = { path: [], estimatedCost: 0 };
  let stepOverlaps: readonly ClaimOverlap[] = [];
  let stepPlan: 'compiled' | 'unavailable' = 'unavailable';

  // With a cycle no step order exists either; the cycle finding already says so.
  if (!graph.hasCycle) {
    // The workflow's own `vars:` (`build-stage`'s `integration_branch`) are templates over the run inputs.
    const varsContext: StageExpressionContext = { stageId };
    const vars: Record<string, string> = {};
    for (const [name, template] of Object.entries(workflow.vars ?? {})) {
      try {
        vars[name] = resolveTemplate(template, varsContext);
      } catch {
        // Left unset: any step that reads it reports the unresolved placeholder itself, with its own step id.
      }
    }
    const context: StageExpressionContext = {
      stageId,
      vars,
      stage: { stories: ordered.map(storyItem) },
    };

    const compiled = compileRunPlan(workflow, context);
    if (!compiled.success) {
      findings.push(
        finding(
          'step-plan-unavailable',
          'warning',
          `The ${workflow.id} workflow did not compile to steps, so this plan has no step-level graph, ` +
            `critical path or cost estimate (unknown, not zero); the story-level plan is unaffected: ` +
            compiled.issues.map((issue) => `${issue.code}: ${issue.message}`).join(' | '),
          [
            ...new Set(
              compiled.issues.flatMap((issue) =>
                issue.stepId === undefined ? [] : [issue.stepId],
              ),
            ),
          ],
        ),
      );
    } else {
      const chains = storyChains(
        compiled.nodes,
        workflow.id,
        new Set(unique.map((story) => story.id)),
      );
      const unmapped = unique.filter((story) => !chains.has(story.id)).map((story) => story.id);
      if (unmapped.length > 0) {
        findings.push(
          finding(
            'step-plan-unavailable',
            'warning',
            `The ${workflow.id} workflow compiled, but it has no steps keyed by story id for ` +
              `${unmapped.join(', ')} (a fanout over stage.stories needs itemKey: '{{item.id}}'), so stories ` +
              'cannot be ordered on its steps; there is no step-level graph, critical path or cost estimate ' +
              '(unknown, not zero). The story-level plan is unaffected.',
            unmapped,
          ),
        );
      } else {
        findings.push(...separationFindings(unique, chains, workflow.id));
        const withStories = applyStoryDependencies(compiled.nodes, chains, graph.predecessors);
        const cycle = detectCycles(withStories);
        if (cycle !== undefined) {
          findings.push(
            finding(
              'plan-dependency-cycle',
              'error',
              `A dependency cycle was found in the compiled plan: ${cycle.cycle.join(' -> ')}.\n\n${renderCycleAsMermaid(cycle.cycle)}`,
              [...new Set(cycle.cycle)].sort(compareIds),
            ),
          );
        } else {
          nodes = withStories;
          criticalPath = computeCriticalPath(nodes);
          stepOverlaps = compiled.claims.overlaps;
          stepPlan = 'compiled';
        }
      }
    }
  }

  return {
    stageId,
    workflowId: workflow.id,
    stories: unique,
    waves: graph.waves,
    storyOverlaps: graph.overlaps,
    overlapCount: graph.overlapCount,
    blocked: graph.blocked,
    storyCriticalPath: graph.hasCycle ? [] : longestStoryChain(graph.waves, graph.predecessors),
    stepPlan,
    nodes,
    criticalPath,
    stepOverlaps,
    findings,
    ok: !findings.some((f) => f.severity === 'error'),
  };
}
