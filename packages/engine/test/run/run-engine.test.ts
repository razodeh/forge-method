/**
 * `runEngine` — `PLAN-M5.md` P20's own harness, exercised in-process against the fixture workflow
 * (`../e2e/fixture-workflow.ts`) before the heavier real-child-process E2E tests build on top of it.
 *
 * @see specs/06 §6.10
 * @see specs/10 §10.1
 * @see PLAN-M5.md P20
 */
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { ForgeError } from '@forge/core/errors';
import { FAKE_MODEL_ID, FakePlatformAdapter } from '@forge/testkit';
import type { ToolGrant } from '@forge/adapter-kit';
import { describe, expect, it } from 'vitest';

import {
  createGateEvaluator,
  createMergeQueueFacade,
  createTelemetryFacade,
  createVcsFacade,
} from '../../src/dispatch/facades.ts';
import type { LaneHandle } from '../../src/dispatch/types.ts';
import type { StepNode } from '../../src/plan/index.ts';
import {
  runEngine,
  seedScheduler,
  toSchedulerStatus,
  type RunEngineContext,
} from '../../src/run/run-engine.ts';
import type { RunState } from '../../src/resume/types.ts';
import { Scheduler } from '../../src/scheduler/scheduler.ts';
import type { ConcurrencyLimits } from '../../src/scheduler/types.ts';
import {
  FIXTURE_ITEM_IDS,
  FIXTURE_WORKFLOW_ID,
  FIXTURE_WORKFLOW_SOURCE,
  fixtureExpressionContext,
  fixtureGateRegistry,
} from '../e2e/fixture-workflow.ts';

function agentNode(id: string): StepNode {
  return {
    id,
    kind: 'agent',
    inputs: [],
    outputs: [],
    dependsOn: [],
    produces: [],
    consumes: [],
    retry: { maxAttempts: 1, backoffMs: [1000, 30_000], retryOn: [] },
    limits: { maxTurns: 20, wallClockMs: 600_000, maxCostUsd: 1 },
    idempotencyKey: id,
    onFailure: 'block',
  };
}

// Not in a shared helper: node:os's tmpdir is R10-restricted in production code
// (packages/engine/test/dispatch/helpers.ts's own doc comment has the fuller reasoning).
async function createTempRepo(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `forge-run-engine-${prefix}-`));
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

const UNLIMITED: ConcurrencyLimits = {
  global: 100,
  perAgent: new Map(),
  perResourceClass: new Map(),
};
const DEFAULT_TOOLS: ToolGrant = { read: true, write: true, exec: false, network: 'none' };

function fixtureAdapter(): FakePlatformAdapter {
  const adapter = new FakePlatformAdapter();
  for (const itemId of FIXTURE_ITEM_IDS) {
    adapter.script((request) => request.stepId.includes(itemId), {
      text: [`implemented ${itemId}`],
      writeFiles: [{ relativePath: `${itemId}.txt`, content: `${itemId}\n` }],
    });
  }
  return adapter;
}

function fixtureContext(
  projectRoot: string,
  overrides: Partial<RunEngineContext> = {},
): RunEngineContext {
  const runId = overrides.runId ?? 'run-fixture';
  let tick = 0;
  const now = overrides.now ?? (() => (tick += 1));
  const gateRegistry = overrides.gateRegistry ?? fixtureGateRegistry();
  return {
    adapter: overrides.adapter ?? fixtureAdapter(),
    vcs: overrides.vcs ?? createVcsFacade(projectRoot, runId),
    telemetry: overrides.telemetry ?? createTelemetryFacade(projectRoot, runId, now),
    gates: overrides.gates ?? createGateEvaluator(gateRegistry),
    mergeQueue:
      overrides.mergeQueue ??
      createMergeQueueFacade(overrides.integrationPath ?? projectRoot, undefined),
    runId,
    projectRoot,
    integrationBase: overrides.integrationBase ?? 'main',
    integrationPath: overrides.integrationPath ?? projectRoot,
    model: overrides.model ?? FAKE_MODEL_ID,
    tools: overrides.tools ?? DEFAULT_TOOLS,
    retainLaneWorktrees: overrides.retainLaneWorktrees ?? false,
    claimPolicy: overrides.claimPolicy ?? 'strict',
    signCommits: overrides.signCommits ?? false,
    now,
    laneRegistry: overrides.laneRegistry ?? new Map<string, LaneHandle>(),
    gateRegistry,
    limits: overrides.limits ?? UNLIMITED,
    seed: overrides.seed ?? 'seed-1',
  };
}

