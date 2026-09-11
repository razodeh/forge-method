/**
 * `<HomeScreen>` / `rankNextActions` -- `04` §4.3 S1.
 *
 * @see specs/04 §4.3 S1, §4.8
 * @see PLAN-M9.md P7
 */
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';

import type { RenderMode } from '../../src/env.ts';
import {
  type ActivityEntry,
  canonicalStateFor,
  type HealthSummary,
  HomeScreen,
  type NextActionCandidate,
  type ProjectInfo,
  rankNextActions,
} from '../../src/screens/home.tsx';
import type { RunStatus } from '../../src/state/run-read-model.ts';

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

const MODE: RenderMode = { color: true, ascii: false, linear: false, columns: 120, lines: 40 };

describe('rankNextActions', () => {
  function candidate(
    overrides: Partial<NextActionCandidate> & { id: string },
  ): NextActionCandidate {
    return {
      description: 'do a thing',
      command: 'forge do-thing',
      isBlocking: false,
      gateReady: false,
      unblockCost: 0,
      matchesDeclaredGoal: false,
      ...overrides,
    };
  }

  it('ranks blocking candidates ahead of non-blocking ones, above all else', () => {
    const blocking = candidate({ id: 'a', isBlocking: true });
    const nonBlocking = candidate({
      id: 'b',
      isBlocking: false,
      gateReady: true,
      unblockCost: -100,
    });
    expect(rankNextActions([nonBlocking, blocking])).toEqual([blocking, nonBlocking]);
  });

  it('given equal blocking-ness, ranks gate-ready candidates ahead of not-ready ones', () => {
    const ready = candidate({ id: 'a', gateReady: true });
    const notReady = candidate({ id: 'b', gateReady: false, unblockCost: -100 });
    expect(rankNextActions([notReady, ready])).toEqual([ready, notReady]);
  });

  it('given equal blocking-ness and gate readiness, ranks the cheaper unblock cost first', () => {
    const cheap = candidate({ id: 'a', unblockCost: 1 });
    const expensive = candidate({ id: 'b', unblockCost: 5 });
    expect(rankNextActions([expensive, cheap])).toEqual([cheap, expensive]);
  });

  it('a tie on the first three factors is broken by the declared-goal factor alone', () => {
    const matchesGoal = candidate({ id: 'a', unblockCost: 3, matchesDeclaredGoal: true });
    const doesNotMatch = candidate({ id: 'b', unblockCost: 3, matchesDeclaredGoal: false });
    expect(rankNextActions([doesNotMatch, matchesGoal])).toEqual([matchesGoal, doesNotMatch]);
  });

  it('a tie on all four factors falls back to a stable, deterministic id compare', () => {
    const first = candidate({ id: 'a' });
    const second = candidate({ id: 'b' });
    expect(rankNextActions([second, first])).toEqual([first, second]);
  });

  it('does not mutate the input array', () => {
    const items = [candidate({ id: 'b' }), candidate({ id: 'a' })];
    const original = [...items];
    rankNextActions(items);
    expect(items).toEqual(original);
  });

  it('a NaN unblockCost is treated as the worst possible cost, never breaking the comparator\'s own consistency -- a fresh critic round reproduced the original design comparing NaN via plain subtraction, which Array.prototype.sort silently treats as "no swap," so the same set of candidates ranked differently depending on their starting array order', () => {
    const nanCost = candidate({ id: 'nan-cost', unblockCost: Number.NaN });
    const normalCost = candidate({ id: 'normal-cost', unblockCost: 5 });
    const cheapest = candidate({ id: 'cheapest', unblockCost: 1 });

    // Regardless of starting order, the NaN-cost candidate always sorts last (worst), and the two
    // finite-cost candidates always sort correctly relative to each other.
    const forward = rankNextActions([cheapest, normalCost, nanCost]);
    const reversed = rankNextActions([nanCost, normalCost, cheapest]);
    expect(forward.map((item) => item.id)).toEqual(['cheapest', 'normal-cost', 'nan-cost']);
    expect(reversed.map((item) => item.id)).toEqual(['cheapest', 'normal-cost', 'nan-cost']);
  });

  it('-Infinity is treated the same as NaN/+Infinity -- the worst possible cost, not "infinitely cheap" -- since a real cost has no legitimate reason to be non-finite regardless of sign; a real caller-side formula bug (an unguarded subtraction of infinities) is the only plausible source of either', () => {
    const cheap = candidate({ id: 'cheap', unblockCost: 1 });
    const normal = candidate({ id: 'normal', unblockCost: 5 });
    const negativeInfinity = candidate({ id: 'neg-inf', unblockCost: Number.NEGATIVE_INFINITY });
    const positiveInfinity = candidate({ id: 'pos-inf', unblockCost: Number.POSITIVE_INFINITY });
    const nanCost = candidate({ id: 'nan', unblockCost: Number.NaN });

    const forward = rankNextActions([cheap, normal, negativeInfinity, positiveInfinity, nanCost]);
    const reversed = rankNextActions([nanCost, positiveInfinity, negativeInfinity, normal, cheap]);
    expect(forward.slice(0, 2).map((item) => item.id)).toEqual(['cheap', 'normal']);
    expect(reversed.slice(0, 2).map((item) => item.id)).toEqual(['cheap', 'normal']);
    // The three non-finite candidates all tie at "worst" and fall through to the id tiebreak, in
    // both starting orders alike.
    expect(forward.slice(2).map((item) => item.id)).toEqual(['nan', 'neg-inf', 'pos-inf']);
    expect(reversed.slice(2).map((item) => item.id)).toEqual(['nan', 'neg-inf', 'pos-inf']);
  });

  it('two candidates both with a NaN unblockCost fall through to the declared-goal factor, not a frozen input order', () => {
    const matchesGoal = candidate({ id: 'a', unblockCost: Number.NaN, matchesDeclaredGoal: true });
    const doesNotMatch = candidate({
      id: 'b',
      unblockCost: Number.NaN,
      matchesDeclaredGoal: false,
    });
    expect(rankNextActions([doesNotMatch, matchesGoal])).toEqual([matchesGoal, doesNotMatch]);
  });

  it('an empty candidate list ranks to an empty list', () => {
    expect(rankNextActions([])).toEqual([]);
  });
});

