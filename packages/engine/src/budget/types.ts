/**
 * `06` §6.9's three budget levels (step/run/period) and `20` §20.8's own enforcement-points table, made
 * into real admission control and a real breach response.
 *
 * @see specs/06 §6.9
 * @see specs/20 §20.8, §20.10 S9
 * @see PLAN-M5.md P17
 */

/** `PLAN-M5.md`'s own bullet (`{ perRunUsd, perStepUsdDefault, dailyUsd, onBreach }` "plus live spend") —
 * the "plus live spend" half turns out to be two more fields, not an implicit extra: `canAdmit` needs the
 * run's own spend-so-far to project against `perRunUsd`, and the period check needs today's own
 * spend-so-far against `dailyUsd`, independently (a run can be well under its own cap while the day as a
 * whole is not, and vice versa). Both are sourced from `@forge/telemetry` P7's own `attributedSpend`/
 * ledger projection, summed by whoever constructs this — this module has no ledger access of its own,
 * matching `checkBudget`'s own established "the caller sums, this module only decides" split (`ledger.ts`'s
 * own doc comment). `perStepUsdDefault` is carried for completeness (a caller assembling `BudgetState` from
 * project config has one place to find every budget-shaped value) but read by nothing in this module: a
 * step's own per-step cap is already compiled onto `StepNode.limits.maxCostUsd` (`@forge/engine/plan`, P10)
 * before `canAdmit` ever sees it, and enforcing it *during* a session (`06` §6.9: "FORGE also aborts the
 * session when the running total exceeds it") is `@forge/engine/dispatch`'s own concern (P15), not
 * admission control's. */
export interface BudgetState {
  readonly perRunUsd: number;
  readonly perStepUsdDefault: number;
  readonly dailyUsd: number;
  /** `20` §20.8's own enforcement table: only the *run* level actually consults this — step breach
   * always fails the step (`06` §6.8's own `budget` class, P16's own `classifyFailure`/`decideRetry`
   * machinery takes it from there); period breach always refuses a new run outright ("new runs refused
   * until reset or override," no configurable choice named anywhere in the spec pack). `onBudgetBreach`
   * below reflects this: `state.onBreach` is only ever read for `level: 'run'`. */
  readonly onBreach: 'pause' | 'finish-lanes' | 'abort';
  readonly runSpentUsd: number;
  readonly dailySpentUsd: number;
}

export type BudgetBreachLevel = 'step' | 'run' | 'period';

/** `PLAN-M5.md`'s own Checks text: "`pause` and `finish-lanes` are distinguished in their returned
 * response, not conflated." A single flat `'pause' | 'finish-lanes' | 'abort' | ...` enum would still
 * technically satisfy that sentence, but would misrepresent what this function actually decides: `20`
 * §20.8's own table gives step/run/period three *categorically different* kinds of response (fail one
 * step and let P16's own escalation machinery take it from there; apply a user-configured run-wide
 * policy; refuse a new run outright), not three flavours of the same thing. A discriminated union keyed
 * on `kind`, matching every other multi-shaped decision this package already returns this way (e.g.
 * `@forge/vcs`'s own `MergeOutcome`), makes which shape a caller gets for which level explicit at the
 * type level rather than a convention the caller has to already know. */
export type BreachResponse =
  | { readonly kind: 'fail-step' }
  | { readonly kind: 'pause' | 'finish-lanes' | 'abort' }
  | { readonly kind: 'refuse-new-run' };
