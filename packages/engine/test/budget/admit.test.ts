/**
 * `canAdmit` — `20` §20.8's own "admission control before launch, not detection after the fact."
 *
 * @see specs/06 §6.9
 * @see specs/20 §20.8
 * @see PLAN-M5.md P17
 */
import { describe, expect, it } from 'vitest';

import { canAdmit } from '../../src/budget/admit.ts';
import type { BudgetState } from '../../src/budget/types.ts';
import type { StepNode } from '../../src/plan/index.ts';

function node(overrides: Partial<StepNode> & { readonly id: string }): StepNode {
  return {
    kind: 'agent',
    inputs: [],
    outputs: [],
    dependsOn: [],
    produces: [],
    consumes: [],
    retry: { maxAttempts: 1, backoffMs: [1000, 30_000], retryOn: [] },
    limits: { maxTurns: 20, wallClockMs: 600_000, maxCostUsd: 1 },
    idempotencyKey: overrides.id,
    onFailure: 'block',
    ...overrides,
  };
}

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

describe('canAdmit', () => {
  it('admits a step well within both the run and period budget', () => {
    const stepNode = node({
      id: 'wf:step',
      limits: { maxTurns: 20, wallClockMs: 600_000, maxCostUsd: 1 },
    });
    expect(canAdmit(stepNode, state({ perRunUsd: 10, runSpentUsd: 2 }))).toBe(true);
  });

  it("refuses when the step's own maxCostUsd would push projected run spend to exactly the cap -- the boundary is breached, not ok", () => {
    const stepNode = node({
      id: 'wf:step',
      limits: { maxTurns: 20, wallClockMs: 600_000, maxCostUsd: 2 },
    });
    // runSpentUsd (8) + maxCostUsd (2) === perRunUsd (10) exactly.
    expect(canAdmit(stepNode, state({ perRunUsd: 10, runSpentUsd: 8 }))).toBe(false);
  });

  it('admits when projected run spend lands exactly one cent under the cap', () => {
    const stepNode = node({
      id: 'wf:step',
      limits: { maxTurns: 20, wallClockMs: 600_000, maxCostUsd: 1.99 },
    });
    expect(canAdmit(stepNode, state({ perRunUsd: 10, runSpentUsd: 8 }))).toBe(true);
  });

  it('refuses when projected run spend would exceed the cap outright', () => {
    const stepNode = node({
      id: 'wf:step',
      limits: { maxTurns: 20, wallClockMs: 600_000, maxCostUsd: 5 },
    });
    expect(canAdmit(stepNode, state({ perRunUsd: 10, runSpentUsd: 8 }))).toBe(false);
  });

  it('refuses admission once the period (daily) budget is already breached, regardless of run-level headroom', () => {
    const stepNode = node({
      id: 'wf:step',
      limits: { maxTurns: 20, wallClockMs: 600_000, maxCostUsd: 0.01 },
    });
    // Run budget has plenty of room (0 spent of 10), but today's own spend already meets the daily cap.
    const breachedToday = state({ perRunUsd: 10, runSpentUsd: 0, dailyUsd: 50, dailySpentUsd: 50 });
    expect(canAdmit(stepNode, breachedToday)).toBe(false);
  });

  it('admits when the period budget still has headroom, even close to its own cap', () => {
    const stepNode = node({
      id: 'wf:step',
      limits: { maxTurns: 20, wallClockMs: 600_000, maxCostUsd: 0.01 },
    });
    // Projected total (49.98 + 0.01 = 49.99) lands genuinely under the 50 cap, not exactly on it --
    // the boundary case itself is covered by the dedicated test below.
    const almostBreached = state({
      perRunUsd: 10,
      runSpentUsd: 0,
      dailyUsd: 50,
      dailySpentUsd: 49.98,
    });
    expect(canAdmit(stepNode, almostBreached)).toBe(true);
  });

  it('refuses a step whose own cost alone would push the daily total past its cap, even though dailySpentUsd alone is still under it -- admission control, not detection after the fact', () => {
    // A gauntlet-loop critic round found an earlier version of this function only compared
    // dailySpentUsd directly against dailyUsd, with no equivalent "+ node.limits.maxCostUsd" the
    // run-level check right beside it already has -- admitting a step guaranteed to blow through the
    // daily cap and only catching the breach on some later call, exactly the "detection after the
    // fact" this function's own header explicitly disclaims.
    const stepNode = node({
      id: 'wf:step',
      limits: { maxTurns: 20, wallClockMs: 600_000, maxCostUsd: 20 },
    });
    const stillUnderCapAlone = state({
      perRunUsd: 1000,
      runSpentUsd: 0,
      dailyUsd: 100,
      dailySpentUsd: 90,
    });
    expect(canAdmit(stepNode, stillUnderCapAlone)).toBe(false);
  });

  it('a step with maxCostUsd of exactly 0 is still refused once run spend already meets the cap', () => {
    const stepNode = node({
      id: 'wf:step',
      limits: { maxTurns: 20, wallClockMs: 600_000, maxCostUsd: 0 },
    });
    expect(canAdmit(stepNode, state({ perRunUsd: 10, runSpentUsd: 10 }))).toBe(false);
  });
});
