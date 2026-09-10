/**
 * `06` §6.3's own backpressure rule: on an adapter rate-limit signal, reduce effective concurrency
 * multiplicatively (halve, floor 1); restore it additively once a quiet period (no further signal) has
 * elapsed. A pure state machine over a signal stream — no wall-clock reads, no timers — the same
 * determinism mandate (`21` §21.1) every other `@forge/engine/scheduler` submodule already holds itself to,
 * and deliberately decoupled from `@forge/engine/scheduler` itself: nothing in this file imports, or is
 * imported by, `Scheduler` (`scheduler.ts`'s own new `setLimits` method is the seam a caller uses to feed
 * this state's own `ceiling` into it, each tick).
 *
 * Neither `06` nor `21` gives an exact quiet-period duration or additive-restoration step size — `21`'s own
 * open-decisions document (`specs/23`, on the *related* question of the default `--concurrency` value
 * itself) explicitly defers exact tuning to real evidence gathered later ("start at 3 ... set the default
 * from evidence"), so a reasoned, clearly-labelled placeholder here is the right amount of precision for
 * this milestone, not a gap to leave unbuilt. Modelled directly on TCP's own AIMD congestion control
 * (halve on a loss signal, add a fixed amount per interval of quiet) — the same shape `06` §6.3's own
 * wording ("multiplicatively"/"additively") already names, not a coincidence.
 *
 * @see specs/06 §6.3
 * @see specs/21 §21.1, §21.3
 * @see specs/23 (the sibling default-concurrency question, for why an unevidenced default is acceptable now)
 * @see PLAN-M5.md P13
 */

/** How long a *continuous* absence of any new rate-limit signal must hold before restoration starts
 * earning steps, and how often (once earning) one more step is added — kept as a single duration, matching
 * `06` §6.3's own text naming one single "quiet period," not two separately-tunable durations. 30 seconds:
 * long enough that a burst of several retries within the same underlying incident doesn't each look like an
 * independent "quiet period has passed," short enough that a real run recovers within a few minutes. */
const QUIET_PERIOD_MS = 30_000;

/** The fixed amount restored per elapsed quiet-period interval — "additively" (`06` §6.3's own word,
 * deliberately contrasted with the decrease's own "multiplicatively") means a flat increment, not a
 * fraction of `configuredCeiling`; `1` is the standard AIMD choice this shape is modelled on. */
const RESTORE_STEP = 1;

/** `ceiling` is always the *current* effective concurrency limit a caller should feed into
 * `admitsMoreConcurrency` (via `Scheduler.setLimits`) — the only field most callers ever need to read.
 * `ceilingAtLastSignal`/`lastSignalAt` are `undefined` together, exactly when no signal has ever been
 * received or every step earned by the most recent signal has already been fully restored: `tick` clears
 * both back to `undefined` once `ceiling` reaches `configuredCeiling` again, so "currently under
 * backpressure" is always exactly `lastSignalAt !== undefined`, not a separate flag that could drift out of
 * sync with `ceiling` itself. */
export interface BackpressureState {
  readonly configuredCeiling: number;
  readonly ceiling: number;
  readonly ceilingAtLastSignal: number | undefined;
  readonly lastSignalAt: number | undefined;
}

/** `configuredCeiling` reaches this module from exactly one real construction site today, already gated by
 * `@forge/schemas`' own `execution.concurrency` schema (`z.number().int().positive()`) — a critic round
 * confirmed no code path hands this function anything else. Guarded anyway, the same "kept as a real
 * runtime check even where provably unreachable through this module's own real callers today" choice made
 * throughout `@forge/engine`: a non-finite or non-positive value here would otherwise flow straight into
 * every later `Math.min`/`Math.max` call in this file, and — unlike an out-of-range value elsewhere in this
 * module, which self-corrects on the next well-formed call — a `NaN` specifically can never self-heal
 * (`NaN` compares `false` against everything, including the "have we fully restored" check that would
 * otherwise reset this state), so the safety margin here is worth the two extra lines. Falls back to the
 * smallest valid ceiling (`1`), not the largest: an operator who somehow triggers this fallback gets a run
 * that is merely slow, never one silently running at an unbounded or unintended concurrency. */
function sanitizedCeiling(value: number): number {
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1;
}

/** The starting state for a run configured at `configuredCeiling` concurrency (`06` §6.3's own
 * `--concurrency` value) — no signal received yet, so the effective ceiling starts equal to the configured
 * one. */
export function createBackpressureState(configuredCeiling: number): BackpressureState {
  const ceiling = sanitizedCeiling(configuredCeiling);
  return {
    configuredCeiling: ceiling,
    ceiling,
    ceilingAtLastSignal: undefined,
    lastSignalAt: undefined,
  };
}

/** The effective ceiling `state` implies *as of* `now`, folding in however much additive restoration would
 * already have accrued since the most recent signal — shared by both `tick` (below) and `onRateLimitSignal`
 * so the two never compute this differently. Never returns less than `state.ceiling` itself: this matters
 * for a `now` that lands *between* `lastSignalAt` and a `now` some later, already-applied `tick` call used
 * (so `state.ceiling` already reflects more restoration than a fresh computation from `now` alone would
 * suggest) — `tick` itself (below) separately, independently guards against ever regressing its own return
 * value, so this clamp is not what protects a `tick`-only sequence (confirmed by a verify round: reverting
 * just this one line still leaves every `tick`-only regression scenario correctly handled by `tick`'s own
 * check); this clamp is what keeps `onRateLimitSignal`'s own halving input correct in the scenario just
 * described, which nothing else in this module guards. */