describe('canonicalStateFor', () => {
  it('maps every real RunStatus value to its own documented canonical state', () => {
    expect(canonicalStateFor(undefined)).toBe('empty');
    expect(canonicalStateFor('planned')).toBe('loading');
    expect(canonicalStateFor('started')).toBe('running');
    expect(canonicalStateFor('resumed')).toBe('running');
    expect(canonicalStateFor('paused')).toBe('blocked');
    expect(canonicalStateFor('failed')).toBe('failed');
    expect(canonicalStateFor('aborted')).toBe('failed');
    expect(canonicalStateFor('completed')).toBe('complete');
  });
});

function project(): ProjectInfo {
  return {
    name: 'acme-billing',
    level: 'L3',
    platform: 'adapter-x',
    stages: ['MVP', 'M2', 'GA'],
    currentStageIndex: 0,
    autonomy: 'guided',
  };
}

function health(overrides: Partial<HealthSummary> = {}): HealthSummary {
  return {
    kb: { entries: 84, stale: 0, contradictions: 0 },
    specs: { epics: 6, stories: 31, orphanStories: 0, traceabilityPct: 94 },
    build: {
      passing: true,
      lastRunAgo: '3m ago',
      testsPassed: 412,
      testsTotal: 412,
      coveragePct: 81,
    },
    gates: [
      { gateId: 'G-Product', status: 'pass' },
      { gateId: 'G-Design', status: 'waiting' },
      { gateId: 'G-Ready', status: 'blocked' },
      { gateId: 'G-Verify', status: undefined },
      { gateId: 'G-Deliver', status: undefined },
    ],
    ...overrides,
  };
}

function activity(): readonly ActivityEntry[] {
  return [
    {
      id: 'a1',
      timeLabel: '12:41',
      actor: 'architect',
      message: 'ADR-014 drafted: primary datastore',
    },
    { id: 'a2', timeLabel: '12:38', actor: 'sdet', message: 'test plan for EPIC-003 generated' },
  ];
}

function actions(): readonly NextActionCandidate[] {
  return [
    {
      id: 'gate-approve',
      description: 'Approve gate G-Design (2 open questions)',
      command: 'forge gate approve G-Design',
      isBlocking: true,
      gateReady: true,
      unblockCost: 1,
      matchesDeclaredGoal: false,
    },
    {
      id: 'decide-store',
      description: '3 stories blocked on ADR-014 (data store)',
      command: 'forge decide data-store',
      isBlocking: true,
      gateReady: false,
      unblockCost: 3,
      matchesDeclaredGoal: false,
    },
  ];
}

async function renderHome(overrides: {
  mode?: RenderMode;
  runStatus?: RunStatus;
  healthOverrides?: Partial<HealthSummary>;
  focusedPaneIndex?: number;
}) {
  const result = render(
    <HomeScreen
      mode={overrides.mode ?? MODE}
      readModel={{
        runStatus: overrides.runStatus,
        stepStatuses: new Map(),
        laneStatuses: new Map(),
        spentUsd: 0,
      }}
      focusedPaneIndex={overrides.focusedPaneIndex ?? 0}
      project={project()}
      health={health(overrides.healthOverrides)}
      nextActionCandidates={actions()}
      recentActivity={activity()}
    />,
  );
  await flush();
  return result;
}

