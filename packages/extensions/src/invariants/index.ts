/**
 * `@forge/extensions/invariants` — `15` §15.10's twelve compile-time invariants (I1–I12).
 *
 * @see specs/15 §15.10
 * @see PLAN-M2.md P8
 */
export {
  checkAlwaysHumanNotDowngraded,
  checkGateApprovalShape,
  checkGateHasChecks,
} from './gates.ts';
export {
  checkCustomAgentsConstrained,
  checkObservabilityNotDisabled,
  checkRequiredRolesEnabled,
} from './governance.ts';
export { runInvariants } from './run.ts';
export { checkNoInjectionContent, checkNoSecretLiterals, checkToolCeilings } from './security.ts';
export { checkSelfReview, checkTestImplementationSeparation } from './separation.ts';
export { checkTraceabilityNotDisabled } from './traceability.ts';
export {
  type DisabledTraceabilityEdge,
  type GateAutonomyOverride,
  type GateConfig,
  type InvariantId,
  type InvariantViolation,
  type ObservabilityConfig,
  type OutputReviewAssignment,
  type ResolvedSet,
  type ScanTarget,
  type TestImplementationAssignment,
  type ToolCeilingCheckInput,
} from './types.ts';
export { violation } from './violation.ts';
