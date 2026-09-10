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

import { getSharedIdAllocator, listSpecArtifacts, readArtifactTemplate } from './shared.ts';

export interface SpecCommandContext {
  readonly paths: ProjectPaths;
  readonly specsRoot: string;
  readonly kbRoot: string;
  readonly clock?: Clock;
}

/** Every real document `forge spec trace/matrix/orphans` needs `SpecGraph` built from — `docs/forge/
 * specs/**`'s own documents plus `docs/forge/kb/decisions/**`'s ADRs, since `09` §9.4's own edge
 * table includes ADR nodes and this package has no way to build a graph missing them. */
async function loadGraphDocs(ctx: SpecCommandContext): Promise<readonly ArtifactDocument[]> {
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
  const documents = docs.map((doc) => {
    const outcome = validateArtifact(doc);
    return outcome.valid
      ? { path: doc.path, valid: true, errors: [] }
      : { path: doc.path, valid: false, errors: outcome.errors.map((error) => error.message) };
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

/** The `ArtifactTypeId`s `docs/forge/specs/**` actually holds (`03` §3.2.2's own `forge spec new
 * <type>` domain) — a real subset of the full 21-type registry, distinct from `@forge/templates`'
 * own `TemplateArtifactTypeId` (all 21: every registered type has a template, but not every type
 * lives under `specs/` — `ADR` lives under `kb/decisions/`, `Risk` under `kb/risks.md`, etc.). */
export type SpecArtifactType =
  'Vision' | 'Capability' | 'NFR' | 'Epic' | 'Story' | 'Task' | 'InterfaceContract' | 'DataModel';

const SPEC_ARTIFACT_TYPES: ReadonlySet<ArtifactTypeId> = new Set<SpecArtifactType>([
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

/** `new <type>`: the identical real-id-allocation + real-template scaffolding `adrNew` uses, for any
 * of the eight `docs/forge/specs/**`-rooted types a spec document can be. */
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

  const pathResult = renderArtifactPath(type, { id, ...vars });
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