describe('HomeScreen', () => {
  it('renders all four panes', async () => {
    const { lastFrame } = await renderHome({});
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('Project');
    expect(frame).toContain('Next actions');
    expect(frame).toContain('Health');
    expect(frame).toContain('Recent activity');
  });

  it('renders the Project pane with real project facts', async () => {
    const { lastFrame } = await renderHome({});
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('acme-billing');
    expect(frame).toContain('Level L3');
    expect(frame).toContain('adapter-x');
    expect(frame).toContain('guided');
  });

  it("renders the run's own canonical state as a real status line in the Project pane, not just computed for the snapshot matrix's own sake", async () => {
    const running = await renderHome({ runStatus: 'started' });
    expect(stripAnsi(running.lastFrame() ?? '')).toContain('running');
    const blocked = await renderHome({ runStatus: 'paused' });
    expect(stripAnsi(blocked.lastFrame() ?? '')).toContain('blocked, waiting on human input');
    const empty = await renderHome({ runStatus: undefined });
    expect(stripAnsi(empty.lastFrame() ?? '')).toContain('no active run');
  });

  it('renders next actions in ranked order, each with its own command', async () => {
    const { lastFrame } = await renderHome({});
    const frame = stripAnsi(lastFrame() ?? '');
    const approveIndex = frame.indexOf('Approve gate G-Design');
    const decideIndex = frame.indexOf('3 stories blocked');
    expect(approveIndex).toBeGreaterThanOrEqual(0);
    expect(decideIndex).toBeGreaterThan(approveIndex); // gate-ready ranks first
    expect(frame).toContain('forge gate approve G-Design');
  });

  it("Health pane's KB row renders ✗ when a fixture has a real contradiction, ✓ when it does not", async () => {
    const withContradiction = await renderHome({
      healthOverrides: { kb: { entries: 1, stale: 0, contradictions: 1 } },
    });
    const withoutContradiction = await renderHome({
      healthOverrides: { kb: { entries: 1, stale: 0, contradictions: 0 } },
    });
    expect(stripAnsi(withContradiction.lastFrame() ?? '')).toContain('KB ✗');
    expect(stripAnsi(withoutContradiction.lastFrame() ?? '')).toContain('KB ✓');
  });

  it("Health pane's Build row renders ✗ when not passing, ✓ when passing", async () => {
    const failing = await renderHome({
      healthOverrides: {
        build: {
          passing: false,
          lastRunAgo: '1m ago',
          testsPassed: 1,
          testsTotal: 2,
          coveragePct: 50,
        },
      },
    });
    expect(stripAnsi(failing.lastFrame() ?? '')).toContain('Build ✗');
  });

  it('renders a gate with no status yet as a plain em dash, not a StatusGlyph state', async () => {
    const { lastFrame } = await renderHome({});
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('G-Verify —');
    expect(frame).toContain('G-Deliver —');
  });

  it('renders recent activity entries, most-recent-first as given', async () => {
    const { lastFrame } = await renderHome({});
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('architect');
    expect(frame).toContain('ADR-014 drafted');
    expect(frame).toContain('sdet');
  });

  it('focusedPaneIndex selects which of the 4 panes is visually focused, wrapping modulo 4', async () => {
    const focusedOnHealth = await renderHome({ focusedPaneIndex: 2 });
    const alsoFocusedOnHealth = await renderHome({ focusedPaneIndex: 6 }); // 6 % 4 === 2
    expect(focusedOnHealth.lastFrame()).toBe(alsoFocusedOnHealth.lastFrame());
  });

  const canonicalStates: readonly { readonly name: string; readonly runStatus: RunStatus }[] = [
    { name: 'empty', runStatus: undefined },
    { name: 'loading', runStatus: 'planned' },
    { name: 'running', runStatus: 'started' },
    { name: 'blocked', runStatus: 'paused' },
    { name: 'failed', runStatus: 'failed' },
    { name: 'complete', runStatus: 'completed' },
  ];
  const widths: readonly { readonly columns: number; readonly lines: number }[] = [
    { columns: 80, lines: 24 },
    { columns: 100, lines: 30 },
    { columns: 120, lines: 40 },
  ];

  for (const { columns, lines } of widths) {
    for (const { name, runStatus } of canonicalStates) {
      it(`renders a distinct snapshot at ${String(columns)}x${String(lines)} for the "${name}" canonical state`, async () => {
        const { lastFrame } = await renderHome({
          runStatus,
          mode: { ...MODE, columns, lines },
        });
        expect(lastFrame()).toMatchSnapshot();
      });
    }
  }

  it('every one of the 6 canonical states produces a genuinely distinct frame at a fixed width', async () => {
    const frames = new Set<string>();
    for (const { runStatus } of canonicalStates) {
      const { lastFrame } = await renderHome({ runStatus });
      frames.add(lastFrame() ?? '');
    }
    expect(frames.size).toBe(canonicalStates.length);
  });
});
