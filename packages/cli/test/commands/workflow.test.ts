/**
 * `forge workflow <list|show|validate|graph|new>`.
 *
 * @see specs/03 §3.2.8
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';
import * as YAML from 'yaml';
import { FakePlatformAdapter } from '@forge/testkit';
import { ProjectPaths } from '@forge/core/fs';

import {
  workflowGraph,
  workflowList,
  workflowNew,
  workflowShow,
  workflowValidate,
  workflowValidateAll,
} from '../../src/commands/workflow.ts';
import { runInit } from '../../src/init/run-init.ts';
import { cleanupAll, createTestProject } from './upgrade/helpers.ts';
import { agentYaml } from './loop/helpers.ts';

afterEach(cleanupAll);

// The real, shipped `modules/` -- `PLAN-M14.md` P7's own "root: zero findings over shipped workflows"
// acceptance needs the real roster, not the fixture-mod one every other test in this file uses.
const REAL_MODULES_DIR = fileURLToPath(new URL('../../../../modules/', import.meta.url));

const initDirs: string[] = [];
afterEach(async () => {
  await Promise.all(initDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

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
      // `tester`'s own real `tools.write` grant is `true` (`PLAN-M14.md` P7: a write-capable agent
      // step needs a real claim, or it is `write-without-claim`), so this step declares one.
      "id: clean\nname: clean\nversion: 1.0.0\ndescription: fixture\nsteps:\n  - id: only\n    kind: agent\n    agent: tester\n    brief: briefs/fixture.md\n    produces: ['docs/forge/specs/tasks/**']\n",
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
      "id: needs-brief\nname: needs-brief\nversion: 1.0.0\ndescription: fixture\nsteps:\n  - id: only\n    kind: agent\n    agent: tester\n    brief: briefs/needs-brief.md\n    produces: ['docs/forge/specs/tasks/**']\n",
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
      "id: templated-brief\nname: templated-brief\nversion: 1.0.0\ndescription: fixture\nsteps:\n  - id: only\n    kind: agent\n    agent: tester\n    brief: 'briefs/{{item.id}}.md'\n    produces: ['docs/forge/specs/tasks/**']\n",
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

// `06` §6.7's "an empty claim means no write," surfaced at validate time (`SPEC-QUESTIONS.md`
// Q225/Q232 decision 6, `PLAN-M14.md` P7): `buildOracle`'s own `agentWrites`, backed by real
// `.forge/agents/<id>.yaml` files.
describe('workflowValidate: write-without-claim', () => {
  it('reports a real write-capable agent step with an empty claim', async () => {
    const project = await createTestProject();
    const { writeFileAtomic } = await import('@forge/core/fs');
    await writeFileAtomic(
      project.paths.resolveWithin('.forge/agents/backend.yaml'),
      agentYaml('backend', 'Backend', { write: true, code: true }),
    );
    await writeFileAtomic(
      project.paths.resolveWithin('.forge/workflows/empty-claim.workflow.yaml'),
      'id: empty-claim\nname: empty-claim\nversion: 1.0.0\ndescription: fixture\nsteps:\n  - id: only\n    kind: agent\n    agent: backend\n    brief: fixture\n',
    );
    const issues = await workflowValidate(ctxFor(project), 'empty-claim');
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'write-without-claim', stepId: 'only' }),
    );
  });

  it('does not report a step whose agent grant has no write', async () => {
    const project = await createTestProject();
    const { writeFileAtomic } = await import('@forge/core/fs');
    await writeFileAtomic(
      project.paths.resolveWithin('.forge/agents/reviewer.yaml'),
      agentYaml('reviewer', 'Reviewer', { write: false }),
    );
    await writeFileAtomic(
      project.paths.resolveWithin('.forge/workflows/read-only.workflow.yaml'),
      'id: read-only\nname: read-only\nversion: 1.0.0\ndescription: fixture\nsteps:\n  - id: only\n    kind: agent\n    agent: reviewer\n    brief: fixture\n',
    );
    const issues = await workflowValidate(ctxFor(project), 'read-only');
    expect(issues.filter((issue) => issue.code === 'write-without-claim')).toEqual([]);
  });

  it('does not report a step whose produces claims a real path', async () => {
    const project = await createTestProject();
    const { writeFileAtomic } = await import('@forge/core/fs');
    await writeFileAtomic(
      project.paths.resolveWithin('.forge/agents/backend.yaml'),
      agentYaml('backend', 'Backend', { write: true, code: true }),
    );
    await writeFileAtomic(
      project.paths.resolveWithin('.forge/workflows/claimed.workflow.yaml'),
      "id: claimed\nname: claimed\nversion: 1.0.0\ndescription: fixture\nsteps:\n  - id: only\n    kind: agent\n    agent: backend\n    brief: fixture\n    produces: ['src/**']\n",
    );
    const issues = await workflowValidate(ctxFor(project), 'claimed');
    expect(issues.filter((issue) => issue.code === 'write-without-claim')).toEqual([]);
  });

  it('treats a corrupt sibling agent file as "not a writer, not judged" -- no crash, no false finding', async () => {
    const project = await createTestProject();
    const { writeFileAtomic } = await import('@forge/core/fs');
    await writeFileAtomic(
      project.paths.resolveWithin('.forge/agents/broken.yaml'),
      'id: [unterminated',
    );
    await writeFileAtomic(
      project.paths.resolveWithin('.forge/workflows/broken-agent.workflow.yaml'),
      'id: broken-agent\nname: broken-agent\nversion: 1.0.0\ndescription: fixture\nsteps:\n  - id: only\n    kind: agent\n    agent: broken\n    brief: fixture\n',
    );
    const issues = await workflowValidate(ctxFor(project), 'broken-agent');
    expect(issues.filter((issue) => issue.code === 'write-without-claim')).toEqual([]);
  });

  it('reports an empty-claim "{{ownerRole}}"/"{{item.owner_role}}" step -- the two real templated shapes always resolve to a writer', async () => {
    const project = await createTestProject();
    const { writeFileAtomic } = await import('@forge/core/fs');
    await writeFileAtomic(
      project.paths.resolveWithin('.forge/workflows/templated-owner.workflow.yaml'),
      "id: templated-owner\nname: templated-owner\nversion: 1.0.0\ndescription: fixture\nsteps:\n  - id: a\n    kind: agent\n    agent: '{{ownerRole}}'\n    brief: fixture\n  - id: b\n    kind: agent\n    agent: '{{item.owner_role}}'\n    brief: fixture\n    dependsOn: [a]\n",
    );
    const issues = await workflowValidate(ctxFor(project), 'templated-owner');
    expect(
      issues.filter((issue) => issue.code === 'write-without-claim').map((i) => i.stepId),
    ).toEqual(['a', 'b']);
  });

  it('does not report an empty-claim step templated with anything OTHER than the owner-role placeholder -- "not judged", not "assume it writes"', async () => {
    const project = await createTestProject();
    const { writeFileAtomic } = await import('@forge/core/fs');
    await writeFileAtomic(
      project.paths.resolveWithin('.forge/workflows/templated-other.workflow.yaml'),
      "id: templated-other\nname: templated-other\nversion: 1.0.0\ndescription: fixture\nsteps:\n  - id: a\n    kind: agent\n    agent: '{{item.reviewerRole}}'\n    brief: fixture\n",
    );
    const issues = await workflowValidate(ctxFor(project), 'templated-other');
    expect(issues.filter((issue) => issue.code === 'write-without-claim')).toEqual([]);
  });
});

describe('workflowValidate: write-without-claim, against the real, shipped roster', () => {
  it('is clean for a real forge init project; removing one shipped produces claim reports the offending step', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-workflow-claims-'));
    initDirs.push(dir);
    await runInit(
      dir,
      { name: 'P7 real roster', yes: true, level: 'L0' },
      { candidateAdapters: [new FakePlatformAdapter()], env: {}, modulesDir: REAL_MODULES_DIR },
    );
    const paths = new ProjectPaths(dir);
    const ctx = {
      paths,
      workflowsRoot: '.forge/workflows',
      agentsRoot: '.forge/agents',
      checksRoot: '.forge/checks',
    };

    const before = await workflowValidateAll(ctx);
    const beforeOffenders = [...before.values()]
      .flat()
      .filter((issue) => issue.code === 'write-without-claim');
    expect(beforeOffenders).toEqual([]);

    // `quick-fix:fix` runs `backend` (a real `Code`-declaring implementer) with
    // `produces: ['**', '!@protected']` -- removing that claim leaves the step's grant withheld
    // (`06` §6.7) and empty.
    const relPath = '.forge/workflows/quick-fix.workflow.yaml';
    const text = await readFile(path.join(dir, relPath), 'utf8');
    const parsed = YAML.parse(text) as {
      steps: readonly { id: string; produces?: unknown }[];
    };
    const fixStep = parsed.steps.find((step) => step.id === 'fix');
    expect(fixStep).toBeDefined();
    delete fixStep?.produces;
    await writeFile(path.join(dir, relPath), YAML.stringify(parsed), 'utf8');

    const after = await workflowValidateAll(ctx);
    expect(after.get('quick-fix')).toContainEqual(
      expect.objectContaining({ code: 'write-without-claim', stepId: 'fix' }),
    );
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
