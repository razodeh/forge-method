/**
 * `08` §8.11.6's eight generators — each turns one already-structured input into Mermaid source.
 *
 * Every input type here is deliberately its own small shape, not a shared interface: the eight
 * sources of truth `08` §8.11.6's table names share no common structure (a real `SpecGraph`, a
 * workflow's step list, a plain component inventory, ...). Several *outputs* do share a shape
 * (a node/dependency graph, an ER model, a sequence) and reuse `render-flowchart.ts`/`render-er.ts`/
 * `render-sequence.ts` accordingly — the sharing lives in rendering, not in each generator's input.
 *
 * Two generators deliberately implement less than their own taxonomy row's "Output" column literally
 * promises (`componentsToC4`, one view of three; `pipelineToFlow`, stages without gates), and a third
 * narrows where its own "source of truth" actually starts (`schemaIntrospectToEr`, given already-
 * extracted structure rather than a live database or migration files itself) — see
 * `SPEC-QUESTIONS.md` Q46 for why, and for the follow-on work each gap leaves for a future piece.
 *
 * @see specs/08 §8.11.6
 * @see PLAN-M3.md P3
 * @see SPEC-QUESTIONS.md Q46
 */
import { ForgeError } from '@forge/core';
import type { GraphEdge, GraphNode, SpecGraph } from '@forge/core/graph';

import { renderErDiagram, type ErEntity, type ErRelationship } from './render-er.ts';
import { renderFlowchart, type FlowEdge, type FlowNode } from './render-flowchart.ts';
import { renderSequenceDiagram, type SequenceStep } from './render-sequence.ts';
import type { GeneratedDiagram, GeneratorName } from './types.ts';

// Two distinct elements of a `Set` are never equal, so a two-way comparator (no `=== 0` branch to
// leave provably unreachable) is honest here, not merely simpler.
function compareIds(a: string, b: string): number {
  return a < b ? -1 : 1;
}

/** Every id in `ids`, deduplicated and sorted — `depicts` names *which* real ids a diagram
 * references, so a caller listing the same one twice (a duplicate `dependsOn` entry, a component
 * repeated by mistake) should not produce a `depicts` array with the same id twice either. */
function sortedIds(ids: readonly string[]): readonly string[] {
  return [...new Set(ids)].sort(compareIds);
}

/**
 * The one runtime check every generator applies to its own `unknown`-typed boundary input (via
 * `runGenerator`) before touching it: does the one field this generator actually needs exist and
 * have the right JavaScript type. This is deliberately shallow — it does not validate every field of
 * every array element, only enough to turn "caller passed the wrong generator's input, or `undefined`,
 * or a typo'd field name" into a `ForgeError` naming the problem instead of a raw `TypeError` from
 * three calls deep inside a `.map`. A caller with a real `ComponentsToC4Input` (etc.) already has
 * compile-time protection this check does not need to repeat.
 */
function requireArrayField(
  generator: GeneratorName,
  input: unknown,
  field: string,
): readonly unknown[] {
  const value = (input as Record<string, unknown> | null | undefined)?.[field];
  if (!Array.isArray(value)) {
    throw new ForgeError('KB-002', { generator, detail: `expected "${field}" to be an array` });
  }
  return value;
}

function requireGraphField(generator: GeneratorName, input: unknown, field: string): SpecGraph {
  const value = (input as Record<string, unknown> | null | undefined)?.[field];
  const looksLikeSpecGraph =
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>)['nodes'] === 'function' &&
    typeof (value as Record<string, unknown>)['edges'] === 'function';
  if (!looksLikeSpecGraph) {
    throw new ForgeError('KB-002', {
      generator,
      detail: `expected "${field}" to be a SpecGraph (an object with nodes()/edges() methods)`,
    });
  }
  return value as SpecGraph;
}

// ---- components-to-c4 --------------------------------------------------------------------------

