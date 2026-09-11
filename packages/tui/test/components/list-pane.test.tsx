/**
 * `<ListPane>` -- `04` §4.1/§4.3/§4.5's own virtualised list: selection, filter, keyboard nav.
 *
 * Every keystroke goes through `press()`, which flushes a tick after writing to the fake stdin. Two
 * distinct reasons this is necessary, not merely cautious: (1) `useInput`'s own effect (which attaches
 * the fake stdin's `readable` listener via `setRawMode(true)`) runs asynchronously after the initial
 * commit, so writing before the very first flush is silently dropped; (2) this component's `useInput`
 * callback is a fresh closure every render (it branches directly on `isEditingFilter`, not via a
 * functional state updater), so React's own effect-dependency-driven resubscription must complete
 * before a *later* keystroke can be seen by the *updated* closure -- reproduced directly: sending `/`
 * then `item-1` back-to-back with no flush between them left the second write processed by the still-
 * subscribed pre-`/` handler, which read `isEditingFilter` as still `false` and silently ignored it as
 * an ordinary (unmapped) browse key instead of typing it into the filter.
 *
 * @see specs/04 §4.1, §4.3, §4.5
 * @see PLAN-M9.md P3
 */
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { describe, expect, it, vi } from 'vitest';

import { defaultListItemLabel, ListPane } from '../../src/components/list-pane.tsx';

const UP = '\x1B[A';
const DOWN = '\x1B[B';
const ESC = '\x1B';
const ENTER = '\r';
const BACKSPACE = '\x7F';

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

interface StdinLike {
  write(data: string): void;
}

async function press(stdin: StdinLike, data: string): Promise<void> {
  stdin.write(data);
  await flush();
}

interface Item {
  readonly id: string;
  readonly label: string;
}

function items(count: number): Item[] {
  return Array.from({ length: count }, (_, index) => ({
    id: String(index),
    label: `item-${String(index)}`,
  }));
}

async function renderList(props: {
  data: readonly Item[];
  height: number;
  focused?: boolean;
  onSelect?: (item: Item) => void;
}) {
  const onSelectProp = props.onSelect ? { onSelect: props.onSelect } : {};
  const result = render(
    <ListPane
      items={props.data}
      getId={(item) => item.id}
      getFilterText={(item) => item.label}
      renderItem={(item, selected) => (
        <Text>{selected ? `> ${item.label}` : `  ${item.label}`}</Text>
      )}
      focused={props.focused ?? true}
      height={props.height}
      {...onSelectProp}
    />,
  );
  await flush();
  return result;
}

