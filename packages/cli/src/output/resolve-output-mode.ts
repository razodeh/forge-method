/**
 * `resolveOutputMode` — `03` §3.5's four-mode table as one function.
 *
 * Precedence, since the table itself does not state one: `--json` first (`03` §3.5 calls it "the
 * integration contract for CI" — nothing should silently downgrade it), then `--quiet`, then
 * `--no-tui`-or-non-TTY (headless streaming), then TUI as the only remaining default. `isTty` stands
 * in for the table's own "TTY + interactive command" trigger — whether the requested command is
 * itself interactive is a later command piece's concern, not this function's.
 *
 * @see specs/03 §3.5
 */
import type { GlobalFlags } from '../entry/types.ts';
import type { OutputMode } from './types.ts';

export function resolveOutputMode(flags: GlobalFlags, isTty: boolean): OutputMode {
  if (flags.json) return 'json';
  if (flags.quiet) return 'quiet';
  if (flags.noTui || !isTty) return 'stream';
  return 'tui';
}
