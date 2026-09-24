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
 * The first describe drives the nodes one by one rather than through `runEngine` because the shipped workflow ends in
 * a `subworkflow` step (`deliver`) that the engine still refuses (`RUN-039`); the stages it exercises
 * (`generate-tests`, `implement`, `review`, `merge`) are the ones whose lanes are at issue. The last two describes
 * run the shipped `build-stage` and `implement-story` through `runEngine` with configured (fake, cheap,
 * deterministic) test commands: the inner loop end to end (`PLAN-M13.md` P38, `SPEC-QUESTIONS.md` Q226).
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
import { readEvents } from '../packages/telemetry/src/events.ts';
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

/** Every layer the shipped `fast` and `full` sets name, as a command that passes (`node -e`, cheap, deterministic). */
const PASSING_COMMANDS: Readonly<Record<string, string>> = Object.fromEntries(
  ['typecheck', 'lint', 'unit', 'integration', 'contract'].map((layer) => [
    layer,
    `node -e "process.exit(0)"`,
  ]),
);

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
    /** `execution.testCommands`; default: every layer of the shipped sets passes. */
    readonly testCommands?: Readonly<Record<string, string>>;
    readonly commandEnv?: Readonly<Record<string, string>>;
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
    mergeQueue: createMergeQueueFacade(integrationPath, undefined, {
      env: options.commandEnv,
    }),
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
    testCommands: options.testCommands ?? PASSING_COMMANDS,
    ...(options.commandEnv === undefined ? {} : { commandEnv: options.commandEnv }),
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
  // The shipped merge policy runs as shipped (`preChecks: fast` / `postChecks: full` resolve to the fixture's
  // configured test commands, `PLAN-M13.md` P38): nothing is stripped.
  const wanted = nodes.filter(include);
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
    // The shipped source, unmodified: its `preChecks: fast` / `postChecks: full` resolve to the configured test
    // commands (they used to be run as shell commands, `fast: command not found`, and this test had to swap them).
    const source = readFileSync(
      path.join(repoRoot, 'packages', 'templates', WORKFLOW_INDEX['build-stage']),
      'utf8',
    );
    expect(source).toContain('policy: { conflict: agent, preChecks: fast, postChecks: full }');

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

// ---------------------------------------------------------------------------------------------------------
// The inner loops end to end (`PLAN-M13.md` P38, `SPEC-QUESTIONS.md` Q226): the shipped workflows, unmodified,
// through `runEngine`, with stacked lanes and the merge's own check sets.

/** A test command that records where it ran and exits with `exitCode` (`node -e`, cheap and deterministic). */
function recordingCommand(marker: string, label: string, exitCode = 0): string {
  return `node -e 'require("fs").appendFileSync(${JSON.stringify(marker)}, "${label} " + process.cwd() + "\\n"); process.exit(${String(exitCode)})'`;
}

function markerLines(marker: string): readonly string[] {
  return existsSync(marker)
    ? readFileSync(marker, 'utf8')
        .split('\n')
        .filter((line) => line !== '')
    : [];
}

async function eventsOf(projectRoot: string, runId: string) {
  const events = [];
  for await (const event of readEvents(projectRoot, runId)) events.push(event);
  return events;
}

