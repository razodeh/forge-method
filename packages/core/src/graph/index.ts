/**
 * `@forge/core/graph` — the typed traceability graph, per `09` §9.4.
 *
 * @see specs/09 §9.4
 * @see PLAN-M1.md P14
 */
export { SpecGraph } from './spec-graph.ts';
export {
  REQUIRED_EDGES,
  type Cycle,
  type EdgeKind,
  type EdgeRequirement,
  type EdgeRule,
  type GraphEdge,
  type GraphNode,
  type GraphViolation,
  type NodeKind,
  type Orphan,
} from './types.ts';
