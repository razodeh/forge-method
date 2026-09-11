/**
 * `<Pane>` -- `04` §4.5's own bordered box, focus ring, scroll indicator.
 *
 * @see specs/04 §4.5, §4.7
 * @see PLAN-M9.md P2
 */
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';

import { Pane } from '../../src/components/pane.tsx';

/** `Pane(...)` returns `JSX.Element`, whose own `.props` type is `any` -- too permissive for this
 * repo's `no-unsafe-*` lint rules. This is the real, narrow shape this test actually reads back out
 * of the returned React element tree, asserted via a single explicit cast rather than leaving `.props`
 * typed `any` at every access site below. */
interface BoxElement {
  readonly props: {
    readonly borderColor?: string;
    readonly children: readonly [TextElement, unknown];
  };
}
interface TextElement {
  readonly props: {
    readonly color?: string;
  };
}

describe('Pane', () => {
  it('a focused pane renders visibly differently from an unfocused one, colour codes included', () => {
    const focused = render(
      <Pane title="Lanes" focused mode={{ ascii: false, color: true }}>
        <></>
      </Pane>,
    );
    const unfocused = render(
      <Pane title="Lanes" focused={false} mode={{ ascii: false, color: true }}>
        <></>
      </Pane>,
    );
    expect(focused.lastFrame()).not.toBe(unfocused.lastFrame());
  });

  it('a focused pane still renders visibly differently once colour codes are stripped -- the focus marker itself, not only colour, carries the signal', () => {
    const focused = render(
      <Pane title="Lanes" focused mode={{ ascii: false, color: true }}>
        <></>
      </Pane>,
    );
    const unfocused = render(
      <Pane title="Lanes" focused={false} mode={{ ascii: false, color: true }}>
        <></>
      </Pane>,
    );
    expect(stripAnsi(focused.lastFrame() ?? '')).not.toBe(stripAnsi(unfocused.lastFrame() ?? ''));
  });

  it('mode.color: false never threads a borderColor/title colour into the underlying <Box>/<Text> props on a focused pane -- a fresh critic round reproduced this pane hard-coding a cyan border regardless of NO_COLOR, since it took no color slice of RenderMode in the first place', () => {
    // Called directly rather than through ink-testing-library's fake terminal: that terminal never
    // actually emits ANSI colour codes in this test environment (chalk's own colour-level detection
    // reads the real process.stdout, not the fake one, and this run has no real TTY/FORCE_COLOR), so
    // a `focused && color` regression could hide behind a byte-identical rendered frame either way.
    // Calling the component as a plain function returns the real React element tree, which carries
    // the `color`/`borderColor` prop (or its real absence) regardless of what any terminal renders.
    const withColor = Pane({
      title: 'Lanes',
      focused: true,
      mode: { ascii: false, color: true },
    }) as unknown as BoxElement;
    const withoutColor = Pane({
      title: 'Lanes',
      focused: true,
      mode: { ascii: false, color: false },
    }) as unknown as BoxElement;
    expect(withColor.props.borderColor).toBe('cyan');
    expect(withoutColor.props.borderColor).toBeUndefined();
    const [withColorTitle] = withColor.props.children;
    const [withoutColorTitle] = withoutColor.props.children;
    expect(withColorTitle.props.color).toBe('cyan');
    expect(withoutColorTitle.props.color).toBeUndefined();
  });

  it('ascii mode renders only +/-/| border characters, never a unicode box-drawing glyph', () => {
    const { lastFrame } = render(
      <Pane title="Lanes" focused={false} mode={{ ascii: true, color: true }}>
        <></>
      </Pane>,
    );
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toMatch(/[+\-|]/);
    expect(frame).not.toMatch(/[┌┐└┘│─]/);
  });

  it('a scroll indicator only renders the directions actually requested', () => {
    const both = render(
      <Pane
        title="Log"
        focused={false}
        mode={{ ascii: false, color: true }}
        scroll={{ moreAbove: true, moreBelow: true }}
      >
        <></>
      </Pane>,
    );
    const neither = render(
      <Pane
        title="Log"
        focused={false}
        mode={{ ascii: false, color: true }}
        scroll={{ moreAbove: false, moreBelow: false }}
      >
        <></>
      </Pane>,
    );
    const none = render(
      <Pane title="Log" focused={false} mode={{ ascii: false, color: true }}>
        <></>
      </Pane>,
    );
    expect(stripAnsi(both.lastFrame() ?? '')).toContain('↑');
    expect(stripAnsi(both.lastFrame() ?? '')).toContain('↓');
    expect(stripAnsi(neither.lastFrame() ?? '')).not.toContain('↑');
    expect(stripAnsi(neither.lastFrame() ?? '')).not.toContain('↓');
    expect(neither.lastFrame()).toBe(none.lastFrame());
  });

  it('children are rendered inside the pane', () => {
    const { lastFrame } = render(
      <Pane title="Details" focused={false} mode={{ ascii: false, color: true }}>
        <Text>hello from inside</Text>
      </Pane>,
    );
    expect(stripAnsi(lastFrame() ?? '')).toContain('hello from inside');
  });
});