describe('the shipped build-stage inner loop, end to end (runEngine, stacked lanes, the merge checks as shipped)', () => {
  const stories = [
    story('STORY-001', [], ['src/story-001/**', 'tests/story-001/**']),
    story('STORY-002', ['STORY-001'], ['src/story-002/**', 'tests/story-002/**']),
  ];
  const WATCHED = [
    'tests/story-001/story-001.test.ts',
    'src/story-001/story-001.ts',
    'tests/story-002/story-002.test.ts',
    'src/story-002/story-002.ts',
    CONTRACT_PATH,
  ];

  interface Outcome {
    readonly fixture: Fixture;
    readonly seen: Map<string, readonly string[]>;
    readonly marker: string;
    readonly events: Awaited<ReturnType<typeof eventsOf>>;
  }

  async function runShipped(
    testCommands: (marker: string) => Readonly<Record<string, string>>,
  ): Promise<Outcome> {
    const workflow = shippedBuildStage();
    const source = readFileSync(
      path.join(repoRoot, 'packages', 'templates', WORKFLOW_INDEX['build-stage']),
      'utf8',
    );
    const seen = new Map<string, readonly string[]>();
    const adapter = adapterFor(stories, (request) => {
      seen.set(
        request.stepId,
        WATCHED.filter((file) => existsSync(path.join(request.cwd, file))),
      );
    });
    adapter.script((request) => request.stepId === `${P}freeze-contracts`, {
      text: ['froze the contracts'],
      writeFiles: [{ relativePath: CONTRACT_PATH, content: CONTRACT }],
    });
    // `marker` lives in the temp dir that holds the project, outside every worktree.
    const fixture = await createFixture(stories, undefined, {
      branch: 'forge/integration/mvp',
      adapter,
      gateRegistry: trivialGates('G-Design', 'G-Verify'),
      testCommands: {},
    });
    const marker = path.join(fixture.projectRoot, '.forge', 'state', 'checks.txt');
    const ctx: RunEngineContext = {
      ...fixture.ctx,
      testCommands: testCommands(marker),
      limits: { global: 100, perAgent: new Map(), perResourceClass: new Map() },
      seed: 'seed',
    };
    // `standup` (a session step) and `deliver` (a subworkflow, which the engine refuses: RUN-039) end the workflow;
    // everything before them is the part under test.
    await runEngine(source, buildStageRunContext(workflow, 'mvp', stories), ctx).catch(
      () => undefined,
    );
    return { fixture, seen, marker, events: await eventsOf(fixture.projectRoot, ctx.runId) };
  }

  const ALL_LAYERS = ['typecheck', 'lint', 'unit', 'integration', 'contract'] as const;
  const recordingAll =
    (exitCodes: Partial<Record<(typeof ALL_LAYERS)[number], number>> = {}) =>
    (marker: string) =>
      Object.fromEntries(
        ALL_LAYERS.map((layer) => [layer, recordingCommand(marker, layer, exitCodes[layer] ?? 0)]),
      );

  it('each step sees the step before it (tests before implement, the dependency story before its dependent) before anything is merged', async () => {
    const { seen, events } = await runShipped(recordingAll());

    // `generate-tests` output is visible to `implement` (they are two lanes of one story, in one merge's scope).
    expect(seen.get(`${P}implement:STORY-001`)).toEqual([
      'tests/story-001/story-001.test.ts',
      CONTRACT_PATH,
    ]);
    // The dependent story's chain starts from its dependency's integrated-to-be code, tests and all.
    for (const step of ['generate-tests', 'implement']) {
      const files = seen.get(`${P}${step}:STORY-002`) ?? [];
      expect(files).toContain('src/story-001/story-001.ts');
      expect(files).toContain('tests/story-001/story-001.test.ts');
    }
    expect(seen.get(`${P}implement:STORY-002`)).toContain('tests/story-002/story-002.test.ts');
    // The review's perspective sessions read the reviewed lane, so the diff under review is there.
    for (const perspective of ['design', 'security', 'testing', 'performance']) {
      expect(seen.get(`${P}review:STORY-001:review:${perspective}`)).toContain(
        'src/story-001/story-001.ts',
      );
      expect(seen.get(`${P}review:STORY-002:review:${perspective}`)).toContain(
        'src/story-002/story-002.ts',
      );
    }
    // Review-before-merge held: every lane of the stories reached the integration branch through the one merge step
    // (the contract lane was integrated by the engine, before its gate, as before).
    const merged = events.filter((event) => event.type === 'MergeCompleted');
    expect(new Set(merged.map((event) => event.stepId))).toEqual(
      new Set([`${P}freeze-contracts`, `${P}merge`]),
    );
    expect(merged.filter((event) => event.stepId === `${P}merge`)).toHaveLength(6);
  });

  it('the merge runs the shipped fast set before and the full set after every lane it lands, all pass, and the integration branch holds everything', async () => {
    const { fixture, marker, events } = await runShipped(recordingAll());

    const lines = markerLines(marker);
    const inIntegration = (line: string): boolean =>
      line.endsWith(path.join('worktrees', 'integration'));
    const pre = lines.filter((line) => !inIntegration(line)).map((line) => line.split(' ')[0]);
    const post = lines.filter(inIntegration).map((line) => line.split(' ')[0]);
    // Six lanes: `fast` (typecheck, lint, unit) in each lane, `full` (fast + integration + contract) in the tree.
    expect(pre).toEqual(Array.from({ length: 6 }, () => ['typecheck', 'lint', 'unit']).flat());
    expect(post).toEqual(
      Array.from({ length: 6 }, () => [
        'typecheck',
        'lint',
        'unit',
        'integration',
        'contract',
      ]).flat(),
    );
    expect(events.some((event) => event.type === 'MergeReverted')).toBe(false);
    const files = await filesOnIntegration(fixture);
    for (const file of [
      'src/story-001/story-001.ts',
      'src/story-002/story-002.ts',
      'tests/story-001/story-001.test.ts',
      'tests/story-002/story-002.test.ts',
      CONTRACT_PATH,
    ]) {
      expect(files).toContain(file);
    }
    expect(files.filter((file) => /REVIEW-\d{3}\.md$/.test(file))).toHaveLength(2);
    expect(fixture.ctx.laneRegistry.size).toBe(0);
    // No `command not found` anywhere: the shipped names were resolved, not run.
    expect(JSON.stringify(events)).not.toContain('command not found');
  });

  it('a failing pre-check blocks the landing with the typed reason and the configured command named; nothing of the stories reaches the branch', async () => {
    const { fixture, events } = await runShipped(recordingAll({ unit: 1 }));

    const failure = events.find(
      (event) => event.type === 'StepFailed' && event.stepId === `${P}merge`,
    )?.payload as { code?: string; message?: string } | undefined;
    expect(failure?.code).toBe('MERGE-PRE-CHECK-FAILED');
    expect(failure?.message).toContain('execution.testCommands.unit');
    const files = await filesOnIntegration(fixture);
    expect(files).not.toContain('tests/story-001/story-001.test.ts');
    expect(files).not.toContain('src/story-001/story-001.ts');
    // The lanes are kept for inspection; the integration tree is clean.
    expect(fixture.ctx.laneRegistry.size).toBeGreaterThan(0);
    expect(
      (await execa('git', ['status', '--porcelain'], { cwd: fixture.integrationPath })).stdout,
    ).toBe('');
  });

  it('a failing post-check reverts the merge of the lane that broke it and lands nothing after it', async () => {
    const { fixture, events } = await runShipped(recordingAll({ contract: 1 }));

    const failure = events.find(
      (event) => event.type === 'StepFailed' && event.stepId === `${P}merge`,
    )?.payload as { code?: string; message?: string } | undefined;
    expect(failure?.code).toBe('MERGE-POST-CHECK-FAILED');
    expect(failure?.message).toContain('execution.testCommands.contract');
    expect(events.filter((event) => event.type === 'MergeReverted')).toHaveLength(1);
    const files = await filesOnIntegration(fixture);
    // The first lane of the first story (its tests) was merged and reverted; nothing built on it landed.
    expect(files).not.toContain('tests/story-001/story-001.test.ts');
    expect(files).not.toContain('src/story-001/story-001.ts');
  });

  it('a project with no test commands configured is refused with the config keys named, before any story lane is built, never "command not found"', async () => {
    const { fixture, events } = await runShipped(() => ({}));

    // Refused at the start of the run, on the record, before any story lane is built and paid for.
    const failure = events.find((event) => event.type === 'RunFailed')?.payload as
      { reason?: string; message?: string } | undefined;
    expect(failure?.reason).toBe('setup');
    expect(failure?.message).toContain('execution.testCommands.unit');
    expect(failure?.message).not.toContain('command not found');
    expect(events.some((event) => event.type === 'LaneCreated')).toBe(false);
    expect(await filesOnIntegration(fixture)).not.toContain('src/story-001/story-001.ts');
  });
});

