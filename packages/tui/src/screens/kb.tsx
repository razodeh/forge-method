/**
 * `<KbScreen>` — `04` §4.3 S4: the Knowledge Body section tree, entry viewer, contradictions/stale
 * filters, and diagram affordances. Composes `<Tree>` (P3), `<KeyValue>` (P2), `<DiffView>` (P4),
 * `<Modal>`/`<QuestionForm>` (P5) over `@forge/kb`'s own already-built `KB_SECTIONS`/`KbEntry`/
 * `KbFinding` types (M3).
 *
 * Real design decisions, recorded fully in `SPEC-QUESTIONS.md` Q142:
 *
 * 1. **`PLAN-M9.md` P10's own literal section list is wrong against the real, already-committed
 *    `@forge/kb` section set.** Its Surface text names `product/architecture/data/delivery/ops/domain/
 *    decisions/constraints/glossary` — but `@forge/kb/schema`'s real `KB_SECTIONS` is
 *    `product/constraints/architecture/domain/data/delivery/ops/engineering/glossary` (`engineering`,
 *    not `decisions` — there is no `decisions` KB section anywhere in this codebase; ADRs are their own
 *    document kind, not a KB section). This screen renders the real, imported `KB_SECTIONS` array
 *    directly, never a hand-transcribed literal list — the identical "trust the already-built code over
 *    the plan's own prose" correction `PLAN-M9.md` P1 (`SPEC-QUESTIONS.md` Q133) already established.
 * 2. No `RunReadModel` field, and no `@forge/kb` API, carries a ready-made "used by" back-reference
 *    list, a write-history log, or a diagram's own caption/alt-text/before-after-diff — all caller-
 *    supplied facts, the same pattern `<HomeScreen>` (P7), `<RunBoard>` (P8), and `<SpecsScreen>` (P9)
 *    already established. "Used by" is computed here, locally, from the full `entries` list's own
 *    `related`/`applies_to`/`supersedes` arrays (`kbEntrySchema`'s own real fields) — never invented.
 * 3. `c`/`s` (contradictions/stale) filter the section tree **in place** — hiding non-matching entries
 *    and annotating each section's own row with a real, computed `(N)` count — rather than replacing
 *    the tree with a flat list the way `<SpecsScreen>` (P9)'s own `x` (orphans) does, matching this
 *    piece's own Check text ("correctly counted in the section tree's own badge") literally.
 * 4. `/` (search), `v` (mark-verified), and `a` (new-ADR) each emit exactly one real `EngineCommand`
 *    (`kb.search`/`kb.markVerified`/`kb.newAdr`). `c`/`s` (filters) are pure, local view concerns
 *    reachable at all times, regardless of whether an entry is currently focused — the identical
 *    reasoning `<RunBoard>` (P8) and `<SpecsScreen>` (P9) already established for their own view-only
 *    keys. `w` (write-history toggle) and `D` (diagram-diff toggle) are *also* pure, local view
 *    concerns, but — unlike `c`/`s` — genuinely require a focused entry (there is nothing to toggle a
 *    view *of* otherwise) and so, correctly, share `v`/`a`'s own `activeEntry === undefined` guard, not
 *    `c`/`s`'s unconditional reachability. `showWriteHistory`/`showDiagramDiff` are screen-level state,
 *    not reset per-entry — toggling `w` on while viewing one entry and then navigating to a different
 *    one keeps the write-history view showing (now for the new entry), the identical "sticky viewer
 *    mode" precedent `<RunBoard>` (P8)'s own `activeTab` already established for lane switches.
 * 5. `o` (open diagrams in browser) is `04` §4.3 S4's own explicitly named exception to "the TUI never
 *    causes side effects itself" — routed through an injected `onOpenDiagram` callback prop (this
 *    codebase's own established "inject the real dependency" convention, `EngineClient`'s own
 *    `readEvents` option), never through the `EngineCommand` union: there is no real engine-side action
 *    to name for "open a URL in a local browser," only a real, local side effect to delegate.
 * 6. The search flow re-uses `<QuestionForm>` (P5), exactly as `<RunBoard>` (P8)'s own interject flow
 *    does — including applying the lesson P8's own 3-round critic saga already paid for: every
 *    `useInput`/`focused` prop this file itself owns or passes to a composed child is gated
 *    `&& !searchOpen` from the outset, not discovered round-by-round.
 * 7. `activeEntry` re-checks the *current* `view` filter, not just `entries` — a round-1 critic
 *    reproduced directly that `<Tree>`'s own `onFocusChange` effect never fires when the focused row
 *    simply vanishes from its own flattened rows (its guard is `if (focusedNode) onFocusChange?.(...)`,
 *    and a node the active filter just excluded has no row to be `focusedNode` at all) — so toggling
 *    `c`/`s` while focused on an entry the new filter excludes used to leave `focusedEntryId` pointing
 *    at an entry that was still real but no longer visible or highlighted anywhere in the tree, with the
 *    detail pane silently continuing to show its full front matter regardless. Re-checking
 *    `entryMatchesView` inside `activeEntry`'s own derivation closes this structurally.
 *
 * @see specs/04 §4.3 S4
 * @see specs/08 §8.2, §8.3
 * @see PLAN-M9.md P10
 * @see SPEC-QUESTIONS.md Q142
 */
