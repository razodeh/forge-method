/**
 * `modules/fm-service/workflows/contract-test-cycle.workflow.yaml` (`PLAN-M10.md` P4, `19` §19.1's own
 * "contract-testing workflow" row) -- `19` §19.3's own Workflow-authoring row, literally: "compile the
 * DAG and dry-run with the fake adapter." Proves it three ways:
 *  1. `parseWorkflow` accepts the real, shipped file.
 *  2. `compileRunPlan` compiles it against a representative fixture context (the `test/workflows.test.ts`
 *     precedent: a real, non-empty value for every templated field the workflow references).
 *  3. `runEngine` actually drives the compiled plan to completion end-to-end -- the two `agent` steps
 *     dispatched through a real, scripted `FakePlatformAdapter` (never a real model), the two `gate`
 *     steps evaluated through a real, trivially-passing fixture `GateDefinition` for `G-Integration`/
 *     `G-Verify`, and the one `command` step (`run-contract-tests`) executed as a REAL shell command
 *     against a real temporary git repository and a minimal real `package.json` whose own `test` script
 *     is `true` -- proving the workflow's own literal `run: 'pnpm test -- ...'` field actually
 *     template-resolves and actually runs, not merely that its shape parses.
 *
 * Lives at the repository root, not inside `packages/engine/test/`, for the identical cross-package
 * reason `test/workflows.test.ts` already documents: this needs `@forge/engine/{workflow,plan,run,
 * dispatch,scheduler}` plus `@forge/testkit` plus direct filesystem access to `modules/fm-service/`, a
 * bare workspace directory with no package of its own.
 *
 * @see specs/19 §19.1, §19.3
 * @see specs/10 §10.1
 * @see PLAN-M10.md P4
 */
import { execa } from 'execa';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import type { AdapterCapabilities, PlatformAdapter, ToolGrant } from '@forge/adapter-kit';
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
  'fm-service',
  'workflows',
  'contract-test-cycle.workflow.yaml',
);

const INTERFACE_NAME = 'orders-api';

function fixtureExpressionContext(): ExpressionContext {
  // Bare workflow-level `inputs` field, resolved from the context root -- the identical convention
  // `test/workflows.test.ts`'s own shared `FIXTURE_CONTEXT` already establishes for `stageId`/`storyId`.
  return { interfaceName: INTERFACE_NAME } as unknown as ExpressionContext;
}

const UNLIMITED_CONCURRENCY: ConcurrencyLimits = {
  global: 100,
  perAgent: new Map(),
  perResourceClass: new Map(),
};

const FIXTURE_TOOLS: ToolGrant = { read: true, write: true, exec: false, network: 'none' };

/** Trivially passing (`deterministic: []`/`advisory: []`) -- neither gate step's own real behaviour is
 * this test's concern; only that a real `GateDefinition` for both real gate ids this workflow names
 * evaluates and the run proceeds past both. */
function fixtureGateRegistry(): ReadonlyMap<string, GateDefinition> {
  const trivial = (id: string): GateDefinition => ({
    id,
    checks: { deterministic: [], advisory: [] },
    openQuestionsPolicy: 'warn',
  });
  return new Map([
    ['G-Integration', trivial('G-Integration')],
    ['G-Verify', trivial('G-Verify')],
  ]);
}

function fixtureAdapter(capabilityOverrides: Partial<AdapterCapabilities> = {}): PlatformAdapter {
  const adapter = new FakePlatformAdapter(capabilityOverrides);
  adapter.script((request) => request.stepId.includes('draft-contract'), {
    text: ['drafted the orders-api interface contract'],
    writeFiles: [
      {
        relativePath: `docs/forge/specs/interfaces/${INTERFACE_NAME}.yaml`,
        // A valid `InterfaceContract` file (`18` §18.7): the step declares `outputs: [InterfaceContract]`,
        // and the output contract check (M13 P7) validates its front matter keys, not just its existence.
        content: [
          'id: INT-001',
          'type: InterfaceContract',
          'schemaVersion: 1',
          `title: ${INTERFACE_NAME}`,
          'status: draft',
          'created: 2026-01-15',
          'updated: 2026-01-15',
          'revision: 1',
          'author: integration-architect',
          'changelog: []',
          'openapi: 3.1.0',
          '',
        ].join('\n'),
      },
    ],
  });
  adapter.script((request) => request.stepId.includes('generate-contract-tests'), {
    text: [`wrote a contract test for ${INTERFACE_NAME}`],
    writeFiles: [
      {
        relativePath: `test/contract/${INTERFACE_NAME}.contract.test.ts`,
        content: `// contract test for ${INTERFACE_NAME}\n`,
      },
    ],
  });
  return adapter;
}