// ---------------------------------------------------------------------------------------------------------
// `PLAN-M14.md` P34: a step built on several unmerged predecessors is built on an in-lane merge of their
// heads onto the integration tip, not just the tip alone (the pre-P34 conservative "branch from the tip and
// say so" reading of Q226 open item (a)). `STORY-003` depends on both `STORY-001` and `STORY-002`, which are
// otherwise unrelated (disjoint `filesExpected`, so the compiler adds no implicit ordering edge between
// them): `generate-tests:STORY-003`'s own predecessors are `review:STORY-001` and `review:STORY-002`
// (`stage-plan.ts`'s own "every step where B's work begins gains a dependsOn edge to every step where A's
// work ends"), two genuinely unmerged, unrelated lanes at once.

describe('a story depending on two others sees both before the merge (PLAN-M14.md P34, an in-lane join)', () => {
  const stories = [
    story('STORY-001', [], ['src/story-001/**', 'tests/story-001/**']),
    story('STORY-002', [], ['src/story-002/**', 'tests/story-002/**']),
    story('STORY-003', ['STORY-001', 'STORY-002'], ['src/story-003/**', 'tests/story-003/**']),
  ];
  const WATCHED = [
    'src/story-001/story-001.ts',
    'tests/story-001/story-001.test.ts',
    'src/story-002/story-002.ts',
    'tests/story-002/story-002.test.ts',
  ];

  it('S3 (dependsOn S1, S2) sees both S1 and S2 before the merge, and every lane lands exactly once', async () => {
    const workflow = shippedBuildStage();
    const source = readFileSync(
      path.join(repoRoot, 'packages', 'templates', WORKFLOW_INDEX['build-stage']),
      'utf8',
    );
    const seen = new Map<string, readonly string[]>();
    const adapter = adapterFor(stories, (request) => {
      seen.set(
        request.stepId,
        WATCHED.filter((file) => existsSync(path.join(request.cwd, file))),
      );
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

    await runEngine(source, buildStageRunContext(workflow, 'mvp', stories), ctx).catch(
      () => undefined,
    );

    // `generate-tests:STORY-003` (S3's own first step) sees BOTH S1's and S2's code and tests, via the
    // in-lane join of their unmerged `implement`/`review` lanes -- neither predecessor contains the other,
    // so before P34 this step would have branched from the tip alone and seen neither.
    expect(seen.get('build-stage:generate-tests:STORY-003')).toEqual(
      expect.arrayContaining(WATCHED),
    );
    const files = await filesOnIntegration(fixture);
    for (const file of [
      ...WATCHED,
      'src/story-003/story-003.ts',
      'tests/story-003/story-003.test.ts',
    ]) {
      expect(files).toContain(file);
    }
    // Every step's own lane lands exactly once: no duplicate merge commit for any step id.
    const { stdout } = await execa('git', ['log', '--merges', '--format=%B%x00'], {
      cwd: fixture.integrationPath,
    });
    const trailers = stdout
      .split('\0')
      .flatMap((message) => [...message.matchAll(/Forge-Step: (\S+)/g)].map((m) => m[1] ?? ''))
      .filter((id) => id !== '');
    const counts = new Map<string, number>();
    for (const id of trailers) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const [id, count] of counts) expect(count, `${id} landed ${String(count)} times`).toBe(1);
    expect(fixture.ctx.laneRegistry.size).toBe(0);
  });
});

const HANDOFF_PATH = 'docs/forge/reports/handoffs.md';
const HANDOFF = [
  '---',
  'type: HandoffRecord',
  'handoffs:',
  '  - id: HO-0001',
  '    from: backend',
  '    to: sdet',
  '    step: plan',
  "    timestamp: '2026-01-15T10:00:00Z'",
  "    delivered: ['subtype: implementation-plan', 'src/story-001/story-001.ts: the implementation']",
  '    open_questions: []',
  '    assumptions: []',
  '    constraints_for_receiver: []',
  '    acceptance_for_receiver: []',
  '---',
  '',
].join('\n');

describe('the shipped implement-story inner loop, end to end (runEngine, stacked lanes, the merge checks as shipped)', () => {
  const PS = 'implement-story:';
  const WATCHED = [
    HANDOFF_PATH,
    'tests/story-001/story-001.test.ts',
    'src/story-001/story-001.ts',
    'src/story-001/README.md',
  ];

  async function runShipped(exitCodes: Partial<Record<string, number>> = {}) {
    const workflowSource = readFileSync(
      path.join(repoRoot, 'packages', 'templates', WORKFLOW_INDEX['implement-story']),
      'utf8',
    );
    const fixture = await createFixture([], undefined, {
      testCommands: {},
      branch: 'forge/integration/story',
    });
    const marker = path.join(fixture.projectRoot, '.forge', 'state', 'checks.txt');
    const verified = path.join(fixture.projectRoot, '.forge', 'state', 'verified.txt');
    // `self-verify` is `forge story verify STORY-001 --json` in a lane: a fake `forge` that succeeds only where the
    // code `green` wrote and the tests `red` wrote are in the tree it runs in.
    const bin = await mkdtemp(path.join(tmpdir(), 'forge-fake-bin-'));
    tempDirs.push(bin);
    const script = [
      '#!/bin/sh',
      'test -f src/story-001/story-001.ts || { echo "the implementation is not in this tree" >&2; exit 3; }',
      'test -f tests/story-001/story-001.test.ts || { echo "the tests are not in this tree" >&2; exit 4; }',
      `echo "$PWD" >> ${JSON.stringify(verified)}`,
      'exit 0',
      '',
    ].join('\n');
    await writeFile(path.join(bin, 'forge'), script, { mode: 0o755 });
    const seen = new Map<string, readonly string[]>();
    const adapter = new FakePlatformAdapter();
    adapter.script((request) => {
      seen.set(
        request.stepId,
        WATCHED.filter((file) => existsSync(path.join(request.cwd, file))),
      );
      return false;
    }, {});
    const write = (step: string, relativePath: string, content: string): void => {
      adapter.script((request) => request.stepId === `${PS}${step}`, {
        text: [`did ${step}`],
        writeFiles: [{ relativePath, content }],
      });
    };
    write('plan', HANDOFF_PATH, HANDOFF);
    write('red', 'tests/story-001/story-001.test.ts', '// red\n');
    write('green', 'src/story-001/story-001.ts', 'export const one = 1;\n');
    write('refactor', 'src/story-001/story-001.ts', 'export const one = 1; // tidy\n');
    write('document', 'src/story-001/README.md', '# story one\n');
    adapter.script((request) => /^implement-story:review:review:[a-z]+$/.test(request.stepId), {
      text: ['reviewed'],
      structured: CLEAN,
    });
    const layers = ['typecheck', 'lint', 'unit', 'integration', 'contract'];
    const ctx: RunEngineContext = {
      ...fixture.ctx,
      adapter,
      commandEnv: { PATH: `${bin}${path.delimiter}${process.env['PATH'] ?? ''}` },
      mergeQueue: createMergeQueueFacade(fixture.integrationPath, undefined, {
        env: { PATH: `${bin}${path.delimiter}${process.env['PATH'] ?? ''}` },
      }),
      testCommands: Object.fromEntries(
        layers.map((layer) => [layer, recordingCommand(marker, layer, exitCodes[layer] ?? 0)]),
      ),
      limits: { global: 100, perAgent: new Map(), perResourceClass: new Map() },
      seed: 'seed',
    };
    // The run inputs `forge run implement-story --input storyId=... --input ownerRole=...` puts at the top of the
    // context (`expression-context.ts`), and the story's claim as `run`.
    const context: Record<string, unknown> = {
      storyId: 'STORY-001',
      ownerRole: 'backend',
      run: {
        filesExpected: ['src/story-001/**', 'tests/story-001/**'],
        testPaths: ['tests/story-001/**'],
      },
    };
    const state = await runEngine(workflowSource, context, ctx);
    return {
      fixture,
      state,
      seen,
      marker,
      verified,
      events: await eventsOf(fixture.projectRoot, ctx.runId),
    };
  }

  it('the plan is visible to red, the tests to green, the code to refactor, self-verify, the review and document, all before the merge; the merge then lands the story with its checks', async () => {
    const { fixture, state, seen, marker, verified, events } = await runShipped();

    expect(state.runStatus).toBe('completed');
    expect(seen.get(`${PS}plan`)).toEqual([]);
    expect(seen.get(`${PS}red`)).toEqual([HANDOFF_PATH]);
    expect(seen.get(`${PS}green`)).toEqual([HANDOFF_PATH, 'tests/story-001/story-001.test.ts']);
    expect(seen.get(`${PS}refactor`)).toContain('src/story-001/story-001.ts');
    // `self-verify` AND `done-check` (M14 P25, both `forge story verify ...` in a lane) each ran where
    // green's code and red's tests are: the fake `forge` (which does not read the `--phase` argument at
    // all) says so twice.
    expect(markerLines(verified)).toHaveLength(2);
    for (const perspective of ['design', 'security', 'testing', 'performance']) {
      expect(seen.get(`${PS}review:review:${perspective}`)).toContain('src/story-001/story-001.ts');
    }
    expect(seen.get(`${PS}document`)).toContain('src/story-001/story-001.ts');
    // Review-before-merge: every landing belongs to the one merge step.
    const merged = events.filter((event) => event.type === 'MergeCompleted');
    expect(new Set(merged.map((event) => event.stepId))).toEqual(new Set([`${PS}merge`]));
    // Six lanes changed something (plan, red, green, refactor, review, document); self-verify changed nothing.
    expect(merged).toHaveLength(6);
    const lines = markerLines(marker);
    expect(
      lines.filter((line) => !line.endsWith(path.join('worktrees', 'integration'))),
    ).toHaveLength(18);
    expect(
      lines.filter((line) => line.endsWith(path.join('worktrees', 'integration'))),
    ).toHaveLength(30);
    const files = await filesOnIntegration(fixture);
    for (const file of WATCHED) expect(files).toContain(file);
    expect(files.filter((file) => /REVIEW-\d{3}\.md$/.test(file))).toHaveLength(1);
    expect(fixture.ctx.laneRegistry.size).toBe(0);
    expect(JSON.stringify(events)).not.toContain('command not found');
  });

  it('a failing pre-check stops the merge with the typed reason: nothing of the story is integrated', async () => {
    const { fixture, events } = await runShipped({ lint: 1 });

    const failure = events.find(
      (event) => event.type === 'StepFailed' && event.stepId === `${PS}merge`,
    )?.payload as { code?: string; message?: string } | undefined;
    expect(failure?.code).toBe('MERGE-PRE-CHECK-FAILED');
    expect(failure?.message).toContain('execution.testCommands.lint');
    expect(await filesOnIntegration(fixture)).not.toContain(HANDOFF_PATH);
  });
});
