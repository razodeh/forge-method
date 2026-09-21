/**
 * The shipped `build-stage` merge lands the lanes of the work it merges (`PLAN-M13.md` P19, `06` §6.4-§6.5,
 * `10` §10.1, `SPEC-QUESTIONS.md` Q211 open item 2 and Q221).
 *
 * `build-stage`'s one `merge` depends on the per-story `review` steps. Before P19, `runMergeStep` merged the
 * lanes of its DIRECT predecessors, so only the review lanes (a `REVIEW-NNN.md` each) reached the integration
 * branch and the code the reviews approved never did. These tests drive the compiled shipped workflow's real
 * nodes through the real dispatcher (`executeStep`: real lanes, real merge queue, real output contract check,
 * the engine-written swarm-review report) over a real git repository laid out the way `forge run` lays one out,
 * and assert what is on the integration branch afterwards. Only the model sessions are faked.
 *
 * The run is driven node by node rather than through `runEngine` because the shipped workflow ends in a
 * `subworkflow` step (`deliver`) that the engine still refuses (`RUN-039`); the stages this exercises
 * (`generate-tests`, `implement`, `review`, `merge`) are the ones whose lanes are at issue.
 *
 * Lives at the repository root for the same reason `test/build-stage-compiles.test.ts` does: it needs both
 * `@forge/engine` and `@forge/templates`.
 *
 * @see specs/06 §6.4, §6.5
 * @see specs/10 §10.1
 * @see PLAN-M13.md P19
 */
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { execa } from 'execa';
import { afterAll, describe, expect, it } from 'vitest';

import type { PlatformAdapter, ToolGrant } from '@forge/adapter-kit';
import { ProjectPaths, type AbsolutePath } from '@forge/core';
import {
  createGateEvaluator,
  createMergeQueueFacade,
  createTelemetryFacade,
  createVcsFacade,
  executeStep,
  type ExecuteStepContext,
  type LaneHandle,
  type PromptAssemblyContext,
} from '@forge/engine/dispatch';
import {
  buildStageRunContext,
  compileStageRunPlan,
  stepsLandedByMerges,
  type StageStory,
  type StepNode,
} from '@forge/engine/plan';
import { runEngine, type RunEngineContext } from '@forge/engine/run';
import { parseWorkflow } from '@forge/engine/workflow';
import type { GateDefinition } from '@forge/engine/gates';
import { WORKFLOW_INDEX } from '@forge/templates';
import { FAKE_MODEL_ID, FakePlatformAdapter } from '@forge/testkit';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INTEGRATION_BRANCH = 'forge/integration/current';
const TOOLS: ToolGrant = { read: true, write: true, exec: false, network: 'none' };
const P = 'build-stage:';

function shippedBuildStage() {
  const source = readFileSync(
    path.join(repoRoot, 'packages', 'templates', WORKFLOW_INDEX['build-stage']),
    'utf8',
  );
  const parsed = parseWorkflow(source);
  if (!parsed.success)
    throw new Error(`build-stage does not parse: ${JSON.stringify(parsed.issues)}`);
  return parsed.workflow;
}

function story(id: string, dependsOn: readonly string[], files: readonly string[]): StageStory {
  return {
    id,
    ownerRole: 'backend',
    dependsOn,
    blockedBy: [],
    filesExpected: files,
    testPaths: files.filter((file) => file.startsWith('tests/')),
  };
}

type AgentDefinition = Awaited<ReturnType<PromptAssemblyContext['loadAgent']>>;

function agentDefinition(id: string, write: boolean): AgentDefinition {
  return {
    id,
    name: id,
    version: '1.0.0',
    tier: 'core',
    mandate: `Do the ${id} job.`,
    decisions_owned: [],
    persona: { voice: 'terse', stance: 'pragmatic', disagreement_style: 'direct' },
    inputs: { required: [] },
    outputs: [{ type: 'Note', schema: 'note.schema.json', path: 'docs/note.md' }],
    kb_write: [],
    tools: { read: true, write, network: false, git_commit: 'lane', deploy: false },
    model: { tier: 'balanced', thinking: 'medium' },
    limits: { max_turns: 10, wall_clock_ms: 600_000, max_cost_usd: 5 },
    parallel_safety: { file_ownership: ['**'], exclusive: false },
    gates: { produces_evidence_for: [], may_approve: [] },
    skills: [],
    prompt: { system: 'prompts/fixture.system.md' },
  };
}