function ceilingAsOf(state: BackpressureState, now: number): number {
  if (state.lastSignalAt === undefined || state.ceilingAtLastSignal === undefined)
    return state.ceiling;
  const elapsed = now - state.lastSignalAt;
  const stepsEarned = Math.floor(elapsed / QUIET_PERIOD_MS);
  if (stepsEarned <= 0) return state.ceiling;
  const restored = Math.min(
    state.configuredCeiling,
    state.ceilingAtLastSignal + stepsEarned * RESTORE_STEP,
  );
  return Math.max(state.ceiling, restored);
}

/** An adapter rate-limit signal (`06` §6.3: "e.g. `api_retry` events with `error: rate_limit`") — halves
 * whatever the effective ceiling *actually is at `now`* (via `ceilingAsOf`, folding in any restoration
 * already earned since the previous signal), not the raw, possibly-stale `state.ceiling` field. A critic
 * round found an earlier version halved `state.ceiling` directly, which is only correct if the caller
 * already called `tick(state, now)` immediately beforehand to bring it up to date — a real assumption
 * this function never documented or enforced, and a plausible one to violate in practice, since an
 * adapter's own rate-limit callback is naturally a different code path than the scheduler's own per-tick
 * cadence. Floored at `1`, per `06` §6.3's own "halve, floor 1"; restarts the quiet-period clock from `now`,
 * and always sets `ceilingAtLastSignal` to match the freshly-halved value, so a *later* signal arriving
 * mid-restoration re-baselines cleanly rather than risking a double-counted restoration on top of a stale
 * snapshot.
 *
 * `lastSignalAt` is recorded as `Math.max(now, state.lastSignalAt)`, never the raw `now` directly — a
 * verify round found the *first* fix above still let the recorded anchor itself move backward in time when
 * a second signal's own `now` was earlier than the first signal's, even though `ceilingAsOf`'s own halving
 * input was already correctly protected. A dragged-backward anchor doesn't go unnoticed: it silently
 * *inflates* every later call's own `elapsed` computation (a later `tick`, or even a third signal), since
 * `elapsed` is measured from that anchor — confirmed capable of fabricating a large number of restoration
 * steps from an almost-immediately-following call, and, pushed further, of fully erasing an active
 * backpressure state after only two signals and one ordinary tick. Clamping the anchor itself, not just the
 * ceiling `onRateLimitSignal` computes from it, is what actually closes this: the two signals in that
 * scenario now correctly agree on when "the most recent signal" really was, however their own two `now`
 * values happened to be ordered.
 *
 * A non-finite `now` (a corrupted clock read) is treated as no signal at all — silently ignored, returning
 * `state` unchanged, rather than recording an unusable `lastSignalAt` that could otherwise leave this state
 * permanently unable to ever detect "quiet" again. */
export function onRateLimitSignal(state: BackpressureState, now: number): BackpressureState {
  if (!Number.isFinite(now)) return state;
  const halved = Math.max(1, Math.floor(ceilingAsOf(state, now) / 2));
  const signalAt = state.lastSignalAt === undefined ? now : Math.max(now, state.lastSignalAt);
  return { ...state, ceiling: halved, ceilingAtLastSignal: halved, lastSignalAt: signalAt };
}

/** Restores concurrency additively once the quiet period has elapsed since the *most recent* signal — a
 * pure function of elapsed time, not a per-call accumulator: computed fresh from `ceilingAtLastSignal`/
 * `lastSignalAt` every time (via `ceilingAsOf`), so calling this twice (at two *non-decreasing* `now`
 * values, with no intervening signal) produces the identical final result as calling it once at the later
 * `now` directly. A caller may invoke this as often or as rarely as it likes — once per scheduling tick is
 * the expected use, but nothing here assumes any particular calling cadence.
 *
 * Safe, though not meaningful, for a `now` that moves backwards relative to a previous call: the guard
 * immediately below (`restored <= state.ceiling`) independently ensures this function itself never
 * regresses the ceiling, on top of (not merely relying on) `ceilingAsOf`'s own clamp — confirmed by a
 * verify round that this function alone already tolerates an arbitrarily non-monotonic `now` sequence
 * correctly, with or without `ceilingAsOf`'s own protection. A non-finite `now` is simply ignored, the
 * identical "no signal at all" treatment `onRateLimitSignal` gives the same case — this module never
 * assumes its caller supplies a well-behaved clock, only that it tries to. */
export function tick(state: BackpressureState, now: number): BackpressureState {
  if (state.lastSignalAt === undefined || state.ceilingAtLastSignal === undefined) return state;
  if (!Number.isFinite(now)) return state;

  const restored = ceilingAsOf(state, now);
  if (restored <= state.ceiling) return state;
  if (restored >= state.configuredCeiling) {
    return {
      ...state,
      ceiling: state.configuredCeiling,
      ceilingAtLastSignal: undefined,
      lastSignalAt: undefined,
    };
  }
  return { ...state, ceiling: restored };
}
