/**
 * `forge doctor`'s `spec-graph` check reports what `forge spec validate` reports (`PLAN-M13.md` P36): a Story whose
 * `owner_role` is not an implementation role of the project's roster is an invalid document, so the doctor cannot call the
 * project's spec graph valid while `spec validate` fails it.
 *
 * @see specs/09 §9.3
 * @see PLAN-M13.md P36
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import * as YAML from 'yaml';

import { runDoctor } from '../../../src/commands/doctor/run-doctor.ts';
import { agentYaml } from '../loop/helpers.ts';
import { SPECS_ROOT, cleanupAll, createTestProject, type TestProject } from './helpers.ts';

afterEach(cleanupAll);

async function projectOwnedBy(owner: string): Promise<TestProject> {
  const project = await createTestProject();
  await mkdir(path.join(project.dir, '.forge/agents'), { recursive: true });
  await writeFile(
    path.join(project.dir, '.forge/agents/backend.yaml'),
    agentYaml('backend', 'Backend', { write: true, code: true }),
  );
  await writeFile(
    path.join(project.dir, '.forge/agents/pm.yaml'),
    agentYaml('pm', 'Product Manager', { write: true }),
  );
  const front = {
    id: 'STORY-001',
    type: 'Story',
    schemaVersion: 1,
    title: 'A story',
    status: 'draft',
    created: '2026-01-01',
    updated: '2026-01-01',
    revision: 1,
    author: 'po',
    changelog: [],
    epic: 'EPIC-001',
    capability: 'CAP-001',
    storyType: 'feature',
    size: 'S',
    owner_role: owner,
    depends_on: [],
    blocked_by: [],
    interfaces: [],
    data: [],
    files_expected: ['src/a/**'],
    context_refs: [],
    acceptance: [],
    tests: [],
    dod_profile: 'backend-default',
  };
  await mkdir(path.join(project.dir, SPECS_ROOT, 'stories'), { recursive: true });
  await writeFile(
    path.join(project.dir, SPECS_ROOT, 'stories/STORY-001.md'),
    `---\n${YAML.stringify(front)}---\n\nBody.\n`,
  );
  return project;
}

async function specGraph(project: TestProject) {
  const report = await runDoctor({
    paths: project.paths,
    projectRoot: project.dir,
    config: project.config,
    env: {},
    processVersion: process.version,
  });
  return report.checks.find((check) => check.id === 'spec-graph');
}

describe('doctor spec-graph and a Story owner', () => {
  it('counts a Story owned by a document-authoring role as an invalid document', async () => {
    const bad = await specGraph(await projectOwnedBy('pm'));
    expect(bad?.message).toMatch(/1 invalid document/);
    const good = await specGraph(await projectOwnedBy('backend'));
    expect(good?.message).toMatch(/0 invalid document/);
  });
});