import { KB_SECTIONS, type KbEntry, type KbSection } from '@forge/kb/schema';
import type { KbFinding } from '@forge/kb/lint';
import { Box, Text, useInput } from 'ink';
import type { JSX } from 'react';
import { useState } from 'react';

import type { ScreenProps } from '../components/app-shell.tsx';
import { DiffView } from '../components/diff-view.tsx';
import { KeyValue, type KeyValueRow } from '../components/key-value.tsx';
import { Modal } from '../components/modal.tsx';
import { Pane } from '../components/pane.tsx';
import { type Answer, QuestionForm } from '../components/question-form.tsx';
import { Tree, type TreeNode } from '../components/tree.tsx';
import type { EngineCommand } from '../state/engine-command.ts';

export interface KbDiagramSummary {
  readonly id: string;
  readonly source: string;
  readonly caption: string;
  readonly altText: string;
  /** Present only when the entry's own diagram changed in the current run -- `D` toggles showing it. */
  readonly diffPatch?: string;
}

export interface KbWriteHistoryEntry {
  readonly ts: string;
  readonly summary: string;
}

export interface KbScreenProps extends ScreenProps {
  readonly entries: readonly KbEntry[];
  readonly findings: readonly KbFinding[];
  readonly diagramsByEntryId: ReadonlyMap<string, readonly KbDiagramSummary[]>;
  readonly writeHistoryByEntryId: ReadonlyMap<string, readonly KbWriteHistoryEntry[]>;
  readonly onCommand: (command: EngineCommand) => void;
  readonly onOpenDiagram: (diagramId: string) => void;
}

type KbFilterView = 'all' | 'contradictions' | 'stale';

const PANE_COUNT = 2;
const TREE_PANE_INDEX = 0;
const DETAIL_PANE_INDEX = 1;

function findingRuleForView(view: KbFilterView): KbFinding['ruleId'] | undefined {
  if (view === 'contradictions') return 'kb:contradiction';
  if (view === 'stale') return 'kb:staleness';
  return undefined;
}

function entryMatchesView(
  entry: KbEntry,
  view: KbFilterView,
  findings: readonly KbFinding[],
): boolean {
  const rule = findingRuleForView(view);
  if (rule === undefined) return true;
  return findings.some((finding) => finding.ruleId === rule && finding.entryId === entry.id);
}

function buildKbTree(
  entries: readonly KbEntry[],
  findings: readonly KbFinding[],
  view: KbFilterView,
): readonly TreeNode[] {
  return KB_SECTIONS.map((section: KbSection): TreeNode => {
    const sectionEntries = entries
      .filter((entry) => entry.section === section)
      .filter((entry) => entryMatchesView(entry, view, findings))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const badge =
      sectionEntries.length > 0 && view !== 'all' ? ` (${String(sectionEntries.length)})` : '';
    return {
      id: section,
      label: `${section}${badge}`,
      ...(sectionEntries.length > 0
        ? {
            children: sectionEntries.map((entry): TreeNode => ({
              id: entry.id,
              label: `${entry.id} ${entry.title}`,
            })),
          }
        : {}),
    };
  });
}

