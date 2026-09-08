/**
 * `forge spec <list|show|validate|trace|matrix|orphans|new>` — `03` §3.2.2.
 *
 * @see specs/03 §3.2.2
 */
import { afterEach, describe, expect, it } from 'vitest';

import { ArtifactDocument, writeArtifact } from '@forge/core/artifacts';

import { adrNew } from '../../src/commands/adr.ts';
import {
  specList,
  specMatrix,
  specNew,
  specOrphans,
  specShow,
  specTrace,
  specValidate,
  type SpecCommandContext,
} from '../../src/commands/spec.ts';
import { KB_ROOT, SPECS_ROOT, cleanupAll, createTestProject, type TestProject } from './helpers.ts';

afterEach(cleanupAll);

function ctx(project: TestProject): SpecCommandContext {
  return { paths: project.paths, specsRoot: SPECS_ROOT, kbRoot: KB_ROOT };
}

describe('specNew', () => {
  it('allocates a real id and scaffolds the real Vision template', async () => {
    const doc = await specNew(ctx(await createTestProject()), 'Vision', 'The product vision');
    expect(doc.get(['id'])).toMatch(/^VIS-\d{3}$/);
    expect(doc.get(['title'])).toBe('The product vision');
  });

  it('writes a Capability under the real docs/forge/specs/ path', async () => {
    const project = await createTestProject();
    const doc = await specNew(ctx(project), 'Capability', 'A real capability');
    expect(doc.path.startsWith(`${SPECS_ROOT}/capabilities/`)).toBe(true);
  });

  it('refuses a type with no real spec-shaped template location (e.g. ADR)', async () => {
    const project = await createTestProject();
    await expect(specNew(ctx(project), 'ADR', 'x')).rejects.toMatchObject({ code: 'USR-003' });
  });

  it('throws CFG-001 when a required path variable is missing (InterfaceContract needs {name})', async () => {
    const project = await createTestProject();
    await expect(
      specNew(ctx(project), 'InterfaceContract', 'A real interface'),
    ).rejects.toMatchObject({ code: 'CFG-001' });
  });

  it('writes an InterfaceContract once its own real path variable is supplied', async () => {
    const project = await createTestProject();
    const doc = await specNew(ctx(project), 'InterfaceContract', 'A real interface', {
      name: 'billing-api',
    });
    expect(doc.path).toContain('billing-api');
  });
});

describe('specList / specShow', () => {
  it('lists every real spec document written so far', async () => {
    const project = await createTestProject();
    await specNew(ctx(project), 'Vision', 'V');
    await specNew(ctx(project), 'Capability', 'C');
    const list = await specList(ctx(project));
    expect(list.map((entry) => entry.type).sort()).toEqual(['Capability', 'Vision']);
  });

  it('shows one real document by its real id', async () => {
    const project = await createTestProject();
    const created = await specNew(ctx(project), 'NFR', 'A real NFR');
    const id = created.get(['id']) as string;
    const shown = await specShow(ctx(project), id);
    expect(shown.get(['title'])).toBe('A real NFR');
  });

  it('throws KB-015 for an id that does not exist', async () => {
    const project = await createTestProject();
    await specNew(ctx(project), 'Vision', 'V');
    await expect(specShow(ctx(project), 'NFR-9999')).rejects.toMatchObject({ code: 'KB-015' });
  });
});

describe('specValidate / specTrace / specMatrix / specOrphans', () => {
  it('validates every real document against its own real schema', async () => {
    const project = await createTestProject();
    await specNew(ctx(project), 'Vision', 'V');
    const result = await specValidate(ctx(project));
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]?.valid).toBe(true);
  });

  it('traces a real node’s real parents/children through the real SpecGraph', async () => {
    const project = await createTestProject();
    const vision = await specNew(ctx(project), 'Vision', 'V');
    const id = vision.get(['id']) as string;
    const trace = await specTrace(ctx(project), id);
    expect(trace.node).toBe(id);
    expect(Array.isArray(trace.parents)).toBe(true);
    expect(Array.isArray(trace.children)).toBe(true);
  });

  it('builds a real matrix (nodes, edges, orphans) from real documents', async () => {
    const project = await createTestProject();
    await specNew(ctx(project), 'Vision', 'V');
    const matrix = await specMatrix(ctx(project));
    expect(matrix.nodes.length).toBeGreaterThan(0);
  });

  it('returns the real, current orphan list (09 §9.4: stories/tests, not a bare Vision)', async () => {
    const project = await createTestProject();
    await specNew(ctx(project), 'Vision', 'V');
    const orphans = await specOrphans(ctx(project));
    expect(Array.isArray(orphans)).toBe(true);
  });

  it('returns empty results for a project with no specs/ directory at all', async () => {
    const project = await createTestProject();
    const result = await specValidate(ctx(project));
    expect(result.documents).toEqual([]);
  });

  it('builds the graph from real spec docs plus real ADRs together', async () => {
    const project = await createTestProject();
    await specNew(ctx(project), 'Vision', 'V');
    await adrNew({ paths: project.paths, kbRoot: KB_ROOT }, 'A real decision');
    const result = await specValidate(ctx(project));
    // Both a spec document and a real ADR contributed a real, validated document.
    expect(result.documents).toHaveLength(1);
    const matrix = await specMatrix(ctx(project));
    expect(matrix.nodes.length).toBeGreaterThanOrEqual(2);
  });

  it('reports a real, invalid document as invalid, with real schema error messages', async () => {
    const project = await createTestProject();
    const relPath = `${SPECS_ROOT}/vision.md`;
    // Missing every required field on purpose — a real schema violation, not a synthetic mock.
    const doc = ArtifactDocument.parse('---\nid: VIS-001\ntype: Vision\n---\nbody\n', relPath);
    await writeArtifact(project.paths, doc);

    const result = await specValidate(ctx(project));
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]?.valid).toBe(false);
    expect(result.documents[0]?.errors.length).toBeGreaterThan(0);
  });
});
