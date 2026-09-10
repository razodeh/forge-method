/**
 * `evaluateRatchet`/`packageTotals` — a real, pure TypeScript port of the already-proven
 * `scripts/lib/coverage-ratchet.mjs` design (FORGE's own repo tooling) for a *target* project's own
 * coverage ratchet, `coverage:ratchet` (`G-Verify`, `13` §13.4): per-package/path-prefix totals, a
 * 0.5pp tolerance for arithmetic noise, never lowers a stored baseline, only raises it on genuine
 * improvement.
 *
 * Not a shared import: `scripts/lib/coverage-ratchet.mjs` lives outside `packages/` and protects
 * FORGE's own suite specifically (its own `packageTotals` groups by *this* monorepo's own two-segment
 * `packages/<name>` layout) — a target project's own layout is not known in advance, so this module's
 * own `packageKeyFor` is a real, disclosed generalisation of that grouping rule, not a verbatim copy
 * (`SPEC-QUESTIONS.md` Q127 has the fuller record). `evaluateRatchet` itself is ported with no
 * behavioural change: verified directly (by tracing every branch against the original) that a real
 * regression can never lower a stored mark, with or without persisting `next` — the tolerance check
 * only ever *raises* a mark (`now > mark`) or leaves it exactly where it was, so `coverage.ts` can
 * safely persist `next` on every real invocation rather than gating it behind a separate, human-run
 * "--update" step the way FORGE's own internal script does (Q127).
 *
 * Deliberately dependency-free (no `node:path`, no filesystem access) — `coverage.ts` owns turning
 * the real, absolute-path-keyed `coverage-summary.json` into the project-relative, forward-slash-keyed
 * input this module expects, so every function here stays directly unit-testable against plain
 * fixtures, the same way the original `.mjs` module's own doc comment insists on.
 *
 * @see specs/13 §13.1 F-TEST-5
 * @see scripts/lib/coverage-ratchet.mjs
 * @see SPEC-QUESTIONS.md Q127
 * @see PLAN-M8.md P6
 */

const METRICS = ['lines', 'statements', 'functions', 'branches'] as const;
type Metric = (typeof METRICS)[number];

/** One package/path-prefix's own real line/statement/function/branch coverage percentages
 * (0–100 each). */
export interface CoverageMetrics {
  readonly lines: number;
  readonly statements: number;
  readonly functions: number;
  readonly branches: number;
}

/** Package/path-prefix key → that group's own real, just-achieved coverage percentages. */
export type PackageCoverageTotals = Readonly<Record<string, CoverageMetrics>>;

/** The stored ratchet baseline — the identical shape `PackageCoverageTotals` has (this project's own
 * previously-recorded high-water mark per group); `coverage.ts` reads/writes this at
 * `docs/forge/reports/coverage-baseline.json`. */
export type RatchetBaseline = Readonly<Record<string, CoverageMetrics>>;

/** One file's own real istanbul-shaped `{covered, total}` pair for one metric. */
export interface FileMetric {
  readonly covered: number;
  readonly total: number;
}

/** One file's own real per-metric coverage counts, keyed by a project-relative, forward-slash path —
 * `coverage.ts` builds this from the real, already-parsed `coverage-summary.json` (whose own keys are
 * absolute paths — converted to project-relative before reaching this module, per this file's own
 * header comment). */
export type FileCoverageCounts = Readonly<
  Record<string, Partial<Readonly<Record<Metric, FileMetric>>>>
>;

/** Tolerance, in percentage points, before a drop is treated as a regression — not zero: adding a
 * well-covered file to a package moves its aggregate by a fraction of a point in either direction,
 * and a ratchet that fires on arithmetic noise gets disabled within a week (`scripts/lib/
 * coverage-ratchet.mjs`'s own identical reasoning, ported verbatim). */
const TOLERANCE = 0.5;

const MULTI_PACKAGE_CONTAINERS: ReadonlySet<string> = new Set(['packages', 'apps']);

