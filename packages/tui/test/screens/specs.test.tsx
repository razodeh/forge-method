/**
 * `<SpecsScreen>` -- `04` §4.3 S3: the spec-graph tree, traceability path-to-root, orphans filter, and
 * traceability matrix.
 *
 * `makeDoc`/the fixture corpus below mirrors `packages/core/test/graph/spec-graph.test.ts`'s own real,
 * schema-valid front-matter shape (via the real `ArtifactDocument.parse` + `SpecGraph.build`), rather
 * than a hand-built fake `SpecGraph` -- this screen's own logic (`buildTree`/`buildMatrix`/
 * `traceabilityPathToRoot`) depends on `@forge/core/graph`'s own real edge set, and `buildGraphData`
 * (confirmed directly) only ever constructs `realises`/`delivers`/`partOf`/`belongsTo`/`proves` edges
 * today -- `implements` (Task) and `constrains` (ADR) are a real, disclosed, pre-existing gap in that
 * package itself (its own top doc comment: "deliberately deferred"), not something this screen's own
 * tests should fake past.
 *
 * See `list-pane.test.tsx`'s own header comment for why every test that presses a key awaits `flush()`
 * once right after `render()`, before the first `stdin.write()`.
 *
 * @see specs/04 §4.3 S3
 * @see PLAN-M9.md P9
 */
import { ArtifactDocument } from '@forge/core/artifacts';
import { SpecGraph } from '@forge/core/graph';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';

import type { RenderMode } from '../../src/env.ts';
import { SpecsScreen, traceabilityPathToRoot } from '../../src/screens/specs.tsx';
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

function baseLines(type: string, id: string): string[] {
  return [
    `id: ${id}`,
    `type: ${type}`,
    'schemaVersion: 1',
    "title: 'Title'",
    'status: draft',
    'created: 2026-01-15',
    'updated: 2026-01-15',
    'revision: 1',
    'author: po',
    'changelog: []',
  ];
}

function makeDoc(type: string, id: string, extra: readonly string[]): ArtifactDocument {
  const source = ['---', ...baseLines(type, id), ...extra, '---', '', 'Body.', ''].join('\n');
  return ArtifactDocument.parse(source, `${id}.md`);
}

function storyLines(epicId: string, extra: readonly string[]): string[] {
  return [
    `epic: ${epicId}`,
    'capability: CAP-001',
    'storyType: feature',
    'size: S',
    "owner_role: 'eng'",
    'depends_on: []',
    'blocked_by: []',
    'interfaces: []',
    'data: []',
    'files_expected: []',
    'context_refs: []',
    ...extra,
    "dod_profile: 'standard'",
  ];
}

const vision = makeDoc('Vision', 'VIS-001', [
  "product: 'P'",
  "one_liner: 'x'",
  "problem: 'x'",
  'target_users: []',
  "value_hypothesis: 'x'",
  'success_metrics: []',
  'non_goals: []',
  "horizon: 'x'",
]);

const capability = makeDoc('Capability', 'CAP-001', [
  "statement: 'x'",
  'priority: should',
  "stage: 'x'",
  'depends_on: []',
  'nfrs: []',
  'metrics: []',
  "acceptance_summary: 'x'",
  'epics: []',
]);

const epic = makeDoc('Epic', 'EPIC-001', [
  'capability: CAP-001',
  "stage: 'x'",
  "goal: 'x'",
  'scope_in: []',
  'scope_out: []',
  'stories: []',
  'interfaces: []',
  'data: []',
  'exit_criteria: []',
]);

// Covered: one AC, one test correctly naming it.
const coveredStory = makeDoc(
  'Story',
  'STORY-001',
  storyLines('EPIC-001', [
    'acceptance:',
    '  - id: AC-001-1',
    "    given: 'g'",
    "    when: 'w'",
    "    then: 't'",
    '    kind: functional',
    'tests:',
    "  - 'AC-001-1 proves it works'",
  ]),
);

