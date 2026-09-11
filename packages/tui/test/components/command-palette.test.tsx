/**
 * `<CommandPalette>` -- `04` §4.2's own `:` prompt with fuzzy command matching.
 *
 * @see specs/04 §4.2, §4.5
 * @see PLAN-M9.md P5
 */
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { describe, expect, it, vi } from 'vitest';

import { type Command, CommandPalette } from '../../src/components/command-palette.tsx';

const ESC = '\x1B';
const DOWN = '\x1B[B';
const ENTER = '\r';
const BACKSPACE = '\x7F';

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

const COMMANDS: readonly Command[] = [
  { name: 'gate approve', description: 'Approve the focused gate' },
  { name: 'gate reject', description: 'Reject the focused gate' },
  { name: 'run pause', description: 'Pause the active run' },
  { name: 'run resume', description: 'Resume a paused run' },
];

async function renderPalette(props: {
  onSubmit?: (name: string) => void;
  onCancel?: () => void;
  open?: boolean;
}) {
  const result = render(
    <CommandPalette
      open={props.open ?? true}
      commands={COMMANDS}
      onSubmit={props.onSubmit ?? (() => undefined)}
      onCancel={props.onCancel ?? (() => undefined)}
      mode={{ ascii: false }}
    />,
  );
  await flush();
  return result;
}

describe('CommandPalette', () => {
  it('renders nothing when closed', async () => {
    const { lastFrame } = await renderPalette({ open: false });
    expect(lastFrame()).toBe('');
  });

  it('with no query typed, every command is listed', async () => {
    const { lastFrame } = await renderPalette({});
    const frame = stripAnsi(lastFrame() ?? '');
    for (const command of COMMANDS) {
      expect(frame).toContain(command.name);
    }
  });

  it('a fuzzy, non-prefix subsequence query narrows to the matching command', async () => {
    const { lastFrame, stdin } = await renderPalette({});
    await press(stdin, 'gt appr');
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('gate approve');
    expect(frame).not.toContain('gate reject');
    expect(frame).not.toContain('run pause');
  });

  it('Enter submits the currently highlighted matched command, not the raw typed query', async () => {
    const onSubmit = vi.fn();
    const { stdin } = await renderPalette({ onSubmit });
    await press(stdin, 'gt appr');
    await press(stdin, ENTER);
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('gate approve');
  });

  it('↓/↑ move the highlighted match among the currently narrowed results', async () => {
    const onSubmit = vi.fn();
    const { stdin } = await renderPalette({ onSubmit });
    await press(stdin, 'gate');
    await press(stdin, DOWN);
    await press(stdin, ENTER);
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('gate reject');
  });

  it('a tight, contiguous match ranks ahead of a scattered one covering the same query -- a fresh critic round reproduced the original single-forward-pass scoring ranking "run resume" ahead of "gate approve" for the query "ap", even though "ap" is a literal contiguous substring of "approve" and only a scattered subsequence of "resume"/"pause"', async () => {
    const onSubmit = vi.fn();
    const { stdin } = await renderPalette({ onSubmit });
    await press(stdin, 'ap');
    await press(stdin, ENTER);
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('gate approve');
  });

  it('the global minimum span wins even when a naive "forward-then-tighten-backward" two-pass approach would lock onto a worse, earlier-completing match -- a second critic round reproduced this exact counterexample against a two-pass revision of the fix above', async () => {
    const commands = [
      { name: 'axxxxxxxxxxbab', description: 'a genuinely tight match at the very end' },
      { name: 'acbb', description: 'only ever a scattered match' },
    ];
    const onSubmit = vi.fn();
    const { stdin } = render(
      <CommandPalette
        open
        commands={commands}
        onSubmit={onSubmit}
        onCancel={() => undefined}
        mode={{ ascii: false }}
      />,
    );
    await flush();
    await press(stdin, 'ab');
    await press(stdin, ENTER);
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('axxxxxxxxxxbab');
  });

  it('Esc cancels via onCancel, without submitting anything', async () => {
    const onCancel = vi.fn();
    const onSubmit = vi.fn();
    const { stdin } = await renderPalette({ onCancel, onSubmit });
    await press(stdin, 'gate');
    await press(stdin, ESC);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('backspace edits the query live, widening the match set again', async () => {
    const { lastFrame, stdin } = await renderPalette({});
    await press(stdin, 'gate reject');
    expect(stripAnsi(lastFrame() ?? '')).not.toContain('gate approve');
    for (const backspace of Array.from('reject', () => BACKSPACE)) {
      await press(stdin, backspace);
    }
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('gate approve');
    expect(frame).toContain('gate reject');
  });

  it('a query matching nothing renders an empty match list, without crashing', async () => {
    const { lastFrame, stdin } = await renderPalette({});
    await press(stdin, 'zzzzz');
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toBe(':zzzzz');
  });

  it('Enter with no matches is a safe no-op', async () => {
    const onSubmit = vi.fn();
    const { stdin } = await renderPalette({ onSubmit });
    await press(stdin, 'zzzzz');
    await press(stdin, ENTER);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
