/**
 * `lintDiagram` — `08` §8.11.7.
 *
 * @see PLAN-M3.md P2
 */
import { diagramSchema, type Diagram } from '@forge/schemas';
import type { DiagramFinding, ParsedDiagram } from '@forge/diagrams';
import { describe, expect, it } from 'vitest';

import { DEFAULT_COMPLEXITY_BUDGET, lintDiagram, parseDiagram } from '../../src/index.ts';

const SMALL_FLOWCHART = `flowchart TB
  A[Start] --> B{Decision}
  B -->|yes| C[End]`;

function buildDiagram(overrides: Partial<Diagram> = {}): Diagram {
  return diagramSchema.parse({
    id: 'DIAG-014',
    type: 'Diagram',
    schemaVersion: 1,
    title: 'Container decomposition',
    status: 'active',
    created: '2026-03-05',
    updated: '2026-03-05',
    revision: 1,
    author: 'architect',
    changelog: [],
    kind: 'flowchart',
    notation: 'mermaid',
    source: 'architecture/views/containers.mmd',
    generated: false,
    depicts: ['component:api', 'component:worker'],
    explains: ['ADR-0011'],
    caption: 'The MVP topology across every deployable.',
    alt_text: 'Three boxes connected to one database.',
    owner: 'architect',
    ...overrides,
  });
}

function findingsFor(checkId: string, findings: readonly DiagramFinding[]): number {
  return findings.filter((f) => f.checkId === checkId).length;
}

