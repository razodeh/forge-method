/**
 * `08` §8.11.6's eight generators.
 *
 * @see PLAN-M3.md P3
 */
import { ArtifactDocument } from '@forge/core/artifacts';
import { SpecGraph } from '@forge/core/graph';
import { describe, expect, it } from 'vitest';

import {
  GENERATOR_NAMES,
  GENERATORS,
  componentsToC4,
  datamodelToEr,
  depsToGraph,
  interfacesToSequence,
  parseDiagram,
  pipelineToFlow,
  runGenerator,
  schemaIntrospectToEr,
  specgraphToGraph,
  workflowToDag,
  type GeneratedDiagram,
} from '../../src/index.ts';

async function expectReparsesCleanly(diagram: GeneratedDiagram): Promise<void> {
  await expect(parseDiagram(diagram.source)).resolves.toMatchObject({ kind: diagram.kind });
}

describe('components-to-c4', () => {
  const input = {
    components: [
      { id: 'component:api', label: 'API', dependsOn: ['component:db'] },
      { id: 'component:db', label: 'Database', dependsOn: [] },
    ],
  };

  it('renders the exact expected flowchart (golden)', () => {
    const diagram = componentsToC4(input);
    expect(diagram).toEqual({
      source: [
        'flowchart TB',
        '  component_api["API"]',
        '  component_db["Database"]',
        '  component_api --> component_db',
      ].join('\n'),
      kind: 'flowchart',
      depicts: ['component:api', 'component:db'],
    });
  });

  it('re-parses cleanly', async () => {
    await expectReparsesCleanly(componentsToC4(input));
  });

  it('is deterministic regardless of input order', () => {
    const reordered = { components: [...input.components].reverse() };
    expect(componentsToC4(reordered).source).toBe(componentsToC4(input).source);
  });
});

describe('interfaces-to-sequence', () => {
  const input = {
    flowName: 'checkout',
    steps: [
      { from: 'Web', to: 'API', message: 'POST /checkout' },
      { from: 'API', to: 'Worker', message: 'enqueue job' },
    ],
  };

  it('renders the exact expected sequence diagram (golden)', () => {
    const diagram = interfacesToSequence(input);
    expect(diagram).toEqual({
      source: [
        'sequenceDiagram',
        '  title checkout',
        '  participant API as API',
        '  participant Web as Web',
        '  participant Worker as Worker',
        '  Web->>API: POST /checkout',
        '  API->>Worker: enqueue job',
      ].join('\n'),
      kind: 'sequenceDiagram',
      depicts: ['API', 'Web', 'Worker'],
    });
  });

  it('re-parses cleanly', async () => {
    await expectReparsesCleanly(interfacesToSequence(input));
  });

  it('preserves step order rather than sorting it (order is the meaning of a sequence)', () => {
    const diagram = interfacesToSequence(input);
    const lines = diagram.source.split('\n');
    expect(lines[5]).toContain('POST /checkout');
    expect(lines[6]).toContain('enqueue job');
  });
});

describe('datamodel-to-er', () => {
  const input = {
    entities: [
      { name: 'Customer', attributes: ['id', 'name'] },
      { name: 'Order', attributes: ['id'] },
    ],
    relationships: [{ from: 'Customer', to: 'Order', label: 'places' }],
  };

  it('renders the exact expected ER diagram (golden)', () => {
    const diagram = datamodelToEr(input);
    expect(diagram).toEqual({
      source: [
        'erDiagram',
        '  Customer {',
        '    string id',
        '    string name',
        '  }',
        '  Order {',
        '    string id',
        '  }',
        '  Customer ||--o{ Order : places',
      ].join('\n'),
      kind: 'erDiagram',
      depicts: ['Customer', 'Order'],
    });
  });

  it('re-parses cleanly', async () => {
    await expectReparsesCleanly(datamodelToEr(input));
  });

  it('is deterministic regardless of input order', () => {
    const reordered = {
      entities: [...input.entities].reverse(),
      relationships: [...input.relationships],
    };
    expect(datamodelToEr(reordered).source).toBe(datamodelToEr(input).source);
  });
});

describe('schema-introspect-to-er', () => {
  const input = {
    tables: [
      { name: 'customers', columns: ['id', 'email'] },
      { name: 'orders', columns: ['id', 'customer_id'] },
    ],
    foreignKeys: [{ from: 'orders', to: 'customers' }],
  };

  it('renders the exact expected ER diagram (golden)', () => {
    const diagram = schemaIntrospectToEr(input);
    expect(diagram).toEqual({
      source: [
        'erDiagram',
        '  customers {',
        '    string email',
        '    string id',
        '  }',
        '  orders {',
        '    string customer_id',
        '    string id',
        '  }',
        '  orders ||--o{ customers : references',
      ].join('\n'),
      kind: 'erDiagram',
      depicts: ['customers', 'orders'],
    });
  });

  it('re-parses cleanly', async () => {
    await expectReparsesCleanly(schemaIntrospectToEr(input));
  });
});

