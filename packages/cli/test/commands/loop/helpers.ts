/**
 * Shared test setup for `@forge/cli/commands/loop` — a real temp git repository, real minimal fixture
 * workflows for `implement-story`/`debug`/`refactor`/`deliver-stage` (proving this module's own real
 * expressionContext-construction wiring, not re-proving `runWorkflow`/`runEngine` itself — already
 * proven in `packages/cli/test/commands/run/`), a real Story fixture, and real, schema-valid agent
 * definitions under `.forge/agents/` (`forge init`'s own real materialized-roster convention).
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
// Genuinely test-only, the identical exemption `packages/cli/test/commands/helpers.ts` already
// documents for its own `tmpdir` import.
// eslint-disable-next-line no-restricted-imports -- see comment above
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { FAKE_MODEL_ID, FakePlatformAdapter } from '@forge/testkit';
import type { PlatformAdapter } from '@forge/adapter-kit/types';
import { DEFAULT_CONFIG, type ForgeConfig } from '@forge/schemas/config';
import { ProjectPaths } from '@forge/core/fs';

import type { RunDeps } from '../../../src/commands/run/run.ts';

export const WORKFLOWS_ROOT = 'docs/forge/workflows';
export const CHECKS_ROOT = 'docs/forge/checks';
export const SPECS_ROOT = 'docs/forge/specs';
export const REPORTS_ROOT = 'docs/forge/reports';
export const AGENTS_ROOT = '.forge/agents';

export const FIXTURE_STORY_ID = 'STORY-014';
export const FIXTURE_OWNER_ROLE = 'engineer';

/** One real, minimal, single-`agent`-step workflow per command, templating exactly the keys that
 * command's own `expressionContext` supplies into fields `compileRunPlan` actually resolves at
 * compile time (`agent`/`produces`/`inputs`/`run` — confirmed directly against `compile.ts`'s own
 * `buildLeafNode`; `brief` is never template-resolved, so it is useless for proving a value was
 * threaded through correctly) — proves this module's own real expressionContext-construction wiring,
 * not a re-proof of `runWorkflow`/`runEngine` itself (already covered in
 * `packages/cli/test/commands/run/`). */
function fixtureWorkflow(id: string, agentTemplate: string, producesTemplate: string): string {
  return `
id: ${id}
name: Fixture ${id}
version: 1.0.0
description: A minimal fixture standing in for the real ${id} workflow.

steps:
  - id: only
    kind: agent
    agent: '${agentTemplate}'
    brief: fixture
    produces: [ "${producesTemplate}" ]
`;
}

export const IMPLEMENT_STORY_SOURCE = fixtureWorkflow(
  'implement-story',
  '{{ownerRole}}',
  '{{storyId}}.txt',
);
export const DEBUG_SOURCE = fixtureWorkflow('debug', 'engineer', '{{defectId}}.txt');
export const REFACTOR_SOURCE = fixtureWorkflow('refactor', 'engineer', '{{target}}-{{goal}}.txt');
export const DELIVER_STAGE_SOURCE = fixtureWorkflow('deliver-stage', 'engineer', '{{env}}.txt');

const FIXTURE_GATE_YAML = `id: G-Always
checks:
  deterministic: []
  advisory: []
openQuestionsPolicy: warn
`;

function agentYaml(id: string, name: string): string {
  return `id: ${id}
name: ${name}
version: 1.0.0
tier: core
mandate: Fixture mandate for ${id}.
decisions_owned: []
persona:
  voice: terse
  stance: pragmatic
  disagreement_style: direct
inputs:
  required: []
  optional: []
outputs:
  - type: X
    schema: x.schema.json
    path: x.md
kb_write: []
kb_propose: []
tools:
  read: true
  write: false
  exec: []
  network: false
  git_commit: none
  deploy: false
model:
  tier: balanced
  thinking: medium
limits:
  max_turns: 10
  wall_clock_ms: 600000
  max_cost_usd: 2.0
parallel_safety:
  file_ownership: []
  exclusive: false
gates:
  produces_evidence_for: []
  may_approve: []
skills: []
prompt:
  system: p.md
`;
}

