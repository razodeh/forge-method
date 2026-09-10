/**
 * `computeFlakeRate`/`recordFlakeOutcome`/`testFlaky` — `PLAN-M8.md` P7's own Checks section.
 *
 * @see specs/13 §13.1 F-TEST-6
 * @see PLAN-M8.md P7
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ProjectPaths } from '@forge/core/fs';
import { afterEach, describe, expect, it } from 'vitest';

import {
  computeFlakeRate,
  readFlakyState,
  recordFlakeOutcome,
  testFlaky,
  writeFlakyState,
  type FlakyState,
} from '../../../../src/commands/loop/test/flaky.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function project(): Promise<ProjectPaths> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-flaky-'));
  dirs.push(dir);
  return new ProjectPaths(dir);
}

function fullWindow(
  record: ReturnType<typeof recordFlakeOutcome> | undefined,
): ReturnType<typeof recordFlakeOutcome> {
  let current = record;
  for (let i = 0; i < 20; i += 1) current = recordFlakeOutcome(current, false);
  return current!;
}

describe('computeFlakeRate', () => {
  it('reports 5% for a 20-entry window with 1 failure', () => {
    const outcomes: readonly ('pass' | 'fail')[] = [
      ...Array.from({ length: 19 }, () => 'pass' as const),
      'fail',
    ];
    expect(computeFlakeRate(outcomes)).toBe(5);
  });

  it('reports 0% for a 20-entry window with 0 failures', () => {
    const outcomes = Array(20).fill('pass') as readonly ('pass' | 'fail')[];
    expect(computeFlakeRate(outcomes)).toBe(0);
  });

  it('reports 0%, not NaN, for an empty window', () => {
    expect(computeFlakeRate([])).toBe(0);
  });
});

describe('recordFlakeOutcome', () => {
  it('records "pass" for a clean first-pass pass', () => {
    const record = recordFlakeOutcome(undefined, false);
    expect(record.outcomes).toEqual(['pass']);
    expect(record.quarantined).toBe(false);
  });

  it('records "fail" only when isFlakeOccurrence is true (a first-pass failure the retry does NOT reproduce)', () => {
    const record = recordFlakeOutcome(undefined, true);
    expect(record.outcomes).toEqual(['fail']);
  });

  it('does not quarantine on a single flake occurrence against a brand-new, 1-entry window', () => {
    // A fresh critic round reproduced this directly: a 1-entry window's own 100% rate crossed the
    // threshold immediately, contradicting F-TEST-6's own explicit "2% over 20 runs" framing — a rate
    // is only meaningful once measured against something close to the full window.
    const record = recordFlakeOutcome(undefined, true);
    expect(record.quarantined).toBe(false);
  });

  it('quarantines once a FULL rolling window crosses the 2% default threshold', () => {
    let record: ReturnType<typeof recordFlakeOutcome> | undefined;
    // 1 flake in a 20-entry (full) window is exactly 5%, comfortably over the 2% threshold.
    for (let i = 0; i < 19; i += 1) record = recordFlakeOutcome(record, false);
    expect(record?.quarantined).toBe(false);
    record = recordFlakeOutcome(record, true);
    expect(record.quarantined).toBe(true);
  });

  it('never un-quarantines once latched, even after the rolling rate drops back below the threshold', () => {
    let record = fullWindow(recordFlakeOutcome(undefined, true));
    expect(record.quarantined).toBe(true);
    // 20 more consecutive clean passes afterward drive the rolling rate back to 0%.
    record = fullWindow(record);
    expect(computeFlakeRate(record.outcomes)).toBe(0);
    expect(record.quarantined).toBe(true);
  });

  it('keeps the rolling window at exactly 20 entries, dropping the oldest', () => {
    let record: ReturnType<typeof recordFlakeOutcome> | undefined;
    for (let i = 0; i < 25; i += 1) record = recordFlakeOutcome(record, false);
    expect(record?.outcomes.length).toBe(20);
  });

  it('honours a real, custom config (window/threshold), not just the hardcoded defaults', () => {
    let record: ReturnType<typeof recordFlakeOutcome> | undefined;
    const config = { maxRatePct: 40, window: 2, quarantineCap: 5 };
    // A 2-entry window, 40% threshold: after exactly 1 call the window isn't full yet (never
    // quarantined regardless of rate); after 2 calls the window is full at a real 50% rate, over the
    // real, custom 40% threshold — a default config (window: 20, maxRatePct: 2) would never trigger
    // this fast, proving the config is genuinely read, not just accepted and ignored.
    record = recordFlakeOutcome(record, true, config);
    expect(record.quarantined).toBe(false);
    record = recordFlakeOutcome(record, false, config);
    expect(record.outcomes.length).toBe(2);
    expect(record.quarantined).toBe(true);
  });
});

describe('readFlakyState / writeFlakyState', () => {
  it('reports the real, empty state when flaky.json has never been written', async () => {
    const paths = await project();
    const state = await readFlakyState(paths);
    expect(state).toEqual({ v: 1, tests: {} });
  });

  it('round-trips a real, written state', async () => {
    const paths = await project();
    const state: FlakyState = {
      v: 1,
      tests: { 'AC-001-1 flakes sometimes': { outcomes: ['pass', 'fail'], quarantined: false } },
    };
    await writeFlakyState(paths, state);
    const read = await readFlakyState(paths);
    expect(read).toEqual(state);
  });

  it('throws RUN-059 for a malformed flaky.json, not a silent empty reset', async () => {
    const paths = await project();
    // A real, written baseline first, then overwritten with a structurally wrong shape.
    await writeFlakyState(paths, { v: 1, tests: {} });
    await writeFile(
      paths.resolveWithin('docs/forge/reports/flaky.json'),
      JSON.stringify({ v: 2, nope: true }),
      'utf8',
    );
    await expect(readFlakyState(paths)).rejects.toMatchObject({ code: 'RUN-059' });
  });

  it.each([
    ['not real JSON at all', 'not json'],
    ['a top-level JSON array', JSON.stringify([])],
    ['a top-level JSON number', JSON.stringify(42)],
    ['tests as an array, not an object', JSON.stringify({ v: 1, tests: [] })],
    [
      'a test record whose outcomes contain a non-pass/fail string',
      JSON.stringify({ v: 1, tests: { a: { outcomes: ['maybe'], quarantined: false } } }),
    ],
    [
      'a test record whose quarantined field is not a boolean',
      JSON.stringify({ v: 1, tests: { a: { outcomes: [], quarantined: 'yes' } } }),
    ],
  ])('throws RUN-059 for %s', async (_label, raw) => {
    const paths = await project();
    await mkdir(paths.resolveWithin('docs/forge/reports'), { recursive: true });
    await writeFile(paths.resolveWithin('docs/forge/reports/flaky.json'), raw, 'utf8');
    await expect(readFlakyState(paths)).rejects.toMatchObject({ code: 'RUN-059' });
  });
});

describe('testFlaky', () => {
  it('reports flaky: 0, quarantined: 0 for a project with no flaky.json at all', async () => {
    const paths = await project();
    const result = await testFlaky(paths);
    expect(result).toEqual({ flaky: 0, quarantined: 0 });
  });

  it('reports quarantined: 6 for a project with 6 quarantined tests, naming each one', async () => {
    const paths = await project();
    const tests: Record<string, FlakyState['tests'][string]> = {};
    for (let i = 0; i < 6; i += 1) {
      tests[`test-${String(i)}`] = { outcomes: ['fail'], quarantined: true };
    }
    await writeFlakyState(paths, { v: 1, tests });

    const result = await testFlaky(paths);

    expect(result.quarantined).toBe(6);
    expect(result.quarantinedTests).toHaveLength(6);
  });

  it('reports quarantined: 5 for a project with exactly 5 quarantined tests', async () => {
    const paths = await project();
    const tests: Record<string, FlakyState['tests'][string]> = {};
    for (let i = 0; i < 5; i += 1) {
      tests[`test-${String(i)}`] = { outcomes: ['fail'], quarantined: true };
    }
    await writeFlakyState(paths, { v: 1, tests });

    const result = await testFlaky(paths);

    expect(result.quarantined).toBe(5);
  });

  it('counts a quarantined test toward "flaky" even when its current rolling rate has since dropped under threshold', async () => {
    const paths = await project();
    await writeFlakyState(paths, {
      v: 1,
      tests: {
        'AC-900-1 was flaky once': {
          outcomes: Array(20).fill('pass') as readonly ('pass' | 'fail')[],
          quarantined: true,
        },
      },
    });

    const result = await testFlaky(paths);

    expect(result.flaky).toBe(1);
  });

  it('counts a currently-above-threshold test toward "flaky" even before it is quarantined, and names it', async () => {
    const paths = await project();
    await writeFlakyState(paths, {
      v: 1,
      tests: {
        'AC-900-2 flakes right now': { outcomes: ['fail', 'pass'], quarantined: false },
      },
    });

    const result = await testFlaky(paths);

    expect(result.flaky).toBe(1);
    expect(result.flakyTests).toEqual(['AC-900-2 flakes right now']);
  });

  it('reports a real problem, forcing flaky/quarantined past both real thresholds — never a silent clean pass a gate could read as passing', async () => {
    // A fresh critic round reproduced this directly against the real `evaluateGate`: the first
    // draft's own `{flaky: 0, quarantined: 0, problems: [...]}` made both `test:flaky`
    // (`failOn: 'flaky > 0'`) and `test:quarantine-cap` (`failOn: 'quarantined > 5'`) report a clean
    // pass on a check that could not actually be verified.
    const paths = await project();
    await mkdir(paths.resolveWithin('docs/forge/reports'), { recursive: true });
    await writeFile(paths.resolveWithin('docs/forge/reports/flaky.json'), 'not json', 'utf8');

    const result = await testFlaky(paths);

    expect(result.problems?.length).toBeGreaterThan(0);
    expect(result.flaky).toBeGreaterThan(0);
    expect(result.quarantined).toBeGreaterThan(5);
  });

  it('honours a real, custom quarantineCap from config', async () => {
    const paths = await project();
    await mkdir(paths.resolveWithin('docs/forge/reports'), { recursive: true });
    await writeFile(paths.resolveWithin('docs/forge/reports/flaky.json'), 'not json', 'utf8');

    const result = await testFlaky(paths, { maxRatePct: 2, window: 20, quarantineCap: 100 });

    expect(result.quarantined).toBeGreaterThan(100);
  });
});
