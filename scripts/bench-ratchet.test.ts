/**
 * The performance-benchmark ratchet's own decision logic — `scripts/lib/bench-ratchet.mjs`, unit
 * tested directly for the identical reason `scripts/ratchet.test.ts` tests the coverage ratchet's own
 * logic: a check nobody has exercised is indistinguishable from one that always passes, and `21`
 * §21.5's own "regressions fail CI via ratchet" claim rests entirely on this being correct.
 *
 * @see specs/21 §21.5
 * @see scripts/lib/bench-ratchet.mjs
 * @see PLAN-M12.md P5
 */
import { describe, expect, it } from 'vitest';

import { BUDGETS_MS, evaluateBenchRatchet } from './lib/bench-ratchet.mjs';

const mark = (ms: number, fixtureSize = 1) => ({ ms, fixtureSize });

describe('BUDGETS_MS', () => {
  it("carries 21 §21.5's own five literal numeric budgets, verbatim", () => {
    expect(BUDGETS_MS).toEqual({
      'cold-start': 1_500,
      'first-frame': 400,
      compile: 1_000,
      'kb-pack': 300,
      'index-rebuild': 5_000,
    });
  });
});

describe('evaluateBenchRatchet — first measurement (no prior mark)', () => {
  it('records a first-ever measurement as the mark, without calling it a regression', () => {
    const { regressions, next } = evaluateBenchRatchet({ 'kb-pack': mark(120, 500) }, {});
    expect(regressions).toEqual([]);
    expect(next['kb-pack']).toEqual(mark(120, 500));
  });

  it('flags a first-ever measurement that is already over budget, even with no mark yet', () => {
    const { overBudget, regressions } = evaluateBenchRatchet({ 'kb-pack': mark(9_000, 500) }, {});
    expect(overBudget[0]).toContain('exceeds 21 §21.5');
    // Over budget with no recorded mark: the budget itself is the only ceiling there is to violate.
    expect(regressions[0]).toContain('300ms');
  });
});

describe('evaluateBenchRatchet — regression past the mark', () => {
  it('reports a regression when a measurement exceeds the tolerant mark ceiling but stays under budget', () => {
    // Mark 100ms * 1.75 tolerance = 175ms ceiling, well under the 1000ms compile budget — the mark is
    // the stricter (lower) of the two ceilings here.
    const { regressions, overBudget } = evaluateBenchRatchet(
      { compile: mark(200, 600) },
      { compile: mark(100, 600) },
    );
    expect(overBudget).toEqual([]);
    expect(regressions).toHaveLength(1);
    expect(regressions[0]).toContain('compile');
  });

  it('tolerates a measurement within the mark-tolerance band', () => {
    const { regressions } = evaluateBenchRatchet(
      { compile: mark(150, 600) },
      { compile: mark(100, 600) },
    );
    expect(regressions).toEqual([]);
  });

  it('uses the absolute budget as the ceiling when it is stricter than the tolerant mark', () => {
    // Mark 300ms * 1.75 = 525ms, but the first-frame budget itself is 400ms — the budget is stricter.
    const { regressions } = evaluateBenchRatchet(
      { 'first-frame': mark(450, 100) },
      { 'first-frame': mark(300, 100) },
    );
    expect(regressions).toHaveLength(1);
    expect(regressions[0]).toContain('budget');
  });
});

describe('evaluateBenchRatchet — ratchet-only marks', () => {
  it('lowers the mark when a measurement improves, and reports it as improved', () => {
    const { improved, next, regressions } = evaluateBenchRatchet(
      { 'index-rebuild': mark(50, 1_000) },
      { 'index-rebuild': mark(80, 1_000) },
    );
    expect(regressions).toEqual([]);
    expect(improved).toEqual(['index-rebuild: 80.0ms -> 50.0ms']);
    expect(next['index-rebuild']).toEqual(mark(50, 1_000));
  });

  it('never raises (worsens) a mark for a measurement that is merely within tolerance', () => {
    const { next } = evaluateBenchRatchet(
      { 'index-rebuild': mark(120, 1_000) },
      { 'index-rebuild': mark(80, 1_000) },
    );
    // 120ms is within 80ms * 1.75 = 140ms tolerance, so no regression — but the mark itself must stay
    // at the best-ever 80ms, not silently drift up to 120ms.
    expect(next['index-rebuild']).toEqual(mark(80, 1_000));
  });

  it('leaves a benchmark absent from this run untouched, rather than deleting its mark', () => {
    const { next } = evaluateBenchRatchet({ compile: mark(10, 600) }, { 'kb-pack': mark(90, 500) });
    expect(next['kb-pack']).toEqual(mark(90, 500));
  });
});

describe('evaluateBenchRatchet — input validation', () => {
  it('throws for a benchmark name with no 21 §21.5 budget, rather than silently ignoring it', () => {
    expect(() => evaluateBenchRatchet({ 'not-a-real-benchmark': mark(1) }, {})).toThrow(
      /not one of 21 §21.5/,
    );
  });
});

describe('evaluateBenchRatchet — a corrupted mark never silently defeats the gate', () => {
  // Round-1 critic finding: a committed, hand-editable bench-marks.json can carry a mark with a
  // missing or non-numeric `ms` (a bad merge, a careless hand edit) — `mark.ms * MARK_TOLERANCE`
  // would otherwise be `NaN`, `Math.min(budget, NaN)` is `NaN`, and `result.ms > NaN` is always
  // `false`, silently passing `--check` no matter how far over budget the real measurement is.
  it('treats a mark with a missing ms as no mark at all, still catching an over-budget measurement', () => {
    const { regressions, next } = evaluateBenchRatchet(
      { 'kb-pack': mark(9_999, 500) },
      // @ts-expect-error — deliberately malformed input, the exact shape a corrupted commit produces
      { 'kb-pack': { fixtureSize: 500 } },
    );
    expect(regressions).toHaveLength(1);
    expect(regressions[0]).toContain('kb-pack');
    // The corrupted entry is replaced by the fresh, valid measurement, not left corrupted.
    expect(next['kb-pack']).toEqual(mark(9_999, 500));
  });

  it('treats a mark with a non-numeric ms (e.g. a JSON null) identically', () => {
    const { regressions } = evaluateBenchRatchet(
      { compile: mark(9_999, 600) },
      // @ts-expect-error — deliberately malformed input
      { compile: { ms: null, fixtureSize: 600 } },
    );
    expect(regressions).toHaveLength(1);
  });
});