export interface TestProject {
  readonly dir: string;
  readonly paths: ProjectPaths;
  readonly config: ForgeConfig;
}

const cleanupDirs: string[] = [];

export function registerCleanup(dir: string): void {
  cleanupDirs.push(dir);
}

export async function cleanupAll(): Promise<void> {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
}

export async function createTestProject(): Promise<TestProject> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-cli-loop-'));
  registerCleanup(dir);

  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 'fixture@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'Fixture'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });

  await mkdir(path.join(dir, WORKFLOWS_ROOT), { recursive: true });
  await writeFile(
    path.join(dir, WORKFLOWS_ROOT, 'implement-story.workflow.yaml'),
    IMPLEMENT_STORY_SOURCE,
  );
  await writeFile(path.join(dir, WORKFLOWS_ROOT, 'debug.workflow.yaml'), DEBUG_SOURCE);
  await writeFile(path.join(dir, WORKFLOWS_ROOT, 'refactor.workflow.yaml'), REFACTOR_SOURCE);
  await writeFile(
    path.join(dir, WORKFLOWS_ROOT, 'deliver-stage.workflow.yaml'),
    DELIVER_STAGE_SOURCE,
  );

  await mkdir(path.join(dir, CHECKS_ROOT), { recursive: true });
  await writeFile(path.join(dir, CHECKS_ROOT, 'G-Always.gate.yaml'), FIXTURE_GATE_YAML);

  await mkdir(path.join(dir, SPECS_ROOT, 'stories'), { recursive: true });
  await writeFile(
    path.join(dir, SPECS_ROOT, 'stories', `${FIXTURE_STORY_ID}.md`),
    storyFixture(FIXTURE_STORY_ID, FIXTURE_OWNER_ROLE),
  );

  await mkdir(path.join(dir, AGENTS_ROOT), { recursive: true });
  await writeFile(
    path.join(dir, AGENTS_ROOT, 'reviewer.yaml'),
    agentYaml('reviewer', 'Code Reviewer'),
  );
  await writeFile(
    path.join(dir, AGENTS_ROOT, 'architect.yaml'),
    agentYaml('architect', 'Architect'),
  );
  await writeFile(path.join(dir, AGENTS_ROOT, 'security.yaml'), agentYaml('security', 'Security'));

  const config: ForgeConfig = {
    ...DEFAULT_CONFIG,
    execution: { ...DEFAULT_CONFIG.execution, retainLaneWorktrees: 'always' },
  };

  return { dir, paths: new ProjectPaths(dir), config };
}

function storyFixture(id: string, ownerRole: string): string {
  return `---
id: ${id}
type: Story
schemaVersion: 1
title: Fixture story
status: ready
created: 2026-01-01
updated: 2026-01-01
revision: 1
author: architect
changelog: []
epic: EPIC-001
capability: CAP-001
storyType: feature
size: M
owner_role: ${ownerRole}
depends_on: []
blocked_by: []
interfaces: []
data: []
files_expected: []
context_refs: []
acceptance: []
tests: []
dod_profile: default
---

Fixture story body.
`;
}

/** `relativePath` must match the fixture workflow's own resolved `produces` glob exactly — `06`
 * §6.7's real claim enforcement (`ctx.claimPolicy: 'strict'`, `buildRunEngineContext`'s own default)
 * fails a step whose lane changed a file outside its own declared claim, so a fixture adapter that
 * always wrote the identical filename regardless of what each command's own resolved `produces`
 * actually named would fail every real (non-dry-run) test but `implement.test.ts`'s own default. */
export function fixtureAdapter(relativePath = 'out.txt'): PlatformAdapter {
  const adapter = new FakePlatformAdapter();
  adapter.script(() => true, {
    text: ['done'],
    writeFiles: [{ relativePath, content: 'done\n' }],
  });
  return adapter;
}

export function testRunDeps(
  project: TestProject,
  adapter: PlatformAdapter = fixtureAdapter(),
): RunDeps {
  return {
    paths: project.paths,
    projectRoot: project.dir,
    config: project.config,
    adapter,
    workflowsRoot: WORKFLOWS_ROOT,
    checksRoot: CHECKS_ROOT,
  };
}

export { FAKE_MODEL_ID };