/**
 * Source of truth: `architecture/components.md`'s component inventory. Output: the container-level
 * decomposition view (`08` §8.11.3's `C4Container`/`flowchart` row) — the single most load-bearing
 * of the taxonomy's three C4 levels for this one generator; a richer context/component-level split
 * is a documented gap, not attempted here (`SPEC-QUESTIONS.md` Q46).
 */
export interface ComponentsToC4Input {
  readonly components: readonly {
    readonly id: string;
    readonly label: string;
    readonly dependsOn: readonly string[];
  }[];
}

export function componentsToC4(input: ComponentsToC4Input): GeneratedDiagram {
  requireArrayField('components-to-c4', input, 'components');
  const nodes: FlowNode[] = input.components.map((c) => ({ id: c.id, label: c.label }));
  const edges: FlowEdge[] = input.components.flatMap((c) =>
    c.dependsOn.map((dep) => ({ from: c.id, to: dep })),
  );
  return {
    source: renderFlowchart(nodes, edges, 'TB'),
    kind: 'flowchart',
    depicts: sortedIds(input.components.map((c) => c.id)),
  };
}

// ---- interfaces-to-sequence ---------------------------------------------------------------------

/** Source of truth: `specs/interfaces/*` plus a declared flow's ordered call steps. */
export interface InterfacesToSequenceInput {
  readonly flowName: string;
  readonly steps: readonly SequenceStep[];
}

export function interfacesToSequence(input: InterfacesToSequenceInput): GeneratedDiagram {
  requireArrayField('interfaces-to-sequence', input, 'steps');
  const participants = new Set<string>();
  for (const step of input.steps) {
    participants.add(step.from);
    participants.add(step.to);
  }
  return {
    source: renderSequenceDiagram(input.steps, input.flowName),
    kind: 'sequenceDiagram',
    depicts: sortedIds([...participants]),
  };
}

// ---- datamodel-to-er ------------------------------------------------------------------------------

/** Source of truth: a `DM-###` `DataModel` artifact's entities and relationships. */
export interface DatamodelToErInput {
  readonly entities: readonly ErEntity[];
  readonly relationships: readonly ErRelationship[];
}

export function datamodelToEr(input: DatamodelToErInput): GeneratedDiagram {
  requireArrayField('datamodel-to-er', input, 'entities');
  requireArrayField('datamodel-to-er', input, 'relationships');
  return {
    source: renderErDiagram(input.entities, input.relationships),
    kind: 'erDiagram',
    depicts: sortedIds(input.entities.map((e) => e.name)),
  };
}

// ---- schema-introspect-to-er --------------------------------------------------------------------

/**
 * Source of truth: "a live/dev database or migration files" (`08` §8.11.6). This generator's own
 * responsibility starts *after* that introspection — its input is already-extracted table/column/
 * foreign-key structure; querying a real database or parsing migration files is a separate, much
 * larger concern with no home yet in this milestone (brownfield ingestion is `specs/22` M10), not
 * attempted here (`SPEC-QUESTIONS.md` Q46).
 */
export interface SchemaIntrospectToErInput {
  readonly tables: readonly { readonly name: string; readonly columns: readonly string[] }[];
  readonly foreignKeys: readonly { readonly from: string; readonly to: string }[];
}

export function schemaIntrospectToEr(input: SchemaIntrospectToErInput): GeneratedDiagram {
  requireArrayField('schema-introspect-to-er', input, 'tables');
  requireArrayField('schema-introspect-to-er', input, 'foreignKeys');
  const entities: ErEntity[] = input.tables.map((t) => ({ name: t.name, attributes: t.columns }));
  const relationships: ErRelationship[] = input.foreignKeys.map((fk) => ({
    from: fk.from,
    to: fk.to,
    label: 'references',
  }));
  return {
    source: renderErDiagram(entities, relationships),
    kind: 'erDiagram',
    depicts: sortedIds(input.tables.map((t) => t.name)),
  };
}

// ---- specgraph-to-graph ---------------------------------------------------------------------------

