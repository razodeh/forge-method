/**
 * `SpecGraph` — `09` §9.4's typed traceability graph.
 *
 * @see specs/09 §9.4
 * @see PLAN-M1.md P14
 * @see SPEC-QUESTIONS.md Q31
 */
import { describe, expect, it } from 'vitest';

import { ArtifactDocument } from '../../src/artifacts/document.ts';
import { REQUIRED_EDGES, SpecGraph } from '../../src/graph/index.ts';

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

const orphanCapability = makeDoc('Capability', 'CAP-002', [
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

const orphanEpic = makeDoc('Epic', 'EPIC-002', [
  'capability: CAP-999',
  "stage: 'x'",
  "goal: 'x'",
  'scope_in: []',
  'scope_out: []',
  'stories: []',
  'interfaces: []',
  'data: []',
  'exit_criteria: []',
]);

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

// Two tests proving the same AC — legal, "an AC may have many tests".
const story1 = makeDoc(
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
    "  - 'AC-001-1 first test'",
    "  - 'AC-001-1 second test'",
    "  - 'TEST-198 headless test'",
  ]),
);

// A test naming two different ACs from two different stories — the cardinality violation.
const story2 = makeDoc(
  'Story',
  'STORY-002',
  storyLines('EPIC-001', [
    'acceptance:',
    '  - id: AC-002-1',
    "    given: 'g'",
    "    when: 'w'",
    "    then: 't'",
    '    kind: functional',
    'tests:',
    "  - 'AC-001-1, AC-002-1 shared validation'",
  ]),
);

// No parent Epic at all (EPIC-999 does not exist in this corpus).
const story3 = makeDoc(
  'Story',
  'STORY-003',
  storyLines('EPIC-999', ['acceptance: []', 'tests: []']),
);

const story4 = makeDoc('Story', 'STORY-004', [
  'epic: EPIC-001',
  'capability: CAP-001',
  'storyType: feature',
  'size: S',
  "owner_role: 'eng'",
  "depends_on: ['STORY-005']",
  'blocked_by: []',
  'interfaces: []',
  'data: []',
  'files_expected: []',
  'context_refs: []',
  'acceptance: []',
  'tests: []',
  "dod_profile: 'standard'",
]);

const story5 = makeDoc('Story', 'STORY-005', [
  'epic: EPIC-001',
  'capability: CAP-001',
  'storyType: feature',
  'size: S',
  "owner_role: 'eng'",
  "depends_on: ['STORY-004']",
  'blocked_by: []',
  'interfaces: []',
  'data: []',
  'files_expected: []',
  'context_refs: []',
  'acceptance: []',
  'tests: []',
  "dod_profile: 'standard'",
]);

const fullCorpus = [
  vision,
  capability,
  orphanCapability,
  epic,
  orphanEpic,
  story1,
  story2,
  story3,
  story4,
  story5,
];

describe('REQUIRED_EDGES — 09 §9.4 transcribed row-for-row', () => {
  it('has exactly the eleven rows the table declares', () => {
    expect(REQUIRED_EDGES).toEqual([
      { from: 'CAP', edge: 'realises', to: 'VIS', required: 'yes' },
      { from: 'EPIC', edge: 'delivers', to: 'CAP', required: 'yes' },
      { from: 'STORY', edge: 'partOf', to: 'EPIC', required: 'yes' },
      { from: 'AC', edge: 'belongsTo', to: 'STORY', required: 'yes' },
      {
        from: 'TEST',
        edge: 'proves',
        to: 'AC',
        required: 'yes',
        note: '1 test proves exactly 1 AC; an AC may have many tests',
      },
      { from: 'TASK', edge: 'implements', to: 'STORY', required: 'yes' },
      { from: 'COMMIT', edge: 'implements', to: 'STORY', required: 'yes', note: 'via trailer' },
      {
        from: 'FILE',
        edge: 'primaryFor',
        to: 'STORY',
        required: 'advisory',
        note: 'from claims + commit history',
      },
      { from: 'ADR', edge: 'constrains', to: 'EPIC/STORY/component', required: 'as-applicable' },
      {
        from: 'INT',
        edge: 'consumedBy',
        to: 'STORY',
        required: 'conditional',
        note: 'when the story calls it',
      },
      { from: 'NFR', edge: 'verifiedBy', to: 'TEST/benchmark/monitor', required: 'yes' },
    ]);
  });
});

