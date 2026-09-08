/**
 * `onBudgetBreach` — `20` §20.8's own enforcement-points table turned into a real response per level.
 *
 * @see specs/06 §6.9
 * @see specs/20 §20.8
 * @see PLAN-M5.md P17
 */
import type { BreachResponse, BudgetBreachLevel, BudgetState } from './types.ts';

/** `20` §20.8's own table, one branch per row: `step` always fails the step (`06` §6.8's own `budget`
 * class takes it from there, via P16's `classifyFailure`/`decideRetry` — not this function's own
 * concern); `period` always refuses a new run outright, no configurable choice named anywhere in the
 * spec pack; only `run` actually consults `state.onBreach`, the one place `20` §20.8 names a real,
 * user-configured choice ("`budget.onBreach`: pause / finish-lanes / abort"). */
export function onBudgetBreach(level: BudgetBreachLevel, state: BudgetState): BreachResponse {
  switch (level) {
    case 'step':
      return { kind: 'fail-step' };
    case 'period':
      return { kind: 'refuse-new-run' };
    case 'run':
      return { kind: state.onBreach };
  }
}
