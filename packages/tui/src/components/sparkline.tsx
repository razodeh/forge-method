/**
 * `<Sparkline>` — `04` §4.5's own cost/velocity trend glyphs. Each value in `series` is normalised
 * against the series' own min/max and mapped to a level; `RenderMode.ascii` renders each level as a
 * decimal digit (`0`-`9`, 10 levels) instead of a Unicode block-height glyph (8 levels), since no
 * single ASCII character can vary in visual height the way a block glyph does.
 *
 * @see specs/04 §4.5, §4.7
 * @see PLAN-M9.md P2
 */
import { Text } from 'ink';
import type { JSX } from 'react';

import type { RenderMode } from '../env.ts';

/** 8 Unicode block-height glyphs, low to high. */
const UNICODE_LEVELS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
/** 10 ASCII digit levels, low to high -- more levels than the Unicode set since a digit's own shape
 * carries no height cue, so more granularity is the only way to keep two adjacent levels visually
 * distinguishable at all once colour and glyph height are both unavailable. */
const ASCII_LEVELS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

export interface SparklineProps {
  readonly series: readonly number[];
  readonly mode: Pick<RenderMode, 'ascii'>;
}

export function Sparkline({ series, mode }: SparklineProps): JSX.Element {
  const levels = mode.ascii ? ASCII_LEVELS : UNICODE_LEVELS;

  if (series.length === 0) return <Text />;

  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min;

  const glyphs = series
    .map((value) => {
      const ratio = span > 0 ? (value - min) / span : 0;
      const levelIndex = Math.min(levels.length - 1, Math.floor(ratio * levels.length));
      return levels[levelIndex] ?? '';
    })
    .join('');

  return <Text>{glyphs}</Text>;
}
