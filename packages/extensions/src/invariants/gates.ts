/**
 * `checkGateApprovalShape` (I3), `checkGateHasChecks` (I4), `checkAlwaysHumanNotDowngraded` (I5) —
 * `15` §15.10's gate invariants.
 *
 * @see specs/15 §15.10
 * @see PLAN-M2.md P8
 */
import { violation } from './violation.ts';
import type { GateAutonomyOverride, GateConfig, InvariantViolation } from './types.ts';

/**
 * The configuration-shape half of I3 only: "cannot be approved with a failing check" is a run-time
 * gate-approval fact (M5's to enforce). This checks that a gate's own config does not let itself be
 * marked approved while a check it names as *required* is *disabled* — a compile-time-visible
 * contradiction in the gate's own configuration, not a run's outcome.
 */
export function checkGateApprovalShape(
  gates: readonly GateConfig[],
): readonly InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  for (const gate of gates) {
    const disabled = new Set(gate.disabledCheckIds);
    for (const checkId of gate.requiredCheckIds) {
      if (!disabled.has(checkId)) continue;
      violations.push(violation('I3', 'GATE-501', { gateId: gate.gateId, checkId }));
    }
  }
  return violations;
}

/** "A gate cannot be defined with zero deterministic checks." */
export function checkGateHasChecks(gates: readonly GateConfig[]): readonly InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  for (const gate of gates) {
    if (gate.checkIds.length > 0) continue;
    violations.push(violation('I4', 'GATE-502', { gateId: gate.gateId }));
  }
  return violations;
}

/** "`alwaysHuman` gates ... cannot be downgraded by overlay." */
export function checkAlwaysHumanNotDowngraded(
  overrides: readonly GateAutonomyOverride[],
): readonly InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  for (const override of overrides) {
    if (override.baseAutonomy !== 'alwaysHuman') continue;
    if (override.overlayAutonomy === 'alwaysHuman') continue;
    violations.push(
      violation('I5', 'GATE-503', { gateId: override.gateId, autonomy: override.overlayAutonomy }),
    );
  }
  return violations;
}