/** Source of truth: the real `@forge/core/graph` `SpecGraph` — reused directly, not re-traversed. */
export interface SpecgraphToGraphInput {
  readonly graph: SpecGraph;
}

function graphNodeLabel(node: GraphNode): string {
  return `${node.kind}: ${node.id}`;
}

export function specgraphToGraph(input: SpecgraphToGraphInput): GeneratedDiagram {
  requireGraphField('specgraph-to-graph', input, 'graph');
  const nodes: FlowNode[] = input.graph.nodes().map((node) => ({
    id: node.id,
    label: graphNodeLabel(node),
  }));
  const edges: FlowEdge[] = input.graph.edges().map((edge: GraphEdge) => ({
    from: edge.from,
    to: edge.to,
    label: edge.edge,
  }));
  return {
    source: renderFlowchart(nodes, edges, 'LR'),
    kind: 'flowchart',
    depicts: sortedIds(input.graph.nodes().map((node) => node.id)),
  };
}

// ---- workflow-to-dag ------------------------------------------------------------------------------

/** Source of truth: a workflow's own step list. Each step's `dependsOn` becomes an edge pointing
 * from the dependency to the dependent step — the direction a run plan DAG actually executes in. */
export interface WorkflowToDagInput {
  readonly steps: readonly { readonly id: string; readonly dependsOn: readonly string[] }[];
}

export function workflowToDag(input: WorkflowToDagInput): GeneratedDiagram {
  requireArrayField('workflow-to-dag', input, 'steps');
  const nodes: FlowNode[] = input.steps.map((step) => ({ id: step.id, label: step.id }));
  const edges: FlowEdge[] = input.steps.flatMap((step) =>
    step.dependsOn.map((dep) => ({ from: dep, to: step.id })),
  );
  return {
    source: renderFlowchart(nodes, edges, 'TB'),
    kind: 'flowchart',
    depicts: sortedIds(input.steps.map((step) => step.id)),
  };
}

// ---- deps-to-graph --------------------------------------------------------------------------------

/** Source of truth: code dependency analysis (brownfield, `specs/22` M10) — this generator's input
 * is the already-extracted module dependency list, the same "extraction is a separate concern"
 * narrowing `schemaIntrospectToEr` makes. */
export interface DepsToGraphInput {
  readonly modules: readonly { readonly name: string; readonly dependsOn: readonly string[] }[];
}

export function depsToGraph(input: DepsToGraphInput): GeneratedDiagram {
  requireArrayField('deps-to-graph', input, 'modules');
  const nodes: FlowNode[] = input.modules.map((m) => ({ id: m.name, label: m.name }));
  const edges: FlowEdge[] = input.modules.flatMap((m) =>
    m.dependsOn.map((dep) => ({ from: m.name, to: dep })),
  );
  return {
    source: renderFlowchart(nodes, edges, 'TB'),
    kind: 'flowchart',
    depicts: sortedIds(input.modules.map((m) => m.name)),
  };
}

// ---- pipeline-to-flow -----------------------------------------------------------------------------

/** Source of truth: CI config, reduced to its stage list and each stage's own dependencies. Models
 * stage ordering only — `08` §8.11.3's own row also names "gates," which have no representation in
 * this input shape (`SPEC-QUESTIONS.md` Q46). */
export interface PipelineToFlowInput {
  readonly stages: readonly { readonly name: string; readonly dependsOn: readonly string[] }[];
}

export function pipelineToFlow(input: PipelineToFlowInput): GeneratedDiagram {
  requireArrayField('pipeline-to-flow', input, 'stages');
  const nodes: FlowNode[] = input.stages.map((s) => ({ id: s.name, label: s.name }));
  const edges: FlowEdge[] = input.stages.flatMap((s) =>
    s.dependsOn.map((dep) => ({ from: dep, to: s.name })),
  );
  return {
    source: renderFlowchart(nodes, edges, 'LR'),
    kind: 'flowchart',
    depicts: sortedIds(input.stages.map((s) => s.name)),
  };
}
