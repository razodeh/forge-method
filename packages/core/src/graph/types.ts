/**
 * Types for `@forge/core/graph` — `09` §9.4's typed traceability graph.
 *
 * @see specs/09 §9.4
 * @see PLAN-M1.md P14
 */
import type { ForgeError } from '../errors/index.ts';

/** The ten edge kinds `09` §9.4's table names. Closed union — a new kind is a spec change. */
export type EdgeKind =
  | 'realises'
  | 'delivers'
  | 'partOf'
  | 'belongsTo'
  | 'proves'
  | 'implements'
  | 'primaryFor'
  | 'constrains'
  | 'consumedBy'
  | 'verifiedBy';

/** How strictly `09` §9.4 requires a row's edge to exist. */
export type EdgeRequirement = 'yes' | 'advisory' | 'as-applicable' | 'conditional';

/**
 * One row of `09` §9.4's edge table, transcribed as data.
 *
 * `from`/`to` are the table's own short labels (`CAP`, `VIS`, `AC`, `benchmark/monitor`, …), not
 * `ArtifactTypeId` — several of them (`AC`, `TEST`, `COMMIT`, `FILE`, `component`, `benchmark`,
 * `monitor`) are not registered artifact types at all. See `SPEC-QUESTIONS.md` Q31 for which rows
 * `SpecGraph.build` can actually construct edges for from an `ArtifactDocument[]` in M1.
 */
export interface EdgeRule {
  readonly from: string;
  readonly edge: EdgeKind;
  readonly to: string;
  readonly required: EdgeRequirement;
  readonly note?: string;
}

/** `09` §9.4's edge table, verbatim. */
export const REQUIRED_EDGES: readonly EdgeRule[] = [
  { from: 'CAP', edge: 'realises', to: 'VIS', required: 'yes' },
  { from: 'EPIC', edge: 'delivers', to: 'CAP', required: 'yes' },
  { from: 'STORY', edge: 'partOf', to: 'EPIC', required: 'yes' },
  { from: 'AC', edge: 'belongsTo', to: 'STORY', required: 'yes' },
  {
    from: 'TEST',
    edge: 'proves',
    to: 'AC',
    required: 'yes',
    note: '1 test proves exactly 1 AC; an AC may have many tests',
  },
  { from: 'TASK', edge: 'implements', to: 'STORY', required: 'yes' },
  { from: 'COMMIT', edge: 'implements', to: 'STORY', required: 'yes', note: 'via trailer' },
  {
    from: 'FILE',
    edge: 'primaryFor',
    to: 'STORY',
    required: 'advisory',
    note: 'from claims + commit history',
  },
  { from: 'ADR', edge: 'constrains', to: 'EPIC/STORY/component', required: 'as-applicable' },
  {
    from: 'INT',
    edge: 'consumedBy',
    to: 'STORY',
    required: 'conditional',
    note: 'when the story calls it',
  },
  { from: 'NFR', edge: 'verifiedBy', to: 'TEST/benchmark/monitor', required: 'yes' },
] as const;

/**
 * The node kinds `SpecGraph` actually ingests. A subset of the 21 registered artifact types (the
 * other 13 — `DataModel`, `Diagram`, `Risk`, … — are not part of `09` §9.4's traceability chain) plus
 * `AC` and `TEST`, synthesised from a `Story` document's own `acceptance`/`tests` fields rather than
 * read from a separate file, since neither is a registered artifact type with its own front matter.
 */
export type NodeKind =
  'VIS' | 'CAP' | 'EPIC' | 'STORY' | 'AC' | 'TEST' | 'TASK' | 'ADR' | 'INT' | 'NFR';

export interface GraphNode {
  readonly kind: NodeKind;
  readonly id: string;
}

export interface GraphEdge {
  readonly from: string;
  readonly edge: EdgeKind;
  readonly to: string;
}

/** `09` §9.4's matrix line: `Orphans: 0 stories · 1 test (TEST-198 proves no AC)`. */
export interface Orphan {
  readonly kind: 'STORY' | 'TEST';
  readonly id: string;
  readonly reason: string;
}

/** A dependency cycle, node ids in traversal order with the closing node repeated at the end. */
export interface Cycle {
  readonly path: readonly string[];
}

/** A required-edge violation. Always one of the `SPEC-` codes `09` §9.4 checking can raise. */
export type GraphViolation = ForgeError<'SPEC-021' | 'SPEC-022' | 'SPEC-023'>;