/** Every agent is a plain fixture agent; the reviewer is read-only, as shipped. */
function assemblyFor(projectRoot: string): PromptAssemblyContext {
  const tier = { 'forge-fake-adapter': FAKE_MODEL_ID };
  return {
    paths: new ProjectPaths(projectRoot),
    loadAgent: (agentId) => Promise.resolve(agentDefinition(agentId, agentId !== 'reviewer')),
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

const CLEAN = { findings: [], checked: ['read the diff'] };

function adapterFor(
  stories: readonly StageStory[],
  onRequest?: (request: { readonly stepId: string; readonly cwd: string }) => void,
): FakePlatformAdapter {
  const adapter = new FakePlatformAdapter();
  // Registered first and never matching, so it sees every request.
  if (onRequest !== undefined) {
    adapter.script((request) => {
      onRequest(request);
      return false;
    }, {});
  }
  for (const item of stories) {
    const dir = item.id.toLowerCase();
    adapter.script((request) => request.stepId === `${P}generate-tests:${item.id}`, {
      text: [`red tests for ${item.id}`],
      writeFiles: [{ relativePath: `tests/${dir}/${dir}.test.ts`, content: `// ${item.id}\n` }],
    });
    adapter.script((request) => request.stepId === `${P}implement:${item.id}`, {
      text: [`implemented ${item.id}`],
      writeFiles: [
        {
          relativePath: `src/${dir}/${dir}.ts`,
          content: `export const ${dir.replace('-', '_')} = 1;\n`,
        },
      ],
    });
  }
  // Every swarm-review perspective session returns a clean structured review.
  adapter.script((request) => /^build-stage:review:.+:review:[a-z]+$/.test(request.stepId), {
    text: ['reviewed'],
    structured: CLEAN,
  });
  return adapter;
}

const tempDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

interface Fixture {
  readonly projectRoot: string;
  readonly integrationPath: string;
  readonly ctx: ExecuteStepContext;
}

async function createFixture(
  stories: readonly StageStory[],
  withGraph: readonly StepNode[] | undefined,
  options: {
    readonly branch?: string;
    readonly adapter?: PlatformAdapter;
    readonly gateRegistry?: ReadonlyMap<string, GateDefinition>;
  } = {},
): Promise<Fixture> {
  const branch = options.branch ?? INTEGRATION_BRANCH;
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'forge-build-stage-landing-'));
  tempDirs.push(projectRoot);
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: projectRoot });
  await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: projectRoot });
  await execa('git', ['config', 'user.name', 'Test'], { cwd: projectRoot });
  await writeFile(path.join(projectRoot, '.gitignore'), '.forge/state/\n');
  await execa('git', ['add', '.gitignore'], { cwd: projectRoot });
  await execa('git', ['commit', '--quiet', '-m', 'init'], { cwd: projectRoot });
  const integrationPath = path.join(projectRoot, '.forge', 'state', 'worktrees', 'integration');
  await execa('git', ['worktree', 'add', '--quiet', '-b', branch, integrationPath, 'main'], {
    cwd: projectRoot,
  });
  const runId = 'run-build-stage';
  let tick = 0;
  const now = () => (tick += 1);
  const gateRegistry = options.gateRegistry ?? new Map<string, GateDefinition>();
  const ctx: ExecuteStepContext = {
    adapter: options.adapter ?? adapterFor(stories),
    vcs: createVcsFacade(projectRoot, runId),
    telemetry: createTelemetryFacade(projectRoot, runId, now),
    gates: createGateEvaluator(gateRegistry),
    gateRegistry,
    mergeQueue: createMergeQueueFacade(integrationPath, undefined),
    runId,
    projectRoot,
    integrationBase: branch,
    integrationPath,
    model: FAKE_MODEL_ID,
    tools: TOOLS,
    assembly: assemblyFor(projectRoot),
    retainLaneWorktrees: false,
    claimPolicy: 'strict',
    signCommits: false,
    now,
    laneRegistry: new Map<string, LaneHandle>(),
    ...(withGraph === undefined
      ? {}
      : { stepGraph: new Map(withGraph.map((node) => [node.id, node] as const)) }),
  };
  return { projectRoot, integrationPath, ctx };
}

/** Runs the nodes named by `include` through `executeStep`, each once every included dependency has succeeded:
 * what the scheduler does, minus the stages of the workflow this test is not about. */
