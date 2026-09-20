/**
 * `@forge/engine/budget` — `06` §6.9's three budget levels made real: admission control before launch,
 * period budgets blocking new runs, and a real (not silent) breach response.
 *
 * @see specs/06 §6.9
 * @see specs/20 §20.8, §20.10 S9
 * @see PLAN-M5.md P17
 */
export { canAdmit, explainAdmission, type AdmissionDecision } from './admit.ts';
export { onBudgetBreach } from './breach.ts';
export { computeLiveBudgetState, type BudgetConfig } from './live-state.ts';
export type { BreachResponse, BudgetBreachLevel, BudgetState } from './types.ts';
