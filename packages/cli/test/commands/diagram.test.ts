/**
 * `forge diagram <list|show|validate|render|sync|generate|diff|legend>` — `03` §3.2.2.
 *
 * @see specs/03 §3.2.2
 */
import { afterEach, describe, expect, it } from 'vitest';

import { ForgeError } from '@forge/core/errors';

import {
  diagramDiff,
  diagramGenerate,
  diagramLegend,
  diagramList,
  diagramRender,
  diagramShow,
  diagramSync,
  diagramValidate,
  type DiagramCommandContext,
} from '../../src/commands/diagram.ts';
import {
  KB_ROOT,
  cleanupAll,
  createTestProject,
  writeDiagramFixture,
  writeGeneratedDiagramFixture,
  type TestProject,
} from './helpers.ts';

afterEach(cleanupAll);

function ctx(project: TestProject): DiagramCommandContext {
  return { paths: project.paths, kbRoot: KB_ROOT };
}

describe('diagramList / diagramShow', () => {
  it('lists a real diagram sidecar', async () => {
    const project = await createTestProject();
    await writeDiagramFixture(project);
    const list = await diagramList(ctx(project));
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe('DIAG-001');
  });

  it('shows the real, full parsed Diagram by id', async () => {
    const project = await createTestProject();
    await writeDiagramFixture(project);
    const diagram = await diagramShow(ctx(project), 'DIAG-001');
    expect(diagram.source).toContain('flowchart TD');
  });

  it('throws KB-015 for an unknown diagram id', async () => {
    const project = await createTestProject();
    await expect(diagramShow(ctx(project), 'DIAG-999')).rejects.toMatchObject({ code: 'KB-015' });
  });
});

describe('diagramValidate', () => {
  it('lints a real diagram and returns real findings (possibly none)', async () => {
    const project = await createTestProject();
    await writeDiagramFixture(project);
    const findings = await diagramValidate(ctx(project), 'DIAG-001');
    expect(Array.isArray(findings)).toBe(true);
  });
});

describe('diagramRender', () => {
  it('renders a real, self-contained HTML document', async () => {
    const project = await createTestProject();
    await writeDiagramFixture(project);
    const html = await diagramRender(ctx(project), 'DIAG-001');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('flowchart TD');
  });
});

describe('diagramGenerate', () => {
  it('rejects an unrecognised generator name', () => {
    expect(() => diagramGenerate('not-a-real-generator', {})).toThrow(ForgeError);
  });

  it('runs a real generator (deps-to-graph) against real input', () => {
    const generated = diagramGenerate('deps-to-graph', {
      modules: [{ name: 'a', dependsOn: ['b'] }],
    });
    expect(generated.source).toContain('a');
    expect(generated.kind).toBe('flowchart');
  });
});

describe('diagramDiff / diagramSync', () => {
  it('throws KB-003 (from checkDrift itself) for a diagram with no generator declared', async () => {
    const project = await createTestProject();
    await writeDiagramFixture(project);
    await expect(diagramDiff(ctx(project), 'DIAG-001', {})).rejects.toMatchObject({
      code: 'KB-003',
    });
  });

  it('sync skips every diagram with no declared generator, returning no results', async () => {
    const project = await createTestProject();
    await writeDiagramFixture(project);
    const results = await diagramSync(ctx(project), new Map());
    expect(results).toEqual([]);
  });

  it('diff runs the real checkDrift comparison for a diagram that does declare a generator', async () => {
    const project = await createTestProject();
    await writeGeneratedDiagramFixture(project);
    const result = await diagramDiff(ctx(project), 'DIAG-002', {
      modules: [{ name: 'a', dependsOn: ['b'] }],
    });
    expect(result.diagramId).toBe('DIAG-002');
    expect(typeof result.hasDrift).toBe('boolean');
  });

  it('sync skips a generator-declaring diagram with no supplied input, but runs one that has it', async () => {
    const project = await createTestProject();
    await writeDiagramFixture(project);
    await writeGeneratedDiagramFixture(project);
    const results = await diagramSync(
      ctx(project),
      new Map([['DIAG-002', { modules: [{ name: 'a', dependsOn: ['b'] }] }]]),
    );
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe('DIAG-002');
    expect(results[0]?.kind).toBe('ok');
  });

  it('reports one diagram’s real checkDrift failure as a real per-diagram error, without losing another diagram’s real result', async () => {
    const project = await createTestProject();
    await writeGeneratedDiagramFixture(project); // DIAG-002, generator: deps-to-graph
    await writeGeneratedDiagramFixture(project, 'DIAG-003');

    const results = await diagramSync(
      ctx(project),
      new Map<string, unknown>([
        // Malformed input for deps-to-graph (missing the required `modules` field) — a real
        // generator throw, not a synthetic one.
        ['DIAG-002', {}],
        ['DIAG-003', { modules: [{ name: 'a', dependsOn: ['b'] }] }],
      ]),
    );

    expect(results).toHaveLength(2);
    const failed = results.find((r) => r.id === 'DIAG-002');
    const succeeded = results.find((r) => r.id === 'DIAG-003');
    expect(failed?.kind).toBe('error');
    expect(succeeded?.kind).toBe('ok');
  });
});

describe('diagramLegend', () => {
  it('refuses rather than fabricating a legend, since no real config field exists', () => {
    expect(() => diagramLegend()).toThrow(ForgeError);
  });
});
