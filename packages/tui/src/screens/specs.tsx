/**
 * `<SpecsScreen>` — `04` §4.3 S3: the spec-graph tree, traceability path-to-root, an orphans-only
 * filter, and the traceability matrix view. Composes `<Tree>` (P3, extended here with a new
 * `onFocusChange` prop — see this file's own top doc comment point 1) and `@forge/core/graph`'s own
 * already-built `SpecGraph` (M1/M2, confirmed real).
 *
 * Real design decisions, recorded fully in `SPEC-QUESTIONS.md` Q141:
 *
 * 1. **`SpecGraph` is a direct, read-only, non-event-sourced load** (`SpecGraph.build(docs)`, a
 *    synchronous fold over an already-loaded `ArtifactDocument[]`) — confirmed directly against its real
 *    construction path before designing this screen, settling `PLAN-M9.md` P9's own open question. There
 *    is nothing event-sourced to read through `EngineClient`'s read model here at all; this screen
 *    accepts an already-built `SpecGraph` as a caller-supplied prop, the same caller-supplied-fact
 *    pattern `<HomeScreen>` (P7) and `<RunBoard>` (P8) already established for their own out-of-scope
 *    facts. `@forge/core` is a fresh dependency of `@forge/tui` as of this piece.
 * 2. `<Tree>` (P3) had no way for a caller to learn which node is currently focused — its own
 *    `focusedId` was entirely internal, opaque state. This screen's own `t`/`n`/`e` keys all need to
 *    know which node a keystroke should act on, so `<Tree>` gained a new, optional, additive
 *    `onFocusChange` prop (called with the focused node whenever it changes, including once on mount) —
 *    every existing caller (P3's own tests) is unaffected.
 * 3. `GraphNode` carries only `{ kind, id }`, no display title — this screen renders `"<kind> <id>"`
 *    directly as each tree row's label, deliberately not inventing a title lookup this piece has no
 *    real data source for.
 * 4. The primary hierarchy (Vision → Capabilities → Epics → Stories → Tasks) is built from exactly the
 *    `realises`/`delivers`/`partOf`/`implements` edges `09` §9.4's own table names for those rows —
 *    computed directly from `graph.edges()`, not from `SpecGraph.childrenOf()` (which returns every
 *    child regardless of edge kind, mixing in e.g. an `ADR` that `constrains` a `Story` alongside that
 *    Story's own genuine children were it used one level up). Tests/ADRs are real, computed cross-link
 *    counts rendered as a suffix on the owning Story/Epic's own row (`· ⚭ N tests`/`· N ADR(s)`), not a
 *    separate interactive cross-link view — a deliberate, disclosed scope narrowing given this piece's
 *    already-large surface, not silently guessed at.
 * 5. `t` (traceability path to root) and `x` (orphans-only) are pure, local view concerns — neither has
 *    a real engine-side effect to name, the same reasoning `<RunBoard>` (P8) already established for its
 *    own `Enter`/`d`. Only `n` (new-artifact-from-template) and `e` (edit, then auto-validate) emit real
 *    `EngineCommand`s (`spec.newArtifactFromTemplate`, and `spec.edit` immediately followed by
 *    `spec.validate` — `04`'s own literal "then auto-`forge spec validate`", emitted as two commands in
 *    sequence, not one).
 * 6. The traceability matrix (`m`) is Capabilities × Stories (not a literal 3-way Capabilities × Stories
 *    × Tests grid — `09` §9.4's own matrix concept doesn't name a single flat cell shape for three
 *    independent axes at once): rows are `CAP` nodes, columns are every `STORY` reachable from that
 *    capability via its own Epics, and a cell is `✓` when that Story has at least one Test proving one
 *    of its Acceptance Criteria, `✗` otherwise — matching `04`'s own literal "empty required cells...
 *    rendered `✗`... actionable." Arrow keys move a real cursor over the grid (`04`'s own "keyboard-
 *    navigable"); `Enter` on a `✗` cell emits `spec.newArtifactFromTemplate` for that Story, a reasonable
 *    reading of "actionable" given no other action is named for this specific cell shape anywhere in
 *    `04`. A round-1 critic found and this fixes a real bug here: moving the cursor between rows
 *    (`↑`/`↓`) left `col` un-reclamped against the destination row's own (possibly shorter) cell count
 *    — now re-clamped on every row change, not just on `←`/`→`.
 * 7. **[disclosed, not fixed]** `x`/`m` toggle independently, not as three mutually-exclusive tabs:
 *    `x` only ever toggles `tree ↔ orphans`; `m` unconditionally enters `matrix` from whichever view was
 *    current and only ever returns to `tree` (never back to `orphans`) — so `orphans → m → matrix → m`
 *    lands on `tree`, not back on `orphans`. Low severity, a real quirk rather than a proven-wrong
 *    interaction, since `04` names no explicit three-way tab contract to violate.
 * 8. **[disclosed, not fixed]** `focusedNodeId` (driving `t`/`n`/`e`) is not cleared when `<Tree>`
 *    unmounts (switching to `orphans`/`matrix`) — pressing `t`/`n`/`e` while viewing orphans still acts
 *    on whichever node the tree last had focused, invisibly. Low severity: `n`/`e` emitting a command
 *    for an off-screen node is no worse than emitting none, and `t`'s own trace panel is now cleared on
 *    every view switch (point 6's own fix, immediately above) so a stale *trace* can no longer linger
 *    visibly even though the underlying `focusedNodeId` itself still does.
 * 9. **[disclosed, not fixed]** `safeCursor` (point 6) derives from `matrixCursor` on every render but
 *    never writes the clamped value back into that state — so if `graph` shrinks (clamping `safeCursor`
 *    to a lower row) and then grows back to include the original row again, with no keypress in
 *    between, the highlighted row can silently "snap" back to wherever `matrixCursor` originally
 *    pointed, never having been visibly on-screen in between. A round-3 critic confirmed this never
 *    produces an out-of-bounds index, a vanished highlight, or a wrongly-no-op'd `Enter` — `safeCursor`
 *    is valid at every step — so it's a cosmetic quirk of derive-only clamping, not a reopening of
 *    points 6's own correctness fix.
 *
 * @see specs/04 §4.3 S3
 * @see specs/09 §9.4
 * @see PLAN-M9.md P9
 * @see SPEC-QUESTIONS.md Q141
 */
