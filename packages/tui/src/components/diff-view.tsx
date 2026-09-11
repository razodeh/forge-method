/**
 * `<DiffView>` — `04` §4.5's own unified-diff renderer for S3/S4's before/after and diff-against-base
 * views: syntax-agnostic add/remove/context colouring (never language-aware highlighting -- out of
 * this milestone's own real scope, `04` doesn't ask for it) and hunk folding for a diff exceeding a
 * configurable line threshold.
 *
 * A stateless, pure function of `patch` (and `expandedHunks`, if the caller wants to control which
 * folded hunks are open) -- matching P2's "small, stateless" components rather than owning its own
 * expand/collapse state, since the literal `<DiffView patch>` surface `PLAN-M9.md` P4 names takes no
 * other prop. `expandedHunks` is an *additional*, optional prop (the same pattern `<Pane>`'s own
 * `scroll` indicator already established in P2): a caller that wants real interactive fold/expand
 * wires its own key handling and passes the resulting set back in, rather than this component owning
 * a keyboard binding the literal surface signature never asked for.
 *
 * @see specs/04 §4.1, §4.5
 * @see PLAN-M9.md P4
 */
import { Box, Text } from 'ink';
import type { JSX } from 'react';

import type { RenderMode } from '../env.ts';

export type DiffLineType = 'add' | 'remove' | 'context';

export interface DiffLine {
  readonly type: DiffLineType;
  readonly text: string;
}

export interface DiffHunk {
  readonly header: string;
  readonly lines: readonly DiffLine[];
  readonly addCount: number;
  readonly removeCount: number;
}

function lineType(line: string): DiffLineType | undefined {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'add';
  if (line.startsWith('-') && !line.startsWith('---')) return 'remove';
  if (line.startsWith(' ')) return 'context';
  return undefined;
}

/** Parses a real unified-diff string into its own hunks, ignoring `diff --git`/`index`/`---`/`+++`
 * file-header lines entirely -- this component renders hunk content, not a file-path banner. */
export function parseUnifiedDiff(patch: string): readonly DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: { header: string; lines: DiffLine[] } | undefined;

  for (const rawLine of patch.split('\n')) {
    if (rawLine.startsWith('@@ ')) {
      if (current) hunks.push(finalizeHunk(current));
      current = { header: rawLine, lines: [] };
      continue;
    }
    if (!current) continue;
    const type = lineType(rawLine);
    if (type === undefined) continue;
    current.lines.push({ type, text: rawLine.slice(1) });
  }
  if (current) hunks.push(finalizeHunk(current));
  return hunks;
}

function finalizeHunk(current: { header: string; lines: DiffLine[] }): DiffHunk {
  return {
    header: current.header,
    lines: current.lines,
    addCount: current.lines.filter((line) => line.type === 'add').length,
    removeCount: current.lines.filter((line) => line.type === 'remove').length,
  };
}

const DEFAULT_FOLD_THRESHOLD = 20;

const LINE_COLOR: Readonly<Record<DiffLineType, string | undefined>> = {
  add: 'green',
  remove: 'red',
  context: undefined,
};

const LINE_PREFIX: Readonly<Record<DiffLineType, string>> = {
  add: '+',
  remove: '-',
  context: ' ',
};

export interface DiffViewProps {
  readonly patch: string;
  readonly mode: Pick<RenderMode, 'color'>;
  readonly foldThreshold?: number;
  readonly expandedHunks?: ReadonlySet<number>;
}

export function DiffView({
  patch,
  mode,
  foldThreshold = DEFAULT_FOLD_THRESHOLD,
  expandedHunks,
}: DiffViewProps): JSX.Element {
  const hunks = parseUnifiedDiff(patch);

  return (
    <Box flexDirection="column">
      {hunks.map((hunk, index) => {
        const isFolded = hunk.lines.length > foldThreshold && !expandedHunks?.has(index);
        const headerColorProp = mode.color ? { color: 'cyan' } : {};
        return (
          <Box flexDirection="column" key={`${String(index)}:${hunk.header}`}>
            <Text bold {...headerColorProp}>
              {hunk.header}
            </Text>
            {isFolded ? (
              <Text dimColor>
                ⋯ {String(hunk.lines.length)} lines folded (+{String(hunk.addCount)} -
                {String(hunk.removeCount)}) ⋯
              </Text>
            ) : (
              hunk.lines.map((line, lineIndex) => {
                const lineColor = LINE_COLOR[line.type];
                const lineColorProp = mode.color && lineColor ? { color: lineColor } : {};
                return (
                  <Text key={`${String(lineIndex)}:${line.type}`} {...lineColorProp}>
                    {LINE_PREFIX[line.type]}
                    {line.text}
                  </Text>
                );
              })
            )}
          </Box>
        );
      })}
    </Box>
  );
}