async function createTempRepo(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `fm-service-workflow-${prefix}-`));
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });
  // A minimal, real package.json whose own "test" script is the POSIX `true` builtin -- proves the
  // workflow's own literal `run: 'pnpm test -- test/contract/{{interfaceName}}.contract.test.ts'`
  // field actually template-resolves and actually runs a real command (pnpm forwards the `--`
  // arguments to the script unchanged; `true` ignores every argument and exits 0), not a stub.
  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name: 'fm-service-workflow-fixture',
      version: '0.0.0',
      scripts: { test: 'true' },
    }),
  );
  await mkdir(path.join(dir, 'test', 'contract'), { recursive: true });
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
  const runId = 'run-fm-service-fixture';
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
    // the contract this step writes, since the shipped step declares `outputs` but no `produces` claim, and
    // the output contract check (M13 P7) would then fail it; see Q209.
    claimPolicy: 'warn',
    signCommits: false,
    now,
    laneRegistry: new Map(),
    gateRegistry,
    limits: UNLIMITED_CONCURRENCY,
    seed: 'seed-fm-service',
  };
}

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('contract-test-cycle.workflow.yaml (19 §19.1, §19.3)', () => {
  it('parses via parseWorkflow with a gate step present', async () => {
    const source = await readFile(workflowPath, 'utf8');
    const result = parseWorkflow(source);
    if (!result.success) throw new Error(`failed to parse: ${JSON.stringify(result.issues)}`);
    expect(result.workflow.id).toBe('contract-test-cycle');
    const gateSteps = result.workflow.steps.filter((step) => step.kind === 'gate');
    expect(gateSteps.length).toBeGreaterThan(0);
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
    expect(compiled.nodes.map((n) => n.id)).toContain('contract-test-cycle:contract-gate');
    expect(compiled.nodes.map((n) => n.id)).toContain('contract-test-cycle:verify-gate');
  });

  it('dry-runs end to end against the fake adapter: both agent steps, both gate steps, and the real command step all complete', async () => {
    const projectRoot = await createTempRepo('happy-path');
    tempDirs.push(projectRoot);
    const source = await readFile(workflowPath, 'utf8');
    const ctx = fixtureRunEngineContext(projectRoot);

    const runState = await runEngine(source, fixtureExpressionContext(), ctx);

    expect(runState.runStatus).toBe('completed');
    expect(runState.stepStatuses.get('contract-test-cycle:draft-contract')).toBe('succeeded');
    expect(runState.stepStatuses.get('contract-test-cycle:merge-contract')).toBe('succeeded');
    expect(runState.stepStatuses.get('contract-test-cycle:contract-gate')).toBe('succeeded');
    expect(runState.stepStatuses.get('contract-test-cycle:generate-contract-tests')).toBe(
      'succeeded',
    );
    expect(runState.stepStatuses.get('contract-test-cycle:merge-tests')).toBe('succeeded');
    expect(runState.stepStatuses.get('contract-test-cycle:run-contract-tests')).toBe('succeeded');
    expect(runState.stepStatuses.get('contract-test-cycle:verify-gate')).toBe('succeeded');
    expect(runState.unresolvedStepIds).toEqual([]);

    // Real content, actually merged into the real integration branch by the real merge/commit
    // machinery -- not merely "every step reported success".
    await expect(
      readFile(path.join(projectRoot, `test/contract/${INTERFACE_NAME}.contract.test.ts`), 'utf8'),
    ).resolves.toContain(INTERFACE_NAME);
  });
});
