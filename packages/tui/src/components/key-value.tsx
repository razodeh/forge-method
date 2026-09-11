/**
 * `<KeyValue>` — `04` §4.5's own aligned two-column metadata display. Every key is padded to the
 * widest key in the same `rows` array, so the value column lines up regardless of how many rows are
 * shown -- the one thing a plain sequence of `key: value` `<Text>` lines cannot do on its own.
 *
 * Padding is computed from each key's own *terminal display width* (`string-width`), not
 * `String.prototype.length` (UTF-16 code units) -- a fresh critic round reproduced directly that a
 * full-width key (e.g. `日本語`, 3 code units but 6 terminal columns) misaligned the value column
 * against an ordinary ASCII key of the same `.length` sitting right next to it, defeating this
 * component's own "aligned" contract for any non-ASCII project/field name, plausible in a real host
 * project's own metadata.
 *
 * @see specs/04 §4.5
 * @see PLAN-M9.md P2
 */
import { Box, Text } from 'ink';
import type { JSX } from 'react';
import stringWidth from 'string-width';

export interface KeyValueRow {
  readonly key: string;
  readonly value: string;
}

export interface KeyValueProps {
  readonly rows: readonly KeyValueRow[];
}

/** Pads `text` with trailing spaces until its own *display width* reaches `width` -- `padEnd` pads by
 * code-unit count, which over-pads a full-width key by the same number of columns it is wide. */
function padEndToDisplayWidth(text: string, width: number): string {
  const gap = width - stringWidth(text);
  return gap > 0 ? text + ' '.repeat(gap) : text;
}

export function KeyValue({ rows }: KeyValueProps): JSX.Element {
  const widestKey = rows.reduce((max, row) => Math.max(max, stringWidth(row.key)), 0);

  return (
    <Box flexDirection="column">
      {rows.map((row, index) => (
        <Text key={`${String(index)}:${row.key}`}>
          {padEndToDisplayWidth(row.key, widestKey)} {row.value}
        </Text>
      ))}
    </Box>
  );
}
