/**
 * `checkObservabilityNotDisabled` (I10), `checkCustomAgentsConstrained` (I11),
 * `checkRequiredRolesEnabled` (I12) — `15` §15.10's governance invariants.
 *
 * @see specs/15 §15.10
 * @see PLAN-M2.md P8
 */
import { describe, expect, it } from 'vitest';

import {
  checkCustomAgentsConstrained,
  checkObservabilityNotDisabled,
  checkRequiredRolesEnabled,
} from '../../src/invariants/governance.ts';

describe('checkObservabilityNotDisabled (I10)', () => {
  it('allows all three subsystems enabled', () => {
    const violations = checkObservabilityNotDisabled({
      eventLogEnabled: true,
      costLedgerEnabled: true,
      auditTrailEnabled: true,
    });
    expect(violations).toEqual([]);
  });

  it('refuses a disabled event log, naming it', () => {
    const violations = checkObservabilityNotDisabled({
      eventLogEnabled: false,
      costLedgerEnabled: true,
      auditTrailEnabled: true,
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.code).toBe('CFG-503');
    expect(violations[0]?.message).toContain('event log');
  });

  it('reports one violation per disabled subsystem, when all three are disabled', () => {
    const violations = checkObservabilityNotDisabled({
      eventLogEnabled: false,
      costLedgerEnabled: false,
      auditTrailEnabled: false,
    });
    expect(violations).toHaveLength(3);
    expect(violations.every((violation) => violation.code === 'CFG-503')).toBe(true);
  });
});

describe('checkCustomAgentsConstrained (I11)', () => {
  it('refuses a custom agent missing required fields', () => {
    const violations = checkCustomAgentsConstrained([{ id: 'sap-integrator' }]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.code).toBe('CFG-504');
    expect(violations[0]?.message).toContain('sap-integrator');
  });

  it('allows a fully-constrained custom agent', () => {
    const violations = checkCustomAgentsConstrained([
      {
        id: 'sap-integrator',
        decisions_owned: ['sap-integration-approach'],
        outputs: ['IntegrationReport'],
        file_ownership: ['src/integrations/sap/**'],
        tools: { write: true },
      },
    ]);
    expect(violations).toEqual([]);
  });
});

describe('checkRequiredRolesEnabled (I12)', () => {
  it('refuses disabling a required role at its applicable level', () => {
    const violations = checkRequiredRolesEnabled({ disable: ['architect'] }, 'L2');
    expect(violations).toHaveLength(1);
    expect(violations[0]?.code).toBe('CFG-505');
    expect(violations[0]?.message).toContain('architect');
  });

  it('allows disabling a role not required at the current level', () => {
    const violations = checkRequiredRolesEnabled({ disable: ['architect'] }, 'L0');
    expect(violations).toEqual([]);
  });

  it('allows a roster with nothing disabled', () => {
    const violations = checkRequiredRolesEnabled({}, 'L2');
    expect(violations).toEqual([]);
  });
});
