/**
 * `checkModuleCeilings`, `isModuleEscalationActive`, `moduleOwning` — `19` §19.1's own ceiling and
 * expiring-escalation rules.
 *
 * @see specs/19 §19.1
 * @see PLAN-M10.md P2
 */
import { describe, expect, it } from 'vitest';

import {
  checkModuleCeilings,
  isModuleEscalationActive,
  moduleOwning,
} from '../../src/module/ceiling.ts';
import type {
  ModuleCeilingCheckInput,
  ModuleDefinition,
  ModuleEscalation,
  ModuleResolution,
} from '../../src/module/types.ts';

const NOT_REVIEW_NOT_OPS = { isReviewOrCritic: false, isOps: false };
const OPS = { isReviewOrCritic: false, isOps: true };

const NOW = Date.parse('2026-09-11T00:00:00.000Z');

function escalation(overrides: Partial<ModuleEscalation> = {}): ModuleEscalation {
  return {
    agent: 'sre',
    grant: { deploy: true },
    reason: 'SRE role owns the deploy CLI',
    approvedBy: 'radwan',
    approvedAt: '2026-08-01T00:00:00.000Z',
    expires: '2026-11-19T00:00:00.000Z',
    ...overrides,
  };
}

describe('isModuleEscalationActive', () => {
  it('is active when expires is in the future', () => {
    expect(isModuleEscalationActive(escalation({ expires: '2026-11-19T00:00:00.000Z' }), NOW)).toBe(
      true,
    );
  });

  it('is not active when expires is in the past', () => {
    expect(isModuleEscalationActive(escalation({ expires: '2026-01-01T00:00:00.000Z' }), NOW)).toBe(
      false,
    );
  });

  it('is not active when expires is exactly now (fail closed)', () => {
    expect(
      isModuleEscalationActive(escalation({ expires: new Date(NOW).toISOString() }), NOW),
    ).toBe(false);
  });

  it('is not active when expires does not parse as a real instant', () => {
    expect(isModuleEscalationActive(escalation({ expires: 'not-a-date' }), NOW)).toBe(false);
  });
});

describe('checkModuleCeilings', () => {
  const ceiling = { write: false, network: 'none' as const, deploy: false };

  function check(escalations: readonly ModuleEscalation[]): ModuleCeilingCheckInput {
    return {
      agentId: 'sre',
      roleTags: OPS,
      ceiling,
      requested: { deploy: true },
      escalations,
    };
  }

  it('a tool grant exceeding a declared ceiling fails with no escalation', () => {
    const violations = checkModuleCeilings([check([])], NOW);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.code).toBe('CFG-507');
    expect(violations[0]?.message).toMatch(/sre/);
    expect(violations[0]?.message).toMatch(/deploy/);
  });

  it('an escalation record with a future expiry suppresses the violation', () => {
    const violations = checkModuleCeilings(
      [check([escalation({ expires: '2027-01-01T00:00:00.000Z' })])],
      NOW,
    );
    expect(violations).toEqual([]);
  });

  it('an expired escalation record does not suppress the violation', () => {
    const violations = checkModuleCeilings(
      [check([escalation({ expires: '2026-01-01T00:00:00.000Z' })])],
      NOW,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.code).toBe('CFG-507');
  });

  it('a request already within the ceiling never needs an escalation at all', () => {
    const violations = checkModuleCeilings(
      [
        {
          agentId: 'backend',
          roleTags: NOT_REVIEW_NOT_OPS,
          ceiling: { write: true },
          requested: { write: false },
          escalations: [],
        },
      ],
      NOW,
    );
    expect(violations).toEqual([]);
  });
});

function definition(overrides: Partial<ModuleDefinition> & { id: string }): ModuleDefinition {
  return {
    name: overrides.id,
    version: '1.0.0',
    forgeVersion: '>=1.0 <2',
    requires: [],
    conflicts: [],
    levels: ['L1'],
    ceilings: {},
    provides: { agents: [] },
    ...overrides,
  };
}

describe('moduleOwning', () => {
  it('finds the sole module providing an agent id when there is no provides conflict', () => {
    const fmCore = definition({ id: 'fm-core', provides: { agents: ['architect'] } });
    const resolution: ModuleResolution = {
      modules: new Map([['fm-core', fmCore]]),
      provideConflicts: [],
    };
    expect(moduleOwning('architect', resolution)?.id).toBe('fm-core');
  });

  it('returns undefined when no installed module provides the agent id', () => {
    const fmCore = definition({ id: 'fm-core', provides: { agents: ['architect'] } });
    const resolution: ModuleResolution = {
      modules: new Map([['fm-core', fmCore]]),
      provideConflicts: [],
    };
    expect(moduleOwning('nonexistent', resolution)).toBeUndefined();
  });

  it('defers to the provide-conflict winner when two modules both provide the same agent id', () => {
    const fmA = definition({ id: 'fm-a', provides: { agents: ['backend'] } });
    const fmB = definition({ id: 'fm-b', provides: { agents: ['backend'] } });
    const resolution: ModuleResolution = {
      modules: new Map([
        ['fm-a', fmA],
        ['fm-b', fmB],
      ]),
      provideConflicts: [
        { kind: 'agents', id: 'backend', winner: 'fm-b', contributors: ['fm-a', 'fm-b'] },
      ],
    };
    expect(moduleOwning('backend', resolution)?.id).toBe('fm-b');
  });
});
