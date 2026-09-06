/**
 * `parseDiagram` — `08` §8.11.1/§8.11.2, `SPEC-QUESTIONS.md` Q45.
 *
 * @see PLAN-M3.md P1
 */
import { isForgeError } from '@forge/core';
import { describe, expect, it } from 'vitest';

import { DIAGRAM_KINDS, parseDiagram } from '../../src/index.ts';

const WORKED_EXAMPLES: Record<(typeof DIAGRAM_KINDS)[number], string> = {
  flowchart: `flowchart TB
  A[Start] --> B{Decision}
  B -->|yes| C[End]
  B -->|no| A`,
  sequenceDiagram: `sequenceDiagram
  Alice->>Bob: Hello
  Bob-->>Alice: Hi`,
  'stateDiagram-v2': `stateDiagram-v2
  [*] --> Idle
  Idle --> Running
  Running --> [*]`,
  erDiagram: `erDiagram
  CUSTOMER ||--o{ ORDER : places`,
  gantt: `gantt
  title A Gantt
  section S1
  Task1: 2024-01-01, 3d`,
  C4Context: `C4Context
  Person(customer, "Customer")
  System(sys, "System")
  Rel(customer, sys, "uses")`,
  C4Container: `C4Container
  Container(api, "API")
  Container(web, "Web")
  Rel(web, api, "calls")`,
  C4Component: `C4Component
  Component(handler, "Handler")
  Component(store, "Store")
  Rel(handler, store, "reads")`,
  C4Deployment: `C4Deployment
  Deployment_Node(node1, "Node") {
    Container(api, "API")
    Container(worker, "Worker")
    Rel(api, worker, "enqueues")
  }`,
  quadrantChart: `quadrantChart
  title Reach vs influence
  x-axis Low --> High
  y-axis Low --> High
  Campaign A: [0.3, 0.6]`,
};

const GRAPH_SHAPED_KINDS = new Set([
  'flowchart',
  'stateDiagram-v2',
  'erDiagram',
  'sequenceDiagram',
  'C4Context',
  'C4Container',
  'C4Component',
  'C4Deployment',
]);

