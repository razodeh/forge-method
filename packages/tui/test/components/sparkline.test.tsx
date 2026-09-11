/**
 * `<Sparkline>` -- `04` §4.5's own cost/velocity trend glyphs, unicode block-height with an ascii-digit
 * fallback.
 *
 * @see specs/04 §4.5, §4.7
 * @see PLAN-M9.md P2
 */
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

import { Sparkline } from '../../src/components/sparkline.tsx';

describe('Sparkline', () => {
  it('renders one glyph per series entry', () => {
    const { lastFrame } = render(<Sparkline series={[1, 5, 3, 9, 2]} mode={{ ascii: false }} />);
    expect((lastFrame() ?? '').length).toBe(5);
  });

  it('ascii mode renders only decimal digits', () => {
    const { lastFrame } = render(<Sparkline series={[1, 5, 3, 9, 2]} mode={{ ascii: true }} />);
    expect(lastFrame() ?? '').toMatch(/^[0-9]+$/);
  });

  it('unicode mode renders only the 8 block-height glyphs', () => {
    const { lastFrame } = render(<Sparkline series={[1, 5, 3, 9, 2]} mode={{ ascii: false }} />);
    expect(lastFrame() ?? '').toMatch(/^[▁▂▃▄▅▆▇█]+$/u);
  });

  it('the lowest value in the series maps to the lowest level', () => {
    const { lastFrame } = render(<Sparkline series={[0, 100]} mode={{ ascii: true }} />);
    const frame = lastFrame() ?? '';
    expect(frame[0]).toBe('0');
  });

  it('the highest value in the series maps to the highest level', () => {
    const { lastFrame } = render(<Sparkline series={[0, 100]} mode={{ ascii: true }} />);
    const frame = lastFrame() ?? '';
    expect(frame[1]).toBe('9');
  });

  it('a flat series (identical values) renders every glyph at the same, lowest level rather than dividing by zero', () => {
    const { lastFrame } = render(<Sparkline series={[7, 7, 7]} mode={{ ascii: true }} />);
    expect(lastFrame()).toBe('000');
  });

  it('an empty series renders an empty frame', () => {
    const { lastFrame } = render(<Sparkline series={[]} mode={{ ascii: true }} />);
    expect(lastFrame()).toBe('');
  });
});
