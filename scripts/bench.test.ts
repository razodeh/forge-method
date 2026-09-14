/**
 * `scripts/bench.mjs` itself, run end to end as a real subprocess against the real repository — the
 * identical "the decision logic is unit-tested in isolation, and the wrapper is proven by a real
 * subprocess run" split `scripts/ratchet.test.ts`'s own "the command wrapper" section already
 * establishes for the coverage ratchet.
 *
 * Sample counts are overridden down to 1 via `FORGE_BENCH_SUBPROCESS_SAMPLES`/
 * `FORGE_BENCH_IN_PROCESS_SAMPLES` (a pure noise-reduction knob, see `bench.mjs`'s own doc comment —
 * this has no bearing on which fixture sizes actually get measured, only on how many timed repeats
 * each takes). `FORGE_BENCH_MARKS_PATH` is overridden to a throwaway temp file so this test never
 * touches the real, committed `bench-marks.json` with one CI/dev machine's own timing.
 *
 * @see scripts/bench.mjs
 * @see scripts/ratchet.test.ts
 * @see PLAN-M12.md P5
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { BENCHMARK_NAMES } from './lib/bench-ratchet.mjs';

const benchScript = fileURLToPath(new URL('bench.mjs', import.meta.url));
const repoRoot = path.resolve(import.meta.dirname, '..');

let scratchDirs: string[] = [];
afterEach(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
  scratchDirs = [];
});

function freshMarksPath(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'forge-bench-marks-'));
  scratchDirs.push(dir);
  return path.join(dir, 'bench-marks.json');
}

function run(args: readonly string[], marksPath: string) {
  try {
    return {
      status: 0,
      output: execFileSync(process.execPath, ['--experimental-strip-types', benchScript, ...args], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          FORGE_BENCH_MARKS_PATH: marksPath,
          FORGE_BENCH_SUBPROCESS_SAMPLES: '1',
          FORGE_BENCH_IN_PROCESS_SAMPLES: '1',
        },
      }),
    };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? 1,
      output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
    };
  }
}

describe('bench.mjs — record mode', () => {
  it('runs all five real 21 §21.5 benchmarks and writes a mark for each', () => {
    const marksPath = freshMarksPath();
    const { output } = run([], marksPath);

    for (const name of BENCHMARK_NAMES) {
      expect(output).toContain(name);
    }

    expect(existsSync(marksPath)).toBe(true);
    const marks = JSON.parse(readFileSync(marksPath, 'utf8')) as Record<
      string,
      { ms: number; fixtureSize: number }
    >;
    for (const name of BENCHMARK_NAMES) {
      expect(marks[name]?.ms).toBeGreaterThan(0);
      expect(marks[name]?.fixtureSize).toBeGreaterThan(0);
    }
    // The literal `21` §21.5 fixture sizes, not a stand-in — this is what makes each mark a real proof
    // against that row rather than an arbitrary number.
    expect(marks['first-frame']?.fixtureSize).toBe(100);
    expect(marks['kb-pack']?.fixtureSize).toBeGreaterThanOrEqual(500);
    expect(marks['index-rebuild']?.fixtureSize).toBeGreaterThanOrEqual(1_000);
  });

  it('never lowers (worsens) an already-recorded mark, only ever improves it', () => {
    const marksPath = freshMarksPath();
    // A deliberately fast prior mark, far below any real measurement this run could produce here.
    const priorMarks: Record<string, { ms: number; fixtureSize: number }> = Object.fromEntries(
      BENCHMARK_NAMES.map((name) => [name, { ms: 0.001, fixtureSize: 1 }]),
    );
    scratchDirs.push(path.dirname(marksPath));
    writeFileSync(marksPath, JSON.stringify(priorMarks));

    run([], marksPath);
    const marks = JSON.parse(readFileSync(marksPath, 'utf8')) as Record<string, { ms: number }>;
    for (const name of BENCHMARK_NAMES) {
      expect(marks[name]?.ms).toBe(0.001);
    }
  });
});

describe('bench.mjs --check', () => {
  it('does not write the marks file at all — a gate must not rewrite its own baseline', () => {
    const marksPath = freshMarksPath();
    run(['--check'], marksPath);
    expect(existsSync(marksPath)).toBe(false);
  });

  it('exits non-zero and names the offending benchmark when a deliberately-tightened mark makes every real measurement a regression', () => {
    const marksPath = freshMarksPath();
    const impossiblyFastMarks: Record<string, { ms: number; fixtureSize: number }> =
      Object.fromEntries(BENCHMARK_NAMES.map((name) => [name, { ms: 0.0001, fixtureSize: 1 }]));
    writeFileSync(marksPath, JSON.stringify(impossiblyFastMarks));

    const { status, output } = run(['--check'], marksPath);
    expect(status).not.toBe(0);
    expect(output).toContain('regression');
  });
});

describe('bench.mjs — a stale/broken CLI entry (round-1 critic finding)', () => {
  it('fails with a clear, actionable message instead of an opaque, unhandled stack trace', () => {
    const scratchDir = mkdtempSync(path.join(tmpdir(), 'forge-bench-broken-cli-'));
    scratchDirs.push(scratchDir);
    const brokenEntry = path.join(scratchDir, 'broken-forge.mjs');
    // Simulates a dist/forge.mjs built before --version was wired: exits non-zero on any invocation.
    writeFileSync(brokenEntry, "process.exitCode = 1;\nconsole.error('forge: not wired');\n");

    const marksPath = freshMarksPath();
    const { status, output } = (() => {
      try {
        return {
          status: 0,
          output: execFileSync(process.execPath, ['--experimental-strip-types', benchScript], {
            cwd: repoRoot,
            encoding: 'utf8',
            env: {
              ...process.env,
              FORGE_BENCH_MARKS_PATH: marksPath,
              FORGE_BENCH_CLI_ENTRY: brokenEntry,
              FORGE_BENCH_SUBPROCESS_SAMPLES: '1',
              FORGE_BENCH_IN_PROCESS_SAMPLES: '1',
            },
          }),
        };
      } catch (error) {
        const failure = error as { status?: number; stdout?: string; stderr?: string };
        return {
          status: failure.status ?? 1,
          output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
        };
      }
    })();

    expect(status).not.toBe(0);
    expect(output).toContain('stale build');
    expect(output).toContain('pnpm build');
    // No benchmark ever ran, and no marks were written for a run that never produced real data.
    expect(existsSync(marksPath)).toBe(false);
  });
});
