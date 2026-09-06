/**
 * Local shapes for the per-kind `Diagram.db` object `parseDiagram` reads — mermaid's own public
 * `Diagram.db` type (`DiagramDefinition['db']`) is deliberately generic, since each diagram module
 * privately extends it with its own methods. These are the exact methods this package calls,
 * confirmed empirically against `mermaid@11.17.2` (`SPEC-QUESTIONS.md` Q45), not the library's own
 * (looser) public type.
 *
 * @see SPEC-QUESTIONS.md Q45
 * @see PLAN-M3.md P1
 */

/** A node from Mermaid's unified renderer data (`flowchart`, `stateDiagram-v2`, `erDiagram`). */
export interface UnifiedNode {
  readonly id: string;
  readonly label?: string;
  readonly isGroup?: boolean;
  readonly parentId?: string;
}

export interface UnifiedEdge {
  readonly start: string;
  readonly end: string;
  readonly label?: string;
}

export interface UnifiedDiagramData {
  readonly nodes: readonly UnifiedNode[];
  readonly edges: readonly UnifiedEdge[];
}

/** `flowchart`/`stateDiagram-v2`/`erDiagram` share this one method on their own `db`. */
export interface UnifiedDataDb {
  getData(): UnifiedDiagramData;
}

export interface SequenceActor {
  readonly name?: string;
  readonly description?: string;
}

export interface SequenceMessage {
  readonly from: string;
  readonly to: string;
  readonly message?: string;
}

/** `sequenceDiagram`'s own `db` — no `getData()` support yet, per Q45. */
export interface SequenceDb {
  getActors(): ReadonlyMap<string, SequenceActor>;
  getMessages(): readonly SequenceMessage[];
}

export interface C4Shape {
  readonly alias: string;
  readonly label: { readonly text: string };
}

export interface C4Rel {
  readonly from: string;
  readonly to: string;
  readonly label: { readonly text: string };
}

/** Shared by all four `C4*` kinds (`C4Context`/`C4Container`/`C4Component`/`C4Deployment`) — own
 * properties on `db`, not inherited, so `Object.getOwnPropertyNames(Object.getPrototypeOf(db))`
 * alone will not find them (a real mistake made and corrected while building this piece — see
 * `SPEC-QUESTIONS.md` Q45). No `getData()` support, unlike the unified-renderer kinds. */
export interface C4Db {
  getC4ShapeArray(): readonly C4Shape[];
  getRels(): readonly C4Rel[];
}
