/**
 * `createBackpressureState`/`onRateLimitSignal`/`tick` — `06` §6.3's own backpressure rule: halve on a
 * rate-limit signal (floor 1), restore additively once a quiet period elapses. `PLAN-M5.md` P13's own
 * Checks text: a signal at concurrency 8 drops the ceiling to 4, a second immediate signal to 2, never
 * below 1; with no further signal, the ceiling climbs back additively at the documented rate once the quiet
 * period elapses, verified with an injected clock, not real wall-clock sleeps.
 *
 * @see specs/06 §6.3
 * @see specs/21 §21.1, §21.3
 * @see PLAN-M5.md P13
 */
import { describe, expect, it } from 'vitest';

import { createBackpressureState, onRateLimitSignal, tick } from '../../src/backpressure/state.ts';

const QUIET_PERIOD_MS = 30_000;

describe('createBackpressureState', () => {
  it('starts with the effective ceiling equal to the configured one, and no signal recorded', () => {
    const state = createBackpressureState(8);
    expect(state).toEqual({ configuredCeiling: 8, ceiling: 8, ceilingAtLastSignal: undefined, lastSignalAt: undefined });
  });
});

describe('onRateLimitSignal', () => {
  it('halves the ceiling on the first signal', () => {
    const state = onRateLimitSignal(createBackpressureState(8), 0);
    expect(state.ceiling).toBe(4);
  });

  it('halves again from the already-reduced ceiling on a second, immediate signal -- this piece\'s own worked example (8 -> 4 -> 2)', () => {
    let state = createBackpressureState(8);
    state = onRateLimitSignal(state, 0);
    expect(state.ceiling).toBe(4);
    state = onRateLimitSignal(state, 1);
    expect(state.ceiling).toBe(2);
  });

  it('never drops below 1, no matter how many further signals arrive', () => {
    let state = createBackpressureState(8);
    for (let i = 0; i < 10; i += 1) state = onRateLimitSignal(state, i);
    expect(state.ceiling).toBe(1);
  });

  it('records the time of the signal, restarting the quiet-period clock', () => {
    const state = onRateLimitSignal(createBackpressureState(8), 12_345);
    expect(state.lastSignalAt).toBe(12_345);
  });
});

describe('tick — additive restoration once the quiet period elapses', () => {
  it('does not restore anything before the quiet period has elapsed', () => {
    const signalled = onRateLimitSignal(createBackpressureState(8), 0);
    expect(tick(signalled, QUIET_PERIOD_MS - 1).ceiling).toBe(4);
  });

  it('restores by one step exactly at the quiet-period boundary', () => {
    const signalled = onRateLimitSignal(createBackpressureState(8), 0);
    expect(tick(signalled, QUIET_PERIOD_MS).ceiling).toBe(5);
  });

  it('restores by more than one step once multiple quiet-period intervals have elapsed since the signal', () => {
    const signalled = onRateLimitSignal(createBackpressureState(8), 0);
    expect(tick(signalled, QUIET_PERIOD_MS * 3).ceiling).toBe(7);
  });

  it('never restores past the originally configured ceiling, however long the elapsed time', () => {
    const signalled = onRateLimitSignal(createBackpressureState(8), 0);
    expect(tick(signalled, QUIET_PERIOD_MS * 1000).ceiling).toBe(8);
  });

  it('clears lastSignalAt back to undefined once fully restored, so "still under backpressure" never drifts out of sync with the ceiling itself', () => {
    const signalled = onRateLimitSignal(createBackpressureState(8), 0);
    const restored = tick(signalled, QUIET_PERIOD_MS * 1000);
    expect(restored.lastSignalAt).toBeUndefined();
    expect(restored.ceilingAtLastSignal).toBeUndefined();
  });

  it('is a pure function of elapsed time, not a per-call accumulator -- calling it twice at increasing "now" values produces the identical result as calling it once at the later "now" directly', () => {
    const signalled = onRateLimitSignal(createBackpressureState(8), 0);
    const calledTwice = tick(tick(signalled, QUIET_PERIOD_MS), QUIET_PERIOD_MS * 3);
    const calledOnce = tick(signalled, QUIET_PERIOD_MS * 3);
    expect(calledTwice).toEqual(calledOnce);
  });

  it('is a no-op when no signal has ever been received', () => {
    const state = createBackpressureState(8);
    expect(tick(state, 1_000_000)).toEqual(state);
  });

  it('is a no-op once already fully restored, rather than climbing past the configured ceiling or crashing', () => {
    const signalled = onRateLimitSignal(createBackpressureState(8), 0);
    const fullyRestored = tick(signalled, QUIET_PERIOD_MS * 1000);
    expect(tick(fullyRestored, QUIET_PERIOD_MS * 2000)).toEqual(fullyRestored);
  });

  it('does not restore, but does not throw either, if "now" moves backwards relative to the last signal (clock skew)', () => {
    const signalled = onRateLimitSignal(createBackpressureState(8), 100_000);
    expect(() => tick(signalled, 0)).not.toThrow();
    expect(tick(signalled, 0).ceiling).toBe(4);
  });

  it('a new signal arriving mid-restoration resets the quiet-period clock and re-halves from the current, partially-restored ceiling, without double-counting the interrupted restoration', () => {
    let state = onRateLimitSignal(createBackpressureState(8), 0);
    state = tick(state, QUIET_PERIOD_MS); // ceiling now 5 (4 + 1 step)
    expect(state.ceiling).toBe(5);
    state = onRateLimitSignal(state, QUIET_PERIOD_MS); // a second signal: halves from 5, not from 4 or 8
    expect(state.ceiling).toBe(2);
    // Restoration after the second signal must count from THIS signal's own ceiling (2), not silently
    // resume from wherever the interrupted first restoration left off.
    expect(tick(state, QUIET_PERIOD_MS * 2).ceiling).toBe(3);
  });

  it('calling tick again before another whole quiet-period interval has additionally elapsed is a true no-op, returning the identical state rather than a redundant new object', () => {
    const signalled = onRateLimitSignal(createBackpressureState(8), 0);
    const afterOneStep = tick(signalled, QUIET_PERIOD_MS);
    expect(afterOneStep.ceiling).toBe(5);
    // Still within the same earned interval (one quiet period plus a bit, not yet two) -- no additional
    // step has been earned since afterOneStep was computed.
    expect(tick(afterOneStep, QUIET_PERIOD_MS + 1)).toBe(afterOneStep);
  });

  it('floors a non-integer half (an odd effective ceiling) down, matching "halve, floor 1" literally', () => {
    const state = onRateLimitSignal(createBackpressureState(9), 0);
    expect(state.ceiling).toBe(4);
  });
});

