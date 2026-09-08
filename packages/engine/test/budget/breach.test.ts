/**
 * `onBudgetBreach` — `20` §20.8's own enforcement-points table turned into a real response per level.
 *
 * @see specs/06 §6.9
 * @see specs/20 §20.8
 * @see PLAN-M5.md P17
 */
import { describe, expect, it } from 'vitest';

import { onBudgetBreach } from '../../src/budget/breach.ts';
import type { BudgetState } from '../../src/budget/types.ts';

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

describe('onBudgetBreach', () => {
  it('a step-level breach always fails the step, regardless of the configured onBreach policy', () => {
    for (const onBreach of ['pause', 'finish-lanes', 'abort'] as const) {
      expect(onBudgetBreach('step', state({ onBreach }))).toEqual({ kind: 'fail-step' });
    }
  });

  it('a period-level breach always refuses a new run, regardless of the configured onBreach policy', () => {
    for (const onBreach of ['pause', 'finish-lanes', 'abort'] as const) {
      expect(onBudgetBreach('period', state({ onBreach }))).toEqual({ kind: 'refuse-new-run' });
    }
  });

  it.each(['pause', 'finish-lanes', 'abort'] as const)(
    'a run-level breach applies the configured onBreach policy verbatim (%s), not conflated with any other kind',
    (onBreach) => {
      expect(onBudgetBreach('run', state({ onBreach }))).toEqual({ kind: onBreach });
    },
  );

  it('pause and finish-lanes are genuinely distinguished in the returned response, not collapsed to one', () => {
    const pauseResponse = onBudgetBreach('run', state({ onBreach: 'pause' }));
    const finishLanesResponse = onBudgetBreach('run', state({ onBreach: 'finish-lanes' }));
    expect(pauseResponse).not.toEqual(finishLanesResponse);
  });
});
