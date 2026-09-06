/**
 * Types for `@forge/diagrams/parse` — `08` §8.11.3's taxonomy kinds and the structural model every
 * later diagrams check reads through.
 *
 * @see specs/08 §8.11.3
 * @see PLAN-M3.md P1
 */

/** The diagram kinds `08` §8.11.3's taxonomy table names. Closed union — a new kind is a spec change. */
export type DiagramKind =
  | 'flowchart'
  | 'sequenceDiagram'
  | 'stateDiagram-v2'
  | 'erDiagram'
  | 'gantt'
  | 'C4Context'
  | 'C4Container'
  | 'C4Component'
  | 'C4Deployment'
  | 'quadrantChart';

/** `DIAGRAM_KINDS` as data, so a test can assert `parseDiagram` handles every one without drift. */
export const DIAGRAM_KINDS: readonly DiagramKind[] = [
  'flowchart',
  'sequenceDiagram',
  'stateDiagram-v2',
  'erDiagram',
  'gantt',
  'C4Context',
  'C4Container',
  'C4Component',
  'C4Deployment',
  'quadrantChart',
];

/** One drawn element (a box, actor, entity, state, or C4 shape) — `id` is its diagram-source
 * identifier, `label` its displayed text (falls back to `id` when the diagram gives none). */
export interface DiagramNode {
  readonly id: string;
  readonly label: string;
}

/** One connection between two `DiagramNode.id`s — `label` is the text on the connection itself
 * (an arrow label, a message, a relationship description), omitted when the diagram gives none. */
export interface DiagramEdge {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
}

/** A `flowchart` `subgraph` block — `nodeIds` are the ids of every node it directly contains
 * (not transitively, for a nested subgraph). Only `flowchart` has this construct; see
 * `ParsedDiagram.subgraphs`. */
export interface DiagramSubgraph {
  readonly id: string;
  readonly nodeIds: readonly string[];
}

/**
 * The result of parsing one diagram's source.
 *
 * `nodes`/`edges` are real, extracted structural data for `flowchart`/`stateDiagram-v2`/`erDiagram`
 * (via Mermaid's own unified renderer data), `sequenceDiagram` (actors/messages) and `C4*` (shapes/
 * relationships). `gantt` and `quadrantChart` always report `nodes: []`/`edges: []`: a Gantt task list
 * and a quadrant's data points are not a node/edge graph in the sense every other kind's `depicts`/
 * orphan-node/complexity checks reason about, not a case of missing extraction — see
 * `SPEC-QUESTIONS.md` Q45. `subgraphs` is populated only for `flowchart`, the one kind with a
 * `subgraph` construct.
 */
export interface ParsedDiagram {
  readonly kind: DiagramKind;
  readonly nodes: readonly DiagramNode[];
  readonly edges: readonly DiagramEdge[];
  readonly subgraphs: readonly DiagramSubgraph[];
}
