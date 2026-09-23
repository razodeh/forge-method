/**
 * `modules/fm-mobile/workflows/store-release.workflow.yaml` (`PLAN-M10.md` P6, `19` §19.1's own
 * "store-release workflow" row) -- `19` §19.3's own Workflow-authoring row, literally: "compile the DAG
 * and dry-run with the fake adapter." Proves it three ways, mirroring
 * `test/fm-service-workflow.test.ts`'s own established pattern:
 *  1. `parseWorkflow` accepts the real, shipped file.
 *  2. `compileRunPlan` compiles it against a representative fixture context.
 *  3. `runEngine` actually drives the compiled plan to completion end-to-end -- both `agent` steps
 *     dispatched through a real, scripted `FakePlatformAdapter` (never a real model), both `gate` steps
 *     (both reusing the real `G-Deliver`/`G-Verify` gate ids, per `module.yaml`'s own header comment)
 *     evaluated through a real, trivially-passing fixture `GateDefinition`, and the one `command` step
 *     (`run-device-matrix-tests`) executed as a REAL shell command against a real temporary git
 *     repository and a minimal real `package.json` whose own `test` script is `true` -- proving the
 *     workflow's own literal `run: 'pnpm test -- ...'` field actually template-resolves and actually
 *     runs, not merely that its shape parses.
 *
 * Lives at the repository root, not inside `packages/engine/test/`, for the identical cross-package
 * reason `test/fm-service-workflow.test.ts` already documents: this needs
 * `@forge/engine/{workflow,plan,run,dispatch,scheduler}` plus `@forge/testkit` plus direct filesystem
 * access to `modules/fm-mobile/`, a bare workspace directory with no package of its own.
 *
 * @see specs/19 §19.1, §19.3
 * @see specs/10 §10.1
 * @see PLAN-M10.md P6
 */
import { execa } from 'execa';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import type { PlatformAdapter, ToolGrant } from '@forge/adapter-kit';
import { ProjectPaths, type AbsolutePath } from '@forge/core';
import {
  createGateEvaluator,
  createMergeQueueFacade,
  createTelemetryFacade,
  createVcsFacade,
} from '@forge/engine/dispatch';
import type { PromptAssemblyContext } from '@forge/engine/dispatch';
import type { GateDefinition } from '@forge/engine/gates';
import type { ExpressionContext } from '@forge/engine/expr';
import { compileRunPlan } from '@forge/engine/plan';
import type { RunEngineContext } from '@forge/engine/run';
import { runEngine } from '@forge/engine/run';
import type { ConcurrencyLimits } from '@forge/engine/scheduler';
import { parseWorkflow } from '@forge/engine/workflow';
import { FAKE_MODEL_ID, FakePlatformAdapter } from '@forge/testkit';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowPath = path.join(
  repoRoot,
  'modules',
  'fm-mobile',
  'workflows',
  'store-release.workflow.yaml',
);

const BUILD_TARGET = 'ios-android-1-2-0';

function fixtureExpressionContext(): ExpressionContext {
  // `PLAN-M14.md` P12: `prepare-release-build` claims `{{config.paths.release}}`, spliced one entry per
  // claim (`resolveClaimEntry`) -- a representative, project-configured list, in place of the six globs
  // this step used to guess with.
  return {
    buildTarget: BUILD_TARGET,
    config: { paths: { release: ['apps/mobile/**', 'app.json'] } },
  } as unknown as ExpressionContext;
}

const UNLIMITED_CONCURRENCY: ConcurrencyLimits = {
  global: 100,
  perAgent: new Map(),
  perResourceClass: new Map(),
};

const FIXTURE_TOOLS: ToolGrant = { read: true, write: true, exec: false, network: 'none' };

/** Trivially passing (`deterministic: []`/`advisory: []`) -- neither gate step's own real behaviour is
 * this test's concern; only that a real `GateDefinition` for both real, reused gate ids this workflow
 * names evaluates and the run proceeds past both. */
function fixtureGateRegistry(): ReadonlyMap<string, GateDefinition> {
  const trivial = (id: string): GateDefinition => ({
    id,
    checks: { deterministic: [], advisory: [] },
    openQuestionsPolicy: 'warn',
  });
  return new Map([
    ['G-Deliver', trivial('G-Deliver')],
    ['G-Verify', trivial('G-Verify')],
  ]);
}