describe('ListPane', () => {
  it('a real 5000-item list renders a bounded number of lines -- virtualisation is real, not a naive full-list render', async () => {
    const { lastFrame } = await renderList({ data: items(5000), height: 10 });
    const lines = (lastFrame() ?? '').split('\n').filter((line) => line.trim().length > 0);
    // height (10) + overscan (2 above/below), never anywhere near 5000.
    expect(lines.length).toBeLessThanOrEqual(14);
    expect(lines.length).toBeGreaterThan(0);
  });

  it('renders the first item selected by default', async () => {
    const { lastFrame } = await renderList({ data: items(5), height: 10 });
    expect(lastFrame()).toContain('> item-0');
  });

  it('a scripted ↑↓ g G key sequence moves the selection exactly as expected at each step', async () => {
    const { lastFrame, stdin } = await renderList({ data: items(20), height: 10 });

    await press(stdin, DOWN);
    expect(lastFrame()).toContain('> item-1');

    await press(stdin, DOWN);
    expect(lastFrame()).toContain('> item-2');

    await press(stdin, UP);
    expect(lastFrame()).toContain('> item-1');

    await press(stdin, 'G');
    expect(lastFrame()).toContain('> item-19');

    await press(stdin, 'g');
    await press(stdin, 'g');
    expect(lastFrame()).toContain('> item-0');
  });

  it('a single "g" press (not followed by a second "g") does not jump to the top', async () => {
    const { lastFrame, stdin } = await renderList({ data: items(20), height: 10 });
    await press(stdin, DOWN);
    await press(stdin, DOWN);
    expect(lastFrame()).toContain('> item-2');
    await press(stdin, 'g');
    expect(lastFrame()).toContain('> item-2');
  });

  it('selection never moves above the first item or below the last', async () => {
    const { lastFrame, stdin } = await renderList({ data: items(3), height: 10 });
    await press(stdin, UP);
    expect(lastFrame()).toContain('> item-0');
    await press(stdin, 'G');
    await press(stdin, DOWN);
    expect(lastFrame()).toContain('> item-2');
  });

  it('Enter invokes onSelect with the currently selected item', async () => {
    const onSelect = vi.fn();
    const { stdin } = await renderList({ data: items(5), height: 10, onSelect });
    await press(stdin, DOWN);
    await press(stdin, ENTER);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith({ id: '1', label: 'item-1' });
  });

  it('"/" opens a live filter that narrows the rendered set as the query is typed', async () => {
    const { lastFrame, stdin } = await renderList({ data: items(20), height: 10 });
    await press(stdin, '/');
    await press(stdin, 'item-1');
    const frame = lastFrame() ?? '';
    // "item-1" itself and every "item-1x" (10-19) match; "item-2" does not.
    expect(frame).toContain('item-1');
    expect(frame).not.toContain('item-2\n');
    expect(frame).toContain('/item-1');
  });

  it('Esc cancels the filter, restoring the full list and the selection active before filtering opened', async () => {
    const { lastFrame, stdin } = await renderList({ data: items(20), height: 10 });
    await press(stdin, DOWN);
    await press(stdin, DOWN);
    expect(lastFrame()).toContain('> item-2');

    await press(stdin, '/');
    await press(stdin, 'item-1');
    expect(lastFrame() ?? '').not.toContain('> item-2');

    await press(stdin, ESC);
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('/item-1');
    expect(frame).toContain('> item-2');

    // The full, unfiltered 20-item list is really back -- jumping to the bottom reaches item-19,
    // which the still-narrowed ("item-1"-matching) set could never have contained.
    await press(stdin, 'G');
    expect(lastFrame()).toContain('> item-19');
  });

  it('Enter commits the filter and returns to ordinary browsing over the narrowed set', async () => {
    const { lastFrame, stdin } = await renderList({ data: items(20), height: 10 });
    await press(stdin, '/');
    await press(stdin, 'item-1');
    await press(stdin, ENTER);
    // No longer showing the "/query" edit line...
    expect(lastFrame() ?? '').not.toContain('/item-1');
    // ...but the list is still narrowed, and arrow keys move within it.
    expect(lastFrame() ?? '').not.toContain('item-2\n');
    await press(stdin, DOWN);
    expect(lastFrame()).toContain('> item-10');
  });

  it('Esc also cancels an already-committed filter (not currently being edited), not only one still mid-edit', async () => {
    const { lastFrame, stdin } = await renderList({ data: items(20), height: 10 });
    await press(stdin, '/');
    await press(stdin, 'item-1');
    await press(stdin, ENTER);
    expect(lastFrame() ?? '').not.toContain('item-2\n');

    await press(stdin, ESC);
    await press(stdin, 'G');
    expect(lastFrame()).toContain('> item-19');
  });

  it('backspace edits the filter query live', async () => {
    const { lastFrame, stdin } = await renderList({ data: items(20), height: 10 });
    await press(stdin, '/');
    await press(stdin, 'item-1x');
    await press(stdin, BACKSPACE);
    expect(lastFrame()).toContain('/item-1');
    expect(lastFrame() ?? '').not.toContain('/item-1x');
  });

  it('an empty items array renders nothing and does not crash on navigation', async () => {
    const { lastFrame, stdin } = await renderList({ data: [], height: 10 });
    expect(lastFrame()).toBe('');
    await press(stdin, DOWN);
    await press(stdin, ENTER);
    expect(lastFrame()).toBe('');
  });

  it('keys are ignored entirely when not focused', async () => {
    const { lastFrame, stdin } = await renderList({ data: items(5), height: 10, focused: false });
    await press(stdin, DOWN);
    expect(lastFrame()).toContain('> item-0');
  });

  it('selection tracks the selected item itself, not its numeric position, when items reshuffles underneath it -- a fresh critic round reproduced a numeric-index model silently re-pointing at the wrong item once an earlier item was removed from a live-updating list', async () => {
    const renderItem = (item: Item, selected: boolean) => (
      <Text>{selected ? `> ${item.label}` : `  ${item.label}`}</Text>
    );
    const { lastFrame, stdin, rerender } = render(
      <ListPane
        items={[
          { id: 'alice', label: 'Alice' },
          { id: 'bob', label: 'Bob' },
          { id: 'carol', label: 'Carol' },
        ]}
        getId={(item) => item.id}
        getFilterText={(item) => item.label}
        renderItem={renderItem}
        focused
        height={10}
      />,
    );
    await flush();
    await press(stdin, DOWN);
    expect(lastFrame()).toContain('> Bob');

    // Alice is removed from the front of the list -- Bob (still present) is now at index 0, and the
    // old index 1 (still selected under a naive numeric model) would now be Carol.
    rerender(
      <ListPane
        items={[
          { id: 'bob', label: 'Bob' },
          { id: 'carol', label: 'Carol' },
        ]}
        getId={(item) => item.id}
        getFilterText={(item) => item.label}
        renderItem={renderItem}
        focused
        height={10}
      />,
    );
    expect(lastFrame()).toContain('> Bob');
    expect(lastFrame() ?? '').not.toContain('> Carol');
  });

  it('when the selected item is removed entirely from items, selection re-anchors to a valid item rather than pointing at nothing', async () => {
    const renderItem = (item: Item, selected: boolean) => (
      <Text>{selected ? `> ${item.label}` : `  ${item.label}`}</Text>
    );
    const { lastFrame, stdin, rerender } = render(
      <ListPane
        items={[
          { id: 'alice', label: 'Alice' },
          { id: 'bob', label: 'Bob' },
        ]}
        getId={(item) => item.id}
        getFilterText={(item) => item.label}
        renderItem={renderItem}
        focused
        height={10}
      />,
    );
    await flush();
    await press(stdin, DOWN);
    expect(lastFrame()).toContain('> Bob');

    rerender(
      <ListPane
        items={[{ id: 'alice', label: 'Alice' }]}
        getId={(item) => item.id}
        getFilterText={(item) => item.label}
        renderItem={renderItem}
        focused
        height={10}
      />,
    );
    expect(lastFrame()).toContain('> Alice');
  });
});

