/**
 * `checkRequiredRoles`, `checkCustomAgents`, `checkSplitFileOwnership` — `15` §15.3.3/§15.3.4.
 *
 * @see specs/15 §15.3.3
 * @see specs/15 §15.3.4
 * @see PLAN-M2.md P3
 */
import { describe, expect, it } from 'vitest';

import {
  checkCustomAgents,
  checkRequiredRoles,
  checkSplitFileOwnership,
  isLevelAtLeast,
} from '../../src/agents/roles.ts';
import type { RosterConfig } from '../../src/agents/schema.ts';

describe('isLevelAtLeast', () => {
  it('orders L0 through L4 ordinally', () => {
    expect(isLevelAtLeast('L2', 'L1')).toBe(true);
    expect(isLevelAtLeast('L1', 'L2')).toBe(false);
    expect(isLevelAtLeast('L2', 'L2')).toBe(true);
  });
});

describe('checkRequiredRoles', () => {
  it('refuses disabling reviewer, naming autonomy settings as the alternative', () => {
    const roster: RosterConfig = { disable: ['reviewer'] };
    const violations = checkRequiredRoles(roster, 'L0');
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail).toMatch(/autonomy/);
  });

  it('refuses disabling test-architect at L1+, naming the failure mode', () => {
    const roster: RosterConfig = { disable: ['test-architect'] };
    const violations = checkRequiredRoles(roster, 'L1');
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail).toMatch(/failure modes FORGE exists to prevent/);
  });

  it('does not refuse test-architect below its required level', () => {
    const roster: RosterConfig = { disable: ['test-architect'] };
    expect(checkRequiredRoles(roster, 'L0')).toEqual([]);
  });

  it('refuses disabling pm/architect only at L2+', () => {
    const roster: RosterConfig = { disable: ['pm', 'architect'] };
    expect(checkRequiredRoles(roster, 'L1')).toEqual([]);
    expect(checkRequiredRoles(roster, 'L2')).toHaveLength(2);
  });

  it('allows disabling a role that is not in REQUIRED_ROLES at all', () => {
    const roster: RosterConfig = { disable: ['ux', 'mobile'] };
    expect(checkRequiredRoles(roster, 'L4')).toEqual([]);
  });

  it('allows an empty roster with nothing disabled', () => {
    expect(checkRequiredRoles({}, 'L4')).toEqual([]);
  });

  it('treats roster.enable as overriding roster.disable for the same role (undoing a preset disable)', () => {
    const roster: RosterConfig = { disable: ['reviewer'], enable: ['reviewer'] };
    expect(checkRequiredRoles(roster, 'L0')).toEqual([]);
  });

  it('still refuses a different disabled required role even when an unrelated one is enabled', () => {
    const roster: RosterConfig = { disable: ['reviewer', 'orchestrator'], enable: ['reviewer'] };
    const violations = checkRequiredRoles(roster, 'L0');
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail).toMatch(/orchestrator/);
  });

  it('is unaffected by roster.enable naming a role that was never disabled, or that is not required at all', () => {
    const roster: RosterConfig = { enable: ['reviewer', 'compliance'] };
    expect(checkRequiredRoles(roster, 'L4')).toEqual([]);
  });
});

describe('checkCustomAgents (15 §15.3.4)', () => {
  it('refuses a custom agent missing decisions_owned, outputs, file_ownership, or tools', () => {
    const roster: RosterConfig = { add: [{ id: 'sap-integrator' }] };
    const violations = checkCustomAgents(roster);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail).toMatch(/decisions_owned, outputs, file_ownership, tools/);
    expect(violations[0]?.detail).toMatch(/no unconstrained agent/);
  });

  it('accepts a custom agent declaring all four', () => {
    const roster: RosterConfig = {
      add: [
        {
          id: 'sap-integrator',
          decisions_owned: ['x'],
          outputs: ['y'],
          file_ownership: ['z'],
          tools: {},
        },
      ],
    };
    expect(checkCustomAgents(roster)).toEqual([]);
  });

  it('refuses an empty-array field the same as a missing one', () => {
    const roster: RosterConfig = {
      add: [
        {
          id: 'sap-integrator',
          decisions_owned: [],
          outputs: ['y'],
          file_ownership: ['z'],
          tools: {},
        },
      ],
    };
    const violations = checkCustomAgents(roster);
    expect(violations[0]?.detail).toMatch(/decisions_owned/);
  });

  it('allows an empty roster with no custom agents', () => {
    expect(checkCustomAgents({})).toEqual([]);
  });
});

describe('checkSplitFileOwnership (15 §15.3.3)', () => {
  it('allows disjoint split siblings', () => {
    const roster: RosterConfig = {
      split: {
        backend: [
          { id: 'backend-api', file_ownership: ['src/api/**'] },
          { id: 'backend-worker', file_ownership: ['src/worker/**'] },
        ],
      },
    };
    expect(checkSplitFileOwnership(roster)).toEqual([]);
  });

  it('refuses two split siblings claiming the same file_ownership path', () => {
    const roster: RosterConfig = {
      split: {
        backend: [
          { id: 'backend-api', file_ownership: ['src/api/**'] },
          { id: 'backend-worker', file_ownership: ['src/api/**'] },
        ],
      },
    };
    const violations = checkSplitFileOwnership(roster);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail).toMatch(/backend-api.*backend-worker|src\/api\/\*\*/);
  });

  it('checks every pair, not just adjacent ones, among three or more siblings', () => {
    const roster: RosterConfig = {
      split: {
        backend: [
          { id: 'a', file_ownership: ['src/shared/**'] },
          { id: 'b', file_ownership: ['src/other/**'] },
          { id: 'c', file_ownership: ['src/shared/**'] },
        ],
      },
    };
    const violations = checkSplitFileOwnership(roster);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail).toMatch(/"a".*"c"/);
  });

  it('allows a roster with no split at all', () => {
    expect(checkSplitFileOwnership({})).toEqual([]);
  });

  it('treats a first sibling with no file_ownership at all as claiming nothing, not a crash', () => {
    const roster: RosterConfig = {
      split: {
        backend: [
          { id: 'backend-api' },
          { id: 'backend-worker', file_ownership: ['src/worker/**'] },
        ],
      },
    };
    expect(checkSplitFileOwnership(roster)).toEqual([]);
  });

  it('treats a second sibling with no file_ownership at all as claiming nothing, not a crash', () => {
    const roster: RosterConfig = {
      split: {
        backend: [{ id: 'backend-api', file_ownership: ['src/api/**'] }, { id: 'backend-worker' }],
      },
    };
    expect(checkSplitFileOwnership(roster)).toEqual([]);
  });
});