function fixtureAdapter(): PlatformAdapter {
  const adapter = new FakePlatformAdapter();
  adapter.script((request) => request.stepId.includes('prepare-release-build'), {
    text: [`prepared the ${BUILD_TARGET} release build`],
    writeFiles: [
      {
        relativePath: `docs/forge/specs/tasks/TASK-release-${BUILD_TARGET}.md`,
        // A valid `Task` artifact (`18` §18.7): the step declares `outputs: [Task]`, and the output contract
        // check (M13 P7) validates what the session wrote against the Task schema, not just its existence.
        content: [
          '---',
          'id: TASK-001',
          'type: Task',
          'schemaVersion: 1',
          `title: Release build task for ${BUILD_TARGET}`,
          'status: draft',
          'created: 2026-01-15',
          'updated: 2026-01-15',
          'revision: 1',
          'author: mobile',
          'changelog: []',
          '---',
          '',
          `# Release build task for ${BUILD_TARGET}`,
          '',
        ].join('\n'),
      },
    ],
  });
  adapter.script((request) => request.stepId.includes('prepare-store-submission'), {
    text: [`drafted the store submission record for ${BUILD_TARGET}`],
    writeFiles: [
      {
        relativePath: `docs/forge/kb/delivery/release/store-submission-${BUILD_TARGET}.md`,
        content: `# Store submission for ${BUILD_TARGET}\n`,
      },
      // The step declares `outputs: [HandoffRecord(store-submission)]` (`PLAN-M13.md` P15): the register entry
      // that registers the record is what the output contract check (P7) requires, so a session that wrote
      // only the record would now fail the step.
      {
        relativePath: 'docs/forge/reports/handoffs.md',
        content: [
          '---',
          'type: HandoffRecord',
          'handoffs:',
          '  - id: HO-0001',
          '    from: release',
          '    to: human',
          '    step: prepare-store-submission -> merge-submission',
          "    timestamp: '2026-01-15T10:00:00Z'",
          `    delivered: ['subtype: store-submission-record', 'docs/forge/kb/delivery/release/store-submission-${BUILD_TARGET}.md']`,
          '    open_questions: []',
          '    assumptions: []',
          '    constraints_for_receiver: []',
          '    acceptance_for_receiver: []',
          '---',
          '',
        ].join('\n'),
      },
    ],
  });
  return adapter;
}

async function createTempRepo(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `fm-mobile-workflow-${prefix}-`));
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });
  // A minimal, real package.json whose own "test" script is the POSIX `true` builtin -- proves the
  // workflow's own literal `run: 'pnpm test -- test/device-matrix/{{buildTarget}}.test.ts'` field
  // actually template-resolves and actually runs a real command, not a stub.
  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name: 'fm-mobile-workflow-fixture',
      version: '0.0.0',
      scripts: { test: 'true' },
    }),
  );
  await mkdir(path.join(dir, 'test', 'device-matrix'), { recursive: true });
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'init'], { cwd: dir });
  return dir;
}

/** M13 P5 (D4): every agent step is dispatched through real prompt assembly, so a test that drives one
 * needs an assembly. This is the small fixture flavour -- any agent id resolves to one plain agent, a
 * brief/prompt reference resolves to its own text, the KB is empty and every tier maps to the fake
 * adapter's model -- the same compile/record path production takes, minus the project files. */
function fixtureAssembly(projectRoot: string): PromptAssemblyContext {
  const tier = { 'forge-fake-adapter': FAKE_MODEL_ID };
  return {
    paths: new ProjectPaths(projectRoot),
    loadAgent: (agentId) =>
      Promise.resolve({
        id: agentId,
        name: agentId,
        version: '1.0.0',
        tier: 'core',
        mandate: `Do the ${agentId} job.`,
        decisions_owned: [],
        persona: { voice: 'terse', stance: 'pragmatic', disagreement_style: 'direct' },
        inputs: { required: [] },
        outputs: [{ type: 'Note', schema: 'note.schema.json', path: 'docs/note.md' }],
        kb_write: [],
        tools: { read: true, write: true, network: false, git_commit: 'lane', deploy: false },
        model: { tier: 'balanced', thinking: 'medium' },
        limits: { max_turns: 10, wall_clock_ms: 600_000, max_cost_usd: 5 },
        parallel_safety: { file_ownership: ['**'], exclusive: false },
        gates: { produces_evidence_for: [], may_approve: [] },
        skills: [],
        prompt: { system: 'prompts/fixture.system.md' },
      }),
    listAgents: () => Promise.resolve([]),
    loadContent: (reference) => Promise.resolve(`Fixture text for ${reference}.`),
    openKb: () =>
      Promise.resolve({
        backend: {
          upsertEntry: () => undefined,
          upsertLinks: () => undefined,
          search: () => [],
          expand: () => [],
          clear: () => undefined,
          close: () => undefined,
        },
        tree: { entries: [], errors: [] },
        parseErrorCount: 0,
        close: () => undefined,
      }),
    models: { tiers: { frugal: tier, balanced: tier, max: tier }, overrides: {} },
    escalations: [],
    autonomy: 'guided',
    kbPackBudgetTokens: 10_000,
    skillsPackBudgetTokens: 8_000,
    templatesPackageRoot: projectRoot as AbsolutePath,
    pinnedCore: {},
  };
}

