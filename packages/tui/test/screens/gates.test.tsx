/**
 * `<GatesScreen>` -- `04` §4.3 S5: gate status/checks/evidence/open-questions, and the approve/reject/
 * waive/re-run-checks flow.
 *
 * See `list-pane.test.tsx`'s own header comment for why every test that presses a key awaits `flush()`
 * once right after `render()`, before the first `stdin.write()`.
 *
 * @see specs/04 §4.3 S5
 * @see PLAN-M9.md P11
 */
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';

import type { RenderMode } from '../../src/env.ts';
import { type GateInfo, GatesScreen, type GatesScreenProps } from '../../src/screens/gates.tsx';
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

function gate(overrides: Partial<GateInfo> & { id: string }): GateInfo {
  return {
    label: `Gate ${overrides.id}`,
    status: 'waiting',
    deterministicChecks: [{ id: 'spec:validate', status: 'pass', detail: '0 errors' }],
    advisoryChecks: [],
    openQuestions: [],
    alwaysHuman: false,
    ...overrides,
  };
}

function baseProps(overrides: Partial<GatesScreenProps> = {}): GatesScreenProps {
  return {
    mode: MODE,
    readModel: INITIAL_RUN_READ_MODEL,
    focusedPaneIndex: 1,
    gates: [gate({ id: 'G-Design' }), gate({ id: 'G-Ready' })],
    onCommand: () => undefined,
    ...overrides,
  };
}

