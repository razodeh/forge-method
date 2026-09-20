/**
 * Turns the reason a run ended `failed` (`RunFailed`'s payload, read back into `RunState.runFailure`)
 * into the remedy-bearing `ForgeError` every other refusal prints (`PLAN-M13.md` P12, `Q208` finding 1).
 *
 * `forge run` used to print only `status=failed`; the only clue to a budget refusal was the absence of
 * events. A budget refusal maps to `BUD-003` (exit 4, as `BUD-002`); every other failed run maps to
 * `RUN-085` (exit 1) carrying the engine's own one-line diagnosis.
 *
 * @see specs/02 §2.6
 * @see specs/06 §6.9
 */
import { ForgeError } from '@forge/core';
import type { RunState } from '@forge/engine/resume';

import { sanitizeRefusalText } from './vcs-refusal.ts';

function usd(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `$${value.toFixed(value > 0 && value < 0.01 ? 4 : 2)}`
    : 'an unknown amount';
}

function capName(level: unknown): string {
  return level === 'period' ? 'daily budget of' : 'run budget of';
}

/** The error to print for a failed run, or `undefined` when the run did not fail or the log carries no
 * reason (a run recorded before `RunFailed` had a payload: nothing is invented for it). Every string that
 * came from the log (step ids, the engine's summary) is stripped of terminal escapes first: step ids can
 * embed run input text. */
export function runFailureError(runState: RunState): ForgeError | undefined {
  if (runState.runStatus !== 'failed') return undefined;
  const failure = runState.runFailure;
  if (failure === undefined) return undefined;

  const refused = failure.unfinished.find((entry) => entry.cause.kind === 'budget');
  if (refused !== undefined) {
    const { cause } = refused;
    const spent = typeof cause['spentUsd'] === 'number' ? cause['spentUsd'] : Number.NaN;
    const cap = typeof cause['capUsd'] === 'number' ? cause['capUsd'] : Number.NaN;
    return new ForgeError('BUD-003', {
      stepId: sanitizeRefusalText(refused.stepId),
      cap: `${capName(cause['level'])} ${usd(cap)}`,
      reservation: usd(cause['reservationUsd']),
      spent: usd(spent),
    });
  }
  return new ForgeError('RUN-085', { summary: sanitizeRefusalText(failure.message) });
}

/** One extra line for a run that failed for a budget reason and ALSO had a step fail: raising the budget will
 * not fix the second problem, and `BUD-003` alone would let the user believe it will. */
export function runFailureNote(runState: RunState): string | undefined {
  const failure = runState.runFailure;
  if (runState.runStatus !== 'failed' || failure === undefined) return undefined;
  if (failure.reason !== 'budget' || failure.failedTotal === 0) return undefined;
  const ids = failure.failedSteps.slice(0, 5).map(sanitizeRefusalText).join(', ');
  return `Also: ${String(failure.failedTotal)} step(s) failed for another reason (${ids}${failure.failedTotal > 5 ? ', ...' : ''}); raising the budget will not fix that. Run \`forge logs\` to read them.`;
}
