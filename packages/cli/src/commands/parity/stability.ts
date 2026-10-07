/**
 * The stability probe (`13` F-TEST-9): "a reference that disagrees with itself is not an oracle." At
 * capture, every one of a case's `stability.runs` runs against the reference must be equal AFTER
 * normalisation, or the case is `unstable` and capture refuses; at check, the identical probe runs
 * against the candidate, and the value the runs SHARE — never an arbitrarily chosen single run — is
 * what is compared with the capture. Stability is a sample, not a proof: a case that varies too
 * rarely for `stability.runs` runs to show it can still read `match`.
 *
 * This module is deliberately generic over `T` (the already-normalised value being compared across
 * runs) rather than tied to one surface's shape: `compare.ts` is the one caller that knows what `T`
 * is for a given case (a string for a text target, a structured value for `library`), and whether
 * this is being asked about the reference (at capture) or the candidate (at check) is purely a matter
 * of what its caller passes in — the probe itself has no notion of "which side".
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M16.md P4
 */

/** The result of probing `stability.runs` already-normalised runs for agreement. */
export type StabilityOutcome<T> =
  { readonly stable: true; readonly shared: T } | { readonly stable: false };

/**
 * Decides whether `normalizedRuns` all agree, per `isEqual`, and if so returns the value they share.
 *
 * Checks EVERY run against the first, not merely a single pair: a stability check that only compares
 * `runs[0]` with `runs[1]` (or returns `runs[0]` unconditionally) would let a case that disagrees on,
 * say, its fourth run of five read `match` by luck — exactly the "sampling is not proof" risk `13`
 * F-TEST-9 names, made worse rather than merely tolerated by a check that is not actually exhaustive
 * over every run it was given. Picking `normalizedRuns[0]` as `shared` once agreement holds is
 * arbitrary only in appearance: by the time `stable: true` is returned every run has already been
 * proven equal to it, so "the first run" and "the value the runs share" are the same bytes — the
 * DECISION this function makes explicit is to always name that shared value via the first index,
 * rather than the last or a fresh re-derivation, so a reader never has to wonder which run a `match`
 * or `mismatch` verdict was actually computed against.
 *
 * @param normalizedRuns every run's own value, already normalised (this function does not normalise
 * anything itself — that is `compare.ts`'s job, done once per run before stability is asked about the
 * results).
 * @param isEqual how two normalised values of `T` compare — a cheap `===` for a text target's string,
 * or a structural comparison for `library`'s own value.
 * @throws {RangeError} if `normalizedRuns` is empty — a programming error in the caller, since
 * `stability.runs` is validated to 2-10 before any run happens (`declaration.ts`), never something a
 * well-formed declaration can trigger. (Narrowed via "the first element is `undefined`" rather than
 * `.length === 0` directly, so this function needs no cast under `noUncheckedIndexedAccess` — sound
 * for every real caller in this piece, where `T` is always a defined string or observation value,
 * never a type that itself includes `undefined`.)
 */
export function decideStability<T>(
  normalizedRuns: readonly T[],
  isEqual: (a: T, b: T) => boolean,
): StabilityOutcome<T> {
  const representative = normalizedRuns[0];
  if (representative === undefined) {
    throw new RangeError('decideStability requires at least one run; the caller passed none.');
  }
  const stable = normalizedRuns.every((run) => isEqual(run, representative));
  return stable ? { stable: true, shared: representative } : { stable: false };
}
