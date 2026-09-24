/**
 * Stacked lanes, in-lane joins and merge checks (`PLAN-M13.md` P38, `PLAN-M14.md` P34, `06` §6.4-§6.5, `10`
 * §10.1, `SPEC-QUESTIONS.md` Q221 open items and Q226).
 *
 * A lane a `merge` step lands is not integrated before that merge (review before merge), so before P38 a step
 * that builds on such a lane could not see it: `implement` did not see the tests `generate-tests` wrote, a
 * review did not see the code it reviewed. A step's own lane is always created from the integration tip, and
 * every unmerged, same-scope predecessor's head is then merged into it (P34): a fast-forward for the common
 * single-predecessor, tip-unmoved case (byte-identical to the old stacking rule — the branch simply moves),
 * a real merge commit otherwise, including a genuine join of several unrelated predecessors (Q226 open item
 * (a), previously an unbuilt blind spot) and a single predecessor whose lane missed something the engine
 * integrated after it was created (Q226 open item (e)). The merge lands the lanes in dependency order. And
 * the merge's own `preChecks`/`postChecks` are check-set NAMES (`fast`, `full`) that resolve to the project's
 * configured test commands instead of being run as shell commands (`fast: command not found`).
 *
 * Everything runs the real engine (`runEngine`) over a real git repository laid out the way `forge run` lays one
 * out; only the model sessions are the fake adapter's (strict prompt checking stays on).
 *
 * @see specs/06 §6.4, §6.5
 * @see specs/10 §10.1
 * @see PLAN-M13.md P38
 * @see PLAN-M14.md P34
 */
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { FAKE_MODEL_ID, FakePlatformAdapter, type FakeSessionScript } from '@forge/testkit';
import type { PlatformAdapter, ToolGrant } from '@forge/adapter-kit';
import { readEvents } from '@forge/telemetry/events';
import { describe, expect, it } from 'vitest';

import {
  createGateEvaluator,
  createMergeQueueFacade,
  createTelemetryFacade,
  createVcsFacade,
} from '../../src/dispatch/facades.ts';
import type { LaneHandle } from '../../src/dispatch/types.ts';
import { compileRunPlan, type StepNode } from '../../src/plan/index.ts';
import { resumeRun } from '../../src/resume/orchestrate.ts';
import { runEngine, type RunEngineContext } from '../../src/run/run-engine.ts';
import { parseWorkflow } from '../../src/workflow/parse.ts';
import type { ConcurrencyLimits } from '../../src/scheduler/types.ts';
import { createFixtureAssembly } from '../dispatch/helpers.ts';

const INTEGRATION_BRANCH = 'forge/integration/current';
const UNLIMITED: ConcurrencyLimits = {
  global: 100,
  perAgent: new Map(),
  perResourceClass: new Map(),
};
const TOOLS: ToolGrant = { read: true, write: true, exec: false, network: 'none' };
const RUN_ID = 'run-stack';

interface Project {
  readonly projectRoot: string;
  readonly integrationPath: string;
}

async function createProject(prefix: string): Promise<Project> {
  const projectRoot = await mkdtemp(path.join(tmpdir(), `forge-stacked-${prefix}-`));
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: projectRoot });
  await writeFile(path.join(projectRoot, '.gitignore'), '.forge/state/\n');
  await execa('git', ['add', '.gitignore'], { cwd: projectRoot });
  await execa('git', ['commit', '--quiet', '-m', 'init'], { cwd: projectRoot });
  const integrationPath = path.join(projectRoot, '.forge', 'state', 'worktrees', 'integration');
  await execa(
    'git',
    ['worktree', 'add', '--quiet', '-b', INTEGRATION_BRANCH, integrationPath, 'main'],
    { cwd: projectRoot },
  );
  return { projectRoot, integrationPath };
}

interface ContextOptions {
  readonly adapter: PlatformAdapter;
  readonly testCommands?: Readonly<Record<string, string>>;
  readonly mergeChecks?: { readonly pre?: string; readonly post?: string };
  readonly laneRegistry?: Map<string, LaneHandle>;
  readonly checkLimits?: { readonly timeoutMs?: number; readonly maxOutputBytes?: number };
  /** `PLAN-M14.md` P34: the in-lane join's own conflict policy (default `abort`, matching `conflictPolicy`
   * below, which governs only merge-*landing*); a test that wants a real conflict resolver for a JOIN
   * passes both. */
  readonly joinConflictPolicy?: 'agent' | 'human' | 'abort';
  readonly joinConflictResolver?: (conflict: {
    readonly laneId: string;
    readonly declaredClaim: readonly string[];
    readonly conflictedFiles: readonly { readonly path: string; readonly status: string }[];
    readonly diff: string;
    readonly worktreePath: string;
  }) => Promise<'resolved' | 'unresolved'>;
  /** The merge QUEUE's own (landing-time) conflict resolver -- a distinct policy/resolver from the
   * in-lane join's own above: a `merge` step's `mergePolicy.conflict` governs landing, never the join. */
  readonly landingConflictResolver?: (conflict: {
    readonly laneId: string;
    readonly declaredClaim: readonly string[];
    readonly conflictedFiles: readonly { readonly path: string; readonly status: string }[];
    readonly diff: string;
    readonly worktreePath: string;
  }) => Promise<'resolved' | 'unresolved'>;
}

function contextFor(project: Project, options: ContextOptions): RunEngineContext {
  let tick = 0;
  const now = () => (tick += 1);
  const gateRegistry = new Map();
  return {
    adapter: options.adapter,
    vcs: createVcsFacade(project.projectRoot, RUN_ID, {
      conflictPolicy: options.joinConflictPolicy,
      conflictResolver: options.joinConflictResolver,
    }),
    telemetry: createTelemetryFacade(project.projectRoot, RUN_ID, now),
    gates: createGateEvaluator(gateRegistry),
    gateRegistry,
    mergeQueue: createMergeQueueFacade(project.integrationPath, options.landingConflictResolver, {
      checkLimits: options.checkLimits,
    }),
    runId: RUN_ID,
    projectRoot: project.projectRoot,
    integrationBase: INTEGRATION_BRANCH,
    integrationPath: project.integrationPath,
    model: FAKE_MODEL_ID,
    tools: TOOLS,
    assembly: createFixtureAssembly(project.projectRoot),
    retainLaneWorktrees: false,
    claimPolicy: 'strict',
    signCommits: false,
    now,
    laneRegistry: options.laneRegistry ?? new Map<string, LaneHandle>(),
    limits: UNLIMITED,
    seed: 'seed-1',
    conflictPolicy: 'abort',
    ...(options.testCommands === undefined ? {} : { testCommands: options.testCommands }),
    ...(options.mergeChecks === undefined ? {} : { mergeChecks: options.mergeChecks }),
  };
}

type Writes = Readonly<
  Record<string, readonly { readonly relativePath: string; readonly content: string }[]>
>;

interface ScriptedAdapter {
  readonly adapter: FakePlatformAdapter;
  /** For each dispatched session (by step id), which of `probe` existed in the session's cwd when it started. */
  readonly seen: Map<string, readonly string[]>;
}

function scriptedAdapter(
  writes: Writes,
  probe: readonly string[],
  extra: Record<string, FakeSessionScript> = {},
): ScriptedAdapter {
  const adapter = new FakePlatformAdapter();
  const seen = new Map<string, readonly string[]>();
  adapter.script((request) => {
    seen.set(
      request.stepId,
      probe.filter((file) => existsSync(path.join(request.cwd, file))),
    );
    return false;
  }, {});
  for (const [suffix, files] of Object.entries(writes)) {
    adapter.script((request) => request.stepId.endsWith(`:${suffix}`), {
      text: [`did ${suffix}`],
      writeFiles: files,
    });
  }
  for (const [suffix, script] of Object.entries(extra)) {
    adapter.script((request) => request.stepId.endsWith(`:${suffix}`), script);
  }
  return { adapter, seen };
}

function agent(
  id: string,
  options: { readonly dependsOn?: readonly string[]; readonly produces?: readonly string[] } = {},
): string {
  return [
    `  - id: ${id}`,
    '    kind: agent',
    '    agent: engineer',
    `    brief: "do ${id}"`,
    ...(options.dependsOn === undefined
      ? []
      : [`    dependsOn: [${options.dependsOn.join(', ')}]`]),
    ...(options.produces === undefined
      ? []
      : [`    produces: [${options.produces.map((p) => `"${p}"`).join(', ')}]`]),
  ].join('\n');
}