describe('specgraph-to-graph', () => {
  function makeDoc(type: string, id: string, extra: readonly string[]): ArtifactDocument {
    const source = [
      '---',
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
      ...extra,
      '---',
      '',
      'Body.',
      '',
    ].join('\n');
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

  it('renders every real SpecGraph node and edge (golden)', () => {
    const graph = SpecGraph.build([vision, capability]);
    const diagram = specgraphToGraph({ graph });
    expect(diagram).toEqual({
      source: [
        'flowchart LR',
        '  CAP_001["CAP: CAP-001"]',
        '  VIS_001["VIS: VIS-001"]',
        '  CAP_001 -->|realises| VIS_001',
      ].join('\n'),
      kind: 'flowchart',
      depicts: ['CAP-001', 'VIS-001'],
    });
  });

  it('re-parses cleanly', async () => {
    const graph = SpecGraph.build([vision, capability]);
    await expectReparsesCleanly(specgraphToGraph({ graph }));
  });
});

describe('workflow-to-dag', () => {
  const input = {
    steps: [
      { id: 'design', dependsOn: [] },
      { id: 'implement', dependsOn: ['design'] },
      { id: 'review', dependsOn: ['implement'] },
    ],
  };

  it('renders the exact expected run-plan DAG (golden)', () => {
    const diagram = workflowToDag(input);
    expect(diagram).toEqual({
      source: [
        'flowchart TB',
        '  design["design"]',
        '  implement["implement"]',
        '  review["review"]',
        '  design --> implement',
        '  implement --> review',
      ].join('\n'),
      kind: 'flowchart',
      depicts: ['design', 'implement', 'review'],
    });
  });

  it('re-parses cleanly', async () => {
    await expectReparsesCleanly(workflowToDag(input));
  });
});

describe('deps-to-graph', () => {
  const input = {
    modules: [
      { name: 'core', dependsOn: [] },
      { name: 'schemas', dependsOn: [] },
      { name: 'diagrams', dependsOn: ['core', 'schemas'] },
    ],
  };

  it('renders the exact expected module dependency graph (golden)', () => {
    const diagram = depsToGraph(input);
    expect(diagram).toEqual({
      source: [
        'flowchart TB',
        '  core["core"]',
        '  diagrams["diagrams"]',
        '  schemas["schemas"]',
        '  diagrams --> core',
        '  diagrams --> schemas',
      ].join('\n'),
      kind: 'flowchart',
      depicts: ['core', 'diagrams', 'schemas'],
    });
  });

  it('re-parses cleanly', async () => {
    await expectReparsesCleanly(depsToGraph(input));
  });
});

describe('pipeline-to-flow', () => {
  const input = {
    stages: [
      { name: 'build', dependsOn: [] },
      { name: 'test', dependsOn: ['build'] },
      { name: 'deploy', dependsOn: ['test'] },
    ],
  };

  it('renders the exact expected pipeline flow (golden)', () => {
    const diagram = pipelineToFlow(input);
    expect(diagram).toEqual({
      source: [
        'flowchart LR',
        '  build["build"]',
        '  deploy["deploy"]',
        '  test["test"]',
        '  build --> test',
        '  test --> deploy',
      ].join('\n'),
      kind: 'flowchart',
      depicts: ['build', 'deploy', 'test'],
    });
  });

  it('sanitizes a stage named after a reserved Mermaid word ("end")', () => {
    // A stage literally named "end" is an entirely ordinary CI stage name and a real Mermaid
    // reserved word in flowchart grammar (SPEC-QUESTIONS.md Q46) — verified empirically to fail to
    // parse unsanitized.
    const diagram = pipelineToFlow({ stages: [{ name: 'end', dependsOn: [] }] });
    expect(diagram.source).toContain('n_end["end"]');
  });

  it("sanitizes a reserved-word stage's own re-parsed output cleanly", async () => {
    await expectReparsesCleanly(pipelineToFlow({ stages: [{ name: 'end', dependsOn: [] }] }));
  });

  it('re-parses cleanly', async () => {
    await expectReparsesCleanly(pipelineToFlow(input));
  });
});

describe('GENERATORS registry', () => {
  it('registers every generator named in GENERATOR_NAMES, with no extras', () => {
    expect(Object.keys(GENERATORS).sort()).toEqual([...GENERATOR_NAMES].sort());
  });

  it('runGenerator dispatches to the same function the registry itself holds', () => {
    const input = { components: [] };
    expect(runGenerator('components-to-c4', input)).toEqual(GENERATORS['components-to-c4'](input));
  });

  it('every registered generator runs against a minimal valid input', () => {
    const minimalInputs: Record<(typeof GENERATOR_NAMES)[number], unknown> = {
      'components-to-c4': { components: [] },
      'interfaces-to-sequence': { flowName: 'x', steps: [] },
      'datamodel-to-er': { entities: [], relationships: [] },
      'schema-introspect-to-er': { tables: [], foreignKeys: [] },
      'specgraph-to-graph': { graph: SpecGraph.build([]) },
      'workflow-to-dag': { steps: [] },
      'deps-to-graph': { modules: [] },
      'pipeline-to-flow': { stages: [] },
    };
    for (const name of GENERATOR_NAMES) {
      const diagram = runGenerator(name, minimalInputs[name]);
      expect(typeof diagram.source).toBe('string');
      expect(diagram.depicts).toEqual([]);
    }
  });
});
