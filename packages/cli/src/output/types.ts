/**
 * Types for `@forge/cli/output` — `03` §3.5's four output modes.
 *
 * @see specs/03 §3.5
 */

/**
 * `03` §3.5's four modes. `'tui'` is named but never selected by `resolveOutputMode` this milestone
 * — `22`'s own "Do not build" line rules out the Ink app for M6 — so this type is real, shared code
 * the future TUI milestone reuses unchanged, not re-derived when that milestone starts.
 */
export type OutputMode = 'tui' | 'stream' | 'json' | 'quiet';

/**
 * What `formatStreamLine` needs beyond the event itself: whether to emit ANSI colour. A parameter,
 * not an ambient `process.stdout` sniff — `@forge/core/errors/format.ts`'s own `FormatOptions` sets
 * this precedent (colour is resolved once, from flags and `NO_COLOR`/`FORCE_COLOR`, by
 * `resolveOutputMode`'s own caller, not re-read per line).
 */
export interface StreamFormatContext {
  readonly color: boolean;
}
