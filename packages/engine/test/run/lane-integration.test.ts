/**
 * Lane visibility (`PLAN-M13.md` P19, `06` §6.4 rule 4, `10` §10.1, owner decision Q3): a lane whose step
 * succeeded and which no `merge` step lands is integrated into the integration branch by the engine, later
 * lanes branch from the integration tip, and inline `command` steps and gates read the integrated tree.
 * Everything here runs the real engine (`runEngine`: parse, compile, scheduler, dispatch) over a real git
 * repository with a real integration worktree, exactly the way the CLI wires one; only the model sessions
 * are the fake adapter's (strict prompt checking stays on).
 *
 * The first two tests are the confirmation the owner asked for before anything was built: they were written
 * to fail against the engine as it stood (a second step never saw the first step's output; nothing reached the
 * integration branch; an inline step and a gate read different trees), and they did.
 *
 * @see specs/06 §6.4, §6.5
 * @see specs/10 §10.1
 * @see PLAN-M13.md P19
 */
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
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
import type { GateDefinition } from '../../src/gates/index.ts';
import { compileRunPlan, type StepNode } from '../../src/plan/index.ts';
import { reconstructRunState } from '../../src/resume/reconstruct.ts';
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

interface Project {
  readonly projectRoot: string;
  readonly integrationPath: string;
}

/** A project laid out the way `forge run` lays one out: `main` checked out at the project root, and a separate
 * worktree holding the integration branch. Nothing is committed on `main` beyond the first commit, so any file
 * on the integration branch or in a lane came from a step. */
async function createProject(prefix: string): Promise<Project> {
  const projectRoot = await mkdtemp(path.join(tmpdir(), `forge-lane-integration-${prefix}-`));
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
  readonly runId?: string;
  readonly adapter: PlatformAdapter;
  readonly gates?: ReadonlyMap<string, GateDefinition>;
  readonly conflictPolicy?: 'agent' | 'human' | 'abort';
  readonly claimPolicy?: 'strict' | 'warn';
  /** The `MergeQueueFacade`'s own constructor-bound resolver (`createMergeQueueFacade`'s second argument). */
  readonly resolver?: Parameters<typeof createMergeQueueFacade>[1];
  /** `PLAN-M14.md` P35: `ExecuteStepContext.conflictResolver` -- a PER-CALL resolver `landLane` prefers over
   * `resolver` above when both are set (`createMergeQueueFacade`'s own doc comment, `facades.ts`). Distinct
   * from `resolver` so a test can prove which one actually won. */
  readonly conflictResolver?: Parameters<typeof createMergeQueueFacade>[1];
  readonly laneRegistry?: Map<string, LaneHandle>;
}

