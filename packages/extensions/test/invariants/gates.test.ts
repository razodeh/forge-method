/**
 * `checkGateApprovalShape` (I3), `checkGateHasChecks` (I4), `checkAlwaysHumanNotDowngraded` (I5) —
 * `15` §15.10's gate invariants.
 *
 * @see specs/15 §15.10
 * @see PLAN-M2.md P8
 */
import { describe, expect, it } from 'vitest';

import {
  checkAlwaysHumanNotDowngraded,
  checkGateApprovalShape,
  checkGateHasChecks,
} from '../../src/invariants/gates.ts';

describe('checkGateApprovalShape (I3)', () => {
  it('refuses a gate whose required check is disabled', () => {
    const violations = checkGateApprovalShape([
      {
        gateId: 'G-Verify',
        checkIds: ['coverage', 'lint'],
        requiredCheckIds: ['coverage'],
        disabledCheckIds: ['coverage'],
      },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.code).toBe('GATE-501');
    expect(violations[0]?.message).toContain('G-Verify');
  });

  it('allows a gate whose required checks are all enabled', () => {
    const violations = checkGateApprovalShape([
      {
        gateId: 'G-Verify',
        checkIds: ['coverage'],
        requiredCheckIds: ['coverage'],
        disabledCheckIds: [],
      },
    ]);
    expect(violations).toEqual([]);
  });

  it('does not flag a disabled check that is not required', () => {
    const violations = checkGateApprovalShape([
      {
        gateId: 'G-Verify',
        checkIds: ['coverage', 'lint'],
        requiredCheckIds: ['coverage'],
        disabledCheckIds: ['lint'],
      },
    ]);
    expect(violations).toEqual([]);
  });

  it('reports one violation per disabled required check', () => {
    const violations = checkGateApprovalShape([
      {
        gateId: 'G-Verify',
        checkIds: ['coverage', 'lint'],
        requiredCheckIds: ['coverage', 'lint'],
        disabledCheckIds: ['coverage', 'lint'],
      },
    ]);
    expect(violations).toHaveLength(2);
  });
});

describe('checkGateHasChecks (I4)', () => {
  it('refuses a gate defined with zero checks', () => {
    const violations = checkGateHasChecks([
      { gateId: 'G-Design', checkIds: [], requiredCheckIds: [], disabledCheckIds: [] },
    ]);
    expect(violations).toEqual([expect.objectContaining({ id: 'I4', code: 'GATE-502' })]);
  });

  it('allows a gate with at least one check', () => {
    const violations = checkGateHasChecks([
      { gateId: 'G-Design', checkIds: ['coverage'], requiredCheckIds: [], disabledCheckIds: [] },
    ]);
    expect(violations).toEqual([]);
  });
});

describe('checkAlwaysHumanNotDowngraded (I5)', () => {
  it('refuses downgrading an alwaysHuman gate', () => {
    const violations = checkAlwaysHumanNotDowngraded([
      { gateId: 'G-Deliver', baseAutonomy: 'alwaysHuman', overlayAutonomy: 'autonomous' },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.code).toBe('GATE-503');
    expect(violations[0]?.message).toContain('G-Deliver');
  });

  it('allows an overlay that keeps an alwaysHuman gate alwaysHuman', () => {
    const violations = checkAlwaysHumanNotDowngraded([
      { gateId: 'G-Deliver', baseAutonomy: 'alwaysHuman', overlayAutonomy: 'alwaysHuman' },
    ]);
    expect(violations).toEqual([]);
  });

  it('does not flag a gate that was never alwaysHuman to begin with', () => {
    const violations = checkAlwaysHumanNotDowngraded([
      { gateId: 'G-Verify', baseAutonomy: 'supervised', overlayAutonomy: 'autonomous' },
    ]);
    expect(violations).toEqual([]);
  });
});