function usedBy(entries: readonly KbEntry[], entryId: string): readonly KbEntry[] {
  return entries
    .filter(
      (entry) =>
        entry.id !== entryId &&
        (entry.related.includes(entryId) ||
          entry.applies_to.includes(entryId) ||
          entry.supersedes.includes(entryId)),
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function EntryDetail({
  entry,
  entries,
  diagrams,
  writeHistory,
  showWriteHistory,
  showDiagramDiff,
  mode,
}: {
  readonly entry: KbEntry | undefined;
  readonly entries: readonly KbEntry[];
  readonly diagrams: readonly KbDiagramSummary[];
  readonly writeHistory: readonly KbWriteHistoryEntry[];
  readonly showWriteHistory: boolean;
  readonly showDiagramDiff: boolean;
  readonly mode: ScreenProps['mode'];
}): JSX.Element {
  if (!entry) return <Text dimColor>No entry selected.</Text>;

  const dash = mode.ascii ? '-' : '—';
  const diagramGlyph = mode.ascii ? '[#]' : '⬚';

  if (showWriteHistory) {
    return (
      <Box flexDirection="column">
        <Text bold>
          {entry.id} {dash} write history
        </Text>
        {writeHistory.length === 0 ? (
          <Text dimColor>No write history.</Text>
        ) : (
          writeHistory.map((record, index) => (
            <Text key={`${record.ts}:${String(index)}`}>
              {record.ts} {record.summary}
            </Text>
          ))
        )}
      </Box>
    );
  }

  const rows: KeyValueRow[] = [
    { key: 'type', value: entry.type },
    { key: 'status', value: entry.status },
    { key: 'confidence', value: entry.confidence },
    { key: 'owner', value: entry.owner },
    { key: 'updated', value: entry.updated },
    { key: 'review by', value: entry.review_by },
    { key: 'last verified', value: entry.verified ?? dash },
  ];
  const backlinks = usedBy(entries, entry.id);

  return (
    <Box flexDirection="column">
      <Text bold>{entry.title}</Text>
      <KeyValue rows={rows} />
      <Text>
        sources: {entry.sources.map((source) => `${source.kind}:${source.ref}`).join(', ') || dash}
      </Text>
      <Text>used by: {backlinks.length > 0 ? backlinks.map((e) => e.id).join(', ') : dash}</Text>
      <Text>
        {diagramGlyph} {String(diagrams.length)} diagrams
      </Text>
      {diagrams.map((diagram) => (
        <Box flexDirection="column" key={diagram.id}>
          <Text dimColor>
            {diagram.id}: {diagram.caption} (alt: {diagram.altText})
          </Text>
          {showDiagramDiff && diagram.diffPatch !== undefined ? (
            <DiffView patch={diagram.diffPatch} mode={mode} />
          ) : undefined}
        </Box>
      ))}
    </Box>
  );
}

export function KbScreen({
  mode,
  focusedPaneIndex,
  entries,
  findings,
  diagramsByEntryId,
  writeHistoryByEntryId,
  onCommand,
  onOpenDiagram,
}: KbScreenProps): JSX.Element {
  const focusedPane = focusedPaneIndex % PANE_COUNT;
  const [view, setView] = useState<KbFilterView>('all');
  const [focusedEntryId, setFocusedEntryId] = useState<string | undefined>(undefined);
  const [showWriteHistory, setShowWriteHistory] = useState(false);
  const [showDiagramDiff, setShowDiagramDiff] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const treeNodes = buildKbTree(entries, findings, view);

  // Re-derived every render, never trusted from state directly -- the same "never act on a possibly-
  // stale id" discipline `<RunBoard>` (P8)'s own `activeLaneId` and `<SpecsScreen>` (P9)'s own
  // `safeCursor` already established for an analogous class of staleness. Also re-checked against the
  // *current* `view` filter, not just against `entries` -- a round-1 critic reproduced directly that
  // `<Tree>`'s own `onFocusChange` effect (`tree.tsx`) never fires at all when the focused row simply
  // vanishes from its flattened `rows` (its own guard is `if (focusedNode) onFocusChange?.(...)`, and a
  // node the active filter just excluded has no row to be `focusedNode` at all) -- so toggling `c`/`s`
  // while focused on an entry the new filter excludes left `focusedEntryId` pointing at an entry that
  // was still real (present in `entries`) but no longer visible or highlighted anywhere in the tree,
  // with the detail pane silently continuing to show its full front matter regardless. Re-checking
  // `entryMatchesView` here closes it structurally: the moment the active filter would hide a node, this
  // screen's own idea of "the active entry" agrees with what `<Tree>` visually shows, without needing
  // `<Tree>` itself to notify anyone of a disappearance it has no way to represent as "the new focus".
  const activeEntry =
    focusedEntryId === undefined
      ? undefined
      : entries.find(
          (entry) => entry.id === focusedEntryId && entryMatchesView(entry, view, findings),
        );
  const activeDiagrams =
    activeEntry === undefined ? [] : (diagramsByEntryId.get(activeEntry.id) ?? []);
  const activeWriteHistory =
    activeEntry === undefined ? [] : (writeHistoryByEntryId.get(activeEntry.id) ?? []);

  function handleSearchAnswer(answer: Answer): void {
    setSearchOpen(false);
    if (answer.kind !== 'text' || answer.value.length === 0) return;
    onCommand({ type: 'kb.search', query: answer.value });
  }

  useInput(
    (input) => {
      if (input === 'c') {
        setView((current) => (current === 'contradictions' ? 'all' : 'contradictions'));
        return;
      }
      if (input === 's') {
        setView((current) => (current === 'stale' ? 'all' : 'stale'));
        return;
      }
      if (input === '/') {
        setSearchOpen(true);
        return;
      }
      if (activeEntry === undefined) return;
      if (input === 'v') {
        onCommand({ type: 'kb.markVerified', entryId: activeEntry.id });
        return;
      }
      if (input === 'a') {
        onCommand({ type: 'kb.newAdr', contextEntryId: activeEntry.id });
        return;
      }
      if (input === 'w') {
        setShowWriteHistory((current) => !current);
        return;
      }
      if (input === 'D') {
        setShowDiagramDiff((current) => !current);
        return;
      }
      if (input === 'o') {
        for (const diagram of activeDiagrams) onOpenDiagram(diagram.id);
      }
    },
    // Active regardless of which of the two panes currently has focus, gated only by `!searchOpen` --
    // unlike `<RunBoard>` (P8) or `<ListPane>` itself, `<Tree>` (P3) has no `/`-filter-editing mode or
    // any other free-text-capture state that these letter keys (`c`/`s`/`v`/`a`/`w`/`D`/`o`) or `/`
    // could ever collide with; its own `useInput` only ever consumes arrows/`j`/`k`/`h`/`l`. Gating this
    // to the detail pane only, the way P8's lane-action keys correctly had to, would have been a wrong
    // transplant of that piece's own real reason (a real collision with `<ListPane>`'s own filter mode)
    // onto a component that has no such mode to collide with.
    { isActive: !searchOpen },
  );

  return (
    <Box flexDirection="column">
      <Box>
        <Pane title="Knowledge Body" focused={focusedPane === TREE_PANE_INDEX} mode={mode}>
          <Tree
            nodes={treeNodes}
            focused={focusedPane === TREE_PANE_INDEX && !searchOpen}
            mode={mode}
            onFocusChange={(node) => {
              // A section header row's own id never matches a real entry -- explicitly clears back to
              // `undefined` in that case, rather than leaving the previously-focused entry's own detail
              // stale on screen while the tree's own highlight has visibly moved off of it.
              setFocusedEntryId(
                entries.some((entry) => entry.id === node.id) ? node.id : undefined,
              );
            }}
          />
        </Pane>
        <Pane title="Entry" focused={focusedPane === DETAIL_PANE_INDEX} mode={mode}>
          <EntryDetail
            entry={activeEntry}
            entries={entries}
            diagrams={activeDiagrams}
            writeHistory={activeWriteHistory}
            showWriteHistory={showWriteHistory}
            showDiagramDiff={showDiagramDiff}
            mode={mode}
          />
        </Pane>
      </Box>
      <Modal
        open={searchOpen}
        onClose={() => {
          setSearchOpen(false);
        }}
      >
        <QuestionForm
          questions={[{ id: 'kb-search', kind: 'text', prompt: 'Search the Knowledge Body:' }]}
          onAnswer={handleSearchAnswer}
          focused={searchOpen}
        />
      </Modal>
    </Box>
  );
}