function mergeStep(
  dependsOn: readonly string[],
  policy = '{ conflict: abort }',
  id = 'merge',
): string {
  return [
    `  - id: ${id}`,
    '    kind: merge',
    `    over: ${dependsOn[0] ?? 'x'}`,
    `    dependsOn: [${dependsOn.join(', ')}]`,
    `    policy: ${policy}`,
  ].join('\n');
}

function workflowOf(id: string, steps: readonly string[]): string {
  return [
    `id: ${id}`,
    `name: ${id}`,
    'version: 1.0.0',
    `description: ${id} stacked lane test`,
    'steps:',
    ...steps,
    '',
  ].join('\n');
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await execa('git', args, { cwd })).stdout;
}

async function eventsOf(project: Project) {
  const events = [];
  for await (const event of readEvents(project.projectRoot, RUN_ID)) events.push(event);
  return events;
}

async function filesOnIntegration(project: Project): Promise<readonly string[]> {
  return (await git(project.integrationPath, 'ls-tree', '-r', '--name-only', 'HEAD'))
    .split('\n')
    .filter((line) => line !== '');
}

/** The step ids, in order, of the merge commits on the integration branch (the `Forge-Step` trailer). */
async function mergedStepOrder(project: Project): Promise<readonly string[]> {
  const log = await git(project.integrationPath, 'log', '--merges', '--reverse', '--format=%B%x00');
  return log
    .split('\0')
    .flatMap((message) =>
      [...message.matchAll(/Forge-Step: (\S+)/g)].map((match) => match[1] ?? ''),
    )
    .filter((id) => id !== '');
}

/** The subjects of every non-merge commit reachable from the integration branch, minus the seed commit. */
async function laneCommitSubjects(project: Project): Promise<readonly string[]> {
  const log = await git(project.integrationPath, 'log', '--no-merges', '--format=%s');
  return log.split('\n').filter((subject) => subject.startsWith('forge('));
}

// ---------------------------------------------------------------------------------------------------------

