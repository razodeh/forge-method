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
import {
  createGateEvaluator,
  createMergeQueueFacade,
  createTelemetryFacade,
  createVcsFacade,
} from '@forge/engine/dispatch';
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
  return { buildTarget: BUILD_TARGET } as unknown as ExpressionContext;
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
        content: `# Release build task for ${BUILD_TARGET}\n`,
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
    retainLaneWorktrees: false,
    claimPolicy: 'strict',
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
