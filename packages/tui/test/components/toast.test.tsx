/**
 * `<Toast>` -- `04` §4.5's own transient notifications, queued, max 3 visible at once.
 *
 * @see specs/04 §4.5
 * @see PLAN-M9.md P2
 */
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';

import { Toast, type ToastMessage } from '../../src/components/toast.tsx';

function message(id: string, text: string): ToastMessage {
  return { id, text, kind: 'info' };
}

describe('Toast', () => {
  it('renders every entry when there are 3 or fewer', () => {
    const queue = [message('1', 'first'), message('2', 'second')];
    const { lastFrame } = render(<Toast queue={queue} color={false} />);
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('first');
    expect(frame).toContain('second');
  });

  it('queued past 3 entries drops the oldest, never silently growing unbounded', () => {
    const queue = [
      message('1', 'oldest'),
      message('2', 'second'),
      message('3', 'third'),
      message('4', 'newest'),
    ];
    const { lastFrame } = render(<Toast queue={queue} color={false} />);
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).not.toContain('oldest');
    expect(frame).toContain('second');
    expect(frame).toContain('third');
    expect(frame).toContain('newest');
    expect(frame.split('\n')).toHaveLength(3);
  });

  it('an empty queue renders nothing', () => {
    const { lastFrame } = render(<Toast queue={[]} color={false} />);
    expect(lastFrame()).toBe('');
  });

  it('color: true colours each entry by kind, still containing the same text once stripped', () => {
    const queue = [
      { id: '1', text: 'a warning', kind: 'warn' as const },
      { id: '2', text: 'an error', kind: 'error' as const },
    ];
    const colored = render(<Toast queue={queue} color={true} />);
    const plain = render(<Toast queue={queue} color={false} />);
    expect(stripAnsi(colored.lastFrame() ?? '')).toBe(stripAnsi(plain.lastFrame() ?? ''));
  });

  it('two entries sharing identical text but a different kind remain textually distinguishable with color: false -- a fresh critic round reproduced this component rendering message.text alone, so an error toast was indistinguishable from an info toast under NO_COLOR', () => {
    const queue = [
      { id: '1', text: 'same text', kind: 'info' as const },
      { id: '2', text: 'same text', kind: 'warn' as const },
      { id: '3', text: 'same text', kind: 'error' as const },
    ];
    const { lastFrame } = render(<Toast queue={queue} color={false} />);
    const lines = (lastFrame() ?? '').split('\n');
    expect(new Set(lines).size).toBe(3);
    expect(lines[0]).toContain('INFO');
    expect(lines[1]).toContain('WARN');
    expect(lines[2]).toContain('ERROR');
  });
});
