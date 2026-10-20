/**
 * `forge spec <list|show|validate|trace|matrix|orphans|new>` — `03` §3.2.2.
 *
 * @see specs/03 §3.2.2
 */
import {
  ArtifactDocument,
  readArtifact,
  validateArtifact,
  writeArtifact,
} from '@forge/core/artifacts';
import { SpecGraph, type GraphNode, type GraphViolation, type Orphan } from '@forge/core/graph';
import { SYSTEM_CLOCK, ForgeError, type Clock } from '@forge/core';
import type { ProjectPaths } from '@forge/core/fs';
import { parseKbTree } from '@forge/kb/schema';
import { renderArtifactPath } from '@forge/schemas/registry';
import type { ArtifactTypeId } from '@forge/schemas';

import { ownerRoleProblem, readImplementationRoles } from './implementation-roles.ts';
import { getSharedIdAllocator, listSpecArtifacts, readArtifactTemplate } from './shared.ts';

export interface SpecCommandContext {
  readonly paths: ProjectPaths;
  readonly specsRoot: string;
  readonly kbRoot: string;
  // Optional, defaulted inside `validate-rules.ts` rather than here: only the `open-sev1-sev2-defects`/
  // `unresolved-rca`/`definition-of-ready` rule checks need either root, and every existing caller of
  // this context (every command in this file) predates them — making these required would break every
  // one of those callers for a need only `spec/validate-rules.ts` has.
  readonly reportsRoot?: string;
  readonly sessionsRoot?: string;
  readonly clock?: Clock;
  /** Project-relative directory of materialised agents (`.forge/agents`). When present, `validate` and the
   * `definition-of-ready` rule refuse a Story whose `owner_role` is not an implementation role (`PLAN-M13.md` P36);
   * absent (or a project with no agents), owners are not judged. */
  readonly agentsRoot?: string;
}

/** Every real document `forge spec trace/matrix/orphans` needs `SpecGraph` built from — `docs/forge/
 * specs/**`'s own documents plus `docs/forge/kb/decisions/**`'s ADRs, since `09` §9.4's own edge
 * table includes ADR nodes and this package has no way to build a graph missing them. Exported for
 * `spec/validate-rules.ts`'s own `definition-of-ready`/`unbound-acceptance-criteria` rules, which need
 * the identical real graph, not a second construction of it. */
export async function loadGraphDocs(ctx: SpecCommandContext): Promise<readonly ArtifactDocument[]> {
  const specDocs = await listSpecArtifacts(ctx.paths, ctx.specsRoot);
  const tree = await parseKbTree(ctx.paths, ctx.kbRoot);
  // `KbParsedEntry.path` is relative to `kbRoot` (`parseKbTree`'s own convention), while
  // `readArtifact` resolves relative to the project root — the same prefix `adr.ts`'s own
  // `findAdrPath` needs, for the identical reason.
  const adrPaths = tree.entries
    .filter((entry) => entry.kind === 'adr')
    .map((entry) => `${ctx.kbRoot}/${entry.path}`);
  const adrDocs = await Promise.all(adrPaths.map((path) => readArtifact(ctx.paths, path)));
  return [...specDocs, ...adrDocs];
}

export interface SpecSummary {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly path: string;
}

function summarizeDoc(doc: ArtifactDocument): SpecSummary {
  const frontMatter = doc.frontMatter as {
    readonly id: string;
    readonly type: string;
    readonly title: string;
  };
  return { id: frontMatter.id, type: frontMatter.type, title: frontMatter.title, path: doc.path };
}

export async function specList(ctx: SpecCommandContext): Promise<readonly SpecSummary[]> {
  const docs = await listSpecArtifacts(ctx.paths, ctx.specsRoot);
  return docs.map(summarizeDoc);
}

export async function specShow(ctx: SpecCommandContext, id: string): Promise<ArtifactDocument> {
  const docs = await listSpecArtifacts(ctx.paths, ctx.specsRoot);
  const found = docs.find((doc) => (doc.frontMatter as { readonly id?: unknown }).id === id);
  if (found === undefined) {
    throw new ForgeError('KB-015', { id });
  }
  return found;
}