describe('<GatesScreen>', () => {
  it("renders both panes, the gate list, and the default-selected gate's own checks", () => {
    const { lastFrame } = render(<GatesScreen {...baseProps()} />);
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('Gates');
    expect(frame).toContain('Gate G-Design');
    expect(frame).toContain('Gate G-Ready');
    expect(frame).toContain('spec:validate');
  });

  it('renders "No gate selected." when there are no gates at all', () => {
    const { lastFrame } = render(<GatesScreen {...baseProps({ gates: [] })} />);
    expect(stripAnsi(lastFrame() ?? '')).toContain('No gate selected.');
  });

  describe('a (approve)', () => {
    it('emits exactly one gate.approve when every deterministic check passes', async () => {
      const commands: EngineCommand[] = [];
      const props = baseProps({ onCommand: (c) => commands.push(c) });
      const { stdin } = render(<GatesScreen {...props} />);
      await flush();
      await press(stdin, 'a');
      expect(commands).toEqual([{ type: 'gate.approve', gateId: 'G-Design' }]);
    });

    it('structurally emits nothing at all when any deterministic check is failing, and renders the refusal reason', async () => {
      const commands: EngineCommand[] = [];
      const gates = [
        gate({
          id: 'G-Design',
          deterministicChecks: [
            { id: 'spec:validate', status: 'pass', detail: '0 errors' },
            {
              id: 'interfaces:frozen',
              status: 'fail',
              detail: '3 interfaces referenced but not defined',
            },
          ],
        }),
      ];
      const { lastFrame, stdin } = render(
        <GatesScreen {...baseProps({ gates, onCommand: (c) => commands.push(c) })} />,
      );
      await flush();
      const frame = stripAnsi(lastFrame() ?? '');
      expect(frame).toContain('Blocked: interfaces:frozen is still failing.');

      await press(stdin, 'a');
      expect(commands).toEqual([]);
    });

    it('a "warn" (not "fail") deterministic check also blocks approval -- only "pass" is a real pass', async () => {
      const commands: EngineCommand[] = [];
      const gates = [
        gate({
          id: 'G-Design',
          deterministicChecks: [{ id: 'lint', status: 'warn', detail: 'unresolved TODO' }],
        }),
      ];
      const { stdin } = render(
        <GatesScreen {...baseProps({ gates, onCommand: (c) => commands.push(c) })} />,
      );
      await flush();
      await press(stdin, 'a');
      expect(commands).toEqual([]);
    });

    it('emits nothing while the list pane (not the detail pane) is focused', async () => {
      const commands: EngineCommand[] = [];
      const props = baseProps({ focusedPaneIndex: 0, onCommand: (c) => commands.push(c) });
      const { stdin } = render(<GatesScreen {...props} />);
      await flush();
      await press(stdin, 'a');
      expect(commands).toEqual([]);
    });
  });

  describe('x (reject)', () => {
    it('emits exactly one gate.reject for the focused gate', async () => {
      const commands: EngineCommand[] = [];
      const props = baseProps({ onCommand: (c) => commands.push(c) });
      const { stdin } = render(<GatesScreen {...props} />);
      await flush();
      await press(stdin, 'x');
      expect(commands).toEqual([{ type: 'gate.reject', gateId: 'G-Design' }]);
    });
  });

  describe('c (re-run checks)', () => {
    it('emits exactly one gate.rerunChecks for the focused gate', async () => {
      const commands: EngineCommand[] = [];
      const props = baseProps({ onCommand: (c) => commands.push(c) });
      const { stdin } = render(<GatesScreen {...props} />);
      await flush();
      await press(stdin, 'c');
      expect(commands).toEqual([{ type: 'gate.rerunChecks', gateId: 'G-Design' }]);
    });
  });

  describe('w (waive)', () => {
    it('opens a modal; submitting a typed reason emits exactly one gate.waive carrying it verbatim', async () => {
      const commands: EngineCommand[] = [];
      const props = baseProps({ onCommand: (c) => commands.push(c) });
      const { lastFrame, stdin } = render(<GatesScreen {...props} />);
      await flush();
      await press(stdin, 'w');
      expect(stripAnsi(lastFrame() ?? '')).toContain('Reason for waiving this gate');

      await press(stdin, 'known risk, accepted by PM');
      await press(stdin, '\r');
      expect(commands).toEqual([
        { type: 'gate.waive', gateId: 'G-Design', reason: 'known risk, accepted by PM' },
      ]);
    });

    it('against an alwaysHuman gate, emits zero commands regardless of any typed reason -- the modal never even opens', async () => {
      const commands: EngineCommand[] = [];
      const gates = [gate({ id: 'G-Design', alwaysHuman: true })];
      const { lastFrame, stdin } = render(
        <GatesScreen {...baseProps({ gates, onCommand: (c) => commands.push(c) })} />,
      );
      await flush();
      await press(stdin, 'w');
      expect(stripAnsi(lastFrame() ?? '')).not.toContain('Reason for waiving this gate');

      await press(stdin, 'trying anyway');
      await press(stdin, '\r');
      expect(commands).toEqual([]);
    });

    it('a live prop update flipping alwaysHuman to true while the modal is still open blocks the submit, even with a typed reason already entered', async () => {
      const commands: EngineCommand[] = [];
      const props = baseProps({ onCommand: (c) => commands.push(c) });
      const { rerender, stdin } = render(<GatesScreen {...props} />);
      await flush();
      await press(stdin, 'w'); // opens for G-Design, alwaysHuman: false at this moment
      await press(stdin, 'known risk');

      // The gate itself still exists -- only its own alwaysHuman flag changed underneath the still-open
      // modal, an ordinary "the engine now requires mandatory human sign-off" live update.
      rerender(
        <GatesScreen
          {...props}
          gates={[gate({ id: 'G-Design', alwaysHuman: true }), gate({ id: 'G-Ready' })]}
        />,
      );
      await flush();

      await press(stdin, '\r');
      expect(commands).toEqual([]);
    });

    it('renders the "cannot be waived" notice for an alwaysHuman gate', () => {
      const gates = [gate({ id: 'G-Design', alwaysHuman: true })];
      const { lastFrame } = render(<GatesScreen {...baseProps({ gates })} />);
      expect(stripAnsi(lastFrame() ?? '')).toContain('cannot be waived at any autonomy level');
    });

    it('Esc closes the waive modal without emitting anything', async () => {
      const commands: EngineCommand[] = [];
      const props = baseProps({ onCommand: (c) => commands.push(c) });
      const { stdin } = render(<GatesScreen {...props} />);
      await flush();
      await press(stdin, 'w');
      await press(stdin, '\x1B');
      expect(commands).toEqual([]);
    });

    it('submitting an empty reason emits nothing', async () => {
      const commands: EngineCommand[] = [];
      const props = baseProps({ onCommand: (c) => commands.push(c) });
      const { stdin } = render(<GatesScreen {...props} />);
      await flush();
      await press(stdin, 'w');
      await press(stdin, '\r');
      expect(commands).toEqual([]);
    });

    it('typing "a"/"x"/"c" into the open waive field never also triggers an approve/reject/re-run', async () => {
      const commands: EngineCommand[] = [];
      const props = baseProps({ onCommand: (c) => commands.push(c) });
      const { lastFrame, stdin } = render(<GatesScreen {...props} />);
      await flush();
      await press(stdin, 'w');
      await press(stdin, 'axc reason');
      expect(commands).toEqual([]);
      expect(stripAnsi(lastFrame() ?? '')).toContain('axc reason');
    });
  });

  describe('Enter (open question)', () => {
    it("cycles through the focused gate's own open questions", async () => {
      const gates = [
        gate({
          id: 'G-Design',
          openQuestions: [
            { id: 'Q1', text: 'Multi-tenant isolation: schema-per-tenant vs row-level?' },
            { id: 'Q2', text: 'Are invoice PDFs generated sync or async?' },
          ],
        }),
      ];
      const { lastFrame, stdin } = render(<GatesScreen {...baseProps({ gates })} />);
      await flush();
      await press(stdin, '\r');
      expect(stripAnsi(lastFrame() ?? '')).toContain('Q1: Multi-tenant isolation');

      await press(stdin, '\r');
      expect(stripAnsi(lastFrame() ?? '')).toContain(
        'Q2: Are invoice PDFs generated sync or async?',
      );
    });

    it('never emits a command -- a pure local view concern', async () => {
      const commands: EngineCommand[] = [];
      const gates = [gate({ id: 'G-Design', openQuestions: [{ id: 'Q1', text: 'x?' }] })];
      const { stdin } = render(
        <GatesScreen {...baseProps({ gates, onCommand: (c) => commands.push(c) })} />,
      );
      await flush();
      await press(stdin, '\r');
      expect(commands).toEqual([]);
    });
  });

  it('a stale selectedGateId (from a live prop update removing the selected gate) falls back to the first remaining gate', async () => {
    const commands: EngineCommand[] = [];
    const props = baseProps({ onCommand: (c) => commands.push(c) });
    const { lastFrame, rerender, stdin } = render(<GatesScreen {...props} />);
    await flush();
    expect(stripAnsi(lastFrame() ?? '')).toContain('Gate G-Design');

    rerender(<GatesScreen {...props} gates={[gate({ id: 'G-Ready' })]} />);
    await flush();
    expect(stripAnsi(lastFrame() ?? '')).toContain('Gate G-Ready');

    await press(stdin, 'x');
    expect(commands).toEqual([{ type: 'gate.reject', gateId: 'G-Ready' }]);
  });

  it('an open question never leaks across a stale-selection fallback onto a different gate that happens to reuse the same question id', async () => {
    const gates = [
      gate({ id: 'G-Design', openQuestions: [{ id: 'Q1', text: "Design's own real question" }] }),
      gate({
        id: 'G-Ready',
        openQuestions: [{ id: 'Q1', text: "Ready's own unrelated question" }],
      }),
    ];
    const props = baseProps({ gates });
    const { lastFrame, rerender, stdin } = render(<GatesScreen {...props} />);
    await flush();
    await press(stdin, '\r'); // opens G-Design's own Q1
    expect(stripAnsi(lastFrame() ?? '')).toContain("Design's own real question");

    // G-Design is removed by a live prop update; the automatic fallback selects G-Ready, which
    // happens to reuse the same "Q1" id for a completely different question.
    rerender(<GatesScreen {...props} gates={[gates[1]!]} />);
    const frame = stripAnsi(lastFrame() ?? '');
    // The full open-questions list always renders every question's own text regardless of selection --
    // what must NOT happen is the "▸ selected question" line auto-showing G-Ready's Q1 as if the user
    // had picked it, just because G-Design's own stale "Q1" selection happened to share that id.
    expect(frame).not.toContain('▸ Q1');
  });

  it('renders at three canonical terminal widths without throwing', () => {
    for (const columns of [60, 100, 160]) {
      const mode: RenderMode = { ...MODE, columns };
      expect(() => render(<GatesScreen {...baseProps({ mode })} />)).not.toThrow();
    }
  });
});