// Uncovered: an AC with no test naming it -- a real SPEC-021/022-free "just plain missing" case.
const uncoveredStory = makeDoc(
  'Story',
  'STORY-002',
  storyLines('EPIC-001', [
    'acceptance:',
    '  - id: AC-002-1',
    "    given: 'g'",
    "    when: 'w'",
    "    then: 't'",
    '    kind: functional',
    'tests: []',
  ]),
);

// No parent Epic at all -- a real orphan.
const orphanStory = makeDoc(
  'Story',
  'STORY-003',
  storyLines('EPIC-999', ['acceptance: []', 'tests: []']),
);

function buildGraph(): SpecGraph {
  return SpecGraph.build([vision, capability, epic, coveredStory, uncoveredStory, orphanStory]);
}

// A second Capability with exactly one (uncovered) Story -- a shorter matrix row than CAP-001's two,
// for exercising the up/down row-change cursor-clamp fix.
const capability2 = makeDoc('Capability', 'CAP-002', [
  "statement: 'x'",
  'priority: should',
  "stage: 'x'",
  'depends_on: []',
  'nfrs: []',
  'metrics: []',
  "acceptance_summary: 'x'",
  'epics: []',
]);

const epic2 = makeDoc('Epic', 'EPIC-002', [
  'capability: CAP-002',
  "stage: 'x'",
  "goal: 'x'",
  'scope_in: []',
  'scope_out: []',
  'stories: []',
  'interfaces: []',
  'data: []',
  'exit_criteria: []',
]);

const shortRowStory = makeDoc(
  'Story',
  'STORY-004',
  storyLines('EPIC-002', ['acceptance: []', 'tests: []']).map((line) =>
    line.startsWith('capability:') ? 'capability: CAP-002' : line,
  ),
);

function buildTwoCapabilityGraph(): SpecGraph {
  return SpecGraph.build([
    vision,
    capability,
    capability2,
    epic,
    epic2,
    coveredStory,
    uncoveredStory,
    orphanStory,
    shortRowStory,
  ]);
}

function baseProps(overrides: Partial<Parameters<typeof SpecsScreen>[0]> = {}) {
  return {
    mode: MODE,
    readModel: INITIAL_RUN_READ_MODEL,
    focusedPaneIndex: 0,
    graph: buildGraph(),
    onCommand: () => undefined,
    ...overrides,
  };
}

describe('traceabilityPathToRoot', () => {
  it('walks Story -> Epic -> Capability -> Vision, in that order', () => {
    const graph = buildGraph();
    expect(traceabilityPathToRoot(graph, 'STORY-001')).toEqual([
      'STORY-001',
      'EPIC-001',
      'CAP-001',
      'VIS-001',
    ]);
  });

  it('a node with no parent at all (Vision) is a path of just itself', () => {
    const graph = buildGraph();
    expect(traceabilityPathToRoot(graph, 'VIS-001')).toEqual(['VIS-001']);
  });

  it('a real orphan Story (no parent Epic) is a path of just itself, not a crash', () => {
    const graph = buildGraph();
    expect(traceabilityPathToRoot(graph, 'STORY-003')).toEqual(['STORY-003']);
  });
});