describe('hardening found by a critic round', () => {
  it('tick() itself never regresses the ceiling when it receives a SMALLER "now" than an earlier call did -- a critic round found the original arithmetic recomputed a smaller "restored" value from the smaller elapsed time and applied it unconditionally', () => {
    // tick()'s own `if (restored <= state.ceiling) return state;` guard is what actually protects THIS
    // scenario (confirmed by a verify round via mutation testing: reverting ceilingAsOf's own separate
    // clamp still leaves this exact test passing) -- ceilingAsOf's own clamp exists for a different,
    // narrower scenario involving onRateLimitSignal specifically, covered by its own test below.
    let state = onRateLimitSignal(createBackpressureState(8), 0);
    state = tick(state, 90_000); // 3 quiet periods elapsed -> 4 + 3 = 7
    expect(state.ceiling).toBe(7);
    // A later call with a SMALLER "now" (still > lastSignalAt of 0) must not undo the restoration already
    // reflected in the ceiling -- real wall-clock sources (Date.now() in Node) are not guaranteed
    // monotonic, and nothing in this module's own contract requires a caller to only ever call tick with
    // non-decreasing "now" values.
    state = tick(state, 40_000); // as-of-40s alone would earn only 1 step (4 + 1 = 5) -- must NOT regress to 5
    expect(state.ceiling).toBe(7);
  });

  it('ceilingAsOf\'s own clamp keeps a signal\'s halving input correct when the signal\'s own "now" lands between the anchor and a "now" a later, already-applied tick() call used', () => {
    // The one scenario ceilingAsOf's own Math.max(state.ceiling, restored) clamp actually protects (a
    // verify round traced this precisely): unlike the test above, this signal's own "now" is EARLIER than
    // a value already used to advance `state.ceiling` via tick, but still LATER than the anchor itself --
    // so a naive recomputation from the anchor alone would suggest LESS restoration than the ceiling
    // already, correctly, reflects.
    let state = onRateLimitSignal(createBackpressureState(16), 0); // ceiling -> 8, anchor at 0
    state = tick(state, 90_000); // 3 steps earned from the anchor -> ceiling 11
    expect(state.ceiling).toBe(11);
    // A signal arrives "as of" 50_000 -- later than the anchor (0) but earlier than the tick's own 90_000.
    // A fresh, unclamped computation from the anchor alone would say only 1 step has been earned (8 + 1 =
    // 9), UNDER the 11 the ceiling already, correctly, reflects. Halving must start from 11, not 9.
    state = onRateLimitSignal(state, 50_000);
    expect(state.ceiling).toBe(5); // floor(11 / 2), not floor(9 / 2) = 4
  });

  it('never lets the recorded signal time itself move backward across two signals, which would otherwise inflate every LATER call\'s own elapsed-time computation -- a verify round found the first anchor-related fix above still let a second, earlier-"now" signal drag lastSignalAt itself backward', () => {
    // Two signals, the second reporting an earlier "now" than the first (real clock sources are not
    // guaranteed monotonic -- this module's own doc comments already name VM pause/resume as a real cause).
    // Confirmed by a verify round: without clamping the anchor itself (only the computed ceiling was
    // clamped), a single ordinary tick() immediately afterward fabricated several concurrency slots from
    // what should have been near-zero real elapsed time.
    let state = onRateLimitSignal(createBackpressureState(16), 10_000_000); // ceiling -> 8, anchor 10_000_000
    state = onRateLimitSignal(state, 10_000_000 - 3 * 60_000); // "now" 3 minutes earlier -> ceiling -> 4
    expect(state.ceiling).toBe(4);
    expect(state.lastSignalAt).toBe(10_000_000); // anchor must stay at the later of the two, not regress
    // A tick "at" the same moment as the FIRST signal (the true most recent point either signal reported)
    // must show ~zero elapsed time since the real anchor, not ~3 minutes' worth of fabricated restoration.
    expect(tick(state, 10_000_000).ceiling).toBe(4);
  });

  it('two signals (the second reporting an earlier "now") followed by one tick must not fully erase an active backpressure state back to unrestricted concurrency', () => {
    // The sharpest version of the anchor-regression bug: reduced to a minimal repro a verify round used to
    // demonstrate a COMPLETE, silent loss of backpressure state after only two signals and one ordinary
    // scheduling tick.
    let state = onRateLimitSignal(createBackpressureState(100), 5_000_000); // ceiling -> 50
    state = onRateLimitSignal(state, 0); // an earlier "now" -> ceiling -> 25
    state = tick(state, 5_000_000); // back to the first signal's own "now" -- essentially zero real elapsed time
    expect(state.ceiling).toBe(25);
    expect(state.lastSignalAt).toBeDefined(); // still genuinely under backpressure, not silently reset
  });

  it('halves the ceiling as it actually is AT THE SIGNAL TIME, not a stale cached value, when a signal arrives with no preceding tick() call to bring the cache up to date', () => {
    // A critic round found the earlier version halved the raw, possibly-stale `state.ceiling` field
    // directly -- correct only if the caller always calls tick() immediately before every signal, an
    // assumption this function never documented or enforced. An adapter's own rate-limit callback is
    // naturally a different code path than the scheduler's own per-tick cadence, so this is a real gap,
    // not a hypothetical one.
    let state = onRateLimitSignal(createBackpressureState(8), 0); // ceiling -> 4
    expect(state.ceiling).toBe(4);
    // 90 seconds pass with NO intervening tick() call -- the true as-of-now ceiling would be 4 + 3 = 7.
    state = onRateLimitSignal(state, 90_000);
    // Correct AIMD halving of the true current ceiling (7) is 3 (floor(7/2)), not 2 (floor(4/2)) as halving
    // the stale cached value would give.
    expect(state.ceiling).toBe(3);
  });

  it('ignores a non-finite "now" passed to onRateLimitSignal entirely, rather than recording an unusable signal time that could leave this state permanently unable to detect "quiet" again', () => {
    const state = createBackpressureState(8);
    expect(onRateLimitSignal(state, Number.NaN)).toEqual(state);
    expect(onRateLimitSignal(state, Number.POSITIVE_INFINITY)).toEqual(state);
  });

  it('ignores a non-finite "now" passed to tick entirely, and normal operation resumes cleanly on the next well-formed call -- confirming no permanent poisoning, not just that this one call is a no-op', () => {
    const signalled = onRateLimitSignal(createBackpressureState(8), 0);
    const afterNaNTick = tick(signalled, Number.NaN);
    expect(afterNaNTick).toEqual(signalled);
    expect(tick(afterNaNTick, QUIET_PERIOD_MS).ceiling).toBe(5);
  });

  it('sanitizes a non-finite or non-positive configuredCeiling to the smallest valid ceiling (1) rather than propagating NaN/0/a negative number forever -- confirmed unreachable through the one real construction site today (schema-validated), but a NaN specifically can never self-heal once it enters this state', () => {
    expect(createBackpressureState(Number.NaN).ceiling).toBe(1);
    expect(createBackpressureState(0).ceiling).toBe(1);
    expect(createBackpressureState(-5).ceiling).toBe(1);
    expect(createBackpressureState(Number.POSITIVE_INFINITY).ceiling).toBe(1);
  });

  it('floors a fractional configuredCeiling to a whole number', () => {
    expect(createBackpressureState(8.9).ceiling).toBe(8);
  });
});