describe('a chain inside one merge sees its predecessor before the merge (stacked lanes)', () => {
  const CHAIN: Writes = {
    gen: [{ relativePath: 'tests/a.test.txt', content: 'red\n' }],
    impl: [{ relativePath: 'src/a.txt', content: 'green\n' }],
    review: [{ relativePath: 'docs/review.txt', content: 'ok\n' }],
  };
  const PROBE = ['tests/a.test.txt', 'src/a.txt'];
  const source = workflowOf('st', [
    agent('gen', { produces: ['tests/**'] }),
    agent('impl', { dependsOn: ['gen'], produces: ['src/**'] }),
    agent('review', { dependsOn: ['impl'], produces: ['docs/**'] }),
    mergeStep(['review']),
  ]);

  it('each step starts with the committed output of the step before it, and nothing is integrated until the merge', async () => {
    const project = await createProject('chain');
    const { adapter, seen } = scriptedAdapter(CHAIN, PROBE);

    const state = await runEngine(source, {}, contextFor(project, { adapter }));

    expect(state.runStatus).toBe('completed');
    expect(seen.get('st:gen')).toEqual([]);
    // `impl` sees the tests `gen` wrote (the shipped `generate-tests` -> `implement`), `review` sees both.
    expect(seen.get('st:impl')).toEqual(['tests/a.test.txt']);
    expect(seen.get('st:review')).toEqual(['tests/a.test.txt', 'src/a.txt']);
    // Review-before-merge: every merge event of the run belongs to the one explicit merge step.
    const events = await eventsOf(project);
    const mergeEvents = events.filter((event) => event.type.startsWith('Merge'));
    expect(new Set(mergeEvents.map((event) => event.stepId))).toEqual(new Set(['st:merge']));
    // The base each lane was created from is recorded (what a resumed run rolls it back to).
    const created = events.filter((event) => event.type === 'LaneCreated');
    const payloadOf = (step: string) =>
      created.find((event) => event.stepId === step)?.payload as Record<string, unknown>;
    expect(payloadOf('st:gen')).not.toHaveProperty('stackedOn');
    expect(payloadOf('st:impl')).toMatchObject({ stackedOn: 'st:gen' });
    expect(payloadOf('st:review')).toMatchObject({ stackedOn: 'st:impl' });
    // `PLAN-M14.md` P34: `integrationTip` is recorded on every `LaneCreated`, stacked or not, and never
    // `unstackedPredecessors` (which no longer exists).
    for (const step of ['st:gen', 'st:impl', 'st:review']) {
      expect(payloadOf(step)).toHaveProperty('integrationTip');
      expect(payloadOf(step)).not.toHaveProperty('unstackedPredecessors');
    }
  });

  it('the merge lands the stacked chain in dependency order, every lane cleanly, each commit once, and every lane is gone', async () => {
    const project = await createProject('chain-landing');
    const { adapter } = scriptedAdapter(CHAIN, PROBE);
    const ctx = contextFor(project, { adapter });

    const state = await runEngine(source, {}, ctx);

    expect(state.runStatus).toBe('completed');
    expect(await mergedStepOrder(project)).toEqual(['st:gen', 'st:impl', 'st:review']);
    expect(await filesOnIntegration(project)).toEqual(
      expect.arrayContaining(['tests/a.test.txt', 'src/a.txt', 'docs/review.txt']),
    );
    // No duplicate commit: lane N holds lane N-1's commits, and landing N-1 first made N replay only its own.
    expect(await laneCommitSubjects(project)).toEqual(
      expect.arrayContaining([
        'forge(st): did gen',
        'forge(st): did impl',
        'forge(st): did review',
      ]),
    );
    expect(
      (await laneCommitSubjects(project)).filter((s) => s === 'forge(st): did gen'),
    ).toHaveLength(1);
    const events = await eventsOf(project);
    expect(events.filter((event) => event.type === 'MergeCompleted')).toHaveLength(3);
    expect(events.some((event) => event.type === 'MergeConflict')).toBe(false);
    expect(await git(project.integrationPath, 'status', '--porcelain')).toBe('');
    expect(ctx.laneRegistry.size).toBe(0);
    expect(await git(project.projectRoot, 'worktree', 'list', '--porcelain')).not.toContain(
      `forge/${RUN_ID}/`,
    );
    // The trunk is untouched: only the merge landed anything, and on the integration branch.
    await expect(git(project.projectRoot, 'show', 'main:src/a.txt')).rejects.toThrow();
  });

  it('a stacked step that changed nothing lands nothing: no merge event, no merge commit, even though its branch still holds the (since rewritten) commits of the lane it stacked on', async () => {
    const project = await createProject('chain-noop');
    const { adapter } = scriptedAdapter(
      {
        gen: [{ relativePath: 'tests/a.test.txt', content: 'red\n' }],
        impl: [{ relativePath: 'src/a.txt', content: 'green\n' }],
      },
      [],
    );
    // `check` reads the implementation and changes nothing (a self-verify, a review that found nothing to write).
    const withCheck = workflowOf('nc', [
      agent('gen', { produces: ['tests/**'] }),
      agent('impl', { dependsOn: ['gen'], produces: ['src/**'] }),
      agent('check', { dependsOn: ['impl'] }),
      mergeStep(['check'], '{ conflict: abort, postChecks: "test -f .gitignore" }'),
    ]);

    const state = await runEngine(withCheck, {}, contextFor(project, { adapter }));

    expect(state.runStatus).toBe('completed');
    // The landing of `impl` rebased it onto the merge of `gen`, so its commit is not the one `check` was stacked on.
    const events = await eventsOf(project);
    expect(events.filter((event) => event.type === 'MergeCompleted')).toHaveLength(2);
    // `check` never reached the queue: found integrated up front (its old commits are patch-equivalent to the ones the
    // landing of `impl` wrote), so it has no MergeQueued of its own.
    expect(events.filter((event) => event.type === 'MergeQueued')).toHaveLength(2);
    expect(events.some((event) => event.type === 'MergeReverted')).toBe(false);
    expect(await mergedStepOrder(project)).toEqual(['nc:gen', 'nc:impl']);
    expect(await git(project.integrationPath, 'log', '--merges', '--format=%H')).toMatch(
      /^\S+\n\S+$/,
    );
  });

  it("a stacked no-change lane whose predecessor was rewritten by its own rebase, when the up-front check cannot tell: the queue reports nothing to merge, no merge event, no other lane's merge reverted", async () => {
    const project = await createProject('chain-noop-queue');
    const { adapter } = scriptedAdapter(
      {
        gen: [{ relativePath: 'tests/a.test.txt', content: 'red\n' }],
        impl: [{ relativePath: 'src/a.txt', content: 'green\n' }],
      },
      [],
    );
    const withCheck = workflowOf('nq', [
      agent('gen', { produces: ['tests/**'] }),
      agent('impl', { dependsOn: ['gen'], produces: ['src/**'] }),
      agent('check', { dependsOn: ['impl'] }),
      mergeStep(['check'], '{ conflict: abort, postChecks: "test -f .gitignore" }'),
    ]);
    const base = contextFor(project, { adapter });
    // Blind the up-front `isIntegrated` shortcut: only the merge queue's own rebase can find that nothing is left.
    const ctx: RunEngineContext = {
      ...base,
      mergeQueue: { ...base.mergeQueue, isIntegrated: () => Promise.resolve(false) },
    };

    const state = await runEngine(withCheck, {}, ctx);

    expect(state.runStatus).toBe('completed');
    const events = await eventsOf(project);
    expect(events.filter((event) => event.type === 'MergeCompleted')).toHaveLength(2);
    expect(events.some((event) => event.type === 'MergeReverted')).toBe(false);
    expect(await git(project.integrationPath, 'log', '--merges', '--format=%H')).toMatch(
      /^\S+\n\S+$/,
    );
    expect(ctx.laneRegistry.size).toBe(0);
  });

  it('a step in the middle of a chain that changed nothing does not stop the steps built on it from landing', async () => {
    const project = await createProject('chain-noop-middle');
    const { adapter, seen } = scriptedAdapter(
      {
        gen: [{ relativePath: 'tests/a.test.txt', content: 'red\n' }],
        impl: [{ relativePath: 'src/a.txt', content: 'green\n' }],
      },
      ['tests/a.test.txt'],
    );
    // `check` (a self-verify in the shipped `implement-story`) changes nothing, and `impl` builds on it.
    const withCheck = workflowOf('nm', [
      agent('gen', { produces: ['tests/**'] }),
      agent('check', { dependsOn: ['gen'] }),
      agent('impl', { dependsOn: ['check'], produces: ['src/**'] }),
      mergeStep(['impl']),
    ]);

    const state = await runEngine(withCheck, {}, contextFor(project, { adapter }));

    expect(state.runStatus).toBe('completed');
    // The lane of the step that did nothing is stacked on `gen` and `impl` on it: it still sees the tests.
    expect(seen.get('nm:impl')).toEqual(['tests/a.test.txt']);
    expect(await mergedStepOrder(project)).toEqual(['nm:gen', 'nm:impl']);
    expect(await filesOnIntegration(project)).toEqual(
      expect.arrayContaining(['tests/a.test.txt', 'src/a.txt']),
    );
  });

  it('two independent chains landing one after the other (the second is rebased over the first): still clean, every file, each commit once', async () => {
    const project = await createProject('two-chains');
    const writes: Writes = {
      gen1: [{ relativePath: 'tests/one.txt', content: 'r1\n' }],
      impl1: [{ relativePath: 'src/one.txt', content: 'g1\n' }],
      gen2: [{ relativePath: 'tests/two.txt', content: 'r2\n' }],
      impl2: [{ relativePath: 'src/two.txt', content: 'g2\n' }],
    };
    const { adapter, seen } = scriptedAdapter(writes, ['tests/one.txt', 'src/one.txt']);
    const two = workflowOf('tc', [
      agent('gen1', { produces: ['tests/one.txt'] }),
      agent('impl1', { dependsOn: ['gen1'], produces: ['src/one.txt'] }),
      agent('gen2', { produces: ['tests/two.txt'] }),
      agent('impl2', { dependsOn: ['gen2'], produces: ['src/two.txt'] }),
      mergeStep(['impl1', 'impl2']),
    ]);

    const state = await runEngine(two, {}, contextFor(project, { adapter }));

    expect(state.runStatus).toBe('completed');
    // The chains are independent: neither sees the other's files.
    expect(seen.get('tc:impl2')).toEqual([]);
    expect(await mergedStepOrder(project)).toEqual(['tc:gen1', 'tc:impl1', 'tc:gen2', 'tc:impl2']);
    expect(await filesOnIntegration(project)).toEqual(
      expect.arrayContaining(['tests/one.txt', 'src/one.txt', 'tests/two.txt', 'src/two.txt']),
    );
    const subjects = await laneCommitSubjects(project);
    for (const step of ['gen1', 'impl1', 'gen2', 'impl2']) {
      expect(subjects.filter((s) => s === `forge(tc): did ${step}`)).toHaveLength(1);
    }
    expect((await eventsOf(project)).some((event) => event.type === 'MergeConflict')).toBe(false);
  });

  it("a dependent story's chain sees its dependency story's code (the last step of one chain stacks the first of the next)", async () => {
    const project = await createProject('story-dep');
    const writes: Writes = {
      gen1: [{ relativePath: 'tests/one.txt', content: 'r1\n' }],
      impl1: [{ relativePath: 'src/one.txt', content: 'g1\n' }],
      gen2: [{ relativePath: 'tests/two.txt', content: 'r2\n' }],
      impl2: [{ relativePath: 'src/two.txt', content: 'g2\n' }],
    };
    const { adapter, seen } = scriptedAdapter(writes, ['tests/one.txt', 'src/one.txt']);
    const dependent = workflowOf('sd', [
      agent('gen1', { produces: ['tests/one.txt'] }),
      agent('impl1', { dependsOn: ['gen1'], produces: ['src/one.txt'] }),
      // Story two starts after story one's last step, as `stage-plan` wires a story dependency.
      agent('gen2', { dependsOn: ['impl1'], produces: ['tests/two.txt'] }),
      agent('impl2', { dependsOn: ['gen2'], produces: ['src/two.txt'] }),
      mergeStep(['impl2']),
    ]);

    const state = await runEngine(dependent, {}, contextFor(project, { adapter }));

    expect(state.runStatus).toBe('completed');
    expect(seen.get('sd:gen2')).toEqual(['tests/one.txt', 'src/one.txt']);
    expect(seen.get('sd:impl2')).toEqual(['tests/one.txt', 'src/one.txt']);
    expect(await mergedStepOrder(project)).toEqual(['sd:gen1', 'sd:impl1', 'sd:gen2', 'sd:impl2']);
    expect(await filesOnIntegration(project)).toEqual(
      expect.arrayContaining(['tests/one.txt', 'src/one.txt', 'tests/two.txt', 'src/two.txt']),
    );
  });
});