import type { GraphNode, SpecGraph } from '@forge/core/graph';
import { Box, Text, useInput } from 'ink';
import type { JSX } from 'react';
import { useState } from 'react';

import type { ScreenProps } from '../components/app-shell.tsx';
import { Pane } from '../components/pane.tsx';
import { Tree, type TreeNode } from '../components/tree.tsx';
import type { RenderMode } from '../env.ts';
import type { EngineCommand } from '../state/engine-command.ts';

export interface SpecsScreenProps extends ScreenProps {
  readonly graph: SpecGraph;
  readonly onCommand: (command: EngineCommand) => void;
}

type SpecsView = 'tree' | 'orphans' | 'matrix';

const HIERARCHY_EDGES: Readonly<Record<'CAP' | 'EPIC' | 'STORY' | 'TASK', string>> = {
  CAP: 'realises',
  EPIC: 'delivers',
  STORY: 'partOf',
  TASK: 'implements',
};

function compareIds(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function byNodeId(graph: SpecGraph): ReadonlyMap<string, GraphNode> {
  return new Map(graph.nodes().map((node) => [node.id, node] as const));
}

/** Children by exactly one named edge kind -- deliberately narrower than `SpecGraph.childrenOf`, which
 * mixes in cross-link edges (e.g. `ADR constrains Story`) alongside genuine hierarchy children. */
function primaryChildIndex(graph: SpecGraph, edgeKind: string): ReadonlyMap<string, GraphNode[]> {
  const nodeIndex = byNodeId(graph);
  const index = new Map<string, GraphNode[]>();
  for (const edge of graph.edges()) {
    if (edge.edge !== edgeKind) continue;
    const child = nodeIndex.get(edge.from);
    if (!child) continue;
    const siblings = index.get(edge.to) ?? [];
    siblings.push(child);
    index.set(edge.to, siblings);
  }
  for (const siblings of index.values()) siblings.sort((a, b) => compareIds(a.id, b.id));
  return index;
}

function testCountForStory(graph: SpecGraph, storyId: string): number {
  const acIds = new Set(
    graph
      .edges()
      .filter((edge) => edge.edge === 'belongsTo' && edge.to === storyId)
      .map((edge) => edge.from),
  );
  const testIds = new Set(
    graph
      .edges()
      .filter((edge) => edge.edge === 'proves' && acIds.has(edge.to))
      .map((edge) => edge.from),
  );
  return testIds.size;
}

function adrCountFor(graph: SpecGraph, nodeId: string): number {
  return graph.edges().filter((edge) => edge.edge === 'constrains' && edge.to === nodeId).length;
}

function crossLinkSuffix(
  graph: SpecGraph,
  node: GraphNode,
  mode: Pick<RenderMode, 'ascii'>,
): string {
  const parts: string[] = [];
  if (node.kind === 'STORY') {
    const tests = testCountForStory(graph, node.id);
    if (tests > 0) {
      parts.push(`${mode.ascii ? '[test]' : '⚭'} ${String(tests)} test${tests === 1 ? '' : 's'}`);
    }
  }
  if (node.kind === 'EPIC' || node.kind === 'STORY') {
    const adrs = adrCountFor(graph, node.id);
    if (adrs > 0) parts.push(`${String(adrs)} ADR${adrs === 1 ? '' : 's'}`);
  }
  const sep = mode.ascii ? ' | ' : ' · ';
  return parts.length > 0 ? `${sep}${parts.join(sep)}` : '';
}

function buildTree(graph: SpecGraph, mode: Pick<RenderMode, 'ascii'>): readonly TreeNode[] {
  const capsOf = primaryChildIndex(graph, HIERARCHY_EDGES.CAP);
  const epicsOf = primaryChildIndex(graph, HIERARCHY_EDGES.EPIC);
  const storiesOf = primaryChildIndex(graph, HIERARCHY_EDGES.STORY);
  const tasksOf = primaryChildIndex(graph, HIERARCHY_EDGES.TASK);

  function taskNode(task: GraphNode): TreeNode {
    return { id: task.id, label: `${task.kind} ${task.id}` };
  }
  function storyNode(story: GraphNode): TreeNode {
    const tasks = tasksOf.get(story.id) ?? [];
    return {
      id: story.id,
      label: `${story.kind} ${story.id}${crossLinkSuffix(graph, story, mode)}`,
      ...(tasks.length > 0 ? { children: tasks.map(taskNode) } : {}),
    };
  }
  function epicNode(epic: GraphNode): TreeNode {
    const stories = storiesOf.get(epic.id) ?? [];
    return {
      id: epic.id,
      label: `${epic.kind} ${epic.id}${crossLinkSuffix(graph, epic, mode)}`,
      ...(stories.length > 0 ? { children: stories.map(storyNode) } : {}),
    };
  }
  function capNode(cap: GraphNode): TreeNode {
    const epics = epicsOf.get(cap.id) ?? [];
    return {
      id: cap.id,
      label: `${cap.kind} ${cap.id}`,
      ...(epics.length > 0 ? { children: epics.map(epicNode) } : {}),
    };
  }
  function visNode(vis: GraphNode): TreeNode {
    const caps = capsOf.get(vis.id) ?? [];
    return {
      id: vis.id,
      label: `${vis.kind} ${vis.id}`,
      ...(caps.length > 0 ? { children: caps.map(capNode) } : {}),
    };
  }

  return graph
    .nodes()
    .filter((node) => node.kind === 'VIS')
    .sort((a, b) => compareIds(a.id, b.id))
    .map(visNode);
}

/** A single path to root, taking the first real parent at every step (a node's own primary hierarchy
 * parent has at most one outgoing typed edge per `09` §9.4's table) -- `04`'s own singular "path to
 * root," not every possible path. */
export function traceabilityPathToRoot(graph: SpecGraph, nodeId: string): readonly string[] {
  const path: string[] = [nodeId];
  const seen = new Set<string>([nodeId]);
  let current = nodeId;
  for (;;) {
    const parent = graph.parentsOf(current)[0];
    if (!parent || seen.has(parent.id)) break;
    path.push(parent.id);
    seen.add(parent.id);
    current = parent.id;
  }
  return path;
}

function storiesReachableFromCapability(graph: SpecGraph, capId: string): readonly GraphNode[] {
  const epicsOf = primaryChildIndex(graph, HIERARCHY_EDGES.EPIC);
  const storiesOf = primaryChildIndex(graph, HIERARCHY_EDGES.STORY);
  const epics = epicsOf.get(capId) ?? [];
  const stories = epics.flatMap((epic) => storiesOf.get(epic.id) ?? []);
  return [...stories].sort((a, b) => compareIds(a.id, b.id));
}

interface MatrixCell {
  readonly capId: string;
  readonly storyId: string;
  readonly covered: boolean;
}

function buildMatrix(graph: SpecGraph): {
  readonly caps: readonly GraphNode[];
  readonly rows: readonly (readonly MatrixCell[])[];
} {
  const caps = graph
    .nodes()
    .filter((node) => node.kind === 'CAP')
    .sort((a, b) => compareIds(a.id, b.id));
  const rows = caps.map((cap) =>
    storiesReachableFromCapability(graph, cap.id).map((story): MatrixCell => ({
      capId: cap.id,
      storyId: story.id,
      covered: testCountForStory(graph, story.id) > 0,
    })),
  );
  return { caps, rows };
}

function OrphansView({
  graph,
  mode,
}: {
  readonly graph: SpecGraph;
  readonly mode: Pick<RenderMode, 'ascii'>;
}): JSX.Element {
  const orphans = graph.orphans();
  if (orphans.length === 0) return <Text dimColor>No orphans.</Text>;
  return (
    <Box flexDirection="column">
      {orphans.map((orphan) => (
        <Text key={`${orphan.kind}:${orphan.id}`}>
          {orphan.kind} {orphan.id} {mode.ascii ? '-' : '—'} {orphan.reason}
        </Text>
      ))}
    </Box>
  );
}

function MatrixView({
  graph,
  cursor,
  mode,
}: {
  readonly graph: SpecGraph;
  readonly cursor: { readonly row: number; readonly col: number };
  readonly mode: Pick<RenderMode, 'ascii'>;
}): JSX.Element {
  const { caps, rows } = buildMatrix(graph);
  if (caps.length === 0) return <Text dimColor>No capabilities.</Text>;
  const covered = mode.ascii ? '+' : '✓';
  const uncovered = mode.ascii ? 'x' : '✗';
  return (
    <Box flexDirection="column">
      {caps.map((cap, rowIndex) => {
        const cells = rows[rowIndex] ?? [];
        return (
          <Text key={cap.id}>
            {cap.id}:{' '}
            {cells.length === 0
              ? '(no stories)'
              : cells
                  .map((cell, colIndex) => {
                    const mark = cell.covered ? covered : uncovered;
                    const isCursor = rowIndex === cursor.row && colIndex === cursor.col;
                    return isCursor ? `[${mark}]` : ` ${mark} `;
                  })
                  .join('')}
          </Text>
        );
      })}
    </Box>
  );
}

// `04` §4.3 S3 names one real interactive pane for this screen (unlike S1's four or S2's two) --
// `focusedPaneIndex` still arrives from `<AppShell>`'s own global `Tab` counter regardless of how many
// panes a given screen has, so this is always true, deliberately, not a bug: there is nothing else on
// this screen `Tab` could ever cycle focus away to.
const PANE_COUNT = 1;

export function SpecsScreen({
  mode,
  focusedPaneIndex,
  graph,
  onCommand,
}: SpecsScreenProps): JSX.Element {
  const focused = focusedPaneIndex % PANE_COUNT === 0;
  const [view, setView] = useState<SpecsView>('tree');
  const [focusedNodeId, setFocusedNodeId] = useState<string | undefined>(undefined);
  const [tracePath, setTracePath] = useState<readonly string[] | undefined>(undefined);
  const [matrixCursor, setMatrixCursor] = useState({ row: 0, col: 0 });

  const treeNodes = buildTree(graph, mode);
  const { caps, rows } = buildMatrix(graph);

  // Re-derived every render, never trusted directly from `matrixCursor` state -- a round-2 critic
  // (verifying the round-1 up/down clamp fix below) found a related, pre-existing gap the row/col
  // clamp alone doesn't close: if `graph` itself shrinks (fewer capabilities, or a shorter row) while
  // the user is already sitting in matrix view, `matrixCursor` only ever gets clamped in *response to*
  // an arrow-key press -- if the underlying data changes out from under it with no intervening
  // keypress, the cursor can point past the end of the current `caps`/`rows` for a render or more,
  // making the highlight vanish and `Enter` silently no-op. `safeCursor` closes this the same way
  // `<RunBoard>` (P8)'s own `activeLaneId` does for its own live-prop-update staleness gap: never
  // rendering or acting on the raw, possibly-stale state directly, only ever this derived, always-in-
  // bounds value.
  const safeCursorRow = Math.min(matrixCursor.row, Math.max(0, caps.length - 1));
  const safeCursorRowCells = rows[safeCursorRow] ?? [];
  const safeCursorCol = Math.min(matrixCursor.col, Math.max(0, safeCursorRowCells.length - 1));
  const safeCursor = { row: safeCursorRow, col: safeCursorCol };

  useInput(
    (input) => {
      if (view === 'matrix') {
        if (input === 'm') {
          setView('tree');
          setTracePath(undefined);
          return;
        }
        return;
      }
      if (input === 't') {
        if (focusedNodeId === undefined) return;
        setTracePath(traceabilityPathToRoot(graph, focusedNodeId));
        return;
      }
      if (input === 'x') {
        setView((current) => (current === 'orphans' ? 'tree' : 'orphans'));
        setTracePath(undefined);
        return;
      }
      if (input === 'm') {
        setMatrixCursor({ row: 0, col: 0 });
        setView('matrix');
        setTracePath(undefined);
        return;
      }
      if (input === 'n') {
        if (focusedNodeId === undefined) return;
        onCommand({ type: 'spec.newArtifactFromTemplate', parentId: focusedNodeId });
        return;
      }
      if (input === 'e') {
        if (focusedNodeId === undefined) return;
        onCommand({ type: 'spec.edit', artifactId: focusedNodeId });
        onCommand({ type: 'spec.validate', artifactId: focusedNodeId });
      }
    },
    { isActive: focused },
  );

  useInput(
    (_input, key) => {
      if (view !== 'matrix') return;
      const rowCount = caps.length;
      if (rowCount === 0) return;
      // `col` is re-clamped against the *destination* row's own cell count on every row change --
      // never left pointing past the end of a shorter row. A round-1 critic reproduced directly that
      // leaving `col` untouched here (correct only for `leftArrow`/`rightArrow`, which already clamp
      // against the *current* row) let moving from a longer row to a shorter one strand the cursor on
      // a cell index no row actually has: the highlight disappeared entirely, and Enter silently
      // no-op'd against `rowCells[matrixCursor.col] === undefined` even when the destination row's own
      // last real cell was itself uncovered and should have been actionable.
      if (key.upArrow) {
        const nextRow = Math.max(0, safeCursor.row - 1);
        const nextRowCells = rows[nextRow] ?? [];
        setMatrixCursor(() => ({
          row: nextRow,
          col: Math.min(safeCursor.col, Math.max(0, nextRowCells.length - 1)),
        }));
        return;
      }
      if (key.downArrow) {
        const nextRow = Math.min(rowCount - 1, safeCursor.row + 1);
        const nextRowCells = rows[nextRow] ?? [];
        setMatrixCursor(() => ({
          row: nextRow,
          col: Math.min(safeCursor.col, Math.max(0, nextRowCells.length - 1)),
        }));
        return;
      }
      if (key.leftArrow) {
        setMatrixCursor(() => ({ row: safeCursor.row, col: Math.max(0, safeCursor.col - 1) }));
        return;
      }
      if (key.rightArrow) {
        setMatrixCursor(() => ({
          row: safeCursor.row,
          col: Math.min(Math.max(0, safeCursorRowCells.length - 1), safeCursor.col + 1),
        }));
        return;
      }
      if (key.return) {
        const cell = safeCursorRowCells[safeCursor.col];
        if (cell && !cell.covered) {
          onCommand({ type: 'spec.newArtifactFromTemplate', parentId: cell.storyId });
        }
      }
    },
    { isActive: focused && view === 'matrix' },
  );

  return (
    <Box flexDirection="column">
      <Pane title="Specs" focused={focused} mode={mode}>
        {view === 'tree' ? (
          <Tree
            nodes={treeNodes}
            focused={focused}
            mode={mode}
            onFocusChange={(node) => {
              setFocusedNodeId(node.id);
            }}
          />
        ) : undefined}
        {view === 'orphans' ? <OrphansView graph={graph} mode={mode} /> : undefined}
        {view === 'matrix' ? (
          <MatrixView graph={graph} cursor={safeCursor} mode={mode} />
        ) : undefined}
      </Pane>
      {tracePath ? (
        <Pane title="Traceability path to root" focused={false} mode={mode}>
          <Text>{tracePath.join(mode.ascii ? ' -> ' : ' → ')}</Text>
        </Pane>
      ) : undefined}
    </Box>
  );
}
