/**
 * `explainAdmission` — the same admission decision `canAdmit` makes, naming which cap refused a step and
 * the numbers that did not fit (`PLAN-M13.md` P12, `Q208` finding 1). `06` §6.9 / `20` §20.8: a step is not
 * launched unless the remaining budget covers its cap; on breach FORGE shows the breakdown.
 *
 * @see specs/06 §6.9
 * @see specs/20 §20.8
 */
import { describe, expect, it } from 'vitest';

import { canAdmit, explainAdmission } from '../../src/budget/admit.ts';
import type { BudgetState } from '../../src/budget/types.ts';
import { node } from '../dispatch/helpers.ts';

function state(overrides: Partial<BudgetState> = {}): BudgetState {
  return {
    perRunUsd: 10,
    perStepUsdDefault: 1,
    dailyUsd: 100,
    onBreach: 'pause',
    runSpentUsd: 0,
    dailySpentUsd: 0,
    ...overrides,
  };
}

const withCost = (id: string, maxCostUsd: number) =>
  node({ id, kind: 'agent', limits: { maxTurns: 1, wallClockMs: 1, maxCostUsd } });

describe('explainAdmission', () => {
  it('admits a step whose reservation fits under both caps', () => {
    expect(explainAdmission(withCost('wf:a', 3), state({ runSpentUsd: 2 }))).toEqual({
      admit: true,
    });
  });

  it('names the run cap, the step, its reservation, what was spent and the cap when the run cap refuses', () => {
    const decision = explainAdmission(
      withCost('wf:big', 3),
      state({ perRunUsd: 2, runSpentUsd: 0.5 }),
    );
    expect(decision).toEqual({
      admit: false,
      level: 'run',
      stepId: 'wf:big',
      reservationUsd: 3,
      spentUsd: 0.5,
      capUsd: 2,
    });
  });

  it("names the period cap when the daily cap refuses, using the day's spend", () => {
    const decision = explainAdmission(
      withCost('wf:big', 3),
      state({ dailyUsd: 5, dailySpentUsd: 4, runSpentUsd: 0 }),
    );
    expect(decision).toEqual({
      admit: false,
      level: 'period',
      stepId: 'wf:big',
      reservationUsd: 3,
      spentUsd: 4,
      capUsd: 5,
    });
  });

  it('refuses at the boundary exactly like canAdmit does (a projected spend equal to the cap is a breach)', () => {
    const boundary = state({ perRunUsd: 3 });
    expect(explainAdmission(withCost('wf:a', 3), boundary).admit).toBe(false);
    expect(explainAdmission(withCost('wf:a', 2.99), boundary).admit).toBe(true);
  });

  it('agrees with canAdmit for every combination tried', () => {
    for (const perRunUsd of [0, 1, 3, 3.01, 10]) {
      for (const runSpentUsd of [0, 0.5, 2.9]) {
        for (const cost of [0, 1, 3]) {
          const s = state({ perRunUsd, runSpentUsd });
          const n = withCost('wf:a', cost);
          expect(explainAdmission(n, s).admit).toBe(canAdmit(n, s));
        }
      }
    }
  });

  it('a step that reserves nothing is admitted while the cap is unreached, and refused once it is reached (the M5 P17 rule: a breach stops everything)', () => {
    expect(explainAdmission(withCost('wf:cmd', 0), state({ perRunUsd: 0.01 })).admit).toBe(true);
    expect(
      explainAdmission(withCost('wf:cmd', 0), state({ perRunUsd: 1, runSpentUsd: 1 })),
    ).toEqual({
      admit: false,
      level: 'run',
      stepId: 'wf:cmd',
      reservationUsd: 0,
      spentUsd: 1,
      capUsd: 1,
    });
  });
});