async function drive(
  nodes: readonly StepNode[],
  include: (node: StepNode) => boolean,
  ctx: ExecuteStepContext,
): Promise<ReadonlyMap<string, 'succeeded' | 'failed'>> {
  // The shipped merge declares `preChecks: fast` / `postChecks: full`, which the engine runs as shell commands
  // (`fast: command not found`): a separate, pre-existing gap recorded in Q221, not what this test is about.
  // The policy's checks are dropped and its conflict policy kept.
  const wanted = nodes
    .filter(include)
    .map((node) =>
      node.kind === 'merge' && node.mergePolicy !== undefined
        ? { ...node, mergePolicy: { conflict: node.mergePolicy.conflict } }
        : node,
    );
  const done = new Map<string, 'succeeded' | 'failed'>();
  while (done.size < wanted.length) {
    const ready = wanted.filter(
      (node) =>
        !done.has(node.id) &&
        node.dependsOn.every(
          (dep) => done.get(dep) === 'succeeded' || !wanted.some((w) => w.id === dep),
        ),
    );
    if (ready.length === 0)
      throw new Error(
        `stuck: ${wanted
          .filter((n) => !done.has(n.id))
          .map((n) => n.id)
          .join(', ')}`,
      );
    for (const node of ready) {
      const outcome = await executeStep(node, ctx);
      if (outcome.status !== 'succeeded') {
        throw new Error(`${node.id} failed: ${JSON.stringify(outcome.failure)}`);
      }
      done.set(node.id, outcome.status);
    }
  }
  return done;
}

const RUN_KINDS = (node: StepNode): boolean => {
  const short = node.id.slice(P.length);
  return (
    short.startsWith('generate-tests:') ||
    short.startsWith('implement:') ||
    short.startsWith('review:') ||
    short === 'merge'
  );
};

async function filesOnIntegration(fixture: Fixture): Promise<readonly string[]> {
  const { stdout } = await execa('git', ['ls-tree', '-r', '--name-only', 'HEAD'], {
    cwd: fixture.integrationPath,
  });
  return stdout.split('\n').filter((line) => line !== '');
}

describe('the shipped build-stage merge lands the lanes of the work it merges', () => {
  // One full run (a dozen real lanes and sessions) shared by the tests that only read its result.
  let shared: Promise<Fixture> | undefined;
  const sharedRun = (): Promise<Fixture> => {
    shared ??= (async () => {
      const fixture = await createFixture(stories, nodes);
      const done = await drive(nodes, RUN_KINDS, fixture.ctx);
      expect(done.get(`${P}merge`)).toBe('succeeded');
      return fixture;
    })();
    return shared;
  };
  const stories = [
    story('STORY-001', [], ['src/story-001/**', 'tests/story-001/**']),
    story('STORY-002', ['STORY-001'], ['src/story-002/**', 'tests/story-002/**']),
  ];
  const nodes = compileStageRunPlan(shippedBuildStage(), 'mvp', stories).nodes;

  it('integrates the implement and generate-tests lanes the reviews approved, not only the review lanes', async () => {
    const fixture = await sharedRun();

    const files = await filesOnIntegration(fixture);
    // The code and tests: what the reviews approved.
    expect(files).toContain('src/story-001/story-001.ts');
    expect(files).toContain('src/story-002/story-002.ts');
    expect(files).toContain('tests/story-001/story-001.test.ts');
    expect(files).toContain('tests/story-002/story-002.test.ts');
    // And the engine-written review reports.
    expect(files.filter((file) => /REVIEW-\d{3}\.md$/.test(file))).toHaveLength(2);
    // Every lane the merge landed is gone; the registry holds nothing.
    expect(fixture.ctx.laneRegistry.size).toBe(0);
  });

  it("lands each story's lanes before the lanes that depend on them (dependencies first) in one deterministic order", async () => {
    const fixture = await sharedRun();

    const { stdout } = await execa('git', ['log', '--merges', '--reverse', '--format=%B%x00'], {
      cwd: fixture.integrationPath,
    });
    const order = stdout
      .split('\0')
      .flatMap((message) =>
        [...message.matchAll(/Forge-Step: (\S+)/g)].map((m) => (m[1] ?? '').slice(P.length)),
      );
    expect(order).toEqual([
      'generate-tests:STORY-001',
      'implement:STORY-001',
      'review:STORY-001',
      'generate-tests:STORY-002',
      'implement:STORY-002',
      'review:STORY-002',
    ]);
  });

  it('a merge driven with no plan lands only its direct predecessors (the pre-P19 behaviour, kept for a bare handler)', async () => {
    const fixture = await createFixture(stories, undefined);
    await drive(nodes, RUN_KINDS, fixture.ctx);

    const files = await filesOnIntegration(fixture);
    expect(files.filter((file) => /REVIEW-\d{3}\.md$/.test(file))).toHaveLength(2);
    expect(files).not.toContain('src/story-001/story-001.ts');
  });

  it('knows which lanes a merge waits for: every lane behind the reviews, and not the design lane before the gate', () => {
    const landed = stepsLandedByMerges(nodes);
    for (const item of stories) {
      for (const kind of ['generate-tests', 'implement', 'review']) {
        expect(landed.has(`${P}${kind}:${item.id}`)).toBe(true);
      }
    }
    // `freeze-contracts` is before `contracts-gate` (an integration checkpoint): integrated as soon as it
    // succeeds, so the gate reads it and the story lanes branch from a tip that holds the contracts.
    expect(landed.has(`${P}freeze-contracts`)).toBe(false);
    expect(landed.has(`${P}merge`)).toBe(false);
  });

  it('the report on the integration branch is the file the engine wrote', async () => {
    const fixture = await sharedRun();
    const report = (await filesOnIntegration(fixture)).find((file) =>
      file.endsWith('REVIEW-001.md'),
    );
    expect(report).toBeDefined();
    if (report === undefined) return;
    expect(await readFile(path.join(fixture.integrationPath, report), 'utf8')).toContain(
      'ReviewReport',
    );
  });
});

