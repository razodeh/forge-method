/**
 * `<RunBoard>` -- `04` §4.3 S2, the core screen: lane list/detail, five sub-tabs, interject, scheduler
 * footer.
 *
 * See `list-pane.test.tsx`'s own header comment for why every test that presses a key awaits `flush()`
 * once right after `render()`, before the first `stdin.write()`.
 *
 * @see specs/04 §4.3 S2
 * @see PLAN-M9.md P8
 */
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';

import type { RenderMode } from '../../src/env.ts';
import {
  formatSchedulerLine,
  type LaneCheckEntry,
  type LaneDetail,
  type LaneFileEntry,
  type LaneSummary,
  RunBoard,
  type RunBoardScreenProps,
  type SchedulerFooter,
} from '../../src/screens/run-board.tsx';
import type { EngineCommand } from '../../src/state/engine-command.ts';
import { INITIAL_RUN_READ_MODEL } from '../../src/state/run-read-model.ts';

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

interface StdinLike {
  write(data: string): void;
}

async function press(stdin: StdinLike, data: string): Promise<void> {
  stdin.write(data);
  await flush();
}

const MODE: RenderMode = { color: true, ascii: false, linear: false, columns: 120, lines: 40 };

function lane(overrides: Partial<LaneSummary> & { id: string }): LaneSummary {
  return { label: `lane ${overrides.id}`, status: 'running', ...overrides };
}

function detail(overrides: Partial<LaneDetail> & { id: string }): LaneDetail {
  return {
    headline: 'Step 3/6 implement',
    transcript: ['12:40:02 Read src/a.ts'],
    diffPatch: '',
    files: [],
    checks: [],
    prompt: 'do the thing',
    ...overrides,
  };
}

function scheduler(overrides: Partial<SchedulerFooter> = {}): SchedulerFooter {
  return {
    ready: 4,
    running: 3,
    runningCap: 4,
    blocked: 2,
    blockedReason: 'ADR-014',
    mergeQueue: 1,
    spentUsd: 4.21,
    budgetCapUsd: 25,
    ...overrides,
  };
}

function baseProps(overrides: Partial<RunBoardScreenProps> = {}): RunBoardScreenProps {
  const lanes: readonly LaneSummary[] = [
    lane({ id: 'story-014', label: 'story-014 backend', status: 'running' }),
    lane({ id: 'story-016', label: 'story-016 frontend', status: 'waiting' }),
  ];
  const laneDetails = new Map<string, LaneDetail>([
    ['story-014', detail({ id: 'story-014', headline: 'Step 3/6 implement' })],
    ['story-016', detail({ id: 'story-016', headline: 'Step 1/4 plan' })],
  ]);
  return {
    mode: MODE,
    readModel: INITIAL_RUN_READ_MODEL,
    focusedPaneIndex: 0,
    lanes,
    laneDetails,
    scheduler: scheduler(),
    interjectSupported: true,
    onCommand: () => undefined,
    ...overrides,
  };
}

describe('formatSchedulerLine', () => {
  it('renders every aggregate count, and the blocked reason in parens', () => {
    expect(formatSchedulerLine(scheduler(), { ascii: false })).toBe(
      'ready 4 · running 3/4 · blocked 2 (ADR-014) · merge queue 1 · budget $4.21/$25.00',
    );
  });

  it('ascii mode uses a plain pipe separator, never a middle dot', () => {
    expect(formatSchedulerLine(scheduler(), { ascii: true })).toBe(
      'ready 4 | running 3/4 | blocked 2 (ADR-014) | merge queue 1 | budget $4.21/$25.00',
    );
  });

  it('omits the parenthetical entirely when there is no blocked reason', () => {
    const noReason: SchedulerFooter = {
      ready: 4,
      running: 3,
      runningCap: 4,
      blocked: 0,
      mergeQueue: 1,
      spentUsd: 4.21,
      budgetCapUsd: 25,
    };
    expect(formatSchedulerLine(noReason, { ascii: false })).toBe(
      'ready 4 · running 3/4 · blocked 0 · merge queue 1 · budget $4.21/$25.00',
    );
  });
});

