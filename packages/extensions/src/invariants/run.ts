/**
 * `runInvariants` — `15` §15.10's twelve compile-time invariants, run against whichever slice of a
 * `ResolvedSet` a caller supplies.
 *
 * @see specs/15 §15.10
 * @see PLAN-M2.md P8
 */
import {
  checkAlwaysHumanNotDowngraded,
  checkGateApprovalShape,
  checkGateHasChecks,
} from './gates.ts';
import {
  checkCustomAgentsConstrained,
  checkObservabilityNotDisabled,
  checkRequiredRolesEnabled,
} from './governance.ts';
import { checkNoInjectionContent, checkNoSecretLiterals, checkToolCeilings } from './security.ts';
import { checkSelfReview, checkTestImplementationSeparation } from './separation.ts';
import { checkTraceabilityNotDisabled } from './traceability.ts';
import type { InvariantViolation, ResolvedSet } from './types.ts';

/**
 * Every field of `resolvedSet` is optional: an absent field skips exactly the invariant(s) it feeds
 * (`PLAN-M2.md` P8's own Mandate — "given a resolved set (or the specific overlay slice each
 * invariant needs)"), never a false pass reported as if it were actually checked.
 */
export function runInvariants(resolvedSet: ResolvedSet): readonly InvariantViolation[] {
  const violations: InvariantViolation[] = [];

  if (resolvedSet.outputReviewAssignments !== undefined) {
    violations.push(...checkSelfReview(resolvedSet.outputReviewAssignments));
  }
  if (resolvedSet.testImplementationAssignments !== undefined) {
    violations.push(
      ...checkTestImplementationSeparation(resolvedSet.testImplementationAssignments),
    );
  }
  if (resolvedSet.gateConfigs !== undefined) {
    violations.push(...checkGateApprovalShape(resolvedSet.gateConfigs));
    violations.push(...checkGateHasChecks(resolvedSet.gateConfigs));
  }
  if (resolvedSet.gateAutonomyOverrides !== undefined) {
    violations.push(...checkAlwaysHumanNotDowngraded(resolvedSet.gateAutonomyOverrides));
  }
  if (resolvedSet.disabledTraceabilityEdges !== undefined) {
    violations.push(...checkTraceabilityNotDisabled(resolvedSet.disabledTraceabilityEdges));
  }
  if (resolvedSet.toolCeilingChecks !== undefined) {
    violations.push(...checkToolCeilings(resolvedSet.toolCeilingChecks));
  }
  if (resolvedSet.scanTargets !== undefined) {
    violations.push(...checkNoSecretLiterals(resolvedSet.scanTargets));
    violations.push(...checkNoInjectionContent(resolvedSet.scanTargets));
  }
  if (resolvedSet.observability !== undefined) {
    violations.push(...checkObservabilityNotDisabled(resolvedSet.observability));
  }
  if (resolvedSet.customAgents !== undefined) {
    violations.push(...checkCustomAgentsConstrained(resolvedSet.customAgents));
  }
  if (resolvedSet.roster !== undefined && resolvedSet.currentLevel !== undefined) {
    violations.push(...checkRequiredRolesEnabled(resolvedSet.roster, resolvedSet.currentLevel));
  }

  return violations;
}
