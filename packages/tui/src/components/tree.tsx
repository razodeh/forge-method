/**
 * `<Tree>` — `04` §4.5's own collapsible tree with lazy children (`04` §4.3's own "S3 lazy children"
 * need, e.g. a Story's own Tasks not fetched until expanded).
 *
 * A node's own `children` may be a plain, already-known array, or a `() => Promise<readonly
 * TreeNode[]>` loader -- the lazy form is invoked at most once per node: the loaded result is cached,
 * so collapsing and re-expanding the same node never re-fetches it. A node currently loading renders a
 * `running` `<StatusGlyph>` in its own place until the promise settles.
 *
 * Keyboard nav mirrors `<ListPane>`'s own vertical motion (`↑↓`/`j k` move the focused node across the
 * flattened, currently-visible node list) plus `04` §4.2's own `←→`/`h l` collapse/expand keys, which
 * `<ListPane>` itself has no use for (a flat list has nothing to collapse). `g`/`G`/`/`-filter are
 * `<ListPane>`-only: a tree's own "visible set" already changes shape on every expand/collapse, and
 * neither op has an established meaning here yet -- deferred rather than guessed at.
 *
 * A rejected lazy loader is caught, not left as an unhandled rejection: a fresh critic round reproduced
 * directly that an unhandled `.then()` (no `.catch`) left a node showing `running` forever on a real
 * fetch failure, with no way to ever retry it. The node instead collapses back and renders a `fail`
 * `<StatusGlyph>` in its own place; pressing `→` again retries the same loader (it was never cached,
 * since caching only ever happens on success).
 *
 * `expanded`/`loadedChildren`/`loading`/`failed` are all keyed by `node.id` alone, scoped to one `Tree`
 * instance's own lifetime -- **not** to the specific `nodes` array currently passed in. A fresh critic
 * round reproduced directly that re-rendering the *same* `<Tree>` element with a genuinely different
 * `nodes` prop that happens to reuse an id (e.g. switching from one project's spec graph to another's,
 * built by a generic id scheme) silently shows the *previous* project's cached children under the new
 * one's label, and never calls the new project's own loader at all. This is the identical "does an
 * existing instance detect a real underlying-dataset swap" question `EngineClient` (`state/
 * engine-client.ts`) already answered as a caller-lifecycle concern, not something safe to guess at
 * with a heuristic (`SPEC-QUESTIONS.md` Q133's own "go with B" resolution) -- resolved the same way
 * here: **a caller switching `<Tree>` to a genuinely different dataset that might reuse ids must give
 * it a distinct `key` prop**, so React remounts a fresh instance with fresh state, exactly the ordinary
 * "list item identity" contract `key` already exists for. Reusing a `nodes` identity for the *same*
 * logical tree, or forever growing/lazily-populating one dataset's own ids, is unaffected either way.
 *
 * @see specs/04 §4.2, §4.3, §4.5
 * @see PLAN-M9.md P3
 */
import { Box, Text, useInput } from 'ink';
import type { JSX } from 'react';
import { useState } from 'react';

import type { RenderMode } from '../env.ts';
import { StatusGlyph } from './status-glyph.tsx';

export type TreeChildren = readonly TreeNode[] | (() => Promise<readonly TreeNode[]>);

export interface TreeNode {
  readonly id: string;
  readonly label: string;
  readonly children?: TreeChildren;
}

export interface TreeProps {
  readonly nodes: readonly TreeNode[];
  readonly focused: boolean;
  readonly mode: Pick<RenderMode, 'ascii' | 'color'>;
}

interface FlatRow {
  readonly node: TreeNode;
  readonly depth: number;
}

function isLazy(children: TreeChildren): children is () => Promise<readonly TreeNode[]> {
  return typeof children === 'function';
}

function flatten(
  nodes: readonly TreeNode[],
  expanded: ReadonlySet<string>,
  loadedChildren: ReadonlyMap<string, readonly TreeNode[]>,
  depth: number,
): readonly FlatRow[] {
  const rows: FlatRow[] = [];
  for (const node of nodes) {
    rows.push({ node, depth });
    if (!expanded.has(node.id)) continue;
    const resolvedChildren = node.children ?? [];
    const childNodes = isLazy(resolvedChildren)
      ? (loadedChildren.get(node.id) ?? [])
      : resolvedChildren;
    rows.push(...flatten(childNodes, expanded, loadedChildren, depth + 1));
  }
  return rows;
}

export function Tree({ nodes, focused, mode }: TreeProps): JSX.Element {
  const [focusedId, setFocusedId] = useState<string | undefined>(nodes[0]?.id);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [loadedChildren, setLoadedChildren] = useState<ReadonlyMap<string, readonly TreeNode[]>>(
    new Map(),
  );
  const [loading, setLoading] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());

  const rows = flatten(nodes, expanded, loadedChildren, 0);
  const focusedRowIndex = rows.findIndex((row) => row.node.id === focusedId);

  function withoutId(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
    if (!set.has(id)) return set;
    const next = new Set(set);
    next.delete(id);
    return next;
  }

  function expandNode(node: TreeNode): void {
    if (node.children === undefined) return;
    setFailed((current) => withoutId(current, node.id));
    setExpanded((current) => new Set(current).add(node.id));
    if (!isLazy(node.children) || loadedChildren.has(node.id) || loading.has(node.id)) return;
    const loader = node.children;
    setLoading((current) => new Set(current).add(node.id));
    void loader()
      .then((children) => {
        setLoadedChildren((current) => new Map(current).set(node.id, children));
        setLoading((current) => withoutId(current, node.id));
      })
      .catch(() => {
        setLoading((current) => withoutId(current, node.id));
        setFailed((current) => new Set(current).add(node.id));
        setExpanded((current) => withoutId(current, node.id));
      });
  }

  function collapseNode(node: TreeNode): void {
    setExpanded((current) => {
      const next = new Set(current);
      next.delete(node.id);
      return next;
    });
  }

  useInput(
    (input, key) => {
      if (rows.length === 0) return;
      if (key.upArrow || input === 'k') {
        const nextIndex = Math.max(0, focusedRowIndex - 1);
        setFocusedId(rows[nextIndex]?.node.id);
        return;
      }
      if (key.downArrow || input === 'j') {
        const nextIndex = Math.min(rows.length - 1, focusedRowIndex + 1);
        setFocusedId(rows[nextIndex]?.node.id);
        return;
      }
      const focusedRow = rows[focusedRowIndex];
      if (!focusedRow) return;
      if (key.rightArrow || input === 'l') {
        expandNode(focusedRow.node);
        return;
      }
      if (key.leftArrow || input === 'h') {
        collapseNode(focusedRow.node);
      }
    },
    { isActive: focused },
  );

  return (
    <Box flexDirection="column">
      {rows.map(({ node, depth }) => {
        const hasChildren = node.children !== undefined;
        const isExpanded = expanded.has(node.id);
        const isLoading = loading.has(node.id);
        const hasFailed = failed.has(node.id);
        const expandedGlyph = mode.ascii ? 'v' : '▾';
        const collapsedGlyph = mode.ascii ? '>' : '▸';
        const indicator = hasChildren ? (isExpanded ? expandedGlyph : collapsedGlyph) : ' ';
        return (
          <Text key={node.id} inverse={node.id === focusedId}>
            {'  '.repeat(depth)}
            {indicator} {node.label}
            {isLoading ? <StatusGlyph state="running" mode={mode} /> : undefined}
            {hasFailed ? <StatusGlyph state="fail" mode={mode} /> : undefined}
          </Text>
        );
      })}
    </Box>
  );
}
