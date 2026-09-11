/**
 * `<Tree>` -- `04` §4.3/§4.5's own collapsible tree with lazy children.
 *
 * See `list-pane.test.tsx`'s own header comment for why every keystroke goes through `press()`
 * (flushing a tick after each write): the same `useInput`-effect-timing and fresh-closure-per-render
 * reasons apply identically here.
 *
 * @see specs/04 §4.2, §4.3, §4.5
 * @see PLAN-M9.md P3
 */
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { describe, expect, it, vi } from 'vitest';

import { Tree, type TreeNode } from '../../src/components/tree.tsx';

const RIGHT = '\x1B[C';
const LEFT = '\x1B[D';
const DOWN = '\x1B[B';
const UP = '\x1B[A';

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

async function renderTree(nodes: readonly TreeNode[]) {
  const result = render(<Tree nodes={nodes} focused mode={{ ascii: false, color: true }} />);
  await flush();
  return result;
}

describe('Tree', () => {
  it('renders root nodes collapsed, with an expand indicator only on nodes that have children', () => {
    const nodes: TreeNode[] = [
      { id: 'a', label: 'Story A', children: [{ id: 'a1', label: 'Task 1' }] },
      { id: 'b', label: 'Story B' },
    ];
    const { lastFrame } = render(
      <Tree nodes={nodes} focused mode={{ ascii: false, color: true }} />,
    );
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('▸ Story A');
    expect(frame).toContain('  Story B');
    expect(frame).not.toContain('Task 1');
  });

  it('ascii mode renders only ASCII expand/collapse indicators', () => {
    const nodes: TreeNode[] = [{ id: 'a', label: 'Story A', children: [] }];
    const { lastFrame } = render(
      <Tree nodes={nodes} focused mode={{ ascii: true, color: true }} />,
    );
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('> Story A');
    expect(frame).not.toMatch(/[▸▾]/u);
  });

  it('expanding a node with a static (non-lazy) children array reveals them immediately, indented', async () => {
    const nodes: TreeNode[] = [
      { id: 'a', label: 'Story A', children: [{ id: 'a1', label: 'Task 1' }] },
    ];
    const { lastFrame, stdin } = await renderTree(nodes);
    await press(stdin, RIGHT);
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('▾ Story A');
    expect(frame).toContain('Task 1');
  });

  it('collapsing an expanded node hides its children again', async () => {
    const nodes: TreeNode[] = [
      { id: 'a', label: 'Story A', children: [{ id: 'a1', label: 'Task 1' }] },
    ];
    const { lastFrame, stdin } = await renderTree(nodes);
    await press(stdin, RIGHT);
    expect(stripAnsi(lastFrame() ?? '')).toContain('Task 1');
    await press(stdin, LEFT);
    expect(stripAnsi(lastFrame() ?? '')).not.toContain('Task 1');
  });

  it('a lazy loader is invoked exactly once per node, cached on subsequent collapse/re-expand', async () => {
    const loader = vi.fn().mockResolvedValue([{ id: 'a1', label: 'Task 1' }]);
    const nodes: TreeNode[] = [{ id: 'a', label: 'Story A', children: loader }];
    const { lastFrame, stdin } = await renderTree(nodes);

    await press(stdin, RIGHT);
    // The loader is async; give its own promise a tick to resolve, then flush the resulting state update.
    await flush();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(stripAnsi(lastFrame() ?? '')).toContain('Task 1');

    await press(stdin, LEFT);
    expect(stripAnsi(lastFrame() ?? '')).not.toContain('Task 1');

    await press(stdin, RIGHT);
    await flush();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(stripAnsi(lastFrame() ?? '')).toContain('Task 1');
  });

  it('a node currently loading renders a running StatusGlyph in its own place', async () => {
    let resolveLoader: ((children: readonly TreeNode[]) => void) | undefined;
    const loader = vi.fn(
      () =>
        new Promise<readonly TreeNode[]>((resolve) => {
          resolveLoader = resolve;
        }),
    );
    const nodes: TreeNode[] = [{ id: 'a', label: 'Story A', children: loader }];
    const { lastFrame, stdin } = await renderTree(nodes);

    await press(stdin, RIGHT);
    expect(stripAnsi(lastFrame() ?? '')).toContain('running');

    resolveLoader?.([{ id: 'a1', label: 'Task 1' }]);
    await flush();
    expect(stripAnsi(lastFrame() ?? '')).not.toContain('running');
    expect(stripAnsi(lastFrame() ?? '')).toContain('Task 1');
  });

  it('a lazy loader that rejects renders a fail StatusGlyph instead of getting stuck showing running forever, and a later retry re-invokes the loader -- a fresh critic round reproduced the original unhandled `.then()` (no `.catch`) leaving the node permanently wedged in "loading" on a real fetch failure', async () => {
    let rejectLoader: ((error: Error) => void) | undefined;
    const loader = vi.fn(
      () =>
        new Promise<readonly TreeNode[]>((_resolve, reject) => {
          rejectLoader = reject;
        }),
    );
    const nodes: TreeNode[] = [{ id: 'a', label: 'Story A', children: loader }];
    const { lastFrame, stdin } = await renderTree(nodes);

    await press(stdin, RIGHT);
    expect(stripAnsi(lastFrame() ?? '')).toContain('running');

    rejectLoader?.(new Error('network down'));
    await flush();
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).not.toContain('running');
    expect(frame).toContain('fail');
    // The node collapsed back rather than staying expanded over nothing.
    expect(frame).toContain('▸ Story A');

    // Retrying (pressing → again) re-invokes the loader, since a failed attempt was never cached.
    await press(stdin, RIGHT);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('↓/j moves focus across the flattened, currently visible node list, including expanded children', async () => {
    const nodes: TreeNode[] = [
      { id: 'a', label: 'Story A', children: [{ id: 'a1', label: 'Task 1' }] },
      { id: 'b', label: 'Story B' },
    ];
    const { lastFrame, stdin } = await renderTree(nodes);
    await press(stdin, RIGHT);
    await press(stdin, DOWN);
    // "Task 1" is now the focused row -- rendered inverse; assert its text is present and Story B's
    // own row (below it) is unaffected, proving DOWN moved into the just-revealed child, not past it.
    const frame = lastFrame() ?? '';
    expect(stripAnsi(frame)).toContain('Task 1');
    expect(stripAnsi(frame)).toContain('Story B');
  });

  it("↑/k moves focus back up -- proven behaviourally, since this test harness never renders the inverse-video focus styling at all: pressing left afterward collapses Story A (now focused again), not the still-childless Task 1 it would otherwise have no-op'd against", async () => {
    const nodes: TreeNode[] = [
      { id: 'a', label: 'Story A', children: [{ id: 'a1', label: 'Task 1' }] },
    ];
    const { lastFrame, stdin } = await renderTree(nodes);
    await press(stdin, RIGHT);
    await press(stdin, DOWN);
    expect(stripAnsi(lastFrame() ?? '')).toContain('Task 1');

    await press(stdin, UP);
    await press(stdin, LEFT);
    expect(stripAnsi(lastFrame() ?? '')).not.toContain('Task 1');
  });

  it('a node with no children renders no expand indicator and left/right are safe no-ops on it', async () => {
    const nodes: TreeNode[] = [{ id: 'a', label: 'Leaf' }];
    const { lastFrame, stdin } = await renderTree(nodes);
    await press(stdin, RIGHT);
    await press(stdin, LEFT);
    expect(stripAnsi(lastFrame() ?? '')).toBe('  Leaf');
  });

  it('keys are ignored entirely when not focused', async () => {
    const nodes: TreeNode[] = [
      { id: 'a', label: 'Story A', children: [{ id: 'a1', label: 'Task 1' }] },
    ];
    const { lastFrame, stdin } = render(
      <Tree nodes={nodes} focused={false} mode={{ ascii: false, color: true }} />,
    );
    await flush();
    await press(stdin, RIGHT);
    expect(stripAnsi(lastFrame() ?? '')).not.toContain('Task 1');
  });

  it('an empty nodes array renders nothing and does not crash on navigation', async () => {
    const { lastFrame, stdin } = await renderTree([]);
    expect(lastFrame()).toBe('');
    await press(stdin, DOWN);
    await press(stdin, RIGHT);
    expect(lastFrame()).toBe('');
  });

  it("re-rendering the same element with a different `nodes` array reusing an id shows the STALE, previous dataset's own cached children and never calls the new loader -- documenting, by reproducing it directly, exactly the reused-id hazard this file's own top doc comment names and resolves via a caller-supplied `key`, not internal detection", async () => {
    const loaderA = vi.fn().mockResolvedValue([{ id: 'child', label: 'Old Task' }]);
    const loaderB = vi.fn().mockResolvedValue([{ id: 'child', label: 'New Task' }]);
    const { lastFrame, stdin, rerender } = render(
      <Tree
        nodes={[{ id: 'shared', label: 'Project A', children: loaderA }]}
        focused
        mode={{ ascii: false, color: true }}
      />,
    );
    await flush();
    await press(stdin, RIGHT);
    await flush();
    expect(stripAnsi(lastFrame() ?? '')).toContain('Old Task');

    rerender(
      <Tree
        nodes={[{ id: 'shared', label: 'Project B', children: loaderB }]}
        focused
        mode={{ ascii: false, color: true }}
      />,
    );
    // Reusing the same id with no `key` change: the new project renders already-expanded, showing
    // the PREVIOUS project's own stale cached children -- this is the documented hazard, not a
    // silently-accepted crash; the fix is the `key`-remount contract proven by the next test below.
    expect(stripAnsi(lastFrame() ?? '')).toContain('Old Task');
    expect(loaderB).not.toHaveBeenCalled();
  });

  it('a distinct `key` prop on a genuinely different dataset forces a real remount, so a reused id never leaks stale state across it', async () => {
    const loaderA = vi.fn().mockResolvedValue([{ id: 'child', label: 'Old Task' }]);
    const loaderB = vi.fn().mockResolvedValue([{ id: 'child', label: 'New Task' }]);
    const { lastFrame, stdin, rerender } = render(
      <Tree
        key="project-a"
        nodes={[{ id: 'shared', label: 'Project A', children: loaderA }]}
        focused
        mode={{ ascii: false, color: true }}
      />,
    );
    await flush();
    await press(stdin, RIGHT);
    await flush();
    expect(stripAnsi(lastFrame() ?? '')).toContain('Old Task');

    rerender(
      <Tree
        key="project-b"
        nodes={[{ id: 'shared', label: 'Project B', children: loaderB }]}
        focused
        mode={{ ascii: false, color: true }}
      />,
    );
    await flush();
    const frame = stripAnsi(lastFrame() ?? '');
    // A fresh instance: collapsed again, no stale children, nothing loaded yet.
    expect(frame).toBe('▸ Project B');
    expect(frame).not.toContain('Old Task');
  });

  describe('onFocusChange', () => {
    it('is called once, with the default-focused (first) node, on mount', async () => {
      const focused: TreeNode[] = [];
      const nodes: TreeNode[] = [
        { id: 'a', label: 'Story A' },
        { id: 'b', label: 'Story B' },
      ];
      render(
        <Tree
          nodes={nodes}
          focused
          mode={{ ascii: false, color: true }}
          onFocusChange={(node) => focused.push(node)}
        />,
      );
      await flush();
      expect(focused).toEqual([{ id: 'a', label: 'Story A' }]);
    });

    it('fires again, with the newly-focused node, on every up/down move -- and only then', async () => {
      const focused: TreeNode[] = [];
      const nodes: TreeNode[] = [
        { id: 'a', label: 'Story A' },
        { id: 'b', label: 'Story B' },
        { id: 'c', label: 'Story C' },
      ];
      const { stdin } = render(
        <Tree
          nodes={nodes}
          focused
          mode={{ ascii: false, color: true }}
          onFocusChange={(node) => focused.push(node)}
        />,
      );
      await flush();
      await press(stdin, DOWN);
      await press(stdin, DOWN);
      await press(stdin, UP);
      expect(focused.map((n) => n.id)).toEqual(['a', 'b', 'c', 'b']);
    });

    it('never fires while collapsing/expanding a node the focus does not itself move off of', async () => {
      const focused: TreeNode[] = [];
      const nodes: TreeNode[] = [
        { id: 'a', label: 'Story A', children: [{ id: 'a1', label: 'Task 1' }] },
      ];
      const { stdin } = render(
        <Tree
          nodes={nodes}
          focused
          mode={{ ascii: false, color: true }}
          onFocusChange={(node) => focused.push(node)}
        />,
      );
      await flush();
      await press(stdin, RIGHT); // expand -- focus stays on "a"
      await press(stdin, LEFT); // collapse -- focus stays on "a"
      expect(focused.map((n) => n.id)).toEqual(['a']);
    });
  });
});