describe('parseDiagram', () => {
  it.each(DIAGRAM_KINDS)('parses a worked %s example without throwing', async (kind) => {
    const result = await parseDiagram(WORKED_EXAMPLES[kind]);
    expect(result.kind).toBe(kind);
  });

  it.each([...GRAPH_SHAPED_KINDS])(
    'extracts real nodes and edges for the graph-shaped kind %s',
    async (kind) => {
      const result = await parseDiagram(WORKED_EXAMPLES[kind as keyof typeof WORKED_EXAMPLES]);
      expect(result.nodes.length).toBeGreaterThan(0);
      expect(result.edges.length).toBeGreaterThan(0);
    },
  );

  it.each(DIAGRAM_KINDS.filter((kind) => !GRAPH_SHAPED_KINDS.has(kind)))(
    'reports an intentionally empty graph for the non-graph-shaped kind %s',
    async (kind) => {
      const result = await parseDiagram(WORKED_EXAMPLES[kind]);
      expect(result.nodes).toEqual([]);
      expect(result.edges).toEqual([]);
    },
  );

  it('extracts flowchart node labels and edge direction exactly as written', async () => {
    const result = await parseDiagram(WORKED_EXAMPLES.flowchart);
    expect(result.nodes).toEqual(
      expect.arrayContaining([
        { id: 'A', label: 'Start' },
        { id: 'B', label: 'Decision' },
        { id: 'C', label: 'End' },
      ]),
    );
    expect(result.edges).toEqual(
      expect.arrayContaining([
        { from: 'A', to: 'B' },
        { from: 'B', to: 'C', label: 'yes' },
        { from: 'B', to: 'A', label: 'no' },
      ]),
    );
  });

  it('groups flowchart subgraph members under one subgraph entry', async () => {
    const result = await parseDiagram(`flowchart TB
  subgraph SG1 [Group One]
    A[Start] --> B[Middle]
  end
  B --> C[End]`);
    expect(result.subgraphs).toEqual([{ id: 'SG1', nodeIds: ['A', 'B'] }]);
  });

  it('extracts sequence diagram actors and messages', async () => {
    const result = await parseDiagram(WORKED_EXAMPLES.sequenceDiagram);
    expect(result.nodes).toEqual(
      expect.arrayContaining([
        { id: 'Alice', label: 'Alice' },
        { id: 'Bob', label: 'Bob' },
      ]),
    );
    expect(result.edges).toEqual([
      { from: 'Alice', to: 'Bob', label: 'Hello' },
      { from: 'Bob', to: 'Alice', label: 'Hi' },
    ]);
  });

  it('round-trips a quoted label containing a pipe character exactly', async () => {
    // A pipe inside double-quoted node text needs no escaping in flowchart syntax — this is the
    // realistic case `mermaid-authoring` (08 §8.11.10) calls out. Mermaid's own HTML-entity-style
    // escapes (`#quot;` etc.) are decoded at render time, not in the parsed `db` data this module
    // reads, so this package intentionally does not attempt that decode itself.
    const result = await parseDiagram(`flowchart TB
  A["Pipe | inside a label"] --> B[Plain]`);
    const a = result.nodes.find((node) => node.id === 'A');
    expect(a?.label).toBe('Pipe | inside a label');
  });

  it('rejects an unrecognised diagram keyword with KB-001', async () => {
    await expect(parseDiagram('notADiagramKind\n  foo bar')).rejects.toSatisfy(
      (error: unknown) => isForgeError(error) && error.code === 'KB-001',
    );
  });

  it('rejects invalid syntax with KB-001 naming the diagram kind and the failing line', async () => {
    await expect(
      parseDiagram(`flowchart TB
  A -->
  subgraph`),
    ).rejects.toSatisfy((error: unknown) => {
      if (!isForgeError(error) || error.code !== 'KB-001') return false;
      return error.message.includes('flowchart') && /line/i.test(error.message);
    });
  });

  it('is a pure function of its string input', async () => {
    const first = await parseDiagram(WORKED_EXAMPLES.flowchart);
    const second = await parseDiagram(WORKED_EXAMPLES.flowchart);
    expect(second).toEqual(first);
  });

  it('extracts C4 shapes and relationships as nodes and edges', async () => {
    const result = await parseDiagram(WORKED_EXAMPLES.C4Context);
    expect(result.nodes).toEqual(
      expect.arrayContaining([
        { id: 'customer', label: 'Customer' },
        { id: 'sys', label: 'System' },
      ]),
    );
    expect(result.edges).toEqual([{ from: 'customer', to: 'sys', label: 'uses' }]);
  });

  it('accepts the `graph` alias and the bare `stateDiagram` keyword', async () => {
    const graph = await parseDiagram('graph TB\n  A --> B');
    expect(graph.kind).toBe('flowchart');
    const state = await parseDiagram('stateDiagram\n  [*] --> Idle');
    expect(state.kind).toBe('stateDiagram-v2');
  });

  it('skips a leading `%%` comment when detecting the diagram kind', async () => {
    const result = await parseDiagram('%% a comment\nflowchart TB\n  A --> B');
    expect(result.kind).toBe('flowchart');
  });

  it('skips a leading YAML frontmatter block when detecting the diagram kind', async () => {
    const result = await parseDiagram('---\ntitle: My Diagram\n---\nflowchart TB\n  A --> B');
    expect(result.kind).toBe('flowchart');
    expect(result.nodes).toEqual(expect.arrayContaining([{ id: 'A', label: 'A' }]));
  });

  it('omits the edge label when a flowchart edge and a sequence message carry none', async () => {
    const flow = await parseDiagram('flowchart TB\n  A --> B');
    expect(flow.edges).toEqual([{ from: 'A', to: 'B' }]);

    const sequence = await parseDiagram('sequenceDiagram\n  Alice->>Bob:');
    expect(sequence.edges).toEqual([{ from: 'Alice', to: 'Bob' }]);
  });

  it('omits the label on a C4 relationship that carries none', async () => {
    const result = await parseDiagram(
      'C4Context\n  Person(customer, "Customer")\n  System(sys, "System")\n  Rel(customer, sys, "")',
    );
    expect(result.edges).toEqual([{ from: 'customer', to: 'sys' }]);
  });

  it('reports the offending line when no keyword matches', async () => {
    await expect(parseDiagram('notADiagramKind\n  foo bar')).rejects.toSatisfy(
      (error: unknown) => isForgeError(error) && error.message.includes('notADiagramKind'),
    );
  });

  it('rejects a source with no non-blank, non-comment line at all', async () => {
    await expect(parseDiagram('   \n\t\n   ')).rejects.toSatisfy(
      (error: unknown) => isForgeError(error) && error.message.includes('no non-blank'),
    );
  });

  it('leaves an unterminated frontmatter block unstripped, rejecting on the literal `---`', async () => {
    // No closing `---` — `stripLeadingFrontmatter` returns the source unchanged (its own doc
    // comment: mermaid's real parser is left to raise this), so kind detection sees a raw `---`
    // line, which matches no keyword.
    await expect(parseDiagram('---\ntitle: X\nflowchart TB\n  A --> B')).rejects.toSatisfy(
      (error: unknown) => isForgeError(error) && error.code === 'KB-001',
    );
  });
});
