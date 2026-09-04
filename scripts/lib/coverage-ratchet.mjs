/**
 * The coverage ratchet's decision logic.
 *
 * Separated from the command in `../check-coverage-ratchet.mjs` so it can be imported and tested.
 * `specs/13` F-TEST-5 makes coverage ratchet-only and `QUALITY-BAR.md` §3 calls lowering a threshold
 * a review failure — claims that rest entirely on this check being correct, and a check nobody has
 * exercised is indistinguishable from one that always passes.
 *
 * @see specs/13 F-TEST-5
 */
import path from 'node:path';

/**
 * Tolerance, in percentage points, before a drop is treated as a regression.
 *
 * Not zero: adding a well-covered file to a package moves its aggregate by a fraction of a point in
 * either direction, and a ratchet that fires on arithmetic noise gets disabled within a week. A drop
 * of more than this is a real reduction in what is tested.
 */
const TOLERANCE = 0.5;

/** The metrics a mark records. Functions is included because a whole untested export moves it first. */
export const METRICS = ['lines', 'statements', 'functions', 'branches'];

/**
 * Groups per-file coverage into per-package totals.
 *
 * Per package rather than per file: a file-level ratchet fires every time code moves between files,
 * which is noise, while a package sliding backwards is the thing `specs/13` F-TEST-5 is about.
 *
 * @param {Record<string, Record<string, { covered: number, total: number }>>} summary
 * @param {string} repoRoot
 * @returns {Record<string, Record<string, number>>}
 */
export function packageTotals(summary, repoRoot) {
  /** @type {Record<string, Record<string, { covered: number, total: number }>>} */
  const totals = {};

  for (const [absolutePath, fileSummary] of Object.entries(summary)) {
    if (absolutePath === 'total') continue;
    const relative = path.relative(repoRoot, absolutePath).split(path.sep).join('/');
    const segments = relative.split('/');
    // `packages/core/src/…` and `tools/x/src/…` group by their package; `scripts/…` is its own.
    const key = segments[0] === 'scripts' ? 'scripts' : segments.slice(0, 2).join('/');

    const bucketsForPackage =
      totals[key] ??
      Object.fromEntries(METRICS.map((metric) => [metric, { covered: 0, total: 0 }]));
    totals[key] = bucketsForPackage;

    for (const metric of METRICS) {
      const entry = fileSummary[metric];
      const bucket = bucketsForPackage[metric];
      if (entry === undefined || bucket === undefined) continue;
      bucket.covered += entry.covered;
      bucket.total += entry.total;
    }
  }

  return Object.fromEntries(
    Object.entries(totals).map(([key, metrics]) => [
      key,
      Object.fromEntries(
        Object.entries(metrics).map(([metric, { covered, total }]) => [
          metric,
          // A package with no branches at all is fully covered by definition, not 0%.
          total === 0 ? 100 : Number(((covered / total) * 100).toFixed(2)),
        ]),
      ),
    ]),
  );
}

/**
 * Compares achieved coverage against the recorded marks.
 *
 * Pure, and exported, so the ratchet's own correctness is testable — a check nobody has exercised is
 * indistinguishable from a check that always passes.
 *
 * @param {Record<string, Record<string, number>>} achieved
 * @param {Record<string, Record<string, number>>} marks
 * @returns {{ regressions: string[], raised: string[], next: Record<string, Record<string, number>> }}
 */
export function evaluateRatchet(achieved, marks) {
  /** @type {string[]} */
  const regressions = [];
  /** @type {string[]} */
  const raised = [];
  /** @type {Record<string, Record<string, number>>} */
  const next = { ...marks };

  for (const [pkg, metrics] of Object.entries(achieved)) {
    next[pkg] = { ...next[pkg] };
    for (const metric of METRICS) {
      const now = metrics[metric] ?? 100;
      const mark = marks[pkg]?.[metric];

      if (mark !== undefined && now < mark - TOLERANCE) {
        regressions.push(
          `${pkg} ${metric}: ${now.toFixed(2)}% is below the recorded ${mark.toFixed(2)}%`,
        );
      }
      if (mark === undefined || now > mark) {
        if (mark !== undefined) raised.push(`${pkg} ${metric}: ${String(mark)} -> ${String(now)}`);
        next[pkg][metric] = now;
      } else {
        next[pkg][metric] = mark;
      }
    }
  }

  return { regressions, raised, next };
}
