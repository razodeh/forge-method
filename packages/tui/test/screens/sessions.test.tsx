/**
 * `<SessionsScreen>` -- `04` §4.3 S6: the facilitated-discussion list + live-session transcript/
 * technique-step-indicator/input view.
 *
 * See `list-pane.test.tsx`'s own header comment for why every test that presses a key awaits `flush()`
 * once right after `render()`, before the first `stdin.write()`.
 *
 * @see specs/04 §4.3 S6
 * @see PLAN-M9.md P12
 */
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';

import type { RenderMode } from '../../src/env.ts';
import {
  SessionsScreen,
  type SessionsScreenProps,
  type SessionSummary,
} from '../../src/screens/sessions.tsx';
import type { EngineCommand } from '../../src/state/engine-command.ts';
import { INITIAL_RUN_READ_MODEL } from '../../src/state/run-read-model.ts';

const DOWN = '\x1B[B';

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

function liveSession(overrides: Partial<SessionSummary> & { id: string }): SessionSummary {
  return {
    title: 'Brainstorm',
    topic: 'Reduce time-to-first-invoice',
    transcript: [
      { speaker: 'pm', text: 'What if we removed the setup wizard entirely for trials?' },
      { speaker: 'you', text: "we can't; compliance needs explicit tax config", isYou: true },
    ],
    progress: { technique: 'SCAMPER', step: 3, total: 7 },
    ...overrides,
  };
}

function pastSession(overrides: Partial<SessionSummary> & { id: string }): SessionSummary {
  return {
    title: 'Retro',
    topic: 'Sprint 12 retro',
    transcript: [{ speaker: 'pm', text: 'Ship velocity dropped -- why?' }],
    ...overrides,
  };
}

function baseProps(overrides: Partial<SessionsScreenProps> = {}): SessionsScreenProps {
  return {
    mode: MODE,
    readModel: INITIAL_RUN_READ_MODEL,
    focusedPaneIndex: 1,
    sessions: [liveSession({ id: 'SESSION-1' }), pastSession({ id: 'SESSION-2' })],
    onCommand: () => undefined,
    ...overrides,
  };
}

