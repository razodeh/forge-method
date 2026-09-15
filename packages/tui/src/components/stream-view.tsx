/**
 * `<StreamView>` — `04` §4.1's own bounded ring-buffer log/transcript view with follow-mode, over a
 * real `AsyncIterable<string>` (a live tail) or a pre-materialised `readonly string[]` (a finished
 * transcript). Every line appended past `maxLines` (default 2000, `04` §4.1's own ring-buffer budget)
 * silently drops the oldest -- this is a real, bounded buffer, never an unbounded array a long-lived
 * session could grow without limit.
 *
 * Keys (`04` §4.2), active only while `focused`:
 * - `f` toggles follow-mode.
 * - `↑`/`k` scrolls up one line, suspending follow-mode (an explicit manual scroll always wins over
 *   auto-scroll, matching `04` §4.1's own "manually scrolling up suspends follow" text).
 * - `↓`/`j` scrolls down one line; reaching the exact bottom this way resumes follow-mode automatically
 *   (the other half of that same sentence: "until `f` is pressed again or the view is scrolled back to
 *   the bottom").
 *
 * A `source` prop change (a different lane's transcript, or a fresh async generator for the same
 * logical stream) resets the buffer -- a fresh critic round reproduced directly that this component
 * originally seeded `lines` only from a `useState` lazy initializer, which runs exactly once on mount:
 * re-rendering the *same* `<StreamView>` element with a genuinely different `source` (the ordinary
 * "user switched lanes" case `04` §4.3 S2 itself describes) either kept showing the *previous* source's
 * frozen content forever (a static array swap) or silently concatenated the new source's lines after
 * the stale ones (an async source swap) -- never the fresh, correct content alone. Unlike `<Tree>`'s
 * own reused-id hazard (a caller-lifecycle concern resolved via a `key` prop, not internal detection),
 * this is not an identity-collision question: `source` genuinely changing, by any means, always means
 * "show this new content instead," so resetting on that change is the correct default, not a heuristic.
 *
 * `maxLines` changing alone (the same `source` still live) is deliberately decoupled from that reset
 * and from the async-consumption effect's own lifecycle entirely -- a second critic round, verifying
 * the fix above, reproduced directly that the first version of it put `maxLines` in both effects' own
 * dependency arrays: adjusting only `maxLines` on an in-flight async source (e.g. a live settings panel
 * changing the buffer size while a lane's tail is running) reset `lines` to empty AND tore down and
 * restarted the consumption effect against the *same* already-partially-consumed `AsyncIterable`
 * (`Symbol.asyncIterator()` on a real async generator returns `this`, not a fresh iterator) --
 * permanently losing every line already streamed, with no way to ever recover them, not merely a
 * cosmetic reset. `maxLines` is instead read through a ref the consumption loop's own closure never
 * needs to be torn down to see current, and a shrinking bound re-trims the existing buffer in place
 * (its own small, `[maxLines]`-only effect) rather than discarding it.
 *
 * @see specs/04 §4.1, §4.2, §4.5
 * @see PLAN-M9.md P4
 */
import { Box, Text, useInput } from 'ink';
import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';

const DEFAULT_MAX_LINES = 2000;

/** Strips C0 control characters, `DEL`, and the whole C1 range (`\x00`-`\x1f`, `\x7f`-`\x9f`) from a
 * line before it ever reaches Ink's own render tree — the identical bug class and identical
 * character range `packages/cli/src/bin.ts`'s own `stripControlChars` fixes for CLI output, applied
 * here since it was never applied to this component at all. `source` is genuinely untrusted at both
 * of this component's own real call sites: `sessions.tsx` feeds it a live-facilitated-discussion
 * transcript (model-generated turn text, no charset restriction anywhere upstream), and
 * `run-board.tsx` feeds it a live lane's own transcript (real agent/adapter output, equally
 * uninspected). Ink manages only its own SGR styling — it does not strip arbitrary control bytes out
 * of string content handed to it — so a crafted or buggy model response containing a raw ANSI/C1
 * escape sequence would otherwise reach the terminal exactly as `bin.ts`'s own doc comment describes
 * for its own, already-fixed call sites: able to overwrite or hide prior lines, undetected by anyone
 * reading the screen. Found by a fresh adversarial review of this package, not by this component's
 * own original build; no existing TUI-side sanitization utility exists anywhere in this package to
 * reuse (confirmed by grep), so this is a small, local duplication of `bin.ts`'s own fix rather than a
 * new cross-package dependency for one four-line function. */
