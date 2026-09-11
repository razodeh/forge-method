/**
 * `<KbScreen>` -- `04` §4.3 S4: the Knowledge Body section tree, entry viewer, contradictions/stale
 * filters, and diagram affordances.
 *
 * See `list-pane.test.tsx`'s own header comment for why every test that presses a key awaits `flush()`
 * once right after `render()`, before the first `stdin.write()`.
 *
 * @see specs/04 §4.3 S4
 * @see PLAN-M9.md P10
 */
import type { KbFinding } from '@forge/kb/lint';
import type { KbEntry } from '@forge/kb/schema';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';

import type { RenderMode } from '../../src/env.ts';
import {
  type KbDiagramSummary,
  KbScreen,
  type KbScreenProps,
  type KbWriteHistoryEntry,
} from '../../src/screens/kb.tsx';
import type { EngineCommand } from '../../src/state/engine-command.ts';
import { INITIAL_RUN_READ_MODEL } from '../../src/state/run-read-model.ts';

const DOWN = '\x1B[B';
const RIGHT = '\x1B[C';

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

const MODE: RenderMode = { color: true, ascii: false, linear: false, columns: 120, lines: 40 };

function makeEntry(
  overrides: Partial<KbEntry> & { id: string; section: KbEntry['section'] },
): KbEntry {
  return {
    type: 'knowledge',
    title: `Title for ${overrides.id}`,
    status: 'active',
    confidence: 'high',
    owner: 'architect',
    sources: [{ kind: 'human', ref: 'elicitation 2026-01-05' }],
    created: '2026-01-01',
    updated: '2026-01-01',
    review_by: '2026-04-01',
    supersedes: [],
    superseded_by: null,
    related: [],
    diagrams: [],
    tags: [],
    applies_to: [],
    body: '## Statement\nSomething.\n',
    ...overrides,
  };
}

const productEntry = makeEntry({ id: 'KB-PROD-0001', section: 'product' });
const architectureEntry = makeEntry({ id: 'KB-ARCH-0001', section: 'architecture' });
const staleEntry = makeEntry({
  id: 'KB-OPS-0001',
  section: 'ops',
  review_by: '2020-01-01', // long past
});
const referencingEntry = makeEntry({
  id: 'KB-DATA-0001',
  section: 'data',
  related: ['KB-PROD-0001'],
});

const contradictionFinding: KbFinding = {
  ruleId: 'kb:contradiction',
  severity: 'error',
  message: 'KB-ARCH-0001 contradicts KB-PROD-0001',
  entryId: 'KB-ARCH-0001',
};
const staleFinding: KbFinding = {
  ruleId: 'kb:staleness',
  severity: 'warn',
  message: 'KB-OPS-0001 passed its review date',
  entryId: 'KB-OPS-0001',
};

function baseProps(overrides: Partial<KbScreenProps> = {}): KbScreenProps {
  return {
    mode: MODE,
    readModel: INITIAL_RUN_READ_MODEL,
    focusedPaneIndex: 0,
    entries: [productEntry, architectureEntry, staleEntry, referencingEntry],
    findings: [contradictionFinding, staleFinding],
    diagramsByEntryId: new Map(),
    writeHistoryByEntryId: new Map(),
    onCommand: () => undefined,
    onOpenDiagram: () => undefined,
    ...overrides,
  };
}

/** Expands the "product" section and moves focus onto its own single entry, `KB-PROD-0001`. */
async function focusProductEntry(stdin: StdinLike): Promise<void> {
  await press(stdin, RIGHT); // expand "product" (the first, already-focused section)
  await press(stdin, DOWN); // move onto KB-PROD-0001
}

