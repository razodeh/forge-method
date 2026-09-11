/**
 * `<HelpOverlay>` -- `04` §4.5's own context-sensitive "keys + what can I do here" overlay.
 *
 * @see specs/04 §4.5
 * @see PLAN-M9.md P5
 */
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';

import { HelpOverlay } from '../../src/components/help-overlay.tsx';

describe('HelpOverlay', () => {
  it('renders nothing when closed', () => {
    const { lastFrame } = render(
      <HelpOverlay open={false} context="Home" keys={[{ key: 'q', action: 'Quit' }]} />,
    );
    expect(lastFrame()).toBe('');
  });

  it('renders the given context and key bindings', () => {
    const { lastFrame } = render(
      <HelpOverlay
        open
        context="Run screen"
        keys={[
          { key: 'p', action: 'Pause run' },
          { key: 'r', action: 'Resume run' },
        ]}
      />,
    );
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('Run screen');
    expect(frame).toContain('p — Pause run');
    expect(frame).toContain('r — Resume run');
  });

  it('two different context/keys inputs produce two genuinely different snapshots -- context-sensitive, not a static overlay', () => {
    const home = render(<HelpOverlay open context="Home" keys={[{ key: 'q', action: 'Quit' }]} />);
    const run = render(
      <HelpOverlay
        open
        context="Run screen"
        keys={[
          { key: 'p', action: 'Pause run' },
          { key: 'a', action: 'Approve gate' },
        ]}
      />,
    );
    expect(home.lastFrame()).not.toBe(run.lastFrame());
  });

  it('an empty keys array renders just the context, without crashing', () => {
    const { lastFrame } = render(<HelpOverlay open context="Empty screen" keys={[]} />);
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('Empty screen');
    expect(frame.split('\n')).toHaveLength(3); // top border, the one content line, bottom border
  });
});