describe('SpecGraph.build — the traceability chain', () => {
  it('links CAP realises VIS, EPIC delivers CAP, STORY partOf EPIC, AC belongsTo STORY', () => {
    const graph = SpecGraph.build(fullCorpus);
    expect(graph.parentsOf('CAP-001').map((n) => n.id)).toEqual(['VIS-001']);
    expect(graph.parentsOf('EPIC-001').map((n) => n.id)).toEqual(['CAP-001']);
    expect(graph.parentsOf('STORY-001').map((n) => n.id)).toEqual(['EPIC-001']);
    expect(graph.parentsOf('AC-001-1').map((n) => n.id)).toEqual(['STORY-001']);
    expect(graph.childrenOf('EPIC-001').map((n) => n.id)).toContain('STORY-001');
    expect(graph.childrenOf('CAP-001').map((n) => n.id)).toContain('EPIC-001');
  });

  it('proves an AC from a test name and allows many tests per AC (no violation)', () => {
    const graph = SpecGraph.build(fullCorpus);
    const testNode = graph.edges().find((e) => e.from === 'AC-001-1 first test');
    expect(testNode).toEqual({ from: 'AC-001-1 first test', edge: 'proves', to: 'AC-001-1' });
    const testNode2 = graph.edges().find((e) => e.from === 'AC-001-1 second test');
    expect(testNode2).toEqual({ from: 'AC-001-1 second test', edge: 'proves', to: 'AC-001-1' });
    expect(
      graph
        .missingRequiredEdges()
        .some(
          (v) => v.code === 'SPEC-022' && v.details['test']?.toString().startsWith('AC-001-1 '),
        ),
    ).toBe(false);
  });
});

describe('SpecGraph.build — violations', () => {
  it('flags a story with no parent epic as SPEC-021', () => {
    const graph = SpecGraph.build(fullCorpus);
    const violation = graph
      .missingRequiredEdges()
      .find((v) => v.code === 'SPEC-021' && v.details['artifact'] === 'STORY-003');
    expect(violation).toBeDefined();
    expect(violation?.message).toBe('STORY-003 has no parent Epic.');
  });

  it('flags an epic with no parent capability as SPEC-021', () => {
    const graph = SpecGraph.build(fullCorpus);
    const violation = graph
      .missingRequiredEdges()
      .find((v) => v.code === 'SPEC-021' && v.details['artifact'] === 'EPIC-002');
    expect(violation?.message).toBe('EPIC-002 has no parent Capability.');
  });

  it('flags a test proving two ACs as SPEC-022, and lists both AC ids', () => {
    const graph = SpecGraph.build(fullCorpus);
    const violation = graph.missingRequiredEdges().find((v) => v.code === 'SPEC-022');
    expect(violation).toBeDefined();
    expect(violation?.details['test']).toBe('AC-001-1, AC-002-1 shared validation');
    expect(violation?.details['acs']).toBe('AC-001-1, AC-002-1');
  });

  it('does not flag a capability as missing its Vision when one is present', () => {
    const graph = SpecGraph.build(fullCorpus);
    expect(graph.missingRequiredEdges().some((v) => v.details['artifact'] === 'CAP-001')).toBe(
      false,
    );
  });

  it('flags a capability as missing its Vision when none is present at all', () => {
    const graph = SpecGraph.build([capability, epic]);
    const violation = graph
      .missingRequiredEdges()
      .find((v) => v.code === 'SPEC-021' && v.details['artifact'] === 'CAP-001');
    expect(violation?.message).toBe('CAP-001 has no parent Vision.');
  });
});

