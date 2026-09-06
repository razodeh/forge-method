/**
 * `@forge/diagrams/lint` — `08` §8.11.7's per-diagram gate checks.
 *
 * @see PLAN-M3.md P2
 */
export { lintDiagram } from './lint.ts';
export {
  DEFAULT_COMPLEXITY_BUDGET,
  type ComplexityBudget,
  type DiagramCheckId,
  type DiagramFinding,
  type LintDiagramOptions,
} from './types.ts';
