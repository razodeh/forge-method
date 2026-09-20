/**
 * `canAdmit` — `20` §20.8's own "admission control before launch, not detection after the fact": a step
 * is inadmissible the instant its own declared cap plus current spend would exceed what remains.
 *
 * @see specs/06 §6.9
 * @see specs/20 §20.8
 * @see PLAN-M5.md P17
 */
import { checkBudget } from '@forge/telemetry/ledger';

import type { StepNode } from '../plan/index.ts';
import type { BudgetState } from './types.ts';

/** Two independent checks, either of which alone refuses admission — the run-level check (`node`'s own
 * declared `limits.maxCostUsd`, added to the run's own spend so far, against `perRunUsd`) and the
 * period-level check (the identical projection, `node`'s own cost added to today's own spend so far,
 * against `dailyUsd`). Both reuse `checkBudget` (`@forge/telemetry`, P7) rather than re-deriving its own
 * "the cap boundary is breached, never ok" off-by-one-sensitive comparison a second time here —
 * `PLAN-M5.md` P7's own Checks section names that boundary "a real financial bug, not a rounding nicety."
 *
 * A gauntlet-loop critic round found the period check originally compared `dailySpentUsd` alone, with no
 * `+ node.limits.maxCostUsd` term — meaning a step whose own cost alone would blow through the daily cap
 * was still admitted, the breach only caught on some *later* call once `dailySpentUsd` itself had already
 * crossed `dailyUsd` — exactly the "detection after the fact" this function's own header disclaims,
 * asymmetric with the run-level check right beside it. Fixed by projecting forward here too.
 *
 * The period check runs on *every* call, not only "a new run's very first admission" (`PLAN-M5.md`'s own
 * literal Checks wording) — a deliberate choice, not an oversight: `20` §20.8's own opening framing
 * ("cost is a safety property... an unbounded autonomous loop is a financial hazard") and "silent
 * continuation past a budget is never acceptable" both read as favouring the more conservative behaviour
 * once a real tradeoff exists, and one does here — the spec pack is genuinely silent on what should happen
 * to an *already In-flight* run's own future step admissions once the day's aggregate (which can be driven
 * by other, concurrent runs entirely) crosses `dailyUsd` mid-run: only stopping brand-new runs, or also
 * stopping every not-yet-admitted step of a run already underway. Checking unconditionally is the
 * strictly safer of the two: it still produces the literal described behaviour ("new runs refused") as a
 * consequence — a new run's very first `canAdmit` call is subject to the identical check — while also
 * refusing to admit *further* spend from an in-flight run once the same real condition holds, rather than
 * treating "already running" as a reason to keep spending past a breach nothing else in this spec section
 * ever describes as acceptable. Recorded as a reasoned default, not a settled question `@forge/engine`
 * elsewhere treats as certain (`SPEC-QUESTIONS.md` Q79): `onBudgetBreach('period', ...)`'s own response
 * (`refuse-new-run`) has no dedicated shape of its own for "an in-flight run's own already-running lanes
 * when this fires mid-run" — a caller hitting that case has no spec-named guidance beyond treating it the
 * same as a run-level `'pause'` (stop new admissions, let already-running lanes finish) would.
 *
 * A scoped verify round's own follow-up: this function's bare `boolean` return (`PLAN-M5.md`'s own literal
 * signature) cannot itself tell a caller *which* of the two checks refused a given call — a run-level
 * exhaustion and a period breach from an unrelated concurrent run are indistinguishable from the outside.
 * Left as is rather than widening the return shape beyond what `PLAN-M5.md` actually names: a caller that
 * wants to tell the two apart for its own logging/alerting can already reconstruct it from `budgetState`
 * itself (compare `runSpentUsd + node.limits.maxCostUsd` against `perRunUsd`, and separately against
 * `dailySpentUsd`/`dailyUsd`) — every value that reasoning needs is already a plain, public field on the
 * `BudgetState` the caller itself constructed, not something only this function's own internals can see. */
export function canAdmit(node: StepNode, budgetState: BudgetState): boolean {
  return explainAdmission(node, budgetState).admit;
}

/** Why one step was (not) admitted: the same two checks `canAdmit` makes, but naming which cap refused
 * the step so the run can say so (`PLAN-M13.md` P12, `Q208` finding 1). The period check is made first,
 * matching `canAdmit`'s original order, so a step refused by both reports the daily cap. `spentUsd` is
 * what has already been spent against that cap; `reservationUsd` is the step's own ceiling that did not
 * fit in `capUsd - spentUsd`. */
export type AdmissionDecision =
  | { readonly admit: true }
  | {
      readonly admit: false;
      readonly level: 'run' | 'period';
      readonly stepId: string;
      readonly reservationUsd: number;
      readonly spentUsd: number;
      readonly capUsd: number;
    };

export function explainAdmission(node: StepNode, budgetState: BudgetState): AdmissionDecision {
  const reservationUsd = node.limits.maxCostUsd;
  if (
    checkBudget({
      spent: budgetState.dailySpentUsd + reservationUsd,
      cap: budgetState.dailyUsd,
    }) === 'breached'
  ) {
    return {
      admit: false,
      level: 'period',
      stepId: node.id,
      reservationUsd,
      spentUsd: budgetState.dailySpentUsd,
      capUsd: budgetState.dailyUsd,
    };
  }
  if (
    checkBudget({
      spent: budgetState.runSpentUsd + reservationUsd,
      cap: budgetState.perRunUsd,
    }) === 'breached'
  ) {
    return {
      admit: false,
      level: 'run',
      stepId: node.id,
      reservationUsd,
      spentUsd: budgetState.runSpentUsd,
      capUsd: budgetState.perRunUsd,
    };
  }
  return { admit: true };
}
