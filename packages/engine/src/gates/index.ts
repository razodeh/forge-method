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
  evidenceArtifactType,
  recordChecks,
  type ApprovedCheckRecord,
  type ApproveGateInput,
  type GateApprovalSummary,
  type GateApprover,
} from './approve.ts';
export {
  parseCheckDocument,
  parseGateDocument,
  suggestKey,
  validateCheckDocument,
  validateGateDocument,
  type CheckDocument,
  type CheckDocumentProblem,
  type CheckDocumentProblemCode,
  type CheckDocumentResult,
  type GateDocumentProblem,
  type GateDocumentProblemCode,
  type GateDocumentResult,
} from './document.ts';
export { evaluateGate, MAX_CHECK_STDERR_CHARS } from './evaluate.ts';
export {
  buildGateReport,
  gateReportOutcome,
  renderGateReportFile,
  sanitizedCheckText,
  MAX_GATE_REPORT_CHECK_TEXT_BYTES,
  type GateReportFileInput,
} from './report.ts';
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
  GateEvidenceRef,
  GateReport,
  Waiver,
} from './types.ts';
