/**
 * `decideRetry`/`computeBackoff` — `06` §6.8's own `RetryPolicy` (`@forge/engine/plan`'s
 * `StepNodeRetryPolicy`) turned into a real decision and a real delay.
 *
 * @see specs/06 §6.8
 * @see specs/21 §21.1, §21.3
 * @see PLAN-M5.md P16
 */
import { ForgeError } from '@forge/core/errors';

import type { StepOutcome } from '../dispatch/index.ts';
import type { StepNodeRetryPolicy } from '../plan/index.ts';
import { classifyFailure, normaliseErrorSignature } from './classify.ts';

/** `06` §6.8's own never-retry rule: "a step that failed twice with the *same* error signature must not
 * be retried a third time identically." Two, not one — the first occurrence of a signature is not yet
 * evidence of a stuck loop, only a second, *matching* one is. */
const NEVER_RETRY_REPEAT_COUNT = 2;

/** `06` §6.8's own retry decision: has this step already been retried enough times, or hit the same
 * error signature enough times, to force escalation instead of another identical attempt?
 *
 * `attemptHistory` is every attempt made so far for this step, in order, ending with the just-failed
 * one this call is deciding about — every entry must itself be a failed `StepOutcome` (`classifyFailure`/
 * `normaliseErrorSignature` both throw `RUN-042` otherwise, so a mixed-status history fails loudly rather
 * than silently misclassifying a succeeded entry).
 *
 * The never-retry check runs *before*, and independently of, the `maxAttempts` check — `PLAN-M5.md`
 * P16's own Checks text is explicit that this must fire "even though maxAttempts isn't yet exhausted",
 * matching `06` §6.8's own "must not be retried a third time... regardless of remaining attempts"
 * framing for `escalate.afterAttempts`. */
export function decideRetry(
  policy: StepNodeRetryPolicy,
  attemptHistory: readonly StepOutcome[],
): 'retry' | 'escalate' {
  if (attemptHistory.length === 0) {
    throw new ForgeError('RUN-043', { attemptCount: attemptHistory.length });
  }
  // Required by noUncheckedIndexedAccess, not reachable in practice: the length check just above
  // already guarantees attemptHistory is non-empty by the time this index is read, so this branch can
  // never actually fire -- the same noUncheckedIndexedAccess-adjacent exemption category documented
  // elsewhere in this codebase (e.g. steps.ts's own buildCommitMessage), kept as the type checker's own
  // required form rather than a non-null assertion.
  const latest = attemptHistory[attemptHistory.length - 1];
  if (latest === undefined) {
    throw new ForgeError('RUN-043', { attemptCount: attemptHistory.length });
  }

  const failureClass = classifyFailure(latest);
  if (!(policy.retryOn as readonly string[]).includes(failureClass)) return 'escalate';

  const latestSignature = normaliseErrorSignature(latest);
  const matchingSignatures = attemptHistory.filter(
    (attempt) => normaliseErrorSignature(attempt) === latestSignature,
  );
  if (matchingSignatures.length >= NEVER_RETRY_REPEAT_COUNT) return 'escalate';

  if (attemptHistory.length >= policy.maxAttempts) return 'escalate';

  return 'retry';
}

/** FNV-1a (32-bit) over `seed` — the identical pure string hash `@forge/engine/scheduler`'s own
 * `orderReadyNodes` (`ordering.ts`) already uses for the same "deterministic pseudo-randomness from a
 * seed, per `21` §21.1, no `Math.random`" need, duplicated here rather than exported from a scheduler-
 * internal module a sibling submodule has no real reason to depend on for one small pure function.
 * Returns a fraction in `[0, 1)`, not the raw hash — `computeBackoff`'s own caller wants a jitter
 * *proportion*, not a hash value. */
function seededFraction(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0xffffffff;
}

/** Exponential backoff with jitter, clamped so the result always falls within `policy.backoffMs`'s own
 * `[initial, max]` range (`PLAN-M5.md` P16's own Checks text) — not "grows unbounded then jitters
 * downward from zero," which could jitter below `initial` entirely. `attemptNumber` is 1-indexed (1 for
 * the first retry): `initial * 2^(attemptNumber-1)`, capped at `max`, gives the *ceiling* for this
 * attempt; the deterministic jitter fraction (`seededFraction`, keyed by `seed` and `attemptNumber` so
 * two different attempts of the same step never draw the identical jitter) picks a value in
 * `[initial, ceiling]` rather than `[0, ceiling]`. `seed` is caller-supplied (a run id + step id is the
 * natural choice) rather than read from anywhere internal — the same "inject the source of variation"
 * discipline `21` §21.1 already holds every other non-deterministic-looking value in this build to. */
export function computeBackoff(
  policy: StepNodeRetryPolicy,
  attemptNumber: number,
  seed: string,
): number {
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1) {
    throw new ForgeError('RUN-044', { attemptNumber });
  }
  const [initialMs, maxMs] = policy.backoffMs;
  const exponentialMs = initialMs * 2 ** (attemptNumber - 1);
  const ceilingMs = Math.min(maxMs, exponentialMs);
  const jitterRangeMs = Math.max(0, ceilingMs - initialMs);
  const fraction = seededFraction(`${seed}:${String(attemptNumber)}`);
  return Math.round(initialMs + fraction * jitterRangeMs);
}
