/**
 * `<Pane>` — `04` §4.5's own bordered box, focus ring, scroll indicator. Every screen composes its
 * body out of one or more `<Pane>`s; this is the one place border style, focus styling, and the
 * scroll-position affordance are decided, so no screen re-implements any of the three on its own.
 *
 * Border style is `cli-boxes`, exactly as `PLAN-M9.md` P2 calls for: `single` under a real Unicode
 * terminal, `classic` (built entirely from `+`/`-`/`|`) under `RenderMode.ascii` -- `cli-boxes` already
 * ships both, so nothing here hand-rolls a border character set.
 *
 * A scroll indicator is opt-in via `scroll`: `<Pane>` renders its own children exactly as given and has
 * no way to measure whether they overflow its own box, so a caller that owns real scroll position (a
 * `<ListPane>`/`<StreamView>`, both later pieces) passes `{ moreAbove, moreBelow }` down explicitly
 * rather than this component guessing from an overflow it cannot observe.
 *
 * The focus ring's own colour is gated on `RenderMode.color`, not just `ascii` -- a fresh critic round
 * reproduced directly that this component originally took no `color` slice of `RenderMode` at all and
 * hard-coded a cyan border/title whenever `focused` was true, so a real `NO_COLOR=1` session still saw
 * a coloured border, violating `04` §4.7's own blanket "respect `NO_COLOR`" contract. Text-only
 * disambiguation (the focus marker glyph itself, always rendered) already satisfied the *accessibility*
 * half of that rule; this fix closes the separate, narrower `NO_COLOR`-compliance gap underneath it.
 *
 * @see specs/04 §4.5, §4.7
 * @see PLAN-M9.md P2
 */
import { Box, Text } from 'ink';
import type { JSX, ReactNode } from 'react';

import type { RenderMode } from '../env.ts';

export interface PaneScrollIndicator {
  readonly moreAbove: boolean;
  readonly moreBelow: boolean;
}

export interface PaneProps {
  readonly title: string;
  readonly focused: boolean;
  readonly mode: Pick<RenderMode, 'ascii' | 'color'>;
  readonly scroll?: PaneScrollIndicator;
  readonly children?: ReactNode;
}

export function Pane({ title, focused, mode, scroll, children }: PaneProps): JSX.Element {
  const borderStyle = mode.ascii ? 'classic' : 'single';
  const borderColor = focused && mode.color ? 'cyan' : undefined;
  const focusMarker = focused ? (mode.ascii ? '> ' : '▸ ') : '  ';
  const aboveGlyph = mode.ascii ? '^' : '↑';
  const belowGlyph = mode.ascii ? 'v' : '↓';
  const scrollSuffix = scroll
    ? `${scroll.moreAbove ? ` ${aboveGlyph}` : ''}${scroll.moreBelow ? ` ${belowGlyph}` : ''}`
    : '';

  const borderColorProp = borderColor ? { borderColor } : {};
  const titleColorProp = borderColor ? { color: borderColor } : {};

  return (
    <Box flexDirection="column" borderStyle={borderStyle} {...borderColorProp}>
      <Text bold={focused} {...titleColorProp}>
        {focusMarker}
        {title}
        {scrollSuffix}
      </Text>
      <Box flexDirection="column">{children}</Box>
    </Box>
  );
}