describe('<SessionsScreen>', () => {
  it('renders the session list (including the synthetic "start new" row) and the default-selected session\'s own transcript', () => {
    const { lastFrame } = render(<SessionsScreen {...baseProps()} />);
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('start new session');
    expect(frame).toContain('Brainstorm');
    expect(frame).toContain('Retro');
    expect(frame).toContain('pm         What if we removed the setup wizard entirely for trials?');
    expect(frame).toContain("you        > we can't; compliance needs explicit tax config");
  });

  it('renders the technique/step indicator verbatim for a live session, independent of any real @forge/sessions value', () => {
    const { lastFrame } = render(<SessionsScreen {...baseProps()} />);
    expect(stripAnsi(lastFrame() ?? '')).toContain('technique: SCAMPER (3/7)');
  });

  it('a past (ended) session shows no technique indicator and an explicit "ended" notice', async () => {
    const { lastFrame, stdin } = render(<SessionsScreen {...baseProps({ focusedPaneIndex: 0 })} />);
    await flush();
    await press(stdin, DOWN); // "start new" -> SESSION-1
    await press(stdin, DOWN); // SESSION-1 -> SESSION-2 (past)
    await press(stdin, '\r'); // select SESSION-2
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).not.toContain('technique:');
    expect(frame).toContain('This session has ended.');
  });

  it('renders "No session selected." when there are no sessions at all', () => {
    const { lastFrame } = render(<SessionsScreen {...baseProps({ sessions: [] })} />);
    expect(stripAnsi(lastFrame() ?? '')).toContain('No session selected.');
  });

  describe('"start new" row', () => {
    it('emits exactly one session.start, never navigates into it as a live session', async () => {
      const commands: EngineCommand[] = [];
      const { lastFrame, stdin } = render(
        <SessionsScreen
          {...baseProps({ focusedPaneIndex: 0, onCommand: (c) => commands.push(c) })}
        />,
      );
      await flush();
      await press(stdin, '\r'); // "start new" is the first row
      expect(commands).toEqual([{ type: 'session.start' }]);
      // The detail pane still shows the real, previously-default-selected session, not a blank "new" one.
      expect(stripAnsi(lastFrame() ?? '')).toContain('Brainstorm');
    });
  });

  describe('[space] (advance step)', () => {
    it('emits exactly one session.advanceStep for the live session', async () => {
      const commands: EngineCommand[] = [];
      const { stdin } = render(
        <SessionsScreen {...baseProps({ onCommand: (c) => commands.push(c) })} />,
      );
      await flush();
      await press(stdin, ' ');
      expect(commands).toEqual([{ type: 'session.advanceStep', sessionId: 'SESSION-1' }]);
    });

    it('emits nothing for a past (non-live) session', async () => {
      const commands: EngineCommand[] = [];
      const props = baseProps({
        sessions: [pastSession({ id: 'SESSION-2' })],
        onCommand: (c) => commands.push(c),
      });
      const { stdin } = render(<SessionsScreen {...props} />);
      await flush();
      await press(stdin, ' ');
      expect(commands).toEqual([]);
    });

    it('emits nothing while the list pane (not the detail pane) is focused', async () => {
      const commands: EngineCommand[] = [];
      const props = baseProps({ focusedPaneIndex: 0, onCommand: (c) => commands.push(c) });
      const { stdin } = render(<SessionsScreen {...props} />);
      await flush();
      await press(stdin, ' ');
      expect(commands).toEqual([]);
    });
  });

  describe('c (converge)', () => {
    it('emits exactly one session.converge for the live session', async () => {
      const commands: EngineCommand[] = [];
      const { stdin } = render(
        <SessionsScreen {...baseProps({ onCommand: (c) => commands.push(c) })} />,
      );
      await flush();
      await press(stdin, 'c');
      expect(commands).toEqual([{ type: 'session.converge', sessionId: 'SESSION-1' }]);
    });
  });

  describe('s (save to KB)', () => {
    it('emits exactly one session.saveToKb for the live session', async () => {
      const commands: EngineCommand[] = [];
      const { stdin } = render(
        <SessionsScreen {...baseProps({ onCommand: (c) => commands.push(c) })} />,
      );
      await flush();
      await press(stdin, 's');
      expect(commands).toEqual([{ type: 'session.saveToKb', sessionId: 'SESSION-1' }]);
    });
  });

  describe('Esc (end)', () => {
    it('emits exactly one session.end for the live session', async () => {
      const commands: EngineCommand[] = [];
      const { stdin } = render(
        <SessionsScreen {...baseProps({ onCommand: (c) => commands.push(c) })} />,
      );
      await flush();
      await press(stdin, '\x1B');
      expect(commands).toEqual([{ type: 'session.end', sessionId: 'SESSION-1' }]);
    });
  });

  describe('Enter (contribute)', () => {
    it('opens a modal; submitting text emits exactly one session.contribute carrying it verbatim', async () => {
      const commands: EngineCommand[] = [];
      const { lastFrame, stdin } = render(
        <SessionsScreen {...baseProps({ onCommand: (c) => commands.push(c) })} />,
      );
      await flush();
      await press(stdin, '\r');
      expect(stripAnsi(lastFrame() ?? '')).toContain('Your contribution');

      await press(stdin, 'schema-per-tenant, always');
      await press(stdin, '\r');
      expect(commands).toEqual([
        {
          type: 'session.contribute',
          sessionId: 'SESSION-1',
          message: 'schema-per-tenant, always',
        },
      ]);
    });

    it('typing " "/"c"/"s" into the open contribution field never also triggers advance/converge/save', async () => {
      const commands: EngineCommand[] = [];
      const { lastFrame, stdin } = render(
        <SessionsScreen {...baseProps({ onCommand: (c) => commands.push(c) })} />,
      );
      await flush();
      await press(stdin, '\r');
      await press(stdin, 'cs cause');
      expect(commands).toEqual([]);
      expect(stripAnsi(lastFrame() ?? '')).toContain('cs cause');
    });

    it('typing "j"/"k"/"f" into the open contribution field never leaks into the transcript\'s own scroll/follow state', async () => {
      const longTranscript = Array.from({ length: 12 }, (_, i) => ({
        speaker: 'pm',
        text: `turn ${String(i + 1)}`,
      }));
      const props = baseProps({
        sessions: [liveSession({ id: 'SESSION-1', transcript: longTranscript })],
      });
      const { lastFrame, stdin } = render(<SessionsScreen {...props} />);
      await flush();
      const beforeFrame = stripAnsi(lastFrame() ?? '');
      expect(beforeFrame).toContain('turn 12');

      await press(stdin, '\r'); // open the contribution modal
      await press(stdin, 'jkf typed as text');
      const duringFrame = stripAnsi(lastFrame() ?? '');
      expect(duringFrame).toContain('jkf typed as text');

      await press(stdin, '\x1B'); // close without submitting
      const afterFrame = stripAnsi(lastFrame() ?? '');
      expect(afterFrame).toContain('turn 12'); // the window never moved
    });

    it('Esc closes the contribution modal without emitting anything -- never ends the session either', async () => {
      const commands: EngineCommand[] = [];
      const { stdin } = render(
        <SessionsScreen {...baseProps({ onCommand: (c) => commands.push(c) })} />,
      );
      await flush();
      await press(stdin, '\r');
      await press(stdin, '\x1B');
      expect(commands).toEqual([]);
    });

    it('submitting an empty contribution emits nothing', async () => {
      const commands: EngineCommand[] = [];
      const { stdin } = render(
        <SessionsScreen {...baseProps({ onCommand: (c) => commands.push(c) })} />,
      );
      await flush();
      await press(stdin, '\r');
      await press(stdin, '\r');
      expect(commands).toEqual([]);
    });

    it('a live prop update ending the session while the modal is still open blocks the submit', async () => {
      const commands: EngineCommand[] = [];
      const props = baseProps({ onCommand: (c) => commands.push(c) });
      const { rerender, stdin } = render(<SessionsScreen {...props} />);
      await flush();
      await press(stdin, '\r'); // opens for SESSION-1, live
      await press(stdin, 'in progress reason');

      rerender(<SessionsScreen {...props} sessions={[pastSession({ id: 'SESSION-1' })]} />);
      await flush();

      await press(stdin, '\r');
      expect(commands).toEqual([]);
    });

    it('does not open at all for a past (non-live) session', async () => {
      const commands: EngineCommand[] = [];
      const props = baseProps({
        sessions: [pastSession({ id: 'SESSION-2' })],
        onCommand: (c) => commands.push(c),
      });
      const { lastFrame, stdin } = render(<SessionsScreen {...props} />);
      await flush();
      await press(stdin, '\r');
      expect(stripAnsi(lastFrame() ?? '')).not.toContain('Your contribution');
      expect(commands).toEqual([]);
    });
  });

  describe('transcript scrolling', () => {
    it('a real, longer-than-the-window transcript can be scrolled up with k, reaching earlier turns', async () => {
      const longTranscript = Array.from({ length: 12 }, (_, i) => ({
        speaker: 'pm',
        text: `turn ${String(i + 1)}`,
      }));
      const props = baseProps({
        sessions: [liveSession({ id: 'SESSION-1', transcript: longTranscript })],
      });
      const { lastFrame, stdin } = render(<SessionsScreen {...props} />);
      await flush();
      // Following defaults to true: the window shows only the last 10 turns (turn 3..turn 12).
      const initialFrame = stripAnsi(lastFrame() ?? '');
      expect(initialFrame).toContain('turn 12');
      expect(initialFrame).not.toMatch(/turn 1\D/u); // "turn 1" itself, not "turn 10/11/12"

      await press(stdin, 'k'); // scroll up one line
      const scrolledFrame = stripAnsi(lastFrame() ?? '');
      expect(scrolledFrame).toContain('turn 2');
      expect(scrolledFrame).not.toContain('turn 12');
    });

    it("scrolling never also triggers a session command -- k/j/f/arrows are StreamView's own, not this screen's", async () => {
      const commands: EngineCommand[] = [];
      const longTranscript = Array.from({ length: 12 }, (_, i) => ({
        speaker: 'pm',
        text: `turn ${String(i + 1)}`,
      }));
      const props = baseProps({
        sessions: [liveSession({ id: 'SESSION-1', transcript: longTranscript })],
        onCommand: (c) => commands.push(c),
      });
      const { stdin } = render(<SessionsScreen {...props} />);
      await flush();
      await press(stdin, 'k');
      await press(stdin, 'j');
      await press(stdin, 'f');
      expect(commands).toEqual([]);
    });
  });

  it('a stale selectedSessionId (from a live prop update removing the selected session) falls back to the first remaining session', async () => {
    const commands: EngineCommand[] = [];
    const props = baseProps({ onCommand: (c) => commands.push(c) });
    const { lastFrame, rerender, stdin } = render(<SessionsScreen {...props} />);
    await flush();
    expect(stripAnsi(lastFrame() ?? '')).toContain('Brainstorm');

    rerender(<SessionsScreen {...props} sessions={[pastSession({ id: 'SESSION-2' })]} />);
    await flush();
    expect(stripAnsi(lastFrame() ?? '')).toContain('Retro');

    await press(stdin, 'c');
    expect(commands).toEqual([]); // SESSION-2 is not live -- correctly no-ops, not a stale-id crash
  });

  it('renders at three canonical terminal widths without throwing', () => {
    for (const columns of [60, 100, 160]) {
      const mode: RenderMode = { ...MODE, columns };
      expect(() => render(<SessionsScreen {...baseProps({ mode })} />)).not.toThrow();
    }
  });
});
