/**
 * `evaluateRatchet`/`packageTotals` — `PLAN-M8.md` P6's own Checks section.
 *
 * @see specs/13 §13.1 F-TEST-5
 * @see PLAN-M8.md P6
 */
import { describe, expect, it } from 'vitest';

import {
  evaluateRatchet,
  packageTotals,
  type FileCoverageCounts,
} from '../../../../src/commands/loop/test/ratchet.ts';

describe('evaluateRatchet — tolerance and regression detection', () => {
  it('reports no regression for a drop within the 0.5pp tolerance', () => {
    // 82 - 0.5 = 81.5: 81.6 is a genuine, comfortably-within-tolerance drop of 0.4pp.
    const achieved = {
      'packages/core': { lines: 81.6, statements: 81.6, functions: 81.6, branches: 81.6 },
    };
    const baseline = {
      'packages/core': { lines: 82, statements: 82, functions: 82, branches: 82 },
    };

    const result = evaluateRatchet(achieved, baseline);

    expect(result.regressions).toEqual([]);
  });

  it('reports a real regression for a drop beyond the 0.5pp tolerance', () => {
    const achieved = {
      'packages/core': { lines: 80, statements: 82, functions: 82, branches: 82 },
    };
    const baseline = {
      'packages/core': { lines: 82, statements: 82, functions: 82, branches: 82 },
    };

    const result = evaluateRatchet(achieved, baseline);

    expect(result.regressions.some((r) => r.includes('packages/core lines'))).toBe(true);
  });

  it('never lowers a stored mark on a real regression — next keeps the old, higher value', () => {
    const achieved = {
      'packages/core': { lines: 80, statements: 82, functions: 82, branches: 82 },
    };
    const baseline = {
      'packages/core': { lines: 82, statements: 82, functions: 82, branches: 82 },
    };

    const result = evaluateRatchet(achieved, baseline);

    expect(result.next['packages/core']?.lines).toBe(82);
  });

  it('raises the stored baseline on a genuine improvement, and next reflects it', () => {
    const achieved = {
      'packages/core': { lines: 90, statements: 90, functions: 90, branches: 90 },
    };
    const baseline = {
      'packages/core': { lines: 82, statements: 82, functions: 82, branches: 82 },
    };

    const result = evaluateRatchet(achieved, baseline);

    expect(result.regressions).toEqual([]);
    expect(result.raised.length).toBeGreaterThan(0);
    expect(result.next['packages/core']?.lines).toBe(90);
  });

  it('adopts a brand-new package with no prior mark at all, with no regression', () => {
    const achieved = {
      'packages/new': { lines: 50, statements: 50, functions: 50, branches: 50 },
    };

    const result = evaluateRatchet(achieved, {});

    expect(result.regressions).toEqual([]);
    expect(result.next['packages/new']?.lines).toBe(50);
  });

  it('leaves a baseline package untouched when this run has no data for it at all', () => {
    const baseline = {
      'packages/gone': { lines: 90, statements: 90, functions: 90, branches: 90 },
    };

    const result = evaluateRatchet({}, baseline);

    expect(result.next['packages/gone']?.lines).toBe(90);
  });
});

describe('packageTotals — per-package grouping and percentages', () => {
  it('groups packages/<name>/... by its own two-segment package', () => {
    const counts: FileCoverageCounts = {
      'packages/core/src/a.ts': { lines: { covered: 8, total: 10 } },
      'packages/core/src/b.ts': { lines: { covered: 2, total: 10 } },
    };

    const result = packageTotals(counts);

    expect(result['packages/core']?.lines).toBe(50);
  });

  it('groups a non-packages path by its own top-level directory', () => {
    const counts: FileCoverageCounts = {
      'scripts/a.mjs': { lines: { covered: 5, total: 10 } },
    };

    const result = packageTotals(counts);

    expect(result['scripts']?.lines).toBe(50);
  });

  it('reports 100% for a metric with zero total, by definition, not 0%', () => {
    const counts: FileCoverageCounts = {
      'packages/core/src/a.ts': { branches: { covered: 0, total: 0 } },
    };

    const result = packageTotals(counts);

    expect(result['packages/core']?.branches).toBe(100);
  });
});
