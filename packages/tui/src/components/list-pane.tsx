/**
 * `<ListPane>` — `04` §4.5's own virtualised list with selection, filter, keyboard nav. Every
 * "browse a collection" screen (S2-S6) composes this rather than re-implementing scrolling/selection
 * on its own; the screen wires the *meaning* of a selection (`onSelect`), this component owns the
 * *motion* (`04` §4.3).
 *
 * Virtualisation is real: only the visible window (`height` rows) plus a small overscan is ever
 * rendered, regardless of `items.length` -- `04` §4.1's own 2000-line ring-buffer budget makes a naive
 * full-list render a real, reachable cost, not a hypothetical one. `height` is an explicit prop, not
 * measured from the terminal: `<ListPane>` has no way to know how many rows its own caller has actually
 * given it (Ink has no element-measurement API), so the owning screen/`<Pane>` supplies it, the same way
 * `<Pane>`'s own scroll indicator is caller-supplied rather than self-measured.
 *
 * Selection is tracked by the selected item's own id (via `getId`), not by a raw numeric index -- a
 * fresh critic round reproduced directly that a numeric-index model silently re-points at the wrong
 * *item* the moment `items` itself changes shape while something is selected (e.g. an earlier item is
 * removed from a live-updating list): the index stayed valid but the item it now pointed at was never
 * the one the user actually selected. Movement keys resolve the current index from the selected id
 * against `visibleItems` on every keystroke, so a genuinely resized/reordered `items` array always
 * keeps (or, if the selected item is gone entirely, sanely re-anchors) the right selection instead of
 * a numerically-adjacent one.
 *
 * Global keys (`04` §4.2), active only while `focused`:
 * - `↑↓`/`j k` move the selection by one row, clamped to the item list.
 * - `g` then `g` jumps to the top; `G` (shift+g) jumps to the bottom directly.
 * - `/` opens (or re-opens) an inline filter that narrows `items` live by `getFilterText`; `Esc`
 *   cancels it, restoring the full, unfiltered list and the selection active before filtering opened;
 *   `Enter` commits the filter text typed so far and returns to ordinary browsing over the narrowed
 *   set (further `↑↓`/`j k`/`g`/`G` move within it, rather than continuing to edit the filter text).
 * - `Enter` (outside filter-editing mode) invokes `onSelect` with the currently selected item.
 *
 * A default row renderer is exported separately (`defaultListItemLabel`) rather than baked into this
 * component, composing `<StatusGlyph>` for the common "label + one of the 8 canonical states" case --
 * `PLAN-M9.md` P3's own "Depends on: P2 (`<StatusGlyph>` used inside default `renderItem`)" note, kept
 * as an opt-in helper since most real screens need a bespoke row layout, not this one shape.
 *
 * @see specs/04 §4.1, §4.2, §4.3, §4.5
 * @see PLAN-M9.md P3
 */
import { Box, Text, useInput } from 'ink';
import type { JSX, ReactNode } from 'react';
import { useMemo, useState } from 'react';

import type { RenderMode } from '../env.ts';
import { type StatusState, StatusGlyph } from './status-glyph.tsx';

/** Rows rendered above/below the visible window so a fast scroll never shows a blank flash before the
 * next tick's render catches up -- a real, if small, real-terminal-scrolling concern, not padding for
 * its own sake. */
const OVERSCAN = 2;

export interface ListPaneProps<T> {
  readonly items: readonly T[];
  readonly getId: (item: T) => string;
  readonly getFilterText: (item: T) => string;
  readonly renderItem: (item: T, selected: boolean) => ReactNode;
  readonly onSelect?: (item: T) => void;
  readonly focused: boolean;
  readonly height: number;
}

export function defaultListItemLabel(
  label: string,
  state: StatusState | undefined,
  mode: Pick<RenderMode, 'ascii' | 'color'>,
): JSX.Element {
  if (state === undefined) return <Text>{label}</Text>;
  return (
    <Text>
      <StatusGlyph state={state} mode={mode} /> {label}
    </Text>
  );
}

export function ListPane<T>({
  items,
  getId,
  getFilterText,
  renderItem,
  onSelect,
  focused,
  height,
}: ListPaneProps<T>): JSX.Element {
  const [selectedId, setSelectedId] = useState<string | undefined>(() => {
    const first = items[0];
    return first ? getId(first) : undefined;
  });
  const [filterQuery, setFilterQuery] = useState<string | undefined>(undefined);
  const [isEditingFilter, setIsEditingFilter] = useState(false);
  const [pendingG, setPendingG] = useState(false);
  const [preFilterSelectedId, setPreFilterSelectedId] = useState<string | undefined>(undefined);

  const visibleItems = useMemo(() => {
    if (filterQuery === undefined) return items;
    const needle = filterQuery.toLowerCase();
    return items.filter((item) => getFilterText(item).toLowerCase().includes(needle));
  }, [items, filterQuery, getFilterText]);

  const resolvedIndex =
    selectedId === undefined ? -1 : visibleItems.findIndex((item) => getId(item) === selectedId);
  const clampedIndex = resolvedIndex === -1 ? 0 : resolvedIndex;

  function selectAt(index: number): void {
    const target = visibleItems[Math.max(0, Math.min(visibleItems.length - 1, index))];
    if (target) setSelectedId(getId(target));
  }

  function cancelFilter(): void {
    setFilterQuery(undefined);
    setIsEditingFilter(false);
    setSelectedId(preFilterSelectedId);
  }

  useInput(
    (input, key) => {
      if (isEditingFilter) {
        if (key.escape) {
          cancelFilter();
          return;
        }
        if (key.return) {
          setIsEditingFilter(false);
          return;
        }
        if (key.backspace || key.delete) {
          setFilterQuery((current) => (current ?? '').slice(0, -1));
          return;
        }
        if (input.length > 0) {
          setFilterQuery((current) => (current ?? '') + input);
        }
        return;
      }

      if (key.escape && filterQuery !== undefined) {
        cancelFilter();
        return;
      }
      if (input === '/') {
        setPreFilterSelectedId(selectedId);
        setFilterQuery((existing) => existing ?? '');
        setIsEditingFilter(true);
        return;
      }
      if (key.upArrow || input === 'k') {
        selectAt(clampedIndex - 1);
        setPendingG(false);
        return;
      }
      if (key.downArrow || input === 'j') {
        selectAt(clampedIndex + 1);
        setPendingG(false);
        return;
      }
      if (input === 'g') {
        if (pendingG) {
          selectAt(0);
          setPendingG(false);
        } else {
          setPendingG(true);
        }
        return;
      }
      if (input === 'G') {
        selectAt(visibleItems.length - 1);
        setPendingG(false);
        return;
      }
      if (key.return) {
        const current = visibleItems[clampedIndex];
        if (onSelect && current) onSelect(current);
      }
      setPendingG(false);
    },
    { isActive: focused },
  );

  const scrollOffset = Math.max(
    0,
    Math.min(clampedIndex - Math.floor(height / 2), Math.max(0, visibleItems.length - height)),
  );
  const windowStart = Math.max(0, scrollOffset - OVERSCAN);
  const windowEnd = Math.min(visibleItems.length, scrollOffset + height + OVERSCAN);
  const visibleWindow = visibleItems.slice(windowStart, windowEnd);

  return (
    <Box flexDirection="column">
      {isEditingFilter ? <Text>/{filterQuery}</Text> : undefined}
      {visibleWindow.map((item, offset) => {
        const index = windowStart + offset;
        return <Box key={getId(item)}>{renderItem(item, index === clampedIndex)}</Box>;
      })}
    </Box>
  );
}
