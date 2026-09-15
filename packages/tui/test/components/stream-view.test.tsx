/**
 * `<StreamView>` -- `04` §4.1's own bounded ring-buffer log/transcript view with follow-mode.
 *
 * See `list-pane.test.tsx`'s own header comment for why every test that presses a key awaits `flush()`
 * once right after `render()`, before the first `stdin.write()`: `useInput`'s own effect (which wires
 * the fake stdin's keypress listener) runs asynchronously after the initial commit, so a write issued
 * immediately after `render()` with no tick in between is silently dropped.
 *
 * @see specs/04 §4.1, §4.2, §4.5
 * @see PLAN-M9.md P4
 */
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

import { StreamView, type StreamViewProps } from '../../src/components/stream-view.tsx';

const UP = '\x1B[A';
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

async function renderStream(props: StreamViewProps) {
  const result = render(<StreamView {...props} />);
  await flush();
  return result;
}

function lines(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `line-${String(index)}`);
}

async function* asyncLines(values: readonly string[]): AsyncGenerator<string> {
  for (const value of values) {
    await Promise.resolve();
    yield value;
  }
}

describe('StreamView', () => {
  it('a static source of 3000 lines retains exactly the most recent 2000, never all 3000', async () => {
    const { lastFrame } = await renderStream({ source: lines(3000), height: 10, focused: false });
    const frame = lastFrame() ?? '';
    // Following defaults on, so the visible window shows the tail -- the last 10 of the retained 2000.
    expect(frame).toContain('line-2999');
    expect(frame).not.toContain('line-999');
  });

  it('strips control characters (a crafted ESC/CSI sequence) from a line before it reaches the render tree -- a fresh adversarial review found untrusted transcript/lane-output content reached Ink completely unsanitized, the same bug class bin.ts fixes for CLI output', async () => {
    const { lastFrame } = await renderStream({
      source: ['before\x1b[2Kafter'],
      height: 5,
      focused: false,
    });
    const frame = lastFrame() ?? '';
    // The ESC byte itself is stripped; the printable text that followed it (harmless once the
    // control byte introducing the escape sequence is gone) is left exactly as it was.
    expect(frame).toContain('before[2Kafter');
    expect(frame.includes('\x1b')).toBe(false);
  });

  it('a custom maxLines bound is honoured', async () => {
    const { lastFrame } = await renderStream({
      source: lines(100),
      maxLines: 50,
      height: 5,
      focused: false,
    });
    // Following defaults on -- tail of the last 50 retained (lines 50-99), so line-49 was dropped.
    const frame = lastFrame() ?? '';
    expect(frame).toContain('line-99');
    expect(frame).not.toContain('line-49\n');
  });

  it('an async source is consumed incrementally, appending each line as it arrives', async () => {
    const { lastFrame } = await renderStream({
      source: asyncLines(['a', 'b', 'c']),
      height: 5,
      focused: false,
    });
    expect(lastFrame()).toBe('a\nb\nc');
  });

  it('an async source is bounded to maxLines as lines keep arriving, dropping the oldest', async () => {
    const { lastFrame } = await renderStream({
      source: asyncLines(lines(10)),
      maxLines: 4,
      height: 4,
      focused: false,
    });
    expect(lastFrame()).toBe('line-6\nline-7\nline-8\nline-9');
  });

  it('following keeps the view scrolled to the bottom as new lines arrive', async () => {
    const { lastFrame } = await renderStream({
      source: asyncLines(lines(20)),
      height: 5,
      focused: true,
    });
    expect(lastFrame()).toBe('line-15\nline-16\nline-17\nline-18\nline-19');
  });

  it('scrolling up (↑/k) suspends follow, and further scrolling continues from where it left off', async () => {
    const { lastFrame, stdin } = await renderStream({
      source: lines(20),
      height: 5,
      focused: true,
    });
    expect(lastFrame()).toBe('line-15\nline-16\nline-17\nline-18\nline-19');
    await press(stdin, UP);
    expect(lastFrame()).toBe('line-14\nline-15\nline-16\nline-17\nline-18');
    await press(stdin, UP);
    expect(lastFrame()).toBe('line-13\nline-14\nline-15\nline-16\nline-17');
  });

  it('the vim-style "j"/"k" letter keys work identically to ↓/↑', async () => {
    const { lastFrame, stdin } = await renderStream({
      source: lines(20),
      height: 5,
      focused: true,
    });
    expect(lastFrame()).toBe('line-15\nline-16\nline-17\nline-18\nline-19');
    await press(stdin, 'k');
    expect(lastFrame()).toBe('line-14\nline-15\nline-16\nline-17\nline-18');
    await press(stdin, 'j');
    expect(lastFrame()).toBe('line-15\nline-16\nline-17\nline-18\nline-19');
  });

  it('unmounting while an async source is still being consumed cancels the read loop cleanly -- no crash, no further state updates after teardown', async () => {
    let resolveNext: (() => void) | undefined;
    async function* slowLines(): AsyncGenerator<string> {
      yield 'first';
      await new Promise<void>((resolve) => {
        resolveNext = resolve;
      });
      yield 'second';
    }
    const { lastFrame, unmount } = await renderStream({
      source: slowLines(),
      height: 5,
      focused: false,
    });
    expect(lastFrame()).toBe('first');
    unmount();
    resolveNext?.();
    await flush();
    // No throw, no unhandled rejection reached this point; the cleanup flag stopped the loop before
    // "second" ever reached a `setLines` call, so the last captured frame is still just "first".
    expect(lastFrame()).toBe('first');
  });

  it("a static source swap (e.g. switching to a different lane's transcript) replaces the buffer entirely, rather than keeping the previous source's content forever -- a fresh critic round reproduced the original design never resetting `lines` on a `source` change at all, since it was only ever seeded once by a `useState` lazy initializer", async () => {
    const { lastFrame, rerender } = await renderStream({
      source: ['lane-a-1', 'lane-a-2'],
      height: 5,
      focused: false,
    });
    expect(lastFrame()).toBe('lane-a-1\nlane-a-2');

    rerender(
      <StreamView source={['lane-b-1', 'lane-b-2', 'lane-b-3']} height={5} focused={false} />,
    );
    // The reset itself happens in an effect (it must, to distinguish "the very first mount" from "a
    // later source change" via a ref), which runs after commit -- a tick is needed before it's visible.
    await flush();
    expect(lastFrame()).toBe('lane-b-1\nlane-b-2\nlane-b-3');
    expect(lastFrame() ?? '').not.toContain('lane-a');
  });

  it("an async source swap restarts consumption fresh, rather than concatenating the new source's lines after the previous, now-stale ones", async () => {
    function laneLines(name: string): AsyncGenerator<string> {
      return asyncLines([`${name}-1`, `${name}-2`]);
    }
    const { lastFrame, rerender } = await renderStream({
      source: laneLines('laneA'),
      height: 10,
      focused: false,
    });
    await flush();
    expect(lastFrame()).toBe('laneA-1\nlaneA-2');

    rerender(<StreamView source={laneLines('laneB')} height={10} focused={false} />);
    await flush();
    expect(lastFrame()).toBe('laneB-1\nlaneB-2');
    expect(lastFrame() ?? '').not.toContain('laneA');
  });

  it("maxLines changing alone (the same source still live) never resets the buffer or restarts consumption -- a second critic round reproduced the first fix permanently losing every line an in-flight async source had already streamed, because an async generator's own iterator is itself, not restartable", async () => {
    const source = asyncLines(['a', 'b', 'c']);
    const { lastFrame, rerender } = await renderStream({
      source,
      height: 10,
      maxLines: 100,
      focused: false,
    });
    expect(lastFrame()).toBe('a\nb\nc');

    rerender(<StreamView source={source} height={10} maxLines={50} focused={false} />);
    await flush();
    // The already-streamed content survives a maxLines-only change; it is not wiped, and the
    // (already-exhausted) async iterable is never re-consumed from the top.
    expect(lastFrame()).toBe('a\nb\nc');
  });

  it('a shrinking maxLines re-trims an already-buffered source in place, with the same source reference, without needing a new line to arrive', async () => {
    const source = lines(10);
    const { lastFrame, rerender } = await renderStream({
      source,
      maxLines: 10,
      height: 10,
      focused: false,
    });
    expect(lastFrame()).toBe(
      'line-0\nline-1\nline-2\nline-3\nline-4\nline-5\nline-6\nline-7\nline-8\nline-9',
    );

    // Same `source` reference -- only `maxLines` shrinks. This isolates the dedicated trim-in-place
    // effect from the source-change reset path (which a fresh array reference would also exercise).
    rerender(<StreamView source={source} maxLines={3} height={10} focused={false} />);
    await flush();
    expect(lastFrame()).toBe('line-7\nline-8\nline-9');
  });

  it('"f" toggles follow-mode: pausing keeps the current viewport, resuming jumps back to the bottom', async () => {
    const { lastFrame, stdin } = await renderStream({
      source: lines(20),
      height: 5,
      focused: true,
    });
    await press(stdin, UP);
    await press(stdin, UP);
    const scrolledFrame = lastFrame();
    await press(stdin, 'f');
    // Toggling to follow (from suspended) jumps straight to the bottom.
    expect(lastFrame()).toBe('line-15\nline-16\nline-17\nline-18\nline-19');
    await press(stdin, 'f');
    // Toggling off again keeps the current (bottom) viewport rather than jumping anywhere new.
    expect(lastFrame()).toBe('line-15\nline-16\nline-17\nline-18\nline-19');
    expect(scrolledFrame).not.toBe(lastFrame());
  });

  it('scrolling back down (↓/j) all the way to the bottom resumes follow-mode automatically', async () => {
    const { lastFrame, stdin } = await renderStream({
      source: lines(7),
      height: 3,
      focused: true,
    });
    expect(lastFrame()).toBe('line-4\nline-5\nline-6');
    await press(stdin, UP);
    await press(stdin, UP);
    expect(lastFrame()).toBe('line-2\nline-3\nline-4');
    await press(stdin, DOWN);
    await press(stdin, DOWN);
    // Back at the bottom via manual scrolling -- follow resumed, confirmed indirectly: pressing "f"
    // now toggles it OFF (pausing at the current, already-bottom viewport) rather than jumping there.
    expect(lastFrame()).toBe('line-4\nline-5\nline-6');
    await press(stdin, 'f');
    expect(lastFrame()).toBe('line-4\nline-5\nline-6');
  });

  it('keys are ignored entirely when not focused', async () => {
    const { lastFrame, stdin } = await renderStream({
      source: lines(20),
      height: 5,
      focused: false,
    });
    await press(stdin, UP);
    expect(lastFrame()).toBe('line-15\nline-16\nline-17\nline-18\nline-19');
  });

  it('an empty source renders nothing and does not crash on navigation', async () => {
    const { lastFrame, stdin } = await renderStream({ source: [], height: 5, focused: true });
    expect(lastFrame()).toBe('');
    await press(stdin, UP);
    await press(stdin, 'f');
    expect(lastFrame()).toBe('');
  });
});
