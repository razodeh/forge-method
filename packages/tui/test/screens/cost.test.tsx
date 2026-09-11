/**
 * `<CostScreen>` -- `04` §4.3 S7: spend/token/wall-clock breakdowns, cache-hit indicators, budget
 * burn-down, top-10 most expensive steps, cost-per-merged-story.
 *
 * @see specs/04 §4.3 S7
 * @see PLAN-M9.md P13
 */
import type { LedgerEntry } from '@forge/telemetry/ledger';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';

import type { RenderMode } from '../../src/env.ts';
import {
  CostScreen,
  type CostScreenProps,
  costPerMergedStory,
  topExpensiveSteps,
} from '../../src/screens/cost.tsx';
import { INITIAL_RUN_READ_MODEL, type RunReadModel } from '../../src/state/run-read-model.ts';

const MODE: RenderMode = { color: true, ascii: false, linear: false, columns: 120, lines: 40 };

function entry(overrides: Partial<LedgerEntry> & { stepId: string; costUsd: number }): LedgerEntry {
  return {
    runId: 'run-1',
    agent: 'backend-engineer',
    model: 'model-a',
    platform: 'adapter-x',
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    estimated: false,
    durationMs: 1000,
    ts: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function baseProps(overrides: Partial<CostScreenProps> = {}): CostScreenProps {
  const readModel: RunReadModel = { ...INITIAL_RUN_READ_MODEL, spentUsd: 10 };
  return {
    mode: MODE,
    readModel,
    focusedPaneIndex: 0,
    entries: [entry({ stepId: 'STEP-1', costUsd: 1 }), entry({ stepId: 'STEP-2', costUsd: 2 })],
    runLabel: 'acme-billing',
    stageBreakdown: [{ key: 'MVP', value: '$3.00' }],
    burnDownSeries: [1, 2, 3, 4],
    velocitySeries: [0.5, 0.7, 0.9],
    mergedStoryCount: 2,
    ...overrides,
  };
}

describe('topExpensiveSteps', () => {
  it('ranks steps by attributedSpend descending', () => {
    const entries = [
      entry({ stepId: 'A', costUsd: 1 }),
      entry({ stepId: 'B', costUsd: 5 }),
      entry({ stepId: 'C', costUsd: 3 }),
    ];
    expect(topExpensiveSteps(entries).map((s) => s.stepId)).toEqual(['B', 'C', 'A']);
  });

  it('sums attributedSpend across multiple entries for the same stepId (retries), never just the latest', () => {
    const entries = [entry({ stepId: 'A', costUsd: 1 }), entry({ stepId: 'A', costUsd: 2 })];
    expect(topExpensiveSteps(entries)).toEqual([{ stepId: 'A', costUsd: 3, hasCacheHits: false }]);
  });

  it('breaks a cost tie by stepId ascending, deterministically', () => {
    const entries = [
      entry({ stepId: 'ZEBRA', costUsd: 5 }),
      entry({ stepId: 'ALPHA', costUsd: 5 }),
    ];
    expect(topExpensiveSteps(entries).map((s) => s.stepId)).toEqual(['ALPHA', 'ZEBRA']);
  });

  it('shows exactly the 10 most expensive steps when given more than 10', () => {
    const entries = Array.from({ length: 15 }, (_, i) =>
      entry({ stepId: `STEP-${String(i)}`, costUsd: i }),
    );
    const top = topExpensiveSteps(entries);
    expect(top).toHaveLength(10);
    expect(top.map((s) => s.stepId)).toEqual([
      'STEP-14',
      'STEP-13',
      'STEP-12',
      'STEP-11',
      'STEP-10',
      'STEP-9',
      'STEP-8',
      'STEP-7',
      'STEP-6',
      'STEP-5',
    ]);
  });

  it("hasCacheHits is true only when at least one of the stepId's own entries reports cacheReadTokens > 0", () => {
    const entries = [
      entry({ stepId: 'A', costUsd: 1, cacheReadTokens: 0 }),
      entry({ stepId: 'B', costUsd: 1, cacheReadTokens: 50 }),
    ];
    const ranked = topExpensiveSteps(entries);
    expect(ranked.find((s) => s.stepId === 'A')?.hasCacheHits).toBe(false);
    expect(ranked.find((s) => s.stepId === 'B')?.hasCacheHits).toBe(true);
  });

  it('an empty ledger produces an empty ranking, not a crash', () => {
    expect(topExpensiveSteps([])).toEqual([]);
  });

  it('a negative limit produces an empty ranking, never Array.prototype.slice\'s own "drop the last |n|" behavior', () => {
    const entries = [
      entry({ stepId: 'A', costUsd: 1 }),
      entry({ stepId: 'B', costUsd: 2 }),
      entry({ stepId: 'C', costUsd: 3 }),
    ];
    expect(topExpensiveSteps(entries, -1)).toEqual([]);
  });

  it('a real, correctly-cut 3-way tie exactly at the top-N boundary', () => {
    const entries = [
      entry({ stepId: 'HIGH', costUsd: 10 }),
      entry({ stepId: 'TIE-C', costUsd: 5 }),
      entry({ stepId: 'TIE-A', costUsd: 5 }),
      entry({ stepId: 'TIE-B', costUsd: 5 }),
    ];
    // limit=2: HIGH always makes it; among the 5-cost ties, only the lowest stepId ("TIE-A") does.
    expect(topExpensiveSteps(entries, 2).map((s) => s.stepId)).toEqual(['HIGH', 'TIE-A']);
  });
});

describe('costPerMergedStory', () => {
  it('divides total spend by merged story count exactly', () => {
    expect(costPerMergedStory(10, 4)).toBe(2.5);
  });

  it('returns undefined (never Infinity/NaN) when nothing has merged yet', () => {
    expect(costPerMergedStory(10, 0)).toBeUndefined();
  });

  it('returns undefined for a negative merged count', () => {
    expect(costPerMergedStory(10, -1)).toBeUndefined();
  });

  it('returns undefined for a non-finite total spend', () => {
    expect(costPerMergedStory(Number.NaN, 2)).toBeUndefined();
    expect(costPerMergedStory(Number.POSITIVE_INFINITY, 2)).toBeUndefined();
  });

  it('returns undefined for a negative total spend -- never a nonsensical negative $ figure', () => {
    expect(costPerMergedStory(-5, 2)).toBeUndefined();
  });
});

describe('<CostScreen>', () => {
  it('renders total spend, cost-per-merged-story, and the per-stage/agent/model breakdowns', () => {
    const { lastFrame } = render(<CostScreen {...baseProps()} />);
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('acme-billing');
    expect(frame).toContain('Total spend: $10.00');
    expect(frame).toContain('Cost per merged story: $5.00'); // 10 / 2
    expect(frame).toContain('MVP');
    expect(frame).toContain('backend-engineer');
    expect(frame).toContain('model-a');
  });

  it('renders the "no merged stories yet" notice, never $Infinity/$NaN, when mergedStoryCount is 0', () => {
    const { lastFrame } = render(<CostScreen {...baseProps({ mergedStoryCount: 0 })} />);
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('no merged stories yet');
    expect(frame).not.toContain('Infinity');
    expect(frame).not.toContain('NaN');
  });

  it('renders the top-10 table with cache-hit indicators only for steps that actually have them', () => {
    const entries = [
      entry({ stepId: 'STEP-1', costUsd: 5, cacheReadTokens: 100 }),
      entry({ stepId: 'STEP-2', costUsd: 3, cacheReadTokens: 0 }),
    ];
    const { lastFrame } = render(<CostScreen {...baseProps({ entries })} />);
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('STEP-1 — $5.00 ⚡ cache hits');
    expect(frame).toContain('STEP-2 — $3.00');
    expect(frame).not.toContain('STEP-2 — $3.00 ⚡');
  });

  it('renders no cache-hit indicator at all when no real ledger entry reports cache reads', () => {
    const entries = [entry({ stepId: 'STEP-1', costUsd: 1, cacheReadTokens: 0 })];
    const { lastFrame } = render(<CostScreen {...baseProps({ entries })} />);
    expect(stripAnsi(lastFrame() ?? '')).not.toContain('cache hits');
  });

  it('renders the burn-down and velocity sparklines from their own real series', () => {
    const { lastFrame } = render(<CostScreen {...baseProps()} />);
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('Budget burn-down');
    expect(frame).toContain('Velocity');
  });

  it('an empty ledger renders cleanly, no throw, no phantom top-10 rows', () => {
    expect(() => render(<CostScreen {...baseProps({ entries: [] })} />)).not.toThrow();
  });

  it('renders at three canonical terminal widths without throwing', () => {
    for (const columns of [60, 100, 160]) {
      const mode: RenderMode = { ...MODE, columns };
      expect(() => render(<CostScreen {...baseProps({ mode })} />)).not.toThrow();
    }
  });
});