describe('which predecessor a lane stacks on', () => {
  it('a step that depends on a lane the engine integrated (no merge lands it) branches from the integration tip, not from a lane', async () => {
    const project = await createProject('integrated-pred');
    const { adapter, seen } = scriptedAdapter(
      {
        design: [{ relativePath: 'contract.txt', content: 'c\n' }],
        build: [{ relativePath: 'build.txt', content: 'b\n' }],
      },
      ['contract.txt'],
    );
    const source = workflowOf('ip', [
      agent('design', { produces: ['contract.txt'] }),
      agent('build', { dependsOn: ['design'], produces: ['build.txt'] }),
    ]);

    await runEngine(source, {}, contextFor(project, { adapter }));

    expect(seen.get('ip:build')).toEqual(['contract.txt']);
    const created = (await eventsOf(project)).find(
      (event) => event.type === 'LaneCreated' && event.stepId === 'ip:build',
    );
    expect(created?.payload).not.toHaveProperty('stackedOn');
  });

  it('PLAN-M14.md P34: a join of two unmerged lanes that do not contain each other is built on an in-lane merge of both, not just the tip; both still land', async () => {
    const project = await createProject('join');
    const { adapter, seen } = scriptedAdapter(
      {
        x: [{ relativePath: 'x.txt', content: 'x\n' }],
        y: [{ relativePath: 'y.txt', content: 'y\n' }],
        c: [{ relativePath: 'c.txt', content: 'c\n' }],
      },
      ['x.txt', 'y.txt'],
    );
    const source = workflowOf('jn', [
      agent('x', { produces: ['x.txt'] }),
      agent('y', { produces: ['y.txt'] }),
      agent('c', { dependsOn: ['x', 'y'], produces: ['c.txt'] }),
      mergeStep(['c']),
    ]);

    const state = await runEngine(source, {}, contextFor(project, { adapter }));

    expect(state.runStatus).toBe('completed');
    // The in-lane join: c's session sees BOTH x.txt and y.txt, not neither.
    expect(seen.get('jn:c')).toEqual(['x.txt', 'y.txt']);
    const created = (await eventsOf(project)).find(
      (event) => event.type === 'LaneCreated' && event.stepId === 'jn:c',
    );
    expect(created?.payload).toMatchObject({ joinedFrom: ['jn:x', 'jn:y'] });
    expect(created?.payload).not.toHaveProperty('stackedOn');
    expect(created?.payload).not.toHaveProperty('unstackedPredecessors');
    expect(created?.payload).toHaveProperty('integrationTip');
    expect(created?.payload).toHaveProperty('baseSha');
    expect(await mergedStepOrder(project)).toEqual(['jn:x', 'jn:y', 'jn:c']);
    expect(await filesOnIntegration(project)).toEqual(
      expect.arrayContaining(['x.txt', 'y.txt', 'c.txt']),
    );
  });

  it('a three-way join: every unmerged, same-scope predecessor is joined, all in plan order', async () => {
    const project = await createProject('join-three');
    const { adapter, seen } = scriptedAdapter(
      {
        x: [{ relativePath: 'x.txt', content: 'x\n' }],
        y: [{ relativePath: 'y.txt', content: 'y\n' }],
        z: [{ relativePath: 'z.txt', content: 'z\n' }],
        c: [{ relativePath: 'c.txt', content: 'c\n' }],
      },
      ['x.txt', 'y.txt', 'z.txt'],
    );
    const source = workflowOf('tw', [
      agent('x', { produces: ['x.txt'] }),
      agent('y', { produces: ['y.txt'] }),
      agent('z', { produces: ['z.txt'] }),
      agent('c', { dependsOn: ['x', 'y', 'z'], produces: ['c.txt'] }),
      mergeStep(['c']),
    ]);

    const state = await runEngine(source, {}, contextFor(project, { adapter }));

    expect(state.runStatus).toBe('completed');
    expect(seen.get('tw:c')).toEqual(['x.txt', 'y.txt', 'z.txt']);
    const created = (await eventsOf(project)).find(
      (event) => event.type === 'LaneCreated' && event.stepId === 'tw:c',
    );
    expect(created?.payload).toMatchObject({ joinedFrom: ['tw:x', 'tw:y', 'tw:z'] });
    expect(created?.payload).not.toHaveProperty('stackedOn');
    expect(await filesOnIntegration(project)).toEqual(
      expect.arrayContaining(['x.txt', 'y.txt', 'z.txt', 'c.txt']),
    );
  });

  it("dependsOn: ['y', 'x'] still joins in plan order (x is declared first): joinedFrom is ['ro:x', 'ro:y'], never dependsOn's own order", async () => {
    const project = await createProject('join-reversed');
    const { adapter, seen } = scriptedAdapter(
      {
        x: [{ relativePath: 'x.txt', content: 'x\n' }],
        y: [{ relativePath: 'y.txt', content: 'y\n' }],
        c: [{ relativePath: 'c.txt', content: 'c\n' }],
      },
      ['x.txt', 'y.txt'],
    );
    const source = workflowOf('ro', [
      agent('x', { produces: ['x.txt'] }),
      agent('y', { produces: ['y.txt'] }),
      agent('c', { dependsOn: ['y', 'x'], produces: ['c.txt'] }),
      mergeStep(['c']),
    ]);

    const state = await runEngine(source, {}, contextFor(project, { adapter }));

    expect(state.runStatus).toBe('completed');
    expect(seen.get('ro:c')).toEqual(['x.txt', 'y.txt']);
    const created = (await eventsOf(project)).find(
      (event) => event.type === 'LaneCreated' && event.stepId === 'ro:c',
    );
    expect(created?.payload).toMatchObject({ joinedFrom: ['ro:x', 'ro:y'] });
  });

  it("Q226 (e): a chain a -> b sees what the engine integrated of an unrelated step between a's lane and b's own (the tip moved): b sees both, joinedFrom (not stackedOn, since the join is no longer a fast-forward)", async () => {
    const project = await createProject('join-moved-tip');
    const { adapter, seen } = scriptedAdapter(
      {
        a: [{ relativePath: 'a.txt', content: 'a\n' }],
        x: [{ relativePath: 'x.txt', content: 'x\n' }],
        b: [{ relativePath: 'b.txt', content: 'b\n' }],
      },
      ['a.txt', 'x.txt'],
    );
    // `x` has no dependency on `a`/`b`, no merge lands it, so the engine auto-integrates it as soon as it
    // succeeds -- between the tick `a` and `x` finish in and the tick `b` starts in, moving the tip.
    const source = workflowOf('me', [
      agent('a', { produces: ['a.txt'] }),
      agent('x', { produces: ['x.txt'] }),
      agent('b', { dependsOn: ['a'], produces: ['b.txt'] }),
      mergeStep(['b']),
    ]);

    const state = await runEngine(source, {}, contextFor(project, { adapter }));

    expect(state.runStatus).toBe('completed');
    // `b` sees the engine-integrated `x.txt` (via the moved tip) AND `a.txt` (via the join).
    expect(seen.get('me:b')).toEqual(expect.arrayContaining(['a.txt', 'x.txt']));
    const created = (await eventsOf(project)).find(
      (event) => event.type === 'LaneCreated' && event.stepId === 'me:b',
    );
    expect(created?.payload).toMatchObject({ joinedFrom: ['me:a'] });
    expect(created?.payload).not.toHaveProperty('stackedOn');
    // `x` lands via the engine's own automatic integration (a real merge commit of its own, tagged the
    // identical way), before `a`/`b` ever reach the explicit merge step.
    expect(await mergedStepOrder(project)).toEqual(['me:x', 'me:a', 'me:b']);
    expect(await filesOnIntegration(project)).toEqual(
      expect.arrayContaining(['a.txt', 'x.txt', 'b.txt']),
    );
  });

  it('different scopes are not joined: a predecessor sharing no merge scope with the step is never offered to the join', async () => {
    const project = await createProject('join-different-scopes');
    const { adapter, seen } = scriptedAdapter(
      {
        p: [{ relativePath: 'p.txt', content: 'p\n' }],
        q: [{ relativePath: 'q.txt', content: 'q\n' }],
        r: [{ relativePath: 'r.txt', content: 'r\n' }],
        s: [{ relativePath: 's.txt', content: 's\n' }],
      },
      ['p.txt', 'r.txt'],
    );
    // `s` depends on `q` (its own merge's scope) and `r` (a DIFFERENT merge's scope): only `q` is a real
    // join candidate. `r`'s own lane is landed by its own merge before `s` ever starts, so `s` sees it via
    // the tip regardless -- the join itself must not also try to merge `r`'s (already-landed, gone) lane.
    const source = workflowOf('ds', [
      agent('p', { produces: ['p.txt'] }),
      mergeStep(['p'], '{ conflict: abort }', 'merge-p'),
      agent('r', { dependsOn: ['merge-p'], produces: ['r.txt'] }),
      mergeStep(['r'], '{ conflict: abort }', 'merge-r'),
      agent('q', { dependsOn: ['merge-r'], produces: ['q.txt'] }),
      agent('s', { dependsOn: ['q', 'r'], produces: ['s.txt'] }),
      mergeStep(['s'], '{ conflict: abort }', 'merge-s'),
    ]);

    const state = await runEngine(source, {}, contextFor(project, { adapter }));

    expect(state.runStatus).toBe('completed');
    expect(seen.get('ds:s')).toEqual(['p.txt', 'r.txt']);
    const created = (await eventsOf(project)).find(
      (event) => event.type === 'LaneCreated' && event.stepId === 'ds:s',
    );
    expect(created?.payload).toMatchObject({ stackedOn: 'ds:q' });
  });

  // `x`/`y` each declare a distinct `produces` glob that both happen to cover `shared.txt` --
  // `share[ad].txt`/`share[bd].txt` (both match the literal path; neither string is `===` the other, and
  // neither is a literal match of the other's pattern, `dependencies.ts`'s own `globsOverlap` two real,
  // deliberately-limited checks) -- so the compiler's own claim-overlap serialisation (`06` §6.2 rule 3)
  // does NOT add an implicit `dependsOn` edge between them (confirmed the hard way: an identical literal
  // `produces: ['shared.txt']` on both DOES get such an edge, which stacks `y` on `x` before `c` ever sees
  // either, and the join this describe block is about never triggers at all). `x`/`y` genuinely run
  // independently and both really do write the same real path, so joining their heads into `c`'s own new
  // lane genuinely conflicts.
  const CONFLICTING_HEADS = workflowOf('cf', [
    agent('x', { produces: ['share[ad].txt'] }),
    agent('y', { produces: ['share[bd].txt'] }),
    agent('c', { dependsOn: ['x', 'y'], produces: ['c.txt'] }),
    mergeStep(['c']),
  ]);
  // The identical fixture, but the merge step's own LANDING conflict policy is also `agent`: `x` and `y`
  // conflict with each other at landing too (the same real diffs, met again once each is rebased onto the
  // other's already-landed content) -- a genuinely distinct conflict from the join's own, resolved by its
  // own (landing) resolver, never the join's.
  const CONFLICTING_HEADS_AGENT_LANDING = workflowOf('cf', [
    agent('x', { produces: ['share[ad].txt'] }),
    agent('y', { produces: ['share[bd].txt'] }),
    agent('c', { dependsOn: ['x', 'y'], produces: ['c.txt'] }),
    mergeStep(['c'], '{ conflict: agent }'),
  ]);

  it('conflicting heads under the abort policy: LANE-JOIN-CONFLICT, no session, no LaneCreated, no worktree or branch left for the joining step, x and y untouched, classified conflict', async () => {
    const project = await createProject('join-conflict-abort');
    const { adapter, seen } = scriptedAdapter(
      {
        x: [{ relativePath: 'shared.txt', content: 'x-version\n' }],
        y: [{ relativePath: 'shared.txt', content: 'y-version\n' }],
      },
      [],
    );

    const state = await runEngine(CONFLICTING_HEADS, {}, contextFor(project, { adapter }));

    expect(state.runStatus).toBe('failed');
    expect(seen.has('cf:c')).toBe(false);
    const events = await eventsOf(project);
    expect(events.some((event) => event.type === 'LaneCreated' && event.stepId === 'cf:c')).toBe(
      false,
    );
    const failure = events.find((event) => event.type === 'StepFailed' && event.stepId === 'cf:c')
      ?.payload as { code?: string; message?: string } | undefined;
    expect(failure?.code).toBe('LANE-JOIN-CONFLICT');
    expect(failure?.message).toContain('shared.txt');
    // `LANE-JOIN-CONFLICT` classifies as `conflict` -- `classify.test.ts`'s own dedicated unit test pins
    // the mapping directly; here only the code itself (what that mapping keys off) is asserted.
    // No worktree or branch was left behind for the joining step -- only x's and y's own.
    const worktrees = await git(project.projectRoot, 'worktree', 'list', '--porcelain');
    expect(worktrees).not.toContain(`forge/${RUN_ID}/c-`);
    const branches = await git(project.projectRoot, 'branch', '--list', `forge/${RUN_ID}/c-*`);
    expect(branches.trim()).toBe('');
    // x and y's own lanes are untouched: still registered, no LaneAbandoned/LaneRemoved for either.
    expect(
      events.some(
        (event) =>
          (event.type === 'LaneAbandoned' || event.type === 'LaneRemoved') &&
          (event.stepId === 'cf:x' || event.stepId === 'cf:y'),
      ),
    ).toBe(false);
  });

  it('under the agent policy with no resolver: VCS-MISSING-CONFLICT-RESOLVER; with a fake resolver: a trailer-carrying join commit and the step proceeds', async () => {
    const noResolverProject = await createProject('join-conflict-agent-no-resolver');
    const noResolverAdapter = scriptedAdapter(
      {
        x: [{ relativePath: 'shared.txt', content: 'x-version\n' }],
        y: [{ relativePath: 'shared.txt', content: 'y-version\n' }],
      },
      [],
    ).adapter;

    const stateNoResolver = await runEngine(
      CONFLICTING_HEADS,
      {},
      contextFor(noResolverProject, { adapter: noResolverAdapter, joinConflictPolicy: 'agent' }),
    );

    expect(stateNoResolver.runStatus).toBe('failed');
    const noResolverFailure = (await eventsOf(noResolverProject)).find(
      (event) => event.type === 'StepFailed' && event.stepId === 'cf:c',
    )?.payload as { code?: string } | undefined;
    expect(noResolverFailure?.code).toBe('VCS-MISSING-CONFLICT-RESOLVER');

    const resolvedProject = await createProject('join-conflict-agent-resolved');
    const { adapter, seen } = scriptedAdapter(
      {
        x: [{ relativePath: 'shared.txt', content: 'x-version\n' }],
        y: [{ relativePath: 'shared.txt', content: 'y-version\n' }],
        c: [{ relativePath: 'c.txt', content: 'c\n' }],
      },
      ['shared.txt'],
    );
    const resolverCalls: string[][] = [];
    const resolveToVersion = async (conflict: {
      readonly conflictedFiles: readonly { readonly path: string }[];
      readonly worktreePath: string;
    }): Promise<'resolved'> => {
      resolverCalls.push(conflict.conflictedFiles.map((f) => f.path));
      await writeFile(path.join(conflict.worktreePath, 'shared.txt'), 'resolved-version\n');
      return 'resolved';
    };
    const state = await runEngine(
      CONFLICTING_HEADS_AGENT_LANDING,
      {},
      contextFor(resolvedProject, {
        adapter,
        joinConflictPolicy: 'agent',
        joinConflictResolver: resolveToVersion,
        landingConflictResolver: resolveToVersion,
      }),
    );

    expect(state.runStatus).toBe('completed');
    // The join's own resolver is called once (for c's own lane); the landing's own resolver separately
    // for whichever of x/y's own lanes conflicts when landed after the other -- both real, both counted.
    expect(resolverCalls.length).toBeGreaterThanOrEqual(1);
    expect(resolverCalls).toContainEqual(['shared.txt']);
    const created = (await eventsOf(resolvedProject)).find(
      (event) => event.type === 'LaneCreated' && event.stepId === 'cf:c',
    );
    expect(created?.payload).toMatchObject({ joinedFrom: ['cf:x', 'cf:y'] });
    expect(seen.get('cf:c')).toEqual(['shared.txt']);
    expect(await filesOnIntegration(resolvedProject)).toContain('c.txt');
    await expect(
      readFile(path.join(resolvedProject.integrationPath, 'shared.txt'), 'utf8'),
    ).resolves.toBe('resolved-version\n');
  });

  it('a strict claim on the joining step reverts nothing that the join itself brought in', async () => {
    const project = await createProject('join-claim');
    const { adapter, seen } = scriptedAdapter(
      {
        x: [{ relativePath: 'x.txt', content: 'x\n' }],
        y: [{ relativePath: 'y.txt', content: 'y\n' }],
        c: [{ relativePath: 'c.txt', content: 'c\n' }],
      },
      ['x.txt', 'y.txt'],
    );
    const source = workflowOf('sc', [
      agent('x', { produces: ['x.txt'] }),
      agent('y', { produces: ['y.txt'] }),
      agent('c', { dependsOn: ['x', 'y'], produces: ['c.txt'] }),
      mergeStep(['c']),
    ]);

    const state = await runEngine(source, {}, contextFor(project, { adapter }));

    expect(state.runStatus).toBe('completed');
    expect(seen.get('sc:c')).toEqual(['x.txt', 'y.txt']);
    const events = await eventsOf(project);
    expect(events.some((event) => event.type === 'PolicyViolation')).toBe(false);
    expect(await filesOnIntegration(project)).toEqual(
      expect.arrayContaining(['x.txt', 'y.txt', 'c.txt']),
    );
  });

  it('a predecessor that another predecessor already contains adds nothing: the step stacks on the outermost lane and sees both', async () => {
    const project = await createProject('diamond');
    const { adapter, seen } = scriptedAdapter(
      {
        a: [{ relativePath: 'a.txt', content: 'a\n' }],
        b: [{ relativePath: 'b.txt', content: 'b\n' }],
        c: [{ relativePath: 'c.txt', content: 'c\n' }],
      },
      ['a.txt', 'b.txt'],
    );
    const source = workflowOf('dm', [
      agent('a', { produces: ['a.txt'] }),
      agent('b', { dependsOn: ['a'], produces: ['b.txt'] }),
      agent('c', { dependsOn: ['a', 'b'], produces: ['c.txt'] }),
      mergeStep(['c']),
    ]);

    const state = await runEngine(source, {}, contextFor(project, { adapter }));

    expect(state.runStatus).toBe('completed');
    expect(seen.get('dm:c')).toEqual(['a.txt', 'b.txt']);
    const created = (await eventsOf(project)).find(
      (event) => event.type === 'LaneCreated' && event.stepId === 'dm:c',
    );
    expect(created?.payload).toMatchObject({ stackedOn: 'dm:b' });
    expect(await mergedStepOrder(project)).toEqual(['dm:a', 'dm:b', 'dm:c']);
  });

  it("a predecessor in another merge's scope only is not stacked on (the lanes are not landed together)", async () => {
    const project = await createProject('other-scope');
    const { adapter, seen } = scriptedAdapter(
      {
        p: [{ relativePath: 'p.txt', content: 'p\n' }],
        q: [{ relativePath: 'q.txt', content: 'q\n' }],
      },
      ['p.txt'],
    );
    // `q` depends on `p`, but only `p` is under the first merge; `q` is under the second, which depends on the first
    // (a merge is a checkpoint): `p` is landed before `q` starts, so `q` branches from a tip that holds it.
    const source = workflowOf('os', [
      agent('p', { produces: ['p.txt'] }),
      mergeStep(['p'], '{ conflict: abort }', 'merge-p'),
      agent('q', { dependsOn: ['merge-p'], produces: ['q.txt'] }),
      mergeStep(['q'], '{ conflict: abort }', 'merge-q'),
    ]);

    const state = await runEngine(source, {}, contextFor(project, { adapter }));

    expect(state.runStatus).toBe('completed');
    expect(seen.get('os:q')).toEqual(['p.txt']);
    expect(await mergedStepOrder(project)).toEqual(['os:p', 'os:q']);
  });
});