describe('<SpecsScreen>', () => {
  it('renders the primary hierarchy: Vision, Capability, and (once expanded) Epic/Story rows', async () => {
    const { lastFrame, stdin } = render(<SpecsScreen {...baseProps()} />);
    await flush();
    let frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('VIS VIS-001');
    expect(frame).not.toContain('CAP-001');

    await press(stdin, RIGHT); // expand Vision
    frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('CAP CAP-001');

    await press(stdin, DOWN);
    await press(stdin, RIGHT); // expand Capability
    frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('EPIC EPIC-001');
  });

  it('a covered Story shows a real test-count cross-link suffix; an uncovered one shows none', async () => {
    const { lastFrame, stdin } = render(<SpecsScreen {...baseProps()} />);
    await flush();
    await press(stdin, RIGHT); // expand VIS
    await press(stdin, DOWN);
    await press(stdin, RIGHT); // expand CAP
    await press(stdin, DOWN);
    await press(stdin, RIGHT); // expand EPIC
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('STORY STORY-001 · ⚭ 1 test');
    expect(frame).toContain('STORY STORY-002');
    expect(frame).not.toContain('STORY-002 · ⚭');
  });

  describe('t (traceability path to root)', () => {
    it('shows the path for whichever node the tree currently has focused', async () => {
      const { lastFrame, stdin } = render(<SpecsScreen {...baseProps()} />);
      await flush();
      await press(stdin, 't');
      expect(stripAnsi(lastFrame() ?? '')).toContain('VIS-001');

      await press(stdin, RIGHT); // expand VIS -- focus stays on VIS-001
      await press(stdin, DOWN); // focus moves to CAP-001
      await press(stdin, 't');
      expect(stripAnsi(lastFrame() ?? '')).toContain('CAP-001 → VIS-001');
    });

    it('ascii mode joins the path with "->" instead of the Unicode "→"', async () => {
      const { lastFrame, stdin } = render(
        <SpecsScreen {...baseProps({ mode: { ...MODE, ascii: true } })} />,
      );
      await flush();
      await press(stdin, RIGHT); // expand VIS -- focus stays on VIS-001
      await press(stdin, DOWN); // focus moves to CAP-001
      await press(stdin, 't');
      const frame = stripAnsi(lastFrame() ?? '');
      expect(frame).toContain('CAP-001 -> VIS-001');
      expect(frame).not.toContain('→');
    });

    it('never emits a command -- a pure local view concern', async () => {
      const commands: EngineCommand[] = [];
      const { stdin } = render(
        <SpecsScreen {...baseProps({ onCommand: (c) => commands.push(c) })} />,
      );
      await flush();
      await press(stdin, 't');
      expect(commands).toEqual([]);
    });

    it('the trace panel is cleared, not left stale, when switching away to orphans or the matrix', async () => {
      const { lastFrame, stdin } = render(<SpecsScreen {...baseProps()} />);
      await flush();
      await press(stdin, 't');
      expect(stripAnsi(lastFrame() ?? '')).toContain('VIS-001');

      await press(stdin, 'x');
      expect(stripAnsi(lastFrame() ?? '')).not.toContain('Traceability path to root');

      await press(stdin, 'x'); // back to tree
      await press(stdin, 't');
      expect(stripAnsi(lastFrame() ?? '')).toContain('Traceability path to root');

      await press(stdin, 'm');
      expect(stripAnsi(lastFrame() ?? '')).not.toContain('Traceability path to root');
    });
  });

  describe('x (orphans-only filter)', () => {
    it('shows exactly the known orphan Story, nothing else, and toggles back off', async () => {
      const { lastFrame, stdin } = render(<SpecsScreen {...baseProps()} />);
      await flush();
      await press(stdin, 'x');
      const frame = stripAnsi(lastFrame() ?? '');
      expect(frame).toContain('STORY STORY-003');
      expect(frame).toContain('has no parent Epic');
      expect(frame).not.toContain('VIS VIS-001');
      expect(frame).not.toContain('STORY-001');

      await press(stdin, 'x');
      expect(stripAnsi(lastFrame() ?? '')).toContain('VIS VIS-001');
    });
  });

  describe('n (new artifact from template)', () => {
    it('emits exactly one spec.newArtifactFromTemplate for the currently-focused node', async () => {
      const commands: EngineCommand[] = [];
      const { stdin } = render(
        <SpecsScreen {...baseProps({ onCommand: (c) => commands.push(c) })} />,
      );
      await flush();
      await press(stdin, 'n');
      expect(commands).toEqual([{ type: 'spec.newArtifactFromTemplate', parentId: 'VIS-001' }]);
    });
  });

  describe('e (edit then auto-validate)', () => {
    it('emits spec.edit immediately followed by spec.validate, both for the focused node, in that order', async () => {
      const commands: EngineCommand[] = [];
      const { stdin } = render(
        <SpecsScreen {...baseProps({ onCommand: (c) => commands.push(c) })} />,
      );
      await flush();
      await press(stdin, 'e');
      expect(commands).toEqual([
        { type: 'spec.edit', artifactId: 'VIS-001' },
        { type: 'spec.validate', artifactId: 'VIS-001' },
      ]);
    });
  });

  describe('m (traceability matrix)', () => {
    it('marks the covered Story with a check and the uncovered one with an X, under the right Capability row', async () => {
      const { lastFrame, stdin } = render(<SpecsScreen {...baseProps()} />);
      await flush();
      await press(stdin, 'm');
      const frame = stripAnsi(lastFrame() ?? '');
      expect(frame).toContain('CAP-001:');
      expect(frame).toContain('✓');
      expect(frame).toContain('✗');
    });

    it('ascii mode uses +/x instead of the Unicode ✓/✗ marks -- a round-1 P15 critic found MatrixView never accepted a mode prop at all', async () => {
      const { lastFrame, stdin } = render(
        <SpecsScreen {...baseProps({ mode: { ...MODE, ascii: true } })} />,
      );
      await flush();
      await press(stdin, 'm');
      const frame = stripAnsi(lastFrame() ?? '');
      expect(frame).toContain('CAP-001:');
      expect(frame).toContain('+');
      expect(frame).toContain('x');
      expect(frame).not.toContain('✓');
      expect(frame).not.toContain('✗');
    });

    it('pressing m again returns to the tree view', async () => {
      const { lastFrame, stdin } = render(<SpecsScreen {...baseProps()} />);
      await flush();
      await press(stdin, 'm');
      expect(stripAnsi(lastFrame() ?? '')).toContain('CAP-001:');
      await press(stdin, 'm');
      expect(stripAnsi(lastFrame() ?? '')).toContain('VIS VIS-001');
    });

    it('Enter on the uncovered (X) cell emits spec.newArtifactFromTemplate for that Story; Enter on a covered cell emits nothing', async () => {
      const commands: EngineCommand[] = [];
      const { stdin } = render(
        <SpecsScreen {...baseProps({ onCommand: (c) => commands.push(c) })} />,
      );
      await flush();
      await press(stdin, 'm');
      // Cursor starts at (row 0, col 0) -- STORY-001, the covered one (sorted before STORY-002).
      await press(stdin, '\r');
      expect(commands).toEqual([]);

      await press(stdin, RIGHT); // move to col 1 -- STORY-002, uncovered
      await press(stdin, '\r');
      expect(commands).toEqual([{ type: 'spec.newArtifactFromTemplate', parentId: 'STORY-002' }]);
    });

    it('moving down to a row with fewer cells re-clamps col, so Enter on the shorter row still targets its own last real cell, not a stale out-of-range index', async () => {
      const commands: EngineCommand[] = [];
      const props = baseProps({
        graph: buildTwoCapabilityGraph(),
        onCommand: (c) => commands.push(c),
      });
      const { stdin } = render(<SpecsScreen {...props} />);
      await flush();
      await press(stdin, 'm');
      await press(stdin, RIGHT); // CAP-001 row: col 1 -- STORY-002, uncovered
      await press(stdin, '\x1B[B'); // down -- CAP-002 row has only 1 cell (index 0)
      await press(stdin, '\r');
      // If col had stayed stranded at 1, this would silently no-op instead.
      expect(commands).toEqual([{ type: 'spec.newArtifactFromTemplate', parentId: 'STORY-004' }]);
    });

    it("a live graph update that removes the cursor's own row (with no intervening keypress) self-heals to a real, visibly-highlighted cell rather than leaving a vanished cursor", async () => {
      const props = baseProps({ graph: buildTwoCapabilityGraph() });
      const { lastFrame, rerender, stdin } = render(<SpecsScreen {...props} />);
      await flush();
      await press(stdin, 'm');
      await press(stdin, '\x1B[B'); // down -- cursor now on CAP-002's own (only) row
      expect(stripAnsi(lastFrame() ?? '')).toContain('CAP-002:');

      // An external update shrinks the graph back to just CAP-001, with no arrow key in between.
      rerender(<SpecsScreen {...props} graph={buildGraph()} />);
      const frame = stripAnsi(lastFrame() ?? '');
      expect(frame).toContain('CAP-001:');
      // Specifically the correctly-clamped cell (row 0, col 0 -- STORY-001, covered), not just "some"
      // cell -- a hypothetical bug clamping `col` to 1 instead of 0 would still show a highlighted
      // `[✗]` and pass a looser `/[✓✗]/`-only assertion.
      expect(frame).toContain('[✓]');
    });

    it("moving back up from the shorter row restores col within the longer row's own bounds (clamped, not remembered)", async () => {
      const { lastFrame, stdin } = render(
        <SpecsScreen {...baseProps({ graph: buildTwoCapabilityGraph() })} />,
      );
      await flush();
      await press(stdin, 'm');
      await press(stdin, RIGHT); // col 1
      await press(stdin, '\x1B[B'); // down -- clamps to col 0 on the 1-cell row
      await press(stdin, '\x1B[A'); // up -- back to the 2-cell row, cursor still at col 0
      const frame = stripAnsi(lastFrame() ?? '');
      expect(frame).toContain('[✓]'); // STORY-001 (col 0), covered, now highlighted
    });
  });

  it('renders at three canonical terminal widths without throwing', () => {
    for (const columns of [60, 100, 160]) {
      const mode: RenderMode = { ...MODE, columns };
      expect(() => render(<SpecsScreen {...baseProps({ mode })} />)).not.toThrow();
    }
  });

  it('an entirely empty graph renders "No orphans."/"No capabilities." and an empty tree, without throwing', async () => {
    const empty = SpecGraph.build([]);
    const { lastFrame, stdin } = render(<SpecsScreen {...baseProps({ graph: empty })} />);
    await flush();
    expect(stripAnsi(lastFrame() ?? '')).not.toContain('VIS');

    await press(stdin, 'x');
    expect(stripAnsi(lastFrame() ?? '')).toContain('No orphans.');

    await press(stdin, 'x'); // back to tree
    await press(stdin, 'm');
    expect(stripAnsi(lastFrame() ?? '')).toContain('No capabilities.');
  });

  it('a Story proven by two distinct tests pluralizes the cross-link suffix correctly ("2 tests")', async () => {
    const twoTestStory = makeDoc(
      'Story',
      'STORY-005',
      storyLines('EPIC-001', [
        'acceptance:',
        '  - id: AC-005-1',
        "    given: 'g'",
        "    when: 'w'",
        "    then: 't'",
        '    kind: functional',
        'tests:',
        "  - 'AC-005-1 first test'",
        "  - 'AC-005-1 second test'",
      ]),
    );
    const graph = SpecGraph.build([vision, capability, epic, twoTestStory]);
    const { lastFrame, stdin } = render(<SpecsScreen {...baseProps({ graph })} />);
    await flush();
    await press(stdin, RIGHT); // expand VIS
    await press(stdin, DOWN); // focus CAP
    await press(stdin, RIGHT); // expand CAP
    await press(stdin, DOWN); // focus EPIC
    await press(stdin, RIGHT); // expand EPIC
    expect(stripAnsi(lastFrame() ?? '')).toContain('STORY STORY-005 · ⚭ 2 tests');
  });

  it('a Capability with no reachable Stories at all renders "(no stories)" in the matrix', async () => {
    const bareEpic = makeDoc('Epic', 'EPIC-003', [
      'capability: CAP-001',
      "stage: 'x'",
      "goal: 'x'",
      'scope_in: []',
      'scope_out: []',
      'stories: []',
      'interfaces: []',
      'data: []',
      'exit_criteria: []',
    ]);
    const graph = SpecGraph.build([vision, capability, bareEpic]);
    const { lastFrame, stdin } = render(<SpecsScreen {...baseProps({ graph })} />);
    await flush();
    await press(stdin, 'm');
    expect(stripAnsi(lastFrame() ?? '')).toContain('CAP-001: (no stories)');
  });
});