/** The group key for one project-relative file path. `packages/<name>/...`/`apps/<name>/...` group
 * by their own two-segment package (the identical convention `scripts/lib/coverage-ratchet.mjs`'s own
 * `packageTotals` uses for FORGE's own two such directories); any other path groups by its own
 * top-level directory alone — a real, disclosed generalisation for an arbitrary target project whose
 * own layout this codebase cannot assume matches FORGE's (`SPEC-QUESTIONS.md` Q127). */
function packageKeyFor(relativePath: string): string {
  const segments = relativePath.split('/');
  const first = segments[0] ?? '';
  const second = segments[1];
  if (MULTI_PACKAGE_CONTAINERS.has(first) && second !== undefined) return `${first}/${second}`;
  return first;
}

function emptyFileMetrics(): Record<Metric, FileMetric> {
  return {
    lines: { covered: 0, total: 0 },
    statements: { covered: 0, total: 0 },
    functions: { covered: 0, total: 0 },
    branches: { covered: 0, total: 0 },
  };
}

function metricsFrom(get: (metric: Metric) => number): CoverageMetrics {
  return {
    lines: get('lines'),
    statements: get('statements'),
    functions: get('functions'),
    branches: get('branches'),
  };
}

/** Groups per-file coverage counts into per-package coverage percentages — the real, ported design
 * `scripts/lib/coverage-ratchet.mjs`'s own `packageTotals` already establishes, generalised to an
 * arbitrary target project's own layout via `packageKeyFor` above. */
export function packageTotals(counts: FileCoverageCounts): PackageCoverageTotals {
  const sums = new Map<string, Record<Metric, FileMetric>>();
  for (const [relativePath, fileMetrics] of Object.entries(counts)) {
    const pkg = packageKeyFor(relativePath);
    const bucket = sums.get(pkg) ?? emptyFileMetrics();
    sums.set(pkg, bucket);
    for (const metric of METRICS) {
      const entry = fileMetrics[metric];
      if (entry === undefined) continue;
      bucket[metric] = {
        covered: bucket[metric].covered + entry.covered,
        total: bucket[metric].total + entry.total,
      };
    }
  }

  const result: Record<string, CoverageMetrics> = {};
  for (const [pkg, bucket] of sums) {
    result[pkg] = metricsFrom((metric) => {
      const { covered, total } = bucket[metric];
      // A package with no branches at all is fully covered by definition, not 0% — `scripts/lib/
      // coverage-ratchet.mjs`'s own identical convention, ported verbatim.
      return total === 0 ? 100 : Number(((covered / total) * 100).toFixed(2));
    });
  }
  return result;
}

/** Compares `achieved` (this run's own real per-package coverage) against `baseline` (the stored
 * high-water mark): a package/metric more than `TOLERANCE` points below its own recorded baseline is
 * a real regression; one at or above its own baseline raises it — a baseline entry is never lowered
 * by this function, on a regression or otherwise (verified directly, per this file's own header
 * comment). Ported from `scripts/lib/coverage-ratchet.mjs`'s own already-proven `evaluateRatchet`
 * with no behavioural change. */
export function evaluateRatchet(
  achieved: PackageCoverageTotals,
  baseline: RatchetBaseline,
): {
  readonly regressions: readonly string[];
  readonly raised: readonly string[];
  readonly next: RatchetBaseline;
} {
  const regressions: string[] = [];
  const raised: string[] = [];
  const next: Record<string, CoverageMetrics> = { ...baseline };

  for (const [pkg, metrics] of Object.entries(achieved)) {
    next[pkg] = metricsFrom((metric) => {
      const now = metrics[metric];
      const mark = baseline[pkg]?.[metric];
      if (mark !== undefined && now < mark - TOLERANCE) {
        regressions.push(
          `${pkg} ${metric}: ${now.toFixed(2)}% is below the recorded ${mark.toFixed(2)}%`,
        );
      }
      if (mark === undefined || now > mark) {
        if (mark !== undefined)
          raised.push(`${pkg} ${metric}: ${mark.toFixed(2)}% -> ${now.toFixed(2)}%`);
        return now;
      }
      return mark;
    });
  }

  return { regressions, raised, next };
}
