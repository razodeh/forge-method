/**
 * The stability probe (specs/22 M16 P4): "a reference that disagrees with itself is not an oracle."
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 */
import { describe, expect, it } from 'vitest';

import { decideStability } from '../../../src/commands/parity/stability.ts';

const stringsEqual = (a: string, b: string): boolean => a === b;

describe('decideStability: every run must agree, or the case is unstable (specs/22 M16 P4)', () => {
  it('is stable when every run is identical, and names the shared value', () => {
    expect(decideStability(['A', 'A', 'A'], stringsEqual)).toEqual({ stable: true, shared: 'A' });
  });

  it('is unstable when even one run disagrees with the rest (reference flips at capture)', () => {
    // Models "a reference that disagrees with itself" at CAPTURE time: this function has no notion
    // of which side it is checking, so the SAME call models both the reference-at-capture and the
    // candidate-at-check scenarios the piece brief asks for.
    expect(decideStability(['A', 'A', 'B'], stringsEqual)).toEqual({ stable: false });
  });

  it('is unstable when the candidate flips at check, even if most runs agree', () => {
    expect(decideStability(['A', 'B', 'A', 'A', 'A'], stringsEqual)).toEqual({ stable: false });
  });

  it('checks EVERY run against the first, not merely an adjacent pair (the naive-partial-check trap)', () => {
    // A naive implementation that only compares runs[0] with runs[1] (ignoring the rest) would call
    // ["A", "A", "B"] stable (using "A", the first two runs' shared value) when run index 2 genuinely
    // disagrees. This directly exercises that every run, not just a prefix, is checked.
    const runs = ['A', 'A', 'B'];
    const naivePartialCheck = runs[0] === runs[1]; // what a buggy "check only the first pair" would ask
    expect(naivePartialCheck).toBe(true); // the naive check alone would wrongly call this "agreeing"
    expect(decideStability(runs, stringsEqual)).toEqual({ stable: false }); // the real probe does not
  });

  it(
    'the shared value and a naive "first run" value give a DIFFERENT comparison result when the ' +
      'implementation picks wrong — constructed deliberately, not an accidental pass',
    () => {
      // Capture's own reference value is "A". The candidate's three stability runs are ["B", "A",
      // "A"]: NOT all equal (the first run disagrees with the other two), so the correct verdict is
      // `unstable` -- the candidate must never be compared against the capture at all.
      //
      // A buggy "naive first run" implementation that skips the full-agreement check and simply takes
      // `runs[0]` unconditionally would use "B" as if it were the trustworthy shared value, and a
      // caller comparing "B" against the capture's "A" would read `mismatch` -- a DIFFERENT verdict
      // than the correct `unstable`. This proves the two readings diverge for this exact input, which
      // is what makes the test meaningful rather than a tautology.
      const candidateRuns = ['B', 'A', 'A'];
      const captureReferenceValue = 'A';

      const outcome = decideStability(candidateRuns, stringsEqual);
      expect(outcome).toEqual({ stable: false }); // correct: never reaches a comparison at all

      const naiveFirstRun = candidateRuns[0];
      expect(naiveFirstRun).not.toBe(captureReferenceValue); // the naive reading would have read `mismatch`
    },
  );

  it('throws RangeError for zero runs, a programming error no well-formed declaration can trigger', () => {
    expect(() => decideStability([], stringsEqual)).toThrow(RangeError);
  });

  it('is generic over any equality function, not tied to string equality', () => {
    interface Observation {
      readonly value: number;
    }
    const observationsEqual = (a: Observation, b: Observation): boolean => a.value === b.value;
    const shared: Observation = { value: 42 };
    const outcome = decideStability([{ value: 42 }, shared, { value: 42 }], observationsEqual);
    expect(outcome.stable).toBe(true);
  });
});