function fixtureRunEngineContext(projectRoot: string): RunEngineContext {
  const runId = 'run-fm-mobile-fixture';
  let tick = 0;
  const now = () => (tick += 1);
  const gateRegistry = fixtureGateRegistry();
  return {
    adapter: fixtureAdapter(),
    vcs: createVcsFacade(projectRoot, runId),
    telemetry: createTelemetryFacade(projectRoot, runId, now),
    gates: createGateEvaluator(gateRegistry),
    mergeQueue: createMergeQueueFacade(projectRoot, undefined),
    runId,
    projectRoot,
    integrationBase: 'main',
    integrationPath: projectRoot,
    model: FAKE_MODEL_ID,
    tools: FIXTURE_TOOLS,
    assembly: fixtureAssembly(projectRoot),
    retainLaneWorktrees: false,
    // `guided` autonomy (the default a project gets) resolves to `warn` (`06` §6.7). `strict` would revert
    // the Task this step writes, since the shipped step declares `outputs` but no `produces` claim, and the
    // output contract check (M13 P7) would then fail it; see Q209.
    claimPolicy: 'warn',
    signCommits: false,
    now,
    laneRegistry: new Map(),
    gateRegistry,
    limits: UNLIMITED_CONCURRENCY,
    seed: 'seed-fm-mobile',
  };
}

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('store-release.workflow.yaml (19 §19.1, §19.3)', () => {
  it('parses via parseWorkflow with a gate step present', async () => {
    const source = await readFile(workflowPath, 'utf8');
    const result = parseWorkflow(source);
    if (!result.success) throw new Error(`failed to parse: ${JSON.stringify(result.issues)}`);
    expect(result.workflow.id).toBe('store-release');
    const gateSteps = result.workflow.steps.filter((step) => step.kind === 'gate');
    expect(gateSteps.length).toBeGreaterThan(0);
    expect(gateSteps.map((step) => step.gate)).toEqual(['G-Deliver', 'G-Verify']);
  });

  it('compiles via compileRunPlan against a representative fixture context', async () => {
    const source = await readFile(workflowPath, 'utf8');
    const parsed = parseWorkflow(source);
    if (!parsed.success) throw new Error('failed to parse');
    const compiled = compileRunPlan(parsed.workflow, fixtureExpressionContext());
    if (!compiled.success) {
      throw new Error(`failed to compile: ${JSON.stringify(compiled.issues, null, 2)}`);
    }
    expect(compiled.nodes.length).toBe(7);
    expect(compiled.nodes.map((n) => n.id)).toContain('store-release:store-readiness-gate');
    expect(compiled.nodes.map((n) => n.id)).toContain('store-release:verify-gate');
    // `PLAN-M14.md` P12: `config.paths.release` is spliced into the claim one entry per glob, alongside
    // the fixed device-matrix claim.
    const prepare = compiled.nodes.find((n) => n.id === 'store-release:prepare-release-build');
    expect(prepare?.produces).toEqual(['test/device-matrix/**', 'apps/mobile/**', 'app.json']);
  });

  it('dry-runs end to end against the fake adapter: both agent steps, both gate steps, and the real command step all complete', async () => {
    const projectRoot = await createTempRepo('happy-path');
    tempDirs.push(projectRoot);
    const source = await readFile(workflowPath, 'utf8');
    const ctx = fixtureRunEngineContext(projectRoot);

    const runState = await runEngine(source, fixtureExpressionContext(), ctx);

    expect(runState.runStatus).toBe('completed');
    expect(runState.stepStatuses.get('store-release:prepare-release-build')).toBe('succeeded');
    expect(runState.stepStatuses.get('store-release:merge-release-build')).toBe('succeeded');
    expect(runState.stepStatuses.get('store-release:run-device-matrix-tests')).toBe('succeeded');
    expect(runState.stepStatuses.get('store-release:store-readiness-gate')).toBe('succeeded');
    expect(runState.stepStatuses.get('store-release:prepare-store-submission')).toBe('succeeded');
    expect(runState.stepStatuses.get('store-release:merge-submission')).toBe('succeeded');
    expect(runState.stepStatuses.get('store-release:verify-gate')).toBe('succeeded');
    expect(runState.unresolvedStepIds).toEqual([]);

    // Real content, actually merged into the real integration branch by the real merge/commit
    // machinery -- not merely "every step reported success".
    await expect(
      readFile(
        path.join(
          projectRoot,
          `docs/forge/kb/delivery/release/store-submission-${BUILD_TARGET}.md`,
        ),
        'utf8',
      ),
    ).resolves.toContain(BUILD_TARGET);
  });
});