function contextFor(project: Project, options: ContextOptions): RunEngineContext {
  const runId = options.runId ?? 'run-lane';
  let tick = 0;
  const now = () => (tick += 1);
  const gateRegistry = options.gates ?? new Map<string, GateDefinition>();
  return {
    adapter: options.adapter,
    vcs: createVcsFacade(project.projectRoot, runId),
    telemetry: createTelemetryFacade(project.projectRoot, runId, now),
    gates: createGateEvaluator(gateRegistry),
    gateRegistry,
    mergeQueue: createMergeQueueFacade(project.integrationPath, options.resolver),
    runId,
    projectRoot: project.projectRoot,
    // What the CLI now passes: lanes branch from the integration branch, whose tip holds everything integrated.
    integrationBase: INTEGRATION_BRANCH,
    integrationPath: project.integrationPath,
    model: FAKE_MODEL_ID,
    tools: TOOLS,
    assembly: createFixtureAssembly(project.projectRoot),
    retainLaneWorktrees: false,
    claimPolicy: options.claimPolicy ?? 'strict',
    signCommits: false,
    now,
    laneRegistry: options.laneRegistry ?? new Map<string, LaneHandle>(),
    limits: UNLIMITED,
    seed: 'seed-1',
    ...(options.conflictPolicy === undefined ? {} : { conflictPolicy: options.conflictPolicy }),
    ...(options.conflictResolver === undefined
      ? {}
      : { conflictResolver: options.conflictResolver }),
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

/** A fake adapter whose sessions write `writes[<step id suffix>]`, recording what each session's working
 * directory already held. The recording matcher is registered first and never matches, so it sees every request
 * (first-registered wins for the real scripts registered after it). */
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

function workflowOf(id: string, steps: readonly string[]): string {
  return [
    `id: ${id}`,
    `name: ${id}`,
    'version: 1.0.0',
    `description: ${id} lane test`,
    'steps:',
    ...steps,
    '',
  ].join('\n');
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await execa('git', args, { cwd })).stdout;
}

async function eventsOf(project: Project, runId: string) {
  const events = [];
  for await (const event of readEvents(project.projectRoot, runId)) events.push(event);
  return events;
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

describe('a lane no merge step lands is integrated (06 section 6.4 rule 4)', () => {
  it("a second step sees the first step's output, and the integration branch (not main) holds both", async () => {
    const project = await createProject('chain');
    const { adapter, seen } = scriptedAdapter(
      {
        one: [{ relativePath: 'one.txt', content: 'one\n' }],
        two: [{ relativePath: 'two.txt', content: 'two\n' }],
      },
      ['one.txt'],
    );
    const ctx = contextFor(project, { adapter });
    const source = workflowOf('chain', [
      agent('one', { produces: ['one.txt'] }),
      agent('two', { dependsOn: ['one'], produces: ['two.txt'] }),
    ]);

    const state = await runEngine(source, {}, ctx);

    expect(state.runStatus).toBe('completed');
    // The lane of step two branched from a tip that already held step one's file.
    expect(seen.get('chain:two')).toEqual(['one.txt']);
    expect(seen.get('chain:one')).toEqual([]);
    // Both landed on the integration branch; main is untouched.
    expect(await git(project.integrationPath, 'show', 'HEAD:one.txt')).toBe('one');
    expect(await git(project.integrationPath, 'show', 'HEAD:two.txt')).toBe('two');
    await expect(git(project.projectRoot, 'show', 'main:one.txt')).rejects.toThrow();
    expect(await mergedStepOrder(project)).toEqual(['chain:one', 'chain:two']);
    // Integrated lanes are gone: nothing left registered, no lane worktree on disk.
    expect(ctx.laneRegistry.size).toBe(0);
    const worktrees = await git(project.projectRoot, 'worktree', 'list', '--porcelain');
    expect(worktrees).not.toContain('forge/run-lane/');
  });

  it('an inline command step and a gate both read the integrated tree, so they see what an earlier lane wrote', async () => {
    const project = await createProject('inline-gate');
    const { adapter } = scriptedAdapter(
      { write: [{ relativePath: 'docs/epic.md', content: 'epic\n' }] },
      [],
    );
    const gates = new Map<string, GateDefinition>([
      [
        'G-Epic',
        {
          id: 'G-Epic',
          checks: {
            deterministic: [
              {
                id: 'epic-present',
                run: `if [ -f docs/epic.md ]; then echo '{"errors":0}'; else echo '{"errors":1}'; fi`,
                failOn: 'errors > 0',
              },
            ],
            advisory: [],
          },
          openQuestionsPolicy: 'warn',
        },
      ],
    ]);
    const ctx = contextFor(project, { adapter, gates });
    const source = workflowOf('ig', [
      agent('write', { produces: ['docs/epic.md'] }),
      [
        '  - id: derive',
        '    kind: command',
        '    inline: true',
        '    dependsOn: [write]',
        '    run: "test -f docs/epic.md"',
      ].join('\n'),
      ['  - id: ready', '    kind: gate', '    gate: G-Epic', '    dependsOn: [derive]'].join('\n'),
    ]);

    const state = await runEngine(source, {}, ctx);

    expect(state.stepStatuses.get('ig:derive')).toBe('succeeded');
    expect(state.stepStatuses.get('ig:ready')).toBe('succeeded');
    expect(state.runStatus).toBe('completed');
  });
});

describe('what a lane is branched from and what is integrated', () => {
  it('parallel independent lanes both integrate, in plan order however they finish, with no lost update', async () => {
    const project = await createProject('parallel');
    const inner = scriptedAdapter(
      {
        a: [{ relativePath: 'a.txt', content: 'a\n' }],
        b: [{ relativePath: 'b.txt', content: 'b\n' }],
      },
      [],
    );
    // `a` finishes last: integration order must still be the plan's, not completion order.
    const slow: PlatformAdapter = Object.create(inner.adapter, {
      startSession: {
        value: async (request: Parameters<PlatformAdapter['startSession']>[0]) => {
          if (request.stepId.endsWith(':a'))
            await new Promise((resolve) => setTimeout(resolve, 200));
          return inner.adapter.startSession(request);
        },
      },
    }) as PlatformAdapter;
    const source = workflowOf('par', [
      agent('a', { produces: ['a.txt'] }),
      agent('b', { produces: ['b.txt'] }),
    ]);

    const state = await runEngine(source, {}, contextFor(project, { adapter: slow }));

    expect(state.runStatus).toBe('completed');
    expect(await git(project.integrationPath, 'show', 'HEAD:a.txt')).toBe('a');
    expect(await git(project.integrationPath, 'show', 'HEAD:b.txt')).toBe('b');
    expect(await mergedStepOrder(project)).toEqual(['par:a', 'par:b']);
    const events = await eventsOf(project, 'run-lane');
    expect(events.filter((event) => event.type === 'MergeCompleted')).toHaveLength(2);
  });

  it('a step whose session changed no file leaves nothing to integrate: no merge commit, no merge events, the lane is removed', async () => {
    const project = await createProject('nochange');
    const { adapter } = scriptedAdapter({}, []);
    const ctx = contextFor(project, { adapter });
    const source = workflowOf('nc', [agent('quiet'), agent('after', { dependsOn: ['quiet'] })]);

    const state = await runEngine(source, {}, ctx);

    expect(state.runStatus).toBe('completed');
    expect(await git(project.integrationPath, 'log', '--merges', '--format=%H')).toBe('');
    const events = await eventsOf(project, 'run-lane');
    expect(events.filter((event) => event.type.startsWith('Merge'))).toEqual([]);
    expect(events.filter((event) => event.type === 'LaneRemoved')).toHaveLength(2);
    expect(ctx.laneRegistry.size).toBe(0);
  });

  it('a step that failed leaves its lane un-integrated, and its dependents never run', async () => {
    const project = await createProject('failed');
    const { adapter, seen } = scriptedAdapter({}, [], {
      boom: {
        text: ['half done'],
        writeFiles: [{ relativePath: 'boom.txt', content: 'x\n' }],
        endReason: 'error',
        errorInfo: { code: 'X', message: 'boom' },
      },
    });
    const source = workflowOf('fail', [
      agent('boom', { produces: ['boom.txt'] }),
      agent('next', { dependsOn: ['boom'] }),
    ]);

    const state = await runEngine(source, {}, contextFor(project, { adapter }));

    expect(state.runStatus).toBe('failed');
    expect(seen.has('fail:next')).toBe(false);
    await expect(git(project.integrationPath, 'show', 'HEAD:boom.txt')).rejects.toThrow();
    expect(await git(project.integrationPath, 'log', '--merges', '--format=%H')).toBe('');
  });
});

describe('conflicting lanes follow the configured policy', () => {
  /** Two lanes in one tick that both write `same.txt`. Claims are disjoint (`a.txt` / `b.txt`, so the scheduler
   * runs them together) and the claim policy is `warn` (the out-of-claim `same.txt` is kept), which is how two
   * lanes end up genuinely conflicting at integration. */
  async function conflictingRun(
    prefix: string,
    options: Pick<ContextOptions, 'conflictPolicy' | 'resolver' | 'conflictResolver'>,
  ) {
    const project = await createProject(prefix);
    const { adapter } = scriptedAdapter(
      {
        a: [{ relativePath: 'same.txt', content: 'from a\n' }],
        b: [{ relativePath: 'same.txt', content: 'from b\n' }],
      },
      [],
    );
    const source = workflowOf('cf', [
      agent('a', { produces: ['a.txt'] }),
      agent('b', { produces: ['b.txt'] }),
    ]);
    const state = await runEngine(
      source,
      {},
      contextFor(project, { adapter, claimPolicy: 'warn', ...options }),
    );
    return { project, state };
  }

  it('abort: the later lane (plan order) fails its step, MergeConflict is logged, the first lane stays integrated, the tree is clean', async () => {
    const { project, state } = await conflictingRun('conflict-abort', { conflictPolicy: 'abort' });

    expect(state.runStatus).toBe('failed');
    expect(state.stepStatuses.get('cf:b')).toBe('failed');
    expect(await git(project.integrationPath, 'show', 'HEAD:same.txt')).toBe('from a');
    expect(await git(project.integrationPath, 'status', '--porcelain')).toBe('');
    const events = await eventsOf(project, 'run-lane');
    expect(events.some((event) => event.type === 'MergeConflict')).toBe(true);
  });

  it('agent with no resolver configured: the integration fails as data (no throw), the tree is clean', async () => {
    const { project, state } = await conflictingRun('conflict-agent', { conflictPolicy: 'agent' });

    expect(state.runStatus).toBe('failed');
    expect(state.stepStatuses.get('cf:b')).toBe('failed');
    expect(await git(project.integrationPath, 'status', '--porcelain')).toBe('');
  });

  it('agent with a resolver: a resolved conflict integrates the lane and the run completes', async () => {
    const resolver: ContextOptions['resolver'] = async (conflict) => {
      await writeFile(path.join(conflict.worktreePath, 'same.txt'), 'resolved\n');
      return 'resolved';
    };
    const { project, state } = await conflictingRun('conflict-resolved', {
      conflictPolicy: 'agent',
      resolver,
    });

    expect(state.runStatus).toBe('completed');
    expect(await git(project.integrationPath, 'show', 'HEAD:same.txt')).toBe('resolved');
    // `PLAN-M14.md` P35: `landLane` emits `MergeConflict{reason:'resolved', files}` BEFORE `MergeCompleted`
    // -- a resolved landing-time conflict is no longer silent in the event log the way it was before this
    // piece (only the unresolved case ever got a `MergeConflict` event). Scoped to `cf:b`'s own events:
    // `cf:a` integrates cleanly first (no conflict at all, since integration is still empty then), so its
    // own `MergeCompleted` is not part of the sequence this test is about.
    const events = await eventsOf(project, 'run-lane');
    const mergeEvents = events.filter(
      (event) =>
        event.stepId === 'cf:b' &&
        (event.type === 'MergeConflict' || event.type === 'MergeCompleted'),
    );
    expect(mergeEvents.map((event) => event.type)).toEqual(['MergeConflict', 'MergeCompleted']);
    const conflictPayload = mergeEvents[0]?.payload as
      { reason?: string; files?: readonly string[] } | undefined;
    expect(conflictPayload?.reason).toBe('resolved');
    expect(conflictPayload?.files).toEqual(['same.txt']);
  });

  it("PLAN-M14.md P35: ExecuteStepContext.conflictResolver (per-call) is preferred over the facade's own constructor-bound resolver when both are set", async () => {
    let constructorResolverCalls = 0;
    const constructorResolver: ContextOptions['resolver'] = async (conflict) => {
      constructorResolverCalls += 1;
      await writeFile(path.join(conflict.worktreePath, 'same.txt'), 'from constructor resolver\n');
      return 'resolved';
    };
    let perCallResolverCalls = 0;
    const perCallResolver: ContextOptions['conflictResolver'] = async (conflict) => {
      perCallResolverCalls += 1;
      await writeFile(path.join(conflict.worktreePath, 'same.txt'), 'from per-call resolver\n');
      return 'resolved';
    };
    const { project, state } = await conflictingRun('conflict-per-call-resolver', {
      conflictPolicy: 'agent',
      resolver: constructorResolver,
      conflictResolver: perCallResolver,
    });

    expect(state.runStatus).toBe('completed');
    expect(perCallResolverCalls).toBe(1);
    expect(constructorResolverCalls).toBe(0);
    expect(await git(project.integrationPath, 'show', 'HEAD:same.txt')).toBe(
      'from per-call resolver',
    );
  });

  it('PLAN-M14.md P35: with no per-call resolver set, the facade falls back to its own constructor-bound resolver unchanged', async () => {
    let constructorResolverCalls = 0;
    const constructorResolver: ContextOptions['resolver'] = async (conflict) => {
      constructorResolverCalls += 1;
      await writeFile(path.join(conflict.worktreePath, 'same.txt'), 'from constructor resolver\n');
      return 'resolved';
    };
    const { project, state } = await conflictingRun('conflict-constructor-fallback', {
      conflictPolicy: 'agent',
      resolver: constructorResolver,
    });

    expect(state.runStatus).toBe('completed');
    expect(constructorResolverCalls).toBe(1);
    expect(await git(project.integrationPath, 'show', 'HEAD:same.txt')).toBe(
      'from constructor resolver',
    );
  });
});

describe('an explicit merge step is untouched', () => {
  it('a lane a merge step lands is NOT integrated early (review is stacked on the implement lane, and sees it), and the merge lands both', async () => {
    const project = await createProject('explicit-merge');
    const { adapter, seen } = scriptedAdapter(
      {
        implement: [{ relativePath: 'impl.txt', content: 'impl\n' }],
        review: [{ relativePath: 'review.txt', content: 'review\n' }],
      },
      ['impl.txt'],
    );
    const source = workflowOf('em', [
      agent('implement', { produces: ['impl.txt'] }),
      agent('review', { dependsOn: ['implement'], produces: ['review.txt'] }),
      [
        '  - id: merge',
        '    kind: merge',
        '    over: review',
        '    dependsOn: [review]',
        '    policy: { conflict: abort }',
      ].join('\n'),
    ]);

    const state = await runEngine(source, {}, contextFor(project, { adapter }));

    expect(state.runStatus).toBe('completed');
    // Review-before-merge: nothing of `implement` reached the integration branch before the merge step (every merge
    // event below belongs to it). `review` still sees the implement lane's output: its lane is stacked on it
    // (`PLAN-M13.md` P38, `stacked-lanes.test.ts`), which is what lets a review read the change under review.
    expect(seen.get('em:review')).toEqual(['impl.txt']);
    // The merge landed the work it merges (the implement lane too), not only its direct predecessor's.
    expect(await git(project.integrationPath, 'show', 'HEAD:impl.txt')).toBe('impl');
    expect(await git(project.integrationPath, 'show', 'HEAD:review.txt')).toBe('review');
    expect(await mergedStepOrder(project)).toEqual(['em:implement', 'em:review']);
    const events = await eventsOf(project, 'run-lane');
    // Every merge event of this run belongs to the explicit merge step.
    const mergeEvents = events.filter((event) => event.type.startsWith('Merge'));
    expect(new Set(mergeEvents.map((event) => event.stepId))).toEqual(new Set(['em:merge']));
  });

  it('a gate between an agent step and a later merge is an integration checkpoint: the lane before the gate integrates first, the lanes after it wait for the merge', async () => {
    const project = await createProject('gate-cutoff');
    const { adapter, seen } = scriptedAdapter(
      {
        design: [{ relativePath: 'contract.txt', content: 'c\n' }],
        build: [{ relativePath: 'build.txt', content: 'b\n' }],
        later: [{ relativePath: 'later.txt', content: 'l\n' }],
      },
      ['contract.txt', 'build.txt'],
    );
    const gates = new Map<string, GateDefinition>([
      [
        'G-Design',
        {
          id: 'G-Design',
          checks: {
            deterministic: [
              {
                id: 'contract',
                run: `if [ -f contract.txt ]; then echo '{"errors":0}'; else echo '{"errors":1}'; fi`,
                failOn: 'errors > 0',
              },
            ],
            advisory: [],
          },
          openQuestionsPolicy: 'warn',
        },
      ],
    ]);
    const source = workflowOf('gc', [
      agent('design', { produces: ['contract.txt'] }),
      [
        '  - id: design-gate',
        '    kind: gate',
        '    gate: G-Design',
        '    dependsOn: [design]',
      ].join('\n'),
      agent('build', { dependsOn: ['design-gate'], produces: ['build.txt'] }),
      agent('later', { dependsOn: ['build'], produces: ['later.txt'] }),
      [
        '  - id: merge',
        '    kind: merge',
        '    over: later',
        '    dependsOn: [later]',
        '    policy: { conflict: abort }',
      ].join('\n'),
    ]);

    const state = await runEngine(source, {}, contextFor(project, { adapter, gates }));

    expect(state.runStatus).toBe('completed');
    // `design` integrated before the gate (the gate reads the integrated tree) and before `build` branched.
    expect(seen.get('gc:build')).toEqual(['contract.txt']);
    // `build` sits between the gate and the merge: it waits for the merge and is not integrated early, but `later`
    // is stacked on its lane (`PLAN-M13.md` P38), so it sees it all the same.
    expect(seen.get('gc:later')).toEqual(['contract.txt', 'build.txt']);
    expect(await mergedStepOrder(project)).toEqual(['gc:design', 'gc:build', 'gc:later']);
    const events = await eventsOf(project, 'run-lane');
    const owners = events
      .filter((event) => event.type === 'MergeCompleted')
      .map((event) => event.stepId);
    expect(owners).toEqual(['gc:design', 'gc:merge', 'gc:merge']);
  });
});

describe('an explicit merge over a lane with nothing to land', () => {
  it('lands nothing, reports no merge, and a failing post-merge check reverts nothing of another lane', async () => {
    const project = await createProject('merge-noop');
    const { adapter } = scriptedAdapter({ real: [{ relativePath: 'r.txt', content: 'r\n' }] }, []);
    const source = workflowOf('mn', [
      agent('real', { produces: ['r.txt'] }),
      agent('quiet'),
      [
        '  - id: merge',
        '    kind: merge',
        '    over: quiet',
        '    dependsOn: [real, quiet]',
        '    policy: { conflict: abort, postChecks: "test -f r.txt" }',
      ].join('\n'),
    ]);

    const state = await runEngine(source, {}, contextFor(project, { adapter }));

    expect(state.runStatus).toBe('completed');
    expect(await git(project.integrationPath, 'show', 'HEAD:r.txt')).toBe('r');
    const events = await eventsOf(project, 'run-lane');
    // One merge (`real`); `quiet` had nothing to land and produced no MergeStarted/MergeCompleted of its own.
    expect(events.filter((event) => event.type === 'MergeCompleted')).toHaveLength(1);
    expect(events.some((event) => event.type === 'MergeReverted')).toBe(false);
  });
});

describe('concurrency inside one tick', () => {
  it('an inline step running while an explicit merge lands does not undo the merge (the restore is serialised with the queue)', async () => {
    const project = await createProject('inline-vs-merge');
    const { adapter } = scriptedAdapter(
      {
        a: [{ relativePath: 'a.txt', content: 'a\n' }],
        x: [{ relativePath: 'x.txt', content: 'x\n' }],
      },
      [],
    );
    // Tick 1: `a` and `x`. Tick 2: the merge over `a` and the slow inline step, admitted together.
    const source = workflowOf('cc', [
      agent('a', { produces: ['a.txt'] }),
      agent('x', { produces: ['x.txt'] }),
      [
        '  - id: merge',
        '    kind: merge',
        '    over: a',
        '    dependsOn: [a]',
        '    policy: { conflict: abort }',
      ].join('\n'),
      [
        '  - id: slow',
        '    kind: command',
        '    inline: true',
        '    dependsOn: [x]',
        '    run: "sleep 1; test -f x.txt"',
      ].join('\n'),
    ]);

    const state = await runEngine(source, {}, contextFor(project, { adapter }));

    expect(state.runStatus).toBe('completed');
    expect(await git(project.integrationPath, 'show', 'HEAD:a.txt')).toBe('a');
    expect(await git(project.integrationPath, 'show', 'HEAD:x.txt')).toBe('x');
    expect(await mergedStepOrder(project)).toEqual(expect.arrayContaining(['cc:a', 'cc:x']));
  });

  it('two merges whose landing scopes share an upstream lane land it once, and both succeed', async () => {
    const project = await createProject('shared-lane');
    const { adapter } = scriptedAdapter(
      {
        base: [{ relativePath: 'base.txt', content: 'base\n' }],
        implA: [{ relativePath: 'a.txt', content: 'a\n' }],
        implB: [{ relativePath: 'b.txt', content: 'b\n' }],
      },
      [],
    );
    const mergeOf = (id: string, over: string) =>
      [
        `  - id: ${id}`,
        '    kind: merge',
        `    over: ${over}`,
        `    dependsOn: [${over}]`,
        '    policy: { conflict: abort }',
      ].join('\n');
    const source = workflowOf('sh', [
      agent('base', { produces: ['base.txt'] }),
      agent('implA', { dependsOn: ['base'], produces: ['a.txt'] }),
      agent('implB', { dependsOn: ['base'], produces: ['b.txt'] }),
      mergeOf('mergeA', 'implA'),
      mergeOf('mergeB', 'implB'),
    ]);

    const state = await runEngine(source, {}, contextFor(project, { adapter }));

    expect(state.runStatus).toBe('completed');
    expect(state.stepStatuses.get('sh:mergeA')).toBe('succeeded');
    expect(state.stepStatuses.get('sh:mergeB')).toBe('succeeded');
    for (const file of ['base.txt', 'a.txt', 'b.txt']) {
      expect(await git(project.integrationPath, 'show', `HEAD:${file}`)).toBeTruthy();
    }
    expect((await mergedStepOrder(project)).filter((id) => id === 'sh:base')).toHaveLength(1);
  });

  it('a lane whose dependency lane did not land is not landed either; independent lanes are', async () => {
    const project = await createProject('dependent-skipped');
    const { adapter } = scriptedAdapter(
      {
        y: [{ relativePath: 'same.txt', content: 'from y\n' }],
        x: [{ relativePath: 'same.txt', content: 'from x\n' }],
        z: [{ relativePath: 'z.txt', content: 'z\n' }],
        w: [{ relativePath: 'w.txt', content: 'w\n' }],
      },
      [],
    );
    const source = workflowOf('ds', [
      agent('y', { produces: ['y.txt'] }),
      agent('x', { produces: ['x.txt'] }),
      agent('z', { dependsOn: ['x'], produces: ['z.txt'] }),
      agent('w', { produces: ['w.txt'] }),
      [
        '  - id: merge',
        '    kind: merge',
        '    over: z',
        '    dependsOn: [y, z, w]',
        '    policy: { conflict: abort }',
      ].join('\n'),
    ]);

    const state = await runEngine(
      source,
      {},
      contextFor(project, { adapter, claimPolicy: 'warn' }),
    );

    // Landing order: y, x (conflicts with y), z (builds on x: skipped), w.
    expect(state.stepStatuses.get('ds:merge')).toBe('failed');
    expect(await git(project.integrationPath, 'show', 'HEAD:same.txt')).toBe('from y');
    expect(await git(project.integrationPath, 'show', 'HEAD:w.txt')).toBe('w');
    await expect(git(project.integrationPath, 'show', 'HEAD:z.txt')).rejects.toThrow();
    const events = await eventsOf(project, 'run-lane');
    const failure = events.find(
      (event) => event.type === 'StepFailed' && event.stepId === 'ds:merge',
    );
    expect(JSON.stringify(failure?.payload)).toContain('MERGE-CONFLICT-UNRESOLVED');
  });

  it('a lane is created from the sha its claim is enforced against, even if the integration branch moves in between', async () => {
    const project = await createProject('base-race');
    const { adapter } = scriptedAdapter(
      { mine: [{ relativePath: 'mine.txt', content: 'mine\n' }] },
      [],
    );
    const base = contextFor(project, { adapter });
    let advanced = false;
    const ctx: RunEngineContext = {
      ...base,
      vcs: {
        ...base.vcs,
        // Another lane lands on the integration branch right after this lane's base is resolved.
        resolveRevision: async (ref) => {
          const sha = await base.vcs.resolveRevision(ref);
          if (!advanced && ref === INTEGRATION_BRANCH) {
            advanced = true;
            await writeFile(path.join(project.integrationPath, 'other.txt'), 'other\n');
            await git(project.integrationPath, 'add', 'other.txt');
            await git(
              project.integrationPath,
              '-c',
              'user.email=x@x',
              '-c',
              'user.name=x',
              'commit',
              '-q',
              '-m',
              'another lane landed',
            );
          }
          return sha;
        },
      },
    };
    const source = workflowOf('br', [agent('mine', { produces: ['mine.txt'] })]);

    const state = await runEngine(source, {}, ctx);

    expect(state.runStatus).toBe('completed');
    // The other lane's file is still there: it was not reverted out of this lane as an "out-of-claim write".
    expect(await git(project.integrationPath, 'show', 'HEAD:other.txt')).toBe('other');
    expect(await git(project.integrationPath, 'show', 'HEAD:mine.txt')).toBe('mine');
  });
});

describe('inline command steps run in the integration worktree and may not change it', () => {
  async function runInline(project: Project, run: string) {
    const { adapter } = scriptedAdapter({}, []);
    const source = workflowOf('il', [
      [
        '  - id: probe',
        '    kind: command',
        '    inline: true',
        `    run: ${JSON.stringify(run)}`,
      ].join('\n'),
    ]);
    const state = await runEngine(source, {}, contextFor(project, { adapter }));
    return { state, events: await eventsOf(project, 'run-lane') };
  }

  it('runs at the integration worktree', async () => {
    const project = await createProject('inline-cwd');
    const { state } = await runInline(
      project,
      'test "$(git rev-parse --abbrev-ref HEAD)" = "forge/integration/current"',
    );
    expect(state.stepStatuses.get('il:probe')).toBe('succeeded');
  });

  it('a step that writes a file into it fails, and the file is removed again', async () => {
    const project = await createProject('inline-dirty');
    const { state, events } = await runInline(project, 'echo stray > stray.txt');
    expect(state.stepStatuses.get('il:probe')).toBe('failed');
    expect(existsSync(path.join(project.integrationPath, 'stray.txt'))).toBe(false);
    expect(await git(project.integrationPath, 'status', '--porcelain')).toBe('');
    const failed = events.find((event) => event.type === 'StepFailed');
    expect(JSON.stringify(failed?.payload)).toContain('stray.txt');
  });

  it('a step that edits a tracked file fails, and the file is restored', async () => {
    const project = await createProject('inline-tracked');
    const { state } = await runInline(project, 'echo changed >> .gitignore');
    expect(state.stepStatuses.get('il:probe')).toBe('failed');
    expect(await readFile(path.join(project.integrationPath, '.gitignore'), 'utf8')).toBe(
      '.forge/state/\n',
    );
  });

  it('a step that switches the integration worktree to another branch fails, and the branch is restored', async () => {
    const project = await createProject('inline-switch');
    const { state } = await runInline(project, 'git switch -c elsewhere');
    expect(state.stepStatuses.get('il:probe')).toBe('failed');
    expect(await git(project.integrationPath, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(
      INTEGRATION_BRANCH,
    );
  });

  it('a step that fails after writing a file reports its own failure, and the file is removed', async () => {
    const project = await createProject('inline-fail-dirty');
    const { state, events } = await runInline(
      project,
      'echo stray > stray.txt; echo nope >&2; exit 3',
    );
    expect(state.stepStatuses.get('il:probe')).toBe('failed');
    expect(existsSync(path.join(project.integrationPath, 'stray.txt'))).toBe(false);
    const failed = events.find((event) => event.type === 'StepFailed');
    expect(JSON.stringify(failed?.payload)).toContain('nope');
    expect(JSON.stringify(failed?.payload)).toContain('created stray.txt');
  });

  it('a step whose file has a space in its name is reverted too', async () => {
    const project = await createProject('inline-space');
    const { state } = await runInline(project, 'echo stray > "a b.txt"');
    expect(state.stepStatuses.get('il:probe')).toBe('failed');
    expect(existsSync(path.join(project.integrationPath, 'a b.txt'))).toBe(false);
  });

  it('a step that commits to the integration branch fails, and the branch is put back at its commit', async () => {
    const project = await createProject('inline-commit');
    const before = await git(project.integrationPath, 'rev-parse', 'HEAD');
    const { state } = await runInline(
      project,
      'git -c user.email=x@x -c user.name=x commit --allow-empty -q -m sneaky',
    );
    expect(state.stepStatuses.get('il:probe')).toBe('failed');
    expect(await git(project.integrationPath, 'rev-parse', 'HEAD')).toBe(before);
  });

  it('a step that only writes ignored state (.forge/state) leaves the integration tree as it was', async () => {
    const project = await createProject('inline-ignored');
    const { state } = await runInline(
      project,
      'mkdir -p .forge/state && echo ok > .forge/state/index.db',
    );
    expect(state.stepStatuses.get('il:probe')).toBe('succeeded');
  });
});

describe('a crash while integrating is resumed without merging anything twice', () => {
  const source = workflowOf('cr', [
    agent('one', { produces: ['one.txt'] }),
    agent('two', { dependsOn: ['one'], produces: ['two.txt'] }),
  ]);
  const WRITES: Writes = {
    one: [{ relativePath: 'one.txt', content: 'one\n' }],
    two: [{ relativePath: 'two.txt', content: 'two\n' }],
  };

  /** A context whose event log throws (a stand-in for the process dying) the first time it is asked to record
   * an event of type `crashAt`: everything before that point is durable, nothing after it happened. */
  function crashingContext(
    project: Project,
    adapter: PlatformAdapter,
    crashAt: string,
  ): RunEngineContext {
    const base = contextFor(project, { adapter });
    let crashed = false;
    return {
      ...base,
      telemetry: {
        emit: async (event) => {
          if (!crashed && event.type === crashAt) {
            crashed = true;
            throw new Error(`simulated crash at ${crashAt}`);
          }
          return base.telemetry.emit(event);
        },
      },
    };
  }

  /** What a new process does after the crash: fresh facades and an empty lane registry, `resumeRun`, then the
   * engine seeded from the resumed state. */
  async function resumeAfterCrash(project: Project, adapter: PlatformAdapter) {
    const ctx = contextFor(project, { adapter });
    const parsed = parseWorkflow(source);
    if (!parsed.success) throw new Error('workflow does not parse');
    const compiled = compileRunPlan(parsed.workflow, {});
    if (!compiled.success) throw new Error('workflow does not compile');
    const steps = new Map<string, StepNode>(compiled.nodes.map((n) => [n.id, n] as const));
    const resumed = await resumeRun('run-lane', { ...ctx, steps });
    const state = await runEngine(source, {}, ctx, resumed);
    return { ctx, state };
  }

  async function mergeCommitCount(project: Project, stepId: string): Promise<number> {
    const log = await git(project.integrationPath, 'log', '--merges', '--format=%B%x00');
    return log.split('\0').filter((message) => message.includes(`Forge-Step: ${stepId}`)).length;
  }

  // `completed` is how many `MergeCompleted` events step one's lane has once the run finishes. A crash at
  // `MergeCompleted` lost the event but not the merge: the lane is already in the integration branch, so the
  // resumed run only removes it (the merge is not reported, or performed, a second time).
  it.each([
    ['MergeQueued', 1],
    ['MergeStarted', 1],
    ['MergeCompleted', 0],
    ['LaneRemoved', 1],
  ] as const)(
    'crash at %s: the resumed run integrates the lane exactly once and finishes',
    async (crashAt, completed) => {
      const project = await createProject(`resume-${crashAt}`);
      const first = scriptedAdapter(WRITES, ['one.txt']);
      await expect(
        runEngine(source, {}, crashingContext(project, first.adapter, crashAt)),
      ).rejects.toThrow(`simulated crash at ${crashAt}`);

      const second = scriptedAdapter(WRITES, ['one.txt']);
      const { ctx, state } = await resumeAfterCrash(project, second.adapter);

      expect(state.runStatus).toBe('completed');
      expect(await mergeCommitCount(project, 'cr:one')).toBe(1);
      expect(await mergeCommitCount(project, 'cr:two')).toBe(1);
      const events = await eventsOf(project, 'run-lane');
      expect(
        events.filter((event) => event.type === 'MergeCompleted' && event.stepId === 'cr:one'),
      ).toHaveLength(completed);
      // Step one was not run again, and step two branched from a tip that held its output.
      expect(second.seen.has('cr:one')).toBe(false);
      expect(second.seen.get('cr:two')).toEqual(['one.txt']);
      expect(await git(project.integrationPath, 'show', 'HEAD:one.txt')).toBe('one');
      expect(await git(project.integrationPath, 'status', '--porcelain')).toBe('');
      expect(ctx.laneRegistry.size).toBe(0);
      const worktrees = await git(project.projectRoot, 'worktree', 'list', '--porcelain');
      expect(worktrees).not.toContain('forge/run-lane/');
    },
  );

  it('a lane left in the middle of a rebase by a killed process is integrated on resume, once', async () => {
    const project = await createProject('resume-rebase');
    const first = scriptedAdapter(WRITES, ['one.txt']);
    await expect(
      runEngine(source, {}, crashingContext(project, first.adapter, 'MergeQueued')),
    ).rejects.toThrow('simulated crash at MergeQueued');
    // What the crash left: the lane worktree stopped inside `git rebase -i` (a `break` before its only commit).
    const worktrees = path.join(project.projectRoot, '.forge', 'state', 'worktrees');
    const laneDir = (await readdir(worktrees)).find((name) => name.includes('cr-one'));
    if (laneDir === undefined) throw new Error('the crashed run left no lane for step one');
    const lane = path.join(worktrees, laneDir);
    const editor = path.join(project.projectRoot, 'break-editor.sh');
    await writeFile(
      editor,
      '#!/bin/sh\n{ echo break; cat "$1"; } > "$1.new" && mv "$1.new" "$1"\n',
      {
        mode: 0o755,
      },
    );
    const base = await git(project.projectRoot, 'rev-parse', 'main');
    await execa('git', ['rebase', '-i', base], { cwd: lane, env: { GIT_SEQUENCE_EDITOR: editor } });
    expect(
      existsSync(path.join(await git(lane, 'rev-parse', '--absolute-git-dir'), 'rebase-merge')),
    ).toBe(true);

    const second = scriptedAdapter(WRITES, ['one.txt']);
    const { state } = await resumeAfterCrash(project, second.adapter);

    expect(state.runStatus).toBe('completed');
    expect(await mergeCommitCount(project, 'cr:one')).toBe(1);
    expect(await git(project.integrationPath, 'show', 'HEAD:one.txt')).toBe('one');
  });

  it('a lane whose removal fails after it landed does not fail the step: the work is integrated, the run completes', async () => {
    const project = await createProject('removal-fails');
    const { adapter } = scriptedAdapter(WRITES, []);
    const base = contextFor(project, { adapter });
    const ctx: RunEngineContext = {
      ...base,
      vcs: {
        ...base.vcs,
        removeLane: () => Promise.reject(new Error('the worktree is locked')),
      },
    };

    const state = await runEngine(source, {}, ctx);

    expect(state.runStatus).toBe('completed');
    expect(await git(project.integrationPath, 'show', 'HEAD:one.txt')).toBe('one');
    expect(await mergeCommitCount(project, 'cr:one')).toBe(1);
    const events = await eventsOf(project, 'run-lane');
    expect(events.some((event) => event.type === 'LaneAbandoned')).toBe(true);
    expect(ctx.laneRegistry.size).toBe(0);
  });

  it('a lane of a step that failed is re-registered by resume but never integrated', async () => {
    const project = await createProject('resume-failed');
    const failing = scriptedAdapter({}, [], {
      one: {
        text: ['half done'],
        writeFiles: [{ relativePath: 'one.txt', content: 'x\n' }],
        endReason: 'error',
        errorInfo: { code: 'X', message: 'boom' },
      },
    });
    const first = await runEngine(source, {}, contextFor(project, { adapter: failing.adapter }));
    expect(first.runStatus).toBe('failed');

    const state = await reconstructRunState(readEvents(project.projectRoot, 'run-lane'));
    expect(state.stepStatuses.get('cr:one')).toBe('failed');

    const second = scriptedAdapter(WRITES, ['one.txt']);
    const { state: resumed } = await resumeAfterCrash(project, second.adapter);

    expect(resumed.runStatus).toBe('failed');
    await expect(git(project.integrationPath, 'show', 'HEAD:one.txt')).rejects.toThrow();
    expect(await mergeCommitCount(project, 'cr:one')).toBe(0);
  });
});