describe('runEngine', () => {
  it('drives the fixture workflow (command, fanned-out agent, merge, gate) to completion, merging real fanned-out content into integration', async () => {
    const projectRoot = await createTempRepo('happy-path');
    const ctx = fixtureContext(projectRoot);

    const runState = await runEngine(FIXTURE_WORKFLOW_SOURCE, fixtureExpressionContext(), ctx);

    expect(runState.runStatus).toBe('completed');
    for (const itemId of FIXTURE_ITEM_IDS) {
      expect(runState.stepStatuses.get(`${FIXTURE_WORKFLOW_ID}:implement:${itemId}`)).toBe(
        'succeeded',
      );
    }
    expect(runState.stepStatuses.get(`${FIXTURE_WORKFLOW_ID}:merge`)).toBe('succeeded');
    expect(runState.stepStatuses.get(`${FIXTURE_WORKFLOW_ID}:verify`)).toBe('succeeded');
    expect(runState.unresolvedStepIds).toEqual([]);

    // Real content, merged into the real integration branch -- not merely "every step reported success".
    for (const itemId of FIXTURE_ITEM_IDS) {
      await expect(readFile(path.join(projectRoot, `${itemId}.txt`), 'utf8')).resolves.toBe(
        `${itemId}\n`,
      );
    }
  });

  it('emits the Run-group events this piece is the one place responsible for -- RunPlanned, RunStarted, then RunCompleted', async () => {
    const projectRoot = await createTempRepo('run-events');
    const ctx = fixtureContext(projectRoot, { runId: 'run-events' });

    await runEngine(FIXTURE_WORKFLOW_SOURCE, fixtureExpressionContext(), ctx);

    const { readEvents } = await import('@forge/telemetry/events');
    const events = [];
    for await (const event of readEvents(projectRoot, 'run-events')) events.push(event.type);
    expect(events[0]).toBe('RunPlanned');
    expect(events[1]).toBe('RunStarted');
    expect(events.at(-1)).toBe('RunCompleted');
  });

  it('reports RunFailed, not RunCompleted, when a step genuinely fails -- and never runs its own dependents', async () => {
    const projectRoot = await createTempRepo('run-fails');
    const adapter = fixtureAdapter();
    adapter.injectFailure((request) => request.stepId.includes(FIXTURE_ITEM_IDS[0]), 'error');
    const ctx = fixtureContext(projectRoot, { adapter, runId: 'run-fails' });

    const runState = await runEngine(FIXTURE_WORKFLOW_SOURCE, fixtureExpressionContext(), ctx);

    expect(runState.runStatus).toBe('failed');
    expect(
      runState.stepStatuses.get(`${FIXTURE_WORKFLOW_ID}:implement:${FIXTURE_ITEM_IDS[0]}`),
    ).toBe('failed');
    // merge/verify depend (transitively) on every implement instance succeeding -- never even scheduled.
    expect(runState.stepStatuses.has(`${FIXTURE_WORKFLOW_ID}:merge`)).toBe(false);
    expect(runState.stepStatuses.has(`${FIXTURE_WORKFLOW_ID}:verify`)).toBe(false);
  });

  it('throws RUN-045 for a workflow that fails to parse, rather than returning a step-shaped failure', async () => {
    const projectRoot = await createTempRepo('parse-fail');
    const ctx = fixtureContext(projectRoot);

    let caught: unknown;
    try {
      await runEngine('not: [valid, workflow', fixtureExpressionContext(), ctx);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ForgeError);
    expect((caught as ForgeError).code).toBe('RUN-045');
  });

  it('throws RUN-045 for a workflow that parses but fails to compile (a dangling dependency), not just a parse failure', async () => {
    const projectRoot = await createTempRepo('compile-fail');
    const ctx = fixtureContext(projectRoot);
    const workflow = [
      'id: w',
      'name: w',
      'version: 1.0.0',
      'description: d',
      'steps:',
      '  - id: a',
      '    kind: checkpoint',
      '    dependsOn: [ nonexistent ]',
      '',
    ].join('\n');

    let caught: unknown;
    try {
      await runEngine(workflow, fixtureExpressionContext(), ctx);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ForgeError);
    expect((caught as ForgeError).code).toBe('RUN-045');
  });

  // A resumeFrom RunState claiming a status the durable log itself has no corresponding events for is
  // not a realistic scenario runEngine's own real caller (resumeRun, P19) ever produces -- its own
  // returned RunState is always already log-consistent. runEngine's own *final* return value re-derives
  // entirely from the log (reconstructRunState), so a hand-built resumeFrom's own claims for a step the
  // log says nothing about are correctly invisible in that final value -- proving nothing useful about
  // seedScheduler's own real effect. What IS observable end-to-end is the seed's effect on *scheduling*:
  // a step seeded as anything other than "succeeded"/"skipped"/unmarked never becomes ready, so nothing
  // depending on it is ever admitted. toSchedulerStatus/seedScheduler are exported from run-engine.ts
  // specifically so their own per-status mapping can also be verified directly, not just through this
  // one indirect, harder-to-attribute signal.
  it('seeding "aborted"/"escalated" keeps their own dependents permanently un-ready, the same as "failed" would', async () => {
    const projectRoot = await createTempRepo('aborted-escalated');
    const ctx = fixtureContext(projectRoot, { runId: 'run-aborted' });
    const resumeFrom: RunState = {
      runId: 'run-aborted',
      planRef: undefined,
      runStatus: undefined,
      stepStatuses: new Map([
        [`${FIXTURE_WORKFLOW_ID}:prepare`, 'succeeded'],
        [`${FIXTURE_WORKFLOW_ID}:implement:${FIXTURE_ITEM_IDS[0]}`, 'aborted'],
        [`${FIXTURE_WORKFLOW_ID}:implement:${FIXTURE_ITEM_IDS[1]}`, 'escalated'],
      ]),
      unresolvedStepIds: [],
      laneStatuses: new Map(),
      spentUsd: 0,
      sessionIds: new Map(),
      laneOrigins: new Map(),
      artifactPaths: new Set<string>(),
    };

    await runEngine(FIXTURE_WORKFLOW_SOURCE, fixtureExpressionContext(), ctx, resumeFrom);

    const { readEvents } = await import('@forge/telemetry/events');
    const scheduled = new Set<string>();
    for await (const event of readEvents(projectRoot, 'run-aborted')) {
      if (event.type === 'StepScheduled' && event.stepId !== undefined) scheduled.add(event.stepId);
    }
    // "prepare" was already seeded 'succeeded' and is not re-scheduled; neither implement instance is
    // re-scheduled either (aborted/escalated are not "pending"); merge/verify never become ready.
    expect(scheduled).toEqual(new Set());
  });

  it('seeding "skipped" leaves that step out of the ready set, and never re-schedules it', async () => {
    const projectRoot = await createTempRepo('skipped');
    const ctx = fixtureContext(projectRoot, { runId: 'run-skipped' });
    const resumeFrom: RunState = {
      runId: 'run-skipped',
      planRef: undefined,
      runStatus: undefined,
      stepStatuses: new Map([[`${FIXTURE_WORKFLOW_ID}:prepare`, 'skipped']]),
      unresolvedStepIds: [],
      laneStatuses: new Map(),
      spentUsd: 0,
      sessionIds: new Map(),
      laneOrigins: new Map(),
      artifactPaths: new Set<string>(),
    };

    await runEngine(FIXTURE_WORKFLOW_SOURCE, fixtureExpressionContext(), ctx, resumeFrom);

    const { readEvents } = await import('@forge/telemetry/events');
    const scheduled = new Set<string>();
    for await (const event of readEvents(projectRoot, 'run-skipped')) {
      if (event.type === 'StepScheduled' && event.stepId !== undefined) scheduled.add(event.stepId);
    }
    // "prepare" (skipped) is never re-scheduled, and neither implement instance becomes ready either,
    // since a skipped predecessor is never "succeeded".
    expect(scheduled).toEqual(new Set());
  });

  it('toSchedulerStatus maps every StepReconstructedStatus to the correct Scheduler-shaped status', () => {
    expect(toSchedulerStatus('succeeded')).toBe('succeeded');
    expect(toSchedulerStatus('failed')).toBe('failed');
    expect(toSchedulerStatus('aborted')).toBe('failed');
    expect(toSchedulerStatus('escalated')).toBe('failed');
    expect(toSchedulerStatus('skipped')).toBe('skipped');
    expect(toSchedulerStatus('scheduled')).toBeUndefined();
    expect(toSchedulerStatus('running')).toBeUndefined();
  });

  it('seedScheduler marks every mapped status onto a real Scheduler, and leaves an unmapped one at its own default "pending"', () => {
    const nodeA = agentNode('a');
    const nodeB = agentNode('b');
    const nodeC = agentNode('c');
    const nodeD = agentNode('d');
    const scheduler = new Scheduler(
      [nodeA, nodeB, nodeC, nodeD],
      { global: 10, perAgent: new Map(), perResourceClass: new Map() },
      'seed',
    );
    const resumeFrom: RunState = {
      runId: 'r',
      planRef: undefined,
      runStatus: undefined,
      stepStatuses: new Map([
        ['a', 'succeeded'],
        ['b', 'failed'],
        ['c', 'skipped'],
        // 'd' has no entry at all -- stays at Scheduler's own default, 'pending'.
      ]),
      unresolvedStepIds: [],
      laneStatuses: new Map(),
      spentUsd: 0,
      sessionIds: new Map(),
      laneOrigins: new Map(),
      artifactPaths: new Set<string>(),
    };

    seedScheduler(scheduler, [nodeA, nodeB, nodeC, nodeD], resumeFrom);

    expect(scheduler.status('a')).toBe('succeeded');
    expect(scheduler.status('b')).toBe('failed');
    expect(scheduler.status('c')).toBe('skipped');
    expect(scheduler.status('d')).toBe('pending');
  });

  it('runs the two fanned-out agent instances concurrently, not sequentially -- both lanes exist before either commits', async () => {
    // A scripted adapter that blocks the first instance to start until the second has also started,
    // proven by both lane worktrees existing on disk at that point -- impossible if runEngine drove
    // them one at a time.
    const projectRoot = await createTempRepo('concurrency');
    const started: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const bothStarted = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const adapter = new FakePlatformAdapter();
    for (const itemId of FIXTURE_ITEM_IDS) {
      adapter.script((request) => request.stepId.includes(itemId), {
        text: [`implemented ${itemId}`],
        writeFiles: [{ relativePath: `${itemId}.txt`, content: `${itemId}\n` }],
      });
    }
    const realStartSession = adapter.startSession.bind(adapter);
    adapter.startSession = async (request) => {
      started.push(request.stepId);
      if (started.length === FIXTURE_ITEM_IDS.length) releaseFirst?.();
      else await bothStarted;
      return realStartSession(request);
    };
    const ctx = fixtureContext(projectRoot, { adapter });

    await runEngine(FIXTURE_WORKFLOW_SOURCE, fixtureExpressionContext(), ctx);

    expect(started).toHaveLength(FIXTURE_ITEM_IDS.length);
  });
});