function sanitizeStreamLine(line: string): string {
  // eslint-disable-next-line no-control-regex -- deliberately matching control chars to strip them.
  return line.replace(/[\x00-\x1f\x7f-\x9f]/g, '');
}

export type StreamSource = AsyncIterable<string> | readonly string[];

export interface StreamViewProps {
  readonly source: StreamSource;
  readonly maxLines?: number;
  readonly height: number;
  readonly focused: boolean;
}

function isAsyncIterable(source: StreamSource): source is AsyncIterable<string> {
  return !Array.isArray(source);
}

function appendBounded(
  current: readonly string[],
  line: string,
  maxLines: number,
): readonly string[] {
  const next = [...current, line];
  return next.length > maxLines ? next.slice(next.length - maxLines) : next;
}

export function StreamView({
  source,
  maxLines = DEFAULT_MAX_LINES,
  height,
  focused,
}: StreamViewProps): JSX.Element {
  const [lines, setLines] = useState<readonly string[]>(() =>
    isAsyncIterable(source) ? [] : source.slice(Math.max(0, source.length - maxLines)),
  );
  const [following, setFollowing] = useState(true);
  const [manualScrollOffset, setManualScrollOffset] = useState(0);

  // Read from the consumption loop below via a ref, never as a direct dependency of that effect --
  // `maxLines` changing must never tear down and restart consumption of a live `source`.
  const maxLinesRef = useRef(maxLines);
  useEffect(() => {
    maxLinesRef.current = maxLines;
  }, [maxLines]);

  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    setLines(
      isAsyncIterable(source) ? [] : source.slice(Math.max(0, source.length - maxLinesRef.current)),
    );
    // Deliberately keyed on `source` alone -- see this file's own top doc comment for why `maxLines`
    // must never be part of this dependency array.
  }, [source]);

  // A shrinking `maxLines` re-trims the existing buffer in place, without touching `source` or
  // restarting consumption of a live, possibly-non-restartable async iterable.
  useEffect(() => {
    setLines((current) =>
      current.length > maxLines ? current.slice(current.length - maxLines) : current,
    );
  }, [maxLines]);

  useEffect(() => {
    if (!isAsyncIterable(source)) return;
    let cancelled = false;
    void (async () => {
      for await (const line of source) {
        // `cancelled` is reassigned by the cleanup closure below, between iterations of this same
        // loop -- TS's control-flow narrowing only sees this function's own body never reassigning
        // it, and (wrongly) treats the check as always false. The identical false positive already
        // documented at length in `state/engine-client.ts`'s own `stopped` checks.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (cancelled) return;
        setLines((current) => appendBounded(current, line, maxLinesRef.current));
      }
    })();
    return () => {
      cancelled = true;
    };
    // Deliberately keyed on `source` alone -- see this file's own top doc comment.
  }, [source]);

  const maxScrollOffset = Math.max(0, lines.length - height);
  const windowStart = following ? maxScrollOffset : Math.min(manualScrollOffset, maxScrollOffset);
  const visibleLines = lines.slice(windowStart, windowStart + height);

  useInput(
    (input, key) => {
      if (input === 'f') {
        setFollowing((current) => !current);
        setManualScrollOffset(maxScrollOffset);
        return;
      }
      if (key.upArrow || input === 'k') {
        setFollowing(false);
        setManualScrollOffset(Math.max(0, windowStart - 1));
        return;
      }
      if (key.downArrow || input === 'j') {
        const next = Math.min(maxScrollOffset, windowStart + 1);
        setManualScrollOffset(next);
        setFollowing(next >= maxScrollOffset);
      }
    },
    { isActive: focused },
  );

  return (
    <Box flexDirection="column">
      {visibleLines.map((line, index) => (
        <Text key={windowStart + index}>{sanitizeStreamLine(line)}</Text>
      ))}
    </Box>
  );
}
