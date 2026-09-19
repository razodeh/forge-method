/**
 * `forge workflow <list|show|validate|graph|new>`.
 *
 * @see specs/03 §3.2.8
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  workflowGraph,
  workflowList,
  workflowNew,
  workflowShow,
  workflowValidate,
  workflowValidateAll,
} from '../../src/commands/workflow.ts';
import { cleanupAll, createTestProject } from './upgrade/helpers.ts';

afterEach(cleanupAll);

function ctxFor(project: Awaited<ReturnType<typeof createTestProject>>) {
  return {
    paths: project.paths,
    workflowsRoot: '.forge/workflows',
    agentsRoot: '.forge/agents',
    checksRoot: '.forge/checks',
  };
}

describe('workflowList / workflowShow', () => {
  it('lists every real, materialized workflow id and can show one', async () => {
    const project = await createTestProject();
    const ids = await workflowList(ctxFor(project));
    expect(ids.length).toBeGreaterThan(0);
    const first = ids[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const shown = await workflowShow(ctxFor(project), first);
    expect(shown.id).toBe(first);
  });
});

describe('workflowValidate', () => {
  it('passes cleanly for a real, well-formed workflow whose every reference resolves', async () => {
    // The fixture project's own real roster only ships one real agent (`tester`, from
    // `test/init/fixtures/modules/fixture-mod`) -- every real, shipped `10 §10.5` workflow references
    // agents this fixture roster does not have, so this builds its own real, minimal workflow
    // referencing only what the fixture roster genuinely provides, to prove the real happy path
    // deterministically rather than depending on which shipped workflow (if any) happens to fit.
    const project = await createTestProject();
    const relPath = '.forge/workflows/clean.workflow.yaml';
    const { writeFileAtomic } = await import('@forge/core/fs');
    await writeFileAtomic(
      project.paths.resolveWithin(relPath),
      'id: clean\nname: clean\nversion: 1.0.0\ndescription: fixture\nsteps:\n  - id: only\n    kind: agent\n    agent: tester\n    brief: briefs/fixture.md\n',
    );
    // `briefExists` (`PLAN-M13.md` P1) is now a real check against `.forge/briefs/` -- a real backing
    // file is written here so this test's own stated "every reference resolves" happy path stays
    // genuine, matching the real, project-relative `briefs/<name>.md` convention every real, shipped
    // workflow uses (not the bare, non-path-shaped placeholder this fixture used before that check
    // existed to catch it). See `SPEC-QUESTIONS.md` Q197.
    await writeFileAtomic(
      project.paths.resolveWithin('.forge/briefs/fixture.md'),
      'Do the fixture thing.\n',
    );
    const issues = await workflowValidate(ctxFor(project), 'clean');
    expect(issues).toEqual([]);
  });

  it('reports a real unknown-brief finding for a brief that resolves to nothing, and clears it once a real file exists', async () => {
    const project = await createTestProject();
    const { writeFileAtomic } = await import('@forge/core/fs');
    await writeFileAtomic(
      project.paths.resolveWithin('.forge/workflows/needs-brief.workflow.yaml'),
      'id: needs-brief\nname: needs-brief\nversion: 1.0.0\ndescription: fixture\nsteps:\n  - id: only\n    kind: agent\n    agent: tester\n    brief: briefs/needs-brief.md\n',
    );
    const before = await workflowValidate(ctxFor(project), 'needs-brief');
    expect(before).toEqual([
      {
        code: 'unknown-brief',
        severity: 'error',
        message: 'Step "only" references unknown brief "briefs/needs-brief.md".',
        stepId: 'only',
      },
    ]);

    // An empty file is not real content; a directory, a .txt and a wrong-named file do not count either.
    await writeFileAtomic(project.paths.resolveWithin('.forge/briefs/needs-brief.md'), '');
    await writeFileAtomic(project.paths.resolveWithin('.forge/briefs/needs-brief.txt'), 'text\n');
    expect(await workflowValidate(ctxFor(project), 'needs-brief')).toHaveLength(1);

    await writeFileAtomic(
      project.paths.resolveWithin('.forge/briefs/needs-brief.md'),
      'Do the thing.\n',
    );
    expect(await workflowValidate(ctxFor(project), 'needs-brief')).toEqual([]);
  });

  it('treats a still-templated {{...}} brief as unverifiable, like its sibling oracle methods', async () => {
    const project = await createTestProject();
    const { writeFileAtomic } = await import('@forge/core/fs');
    await writeFileAtomic(
      project.paths.resolveWithin('.forge/workflows/templated-brief.workflow.yaml'),
      "id: templated-brief\nname: templated-brief\nversion: 1.0.0\ndescription: fixture\nsteps:\n  - id: only\n    kind: agent\n    agent: tester\n    brief: 'briefs/{{item.id}}.md'\n",
    );
    expect(await workflowValidate(ctxFor(project), 'templated-brief')).toEqual([]);
  });

  it('reports a real unknown-gate finding for a fabricated gate reference', async () => {
    const project = await createTestProject();
    await workflowNew(ctxFor(project), 'custom-flow');
    const { readTextFile, writeFileAtomic } = await import('@forge/core/fs');
    const relPath = '.forge/workflows/custom-flow.workflow.yaml';
    const text = await readTextFile(project.paths.resolveWithin(relPath));
    await writeFileAtomic(
      project.paths.resolveWithin(relPath),
      `${text}\nrequires:\n  gates_passed:\n    - G-Not-Real\n`,
    );
    const issues = await workflowValidate(ctxFor(project), 'custom-flow');
    expect(issues.some((issue) => issue.code === 'unknown-gate')).toBe(true);
  });

  it('does not report an unknown-agent finding for a real, unresolved {{template}} reference', async () => {
    const project = await createTestProject();
    const relPath = '.forge/workflows/templated.workflow.yaml';
    const { writeFileAtomic } = await import('@forge/core/fs');
    await writeFileAtomic(
      project.paths.resolveWithin(relPath),
      `id: templated\nname: templated\nversion: 1.0.0\ndescription: fixture\nsteps:\n  - id: only\n    kind: agent\n    agent: '{{ownerRole}}'\n    brief: fixture\n`,
    );
    const issues = await workflowValidate(ctxFor(project), 'templated');
    expect(issues.some((issue) => issue.code === 'unknown-agent')).toBe(false);
  });

  it('throws KB-015 for a workflow id that does not exist', async () => {
    const project = await createTestProject();
    await expect(workflowValidate(ctxFor(project), 'does-not-exist')).rejects.toMatchObject({
      code: 'KB-015',
    });
  });

  it('throws CFG-001 for a real, unparseable workflow document', async () => {
    const project = await createTestProject();
    const { writeFileAtomic } = await import('@forge/core/fs');
    await writeFileAtomic(
      project.paths.resolveWithin('.forge/workflows/broken.workflow.yaml'),
      'id: [unterminated\n',
    );
    await expect(workflowValidate(ctxFor(project), 'broken')).rejects.toMatchObject({
      code: 'CFG-001',
    });
  });

  it('does not crash when .forge/agents/ does not exist at all', async () => {
    const project = await createTestProject();
    const { rm } = await import('node:fs/promises');
    await rm(project.paths.resolveWithin('.forge/agents'), { recursive: true, force: true });
    const relPath = '.forge/workflows/no-agents.workflow.yaml';
    const { writeFileAtomic } = await import('@forge/core/fs');
    await writeFileAtomic(
      project.paths.resolveWithin(relPath),
      'id: no-agents\nname: no-agents\nversion: 1.0.0\ndescription: fixture\nsteps:\n  - id: only\n    kind: agent\n    agent: tester\n    brief: fixture\n',
    );
    const issues = await workflowValidate(ctxFor(project), 'no-agents');
    expect(issues.some((issue) => issue.code === 'unknown-agent')).toBe(true);
  });
});

describe('workflowValidateAll', () => {
  it('validates every real workflow independently, one bad workflow never hiding the rest', async () => {
    const project = await createTestProject();
    await workflowNew(ctxFor(project), 'custom-flow');
    const { readTextFile, writeFileAtomic } = await import('@forge/core/fs');
    const relPath = '.forge/workflows/custom-flow.workflow.yaml';
    const text = await readTextFile(project.paths.resolveWithin(relPath));
    await writeFileAtomic(
      project.paths.resolveWithin(relPath),
      `${text}\nrequires:\n  gates_passed:\n    - G-Not-Real\n`,
    );

    const results = await workflowValidateAll(ctxFor(project));
    expect(results.get('custom-flow')?.some((issue) => issue.code === 'unknown-gate')).toBe(true);
    // Every other real workflow was still checked too.
    expect(results.size).toBeGreaterThan(1);
  });
});

describe('workflowGraph', () => {
  it('renders a real, top-level Mermaid flowchart from real step ids and dependsOn edges', async () => {
    const project = await createTestProject();
    const relPath = '.forge/workflows/graphed.workflow.yaml';
    const { writeFileAtomic } = await import('@forge/core/fs');
    await writeFileAtomic(
      project.paths.resolveWithin(relPath),
      `id: graphed\nname: graphed\nversion: 1.0.0\ndescription: fixture\nsteps:\n  - id: first\n    kind: agent\n    agent: engineer\n    brief: fixture\n  - id: second\n    kind: agent\n    agent: engineer\n    brief: fixture\n    dependsOn: [first]\n`,
    );
    const graph = await workflowGraph(ctxFor(project), 'graphed');
    expect(graph).toContain('flowchart TD');
    expect(graph).toContain('first --> second');
  });
});

describe('workflowNew', () => {
  it('writes a real, minimal, schema-valid workflow document', async () => {
    const project = await createTestProject();
    const relPath = await workflowNew(ctxFor(project), 'my-flow');
    expect(relPath).toBe('.forge/workflows/my-flow.workflow.yaml');
    const shown = await workflowShow(ctxFor(project), 'my-flow');
    expect(shown.id).toBe('my-flow');
  });

  it('scaffolds the brief it names, so a new workflow has no unknown-brief finding of its own', async () => {
    const project = await createTestProject();
    await workflowNew(ctxFor(project), 'my-flow');
    const issues = await workflowValidate(ctxFor(project), 'my-flow');
    expect(issues.some((issue) => issue.code === 'unknown-brief')).toBe(false);
  });

  it('refuses to overwrite a real, already-existing workflow file', async () => {
    const project = await createTestProject();
    await workflowNew(ctxFor(project), 'my-flow');
    await expect(workflowNew(ctxFor(project), 'my-flow')).rejects.toMatchObject({
      code: 'CFG-001',
    });
  });
});
