/**
 * The performance-benchmark ratchet's decision logic.
 *
 * `21` §21.5 names five absolute, literal numeric budgets and says regressions "fail CI via ratchet,
 * because 'it got slower gradually' is how tools become unpleasant." Two separate thresholds are in
 * play, and `PLAN-M12.md` P5's own Surface line is explicit that CI must apply "whichever is
 * stricter": the spec's own absolute budget (fixed forever, unless the spec itself changes) and a
 * ratchet mark (the best real measurement ever recorded, which may only improve — the identical
 * "ratchet-only" shape `scripts/lib/coverage-ratchet.mjs` already established for coverage, applied
 * here to milliseconds instead of percentage points, where lower is better instead of higher).
 *
 * Separated from `../bench.mjs` for the identical reason `coverage-ratchet.mjs` is separated from
 * `check-coverage-ratchet.mjs`: pure decision logic can be imported and unit-tested directly, without
 * spawning a subprocess or measuring real wall-clock time — a check nobody has exercised is
 * indistinguishable from one that always passes.
 *
 * **On tolerance.** Wall-clock measurement in a heavily concurrent, shared sandbox (this development
 * environment runs many other agent processes at once) is genuinely noisy in what it *measures*,
 * even though what each benchmark *does* (fixture size, operation count) is fully deterministic by
 * construction (see `bench-fixtures.mjs`). A real CI runner is a dedicated, single-tenant machine —
 * matching `21` §21.5's own "Benchmark in CI, ratcheted" framing — where this noise mostly does not
 * apply; a generous multiplicative tolerance on the *mark* comparison (not on the absolute budget,
 * which is never loosened) keeps the ratchet usable in this shared dev sandbox without disabling it,
 * the same trade `coverage-ratchet.mjs`'s own fixed-point `TOLERANCE` documents for the identical
 * reason ("a ratchet that fires on arithmetic noise gets disabled within a week").
 *
 * @see specs/21 §21.5
 * @see scripts/lib/coverage-ratchet.mjs
 * @see PLAN-M12.md P5
 */

/** `21` §21.5's own five rows, literally. Never loosened by this module — only `evaluateBenchRatchet`
 * decides whether a regression against a *mark* counts, never against this table.
 * @type {Readonly<Record<string, number>>} */
export const BUDGETS_MS = Object.freeze({
  'cold-start': 1_500,
  'first-frame': 400,
  compile: 1_000,
  'kb-pack': 300,
  'index-rebuild': 5_000,
});

export const BENCHMARK_NAMES = Object.freeze(Object.keys(BUDGETS_MS));

/** Multiplicative slack applied only to the mark comparison, never to the absolute budget — see this
 * module's own doc comment for why. 75% over the best-ever recorded time is still a real, order-of-
 * magnitude-smaller regression than "it got slower gradually" would let through unnoticed, while
 * comfortably absorbing ordinary shared-sandbox scheduling noise. */
const MARK_TOLERANCE = 1.75;

/**
 * @param {Record<string, { ms: number, fixtureSize: number }>} achieved this run's real measurements
 * @param {Record<string, { ms: number, fixtureSize: number }>} marks the last-recorded marks
 * @returns {{
 *   regressions: string[],
 *   overBudget: string[],
 *   improved: string[],
 *   next: Record<string, { ms: number, fixtureSize: number }>,
 * }}
 */
export function evaluateBenchRatchet(achieved, marks) {
  /** @type {string[]} */
  const regressions = [];
  /** @type {string[]} */
  const overBudget = [];
  /** @type {string[]} */
  const improved = [];
  /** @type {Record<string, { ms: number, fixtureSize: number }>} */
  const next = { ...marks };

  for (const [name, result] of Object.entries(achieved)) {
    const budgetMs = BUDGETS_MS[name];
    if (budgetMs === undefined) {
      throw new Error(`bench: "${name}" is not one of 21 §21.5's five named benchmarks.`);
    }

    if (result.ms > budgetMs) {
      overBudget.push(
        `${name}: ${result.ms.toFixed(1)}ms exceeds 21 §21.5's own ${String(budgetMs)}ms budget.`,
      );
    }

    // A round-1 critic finding: `bench-marks.json` is a committed, hand-editable/merge-conflictable
    // file, and a mark whose `ms` is missing or not a finite number (a bad merge, a careless hand
    // edit) must not be trusted as a real prior measurement — `mark.ms * MARK_TOLERANCE` would
    // otherwise evaluate to `NaN`, `Math.min(budgetMs, NaN)` is `NaN`, and every `result.ms > NaN`
    // comparison below is silently `false` — a corrupted mark would make `--check` pass no matter how
    // far over budget the real measurement is, defeating the CI gate's entire purpose. Treated the
    // identical way `readMarks()` in `bench.mjs` also now treats it: as if no mark exists at all.
    const rawMark = marks[name];
    const mark = rawMark !== undefined && Number.isFinite(rawMark.ms) ? rawMark : undefined;
    // The stricter of the two ceilings — 21 §21.5's own absolute budget, and MARK_TOLERANCE applied
    // to the best-ever recorded mark (only once a mark actually exists; a first-ever measurement has
    // nothing to regress against).
    const ceiling = mark === undefined ? budgetMs : Math.min(budgetMs, mark.ms * MARK_TOLERANCE);

    if (result.ms > ceiling) {
      regressions.push(
        `${name}: ${result.ms.toFixed(1)}ms exceeds the stricter of the recorded mark ` +
          `(${mark === undefined ? 'none yet' : `${mark.ms.toFixed(1)}ms x${String(MARK_TOLERANCE)}`}) ` +
          `and the 21 §21.5 budget (${String(budgetMs)}ms) — effective ceiling ${ceiling.toFixed(1)}ms.`,
      );
    }

    // Ratchet-only, mirroring coverage-ratchet.mjs exactly except inverted: lower is better here, so
    // a mark only ever moves down (or is recorded for the first time), never up.
    if (mark === undefined || result.ms < mark.ms) {
      if (mark !== undefined) {
        improved.push(`${name}: ${mark.ms.toFixed(1)}ms -> ${result.ms.toFixed(1)}ms`);
      }
      next[name] = result;
    } else {
      next[name] = mark;
    }
  }

  return { regressions, overBudget, improved, next };
}