export interface SpecValidationResult {
  readonly path: string;
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/** `validate`: `18` §18.6's two-phase check (`validateArtifact`) against every real spec document,
 * plus `09` §9.4's own required-edge/cycle checks (`SpecGraph`) across the whole graph. */
export async function specValidate(ctx: SpecCommandContext): Promise<{
  readonly documents: readonly SpecValidationResult[];
  readonly missingRequiredEdges: readonly GraphViolation[];
  readonly cycles: readonly { readonly path: readonly string[] }[];
}> {
  const docs = await listSpecArtifacts(ctx.paths, ctx.specsRoot);
  const roles =
    ctx.agentsRoot === undefined
      ? undefined
      : await readImplementationRoles(ctx.paths, ctx.agentsRoot);
  const documents = docs.map((doc) => {
    const outcome = validateArtifact(doc);
    const errors = outcome.valid ? [] : outcome.errors.map((error) => error.message);
    // A Story's owner runs its implement-story steps with write access to its source (`PLAN-M13.md` P36).
    const front = doc.frontMatter as Readonly<Record<string, unknown>>;
    if (front['type'] === 'Story' && typeof front['owner_role'] === 'string') {
      const problem = ownerRoleProblem(front['owner_role'], roles);
      if (problem !== undefined) errors.push(problem);
    }
    return { path: doc.path, valid: errors.length === 0, errors };
  });

  const graphDocs = await loadGraphDocs(ctx);
  const graph = SpecGraph.build(graphDocs);
  return {
    documents,
    missingRequiredEdges: graph.missingRequiredEdges(),
    cycles: graph.detectCycles(),
  };
}

export interface SpecTraceResult {
  readonly node: string;
  readonly parents: readonly GraphNode[];
  readonly children: readonly GraphNode[];
}

export async function specTrace(ctx: SpecCommandContext, id: string): Promise<SpecTraceResult> {
  const graph = SpecGraph.build(await loadGraphDocs(ctx));
  return { node: id, parents: graph.parentsOf(id), children: graph.childrenOf(id) };
}

export interface SpecMatrix {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly { readonly from: string; readonly to: string; readonly kind: string }[];
  readonly orphans: readonly Orphan[];
}

/** `matrix`: `09` §9.4's own traceability matrix — every node, every typed edge, every orphan, in
 * one real snapshot of the graph `SpecGraph` already computes. */
export async function specMatrix(ctx: SpecCommandContext): Promise<SpecMatrix> {
  const graph = SpecGraph.build(await loadGraphDocs(ctx));
  return {
    nodes: graph.nodes(),
    edges: graph.edges().map((edge) => ({ from: edge.from, to: edge.to, kind: edge.edge })),
    orphans: graph.orphans(),
  };
}

export async function specOrphans(ctx: SpecCommandContext): Promise<readonly Orphan[]> {
  const graph = SpecGraph.build(await loadGraphDocs(ctx));
  return graph.orphans();
}

/** Deterministic node-then-id ordering (`QUALITY-BAR.md` R10) — the same two-key sort
 * `SpecGraph.childrenOf`/`nodes` already apply internally, re-applied here because
 * `transitiveChildren` below merges several `childrenOf` calls into one set. */
function compareNodes(a: GraphNode, b: GraphNode): number {
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The transitive downstream closure of `rootId`: every node reachable by repeatedly following
 * `SpecGraph.childrenOf` — `09` §9.4's typed edges read in the "what depends on this" direction
 * (`STORY --partOf--> EPIC`, so `childrenOf(EPIC)` is every `STORY` of it; `AC --belongsTo--> STORY`,
 * so `childrenOf(STORY)` is every `AC`; `TEST --proves--> AC`, so `childrenOf(AC)` is every `TEST`).
 * Changing an EPIC therefore affects its STORYs, which affects their ACs, which affects their TESTs —
 * exactly `09` §9.7 point 2's "which artifacts are affected (computed from the graph)", applied
 * downward from one changed artifact. `rootId` itself is never included (a caller already knows it
 * changed; this answers what else did).
 */
function transitiveChildren(graph: SpecGraph, rootId: string): readonly GraphNode[] {
  const visited = new Map<string, GraphNode>();
  let frontier: readonly string[] = [rootId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const nodeId of frontier) {
      for (const child of graph.childrenOf(nodeId)) {
        if (!visited.has(child.id)) {
          visited.set(child.id, child);
          next.push(child.id);
        }
      }
    }
    frontier = next;
  }
  return [...visited.values()].sort(compareNodes);
}

/** One AC `specReDerive` found with no TEST proving it — `storyId` is `undefined` only for the
 * structurally-impossible case `SpecGraph.parentsOf` returns no parent for an AC node at all (every
 * real AC node is only ever created alongside its own `belongsTo` edge, `build.ts`'s own single pass
 * over `acClaimants`); kept optional rather than asserted non-null so a future, genuinely orphaned AC
 * node shape change fails a type check here instead of a runtime crash. */
export interface ReDeriveUnboundAcceptanceCriterion {
  readonly acId: string;
  readonly storyId: string | undefined;
}

export interface SpecReDeriveResult {
  /** The artifact id `specReDerive` was asked about, or `undefined` for the whole-graph bare form. */
  readonly scope: string | undefined;
  /** `scope`'s own transitive downstream closure (empty, and meaningless, for the bare form — every
   * node is trivially "affected" by the whole graph, so this is only populated when `scope` is set). */
  readonly affected: readonly GraphNode[];
  /** TEST ids within scope that `SpecGraph.orphans()` already marks as proving no AC — a spec edit
   * removed or renamed the AC the test's name once claimed. These need rewriting or deleting. */
  readonly staleTests: readonly string[];
  /** AC ids within scope with no TEST node pointing at them at all — a new or reworded AC with
   * nothing proving it yet. These need a new test derived. */
  readonly unboundAcceptanceCriteria: readonly ReDeriveUnboundAcceptanceCriterion[];
}

/** Every TEST id `SpecGraph.orphans()` marks as proving no AC. */
function orphanTestNames(graph: SpecGraph): ReadonlySet<string> {
  return new Set(
    graph
      .orphans()
      .filter((orphan) => orphan.kind === 'TEST')
      .map((orphan) => orphan.id),
  );
}

/**
 * The real, disclosed reason `staleTests` cannot be computed from `SpecGraph` traversal alone: an
 * orphan TEST (one proving no AC) has, by construction, no `proves` edge at all — `build.ts` only
 * ever adds that edge when exactly one claimed AC id resolves — so it has no INCOMING edge either,
 * and is therefore unreachable from anywhere via `childrenOf`/`transitiveChildren`, including from
 * the very Story that declared it in its own `tests[]` array. The only way to attribute a stale test
 * to a Story in scope is to read that Story's own raw `tests[]` field directly off its document and
 * cross-check each name against the real orphan set, which is what this does. `storyIds` of
 * `undefined` means every Story (the bare, whole-graph form); `extraTestId` additionally checks `id`
 * itself when a caller named a TEST node directly (a Story's own closure never includes it, for the
 * identical structural reason).
 */
function staleTestsFor(
  docs: readonly ArtifactDocument[],
  orphanNames: ReadonlySet<string>,
  storyIds: ReadonlySet<string> | undefined,
  extraTestId: string | undefined,
): readonly string[] {
  const found = new Set<string>();
  if (extraTestId !== undefined && orphanNames.has(extraTestId)) found.add(extraTestId);
  for (const doc of docs) {
    const fm = doc.frontMatter as Readonly<Record<string, unknown>>;
    const storyId = typeof fm['id'] === 'string' ? fm['id'] : undefined;
    if (fm['type'] !== 'Story' || storyId === undefined) continue;
    if (storyIds !== undefined && !storyIds.has(storyId)) continue;
    const tests = Array.isArray(fm['tests']) ? fm['tests'] : [];
    for (const test of tests) {
      if (typeof test === 'string' && orphanNames.has(test)) found.add(test);
    }
  }
  return [...found].sort();
}

/** AC nodes among `acNodes` with no TEST node pointing at them at all. */
function unboundAcceptanceCriteriaFor(
  graph: SpecGraph,
  acNodes: readonly GraphNode[],
): readonly ReDeriveUnboundAcceptanceCriterion[] {
  return acNodes
    .filter((node) => graph.childrenOf(node.id).length === 0)
    .map((node) => ({ acId: node.id, storyId: graph.parentsOf(node.id)[0]?.id }));
}

/**
 * `forge spec re-derive [<id>]` (`03` §3.2.2, post-v1.0 `specs/22` M17; wired by M17 P17,
 * `SPEC-QUESTIONS.md` Q213) — the deterministic half of `09` §9.7 point 4's "affected tests are
 * re-derived": once a spec artifact is edited (its own `revision`/`changelog` bumped, `09` §9.7
 * point 4's own normative text; `ArtifactDocument.bumpRevision` is the real mechanism, already used
 * by `forge adr accept/reject/supersede`), this computes exactly which existing tests are now stale
 * and which acceptance criteria have nothing proving them — the same `SpecGraph` `trace`/`matrix`/
 * `orphans` already build, composed rather than duplicated.
 *
 * With `id`, both lists are scoped to `id` itself plus its own transitive downstream closure
 * (`transitiveChildren`) — re-deriving after editing one Story reports only that Story's own ACs/
 * tests, not the whole project. Without `id` (`03` §3.2.2's own bare `re-derive` row), both cover
 * the whole graph.
 *
 * **What this does not do, and why** (disclosed, not silently narrowed): it does not itself bump any
 * artifact's `revision`/`changelog` (`09` §9.7 points 1-3 — a change proposal and its human approval —
 * are `forge plan replan`'s own job, already wired, upstream of this command) or mark an AC
 * `superseded` (no schema field for that exists in `acceptanceCriterionSchema` today — inventing one
 * is a schema change this piece's own narrow "wire the command" mandate does not license). Most
 * importantly, it does not write test CODE: turning "this AC has no test" into a real, passing test
 * is the `sdet` agent's own job (`09` §9.5), an LLM dispatch this command does not make — identical in
 * kind to `../adopt.ts`'s own disclosed CARTOGRAPHY/INFERENCE scope note. This command answers WHICH
 * tests need deriving, deterministically and for real; deriving them is separate, later work.
 *
 * @throws {ForgeError} `KB-015` if `id` is given and names no real graph node (the identical code
 * `specShow` already throws for the same "a user-typed id that names nothing" reason).
 * @see specs/09 §9.4
 * @see specs/09 §9.7
 */
export async function specReDerive(
  ctx: SpecCommandContext,
  id?: string,
): Promise<SpecReDeriveResult> {
  const docs = await loadGraphDocs(ctx);
  const graph = SpecGraph.build(docs);
  const orphanNames = orphanTestNames(graph);

  if (id === undefined) {
    return {
      scope: undefined,
      affected: [],
      staleTests: staleTestsFor(docs, orphanNames, undefined, undefined),
      unboundAcceptanceCriteria: unboundAcceptanceCriteriaFor(
        graph,
        graph.nodes().filter((node) => node.kind === 'AC'),
      ),
    };
  }

  const rootNode = graph.nodes().find((node) => node.id === id);
  if (rootNode === undefined) {
    throw new ForgeError('KB-015', { id });
  }
  const affected = transitiveChildren(graph, id);
  const scopeNodes = [rootNode, ...affected];
  const storyIds = new Set(
    scopeNodes.filter((node) => node.kind === 'STORY').map((node) => node.id),
  );

  return {
    scope: id,
    affected,
    staleTests: staleTestsFor(docs, orphanNames, storyIds, id),
    unboundAcceptanceCriteria: unboundAcceptanceCriteriaFor(
      graph,
      scopeNodes.filter((node) => node.kind === 'AC'),
    ),
  };
}

/** The `ArtifactTypeId`s `docs/forge/specs/**` actually holds (`03` §3.2.2's own `forge spec new
 * <type>` domain) — a real subset of the full 27-type registry, distinct from `@forge/templates`'
 * own `TemplateArtifactTypeId` (all 27: every registered type has a template, but not every type
 * lives under `specs/` — `ADR` lives under `kb/decisions/`, `Risk` under `kb/risks.md`, etc.). */
export type SpecArtifactType =
  'Vision' | 'Capability' | 'NFR' | 'Epic' | 'Story' | 'Task' | 'InterfaceContract' | 'DataModel';

/** Exported (`PLAN-M12.md` P4) so the real CLI dispatcher's own "unrecognised `<type>`" usage error can
 * name exactly these eight real types — a fresh critic round found an earlier draft of that message
 * listing the full, unrelated 21-entry `ArtifactTypeId` registry instead, which named several types
 * (`ADR`, `Diagram`, `SessionRecord`, ...) that read as valid answers but still fail this function's
 * own domain check immediately below. */
export const SPEC_ARTIFACT_TYPES: ReadonlySet<ArtifactTypeId> = new Set<SpecArtifactType>([
  'Vision',
  'Capability',
  'NFR',
  'Epic',
  'Story',
  'Task',
  'InterfaceContract',
  'DataModel',
]);

function isSpecArtifactType(type: ArtifactTypeId): type is SpecArtifactType {
  return SPEC_ARTIFACT_TYPES.has(type);
}

/** `adrNew`'s own real slug derivation (`adr.ts`), duplicated rather than imported: both are small,
 * package-local helpers with no shared home, and `@forge/schemas/registry`'s own path templates are
 * the only real contract between them -- see this function's own call site below for why `spec new`
 * needs it too. */
function slugify(title: string): string {
  return (
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'spec'
  );
}

/** `new <type>`: the identical real-id-allocation + real-template scaffolding `adrNew` uses, for any
 * of the eight `docs/forge/specs/**`-rooted types a spec document can be.
 *
 * `Story`/`DataModel`'s own `pathTemplate`s (`@forge/schemas/registry`) need a `{slug}` placeholder
 * and `InterfaceContract`'s needs `{name}` -- neither was ever supplied here, so all three failed
 * every real call with a misleading `CFG-001` ("Invalid configuration ... at line 0"), a real,
 * previously-undiscovered defect confirmed via `docs/getting-started.md` P7's own live CLI
 * verification pass (`SPEC-QUESTIONS.md` Q190) and fixed here by deriving both placeholders from
 * `title` the same way `adrNew` already derives ADR's own `{slug}` -- `vars` still wins when a caller
 * supplies its own `slug`/`name` explicitly, never silently overridden. */
export async function specNew(
  ctx: SpecCommandContext,
  type: ArtifactTypeId,
  title: string,
  vars: Readonly<Record<string, string>> = {},
): Promise<ArtifactDocument> {
  if (!isSpecArtifactType(type)) {
    throw new ForgeError('USR-003', { feature: `spec new ${type}` });
  }

  const clock = ctx.clock ?? SYSTEM_CLOCK;
  const allocator = getSharedIdAllocator(ctx.paths, clock);
  const id = await allocator.allocate(type);
  const slug = slugify(title);

  const pathResult = renderArtifactPath(type, { id, slug, name: slug, ...vars });
  if (!pathResult.success) {
    throw new ForgeError('CFG-001', { path: type, line: 0 });
  }
  const relativePath = `docs/forge/${pathResult.path}`;

  const templateText = await readArtifactTemplate(type);
  const today = clock.now().slice(0, 10);
  const doc = ArtifactDocument.parse(templateText, relativePath);
  doc.set(['id'], id);
  doc.set(['title'], title);
  doc.set(['created'], today);
  doc.set(['updated'], today);

  await writeArtifact(ctx.paths, doc);
  return doc;
}