/** A valid `InterfaceContract` (`18` §18.7): `freeze-contracts` declares it as an output. */
const CONTRACT_PATH = 'docs/forge/specs/interfaces/orders-api.yaml';
const CONTRACT = [
  'id: INT-001',
  'type: InterfaceContract',
  'schemaVersion: 1',
  'title: orders-api',
  'status: draft',
  'created: 2026-01-15',
  'updated: 2026-01-15',
  'revision: 1',
  'author: architect',
  'changelog: []',
  'openapi: 3.1.0',
  '',
].join('\n');

function trivialGates(...ids: string[]): ReadonlyMap<string, GateDefinition> {
  return new Map(
    ids.map((id) => [
      id,
      {
        id,
        checks: { deterministic: [], advisory: [] },
        openQuestionsPolicy: 'warn',
      },
    ]),
  );
}

describe('the shipped build-stage through the engine (runEngine)', () => {
  const stories = [
    story('STORY-001', [], ['src/story-001/**', 'tests/story-001/**']),
    story('STORY-002', ['STORY-001'], ['src/story-002/**', 'tests/story-002/**']),
  ];

  it('integrates the contracts before the design gate, lands the story lanes at the merge, and runs prepare as a no-op on the stage branch', async () => {
    const workflow = shippedBuildStage();
    const source = readFileSync(
      path.join(repoRoot, 'packages', 'templates', WORKFLOW_INDEX['build-stage']),
      'utf8',
    ).replace(
      'policy: { conflict: agent, preChecks: fast, postChecks: full }',
      'policy: { conflict: abort }',
    );
    // The shipped `preChecks: fast` / `postChecks: full` are run as shell commands (Q221): swapped for the
    // conflict policy alone; every other line of the workflow is the shipped one.
    expect(source).toContain('policy: { conflict: abort }');

    const probed = new Map<string, boolean>();
    const adapter = adapterFor(stories, (request) => {
      probed.set(request.stepId, existsSync(path.join(request.cwd, CONTRACT_PATH)));
    });
    adapter.script((request) => request.stepId === `${P}freeze-contracts`, {
      text: ['froze the contracts'],
      writeFiles: [{ relativePath: CONTRACT_PATH, content: CONTRACT }],
    });
    const fixture = await createFixture(stories, undefined, {
      branch: 'forge/integration/mvp',
      adapter,
      gateRegistry: trivialGates('G-Design', 'G-Verify'),
    });
    const ctx: RunEngineContext = {
      ...fixture.ctx,
      limits: { global: 100, perAgent: new Map(), perResourceClass: new Map() },
      seed: 'seed',
    };

    // `standup` (a session step) and `deliver` (a subworkflow, which the engine refuses: RUN-039) end the
    // workflow; everything before them is the part under test.
    await runEngine(source, buildStageRunContext(workflow, 'mvp', stories), ctx).catch(
      () => undefined,
    );

    const files = await filesOnIntegration(fixture);
    expect(files).toContain(CONTRACT_PATH);
    // The contracts were integrated before any story lane started: each generate-tests session saw them.
    expect(probed.get(`${P}generate-tests:STORY-001`)).toBe(true);
    expect(probed.get(`${P}implement:STORY-001`)).toBe(true);
    // The merge landed the code and tests the reviews approved.
    for (const file of [
      'src/story-001/story-001.ts',
      'src/story-002/story-002.ts',
      'tests/story-001/story-001.test.ts',
      'tests/story-002/story-002.test.ts',
    ]) {
      expect(files).toContain(file);
    }
    expect(files.filter((file) => /REVIEW-\d{3}\.md$/.test(file))).toHaveLength(2);
    // `prepare` ran in the integration worktree on the stage branch: nothing to switch, the branch is intact.
    const branch = await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: fixture.integrationPath,
    });
    expect(branch.stdout.trim()).toBe('forge/integration/mvp');
    expect(fixture.ctx.laneRegistry.size).toBe(0);
  });
});
