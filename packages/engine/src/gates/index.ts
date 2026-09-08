/**
 * `@forge/engine/gates` — `10` §10.3's gate mechanism, generically: run deterministic checks, evaluate
 * `failOn` via `@forge/engine/expr`, never fail on an advisory result, handle waivers, emit report data.
 *
 * @see specs/10 §10.3
 * @see PLAN-M5.md P14
 */
export { evaluateGate } from './evaluate.ts';
export { buildGateReport } from './report.ts';
export { applyWaiver, isApproved } from './waiver.ts';
export type {
  AdvisoryCheck,
  CheckRunner,
  DeterministicCheck,
  DeterministicCheckResult,
  GateDefinition,
  GateEvaluationResult,
  GateReport,
  Waiver,
} from './types.ts';
