/**
 * Types for `@forge/diagrams/lint` — `08` §8.11.7's per-diagram gate checks.
 *
 * @see specs/08 §8.11.7
 * @see PLAN-M3.md P2
 */

/** One `08` §8.11.7 check id this package raises as a `DiagramFinding` (`diagram:syntax` is P1's own
 * `ForgeError`, never a `DiagramFinding` — it fails before there is a diagram to report a finding
 * about). `diagram:drift`/`diagram:transclusion` are raised by `@forge/diagrams/drift` (P4), not this
 * module, but share this one closed id set so every check in the package reports through one shape. */
export type DiagramCheckId =
  | 'diagram:refs'
  | 'diagram:orphan-nodes'
  | 'diagram:complexity'
  | 'diagram:label-quality'
  | 'diagram:caption'
  | 'diagram:staleness'
  | 'diagram:drift'
  | 'diagram:transclusion';

/** One violation of one `08` §8.11.7 check against one diagram. `nodeId` is present whenever the
 * finding names a specific node (`diagram:refs`, `diagram:orphan-nodes`, `diagram:label-quality`) and
 * absent for a diagram-wide finding (`diagram:complexity`, `diagram:caption`, `diagram:staleness`). */
export interface DiagramFinding {
  readonly checkId: DiagramCheckId;
  readonly severity: 'error' | 'warn';
  readonly message: string;
  readonly nodeId?: string;
}

/** `08` §8.11.7`/`§8.11.9's node/edge budget for one diagram — `maxNodes`/`maxEdges` are the
 * warn-at boundary, `hardMaxNodes` the error-at boundary (there is no `hardMaxEdges`: over-budget
 * edges only ever warn, per the spec's own table). */
export interface ComplexityBudget {
  readonly maxNodes: number;
  readonly maxEdges: number;
  readonly hardMaxNodes: number;
}

/** `08` §8.11.9's own defaults, reused whenever a caller has no project config to hand. */
export const DEFAULT_COMPLEXITY_BUDGET: ComplexityBudget = Object.freeze({
  maxNodes: 20,
  maxEdges: 30,
  hardMaxNodes: 40,
});

/** Everything `lintDiagram` needs beyond the diagram and its parsed structure — every field optional,
 * each with its own documented behaviour when omitted (never a silent "everything passes" or a
 * wall-clock/no-op default that would violate R10). */
export interface LintDiagramOptions {
  /** Every id a `depicts` entry may legitimately reference. Omitted entirely (not `new Set()`) to
   * skip `diagram:refs` — the caller has no resolver, not "nothing exists". */
  readonly knownIds?: ReadonlySet<string>;
  /** `08` §8.11.9's `complexity` config; defaults to `DEFAULT_COMPLEXITY_BUDGET` when omitted. */
  readonly complexity?: ComplexityBudget;
  /** `08` §8.11.9's `requireCaptions` — `true` unless a caller's config says otherwise. */
  readonly requireCaptions?: boolean;
  /** Injected clock for `diagram:staleness` (R10) — no wall-clock read in this package. */
  readonly now?: Date;
}
