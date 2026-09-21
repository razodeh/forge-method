/**
 * Shared test setup for `@forge/cli/commands/run` — a real temp git repository, a real `ProjectPaths`,
 * a real minimal workflow fixture (one `command` step, one `agent` step, one `gate` step — every step
 * kind this milestone's own `@forge/engine` actually handles, the same fixture shape
 * `packages/engine/test/e2e/fixture-workflow.ts` already establishes, reproduced here rather than
 * imported since it lives in another package's own `test/` tree), and a real, schema-valid
 * `.gate.yaml` file `loadGateRegistry` can parse.
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
import type { ExpressionContext } from '@forge/engine/expr';
import { DEFAULT_CONFIG, type ForgeConfig } from '@forge/schemas/config';

import { ProjectPaths } from '@forge/core/fs';

import type { RunDeps } from '../../../src/commands/run/run.ts';
import { FIXTURE_MODELS, writeFixtureAgent } from '../loop/helpers.ts';

export const WORKFLOWS_ROOT = 'docs/forge/workflows';
export const CHECKS_ROOT = 'docs/forge/checks';
export const AGENTS_ROOT = '.forge/agents';
export const FIXTURE_WORKFLOW_ID = 'cli-fixture';
export const FIXTURE_GATE_ID = 'G-Always';
export const FIXTURE_ITEM_ID = 'story-1';

/** `compileRunPlan` (`@forge/engine/plan`) namespaces every compiled `StepNode.id` as
 * `<workflowId>:<stepId>` — real, compiled ids, not the bare YAML `id:` fields tests might otherwise
 * assume. */
export const FIXTURE_STEP_PREPARE_ID = `${FIXTURE_WORKFLOW_ID}:prepare`;
export const FIXTURE_STEP_IMPLEMENT_ID = `${FIXTURE_WORKFLOW_ID}:implement`;
export const FIXTURE_STEP_VERIFY_ID = `${FIXTURE_WORKFLOW_ID}:verify`;

/** One `command`, one `agent` (no fanout — a single lane keeps the CLI's own real-facade tests fast and
 * their lane id deterministic), and one `gate` — every step kind `@forge/engine` (M5) handles, deliberately
 * omitting `merge` (see `FIXTURE_WORKFLOW_WITH_MERGE_SOURCE` below): a workflow with no `merge` step is
 * what leaves a real lane in `'ready'` status, worktree and branch intact, for `merge.ts`'s own tests to
 * drive directly.
 *
 * `prepare`'s own `run` is a template parameter (`"true"` by default, real `sleep N` for
 * `resume.test.ts`'s own real crash-then-resume case) — a real, non-instant command step gives a spawned
 * child process running this workflow a genuine wall-clock window to be `SIGKILL`'d mid-run, after its
 * own `StepStarted` event has already durably landed but before it can finish, without needing the
 * per-event stdout hook `@forge/engine`'s own E3 capstone test uses (that level of precision is already
 * proven at the engine layer; this only needs to prove the CLI's own lock/manifest/resume wiring). */
function fixtureWorkflowSource(prepareRun: string): string {
  return `
id: ${FIXTURE_WORKFLOW_ID}
name: CLI fixture
version: 1.0.0
description: Exercises forge run/resume against every real M5 step kind but merge.

steps:
  - id: prepare
    kind: command
    run: "${prepareRun}"
    inline: true

  - id: implement
    kind: agent
    agent: engineer
    brief: briefs/implement.md
    produces: [ "${FIXTURE_ITEM_ID}.txt" ]
    dependsOn: [ prepare ]

  - id: verify
    kind: gate
    gate: ${FIXTURE_GATE_ID}
    dependsOn: [ implement ]
`;
}

export const FIXTURE_WORKFLOW_SOURCE = fixtureWorkflowSource('true');
/** `resume.test.ts`'s own slow variant — real wall-clock delay, not simulated. */
export const FIXTURE_WORKFLOW_SLOW_SOURCE = fixtureWorkflowSource('sleep 0.4');

/** The identical fixture plus a real `merge` step, dependent on `implement` — for tests that need
 * `forge run` itself to drive a lane all the way through a real merge (`run.test.ts`'s own "a full real
 * run merges cleanly" case), as opposed to `merge.test.ts`'s own tests, which drive `mergeLane` by hand
 * against a lane a merge-less run left `'ready'`. */
export const FIXTURE_WORKFLOW_WITH_MERGE_SOURCE = `${FIXTURE_WORKFLOW_SOURCE.trimEnd()}

  - id: merge
    kind: merge
    over: "implement"
    dependsOn: [ implement ]
    policy: { conflict: abort }
`;

export type FixtureVariant = 'default' | 'slow' | 'merge';

