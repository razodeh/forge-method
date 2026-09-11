/**
 * `<ProgressBar>` -- `04` §4.5's own budget/progress bars, ascii-safe `[####----]` fallback.
 *
 * @see specs/04 §4.5, §4.7
 * @see PLAN-M9.md P2
 */
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

import { ProgressBar } from '../../src/components/progress-bar.tsx';

describe('ProgressBar', () => {
  it('ascii mode renders only #/- fill characters inside brackets', () => {
    const { lastFrame } = render(
      <ProgressBar value={10} max={20} label="$10/$20" mode={{ ascii: true }} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/^\[[#-]+\] \$10\/\$20$/);
    expect(frame).toContain('#');
    expect(frame).toContain('-');
  });

  it('unicode mode renders block glyphs, never #/-', () => {
    const { lastFrame } = render(
      <ProgressBar value={10} max={20} label="$10/$20" mode={{ ascii: false }} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('█');
    expect(frame).toContain('░');
    expect(frame).not.toContain('#');
  });

  it('value === max fills the bar completely', () => {
    const { lastFrame } = render(
      <ProgressBar value={5} max={5} label="done" mode={{ ascii: true }} />,
    );
    expect(lastFrame() ?? '').not.toContain('-');
  });

  it('value === 0 leaves the bar completely empty', () => {
    const { lastFrame } = render(
      <ProgressBar value={0} max={5} label="none" mode={{ ascii: true }} />,
    );
    expect(lastFrame() ?? '').not.toContain('#');
  });

  it('a value exceeding max is clamped, never overflowing the bar width', () => {
    const { lastFrame } = render(
      <ProgressBar value={999} max={5} label="over" mode={{ ascii: true }} />,
    );
    expect(lastFrame() ?? '').not.toContain('-');
  });

  it('a negative value is clamped to zero, never rendering a negative fill', () => {
    const { lastFrame } = render(
      <ProgressBar value={-5} max={5} label="negative" mode={{ ascii: true }} />,
    );
    expect(lastFrame() ?? '').not.toContain('#');
  });

  it('max === 0 renders a fully empty bar rather than dividing by zero', () => {
    const { lastFrame } = render(
      <ProgressBar value={0} max={0} label="empty" mode={{ ascii: true }} />,
    );
    expect(lastFrame() ?? '').not.toContain('#');
  });
});
