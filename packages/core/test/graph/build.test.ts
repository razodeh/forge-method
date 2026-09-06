/**
 * `buildGraphData` — defensive handling of front matter `ArtifactDocument.parse` accepts (it only
 * validates the front matter is a YAML mapping, not that it matches any particular artifact's
 * schema) but that a real scan of a project can still encounter: a malformed `type`/`id`, an
 * out-of-scope artifact type, a duplicate id, a malformed acceptance entry, and a repeated test name.
 *
 * @see specs/09 §9.4
 * @see PLAN-M1.md P14
 */
import { describe, expect, it } from 'vitest';

import { ArtifactDocument } from '../../src/artifacts/document.ts';
import { SpecGraph } from '../../src/graph/index.ts';

function makeDoc(lines: readonly string[], id = 'doc'): ArtifactDocument {
  const source = ['---', ...lines, '---', '', 'Body.', ''].join('\n');
  return ArtifactDocument.parse(source, `${id}.md`);
}

describe('buildGraphData — malformed or out-of-scope front matter', () => {
  it('skips a document whose type is not a string', () => {
    const doc = makeDoc(['id: WEIRD-001', 'type: 42']);
    const graph = SpecGraph.build([doc]);
    expect(graph.nodes()).toEqual([]);
  });

  it('skips a document with no id', () => {
    const doc = makeDoc(['type: Vision']);
    const graph = SpecGraph.build([doc]);
    expect(graph.nodes()).toEqual([]);
  });

  it('skips a registered artifact type outside the 09 §9.4 traceability chain', () => {
    const doc = makeDoc(['id: RISK-001', 'type: Risk']);
    const graph = SpecGraph.build([doc]);
    expect(graph.nodes()).toEqual([]);
  });

  it('keeps only one node when two documents share an id', () => {
    const first = makeDoc(['id: VIS-001', 'type: Vision'], 'first');
    const second = makeDoc(['id: VIS-001', 'type: Vision'], 'second');
    const graph = SpecGraph.build([first, second]);
    expect(graph.nodes()).toEqual([{ kind: 'VIS', id: 'VIS-001' }]);
  });

  it('produces exactly one delivers edge, from the candidate with the smallest path, when two Epics share an id — regardless of document order', () => {
    const capA = makeDoc(['id: CAP-950', 'type: Capability'], 'cap-a');
    const capB = makeDoc(['id: CAP-951', 'type: Capability'], 'cap-b');
    // 'epic-a.md' sorts before 'epic-b.md' — the winner is decided by path, not by which of these two
    // appears first in the `docs` array passed to `SpecGraph.build`.
    const epicA = makeDoc(['id: EPIC-950', 'type: Epic', 'capability: CAP-950'], 'epic-a');
    const epicB = makeDoc(['id: EPIC-950', 'type: Epic', 'capability: CAP-951'], 'epic-b');

    const forward = SpecGraph.build([capA, capB, epicA, epicB]);
    const reversed = SpecGraph.build([capA, capB, epicB, epicA]);

    // Never both: a second document sharing an id must not also contribute an edge, or EPIC-950
    // would have two `delivers` edges `from` the same id.
    expect(forward.edges().filter((e) => e.from === 'EPIC-950')).toHaveLength(1);
    expect(reversed.edges().filter((e) => e.from === 'EPIC-950')).toHaveLength(1);
    // The same winner (epic-a.md, the smaller path) either way — order-independent (R10).
    expect(forward.parentsOf('EPIC-950').map((n) => n.id)).toEqual(['CAP-950']);
    expect(reversed.parentsOf('EPIC-950').map((n) => n.id)).toEqual(['CAP-950']);
  });

  it('resolves CAP realises VIS to the same, lexicographically-smallest Vision id regardless of document order', () => {
    const visionA = makeDoc(['id: VIS-002', 'type: Vision'], 'vision-a');
    const visionB = makeDoc(['id: VIS-001', 'type: Vision'], 'vision-b');
    const cap = makeDoc(['id: CAP-960', 'type: Capability'], 'cap');

    const forward = SpecGraph.build([visionA, visionB, cap]);
    const reversed = SpecGraph.build([visionB, visionA, cap]);

    expect(forward.parentsOf('CAP-960').map((n) => n.id)).toEqual(['VIS-001']);
    expect(reversed.parentsOf('CAP-960').map((n) => n.id)).toEqual(['VIS-001']);
  });

  it('flags an acceptance criterion id claimed by more than one story as SPEC-023', () => {
    const storyA = makeDoc(
      [
        'id: STORY-960',
        'type: Story',
        'epic: EPIC-900',
        'acceptance:',
        '  - id: AC-960-1',
        'tests: []',
      ],
      'story-960-a',
    );
    const storyB = makeDoc(
      [
        'id: STORY-961',
        'type: Story',
        'epic: EPIC-900',
        'acceptance:',
        '  - id: AC-960-1',
        'tests: []',
      ],
      'story-960-b',
    );
    const graph = SpecGraph.build([storyA, storyB]);
    const violation = graph
      .missingRequiredEdges()
      .find((v) => v.code === 'SPEC-023' && v.details['acId'] === 'AC-960-1');
    expect(violation?.message).toBe(
      'Acceptance criterion AC-960-1 is claimed by more than one story: STORY-960, STORY-961.',
    );
  });

  it('does not flag an acceptance criterion id declared by only one story', () => {
    const graph = SpecGraph.build([
      makeDoc(
        [
          'id: STORY-962',
          'type: Story',
          'epic: EPIC-900',
          'acceptance:',
          '  - id: AC-962-1',
          'tests: []',
        ],
        'story-962',
      ),
    ]);
    expect(graph.missingRequiredEdges().some((v) => v.code === 'SPEC-023')).toBe(false);
  });

  it('skips a non-object entry in a Story acceptance array', () => {
    const doc = makeDoc([
      'id: STORY-900',
      'type: Story',
      'epic: EPIC-900',
      'acceptance:',
      '  - just a string',
      'tests: []',
    ]);
    const graph = SpecGraph.build([doc]);
    expect(graph.nodes().some((node) => node.kind === 'AC')).toBe(false);
  });

  it('skips an acceptance entry with no id', () => {
    const doc = makeDoc([
      'id: STORY-901',
      'type: Story',
      'epic: EPIC-900',
      'acceptance:',
      '  - given: g',
      'tests: []',
    ]);
    const graph = SpecGraph.build([doc]);
    expect(graph.nodes().some((node) => node.kind === 'AC')).toBe(false);
  });

  it('keeps only the first AC node when two stories declare the same AC id', () => {
    const storyA = makeDoc(
      [
        'id: STORY-902',
        'type: Story',
        'epic: EPIC-900',
        'acceptance:',
        '  - id: AC-902-1',
        'tests: []',
      ],
      'story-a',
    );
    const storyB = makeDoc(
      [
        'id: STORY-903',
        'type: Story',
        'epic: EPIC-900',
        'acceptance:',
        '  - id: AC-902-1',
        'tests: []',
      ],
      'story-b',
    );
    const graph = SpecGraph.build([storyA, storyB]);
    expect(graph.nodes().filter((node) => node.id === 'AC-902-1')).toHaveLength(1);
    expect(graph.parentsOf('AC-902-1').map((n) => n.id)).toEqual(['STORY-902']);
  });

  it('treats an empty-string epic as no parent, not a dangling reference', () => {
    const doc = makeDoc([
      'id: STORY-904',
      'type: Story',
      "epic: ''",
      'acceptance: []',
      'tests: []',
    ]);
    const graph = SpecGraph.build([doc]);
    const violation = graph
      .missingRequiredEdges()
      .find((v) => v.details['artifact'] === 'STORY-904');
    expect(violation?.message).toBe('STORY-904 has no parent Epic.');
  });

  it('treats a non-array tests field as no tests, without crashing', () => {
    const doc = makeDoc([
      'id: STORY-905',
      'type: Story',
      'epic: EPIC-900',
      'acceptance: []',
      "tests: 'not an array'",
    ]);
    const graph = SpecGraph.build([doc]);
    expect(graph.nodes().some((node) => node.kind === 'TEST')).toBe(false);
  });

  it('treats a non-array acceptance field as no acceptance criteria, without crashing', () => {
    const doc = makeDoc([
      'id: STORY-908',
      'type: Story',
      'epic: EPIC-900',
      "acceptance: 'not an array'",
      'tests: []',
    ]);
    const graph = SpecGraph.build([doc]);
    expect(graph.nodes().some((node) => node.kind === 'AC')).toBe(false);
  });

  it('makes an orphan test out of a test naming an AC id that does not exist', () => {
    const doc = makeDoc([
      'id: STORY-909',
      'type: Story',
      'epic: EPIC-900',
      'acceptance: []',
      'tests:',
      "  - 'AC-999-9 references a nonexistent AC'",
    ]);
    const graph = SpecGraph.build([doc]);
    expect(graph.orphans()).toContainEqual({
      kind: 'TEST',
      id: 'AC-999-9 references a nonexistent AC',
      reason: 'proves no AC',
    });
  });

  it('combines a repeated test name across two stories into a single TEST node', () => {
    const storyA = makeDoc(
      [
        'id: STORY-906',
        'type: Story',
        'epic: EPIC-900',
        'acceptance:',
        '  - id: AC-906-1',
        'tests:',
        "  - 'AC-906-1 shared test'",
      ],
      'story-shared-a',
    );
    const storyB = makeDoc(
      [
        'id: STORY-907',
        'type: Story',
        'epic: EPIC-900',
        'acceptance: []',
        'tests:',
        "  - 'AC-906-1 shared test'",
      ],
      'story-shared-b',
    );
    const graph = SpecGraph.build([storyA, storyB]);
    expect(graph.nodes().filter((node) => node.id === 'AC-906-1 shared test')).toHaveLength(1);
    expect(graph.edges().find((e) => e.from === 'AC-906-1 shared test')).toEqual({
      from: 'AC-906-1 shared test',
      edge: 'proves',
      to: 'AC-906-1',
    });
  });
});
