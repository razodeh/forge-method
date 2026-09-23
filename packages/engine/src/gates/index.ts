/**
 * `@forge/engine/gates` — `10` §10.3's gate mechanism, generically: run deterministic checks, evaluate
 * `failOn` via `@forge/engine/expr`, never fail on an advisory result, handle waivers, emit report data.
 *
 * @see specs/10 §10.3
 * @see PLAN-M5.md P14
 */
export {
  approveGate,
  approverRefusal,
  recordChecks,
  type ApprovedCheckRecord,
  type ApproveGateInput,
  type GateApprovalSummary,
  type GateApprover,
} from './approve.ts';
export {
  parseGateDocument,
  suggestKey,
  validateGateDocument,
  type GateDocumentProblem,
  type GateDocumentProblemCode,
  type GateDocumentResult,
} from './document.ts';
export { evaluateGate, MAX_CHECK_STDERR_CHARS } from './evaluate.ts';
export { buildGateReport } from './report.ts';
export {
  applyWaiver,
  isApproved,
  isWaiverOwnerIdentifier,
  validateWaiverPolicy,
  waiverExceedsCap,
} from './waiver.ts';
export type {
  AdvisoryCheck,
  CheckRunner,
  DeterministicCheck,
  DeterministicCheckResult,
  GateApprovalPolicy,
  GateDefinition,
  GateEvaluationResult,
  GateReport,
  Waiver,
} from './types.ts';