describe('onFilterModeChange', () => {
  it('is called once, with false, on mount', async () => {
    const changes: boolean[] = [];
    render(
      <ListPane
        items={items(3)}
        getId={(item) => item.id}
        getFilterText={(item) => item.label}
        renderItem={(item) => <Text>{item.label}</Text>}
        focused
        height={5}
        onFilterModeChange={(v) => changes.push(v)}
      />,
    );
    await flush();
    expect(changes).toEqual([false]);
  });

  it('fires true when "/" starts filter-editing, and false again once Enter confirms it', async () => {
    const changes: boolean[] = [];
    const { stdin } = render(
      <ListPane
        items={items(3)}
        getId={(item) => item.id}
        getFilterText={(item) => item.label}
        renderItem={(item) => <Text>{item.label}</Text>}
        focused
        height={5}
        onFilterModeChange={(v) => changes.push(v)}
      />,
    );
    await flush();
    await press(stdin, '/');
    await press(stdin, ENTER);
    expect(changes).toEqual([false, true, false]);
  });

  it('fires false again when Esc cancels filter-editing', async () => {
    const changes: boolean[] = [];
    const { stdin } = render(
      <ListPane
        items={items(3)}
        getId={(item) => item.id}
        getFilterText={(item) => item.label}
        renderItem={(item) => <Text>{item.label}</Text>}
        focused
        height={5}
        onFilterModeChange={(v) => changes.push(v)}
      />,
    );
    await flush();
    await press(stdin, '/');
    await press(stdin, ESC);
    expect(changes).toEqual([false, true, false]);
  });

  it('fires a final false on unmount while still mid-filter -- a round-2 critic reproduced directly that a caller conditionally unmounting this component (e.g. its own items prop going empty) mid-filter left the last reported value stuck true forever otherwise', async () => {
    const changes: boolean[] = [];
    const { stdin, unmount } = render(
      <ListPane
        items={items(3)}
        getId={(item) => item.id}
        getFilterText={(item) => item.label}
        renderItem={(item) => <Text>{item.label}</Text>}
        focused
        height={5}
        onFilterModeChange={(v) => changes.push(v)}
      />,
    );
    await flush();
    await press(stdin, '/'); // start filtering, never confirmed or cancelled
    expect(changes).toEqual([false, true]);

    unmount();
    await flush();
    expect(changes).toEqual([false, true, false]);
  });

  it('unmounting while never in filter-editing mode fires a redundant but harmless final false, not a crash', async () => {
    const changes: boolean[] = [];
    const { unmount } = render(
      <ListPane
        items={items(3)}
        getId={(item) => item.id}
        getFilterText={(item) => item.label}
        renderItem={(item) => <Text>{item.label}</Text>}
        focused
        height={5}
        onFilterModeChange={(v) => changes.push(v)}
      />,
    );
    await flush();
    unmount();
    await flush();
    expect(changes).toEqual([false, false]);
  });

  it('is entirely optional -- omitting it changes nothing about ordinary filter behavior', async () => {
    const { lastFrame, stdin } = await renderList({ data: items(3), height: 5 });
    await press(stdin, '/');
    await press(stdin, 'item-1');
    expect(stripAnsi(lastFrame() ?? '')).toContain('/item-1');
  });
});

describe('defaultListItemLabel', () => {
  it('renders a label with a StatusGlyph when a state is given', () => {
    const { lastFrame } = render(
      defaultListItemLabel('Lane 1', 'running', { ascii: false, color: true }),
    );
    expect(stripAnsi(lastFrame() ?? '')).toBe('● running Lane 1');
  });

  it('renders just the label, with no glyph at all, when no state is given', () => {
    const { lastFrame } = render(
      defaultListItemLabel('Lane 1', undefined, { ascii: false, color: true }),
    );
    expect(stripAnsi(lastFrame() ?? '')).toBe('Lane 1');
  });
});
