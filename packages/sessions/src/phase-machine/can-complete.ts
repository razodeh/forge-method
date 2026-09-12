/**
 * `canComplete` — `16` §16.5's own literal, mandatory write-back gate: "`forge session` will not
 * mark a session `complete` until every decision has an artifact reference and every action has an
 * owner... Sessions with zero decisions and zero actions are recorded as `inconclusive` with a stated
 * reason -- which is honest, and sometimes correct."
 *
 * Pure and total over `SessionState` -- never throws, never looks outside the value it is given.
 *
 * @see specs/16 §16.5
 * @see PLAN-M10.md P9
 */
import type { SessionState } from './types.ts';

function isNonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function canComplete(state: SessionState): boolean {
  const hasAnyOutcome = state.decisions.length > 0 || state.actions.length > 0;

  if (!hasAnyOutcome) {
    // The one legitimate shape with no decisions or actions at all: explicitly inconclusive, with a
    // real, stated reason -- never a silent, unexplained "nothing happened."
    return isNonEmpty(state.inconclusiveReason);
  }

  return (
    state.decisions.every((decision) => isNonEmpty(decision.artifactRef)) &&
    state.actions.every((action) => isNonEmpty(action.owner))
  );
}
