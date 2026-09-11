/**
 * `<StatusGlyph>` — `04` §4.2's own 8 canonical states, verbatim: `✓ pass`, `✗ fail`, `● running`,
 * `◐ waiting`, `⏸ paused`, `⚠ warn`, `⊘ blocked`, `↷ skipped`. Every one of `@forge/tui`'s later
 * screens renders state through this component, never a bespoke glyph of its own.
 *
 * `04` §4.7's own accessibility rule -- "colour is never *only* meaning-bearing" -- is met structurally,
 * not by convention: the label text differs for all 8 states regardless of `RenderMode.color`, so a
 * reader who cannot perceive colour at all (or a test that strips every ANSI colour code before
 * asserting) can still tell every state apart from its own rendered text alone.
 *
 * @see specs/04 §4.2, §4.7
 * @see PLAN-M9.md P2
 */
import { Text } from 'ink';
import type { JSX } from 'react';

import type { RenderMode } from '../env.ts';

export type StatusState =
  'pass' | 'fail' | 'running' | 'waiting' | 'paused' | 'warn' | 'blocked' | 'skipped';

interface StatusGlyphSpec {
  readonly unicodeGlyph: string;
  readonly asciiGlyph: string;
  readonly label: string;
  readonly color: string;
}

/** `04` §4.2's own literal glyph set, plus a distinct, single-character ASCII fallback for each --
 * every ASCII glyph is unique too, so `RenderMode.ascii` never collapses two states onto one symbol. */
const STATUS_GLYPHS: Readonly<Record<StatusState, StatusGlyphSpec>> = {
  pass: { unicodeGlyph: '✓', asciiGlyph: '+', label: 'pass', color: 'green' },
  fail: { unicodeGlyph: '✗', asciiGlyph: 'x', label: 'fail', color: 'red' },
  running: { unicodeGlyph: '●', asciiGlyph: 'o', label: 'running', color: 'cyan' },
  waiting: { unicodeGlyph: '◐', asciiGlyph: '.', label: 'waiting', color: 'yellow' },
  paused: { unicodeGlyph: '⏸', asciiGlyph: '=', label: 'paused', color: 'gray' },
  warn: { unicodeGlyph: '⚠', asciiGlyph: '!', label: 'warn', color: 'yellow' },
  blocked: { unicodeGlyph: '⊘', asciiGlyph: '#', label: 'blocked', color: 'magenta' },
  skipped: { unicodeGlyph: '↷', asciiGlyph: '-', label: 'skipped', color: 'gray' },
};

export interface StatusGlyphProps {
  readonly state: StatusState;
  readonly mode: Pick<RenderMode, 'ascii' | 'color'>;
}

export function StatusGlyph({ state, mode }: StatusGlyphProps): JSX.Element {
  const spec = STATUS_GLYPHS[state];
  const glyph = mode.ascii ? spec.asciiGlyph : spec.unicodeGlyph;
  const colorProp = mode.color ? { color: spec.color } : {};
  return (
    <Text {...colorProp}>
      {glyph} {spec.label}
    </Text>
  );
}