describe('a failure anywhere in a stacked chain', () => {
  it('a failed predecessor: its dependents never start, nothing is landed, its lane is kept', async () => {
    const project = await createProject('failed-pred');
    const { adapter, seen } = scriptedAdapter(
      { impl: [{ relativePath: 'src/a.txt', content: 'x\n' }] },
      [],
      {
        gen: {
          text: ['half done'],
          writeFiles: [{ relativePath: 'tests/a.txt', content: 'x\n' }],
          endReason: 'error',
          errorInfo: { code: 'X', message: 'boom' },
        },
      },
    );
    const source = workflowOf('fp', [
      agent('gen', { produces: ['tests/**'] }),
      agent('impl', { dependsOn: ['gen'], produces: ['src/**'] }),
      mergeStep(['impl']),
    ]);
    const ctx = contextFor(project, { adapter });

    const state = await runEngine(source, {}, ctx);

    expect(state.runStatus).toBe('failed');
    expect(seen.has('fp:impl')).toBe(false);
    expect(await mergedStepOrder(project)).toEqual([]);
    expect(await filesOnIntegration(project)).not.toContain('tests/a.txt');
  });

  it('a post-merge check that fails on a middle lane reverts it, and the lane stacked on it is not landed', async () => {
    const project = await createProject('post-fails');
    const { adapter } = scriptedAdapter(
      {
        gen: [{ relativePath: 'tests/a.txt', content: 'r\n' }],
        impl: [{ relativePath: 'src/a.txt', content: 'g\n' }],
        review: [{ relativePath: 'docs/r.txt', content: 'ok\n' }],
      },
      [],
    );
    const source = workflowOf('pf', [
      agent('gen', { produces: ['tests/**'] }),
      agent('impl', { dependsOn: ['gen'], produces: ['src/**'] }),
      agent('review', { dependsOn: ['impl'], produces: ['docs/**'] }),
      mergeStep(['review'], '{ conflict: abort, postChecks: "test ! -f src/a.txt" }'),
    ]);

    const ctx = contextFor(project, { adapter });
    const state = await runEngine(source, {}, ctx);

    expect(state.runStatus).toBe('failed');
    // The reverted lane is an ancestor of the integration branch, but it is not "integrated": its content is not there.
    const reverted = ctx.laneRegistry.get('pf:impl');
    expect(reverted).toBeDefined();
    if (reverted !== undefined) expect(await ctx.mergeQueue.isIntegrated?.(reverted)).toBe(false);
    const files = await filesOnIntegration(project);
    // `gen` landed; `impl` landed and was reverted by its failing post-check; `review` was not landed.
    expect(files).toContain('tests/a.txt');
    expect(files).not.toContain('src/a.txt');
    expect(files).not.toContain('docs/r.txt');
    const events = await eventsOf(project);
    expect(events.filter((event) => event.type === 'MergeReverted')).toHaveLength(1);
    const failure = events.find(
      (event) => event.type === 'StepFailed' && event.stepId === 'pf:merge',
    )?.payload as { code?: string } | undefined;
    expect(failure?.code).toBe('MERGE-POST-CHECK-FAILED');
    expect(await git(project.integrationPath, 'status', '--porcelain')).toBe('');
  });
});

