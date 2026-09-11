/**
 * `<CommandPalette>` — `04` §4.2's own `:` prompt: fuzzy-matches against a real, injected list of known
 * `forge` subcommands. The vocabulary itself is injected (`commands`), not hardcoded here -- there is
 * no single, centralised registry of `forge` subcommand names/descriptions anywhere in this codebase
 * today (`packages/cli/src/bin.ts`'s own doc comment disclaims being one); whichever piece wires a real
 * `<CommandPalette>` up (a later screen) is responsible for supplying the real, current list.
 *
 * Matching is a real fuzzy *subsequence* match, not a substring/prefix search: `04` P5's own Checks
 * name `"gt appr"` matching `"gate approve"` as the worked example, and `"gt appr"` is not a literal
 * substring of `"gate approve"` at all -- it *is* a subsequence (`g`,`t`,` `,`a`,`p`,`p`,`r` each appear,
 * in that order, though not contiguously). Matches are ranked by minimal match span (a tighter cluster
 * of matched characters ranks first), the standard fuzzy-finder heuristic, not alphabetically.
 *
 * The span is the true global minimum, computed by trying *every* candidate start position, not just
 * one -- a fresh critic round reproduced directly that even a two-pass "forward-then-tighten-backward"
 * fix (an earlier revision of this function) is still not globally correct: it only tightens the span
 * for the *first* end position the forward pass happens to complete at, never considering that a
 * *later* start elsewhere in the string might reach a genuinely tighter completion. Constructed
 * counterexample: query `"ab"` against `"axxxxxxxxxxbab"` -- the first-completing forward pass locks
 * onto the `a` at index 0 and the first `b` at index 11 (span 11), and backward-tightening from that
 * fixed end can only ever shrink *that* window, never discover the genuinely tight `"ab"` sitting at
 * indices 12-13 (span 1). Fixed by trying every index where `target` matches the query's first
 * character as a candidate start, greedily matching forward from each one (a fixed start's own
 * greedy-forward match is provably minimal for that start -- taking the earliest occurrence of each
 * subsequent character can never do worse than any other valid completion from the same start), and
 * keeping the smallest span across every candidate. `commands` lists are short enough (real `forge`
 * subcommand counts, not an unbounded corpus) that the resulting O(length² ) cost per keystroke is not
 * a real concern.
 *
 * @see specs/04 §4.2, §4.5
 * @see PLAN-M9.md P5
 */
import { Box, Text, useInput } from 'ink';
import type { JSX } from 'react';
import { useMemo, useState } from 'react';

import type { RenderMode } from '../env.ts';

export interface Command {
  readonly name: string;
  readonly description: string;
}

interface ScoredCommand {
  readonly command: Command;
  readonly span: number;
}

/** Returns the match, scored by the shortest span in `target` containing every character of `query`,
 * in order (case-insensitive) -- or `undefined` if `query` is not a subsequence of `target` at all. */
function fuzzyMatch(query: string, target: string): number | undefined {
  if (query.length === 0) return 0;
  const needle = query.toLowerCase();
  const haystack = target.toLowerCase();

  let bestSpan: number | undefined;
  for (let start = 0; start < haystack.length; start += 1) {
    if (haystack[start] !== needle[0]) continue;

    let matchedIndex = 1;
    let end = start;
    for (
      let index = start + 1;
      index < haystack.length && matchedIndex < needle.length;
      index += 1
    ) {
      if (haystack[index] === needle[matchedIndex]) {
        matchedIndex += 1;
        end = index;
      }
    }
    if (matchedIndex !== needle.length) continue;

    const span = end - start;
    if (bestSpan === undefined || span < bestSpan) bestSpan = span;
  }
  return bestSpan;
}

export interface CommandPaletteProps {
  readonly open: boolean;
  readonly commands: readonly Command[];
  readonly onSubmit: (commandName: string) => void;
  readonly onCancel: () => void;
  /** `04` §4.7's own degradation-mode pass (`PLAN-M9.md` P15) found this component never accepted a
   * `mode` prop at all, unconditionally rendering a real Unicode em dash (`—`) between a command's own
   * name and description regardless of `RenderMode.ascii` -- a real, genuine gap, not a disclosed scope
   * cut. Added to close it; every other component in this package already threads `RenderMode` through. */
  readonly mode: Pick<RenderMode, 'ascii'>;
}

export function CommandPalette({
  open,
  commands,
  onSubmit,
  onCancel,
  mode,
}: CommandPaletteProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);

  const matches = useMemo(() => {
    const scored: ScoredCommand[] = [];
    for (const command of commands) {
      const span = fuzzyMatch(query, `${command.name} ${command.description}`);
      if (span !== undefined) scored.push({ command, span });
    }
    scored.sort((a, b) => a.span - b.span);
    return scored.map((entry) => entry.command);
  }, [commands, query]);

  const clampedCursor = Math.min(cursor, Math.max(0, matches.length - 1));

  useInput(
    (input, key) => {
      if (key.escape) {
        onCancel();
        return;
      }
      if (key.upArrow) {
        setCursor((current) => Math.max(0, current - 1));
        return;
      }
      if (key.downArrow) {
        setCursor((current) => Math.min(matches.length - 1, current + 1));
        return;
      }
      if (key.return) {
        const chosen = matches[clampedCursor];
        if (chosen) onSubmit(chosen.name);
        return;
      }
      if (key.backspace || key.delete) {
        setQuery((current) => current.slice(0, -1));
        setCursor(0);
        return;
      }
      if (input.length > 0) {
        setQuery((current) => current + input);
        setCursor(0);
      }
    },
    { isActive: open },
  );

  if (!open) return <></>;

  const separator = mode.ascii ? '-' : '—';

  return (
    <Box flexDirection="column">
      <Text>:{query}</Text>
      {matches.map((command, index) => (
        <Text key={command.name}>
          {index === clampedCursor ? '> ' : '  '}
          {command.name} {separator} {command.description}
        </Text>
      ))}
    </Box>
  );
}
