/**
 * `forge doctor`'s `workflow-claims` check — a `warning`, project-facing twin of `forge workflow
 * validate --all`'s `write-without-claim` error (`06` §6.7, `SPEC-QUESTIONS.md` Q225/Q232 decision 6,
 * `PLAN-M14.md` P7): a write-capable agent step with an empty claim gets no write grant at all
 * (`PLAN-M13.md` P36) and silently does nothing. `forge doctor` reports it, but never fails the
 * project's build over it — only a `hard` check flips `DoctorReport.ok`.
 *
 * @see specs/06 §6.7
 * @see PLAN-M14.md P7
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runDoctor } from '../../../src/commands/doctor/run-doctor.ts';
import { agentYaml } from '../loop/helpers.ts';
import { cleanupAll, createTestProject, type TestProject } from './helpers.ts';

afterEach(cleanupAll);

const WORKFLOW_YAML = (agent: string, produces?: string): string =>
  `id: fixture\nname: fixture\nversion: 1.0.0\ndescription: fixture\nsteps:\n  - id: only\n    kind: agent\n    agent: ${agent}\n    brief: briefs/fixture.md\n${
    produces === undefined ? '' : `    produces: ['${produces}']\n`
  }`;

async function writeWorkflow(project: TestProject, content: string): Promise<void> {
  await mkdir(path.join(project.dir, '.forge/workflows'), { recursive: true });
  await writeFile(path.join(project.dir, '.forge/workflows/fixture.workflow.yaml'), content);
}

async function writeAgent(project: TestProject, id: string, write: boolean): Promise<void> {
  await mkdir(path.join(project.dir, '.forge/agents'), { recursive: true });
  await writeFile(
    path.join(project.dir, `.forge/agents/${id}.yaml`),
    agentYaml(id, id, { write, code: write }),
  );
}

async function workflowClaimsCheck(project: TestProject) {
  const report = await runDoctor({
    paths: project.paths,
    projectRoot: project.dir,
    config: project.config,
    env: {},
    processVersion: process.version,
  });
  return { check: report.checks.find((c) => c.id === 'workflow-claims'), report };
}

describe('doctor workflow-claims', () => {
  it('passes cleanly when .forge/workflows does not exist at all', async () => {
    const project = await createTestProject();
    const { check } = await workflowClaimsCheck(project);
    expect(check?.ok).toBe(true);
    expect(check?.severity).toBe('warning');
  });

  it('warns, names the offending workflow:step and a fix mentioning forge upgrade and produces:/outputs:, without failing the overall report', async () => {
    const project = await createTestProject();
    await writeAgent(project, 'backend', true);
    await writeWorkflow(project, WORKFLOW_YAML('backend'));

    const { check, report } = await workflowClaimsCheck(project);

    expect(check?.ok).toBe(false);
    expect(check?.severity).toBe('warning');
    expect(check?.message).toContain('fixture:only');
    expect(check?.fix).toContain('forge upgrade');
    expect(check?.fix).toMatch(/produces:.*outputs:|outputs:.*produces:/);
    // A `warning`-severity check never flips the overall report: `03` §3.7's own exit-code contract
    // reads `ok` off `hard` failures only.
    expect(report.ok).toBe(true);
  });

  it('passes once the step carries a real produces claim', async () => {
    const project = await createTestProject();
    await writeAgent(project, 'backend', true);
    await writeWorkflow(project, WORKFLOW_YAML('backend', 'src/**'));

    const { check } = await workflowClaimsCheck(project);

    expect(check?.ok).toBe(true);
  });

  it('does not warn for an agent whose grant has no write', async () => {
    const project = await createTestProject();
    await writeAgent(project, 'reviewer', false);
    await writeWorkflow(project, WORKFLOW_YAML('reviewer'));

    const { check } = await workflowClaimsCheck(project);

    expect(check?.ok).toBe(true);
  });

  it('never crashes the doctor run over a corrupt sibling agent file -- "not a writer, not judged"', async () => {
    const project = await createTestProject();
    await writeAgent(project, 'backend', true);
    await mkdir(path.join(project.dir, '.forge/agents'), { recursive: true });
    await writeFile(path.join(project.dir, '.forge/agents/broken.yaml'), 'id: [unterminated');
    await writeWorkflow(project, WORKFLOW_YAML('broken'));

    const { check } = await workflowClaimsCheck(project);

    // `broken` cannot be judged a writer, so its own empty-claim step is not reported either --
    // consistent with a step whose agent is genuinely unknown.
    expect(check?.ok).toBe(true);
    expect(check?.severity).toBe('warning');
  });

  it('reports a real, unparseable .forge/workflows/*.yaml as a warning, never a hard failure that flips the overall report', async () => {
    // A fresh critic round: `workflowValidateAll` throws `CFG-001` for a workflow file it cannot even
    // parse (`readWorkflow`); left uncaught, that crash would reach `runChecks`'s generic
    // crash-to-`hard` fallback and flip `DoctorReport.ok` over an ordinary hand-edited YAML typo --
    // exactly the population this `warning`-only check exists for.
    const project = await createTestProject();
    await mkdir(path.join(project.dir, '.forge/workflows'), { recursive: true });
    await writeFile(
      path.join(project.dir, '.forge/workflows/broken.workflow.yaml'),
      'id: [unterminated',
    );

    const { check, report } = await workflowClaimsCheck(project);

    expect(check?.ok).toBe(false);
    expect(check?.severity).toBe('warning');
    expect(report.ok).toBe(true);
  });
});