// ---------------------------------------------------------------------------------------------------------

/** A test command (a `node -e` one-liner, cheap and deterministic) that records the directory it ran in and then
 * exits with `exitCode`. The marker path is embedded, so nothing depends on the environment. */
function recordingCommand(marker: string, label: string, exitCode = 0): string {
  return `node -e 'require("fs").appendFileSync(${JSON.stringify(marker)}, "${label} " + process.cwd() + "\\n"); process.exit(${String(exitCode)})'`;
}

async function markerLines(marker: string): Promise<readonly string[]> {
  return existsSync(marker)
    ? (await readFile(marker, 'utf8')).split('\n').filter((line) => line !== '')
    : [];
}

describe("a merge policy runs its named check sets as the project's configured test commands", () => {
  const CHAIN: Writes = {
    gen: [{ relativePath: 'tests/a.txt', content: 'r\n' }],
    impl: [{ relativePath: 'src/a.txt', content: 'g\n' }],
  };
  const source = workflowOf('mc', [
    agent('gen', { produces: ['tests/**'] }),
    agent('impl', { dependsOn: ['gen'], produces: ['src/**'] }),
    mergeStep(['impl'], '{ conflict: abort, preChecks: fast, postChecks: full }'),
  ]);

  it('fast runs before each lane lands (in the lane worktree), full after (in the integration worktree), and the merge lands', async () => {
    const project = await createProject('checks-pass');
    const marker = path.join(project.projectRoot, '.forge', 'state', 'marker.txt');
    const { adapter } = scriptedAdapter(CHAIN, []);
    const ctx = contextFor(project, {
      adapter,
      testCommands: {
        typecheck: recordingCommand(marker, 'typecheck'),
        lint: recordingCommand(marker, 'lint'),
        unit: recordingCommand(marker, 'unit'),
        integration: recordingCommand(marker, 'integration'),
        contract: recordingCommand(marker, 'contract'),
        e2e: recordingCommand(marker, 'e2e'),
      },
    });

    const state = await runEngine(source, {}, ctx);

    expect(state.runStatus).toBe('completed');
    const lines = await markerLines(marker);
    const layersRun = (dir: (cwd: string) => boolean) =>
      lines
        .filter((line) => dir(line.slice(line.indexOf(' ') + 1)))
        .map((line) => line.split(' ')[0]);
    const inIntegration = (cwd: string) => cwd.endsWith(path.join('worktrees', 'integration'));
    // Two lanes land: each has the fast set before its merge and the full set after it.
    expect(layersRun((cwd) => !inIntegration(cwd))).toEqual([
      'typecheck',
      'lint',
      'unit',
      'typecheck',
      'lint',
      'unit',
    ]);
    expect(layersRun(inIntegration)).toEqual([
      'typecheck',
      'lint',
      'unit',
      'integration',
      'contract',
      'typecheck',
      'lint',
      'unit',
      'integration',
      'contract',
    ]);
    // e2e is not part of either set (it needs a deployed environment).
    expect(lines.some((line) => line.startsWith('e2e '))).toBe(false);
    // The run says which checks ran (labels, never the commands).
    const started = (await eventsOf(project)).find((event) => event.type === 'MergeStarted');
    expect(started?.payload).toMatchObject({
      preChecks: [
        'execution.testCommands.typecheck',
        'execution.testCommands.lint',
        'execution.testCommands.unit',
      ],
    });
    expect(JSON.stringify(started?.payload)).not.toContain('node -e');
  });

  it('a layer of the set with no command is reported as skipped on MergeStarted, not silently passed', async () => {
    const project = await createProject('checks-skipped');
    const marker = path.join(project.projectRoot, '.forge', 'state', 'marker.txt');
    const { adapter } = scriptedAdapter(CHAIN, []);

    const state = await runEngine(
      source,
      {},
      contextFor(project, { adapter, testCommands: { unit: recordingCommand(marker, 'unit') } }),
    );

    expect(state.runStatus).toBe('completed');
    const started = (await eventsOf(project)).find((event) => event.type === 'MergeStarted');
    expect(started?.payload).toMatchObject({
      skippedLayers: {
        pre: ['typecheck', 'lint'],
        post: ['typecheck', 'lint', 'integration', 'contract'],
      },
    });
  });

  it('a failing pre-check blocks the landing with the typed reason, names the config key, and keeps the lane', async () => {
    const project = await createProject('pre-fails');
    const marker = path.join(project.projectRoot, '.forge', 'state', 'marker.txt');
    const { adapter } = scriptedAdapter(CHAIN, []);
    const ctx = contextFor(project, {
      adapter,
      testCommands: { unit: recordingCommand(marker, 'unit', 1) },
    });

    const state = await runEngine(source, {}, ctx);

    expect(state.runStatus).toBe('failed');
    expect(await filesOnIntegration(project)).not.toContain('tests/a.txt');
    expect(await mergedStepOrder(project)).toEqual([]);
    const failure = (await eventsOf(project)).find(
      (event) => event.type === 'StepFailed' && event.stepId === 'mc:merge',
    )?.payload as { code?: string; message?: string } | undefined;
    expect(failure?.code).toBe('MERGE-PRE-CHECK-FAILED');
    expect(failure?.message).toContain('execution.testCommands.unit');
    expect(failure?.message).toContain('exited 1');
    expect(failure?.message).not.toContain('command not found');
    // The lane is kept for inspection (and the tree is clean).
    expect(await git(project.integrationPath, 'status', '--porcelain')).toBe('');
    expect(ctx.laneRegistry.has('mc:gen')).toBe(true);
  });

  it('a failing post-check reverts the merge: the tree is back to before it, the step fails MERGE-POST-CHECK-FAILED', async () => {
    const project = await createProject('post-fails');
    const marker = path.join(project.projectRoot, '.forge', 'state', 'marker.txt');
    const { adapter } = scriptedAdapter(CHAIN, []);
    // `integration` is only in the post set: it fails once the first lane is in the integration branch.
    const ctx = contextFor(project, {
      adapter,
      testCommands: {
        unit: recordingCommand(marker, 'unit'),
        integration: recordingCommand(marker, 'integration', 1),
      },
    });

    const state = await runEngine(source, {}, ctx);

    expect(state.runStatus).toBe('failed');
    expect(await filesOnIntegration(project)).not.toContain('tests/a.txt');
    const events = await eventsOf(project);
    expect(events.filter((event) => event.type === 'MergeReverted')).toHaveLength(1);
    const failure = events.find(
      (event) => event.type === 'StepFailed' && event.stepId === 'mc:merge',
    )?.payload as { code?: string; message?: string } | undefined;
    expect(failure?.code).toBe('MERGE-POST-CHECK-FAILED');
    expect(failure?.message).toContain('execution.testCommands.integration');
  });

  it('a set with no configured layer is a typed refusal that names the keys, BEFORE anything is dispatched (no story lane is built and paid for): never "command not found"', async () => {
    const project = await createProject('unconfigured');
    const { adapter, seen } = scriptedAdapter(CHAIN, []);
    const ctx = contextFor(project, { adapter, testCommands: {} });

    const state = await runEngine(source, {}, ctx);

    expect(state.runStatus).toBe('failed');
    const events = await eventsOf(project);
    const failure = events.find((event) => event.type === 'RunFailed')?.payload as
      { reason?: string; message?: string } | undefined;
    expect(failure?.reason).toBe('setup');
    expect(failure?.message).toContain('execution.testCommands.unit');
    expect(failure?.message).toContain('"fast"');
    expect(failure?.message).toContain('mc:merge');
    expect(failure?.message).not.toContain('command not found');
    // Nothing ran: no session, no lane, no merge event.
    expect(seen.size).toBe(0);
    expect(
      events.filter((event) => event.type === 'LaneCreated' || event.type.startsWith('Merge')),
    ).toEqual([]);
    expect(ctx.laneRegistry.size).toBe(0);
  });

  it('a check that outlives its limit is killed and FAILS the landing (a hung test command cannot hang the run or pass by being abandoned)', async () => {
    const project = await createProject('check-timeout');
    const { adapter } = scriptedAdapter(CHAIN, []);
    const hung = workflowOf('ht', [
      agent('gen', { produces: ['tests/**'] }),
      mergeStep(['gen'], '{ conflict: abort, preChecks: unit }'),
    ]);
    const started = Date.now();

    const state = await runEngine(
      hung,
      {},
      contextFor(project, {
        adapter,
        testCommands: { unit: 'sleep 30' },
        checkLimits: { timeoutMs: 400 },
      }),
    );

    expect(state.runStatus).toBe('failed');
    expect(Date.now() - started).toBeLessThan(15_000);
    const failure = (await eventsOf(project)).find(
      (event) => event.type === 'StepFailed' && event.stepId === 'ht:merge',
    )?.payload as { code?: string; message?: string } | undefined;
    expect(failure?.code).toBe('MERGE-PRE-CHECK-FAILED');
    expect(failure?.message).toContain('execution.testCommands.unit');
    expect(failure?.message).toContain('did not finish within 400ms');
    expect(await filesOnIntegration(project)).not.toContain('tests/a.txt');
  });

  it('a literal shell command in a policy is still a shell command (the pre-P38 meaning), with the same limits and env', async () => {
    const project = await createProject('literal');
    const { adapter } = scriptedAdapter(CHAIN, []);
    const literal = workflowOf('lt', [
      agent('gen', { produces: ['tests/**'] }),
      mergeStep(['gen'], '{ conflict: abort, preChecks: "test -f tests/a.txt" }'),
    ]);

    const state = await runEngine(literal, {}, contextFor(project, { adapter }));

    expect(state.runStatus).toBe('completed');
    expect(await filesOnIntegration(project)).toContain('tests/a.txt');
  });
});

