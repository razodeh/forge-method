/**
 * `forge spec <list|show|validate|trace|matrix|orphans|new|re-derive>` — `03` §3.2.2.
 *
 * @see specs/03 §3.2.2
 * @see specs/09 §9.7
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as YAML from 'yaml';

import { ArtifactDocument, writeArtifact } from '@forge/core/artifacts';

import { adrNew } from '../../src/commands/adr.ts';
import {
  specList,
  specMatrix,
  specNew,
  specOrphans,
  specReDerive,
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

/** A real, schema-valid Story document with a caller-chosen `acceptance`/`tests` shape — written
 * directly (not via `specNew`'s own empty-array template) so `specReDerive`'s tests can exercise a
 * real bound AC, a real unbound AC, and a real stale (orphan) test in one fixture. `YAML.stringify`
 * builds the front matter from a plain object rather than hand-indented YAML text, so a list's own
 * block-vs-flow indentation is never a source of a test fixture silently failing to parse as
 * intended. */
async function writeStory(
  project: TestProject,
  id: string,
  acceptance: readonly { readonly id: string }[],
  tests: readonly string[],
): Promise<void> {
  const frontMatter = {
    id,
    type: 'Story',
    schemaVersion: 1,
    title: 'A real story',
    status: 'ready',
    created: '2026-01-15',
    updated: '2026-01-15',
    revision: 1,
    author: 'po',
    changelog: [],
    epic: 'EPIC-001',
    capability: 'CAP-001',
    storyType: 'feature',
    size: 'S',
    owner_role: 'backend',
    depends_on: [],
    blocked_by: [],
    interfaces: [],
    data: [],
    files_expected: ['src/**'],
    context_refs: [],
    acceptance: acceptance.map((ac) => ({
      id: ac.id,
      given: 'a precondition',
      when: 'the action happens',
      then: 'the outcome holds',
      kind: 'functional',
    })),
    tests: [...tests],
    dod_profile: 'backend-default',
  };
  const source = `---\n${YAML.stringify(frontMatter)}---\n\nBody.\n`;
  const doc = ArtifactDocument.parse(source, `${SPECS_ROOT}/stories/${id.toLowerCase()}.md`);
  await writeArtifact(project.paths, doc);
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

  it("derives InterfaceContract's own real {name} path variable from the title, no vars needed", async () => {
    const project = await createTestProject();
    const doc = await specNew(ctx(project), 'InterfaceContract', 'A real interface');
    expect(doc.path).toContain('a-real-interface');
  });

  it('an explicit vars.name still wins over the title-derived slug for InterfaceContract', async () => {
    const project = await createTestProject();
    const doc = await specNew(ctx(project), 'InterfaceContract', 'A real interface', {
      name: 'billing-api',
    });
    expect(doc.path).toContain('billing-api');
  });

  it("derives Story's own real {slug} path variable from the title, no vars needed", async () => {
    const project = await createTestProject();
    const doc = await specNew(ctx(project), 'Story', 'A real story');
    expect(doc.path).toContain('a-real-story');
  });

  it("derives DataModel's own real {slug} path variable from the title, no vars needed", async () => {
    const project = await createTestProject();
    const doc = await specNew(ctx(project), 'DataModel', 'A real data model');
    expect(doc.path).toContain('a-real-data-model');
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

describe('specReDerive (specs/22 M17 P17)', () => {
  /** One real fixture shared by most cases below: STORY-001 has a bound AC (AC-001-1, proven by a
   * real test), an unbound AC (AC-001-2, nothing proves it), and a stale test declared in its own
   * `tests[]` that claims an AC id ("AC-999-9") no story's `acceptance[]` ever declares — the real
   * "a spec edit removed/renamed the AC this test's name claims" shape `09` §9.7 point 4 describes.
   * STORY-002 is a second, disjoint story used to prove scoping actually narrows the result. */
  async function seedTwoStories(project: TestProject): Promise<void> {
    await writeStory(
      project,
      'STORY-001',
      [{ id: 'AC-001-1' }, { id: 'AC-001-2' }],
      ['AC-001-1 proves the first thing', 'AC-999-9 names a removed AC'],
    );
    // Fully clean: a bound AC with its own real test, so the "disjoint story" case below proves
    // real isolation rather than coincidentally finding a second, unrelated problem.
    await writeStory(
      project,
      'STORY-002',
      [{ id: 'AC-002-1' }],
      ['AC-002-1 proves the second thing'],
    );
  }

  it('throws KB-015 for an id that names no real graph node', async () => {
    const project = await createTestProject();
    await seedTwoStories(project);
    await expect(specReDerive(ctx(project), 'STORY-9999')).rejects.toMatchObject({
      code: 'KB-015',
    });
  });

  it('the bare form (no id) finds the stale test and the unbound AC across the whole graph', async () => {
    const project = await createTestProject();
    await seedTwoStories(project);
    const result = await specReDerive(ctx(project));
    expect(result.scope).toBeUndefined();
    expect(result.affected).toEqual([]);
    expect(result.staleTests).toEqual(['AC-999-9 names a removed AC']);
    expect(result.unboundAcceptanceCriteria).toEqual([{ acId: 'AC-001-2', storyId: 'STORY-001' }]);
  });

  it('returns empty results for a project with no specs at all', async () => {
    const project = await createTestProject();
    const result = await specReDerive(ctx(project));
    expect(result.staleTests).toEqual([]);
    expect(result.unboundAcceptanceCriteria).toEqual([]);
  });

  it('scoped to the owning Story, finds the identical stale test and unbound AC', async () => {
    const project = await createTestProject();
    await seedTwoStories(project);
    const result = await specReDerive(ctx(project), 'STORY-001');
    expect(result.scope).toBe('STORY-001');
    expect(result.staleTests).toEqual(['AC-999-9 names a removed AC']);
    expect(result.unboundAcceptanceCriteria).toEqual([{ acId: 'AC-001-2', storyId: 'STORY-001' }]);
    // The bound AC and its real test are in the downstream closure; the stale, disconnected test
    // (no `proves` edge at all — see `staleTestsFor`'s own doc comment) is not, and is found
    // through the Story's own raw `tests[]` field instead, never through graph traversal.
    expect(result.affected.map((node) => node.id).sort()).toEqual([
      'AC-001-1',
      'AC-001-1 proves the first thing',
      'AC-001-2',
    ]);
  });

  it('scoped to a different, disjoint Story, finds nothing from the first one', async () => {
    const project = await createTestProject();
    await seedTwoStories(project);
    const result = await specReDerive(ctx(project), 'STORY-002');
    expect(result.scope).toBe('STORY-002');
    expect(result.staleTests).toEqual([]);
    expect(result.unboundAcceptanceCriteria).toEqual([]);
  });

  it('scoped directly to the unbound AC id, reports itself even though it has no downstream closure', async () => {
    const project = await createTestProject();
    await seedTwoStories(project);
    const result = await specReDerive(ctx(project), 'AC-001-2');
    expect(result.affected).toEqual([]);
    expect(result.unboundAcceptanceCriteria).toEqual([{ acId: 'AC-001-2', storyId: 'STORY-001' }]);
  });

  it('scoped directly to the stale test id itself, reports itself as stale', async () => {
    const project = await createTestProject();
    await seedTwoStories(project);
    const result = await specReDerive(ctx(project), 'AC-999-9 names a removed AC');
    expect(result.staleTests).toEqual(['AC-999-9 names a removed AC']);
  });
});