describe('<KbScreen>', () => {
  it('renders every real KB_SECTIONS section, including "engineering" -- never the wrong, PLAN-M9.md-literal "decisions" section', () => {
    const { lastFrame } = render(<KbScreen {...baseProps()} />);
    const frame = stripAnsi(lastFrame() ?? '');
    for (const section of [
      'product',
      'constraints',
      'architecture',
      'domain',
      'data',
      'delivery',
      'ops',
      'engineering',
      'glossary',
    ]) {
      expect(frame).toContain(section);
    }
    expect(frame).not.toContain('decisions');
  });

  it('selecting an entry via the tree shows its front matter, sources, and computed "used by" backlinks', async () => {
    const { lastFrame, stdin } = render(<KbScreen {...baseProps()} />);
    await flush();
    await focusProductEntry(stdin);
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('Title for KB-PROD-0001');
    expect(frame).toContain('human:elicitation 2026-01-05');
    expect(frame).toContain('used by: KB-DATA-0001'); // referencingEntry's own `related`
  });

  it('renders "No entry selected." while a section header (not an entry) is focused', async () => {
    const { lastFrame } = render(<KbScreen {...baseProps()} />);
    await flush();
    expect(stripAnsi(lastFrame() ?? '')).toContain('No entry selected.');
  });

  it('moving focus back onto a section header clears the stale entry detail, rather than leaving it showing', async () => {
    const { lastFrame, stdin } = render(<KbScreen {...baseProps()} />);
    await flush();
    await focusProductEntry(stdin);
    expect(stripAnsi(lastFrame() ?? '')).toContain('Title for KB-PROD-0001');

    await press(stdin, DOWN); // move onto the "constraints" section header
    expect(stripAnsi(lastFrame() ?? '')).toContain('No entry selected.');
  });

  describe('c (contradictions filter)', () => {
    it('shows exactly the entry with a real kb:contradiction finding, correctly counted in its section badge', async () => {
      const { lastFrame, stdin } = render(<KbScreen {...baseProps()} />);
      await flush();
      await press(stdin, 'c');
      const frame = stripAnsi(lastFrame() ?? '');
      expect(frame).toContain('architecture (1)');
      expect(frame).toContain('product'); // still present, an empty section
      expect(frame).not.toContain('(1)  product'); // no badge on a non-matching section

      await press(stdin, 'c'); // toggle back off
      expect(stripAnsi(lastFrame() ?? '')).not.toContain('architecture (1)');
    });

    it('never emits a command -- a pure local view concern', async () => {
      const commands: EngineCommand[] = [];
      const { stdin } = render(<KbScreen {...baseProps({ onCommand: (c) => commands.push(c) })} />);
      await flush();
      await press(stdin, 'c');
      expect(commands).toEqual([]);
    });

    it('actually hides non-matching entries once expanded, not just the badge count', async () => {
      const { lastFrame, stdin } = render(<KbScreen {...baseProps()} />);
      await flush();
      await press(stdin, 'c');
      // "product" and "constraints" are both empty in this filtered view (no children to expand into),
      // so two plain downs land on "architecture", the next section with a real match.
      await press(stdin, DOWN);
      await press(stdin, DOWN);
      await press(stdin, RIGHT); // expand "architecture"
      const frame = stripAnsi(lastFrame() ?? '');
      expect(frame).toContain('KB-ARCH-0001');

      await press(stdin, DOWN); // move onto KB-ARCH-0001 itself (its own only child)
      await press(stdin, DOWN); // move past it -- "domain" is next, still empty in this filtered view
      const frameAfter = stripAnsi(lastFrame() ?? '');
      expect(frameAfter).not.toContain('KB-DATA-0001'); // referencingEntry has no contradiction finding
    });

    it('toggling a filter that excludes the currently-focused entry clears the detail pane, rather than leaving stale front matter showing for an entry no longer visible anywhere', async () => {
      const commands: EngineCommand[] = [];
      const props = baseProps({ onCommand: (c) => commands.push(c) });
      const { lastFrame, stdin } = render(<KbScreen {...props} />);
      await flush();
      // Focus KB-ARCH-0001 (architecture, the third section: product, constraints, architecture) -- it
      // has a contradiction finding but no staleness finding.
      await press(stdin, DOWN); // constraints
      await press(stdin, DOWN); // architecture
      await press(stdin, RIGHT); // expand "architecture"
      await press(stdin, DOWN); // focus KB-ARCH-0001
      expect(stripAnsi(lastFrame() ?? '')).toContain('Title for KB-ARCH-0001');

      await press(stdin, 's'); // the stale filter excludes KB-ARCH-0001 entirely
      expect(stripAnsi(lastFrame() ?? '')).toContain('No entry selected.');

      // Confirms this isn't merely a display glitch: `v`/`a` correctly no-op too, never silently
      // acting on the entry that just vanished from view.
      await press(stdin, 'v');
      await press(stdin, 'a');
      expect(commands).toEqual([]);
    });
  });

  describe('s (stale filter)', () => {
    it('shows exactly the entry with a real kb:staleness finding, correctly counted in its section badge', async () => {
      const { lastFrame, stdin } = render(<KbScreen {...baseProps()} />);
      await flush();
      await press(stdin, 's');
      expect(stripAnsi(lastFrame() ?? '')).toContain('ops (1)');
    });
  });

  describe('/ (search)', () => {
    it('opens a modal; submitting text emits exactly one kb.search command and closes it', async () => {
      const commands: EngineCommand[] = [];
      const { lastFrame, stdin } = render(
        <KbScreen {...baseProps({ onCommand: (c) => commands.push(c) })} />,
      );
      await flush();
      await press(stdin, '/');
      expect(stripAnsi(lastFrame() ?? '')).toContain('Search the Knowledge Body');

      await press(stdin, 'budget cap');
      await press(stdin, '\r');
      expect(commands).toEqual([{ type: 'kb.search', query: 'budget cap' }]);
      expect(stripAnsi(lastFrame() ?? '')).not.toContain('Search the Knowledge Body');
    });

    it('Esc closes the search modal without emitting anything', async () => {
      const commands: EngineCommand[] = [];
      const { stdin } = render(<KbScreen {...baseProps({ onCommand: (c) => commands.push(c) })} />);
      await flush();
      await press(stdin, '/');
      await press(stdin, '\x1B');
      expect(commands).toEqual([]);
    });

    it('submitting an empty query emits nothing', async () => {
      const commands: EngineCommand[] = [];
      const { stdin } = render(<KbScreen {...baseProps({ onCommand: (c) => commands.push(c) })} />);
      await flush();
      await press(stdin, '/');
      await press(stdin, '\r');
      expect(commands).toEqual([]);
    });

    it('typing "c"/"s"/"v" into the open search field never also triggers a filter toggle or a command', async () => {
      const commands: EngineCommand[] = [];
      const { lastFrame, stdin } = render(
        <KbScreen {...baseProps({ onCommand: (c) => commands.push(c) })} />,
      );
      await flush();
      await press(stdin, '/');
      await press(stdin, 'csv budget');
      expect(commands).toEqual([]);
      expect(stripAnsi(lastFrame() ?? '')).toContain('csv budget');
      expect(stripAnsi(lastFrame() ?? '')).not.toContain('(1)'); // no filter badge leaked in
    });

    it('while open, tree navigation is inert -- j/k/arrows type into the field instead of moving the tree cursor', async () => {
      const { lastFrame, stdin } = render(<KbScreen {...baseProps()} />);
      await flush();
      await press(stdin, '/');
      await press(stdin, 'jk');
      expect(stripAnsi(lastFrame() ?? '')).toContain('jk');
      await press(stdin, '\x1B');
      // The tree's own focus never silently moved off "product" while the modal had it captured.
      await focusProductEntry(stdin);
      expect(stripAnsi(lastFrame() ?? '')).toContain('Title for KB-PROD-0001');
    });
  });

  describe('v (mark verified)', () => {
    it('emits exactly one kb.markVerified for the focused entry', async () => {
      const commands: EngineCommand[] = [];
      const { stdin } = render(<KbScreen {...baseProps({ onCommand: (c) => commands.push(c) })} />);
      await flush();
      await focusProductEntry(stdin);
      await press(stdin, 'v');
      expect(commands).toEqual([{ type: 'kb.markVerified', entryId: 'KB-PROD-0001' }]);
    });

    it('emits nothing at all when no entry has ever been focused', async () => {
      const commands: EngineCommand[] = [];
      const { stdin } = render(<KbScreen {...baseProps({ onCommand: (c) => commands.push(c) })} />);
      await flush();
      await press(stdin, 'v');
      expect(commands).toEqual([]);
    });
  });

  describe('a (new ADR)', () => {
    it('emits exactly one kb.newAdr with the focused entry as context', async () => {
      const commands: EngineCommand[] = [];
      const { stdin } = render(<KbScreen {...baseProps({ onCommand: (c) => commands.push(c) })} />);
      await flush();
      await focusProductEntry(stdin);
      await press(stdin, 'a');
      expect(commands).toEqual([{ type: 'kb.newAdr', contextEntryId: 'KB-PROD-0001' }]);
    });
  });

  describe('w (write-history toggle)', () => {
    it('toggles between front-matter view and write-history for the focused entry', async () => {
      const writeHistoryByEntryId = new Map<string, readonly KbWriteHistoryEntry[]>([
        ['KB-PROD-0001', [{ ts: '2026-01-02T00:00:00.000Z', summary: 'Initial write' }]],
      ]);
      const { lastFrame, stdin } = render(<KbScreen {...baseProps({ writeHistoryByEntryId })} />);
      await flush();
      await focusProductEntry(stdin);
      // "sources:" only ever renders in the front-matter view -- the tree's own row label always
      // shows the entry's title regardless of which view the detail pane is in, so asserting on the
      // title alone wouldn't actually distinguish the two views.
      expect(stripAnsi(lastFrame() ?? '')).toContain('sources:');

      await press(stdin, 'w');
      const frame = stripAnsi(lastFrame() ?? '');
      expect(frame).toContain('write history');
      expect(frame).toContain('Initial write');
      expect(frame).not.toContain('sources:');

      await press(stdin, 'w'); // toggle back
      expect(stripAnsi(lastFrame() ?? '')).toContain('sources:');
    });

    it('an entry with no write history renders an explicit empty state, not a blank pane', async () => {
      const { lastFrame, stdin } = render(<KbScreen {...baseProps()} />);
      await flush();
      await focusProductEntry(stdin);
      await press(stdin, 'w');
      expect(stripAnsi(lastFrame() ?? '')).toContain('No write history.');
    });
  });

  it('the diagram affordance renders a real, fixture-attached diagram source/caption/alt-text, never an inline image', async () => {
    const diagrams: readonly KbDiagramSummary[] = [
      {
        id: 'DIAG-1',
        source: 'flowchart TD; A-->B',
        caption: 'Request flow',
        altText: 'A flowchart',
      },
    ];
    const diagramsByEntryId = new Map<string, readonly KbDiagramSummary[]>([
      ['KB-PROD-0001', diagrams],
    ]);
    const { lastFrame, stdin } = render(<KbScreen {...baseProps({ diagramsByEntryId })} />);
    await flush();
    await focusProductEntry(stdin);
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('⬚ 1 diagrams');
    expect(frame).toContain('Request flow');
    expect(frame).toContain('A flowchart');
    expect(frame).not.toContain('flowchart TD; A-->B');
  });

  it('an entry with no diagrams renders "⬚ 0 diagrams"', async () => {
    const { lastFrame, stdin } = render(<KbScreen {...baseProps()} />);
    await flush();
    await focusProductEntry(stdin);
    expect(stripAnsi(lastFrame() ?? '')).toContain('⬚ 0 diagrams');
  });

  describe('D (diagram before/after diff)', () => {
    it("toggles rendering a diagram's own diff when one is present, never a real inline image render", async () => {
      const diagrams: readonly KbDiagramSummary[] = [
        {
          id: 'DIAG-1',
          source: 's',
          caption: 'c',
          altText: 'a',
          diffPatch: '--- a/d\n+++ b/d\n@@ -1 +1 @@\n-old\n+new\n',
        },
      ];
      const diagramsByEntryId = new Map<string, readonly KbDiagramSummary[]>([
        ['KB-PROD-0001', diagrams],
      ]);
      const { lastFrame, stdin } = render(<KbScreen {...baseProps({ diagramsByEntryId })} />);
      await flush();
      await focusProductEntry(stdin);
      expect(stripAnsi(lastFrame() ?? '')).not.toContain('-old');

      await press(stdin, 'D');
      const frame = stripAnsi(lastFrame() ?? '');
      expect(frame).toContain('-old');
      expect(frame).toContain('+new');

      await press(stdin, 'D'); // toggle back off
      expect(stripAnsi(lastFrame() ?? '')).not.toContain('-old');
    });

    it('a diagram with no diffPatch renders nothing extra when toggled on', async () => {
      const diagrams: readonly KbDiagramSummary[] = [
        { id: 'DIAG-1', source: 's', caption: 'c', altText: 'a' },
      ];
      const diagramsByEntryId = new Map<string, readonly KbDiagramSummary[]>([
        ['KB-PROD-0001', diagrams],
      ]);
      const { lastFrame, stdin } = render(<KbScreen {...baseProps({ diagramsByEntryId })} />);
      await flush();
      await focusProductEntry(stdin);
      await press(stdin, 'D');
      expect(stripAnsi(lastFrame() ?? '')).toContain('⬚ 1 diagrams');
    });
  });

  describe('o (open diagrams in browser)', () => {
    it('calls the injected onOpenDiagram once per diagram on the focused entry, never an EngineCommand', async () => {
      const opened: string[] = [];
      const commands: EngineCommand[] = [];
      const diagrams: readonly KbDiagramSummary[] = [
        { id: 'DIAG-1', source: 's1', caption: 'c1', altText: 'a1' },
        { id: 'DIAG-2', source: 's2', caption: 'c2', altText: 'a2' },
      ];
      const diagramsByEntryId = new Map<string, readonly KbDiagramSummary[]>([
        ['KB-PROD-0001', diagrams],
      ]);
      const { stdin } = render(
        <KbScreen
          {...baseProps({
            diagramsByEntryId,
            onOpenDiagram: (id) => opened.push(id),
            onCommand: (c) => commands.push(c),
          })}
        />,
      );
      await flush();
      await focusProductEntry(stdin);
      await press(stdin, 'o');
      expect(opened).toEqual(['DIAG-1', 'DIAG-2']);
      expect(commands).toEqual([]);
    });

    it('opens nothing when the focused entry has no diagrams at all', async () => {
      const opened: string[] = [];
      const { stdin } = render(
        <KbScreen {...baseProps({ onOpenDiagram: (id) => opened.push(id) })} />,
      );
      await flush();
      await focusProductEntry(stdin);
      await press(stdin, 'o');
      expect(opened).toEqual([]);
    });
  });

  it('renders at three canonical terminal widths without throwing', () => {
    for (const columns of [60, 100, 160]) {
      const mode: RenderMode = { ...MODE, columns };
      expect(() => render(<KbScreen {...baseProps({ mode })} />)).not.toThrow();
    }
  });
});