describe("a lane the engine integrates (no merge lands it) has the run's configured check set", () => {
  const chain = workflowOf('au', [
    agent('a', { produces: ['a.txt'] }),
    agent('b', { dependsOn: ['a'], produces: ['b.txt'] }),
  ]);
  const WRITES: Writes = {
    a: [{ relativePath: 'a.txt', content: 'a\n' }],
    b: [{ relativePath: 'b.txt', content: 'b\n' }],
  };

  it('with execution.mergeChecks set, each lane is checked before (in its lane) and after (in the integration tree) it lands', async () => {
    const project = await createProject('auto-pass');
    const marker = path.join(project.projectRoot, '.forge', 'state', 'marker.txt');
    const { adapter } = scriptedAdapter(WRITES, []);

    const state = await runEngine(
      chain,
      {},
      contextFor(project, {
        adapter,
        testCommands: { unit: recordingCommand(marker, 'unit') },
        mergeChecks: { pre: 'unit', post: 'fast' },
      }),
    );

    expect(state.runStatus).toBe('completed');
    const lines = await markerLines(marker);
    // pre: unit in the lane; post: `fast` runs unit (the only configured layer of the set) in the integration tree.
    expect(lines).toHaveLength(4);
    expect(
      lines.filter((line) => line.endsWith(path.join('worktrees', 'integration'))),
    ).toHaveLength(2);
    expect(await filesOnIntegration(project)).toEqual(expect.arrayContaining(['a.txt', 'b.txt']));
  });

  it('a failing post-check reverts the integrated lane and fails its step (the first lane stays), like an explicit merge', async () => {
    const project = await createProject('auto-post-fails');
    const { adapter } = scriptedAdapter(WRITES, []);
    // `b.txt` is the second lane's file: the post-check fails once it is in the integration tree.
    const ctx = contextFor(project, {
      adapter,
      testCommands: { unit: 'test ! -f b.txt' },
      mergeChecks: { post: 'unit' },
    });

    const state = await runEngine(chain, {}, ctx);

    expect(state.runStatus).toBe('failed');
    expect(await filesOnIntegration(project)).toContain('a.txt');
    expect(await filesOnIntegration(project)).not.toContain('b.txt');
    const events = await eventsOf(project);
    expect(events.filter((event) => event.type === 'MergeReverted')).toHaveLength(1);
    const failure = events.find((event) => event.type === 'StepFailed' && event.stepId === 'au:b')
      ?.payload as { code?: string } | undefined;
    expect(failure?.code).toBe('MERGE-POST-CHECK-FAILED');
  });

  it('mergeChecks that no lane would consult (every lane is landed by a merge) do not refuse the run; a resumed run does not resolve what already finished', async () => {
    const project = await createProject('preflight-scope');
    const { adapter } = scriptedAdapter(WRITES, []);
    const landed = workflowOf('pl', [
      agent('a', { produces: ['a.txt'] }),
      agent('b', { dependsOn: ['a'], produces: ['b.txt'] }),
      mergeStep(['b'], '{ conflict: abort, preChecks: fast }'),
    ]);
    const configured = {
      unit: recordingCommand(path.join(project.projectRoot, '.forge', 'state', 'm.txt'), 'unit'),
    };
    const first = await runEngine(
      landed,
      {},
      contextFor(project, { adapter, testCommands: configured, mergeChecks: { pre: 'fast' } }),
    );
    expect(first.runStatus).toBe('completed');

    // Same run, resumed after `execution.testCommands` was emptied: the merge already succeeded, nothing is resolved.
    const resumed = await runEngine(
      landed,
      {},
      contextFor(project, { adapter, testCommands: {}, mergeChecks: { pre: 'fast' } }),
      first,
    );
    expect(resumed.runStatus).toBe('completed');
    expect((await eventsOf(project)).some((event) => event.type === 'RunFailed')).toBe(false);

    // Fresh run, merge-landed lanes only: `execution.mergeChecks` would never be consulted, so it is not refused
    // (the merge's own literal policy is).
    const literal = workflowOf('pm', [
      agent('a', { produces: ['a.txt'] }),
      mergeStep(['a'], '{ conflict: abort, preChecks: "true" }'),
    ]);
    const second = await createProject('preflight-scope-2');
    const state = await runEngine(
      literal,
      {},
      contextFor(second, { adapter, testCommands: {}, mergeChecks: { pre: 'fast' } }),
    );
    expect(state.runStatus).toBe('completed');
  });

  it('a check set with nothing configured refuses the run before anything is dispatched, naming execution.mergeChecks and the keys', async () => {
    const project = await createProject('auto-unconfigured');
    const { adapter, seen } = scriptedAdapter(WRITES, []);

    const state = await runEngine(
      chain,
      {},
      contextFor(project, { adapter, mergeChecks: { pre: 'fast' } }),
    );

    expect(state.runStatus).toBe('failed');
    const failure = (await eventsOf(project)).find((event) => event.type === 'RunFailed')
      ?.payload as { reason?: string; message?: string } | undefined;
    expect(failure?.reason).toBe('setup');
    expect(failure?.message).toContain('execution.mergeChecks.pre');
    expect(failure?.message).toContain('execution.testCommands.unit');
    expect(seen.size).toBe(0);
    expect(await filesOnIntegration(project)).not.toContain('a.txt');
  });

  it('with no execution.mergeChecks nothing is checked (the default: a project opts in)', async () => {
    const project = await createProject('auto-default');
    const marker = path.join(project.projectRoot, '.forge', 'state', 'marker.txt');
    const { adapter } = scriptedAdapter(WRITES, []);

    const state = await runEngine(
      chain,
      {},
      contextFor(project, { adapter, testCommands: { unit: recordingCommand(marker, 'unit') } }),
    );

    expect(state.runStatus).toBe('completed');
    expect(await markerLines(marker)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('crash and resume of a stacked chain is idempotent', () => {
  const source = workflowOf('rs', [
    agent('gen', { produces: ['tests/**'] }),
    agent('impl', { dependsOn: ['gen'], produces: ['src/**'] }),
    agent('review', { dependsOn: ['impl'], produces: ['docs/**'] }),
    mergeStep(['review']),
  ]);
  const WRITES: Writes = {
    gen: [{ relativePath: 'tests/a.txt', content: 'r\n' }],
    impl: [{ relativePath: 'src/a.txt', content: 'g\n' }],
    review: [{ relativePath: 'docs/r.txt', content: 'ok\n' }],
  };
  const PROBE = ['tests/a.txt', 'src/a.txt'];

  /** A context whose event log throws (the process dying) the first time an event of `type` is recorded for `step`. */
  function crashingContext(
    project: Project,
    adapter: PlatformAdapter,
    type: string,
    step: string,
  ): RunEngineContext {
    const base = contextFor(project, { adapter });
    let crashed = false;
    return {
      ...base,
      telemetry: {
        emit: async (event) => {
          if (!crashed && event.type === type && event.stepId === step) {
            crashed = true;
            throw new Error(`simulated crash at ${type} of ${step}`);
          }
          return base.telemetry.emit(event);
        },
      },
    };
  }

  async function resumeAfterCrash(project: Project, adapter: PlatformAdapter) {
    const ctx = contextFor(project, { adapter });
    const parsed = parseWorkflow(source);
    if (!parsed.success) throw new Error('workflow does not parse');
    const compiled = compileRunPlan(parsed.workflow, {});
    if (!compiled.success) throw new Error('workflow does not compile');
    const steps = new Map<string, StepNode>(compiled.nodes.map((n) => [n.id, n] as const));
    const resumed = await resumeRun(RUN_ID, { ...ctx, steps });
    const state = await runEngine(source, {}, ctx, resumed);
    return { ctx, state };
  }

  // `LaneCreated`: the lane exists on disk but its base was never recorded (an orphan the resume reclaims, and the
  // step is created afresh: the same base again, decided from the same registry). `LaneCommitted`: the base was
  // recorded and the session ran; resume rolls the lane back to it (the predecessor's head) and runs it again.
  it.each([
    ['LaneCreated', 'rs:impl'],
    ['LaneCommitted', 'rs:impl'],
    ['LaneCreated', 'rs:review'],
    ['LaneCommitted', 'rs:review'],
  ] as const)(
    'a crash at %s of %s: the resumed run sees the same predecessor output, lands every lane once, once each',
    async (type, step) => {
      const project = await createProject(`resume-${type}-${step.slice(3)}`);
      const first = scriptedAdapter(WRITES, PROBE);
      await expect(
        runEngine(source, {}, crashingContext(project, first.adapter, type, step)),
      ).rejects.toThrow(`simulated crash at ${type} of ${step}`);

      const second = scriptedAdapter(WRITES, PROBE);
      const { ctx, state } = await resumeAfterCrash(project, second.adapter);

      expect(state.runStatus).toBe('completed');
      const created = (await eventsOf(project)).filter(
        (event) => event.type === 'LaneCreated' && event.stepId === step,
      );
      const predecessor = step === 'rs:impl' ? 'rs:gen' : 'rs:impl';
      if (type === 'LaneCreated') {
        // The lane was an unrecorded orphan: the step started afresh, from the same predecessor output as before.
        expect(second.seen.get(step)).toEqual(
          step === 'rs:impl' ? ['tests/a.txt'] : ['tests/a.txt', 'src/a.txt'],
        );
        expect(created).toHaveLength(1);
      } else {
        // The lane was rolled back to its recorded base and the session resumed in it: one LaneCreated, never a
        // second lane, and that base is the predecessor's lane (a resumed session is not a fresh `startSession`).
        expect(created).toHaveLength(1);
      }
      expect(created[0]?.payload).toMatchObject({ stackedOn: predecessor });
      // Steps that had finished before the crash were not run again.
      expect(second.seen.has('rs:gen')).toBe(false);
      expect(await mergedStepOrder(project)).toEqual(['rs:gen', 'rs:impl', 'rs:review']);
      expect(await filesOnIntegration(project)).toEqual(
        expect.arrayContaining(['tests/a.txt', 'src/a.txt', 'docs/r.txt']),
      );
      const subjects = await laneCommitSubjects(project);
      for (const name of ['gen', 'impl', 'review']) {
        expect(subjects.filter((s) => s === `forge(rs): did ${name}`)).toHaveLength(1);
      }
      expect(await git(project.integrationPath, 'status', '--porcelain')).toBe('');
      expect(ctx.laneRegistry.size).toBe(0);
      expect(await git(project.projectRoot, 'worktree', 'list', '--porcelain')).not.toContain(
        `forge/${RUN_ID}/`,
      );
    },
  );
});
