/**
 * `<StatusGlyph>` -- `04` §4.2's 8 canonical states, each snapshotted under both `ascii: false` and
 * `ascii: true`, plus a colour-blindness pass proving the rendered *text* alone (ANSI codes stripped)
 * still disambiguates all 8 states.
 *
 * @see specs/04 §4.2, §4.7
 * @see PLAN-M9.md P2
 */
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';

import { StatusGlyph, type StatusState } from '../../src/components/status-glyph.tsx';

const ALL_STATES: readonly StatusState[] = [
  'pass',
  'fail',
  'running',
  'waiting',
  'paused',
  'warn',
  'blocked',
  'skipped',
];

describe('StatusGlyph', () => {
  it.for(ALL_STATES)('renders a distinct unicode frame for state %s', (state) => {
    const { lastFrame } = render(
      <StatusGlyph state={state} mode={{ ascii: false, color: true }} />,
    );
    expect(lastFrame()).toMatchSnapshot();
  });

  it.for(ALL_STATES)('renders a distinct ascii frame for state %s', (state) => {
    const { lastFrame } = render(<StatusGlyph state={state} mode={{ ascii: true, color: true }} />);
    expect(lastFrame()).toMatchSnapshot();
  });

  it('every unicode-mode frame differs from its own ascii-mode sibling', () => {
    for (const state of ALL_STATES) {
      const unicode = render(<StatusGlyph state={state} mode={{ ascii: false, color: true }} />);
      const ascii = render(<StatusGlyph state={state} mode={{ ascii: true, color: true }} />);
      expect(unicode.lastFrame()).not.toBe(ascii.lastFrame());
    }
  });

  it('every state produces a unique rendered string, ascii mode, colour codes stripped -- a real colour-blindness pass: disambiguation must survive on text alone', () => {
    const texts = ALL_STATES.map((state) => {
      const { lastFrame } = render(
        <StatusGlyph state={state} mode={{ ascii: true, color: true }} />,
      );
      return stripAnsi(lastFrame() ?? '');
    });
    expect(new Set(texts).size).toBe(ALL_STATES.length);
  });

  it('every state produces a unique rendered string, unicode mode, colour codes stripped', () => {
    const texts = ALL_STATES.map((state) => {
      const { lastFrame } = render(
        <StatusGlyph state={state} mode={{ ascii: false, color: true }} />,
      );
      return stripAnsi(lastFrame() ?? '');
    });
    expect(new Set(texts).size).toBe(ALL_STATES.length);
  });

  it('color: false renders identical text to color: true, once ANSI codes are stripped -- colour is decoration, never the signal itself', () => {
    for (const state of ALL_STATES) {
      const withColor = render(<StatusGlyph state={state} mode={{ ascii: false, color: true }} />);
      const withoutColor = render(
        <StatusGlyph state={state} mode={{ ascii: false, color: false }} />,
      );
      expect(stripAnsi(withColor.lastFrame() ?? '')).toBe(
        stripAnsi(withoutColor.lastFrame() ?? ''),
      );
    }
  });
});
