/**
 * `<ProgressBar>` — `04` §4.5's own budget/progress bars. `RenderMode.ascii` swaps the fill/track
 * characters for a `[####----]`-shaped fallback built entirely from `#`/`-`, never the Unicode block
 * glyphs, matching `04` §4.7's own ASCII-mode contract.
 *
 * @see specs/04 §4.5, §4.7
 * @see PLAN-M9.md P2
 */
import { Text } from 'ink';
import type { JSX } from 'react';

import type { RenderMode } from '../env.ts';

const BAR_WIDTH = 20;

export interface ProgressBarProps {
  readonly value: number;
  readonly max: number;
  readonly label: string;
  readonly mode: Pick<RenderMode, 'ascii'>;
}

export function ProgressBar({ value, max, label, mode }: ProgressBarProps): JSX.Element {
  const fillChar = mode.ascii ? '#' : '█';
  const trackChar = mode.ascii ? '-' : '░';
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const filled = Math.round(ratio * BAR_WIDTH);
  const bar = fillChar.repeat(filled) + trackChar.repeat(BAR_WIDTH - filled);

  return (
    <Text>
      [{bar}] {label}
    </Text>
  );
}
