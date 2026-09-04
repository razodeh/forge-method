/**
 * The coverage ratchet's own logic.
 *
 * `specs/13` F-TEST-5 makes coverage ratchet-only, and `QUALITY-BAR.md` §3 calls lowering a
 * threshold a review failure — both of which depend on a check that actually fires. A ratchet nobody
 * has exercised is indistinguishable from one that always passes, which is what it was for two
 * pieces while a comment claimed otherwise.
 *
 * @see specs/13 F-TEST-5
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, onTestFinished } from 'vitest';

import { evaluateRatchet, packageTotals } from './lib/coverage-ratchet.mjs';

const metric = (covered: number, total: number) => ({ covered, total });

const ratchetScript = fileURLToPath(new URL('check-coverage-ratchet.mjs', import.meta.url));

describe('packageTotals', () => {
  it('groups files by package and reports a percentage per metric', () => {
    const summary = {
      total: {},
      [`${process.cwd()}/packages/core/src/a.ts`]: {
        lines: metric(8, 10),
        statements: metric(8, 10),
        functions: metric(1, 1),
        branches: metric(2, 4),
      },
      [`${process.cwd()}/packages/core/src/b.ts`]: {
        lines: metric(10, 10),
        statements: metric(10, 10),
        functions: metric(1, 1),
        branches: metric(4, 4),
      },
    };

    expect(packageTotals(summary, process.cwd())['packages/core']).toEqual({
      lines: 90,
      statements: 90,
      functions: 100,
      branches: 75,
    });
  });

  it('treats a package with no branches as fully covered, not as zero', () => {
    const summary = {
      [`${process.cwd()}/packages/core/src/a.ts`]: {
        lines: metric(1, 1),
        statements: metric(1, 1),
        functions: metric(1, 1),
        branches: metric(0, 0),
      },
    };

    expect(packageTotals(summary, process.cwd())['packages/core']?.['branches']).toBe(100);
  });
});

describe('evaluateRatchet', () => {
  it('reports a regression when coverage falls further than the tolerance', () => {
    const { regressions } = evaluateRatchet(
      { 'packages/core': { lines: 90, statements: 90, functions: 90, branches: 90 } },
      { 'packages/core': { lines: 99, statements: 99, functions: 99, branches: 99 } },
    );

    expect(regressions).toHaveLength(4);
    expect(regressions[0]).toContain('below the recorded');
  });

  it('tolerates a fractional drop, since adding a covered file moves the aggregate either way', () => {
    const { regressions } = evaluateRatchet(
      { 'packages/core': { lines: 98.8, statements: 99, functions: 99, branches: 99 } },
      { 'packages/core': { lines: 99, statements: 99, functions: 99, branches: 99 } },
    );

    expect(regressions).toEqual([]);
  });

  it('raises a mark when coverage improves, and never lowers one', () => {
    const { raised, next, regressions } = evaluateRatchet(
      { 'packages/core': { lines: 100, statements: 99, functions: 99, branches: 99 } },
      { 'packages/core': { lines: 95, statements: 99, functions: 99, branches: 99 } },
    );

    expect(regressions).toEqual([]);
    expect(raised).toEqual(['packages/core lines: 95 -> 100']);
    expect(next['packages/core']?.['lines']).toBe(100);
  });

  it('records a new package without calling it a regression', () => {
    const { regressions, next } = evaluateRatchet(
      { 'packages/schemas': { lines: 91, statements: 91, functions: 91, branches: 88 } },
      {},
    );

    expect(regressions).toEqual([]);
    expect(next['packages/schemas']?.['lines']).toBe(91);
  });

  it('leaves a package absent from this run untouched, rather than deleting its mark', () => {
    // A single-package run must not erase the marks for everything it did not measure.
    const { next } = evaluateRatchet(
      { 'packages/core': { lines: 100, statements: 100, functions: 100, branches: 100 } },
      { 'packages/vcs': { lines: 93, statements: 93, functions: 93, branches: 90 } },
    );

    expect(next['packages/vcs']?.['lines']).toBe(93);
  });
});

describe('the command wrapper', () => {
  const run = (args: readonly string[], cwd: string) => {
    try {
      return {
        status: 0,
        output: execFileSync(process.execPath, [ratchetScript, ...args], { cwd, encoding: 'utf8' }),
      };
    } catch (error) {
      const failure = error as { status?: number; stderr?: string };
      return { status: failure.status ?? 1, output: failure.stderr ?? '' };
    }
  };

  function fixture(build: (root: string) => unknown, marks?: unknown): string {
    // realpath because the script resolves its root the same way; on macOS the two differ.
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'forge-ratchet-')));
    mkdirSync(path.join(dir, 'coverage'));
    writeFileSync(path.join(dir, 'coverage', 'coverage-summary.json'), JSON.stringify(build(dir)));
    if (marks !== undefined) {
      writeFileSync(path.join(dir, 'coverage-ratchet.json'), JSON.stringify(marks));
    }
    onTestFinished(() => {
      rmSync(dir, { recursive: true, force: true });
    });
    return dir;
  }

  const fullyCovered = {
    lines: metric(10, 10),
    statements: metric(10, 10),
    functions: metric(1, 1),
    branches: metric(2, 2),
  };
  const halfCovered = {
    lines: metric(5, 10),
    statements: metric(5, 10),
    functions: metric(1, 1),
    branches: metric(1, 2),
  };

  it('exits 0 when there is no coverage report, so watch mode still works', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'forge-ratchet-'));
    onTestFinished(() => {
      rmSync(dir, { recursive: true, force: true });
    });
    expect(run([], dir).status).toBe(0);
  });

  it('exits non-zero and names the package when coverage regresses', () => {
    const dir = fixture((root: string) => ({ [`${root}/packages/core/src/a.ts`]: halfCovered }), {
      'packages/core': { lines: 100, statements: 100, functions: 100, branches: 100 },
    });
    const { status, output } = run([], dir);

    expect(status).not.toBe(0);
    expect(output).toContain('went backwards');
  });

  it('writes raised marks only with --update, so the check cannot rewrite its own baseline', () => {
    const dir = fixture((root: string) => ({ [`${root}/packages/core/src/a.ts`]: fullyCovered }));

    expect(run([], dir).status).toBe(0);
    expect(existsSync(path.join(dir, 'coverage-ratchet.json'))).toBe(false);

    expect(run(['--update'], dir).status).toBe(0);
    expect(existsSync(path.join(dir, 'coverage-ratchet.json'))).toBe(true);
  });
});
