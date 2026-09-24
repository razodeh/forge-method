/**
 * `forge agent <list|show|new|validate|compile>` plus `override|diff|reset`.
 *
 * @see specs/05 §5.9
 * @see specs/05 §5.10
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';
import type { PlatformAdapter } from '@forge/adapter-kit/types';
import { FakePlatformAdapter } from '@forge/testkit';

import { runInit } from '../../src/init/run-init.ts';
import { ProjectPaths } from '@forge/core/fs';
import {
  agentCompile,
  agentList,
  agentNew,
  agentOverride,
  agentReset,
  agentShow,
  agentValidateAll,
  agentValidateOne,
  type AgentValidationFinding,
} from '../../src/commands/agent.ts';
import { cleanupAll, createTestProject } from './upgrade/helpers.ts';

afterEach(cleanupAll);

const AGENTS_ROOT = '.forge/agents';

const REAL_MODULES_DIR = fileURLToPath(new URL('../../../../modules/', import.meta.url));

describe('agentList / agentShow', () => {
  it('lists every real, materialized agent id and can show one', async () => {
    const project = await createTestProject();
    const ids = await agentList({ paths: project.paths, agentsRoot: AGENTS_ROOT });
    expect(ids.length).toBeGreaterThan(0);

    const first = ids[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const shown = await agentShow({ paths: project.paths, agentsRoot: AGENTS_ROOT }, first);
    expect(shown.id).toBe(first);
  });
});

describe('agentNew', () => {
  it('writes a real, minimal, schema-valid agent definition', async () => {
    const project = await createTestProject();
    const relPath = await agentNew(
      { paths: project.paths, agentsRoot: AGENTS_ROOT },
      'custom-role',
      'Custom Role',
    );
    expect(relPath).toBe(`${AGENTS_ROOT}/custom-role.yaml`);
    const shown = await agentShow({ paths: project.paths, agentsRoot: AGENTS_ROOT }, 'custom-role');
    expect(shown.name).toBe('Custom Role');
    expect(shown.outputs.length).toBeGreaterThan(0);
  });

  it('scaffolds the prompt it names, so a new agent has no unknown-prompt finding of its own', async () => {
    const project = await createTestProject();
    await agentNew({ paths: project.paths, agentsRoot: AGENTS_ROOT }, 'custom-role', 'Custom Role');
    const findings = await agentValidateOne(
      { paths: project.paths, agentsRoot: AGENTS_ROOT },
      'custom-role',
    );
    expect(findings.filter((finding) => finding.code === 'unknown-prompt')).toEqual([]);
  });

  it('refuses to overwrite a real, already-existing agent file', async () => {
    const project = await createTestProject();
    await agentNew({ paths: project.paths, agentsRoot: AGENTS_ROOT }, 'custom-role', 'Custom Role');
    await expect(
      agentNew({ paths: project.paths, agentsRoot: AGENTS_ROOT }, 'custom-role', 'Custom Role'),
    ).rejects.toMatchObject({ code: 'CFG-001' });
  });
});

describe('agentValidateAll — fixture roster', () => {
  it('passes cleanly for the real, unmodified fixture roster', async () => {
    const project = await createTestProject();
    // The fixture roster's own real `tester` agent declares `prompt.system: prompts/tester.system.md`
    // (`test/init/fixtures/modules/fixture-mod/agents/tester.agent.yaml`) -- genuinely unresolved by
    // `forge init` alone (`PROMPT_INDEX` is still empty, `PLAN-M13.md` P1, `SPEC-QUESTIONS.md` Q197),
    // so a real backing file is written here to keep this test's own stated "passes cleanly" happy path
    // genuine rather than silently weakened to tolerate an unrelated, real `unknown-prompt` finding.
    const { writeFileAtomic } = await import('@forge/core/fs');
    await writeFileAtomic(
      project.paths.resolveWithin('.forge/prompts/tester.system.md'),
      'You are the fixture Tester.\n',
    );
    const findings = await agentValidateAll({ paths: project.paths, agentsRoot: AGENTS_ROOT });
    expect(findings).toEqual([]);
  });

  it('reports unknown-prompt per missing reference, and only that finding disappears once its file exists', async () => {
    const project = await createTestProject();
    const { readTextFile, writeFileAtomic } = await import('@forge/core/fs');
    await agentNew({ paths: project.paths, agentsRoot: AGENTS_ROOT }, 'prompted', 'Prompted');
    const relPath = `${AGENTS_ROOT}/prompted.yaml`;
    const text = await readTextFile(project.paths.resolveWithin(relPath));
    await writeFileAtomic(
      project.paths.resolveWithin(relPath),
      `${text.replace(/prompt:[\s\S]*$/, '')}prompt:\n  system: prompts/prompted.system.md\n  briefs:\n    do-it: prompts/prompted.do-it.md\n`,
    );
    await writeFileAtomic(project.paths.resolveWithin('.forge/prompts/prompted.system.md'), '');

    const ctx = { paths: project.paths, agentsRoot: AGENTS_ROOT };
    const messages = async (): Promise<readonly string[]> =>
      (await agentValidateOne(ctx, 'prompted'))
        .filter((finding) => finding.code === 'unknown-prompt')
        .map((finding) => finding.message);
    // `system` resolves to an empty file (not real content), so it is reported too.
    expect(await messages()).toEqual([
      'prompt.system references unknown prompt "prompts/prompted.system.md".',
      'prompt.briefs.do-it references unknown prompt "prompts/prompted.do-it.md".',
    ]);

    await writeFileAtomic(
      project.paths.resolveWithin('.forge/prompts/prompted.system.md'),
      'You are prompted.\n',
    );
    expect(await messages()).toEqual([
      'prompt.briefs.do-it references unknown prompt "prompts/prompted.do-it.md".',
    ]);
  });

  it('reports a real kb_write overlap for two agents both claiming the same real namespace', async () => {
    const project = await createTestProject();
    await agentNew({ paths: project.paths, agentsRoot: AGENTS_ROOT }, 'writer-a', 'Writer A');
    await agentNew({ paths: project.paths, agentsRoot: AGENTS_ROOT }, 'writer-b', 'Writer B');
    // `agentNew`'s own scaffold has an empty `kb_write` -- hand-edit both to claim the identical
    // real namespace, a genuine, real overlap.
    const { readTextFile, writeFileAtomic } = await import('@forge/core/fs');
    for (const id of ['writer-a', 'writer-b']) {
      const relPath = `${AGENTS_ROOT}/${id}.yaml`;
      const text = await readTextFile(project.paths.resolveWithin(relPath));
      await writeFileAtomic(
        project.paths.resolveWithin(relPath),
        text.replace('kb_write: []', 'kb_write:\n  - architecture/**'),
      );
    }

    const findings = await agentValidateAll({ paths: project.paths, agentsRoot: AGENTS_ROOT });
    const overlapFindings = findings.filter((finding) => finding.code === 'kb-write-overlap');
    expect(overlapFindings.length).toBeGreaterThan(0);
    // Both real agents are implicated, not just the alphabetically-first one.
    expect(overlapFindings.some((finding) => finding.agentId === 'writer-a')).toBe(true);
    expect(overlapFindings.some((finding) => finding.agentId === 'writer-b')).toBe(true);

    const scopedToA = await agentValidateOne(
      { paths: project.paths, agentsRoot: AGENTS_ROOT },
      'writer-a',
    );
    expect(scopedToA.some((finding) => finding.code === 'kb-write-overlap')).toBe(true);
    const scopedToB = await agentValidateOne(
      { paths: project.paths, agentsRoot: AGENTS_ROOT },
      'writer-b',
    );
    expect(scopedToB.some((finding) => finding.code === 'kb-write-overlap')).toBe(true);
  });

  it('reports a real ceiling-exceeded finding when tools.network: true exceeds a non-full ceiling', async () => {
    const project = await createTestProject();
    await agentNew(
      { paths: project.paths, agentsRoot: AGENTS_ROOT },
      'over-network',
      'Over Network',
    );
    const relPath = `${AGENTS_ROOT}/over-network.yaml`;
    const { readTextFile, writeFileAtomic } = await import('@forge/core/fs');
    const text = await readTextFile(project.paths.resolveWithin(relPath));
    await writeFileAtomic(
      project.paths.resolveWithin(relPath),
      `${text.replace('network: false', 'network: true')}ceiling:\n  tools:\n    network: none\n`,
    );

    const findings = await agentValidateAll({ paths: project.paths, agentsRoot: AGENTS_ROOT });
    expect(
      findings.some(
        (finding) => finding.agentId === 'over-network' && finding.code === 'ceiling-exceeded',
      ),
    ).toBe(true);
  });

  it('reports a real unknown-framework finding for a fabricated framework reference', async () => {
    const project = await createTestProject();
    await agentNew({ paths: project.paths, agentsRoot: AGENTS_ROOT }, 'fabricator', 'Fabricator');
    const { readTextFile, writeFileAtomic } = await import('@forge/core/fs');
    const relPath = `${AGENTS_ROOT}/fabricator.yaml`;
    const text = await readTextFile(project.paths.resolveWithin(relPath));
    await writeFileAtomic(
      project.paths.resolveWithin(relPath),
      `${text}frameworks:\n  - not-a-real-framework\n`,
    );

    const findings = await agentValidateAll({ paths: project.paths, agentsRoot: AGENTS_ROOT });
    expect(
      findings.some(
        (finding) => finding.agentId === 'fabricator' && finding.code === 'unknown-framework',
      ),
    ).toBe(true);
  });

  it('reports a real unregistered-output-type warning for a scaffolded, non-registry output type; a registered type and "Code" both stay exempt', async () => {
    const project = await createTestProject();
    // `agentNew`'s own scaffold (`AGENT_TEMPLATE`) declares `type: 'Report'`, which is itself not a `18`
    // §18.7 registry type nor "Code" -- a real, already-present unregistered output, no further hand-edit
    // needed to exercise the warning branch.
    await agentNew({ paths: project.paths, agentsRoot: AGENTS_ROOT }, 'outputter', 'Outputter');
    const unregisteredFindings = async (): Promise<readonly AgentValidationFinding[]> =>
      (await agentValidateOne({ paths: project.paths, agentsRoot: AGENTS_ROOT }, 'outputter')).filter(
        (finding) => finding.code === 'unregistered-output-type',
      );
    const first = await unregisteredFindings();
    expect(first).toHaveLength(1);
    expect(first[0]?.severity).toBe('warning');
    expect(first[0]?.message).toContain('"Report"');

    const { readTextFile, writeFileAtomic } = await import('@forge/core/fs');
    const relPath = `${AGENTS_ROOT}/outputter.yaml`;
    const text = await readTextFile(project.paths.resolveWithin(relPath));
    // A registered type (`Task`) does not warn.
    await writeFileAtomic(
      project.paths.resolveWithin(relPath),
      text.replace(
        "outputs:\n  - type: Report\n    schema: report.schema.json\n    path: report.md\n",
        "outputs:\n  - type: Task\n    schema: task.schema.json\n    path: docs/forge/specs/tasks/TASK-*.md\n    cardinality: many\n",
      ),
    );
    expect(await unregisteredFindings()).toEqual([]);

    // The special-cased "Code" does not warn either.
    await writeFileAtomic(
      project.paths.resolveWithin(relPath),
      (await readTextFile(project.paths.resolveWithin(relPath))).replace(
        "outputs:\n  - type: Task\n    schema: task.schema.json\n    path: docs/forge/specs/tasks/TASK-*.md\n    cardinality: many\n",
        "outputs:\n  - type: Code\n    schema: code-change.schema.json\n    path: 'src/**'\n",
      ),
    );
    expect(await unregisteredFindings()).toEqual([]);
  });

  it("reports a real output-ownership-overlap error, naming both real agents, when one agent's declared output's registry sample lies inside another's exclusive file_ownership", async () => {
    const project = await createTestProject();
    await agentNew({ paths: project.paths, agentsRoot: AGENTS_ROOT }, 'owner', 'Owner');
    await agentNew({ paths: project.paths, agentsRoot: AGENTS_ROOT }, 'producer', 'Producer');
    const { readTextFile, writeFileAtomic } = await import('@forge/core/fs');

    const ownerRelPath = `${AGENTS_ROOT}/owner.yaml`;
    const ownerText = await readTextFile(project.paths.resolveWithin(ownerRelPath));
    await writeFileAtomic(
      project.paths.resolveWithin(ownerRelPath),
      ownerText.replace(
        'parallel_safety:\n  file_ownership: []\n  exclusive: false\n',
        "parallel_safety:\n  file_ownership:\n    - docs/forge/kb/decisions/**\n  exclusive: true\n",
      ),
    );

    const producerRelPath = `${AGENTS_ROOT}/producer.yaml`;
    const producerText = await readTextFile(project.paths.resolveWithin(producerRelPath));
    await writeFileAtomic(
      project.paths.resolveWithin(producerRelPath),
      producerText.replace(
        "outputs:\n  - type: Report\n    schema: report.schema.json\n    path: report.md\n",
        "outputs:\n  - type: ADR\n    schema: adr.schema.json\n    path: docs/forge/kb/decisions/ADR-*.md\n    cardinality: many\n",
      ),
    );

    const findings = await agentValidateAll({ paths: project.paths, agentsRoot: AGENTS_ROOT });
    const overlapFindings = findings.filter((finding) => finding.code === 'output-ownership-overlap');
    expect(overlapFindings.length).toBeGreaterThan(0);
    for (const finding of overlapFindings) expect(finding.severity).toBe('error');
    // Both real agents are implicated (`overlapFindings`'s own established reasoning), not just the one
    // that declares the output.
    expect(overlapFindings.some((finding) => finding.agentId === 'producer')).toBe(true);
    expect(overlapFindings.some((finding) => finding.agentId === 'owner')).toBe(true);

    const scopedToProducer = await agentValidateOne(
      { paths: project.paths, agentsRoot: AGENTS_ROOT },
      'producer',
    );
    expect(scopedToProducer.some((finding) => finding.code === 'output-ownership-overlap')).toBe(true);
    const scopedToOwner = await agentValidateOne(
      { paths: project.paths, agentsRoot: AGENTS_ROOT },
      'owner',
    );
    expect(scopedToOwner.some((finding) => finding.code === 'output-ownership-overlap')).toBe(true);
  });

  it('reports a real schema-invalid agent as a finding, without crashing the whole roster check', async () => {
    const project = await createTestProject();
    const { writeFileAtomic } = await import('@forge/core/fs');
    await writeFileAtomic(
      project.paths.resolveWithin(`${AGENTS_ROOT}/broken.yaml`),
      'id: broken\nname: Broken\n',
    );

    const findings = await agentValidateAll({ paths: project.paths, agentsRoot: AGENTS_ROOT });
    expect(
      findings.some((finding) => finding.agentId === 'broken' && finding.code === 'schema'),
    ).toBe(true);
    // Every other real, valid agent in the roster is still checked -- one bad file doesn't blank the
    // rest of the report.
    const ids = await agentList({ paths: project.paths, agentsRoot: AGENTS_ROOT });
    expect(ids.length).toBeGreaterThan(1);
  });
});

describe('agentValidateAll — real, complete A2/A3 roster', () => {
  // Every shipped agent's `prompt.system`/`prompt.briefs.*` reference resolves to real, non-empty content
  // (`PLAN-M13.md` P1 added the check, P3a/P3b authored the content), no `output-ownership-overlap` error
  // remains (`PLAN-M14.md` P42 reconciled architect/orchestrator/em's own `file_ownership`), and no
  // `kb-write-overlap`/`ceiling-exceeded`/`unknown-*` finding fires either: genuinely clean of every ERROR.
  // Not genuinely clean of every finding: seven `unregistered-output-type` WARNINGS remain, one per real
  // output type the registry, `Code`, nor (this validator has no project- or repo-level notion of "which
  // modules are installed", `SPEC-QUESTIONS.md`'s own Discloses for P42) a module's own
  // `provides.artifactTypes` names -- each a deliberate, already-justified content choice (Q224: "no
  // step declares one" on four roles no shipped workflow runs, its own six such types; `fm-web`'s own
  // real `ComponentSpec`, the one Q224 itself tracked separately rather than as part of "the seven"; the
  // count of seven matches Q224's own by coincidence, not by an identical set -- `ContextMap` counts
  // once here, not twice, since only one module's copy of `domain-modeler` survives materialization), not
  // a bug this piece's own new check should silently paper over.
  it('reports exactly seven unregistered-output-type warnings against the real, complete, currently-shipped roster, and no error', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-cli-agent-real-'));
    try {
      const result = await runInit(
        dir,
        { name: 'Real Roster Check', yes: true },
        { candidateAdapters: [new FakePlatformAdapter()], env: {}, modulesDir: REAL_MODULES_DIR },
      );
      expect(result.kind).toBe('initialized');

      const paths = new ProjectPaths(dir);
      const findings = await agentValidateAll({ paths, agentsRoot: AGENTS_ROOT });
      expect(findings.every((finding) => finding.severity === 'warning')).toBe(true);
      expect(findings.every((finding) => finding.code === 'unregistered-output-type')).toBe(true);
      const expectedUnregisteredOutputs: readonly (readonly [agentId: string, type: string])[] = [
        ['compliance', 'ComplianceMatrix'],
        ['critic', 'ObjectionList'],
        ['domain-modeler', 'ContextMap'],
        ['finops', 'CostModel'],
        ['frontend', 'ComponentSpec'],
        ['techwriter', 'Readme'],
        ['techwriter', 'DocsSet'],
      ];
      expect(
        findings.map((finding) => `${finding.agentId}:${finding.message}`).sort(),
      ).toEqual(
        expectedUnregisteredOutputs
          .map(
            ([agentId, type]) =>
              `${agentId}:outputs names ${JSON.stringify(type)}, which is neither a registered artifact type (18 §18.7) nor "Code".`,
          )
          .sort(),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('agentCompile', () => {
  it('calls a real, injected adapter’s own installAssets over the whole real roster', async () => {
    const project = await createTestProject();
    const adapter = new FakePlatformAdapter();
    const installed = await agentCompile({
      paths: project.paths,
      agentsRoot: AGENTS_ROOT,
      adapter,
      projectRoot: project.dir,
    });
    expect(Array.isArray(installed)).toBe(true);
  });

  it('throws ENV-004 when the injected adapter has no real installAssets of its own', async () => {
    const project = await createTestProject();
    // A minimal, partial stand-in -- only `id`/`installAssets` are ever read by `agentCompile` itself,
    // the same "cast a partial platform-adapter-shaped double" precedent `doctor/environment.test.ts`
    // already establishes for the identical situation.
    const adapter = { id: 'no-assets' } as unknown as PlatformAdapter;
    await expect(
      agentCompile({
        paths: project.paths,
        agentsRoot: AGENTS_ROOT,
        adapter,
        projectRoot: project.dir,
      }),
    ).rejects.toMatchObject({ code: 'ENV-004' });
  });
});

describe('agentOverride / agentReset', () => {
  it('writes a real overlay file and resets it back to a clean, no-override state', async () => {
    const project = await createTestProject();
    const relPath = await agentOverride(
      { paths: project.paths, agentsRoot: AGENTS_ROOT },
      'architect',
      '$extends: architect\npersona:\n  voice: terser\n',
    );
    expect(relPath).toBe('.forge/overrides/agents/architect.agent.yaml');

    const removed = await agentReset(
      { paths: project.paths, agentsRoot: AGENTS_ROOT },
      'architect',
    );
    expect(removed).toBe(true);
    const removedAgain = await agentReset(
      { paths: project.paths, agentsRoot: AGENTS_ROOT },
      'architect',
    );
    expect(removedAgain).toBe(false);
  });
});