function workflowSourceFor(variant: FixtureVariant): string {
  switch (variant) {
    case 'slow':
      return FIXTURE_WORKFLOW_SLOW_SOURCE;
    case 'merge':
      return FIXTURE_WORKFLOW_WITH_MERGE_SOURCE;
    case 'default':
      return FIXTURE_WORKFLOW_SOURCE;
  }
}

export function fixtureExpressionContext(): ExpressionContext {
  return {};
}

const FIXTURE_GATE_YAML = `id: ${FIXTURE_GATE_ID}
name: Always-passing fixture gate
phase: verify
checks:
  deterministic: []
  advisory: []
openQuestionsPolicy: warn
`;

/** A fresh, deterministic `FakePlatformAdapter`, scripted for the one real fanout-free `implement` step
 * the fixture workflow declares — matched on `request.stepId`, mirroring `fixtureAdapter` in
 * `packages/engine/test/e2e/fixture-workflow.ts` (`StepNode.brief` is never template-resolved by
 * `compileStep`, confirmed directly against that file's own doc comment, so matching on `stepId` is the
 * only real per-instance signal available). */
export function fixtureAdapter(): PlatformAdapter {
  const adapter = new FakePlatformAdapter();
  adapter.script((request) => request.stepId.includes('implement'), {
    text: [`implemented ${FIXTURE_ITEM_ID}`],
    writeFiles: [{ relativePath: `${FIXTURE_ITEM_ID}.txt`, content: `${FIXTURE_ITEM_ID}\n` }],
  });
  return adapter;
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

/** A real git repository (`git init` + one empty commit on `main`, matching
 * `packages/engine/test/e2e/crash-resume.test.ts`'s own `createTempRepo`) with a real workflow fixture
 * and a real gate fixture already written to disk — everything `buildRunEngineContext` needs to build a
 * genuine `RunEngineContext` against, not a mock. */
export async function createTestProject(
  options: { readonly variant?: FixtureVariant } = {},
): Promise<TestProject> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-cli-run-'));
  registerCleanup(dir);

  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 'fixture@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'Fixture'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });

  await mkdir(path.join(dir, WORKFLOWS_ROOT), { recursive: true });
  await writeFile(
    path.join(dir, WORKFLOWS_ROOT, `${FIXTURE_WORKFLOW_ID}.workflow.yaml`),
    workflowSourceFor(options.variant ?? 'default'),
  );

  await mkdir(path.join(dir, CHECKS_ROOT), { recursive: true });
  await writeFile(path.join(dir, CHECKS_ROOT, `${FIXTURE_GATE_ID}.gate.yaml`), FIXTURE_GATE_YAML);

  // Real agent, role prompt and brief for the one `agent` step: prompt assembly loads all three (a step
  // naming one that does not exist is a typed failure, never a raw-path prompt -- `PLAN-M13.md` P5).
  // Implementation roles (they declare a `Code` output): a Story's `owner_role` must be one (`PLAN-M13.md` P36), and
  // the tests that build a run context name `backend` and `frontend` as owners.
  await writeFixtureAgent(dir, 'engineer', 'Engineer', { write: true, code: true });
  await writeFixtureAgent(dir, 'backend', 'Backend', { write: true, code: true });
  await writeFixtureAgent(dir, 'frontend', 'Frontend', { write: true, code: true });
  await mkdir(path.join(dir, '.forge', 'briefs'), { recursive: true });
  await writeFile(
    path.join(dir, '.forge', 'briefs', 'implement.md'),
    `Implement ${FIXTURE_ITEM_ID}: write ${FIXTURE_ITEM_ID}.txt.\n`,
  );

  // `20` §20.10 S8 (`PLAN-M11.md` P11): `runWorkflow` now genuinely refuses to start against a dirty
  // working tree (`assertCleanWorkingTree`, wired in for the first time) -- a real project commits its
  // own workflow/gate fixtures rather than leaving them perpetually uncommitted, so this fixture project
  // does too, matching what every other real caller of `runWorkflow` needs to be true regardless.
  // `.forge/state/` specifically must be gitignored, exactly as `forge init`'s own real `write-tree.ts`
  // already writes for every real project (`IGNORED_PATHS`) -- omitted, `acquireRunLock`'s own real
  // lock file under `.forge/state/` would itself make an otherwise-clean tree look dirty, a false
  // positive this fixture's own missing setup would produce, not a real product defect.
  await writeFile(path.join(dir, '.gitignore'), '.forge/state/\n');
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'fixture workflow + gate'], { cwd: dir });

  const config: ForgeConfig = {
    ...DEFAULT_CONFIG,
    execution: { ...DEFAULT_CONFIG.execution, retainLaneWorktrees: 'always' },
    models: FIXTURE_MODELS,
  };

  return { dir, paths: new ProjectPaths(dir), config };
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
    agentsRoot: AGENTS_ROOT,
  };
}

export { FAKE_MODEL_ID };