describe('lintDiagram', () => {
  it('reports nothing for a clean diagram with no config supplied', async () => {
    const diagram = buildDiagram({ depicts: [] });
    const parsed = await parseDiagram(SMALL_FLOWCHART);
    expect(lintDiagram(diagram, parsed)).toEqual([]);
  });

  describe('diagram:refs', () => {
    it('flags a depicted id absent from knownIds, naming it', async () => {
      const diagram = buildDiagram({ depicts: ['component:api', 'component:ghost'] });
      const parsed = await parseDiagram(SMALL_FLOWCHART);
      const findings = lintDiagram(diagram, parsed, {
        knownIds: new Set(['component:api']),
      });
      expect(findings).toEqual([
        expect.objectContaining({ checkId: 'diagram:refs', nodeId: 'component:ghost' }),
      ]);
    });

    it('passes every depicted id present in knownIds', async () => {
      const diagram = buildDiagram({ depicts: ['component:api'] });
      const parsed = await parseDiagram(SMALL_FLOWCHART);
      const findings = lintDiagram(diagram, parsed, { knownIds: new Set(['component:api']) });
      expect(findingsFor('diagram:refs', findings)).toBe(0);
    });

    it('skips the rule entirely when knownIds is omitted', async () => {
      const diagram = buildDiagram({ depicts: ['component:anything'] });
      const parsed = await parseDiagram(SMALL_FLOWCHART);
      expect(findingsFor('diagram:refs', lintDiagram(diagram, parsed))).toBe(0);
    });
  });

  describe('diagram:orphan-nodes', () => {
    it('flags a node with no incident edge', async () => {
      const diagram = buildDiagram({ depicts: [] });
      const parsed = await parseDiagram(`flowchart TB
  A[Start] --> B[End]
  C[Unreferenced]`);
      const findings = lintDiagram(diagram, parsed);
      expect(findings).toEqual([
        expect.objectContaining({ checkId: 'diagram:orphan-nodes', nodeId: 'C' }),
      ]);
    });

    it('does not flag a node used only as an edge endpoint', async () => {
      const diagram = buildDiagram({ depicts: [] });
      const parsed = await parseDiagram(SMALL_FLOWCHART);
      expect(findingsFor('diagram:orphan-nodes', lintDiagram(diagram, parsed))).toBe(0);
    });

    it('is silent for a diagram with no edges at all', () => {
      const diagram = buildDiagram({ depicts: [] });
      const parsed: ParsedDiagram = {
        kind: 'flowchart',
        nodes: [{ id: 'A', label: 'Solo' }],
        edges: [],
        subgraphs: [],
      };
      expect(findingsFor('diagram:orphan-nodes', lintDiagram(diagram, parsed))).toBe(0);
    });
  });

  describe('diagram:complexity', () => {
    /** A path through every node (zero orphans, however sparse `edgeCount` requests), padded with
     * duplicate edges up to `edgeCount` when that asks for more than the path alone provides. */
    function graphWith(nodeCount: number, edgeCount: number): ParsedDiagram {
      const nodes = Array.from({ length: nodeCount }, (_, i) => ({
        id: `N${String(i)}`,
        label: `Real label ${String(i)}`,
      }));
      const edges: { from: string; to: string }[] = [];
      for (let i = 0; i < nodeCount - 1; i++) {
        edges.push({ from: `N${String(i)}`, to: `N${String(i + 1)}` });
      }
      while (edges.length < edgeCount) {
        edges.push({ from: 'N0', to: nodeCount > 1 ? 'N1' : 'N0' });
      }
      return { kind: 'flowchart', nodes, edges, subgraphs: [] };
    }

    function complexityFindings(findings: readonly DiagramFinding[]) {
      return findings.filter((f) => f.checkId === 'diagram:complexity');
    }

    it('is clean exactly at the node/edge budget', () => {
      const diagram = buildDiagram({ depicts: [] });
      const parsed = graphWith(20, 30);
      expect(complexityFindings(lintDiagram(diagram, parsed))).toEqual([]);
      expect(findingsFor('diagram:orphan-nodes', lintDiagram(diagram, parsed))).toBe(0);
    });

    it('warns one node over the budget, with edges still comfortably clean', () => {
      const diagram = buildDiagram({ depicts: [] });
      const parsed = graphWith(21, 10);
      const findings = lintDiagram(diagram, parsed);
      expect(complexityFindings(findings)).toEqual([
        expect.objectContaining({ checkId: 'diagram:complexity', severity: 'warn' }),
      ]);
      expect(findingsFor('diagram:orphan-nodes', findings)).toBe(0);
    });

    it('errors once the hard node maximum is reached, with a high edge budget kept out of the way', () => {
      // `graphWith`'s own spanning chain needs 39 edges to connect 40 nodes with zero orphans — a
      // gauntlet critic caught an earlier version of this test using the *default* edge budget (30),
      // which let an unrelated edge-`warn` finding ride along unnoticed. An explicit, generous
      // `maxEdges` isolates the node-count boundary this test actually names.
      const diagram = buildDiagram({ depicts: [] });
      const parsed = graphWith(40, 0);
      const findings = complexityFindings(
        lintDiagram(diagram, parsed, {
          complexity: { maxNodes: 20, maxEdges: 1000, hardMaxNodes: 40 },
        }),
      );
      expect(findings).toEqual([
        expect.objectContaining({ checkId: 'diagram:complexity', severity: 'error' }),
      ]);
    });

    it('warns on edges over budget independently of node count', () => {
      const diagram = buildDiagram({ depicts: [] });
      const parsed = graphWith(5, 31);
      const findings = lintDiagram(diagram, parsed);
      expect(complexityFindings(findings)).toEqual([
        expect.objectContaining({ checkId: 'diagram:complexity', severity: 'warn' }),
      ]);
      expect(findingsFor('diagram:orphan-nodes', findings)).toBe(0);
    });

    it('honours a caller-supplied budget, including a lower hard maximum', () => {
      const diagram = buildDiagram({ depicts: [] });
      const parsed = graphWith(5, 0);
      const findings = complexityFindings(
        lintDiagram(diagram, parsed, {
          complexity: { maxNodes: 4, maxEdges: 10, hardMaxNodes: 5 },
        }),
      );
      expect(findings).toEqual([
        expect.objectContaining({ checkId: 'diagram:complexity', severity: 'error' }),
      ]);
    });
  });

  describe('diagram:label-quality', () => {
    it.each(['', ' ', 'x', 'foo', 'TODO', 'FIXME', 'Component1', 'Item2', 'Component_1', 'Node-2'])(
      'flags the placeholder label %j',
      (label) => {
        const diagram = buildDiagram({ depicts: [] });
        const parsed: ParsedDiagram = {
          kind: 'flowchart',
          nodes: [{ id: 'A', label }],
          edges: [],
          subgraphs: [],
        };
        expect(findingsFor('diagram:label-quality', lintDiagram(diagram, parsed))).toBe(1);
      },
    );

    // A gauntlet critic caught the first two here (an over-broad case-insensitive word match, and a
    // bare-noun-with-no-digit regex) flagging exactly these kinds of ordinary, spec-required labels.
    it.each([
      'API',
      'Billing worker',
      'Postgres primary',
      'OAuth2 gateway',
      'Test',
      'Todo',
      'node',
      'Object',
      'Entity',
      'Widget',
      'Box',
      'Shape',
    ])('does not flag the ordinary label %j', (label) => {
      const diagram = buildDiagram({ depicts: [] });
      const parsed: ParsedDiagram = {
        kind: 'flowchart',
        nodes: [{ id: 'A', label }],
        edges: [],
        subgraphs: [],
      };
      expect(findingsFor('diagram:label-quality', lintDiagram(diagram, parsed))).toBe(0);
    });
  });

  describe('diagram:caption', () => {
    it('flags a single-word caption', () => {
      const diagram = buildDiagram({ caption: 'Topology', depicts: [] });
      const parsed: ParsedDiagram = { kind: 'flowchart', nodes: [], edges: [], subgraphs: [] };
      const findings = lintDiagram(diagram, parsed);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.checkId).toBe('diagram:caption');
      expect(findings[0]?.message).toContain('caption');
    });

    it('flags a single-word alt_text', () => {
      const diagram = buildDiagram({ alt_text: 'Boxes', depicts: [] });
      const parsed: ParsedDiagram = { kind: 'flowchart', nodes: [], edges: [], subgraphs: [] };
      const findings = lintDiagram(diagram, parsed);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.checkId).toBe('diagram:caption');
      expect(findings[0]?.message).toContain('alt_text');
    });

    it('passes a real multi-word caption and alt_text', () => {
      const diagram = buildDiagram({ depicts: [] });
      const parsed: ParsedDiagram = { kind: 'flowchart', nodes: [], edges: [], subgraphs: [] };
      expect(findingsFor('diagram:caption', lintDiagram(diagram, parsed))).toBe(0);
    });

    it('is disabled entirely when requireCaptions is false', () => {
      const diagram = buildDiagram({ caption: 'X', alt_text: 'Y', depicts: [] });
      const parsed: ParsedDiagram = { kind: 'flowchart', nodes: [], edges: [], subgraphs: [] };
      const findings = lintDiagram(diagram, parsed, { requireCaptions: false });
      expect(findingsFor('diagram:caption', findings)).toBe(0);
    });

    it('passes a long caption in a script with no inter-word spacing (CJK)', () => {
      // A gauntlet critic caught a pure whitespace-word-count heuristic misreading a real,
      // detailed Chinese sentence as "a single word" — fixed with a length-based alternative.
      const diagram = buildDiagram({
        caption: '容器分解图显示了系统的所有组件和它们之间的连接关系',
        alt_text: '三个方框通过箭头连接到一个数据库表示服务之间的调用关系',
        depicts: [],
      });
      const parsed: ParsedDiagram = { kind: 'flowchart', nodes: [], edges: [], subgraphs: [] };
      expect(findingsFor('diagram:caption', lintDiagram(diagram, parsed))).toBe(0);
    });

    it('still flags a short caption in a script with no inter-word spacing', () => {
      const diagram = buildDiagram({ caption: '拓扑', depicts: [] });
      const parsed: ParsedDiagram = { kind: 'flowchart', nodes: [], edges: [], subgraphs: [] };
      expect(findingsFor('diagram:caption', lintDiagram(diagram, parsed))).toBe(1);
    });

    it.each(['TopologyDiagram', 'asdfasdfasdf', 'Placeholder'.repeat(2)])(
      'still flags a long single English word with no spaces (%j) — a verify pass caught the ' +
        'length-only version of this rule silently accepting one',
      (caption) => {
        const diagram = buildDiagram({ caption, depicts: [] });
        const parsed: ParsedDiagram = { kind: 'flowchart', nodes: [], edges: [], subgraphs: [] };
        expect(findingsFor('diagram:caption', lintDiagram(diagram, parsed))).toBe(1);
      },
    );
  });

  describe('diagram:staleness', () => {
    it('warns when review_by is in the past relative to the injected clock', () => {
      const diagram = buildDiagram({ review_by: '2026-01-01', depicts: [] });
      const parsed: ParsedDiagram = { kind: 'flowchart', nodes: [], edges: [], subgraphs: [] };
      const findings = lintDiagram(diagram, parsed, { now: new Date('2026-06-01T00:00:00Z') });
      expect(findings).toEqual([
        expect.objectContaining({ checkId: 'diagram:staleness', severity: 'warn' }),
      ]);
    });

    it('is clean when review_by is today or in the future', () => {
      const diagram = buildDiagram({ review_by: '2026-06-11', depicts: [] });
      const parsed: ParsedDiagram = { kind: 'flowchart', nodes: [], edges: [], subgraphs: [] };
      const findings = lintDiagram(diagram, parsed, { now: new Date('2026-06-11T00:00:00Z') });
      expect(findingsFor('diagram:staleness', findings)).toBe(0);
    });

    it('is silent when review_by is absent', () => {
      const diagram = buildDiagram({ depicts: [] });
      const parsed: ParsedDiagram = { kind: 'flowchart', nodes: [], edges: [], subgraphs: [] };
      const now = new Date('2026-06-01T00:00:00Z');
      expect(findingsFor('diagram:staleness', lintDiagram(diagram, parsed, { now }))).toBe(0);
    });

    it('is silent when now is not supplied at all, per R10', () => {
      const diagram = buildDiagram({ review_by: '2000-01-01', depicts: [] });
      const parsed: ParsedDiagram = { kind: 'flowchart', nodes: [], edges: [], subgraphs: [] };
      expect(findingsFor('diagram:staleness', lintDiagram(diagram, parsed))).toBe(0);
    });
  });

  it('is deterministic: identical inputs always produce findings in the same order', async () => {
    const diagram = buildDiagram({ depicts: ['component:ghost'], review_by: '2020-01-01' });
    const parsed = await parseDiagram(`flowchart TB
  A[Start] --> B[Middle]
  C[Orphan]`);
    const options = { knownIds: new Set<string>(), now: new Date('2026-01-01T00:00:00Z') };
    const first = lintDiagram(diagram, parsed, options);
    const second = lintDiagram(diagram, parsed, options);
    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThan(1);
  });

  it('exports DEFAULT_COMPLEXITY_BUDGET as a frozen, shared-safe object', () => {
    expect(Object.isFrozen(DEFAULT_COMPLEXITY_BUDGET)).toBe(true);
  });
});
