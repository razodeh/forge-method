/**
 * `validateDiagrams`/`applyAutofix` — `SPEC-QUESTIONS.md` Q43's own kb-lint-equivalent entry point.
 *
 * @see PLAN-M3.md P4
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ProjectPaths } from '@forge/core/fs';
import { diagramSchema, type Diagram } from '@forge/schemas';
import { afterEach, describe, expect, it } from 'vitest';

import { applyAutofix, validateDiagrams, type ComponentsToC4Input } from '../../src/index.ts';

const FIXTURE_ROOT = path.resolve(
  import.meta.dirname,
  '../../../../fixtures/diagram-drift/docs/forge/kb/architecture',
);

function buildDiagram(overrides: Partial<Diagram> = {}): Diagram {
  return diagramSchema.parse({
    id: 'DIAG-001',
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
    source: 'docs/forge/kb/architecture/views/containers.mmd',
    generated: true,
    generator: 'components-to-c4',
    depicts: ['component:api', 'component:db'],
    explains: [],
    caption: 'The container-level decomposition of the billing service.',
    alt_text: 'Two boxes, API and Database, with API depending on Database.',
    owner: 'architect',
    ...overrides,
  });
}

const REAL_COMPONENTS_INPUT: ComponentsToC4Input = {
  components: [
    { id: 'component:api', label: 'API', dependsOn: ['component:db'] },
    { id: 'component:db', label: 'Database', dependsOn: [] },
  ],
};

describe('validateDiagrams', () => {
  it('reports diagram:drift for the real fixtures/diagram-drift fixture', async () => {
    const actualSource = readFileSync(path.join(FIXTURE_ROOT, 'views/containers.mmd'), 'utf8');
    const { findings } = await validateDiagrams(
      [
        {
          diagram: buildDiagram(),
          actualSource,
          knownIds: new Set(['component:api', 'component:db']),
          generatorInput: REAL_COMPONENTS_INPUT,
        },
      ],
      { driftPolicy: 'fail' },
    );
    expect(findings).toEqual([
      expect.objectContaining({ checkId: 'diagram:drift', severity: 'error' }),
    ]);
  });

  it('reports no findings for a diagram that is clean on every axis', async () => {
    const actualSource = [
      'flowchart TB',
      '  component_api["API"]',
      '  component_db["Database"]',
      '  component_api --> component_db',
    ].join('\n');
    const { findings } = await validateDiagrams(
      [
        {
          diagram: buildDiagram(),
          actualSource,
          knownIds: new Set(['component:api', 'component:db']),
          generatorInput: REAL_COMPONENTS_INPUT,
        },
      ],
      { driftPolicy: 'fail' },
    );
    expect(findings).toEqual([]);
  });

  it('composes a lint finding and a drift finding together for the same diagram', async () => {
    const diagram = buildDiagram({ depicts: ['component:api', 'component:ghost'] });
    const actualSource = readFileSync(path.join(FIXTURE_ROOT, 'views/containers.mmd'), 'utf8');
    const { findings } = await validateDiagrams(
      [
        {
          diagram,
          actualSource,
          knownIds: new Set(['component:api', 'component:db']),
          generatorInput: REAL_COMPONENTS_INPUT,
        },
      ],
      { driftPolicy: 'fail' },
    );
    expect(findings.map((f) => f.checkId).sort()).toEqual(['diagram:drift', 'diagram:refs']);
  });

  it('reports diagram:drift at warn severity under the warn policy', async () => {
    const actualSource = readFileSync(path.join(FIXTURE_ROOT, 'views/containers.mmd'), 'utf8');
    const { findings } = await validateDiagrams(
      [{ diagram: buildDiagram(), actualSource, generatorInput: REAL_COMPONENTS_INPUT }],
      { driftPolicy: 'warn' },
    );
    expect(findings).toEqual([
      expect.objectContaining({ checkId: 'diagram:drift', severity: 'warn' }),
    ]);
  });

  it('skips drift checking entirely when generatorInput is not supplied', async () => {
    const actualSource = readFileSync(path.join(FIXTURE_ROOT, 'views/containers.mmd'), 'utf8');
    const { findings } = await validateDiagrams([{ diagram: buildDiagram(), actualSource }], {
      driftPolicy: 'fail',
    });
    expect(findings.some((f) => f.checkId === 'diagram:drift')).toBe(false);
  });

  it('forwards complexity/requireCaptions/now through to lintDiagram', async () => {
    const actualSource = [
      'flowchart TB',
      '  component_api["API"]',
      '  component_db["Database"]',
      '  component_api --> component_db',
    ].join('\n');
    const { findings } = await validateDiagrams(
      [
        {
          diagram: buildDiagram({ review_by: '2000-01-01' }),
          actualSource,
          generatorInput: REAL_COMPONENTS_INPUT,
          now: new Date('2026-06-01T00:00:00Z'),
        },
      ],
      {
        driftPolicy: 'fail',
        complexity: { maxNodes: 1, maxEdges: 30, hardMaxNodes: 5 },
        requireCaptions: false,
      },
    );
    // maxNodes: 1 forces a diagram:complexity warn on this 2-node diagram; requireCaptions: false
    // is exercised by there being no diagram:caption finding despite a caption not being checked;
    // `now` past `review_by` forces a diagram:staleness warn.
    expect(findings.map((f) => f.checkId).sort()).toEqual([
      'diagram:complexity',
      'diagram:staleness',
    ]);
  });

  it('reports diagram:transclusion for a markdown document with a diverged marker', async () => {
    const actualSource = [
      'flowchart TB',
      '  component_api["API"]',
      '  component_db["Database"]',
      '  component_api --> component_db',
    ].join('\n');
    const markdown = [
      '<!-- forge:diagram id=DIAG-001 src=docs/forge/kb/architecture/views/containers.mmd -->',
      '```mermaid',
      '%% forge:generated-from docs/forge/kb/architecture/views/containers.mmd — do not edit here',
      'flowchart TB',
      '  a stale copy',
      '```',
      '<!-- /forge:diagram -->',
    ].join('\n');
    const { findings } = await validateDiagrams(
      [{ diagram: buildDiagram(), actualSource, generatorInput: REAL_COMPONENTS_INPUT }],
      { driftPolicy: 'fail', markdownDocuments: [markdown] },
    );
    expect(findings).toEqual([
      expect.objectContaining({ checkId: 'diagram:transclusion', severity: 'error' }),
    ]);
  });

  it("catches the real fixtures/diagram-drift fixture's own diverged transclusion", async () => {
    const markdown = readFileSync(path.join(FIXTURE_ROOT, 'architecture-spec.md'), 'utf8');
    const actualSource = readFileSync(path.join(FIXTURE_ROOT, 'views/containers.mmd'), 'utf8');
    const { findings } = await validateDiagrams(
      [{ diagram: buildDiagram(), actualSource, generatorInput: REAL_COMPONENTS_INPUT }],
      { driftPolicy: 'fail', markdownDocuments: [markdown] },
    );
    expect(findings.map((f) => f.checkId).sort()).toEqual([
      'diagram:drift',
      'diagram:transclusion',
    ]);
  });

  it('skips a transclusion marker whose src matches no diagram in this batch', async () => {
    const actualSource = [
      'flowchart TB',
      '  component_api["API"]',
      '  component_db["Database"]',
      '  component_api --> component_db',
    ].join('\n');
    const markdown = [
      '<!-- forge:diagram id=DIAG-999 src=somewhere/else.mmd -->',
      '```mermaid',
      '%% forge:generated-from somewhere/else.mmd — do not edit here',
      'flowchart TB',
      '```',
      '<!-- /forge:diagram -->',
    ].join('\n');
    const { findings } = await validateDiagrams(
      [{ diagram: buildDiagram(), actualSource, generatorInput: REAL_COMPONENTS_INPUT }],
      { driftPolicy: 'fail', markdownDocuments: [markdown] },
    );
    expect(findings).toEqual([]);
  });

  it('is skipped entirely when markdownDocuments is omitted', async () => {
    const actualSource = [
      'flowchart TB',
      '  component_api["API"]',
      '  component_db["Database"]',
      '  component_api --> component_db',
    ].join('\n');
    const { findings } = await validateDiagrams(
      [{ diagram: buildDiagram(), actualSource, generatorInput: REAL_COMPONENTS_INPUT }],
      { driftPolicy: 'fail' },
    );
    expect(findings).toEqual([]);
  });

  it("collects one entry's failure in errors without discarding another entry's findings", async () => {
    const cleanSource = [
      'flowchart TB',
      '  component_api["API"]',
      '  component_db["Database"]',
      '  component_api --> component_db',
    ].join('\n');
    const brokenDiagram = buildDiagram({ id: 'DIAG-002', generator: 'not-a-real-generator' });
    const { findings, errors } = await validateDiagrams(
      [
        {
          diagram: buildDiagram({ depicts: ['component:api', 'component:ghost'] }),
          actualSource: cleanSource,
          knownIds: new Set(['component:api', 'component:db']),
        },
        {
          diagram: brokenDiagram,
          actualSource: cleanSource,
          generatorInput: {},
        },
      ],
      { driftPolicy: 'fail' },
    );
    expect(findings).toEqual([expect.objectContaining({ checkId: 'diagram:refs' })]);
    expect(errors).toEqual([expect.objectContaining({ diagramId: 'DIAG-002' })]);
  });
});

describe('applyAutofix', () => {
  let root: string;

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('overwrites the target file with the expected content', async () => {
    root = mkdtempSync(path.join(tmpdir(), 'forge-diagram-autofix-'));
    const paths = new ProjectPaths(root);
    const target = paths.resolveWithin('containers.mmd');

    await applyAutofix(target, 'flowchart TB\n  a["a"]');
    expect(readFileSync(target, 'utf8')).toBe('flowchart TB\n  a["a"]');
  });

  it('drives a real end-to-end autofix through validateDiagrams', async () => {
    root = mkdtempSync(path.join(tmpdir(), 'forge-diagram-autofix-e2e-'));
    const paths = new ProjectPaths(root);
    const target = paths.resolveWithin('containers.mmd');
    const driftedSource = readFileSync(path.join(FIXTURE_ROOT, 'views/containers.mmd'), 'utf8');

    await validateDiagrams(
      [
        {
          diagram: buildDiagram(),
          actualSource: driftedSource,
          generatorInput: REAL_COMPONENTS_INPUT,
          target,
        },
      ],
      { driftPolicy: 'autofix' },
    );

    expect(readFileSync(target, 'utf8')).toBe(
      [
        'flowchart TB',
        '  component_api["API"]',
        '  component_db["Database"]',
        '  component_api --> component_db',
      ].join('\n'),
    );
  });

  it('never touches disk under the fail or warn policies, even with a target supplied', async () => {
    root = mkdtempSync(path.join(tmpdir(), 'forge-diagram-autofix-noop-'));
    const paths = new ProjectPaths(root);
    const target = paths.resolveWithin('containers.mmd');
    const driftedSource = readFileSync(path.join(FIXTURE_ROOT, 'views/containers.mmd'), 'utf8');

    await validateDiagrams(
      [
        {
          diagram: buildDiagram(),
          actualSource: driftedSource,
          generatorInput: REAL_COMPONENTS_INPUT,
          target,
        },
      ],
      { driftPolicy: 'fail' },
    );

    expect(() => readFileSync(target, 'utf8')).toThrow();
  });
});