describe('SpecGraph.build — orphans', () => {
  it('finds the orphan story and the orphan test, per the 09 §9.4 example output', () => {
    const graph = SpecGraph.build(fullCorpus);
    const orphans = graph.orphans();
    expect(orphans).toContainEqual({
      kind: 'STORY',
      id: 'STORY-003',
      reason: 'has no parent Epic',
    });
    expect(orphans).toContainEqual({
      kind: 'TEST',
      id: 'TEST-198 headless test',
      reason: 'proves no AC',
    });
  });

  it('does not report a story or test that resolves cleanly as an orphan', () => {
    const graph = SpecGraph.build(fullCorpus);
    const orphans = graph.orphans();
    expect(orphans.some((o) => o.id === 'STORY-001')).toBe(false);
    expect(orphans.some((o) => o.id === 'AC-001-1 first test')).toBe(false);
  });
});

describe('SpecGraph.build — cycle detection', () => {
  it('detects a STORY-A depends_on STORY-B depends_on STORY-A cycle and renders it', () => {
    const graph = SpecGraph.build(fullCorpus);
    const cycles = graph.detectCycles();
    expect(cycles).toHaveLength(1);
    expect(graph.renderCycle(cycles[0] as { path: readonly string[] })).toMatch(
      /^STORY-00[45] → STORY-00[45] → STORY-00[45]$/,
    );
  });

  it('finds no cycles in a corpus with no depends_on loop', () => {
    const graph = SpecGraph.build([vision, capability, epic, story1]);
    expect(graph.detectCycles()).toEqual([]);
  });

  it('does not crash on a depends_on reference to a story that does not exist', () => {
    const dangling = makeDoc('Story', 'STORY-908', [
      'epic: EPIC-001',
      'capability: CAP-001',
      'storyType: feature',
      'size: S',
      "owner_role: 'eng'",
      "depends_on: ['STORY-999']",
      'blocked_by: []',
      'interfaces: []',
      'data: []',
      'files_expected: []',
      'context_refs: []',
      'acceptance: []',
      'tests: []',
      "dod_profile: 'standard'",
    ]);
    const graph = SpecGraph.build([vision, capability, epic, dangling]);
    expect(graph.detectCycles()).toEqual([]);
  });

  it('visits a story shared by two independent dependents only once (no false cycle)', () => {
    function dependsOnStory(id: string, dependency: string): ArtifactDocument {
      return makeDoc('Story', id, [
        'epic: EPIC-001',
        'capability: CAP-001',
        'storyType: feature',
        'size: S',
        "owner_role: 'eng'",
        `depends_on: ['${dependency}']`,
        'blocked_by: []',
        'interfaces: []',
        'data: []',
        'files_expected: []',
        'context_refs: []',
        'acceptance: []',
        'tests: []',
        "dod_profile: 'standard'",
      ]);
    }
    const shared = dependsOnStory('STORY-912', 'STORY-913');
    const p = dependsOnStory('STORY-910', 'STORY-912');
    const q = dependsOnStory('STORY-911', 'STORY-912');
    const leaf = makeDoc('Story', 'STORY-913', [
      'epic: EPIC-001',
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
      'acceptance: []',
      'tests: []',
      "dod_profile: 'standard'",
    ]);
    const graph = SpecGraph.build([vision, capability, epic, p, q, shared, leaf]);
    expect(graph.detectCycles()).toEqual([]);
  });
});

describe('SpecGraph.build — determinism (QUALITY-BAR.md R10)', () => {
  it('produces an identical graph and violation ordering regardless of input document order', () => {
    const shuffled = [...fullCorpus].reverse();
    const graphA = SpecGraph.build(fullCorpus);
    const graphB = SpecGraph.build(shuffled);

    expect(graphB.nodes()).toEqual(graphA.nodes());
    expect(graphB.edges()).toEqual(graphA.edges());
    expect(graphB.orphans()).toEqual(graphA.orphans());
    expect(graphB.missingRequiredEdges().map((v) => v.toJSON())).toEqual(
      graphA.missingRequiredEdges().map((v) => v.toJSON()),
    );
  });
});