describe('<RunBoard>', () => {
  it('renders both panes, the lane list, and the scheduler footer', () => {
    const { lastFrame } = render(<RunBoard {...baseProps()} />);
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('Lanes');
    expect(frame).toContain('story-014 backend');
    expect(frame).toContain('story-016 frontend');
    expect(frame).toContain('ready 4');
  });

  it('defaults the detail pane to the first lane and the Transcript tab', () => {
    const { lastFrame } = render(<RunBoard {...baseProps()} />);
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('Step 3/6 implement');
    expect(frame).toContain('Transcript');
    expect(frame).toContain('12:40:02 Read src/a.ts');
  });

  it('renders "No lane selected." when there are no lanes at all', () => {
    const { lastFrame } = render(
      <RunBoard {...baseProps({ lanes: [], laneDetails: new Map() })} />,
    );
    expect(stripAnsi(lastFrame() ?? '')).toContain('No lane selected.');
  });

  it('Enter on the focused, list-focused lane list re-selects the lane shown in the detail pane', async () => {
    const { lastFrame, stdin } = render(<RunBoard {...baseProps({ focusedPaneIndex: 0 })} />);
    await flush();
    await press(stdin, '\x1B[B'); // down arrow -- highlight story-016
    await press(stdin, '\r'); // Enter -- inspect
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('Step 1/4 plan');
  });

  describe('v cycles the detail pane sub-tab, in the documented order, and wraps', () => {
    it('Transcript -> Diff -> Files -> Checks -> Prompt -> Transcript', async () => {
      const files: readonly LaneFileEntry[] = [{ path: 'src/a.ts', changeSummary: '+3 -1' }];
      const checks: readonly LaneCheckEntry[] = [
        { name: 'lint', status: 'pass' },
        { name: 'typecheck', status: 'fail', detail: '2 errors' },
      ];
      const laneDetails = new Map<string, LaneDetail>([
        [
          'story-014',
          detail({
            id: 'story-014',
            diffPatch: '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n',
            files,
            checks,
            prompt: 'implement the billing feature',
          }),
        ],
      ]);
      const props = baseProps({
        lanes: [lane({ id: 'story-014' })],
        laneDetails,
        focusedPaneIndex: 1,
      });
      const { lastFrame, stdin } = render(<RunBoard {...props} />);
      await flush();

      expect(stripAnsi(lastFrame() ?? '')).toContain('Transcript');

      await press(stdin, 'v');
      expect(stripAnsi(lastFrame() ?? '')).toContain('Diff');
      expect(stripAnsi(lastFrame() ?? '')).toContain('-old');
      expect(stripAnsi(lastFrame() ?? '')).toContain('+new');

      await press(stdin, 'v');
      expect(stripAnsi(lastFrame() ?? '')).toContain('Files');
      expect(stripAnsi(lastFrame() ?? '')).toContain('src/a.ts');

      await press(stdin, 'v');
      expect(stripAnsi(lastFrame() ?? '')).toContain('Checks');
      expect(stripAnsi(lastFrame() ?? '')).toContain('lint');
      expect(stripAnsi(lastFrame() ?? '')).toContain('2 errors');

      await press(stdin, 'v');
      expect(stripAnsi(lastFrame() ?? '')).toContain('Prompt');
      expect(stripAnsi(lastFrame() ?? '')).toContain('implement the billing feature');

      await press(stdin, 'v');
      expect(stripAnsi(lastFrame() ?? '')).toContain('Transcript');
    });
  });

  it('d jumps straight to the Diff tab from any other tab', async () => {
    const laneDetails = new Map<string, LaneDetail>([
      [
        'story-014',
        detail({ id: 'story-014', diffPatch: '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n' }),
      ],
    ]);
    const props = baseProps({
      lanes: [lane({ id: 'story-014' })],
      laneDetails,
      focusedPaneIndex: 1,
    });
    const { lastFrame, stdin } = render(<RunBoard {...props} />);
    await flush();
    await press(stdin, 'v'); // Transcript -> Diff
    await press(stdin, 'v'); // Diff -> Files
    expect(stripAnsi(lastFrame() ?? '')).toContain('Files');
    await press(stdin, 'd');
    expect(stripAnsi(lastFrame() ?? '')).toContain('Diff');
  });

  describe('lane action keys each emit exactly one EngineCommand, only while the detail pane is focused', () => {
    const cases: readonly { readonly key: string; readonly type: EngineCommand['type'] }[] = [
      { key: 'f', type: 'lane.follow' },
      { key: 's', type: 'lane.stop' },
      { key: 'R', type: 'lane.retryStep' },
      { key: 'm', type: 'lane.requestMerge' },
      { key: 'o', type: 'lane.openWorktree' },
    ];

    for (const { key, type } of cases) {
      it(`"${key}" emits exactly one ${type} command for the selected lane`, async () => {
        const commands: EngineCommand[] = [];
        const props = baseProps({ focusedPaneIndex: 1, onCommand: (c) => commands.push(c) });
        const { stdin } = render(<RunBoard {...props} />);
        await flush();
        await press(stdin, key);
        expect(commands).toEqual([{ type, laneId: 'story-014' }]);
      });

      it(`"${key}" emits nothing while the list pane (not the detail pane) is focused`, async () => {
        const commands: EngineCommand[] = [];
        const props = baseProps({ focusedPaneIndex: 0, onCommand: (c) => commands.push(c) });
        const { stdin } = render(<RunBoard {...props} />);
        await flush();
        await press(stdin, key);
        expect(commands).toEqual([]);
      });
    }

    it('emits nothing at all when no lane is selected', async () => {
      const commands: EngineCommand[] = [];
      const props = baseProps({
        lanes: [],
        laneDetails: new Map(),
        focusedPaneIndex: 1,
        onCommand: (c) => commands.push(c),
      });
      const { stdin } = render(<RunBoard {...props} />);
      await flush();
      for (const key of ['f', 's', 'R', 'm', 'o']) {
        await press(stdin, key);
      }
      expect(commands).toEqual([]);
    });
  });

  describe('a stale selectedLaneId is never trusted -- re-derived every render against the current lanes prop', () => {
    it('a live prop update that prunes the selected lane falls back to the first remaining lane, and no command ever targets the pruned id', async () => {
      const commands: EngineCommand[] = [];
      const props = baseProps({ focusedPaneIndex: 1, onCommand: (c) => commands.push(c) });
      const { lastFrame, rerender, stdin } = render(<RunBoard {...props} />);
      await flush();
      expect(stripAnsi(lastFrame() ?? '')).toContain('Step 3/6 implement'); // story-014, the default

      const prunedLanes = [
        lane({ id: 'story-016', label: 'story-016 frontend', status: 'waiting' }),
      ];
      const prunedDetails = new Map<string, LaneDetail>([
        ['story-016', detail({ id: 'story-016', headline: 'Step 1/4 plan' })],
      ]);
      rerender(<RunBoard {...props} lanes={prunedLanes} laneDetails={prunedDetails} />);
      await flush();
      expect(stripAnsi(lastFrame() ?? '')).toContain('Step 1/4 plan');

      await press(stdin, 's');
      expect(commands).toEqual([{ type: 'lane.stop', laneId: 'story-016' }]);
    });

    it('a screen first rendered with zero lanes correctly auto-selects the first lane once one appears, without requiring Enter', async () => {
      const commands: EngineCommand[] = [];
      const props = baseProps({
        lanes: [],
        laneDetails: new Map(),
        focusedPaneIndex: 1,
        onCommand: (c) => commands.push(c),
      });
      const { lastFrame, rerender, stdin } = render(<RunBoard {...props} />);
      await flush();
      expect(stripAnsi(lastFrame() ?? '')).toContain('No lane selected.');

      const populated = baseProps({ focusedPaneIndex: 1 });
      rerender(<RunBoard {...props} lanes={populated.lanes} laneDetails={populated.laneDetails} />);
      await flush();
      expect(stripAnsi(lastFrame() ?? '')).toContain('Step 3/6 implement');

      await press(stdin, 's');
      expect(commands).toEqual([{ type: 'lane.stop', laneId: 'story-014' }]);
    });
  });

  it('Enter and d never emit a command -- both are pure, local view concerns', async () => {
    const commands: EngineCommand[] = [];
    const props = baseProps({ focusedPaneIndex: 1, onCommand: (c) => commands.push(c) });
    const { stdin } = render(<RunBoard {...props} />);
    await flush();
    await press(stdin, '\r');
    await press(stdin, 'd');
    expect(commands).toEqual([]);
  });

  describe('interject flow', () => {
    it('"i" opens a modal; submitting text emits exactly one lane.interject command and closes it', async () => {
      const commands: EngineCommand[] = [];
      const props = baseProps({ focusedPaneIndex: 1, onCommand: (c) => commands.push(c) });
      const { lastFrame, stdin } = render(<RunBoard {...props} />);
      await flush();
      await press(stdin, 'i');
      expect(stripAnsi(lastFrame() ?? '')).toContain('Message to send into this lane');

      await press(stdin, 'quick fix');
      await press(stdin, '\r');
      expect(commands).toEqual([
        { type: 'lane.interject', laneId: 'story-014', message: 'quick fix' },
      ]);
      expect(stripAnsi(lastFrame() ?? '')).not.toContain('Message to send into this lane');
    });

    it('while open, typing "f"/"j"/"k" into the interject field never leaks into <StreamView>\'s own scroll/follow state on the Transcript tab behind it', async () => {
      const transcript = Array.from({ length: 15 }, (_, i) => `line${String(i + 1)}`);
      const laneDetails = new Map<string, LaneDetail>([
        ['story-014', detail({ id: 'story-014', transcript })],
      ]);
      const props = baseProps({
        lanes: [lane({ id: 'story-014' })],
        laneDetails,
        focusedPaneIndex: 1,
      });
      const { lastFrame, stdin } = render(<RunBoard {...props} />);
      await flush();
      // Following defaults to true: the last LIST_HEIGHT (8) lines are shown, line8..line15.
      const initialFrame = stripAnsi(lastFrame() ?? '');
      expect(initialFrame).toContain('line15');
      expect(initialFrame).not.toContain('line7');

      await press(stdin, 'i');
      // If this leaked into <StreamView>'s own "k" binding, it would flip `following` off and scroll
      // the window up by one line each time -- these letters would visibly change which lines show.
      await press(stdin, 'follow jk look');
      const whileOpenFrame = stripAnsi(lastFrame() ?? '');
      expect(whileOpenFrame).toContain('follow jk look');
      expect(whileOpenFrame).toContain('line15');
      expect(whileOpenFrame).not.toContain('line7');

      await press(stdin, '\x1B'); // Esc -- close without submitting
      const afterCloseFrame = stripAnsi(lastFrame() ?? '');
      expect(afterCloseFrame).toContain('line15');
      expect(afterCloseFrame).not.toContain('line7');
    });

    it('the message goes to the lane the modal was opened for, even if the live selection moves on to a different lane while it is still open', async () => {
      const commands: EngineCommand[] = [];
      const props = baseProps({ focusedPaneIndex: 1, onCommand: (c) => commands.push(c) });
      const { rerender, stdin } = render(<RunBoard {...props} />);
      await flush();
      await press(stdin, 'i'); // opens for story-014, the default selection
      await press(stdin, 'urgent fix');

      // A live prop update prunes story-014 while the modal is still open -- an ordinary "the lane
      // finished and was pruned" read-model transition, just arriving mid-interject this time.
      const prunedLanes = [
        lane({ id: 'story-016', label: 'story-016 frontend', status: 'waiting' }),
      ];
      const prunedDetails = new Map<string, LaneDetail>([
        ['story-016', detail({ id: 'story-016', headline: 'Step 1/4 plan' })],
      ]);
      rerender(<RunBoard {...props} lanes={prunedLanes} laneDetails={prunedDetails} />);
      await flush();

      await press(stdin, '\r'); // submit
      // Never silently retargeted at story-016 (the new live selection) -- and never delivered to
      // story-014 either, since that lane no longer exists by submit time.
      expect(commands).toEqual([]);
    });

    it('Esc closes the interject modal without emitting anything', async () => {
      const commands: EngineCommand[] = [];
      const props = baseProps({ focusedPaneIndex: 1, onCommand: (c) => commands.push(c) });
      const { lastFrame, stdin } = render(<RunBoard {...props} />);
      await flush();
      await press(stdin, 'i');
      await press(stdin, '\x1B');
      expect(commands).toEqual([]);
      expect(stripAnsi(lastFrame() ?? '')).not.toContain('Message to send into this lane');
    });

    it('renders the "queued as an addendum" caveat when interjectSupported is false', async () => {
      const props = baseProps({ focusedPaneIndex: 1, interjectSupported: false });
      const { lastFrame, stdin } = render(<RunBoard {...props} />);
      await flush();
      await press(stdin, 'i');
      expect(stripAnsi(lastFrame() ?? '')).toContain('queued as an addendum');
    });

    it('renders no such caveat when interjectSupported is true', async () => {
      const props = baseProps({ focusedPaneIndex: 1, interjectSupported: true });
      const { lastFrame, stdin } = render(<RunBoard {...props} />);
      await flush();
      await press(stdin, 'i');
      expect(stripAnsi(lastFrame() ?? '')).not.toContain('queued as an addendum');
    });

    it('typing "s"/"f"/"m" etc. into the open interject text field never also fires a lane command', async () => {
      const commands: EngineCommand[] = [];
      const props = baseProps({ focusedPaneIndex: 1, onCommand: (c) => commands.push(c) });
      const { lastFrame, stdin } = render(<RunBoard {...props} />);
      await flush();
      await press(stdin, 'i');
      await press(stdin, 'stop merge follow');
      expect(commands).toEqual([]);
      expect(stripAnsi(lastFrame() ?? '')).toContain('stop merge follow');
    });

    it('while the modal is open, Tab-driven focus changes (a real, out-of-file cause) never let list-pane keys reach the list -- j/k/"/" all become plain text in the open field, nothing double-fires', async () => {
      const commands: EngineCommand[] = [];
      const props = baseProps({ focusedPaneIndex: 1, onCommand: (c) => commands.push(c) });
      const { lastFrame, rerender, stdin } = render(<RunBoard {...props} />);
      await flush();
      await press(stdin, 'i');
      // Simulates a future `<AppShell>` moving focus back to the list pane via Tab while this
      // screen's own modal is still open -- this file has no control over that key itself, only over
      // what stays reachable once it happens.
      rerender(<RunBoard {...props} focusedPaneIndex={0} />);
      await flush();
      await press(stdin, 'jk/');
      expect(commands).toEqual([]);
      expect(stripAnsi(lastFrame() ?? '')).toContain('jk/');

      await press(stdin, '\x1B'); // Esc -- close the modal
      // Confirms `<ListPane>`'s own selection never silently moved either while it should have been
      // inert -- the detail pane still shows the lane selected before the modal opened (story-014),
      // never an arrow-key-moved one (story-016).
      rerender(<RunBoard {...props} focusedPaneIndex={1} />);
      expect(stripAnsi(lastFrame() ?? '')).toContain('Step 3/6 implement');
    });
  });

  it('Tab-driven focus changes which pane is highlighted (delegated via focusedPaneIndex)', () => {
    const { lastFrame: frame0 } = render(<RunBoard {...baseProps({ focusedPaneIndex: 0 })} />);
    const { lastFrame: frame1 } = render(<RunBoard {...baseProps({ focusedPaneIndex: 1 })} />);
    expect(stripAnsi(frame0() ?? '')).not.toBe(stripAnsi(frame1() ?? ''));
  });

  it(`focusedPaneIndex wraps modulo the real pane count (2), matching every other screen's convention`, () => {
    const { lastFrame: frameA } = render(<RunBoard {...baseProps({ focusedPaneIndex: 1 })} />);
    const { lastFrame: frameB } = render(<RunBoard {...baseProps({ focusedPaneIndex: 3 })} />);
    expect(stripAnsi(frameA() ?? '')).toBe(stripAnsi(frameB() ?? ''));
  });

  it('renders at three canonical terminal widths without throwing', () => {
    for (const columns of [60, 100, 160]) {
      const mode: RenderMode = { ...MODE, columns };
      expect(() => render(<RunBoard {...baseProps({ mode })} />)).not.toThrow();
    }
  });
});
