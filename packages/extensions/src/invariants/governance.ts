/**
 * `checkObservabilityNotDisabled` (I10), `checkCustomAgentsConstrained` (I11),
 * `checkRequiredRolesEnabled` (I12) — `15` §15.10's governance invariants.
 *
 * @see specs/15 §15.10
 * @see PLAN-M2.md P8
 */
import { checkCustomAgents, checkRequiredRoles } from '../agents/index.ts';
import type { CustomAgent, ProjectLevel, RosterConfig } from '../agents/index.ts';
import { violation } from './violation.ts';
import type { InvariantViolation, ObservabilityConfig } from './types.ts';

/** "Overlays cannot disable the event log, the cost ledger, or the audit trail." */
export function checkObservabilityNotDisabled(
  observability: ObservabilityConfig,
): readonly InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  if (!observability.eventLogEnabled) {
    violations.push(violation('I10', 'CFG-503', { subsystem: 'the event log' }));
  }
  if (!observability.costLedgerEnabled) {
    violations.push(violation('I10', 'CFG-503', { subsystem: 'the cost ledger' }));
  }
  if (!observability.auditTrailEnabled) {
    violations.push(violation('I10', 'CFG-503', { subsystem: 'the audit trail' }));
  }
  return violations;
}

/**
 * The invariant-level re-assertion of `PLAN-M2.md` P3's own `checkCustomAgents` — same check,
 * carrying I11's own code and reusing that check's already-complete violation message verbatim
 * rather than re-deriving separate fields from it.
 */
export function checkCustomAgentsConstrained(
  customAgents: readonly CustomAgent[],
): readonly InvariantViolation[] {
  return checkCustomAgents({ add: [...customAgents] }).map((roleViolation) =>
    violation('I11', 'CFG-504', { detail: roleViolation.detail }),
  );
}

/**
 * The invariant-level re-assertion of `PLAN-M2.md` P3's own `checkRequiredRoles` — same check,
 * carrying I12's own code and reusing that check's already-complete violation message verbatim.
 */
export function checkRequiredRolesEnabled(
  roster: RosterConfig,
  currentLevel: ProjectLevel,
): readonly InvariantViolation[] {
  return checkRequiredRoles(roster, currentLevel).map((roleViolation) =>
    violation('I12', 'CFG-505', { detail: roleViolation.detail }),
  );
}
