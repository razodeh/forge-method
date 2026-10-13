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
import { describe, expect, it, vi } from 'vitest';

import {
  createGateEvaluator,
  createMergeQueueFacade,
  createTelemetryFacade,
  createVcsFacade,
} from '../../src/dispatch/facades.ts';
import type { LaneHandle } from '../../src/dispatch/types.ts';
import { sessionRecordText } from '../dispatch/artifact-fixtures.ts';
import { createFixtureAssembly } from '../dispatch/helpers.ts';
import * as planIndexModule from '../../src/plan/index.ts';
import type { StepNode } from '../../src/plan/index.ts';
import { reconstructRunState } from '../../src/resume/reconstruct.ts';
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
    assembly: overrides.assembly ?? createFixtureAssembly(projectRoot),
    retainLaneWorktrees: overrides.retainLaneWorktrees ?? false,
    claimPolicy: overrides.claimPolicy ?? 'strict',
    signCommits: overrides.signCommits ?? false,
    now,
    laneRegistry: overrides.laneRegistry ?? new Map<string, LaneHandle>(),
    gateRegistry,
    limits: overrides.limits ?? UNLIMITED,
    seed: overrides.seed ?? 'seed-1',
    externalKbIds: overrides.externalKbIds,
    // specs/22 M17 P10 (#3): found while independently testing the write-ahead ordering below -- this
    // field was missing from this object literal entirely, so every `sleep:` override passed to this
    // helper anywhere in this file (several pre-existing tests included) was silently dropped, and
    // `ctx.sleep` fell through to `RunEngineContext`'s own real-timer default regardless. Those tests
    // still passed (a real short backoff is still fast enough not to time out), which is exactly why
    // this went unnoticed rather than failing loudly -- the identical class of silent, undisclosed cost
    // a critic separately measured in lane-integration.test.ts/stacked-lanes.test.ts.
    ...(overrides.sleep === undefined ? {} : { sleep: overrides.sleep }),
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
    // `specs/22` M17 P10 (#3): the fixture's own `implement` step has no explicit `retry:` override, so
    // it carries the compiled default (`maxAttempts: 3`, every class retryable) -- a single one-shot
    // `injectFailure` is no longer "genuinely, permanently failed" now that retry wiring is real: the
    // very next attempt would hit this adapter's own ordinary, always-registered `.script()` and
    // succeed. Injected three times (the compiled ceiling) so every attempt this step could possibly
    // make fails, regardless of whether the never-retry rule's own two-identical-signatures check
    // escalates it sooner.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      adapter.injectFailure((request) => request.stepId.includes(FIXTURE_ITEM_IDS[0]), 'error');
    }
    const ctx = fixtureContext(projectRoot, {
      adapter,
      runId: 'run-fails',
      // A fast, deterministic stand-in for the real backoff delay (specs/22 M17 P10's own `ctx.sleep`
      // seam) -- this test cares about the run's own final shape, not wall-clock timing.
      sleep: () => Promise.resolve(),
    });

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

  // `PLAN-M14.md` P30: `RunEngineContext.externalKbIds` is the real compile site (`run-engine.ts`'s own
  // `compileRunPlan` call) -- this is what the mandate's own mutation-evidence text calls out by name
  // ("set not passed at run-engine.ts:320: dry-run passes, runEngine fails"). Spied rather than proved
  // end to end through a tainted grant reaching the adapter (`security/taint-grant.test.ts` already
  // proves the grant side of taint end to end for a hand-tainted node; this is the one thing that test
  // cannot reach: whether THIS field is the one that got there). The real `compileRunPlan` still runs
  // (`mockImplementation` calls the captured original), so the rest of the run proceeds normally.
  it("passes ctx.externalKbIds through to compileRunPlan's own taint.externalKbIds option", async () => {
    const projectRoot = await createTempRepo('external-kb-ids');
    const originalCompileRunPlan = planIndexModule.compileRunPlan;
    const spy = vi
      .spyOn(planIndexModule, 'compileRunPlan')
      .mockImplementation((wf, context, options) => originalCompileRunPlan(wf, context, options));
    try {
      const externalKbIds = new Set(['KB-EXT-0001']);
      const ctx = fixtureContext(projectRoot, { externalKbIds });
      const workflow = [
        'id: w',
        'name: w',
        'version: 1.0.0',
        'description: d',
        'steps:',
        '  - id: a',
        '    kind: agent',
        '    agent: engineer',
        '    brief: do the thing',
        "    inputs: [ 'kb:KB-EXT-0001' ]",
        '',
      ].join('\n');

      await runEngine(workflow, {}, ctx);

      expect(spy).toHaveBeenCalled();
      expect(spy.mock.calls[0]?.[2]).toEqual({ taint: { externalKbIds } });
    } finally {
      spy.mockRestore();
    }
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

  describe('driveToCompletion retry wiring (specs/22 M17 P10) (#3)', () => {
    it('a transient (adapter) failure is retried, and the run completes once the retry succeeds', async () => {
      const projectRoot = await createTempRepo('retry-succeeds');
      const adapter = fixtureAdapter();
      // One-shot: the next startSession call matching story-1 fails; every call after it (the retry
      // included) reaches fixtureAdapter's own ordinary, always-registered .script().
      adapter.injectFailure((request) => request.stepId.includes(FIXTURE_ITEM_IDS[0]), 'error');
      const runId = 'run-retry-succeeds';
      const ctx = fixtureContext(projectRoot, { adapter, runId, sleep: () => Promise.resolve() });

      const runState = await runEngine(FIXTURE_WORKFLOW_SOURCE, fixtureExpressionContext(), ctx);

      expect(runState.runStatus).toBe('completed');
      expect(
        runState.stepStatuses.get(`${FIXTURE_WORKFLOW_ID}:implement:${FIXTURE_ITEM_IDS[0]}`),
      ).toBe('succeeded');
      const { readEvents } = await import('@forge/telemetry/events');
      const stepId = `${FIXTURE_WORKFLOW_ID}:implement:${FIXTURE_ITEM_IDS[0]}`;
      const relevant: string[] = [];
      for await (const event of readEvents(projectRoot, runId)) {
        if (event.stepId === stepId) relevant.push(event.type);
      }
      expect(relevant).toContain('StepRetried');
      expect(relevant.filter((type) => type === 'StepFailed')).toHaveLength(1);
      expect(relevant.filter((type) => type === 'StepSucceeded')).toHaveLength(1);
      // A fresh lane for the retry's own attempt: LaneCreated fires twice for this one step id, not once.
      expect(relevant.filter((type) => type === 'LaneCreated')).toHaveLength(2);
    });

    it('a repeated, byte-identical failure signature escalates after exactly two attempts (the never-retry rule), never reaching the compiled default’s own third', async () => {
      const projectRoot = await createTempRepo('retry-escalates');
      const stepId = `${FIXTURE_WORKFLOW_ID}:implement:${FIXTURE_ITEM_IDS[0]}`;
      const adapter = fixtureAdapter();
      // `FakePlatformAdapter.injectFailure('error')` reports a fixed {code: 'INJECTED_FAILURE',
      // message: 'a failure was injected for this request'} every time (confirmed directly against
      // its own source, startInjectedFailure) -- no variable content at all, so two injections
      // normalise to byte-identical signatures without needing a real, deterministic session failure
      // of its own to engineer one.
      adapter.injectFailure((request) => request.stepId.includes(FIXTURE_ITEM_IDS[0]), 'error');
      adapter.injectFailure((request) => request.stepId.includes(FIXTURE_ITEM_IDS[0]), 'error');
      const runId = 'run-retry-escalates';
      const ctx = fixtureContext(projectRoot, { adapter, runId, sleep: () => Promise.resolve() });

      const runState = await runEngine(FIXTURE_WORKFLOW_SOURCE, fixtureExpressionContext(), ctx);

      expect(runState.runStatus).toBe('failed');
      expect(runState.stepStatuses.get(stepId)).toBe('failed');

      const { readEvents } = await import('@forge/telemetry/events');
      const relevant: string[] = [];
      for await (const event of readEvents(projectRoot, runId)) {
        if (event.stepId === stepId) relevant.push(event.type);
      }
      // Two attempts, never a third: the never-retry rule escalated on the second IDENTICAL failure,
      // not on exhausting the compiled default's own maxAttempts (3) -- a third injectFailure would
      // simply sit unconsumed if this piece's own wiring regressed to "always retry to the ceiling".
      expect(relevant.filter((type) => type === 'StepFailed')).toHaveLength(2);
      expect(relevant.filter((type) => type === 'StepRetried')).toHaveLength(1);
      expect(relevant.filter((type) => type === 'LaneCreated')).toHaveLength(2);
    });

    it('retry spend is attributed per step: a failed first attempt and a paid, successful retry each leave their own UsageRecorded entry under the one step id, summable', async () => {
      const projectRoot = await createTempRepo('retry-attribution');
      const stepId = `${FIXTURE_WORKFLOW_ID}:implement:${FIXTURE_ITEM_IDS[0]}`;
      const adapter = fixtureAdapter();
      // The first attempt genuinely fails (endReason: 'error') but still reports a real, non-zero
      // cost -- `s9-budget-enforcement.test.ts`'s own "emits UsageRecorded even when the session
      // itself reports failure -- real tokens were still spent" is exactly this shape; a plain
      // injectFailure() reports usage: emptyUsage() instead (confirmed directly against its own
      // source), which would leave this one attempt with nothing to sum.
      let attempt = 0;
      const realStartSession = adapter.startSession.bind(adapter);
      adapter.startSession = (request) => {
        if (!request.stepId.includes(FIXTURE_ITEM_IDS[0])) return realStartSession(request);
        attempt += 1;
        const scripted = new FakePlatformAdapter();
        scripted.script(
          () => true,
          attempt === 1
            ? {
                text: ['a paid failure'],
                costUsd: 0.1,
                endReason: 'error',
                errorInfo: { code: 'SCRIPTED_FAILURE', message: 'a paid failure, for this test' },
              }
            : {
                text: [`implemented ${FIXTURE_ITEM_IDS[0]}`],
                writeFiles: [
                  {
                    relativePath: `${FIXTURE_ITEM_IDS[0]}.txt`,
                    content: `${FIXTURE_ITEM_IDS[0]}\n`,
                  },
                ],
                costUsd: 0.35,
              },
        );
        return scripted.startSession(request);
      };
      const runId = 'run-retry-attribution';
      const ctx = fixtureContext(projectRoot, { adapter, runId, sleep: () => Promise.resolve() });

      const runState = await runEngine(FIXTURE_WORKFLOW_SOURCE, fixtureExpressionContext(), ctx);

      expect(runState.runStatus).toBe('completed');
      expect(runState.stepStatuses.get(stepId)).toBe('succeeded');
      expect(attempt).toBe(2);

      const { readEvents } = await import('@forge/telemetry/events');
      const usageEntries: number[] = [];
      for await (const event of readEvents(projectRoot, runId)) {
        if (event.stepId !== stepId || event.type !== 'UsageRecorded') continue;
        const payload = event.payload as { readonly costUsd?: number };
        usageEntries.push(payload.costUsd ?? 0);
      }
      // One real UsageRecorded per real attempt -- never collapsed into one, never dropped. This is
      // the real gap `s9-budget-enforcement.test.ts`'s own disclosure names: before this piece, no
      // real `driveToCompletion` retry ever produced a second entry for one stepId at all.
      expect(usageEntries).toHaveLength(2);
      expect(usageEntries.reduce((sum, costUsd) => sum + costUsd, 0)).toBeCloseTo(0.45, 5);
    });

    it('resume mid-retry is deterministic: a crash right after StepRetried (before the fresh attempt it authorises ever runs) still reaches the identical, completed final state on resume', async () => {
      const projectRoot = await createTempRepo('retry-resume');
      const runId = 'run-retry-resume';
      const stepId = `${FIXTURE_WORKFLOW_ID}:implement:${FIXTURE_ITEM_IDS[0]}`;
      const adapter = fixtureAdapter();
      adapter.injectFailure((request) => request.stepId.includes(FIXTURE_ITEM_IDS[0]), 'error');
      const baseCtx = fixtureContext(projectRoot, {
        adapter,
        runId,
        sleep: () => Promise.resolve(),
      });
      // Simulated crash: the first StepScheduled for this step id AFTER its own StepRetried has
      // already been durably recorded (the retry's own fresh re-dispatch) never happens -- the
      // identical "crash between a durable event and the side effect it authorises" shape
      // stacked-lanes.test.ts's own `crashingContext` already proves resume recovers from, adapted here
      // to this step's own retry rather than a join's own LaneCreated.
      let retried = false;
      let crashed = false;
      const crashingCtx: RunEngineContext = {
        ...baseCtx,
        telemetry: {
          emit: async (event) => {
            if (event.stepId === stepId && event.type === 'StepRetried') retried = true;
            if (!crashed && retried && event.stepId === stepId && event.type === 'StepScheduled') {
              crashed = true;
              throw new Error(`simulated crash resuming the retry of ${stepId}`);
            }
            return baseCtx.telemetry.emit(event);
          },
        },
      };

      await expect(
        runEngine(FIXTURE_WORKFLOW_SOURCE, fixtureExpressionContext(), crashingCtx),
      ).rejects.toThrow(`simulated crash resuming the retry of ${stepId}`);

      const { readEvents } = await import('@forge/telemetry/events');
      const beforeCrash: string[] = [];
      for await (const event of readEvents(projectRoot, runId)) beforeCrash.push(event.type);
      // StepRetried really did land durably; the retry's own fresh StepScheduled never did.
      expect(beforeCrash).toContain('StepRetried');
      expect(
        beforeCrash.filter(
          (type, index) =>
            type === 'StepScheduled' && index > beforeCrash.lastIndexOf('StepRetried'),
        ),
      ).toHaveLength(0);

      const resumeFrom = await reconstructRunState(readEvents(projectRoot, runId));
      expect(resumeFrom.stepStatuses.get(stepId)).toBe('scheduled');

      const secondAdapter = fixtureAdapter();
      const resumeCtx = fixtureContext(projectRoot, {
        adapter: secondAdapter,
        runId,
        sleep: () => Promise.resolve(),
      });
      const finalState = await runEngine(
        FIXTURE_WORKFLOW_SOURCE,
        fixtureExpressionContext(),
        resumeCtx,
        resumeFrom,
      );

      expect(finalState.runStatus).toBe('completed');
      expect(finalState.stepStatuses.get(stepId)).toBe('succeeded');
      const finalTypes: string[] = [];
      for await (const event of readEvents(projectRoot, runId)) {
        if (event.stepId === stepId) finalTypes.push(event.type);
      }
      // The never-retry rule's own history is unbroken by the crash: exactly one StepRetried total
      // (from before the crash), never a second, spurious one triggered by losing track of the first
      // attempt's own failure across the resume boundary.
      expect(finalTypes.filter((type) => type === 'StepRetried')).toHaveLength(1);
      expect(finalTypes.filter((type) => type === 'StepFailed')).toHaveLength(1);
      expect(finalTypes.filter((type) => type === 'StepSucceeded')).toHaveLength(1);
    });
  });

  describe('a fresh run after partial integration (specs/22 M17 P10) (defect D)', () => {
    // One agent step declaring a real output -- the shape every real RUN-083 collision needs (a step
    // with nothing declared is never exposed to it at all).
    const REUSE_WORKFLOW = [
      'id: reuse-wf',
      'name: reuse-wf',
      'version: 1.0.0',
      'description: d',
      'steps:',
      '  - id: a',
      '    kind: agent',
      '    agent: engineer',
      '    brief: do the thing',
      '    outputs: [{ type: SessionRecord, subtype: retrospective }]',
      '',
    ].join('\n');

    function sessionWritingAdapter(sessionId = 'SESSION-001'): FakePlatformAdapter {
      const adapter = new FakePlatformAdapter();
      adapter.script(() => true, {
        text: ['a retrospective'],
        writeFiles: [
          {
            relativePath: `docs/forge/sessions/${sessionId}.md`,
            content: sessionRecordText('retro', sessionId),
          },
        ],
      });
      return adapter;
    }

    function countingAdapter(): { readonly adapter: FakePlatformAdapter; count: number } {
      const adapter = new FakePlatformAdapter();
      const state = { adapter, count: 0 };
      const realStartSession = adapter.startSession.bind(adapter);
      adapter.startSession = async (request) => {
        state.count += 1;
        return realStartSession(request);
      };
      return state;
    }

    it('a fresh run (different runId) whose predecessor already integrated this step -- but never itself reached RunCompleted -- reuses it, never dispatching a second session', async () => {
      // specs/22 M17 P10 (defect D) is specifically "a fresh run after PARTIAL integration": the
      // predecessor must NOT have reached RunCompleted, or there is no "partial" about it -- a single-
      // step workflow whose one step succeeds also completes the WHOLE run, which is a different,
      // excluded scenario (the next test in this describe proves the exclusion directly). This fixture
      // therefore has a second step after `a` that genuinely fails, so `stateA.runStatus` is 'failed'
      // while `a` itself still succeeded and landed on the integration branch.
      const TWO_STEP_WORKFLOW = [
        'id: reuse-wf2',
        'name: reuse-wf2',
        'version: 1.0.0',
        'description: d',
        'steps:',
        '  - id: a',
        '    kind: agent',
        '    agent: engineer',
        '    brief: do the thing',
        '    outputs: [{ type: SessionRecord, subtype: retrospective }]',
        '  - id: b',
        '    kind: agent',
        '    agent: engineer',
        '    brief: a later step this run never gets past',
        '    dependsOn: [a]',
        '',
      ].join('\n');
      const projectRoot = await createTempRepo('reuse-happy');

      const adapterA = sessionWritingAdapter();
      // `b` carries the compiled default (maxAttempts: 3); three injections exhaust every attempt it
      // could possibly make, so run A ends 'failed' with `b` never having succeeded, while `a` -- never
      // targeted by these injections -- still runs its own, ordinary `.script()` and succeeds.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        adapterA.injectFailure((request) => request.stepId.includes(':b'), 'error');
      }
      const ctxA = fixtureContext(projectRoot, {
        runId: 'run-a',
        adapter: adapterA,
        sleep: () => Promise.resolve(),
      });
      const stateA = await runEngine(TWO_STEP_WORKFLOW, {}, ctxA);
      expect(stateA.runStatus).toBe('failed');
      expect(stateA.stepStatuses.get('reuse-wf2:a')).toBe('succeeded');
      expect(stateA.stepStatuses.get('reuse-wf2:b')).toBe('failed');

      // A fresh run (run-b) of the identical workflow: `a` must be reused (no second session), `b` must
      // run for real (it never succeeded anywhere) and this time its own script lets it succeed too.
      const tracked = countingAdapter();
      tracked.adapter.script((request) => request.stepId.includes(':b'), {
        text: ['b succeeds this time'],
      });
      const ctxB = fixtureContext(projectRoot, { runId: 'run-b', adapter: tracked.adapter });

      const stateB = await runEngine(TWO_STEP_WORKFLOW, {}, ctxB);

      expect(stateB.runStatus).toBe('completed');
      expect(stateB.stepStatuses.get('reuse-wf2:a')).toBe('succeeded');
      expect(stateB.stepStatuses.get('reuse-wf2:b')).toBe('succeeded');
      // Exactly one real session this run (b's) -- a's own reuse never calls startSession at all.
      expect(tracked.count).toBe(1);

      const { readEvents } = await import('@forge/telemetry/events');
      const aEventsB: string[] = [];
      for await (const event of readEvents(projectRoot, 'run-b')) {
        if (event.stepId === 'reuse-wf2:a') aEventsB.push(event.type);
      }
      expect(aEventsB).not.toContain('StepStarted');
      expect(aEventsB).not.toContain('LaneCreated');
      expect(aEventsB).toContain('StepSucceeded');
    });

    it('a prior run that reached RunCompleted is NEVER reused by a later, independent invocation of the identical workflow -- even though the step id recurs', async () => {
      // The exact shape packages/cli/test/commands/run/kb-output-ids.test.ts proved live, reproduced
      // here at the engine level: compiled step ids are pure functions of the workflow definition, so
      // running the SAME workflow twice as two separate, deliberate invocations recomputes the identical
      // id both times. A predecessor that reached RunCompleted is a finished, independent unit of work,
      // not a partial one -- reusing anything from it would silently skip a later, independent run's own
      // real output check.
      const projectRoot = await createTempRepo('reuse-excludes-completed');

      const ctxA = fixtureContext(projectRoot, {
        runId: 'run-a',
        adapter: sessionWritingAdapter(),
      });
      const stateA = await runEngine(REUSE_WORKFLOW, {}, ctxA);
      expect(stateA.runStatus).toBe('completed');

      const tracked = countingAdapter();
      tracked.adapter.script(() => true, { text: ['a genuinely fresh attempt'] });
      const ctxB = fixtureContext(projectRoot, {
        runId: 'run-b',
        adapter: tracked.adapter,
        sleep: () => Promise.resolve(),
      });

      const stateB = await runEngine(REUSE_WORKFLOW, {}, ctxB);

      // Falls through to a real session -- run A's own success is never reused, since run A itself
      // already reached RunCompleted. The real session's own script writes nothing matching the
      // declared output, so this is a genuine RUN-083 (validation-class) failure, not a reuse -- and,
      // correctly, retried once under this piece's own retry wiring (#3) before escalating, since the
      // identical empty-write failure repeats byte-for-byte: two real sessions, never zero.
      expect(stateB.runStatus).toBe('failed');
      expect(tracked.count).toBe(2);
    });

    it("supersedes cleanly when the predecessor's own output no longer validates: a real session runs and the step succeeds for real", async () => {
      const projectRoot = await createTempRepo('reuse-supersede');

      const ctxA = fixtureContext(projectRoot, {
        runId: 'run-a',
        adapter: sessionWritingAdapter(),
      });
      await runEngine(REUSE_WORKFLOW, {}, ctxA);

      // Invalidate the predecessor's own landed output directly on the trunk (main) -- the reuse
      // probe's own historical-base check must then fail, falling through to a real, fresh session.
      await execa('git', ['rm', '-q', 'docs/forge/sessions/SESSION-001.md'], { cwd: projectRoot });
      await execa('git', ['commit', '--quiet', '-m', 'remove the session record'], {
        cwd: projectRoot,
      });

      const tracked = countingAdapter();
      tracked.adapter.script(() => true, {
        text: ['a retrospective, again'],
        writeFiles: [
          {
            relativePath: 'docs/forge/sessions/SESSION-002.md',
            content: sessionRecordText('retro', 'SESSION-002'),
          },
        ],
      });
      const ctxB = fixtureContext(projectRoot, { runId: 'run-b', adapter: tracked.adapter });

      const stateB = await runEngine(REUSE_WORKFLOW, {}, ctxB);

      expect(stateB.runStatus).toBe('completed');
      expect(stateB.stepStatuses.get('reuse-wf:a')).toBe('succeeded');
      expect(tracked.count).toBe(1);
    });

    it('a step that failed on the ONE prior run to attempt it (never succeeded there either) is never reused: a real session runs', async () => {
      const projectRoot = await createTempRepo('reuse-no-prior-success');

      const failingAdapter = new FakePlatformAdapter();
      failingAdapter.injectFailure(() => true, 'error');
      failingAdapter.injectFailure(() => true, 'error');
      failingAdapter.injectFailure(() => true, 'error');
      const ctxA = fixtureContext(projectRoot, {
        runId: 'run-a',
        adapter: failingAdapter,
        sleep: () => Promise.resolve(),
      });
      const stateA = await runEngine(REUSE_WORKFLOW, {}, ctxA);
      expect(stateA.runStatus).toBe('failed');

      const tracked = countingAdapter();
      tracked.adapter.script(() => true, {
        text: ['a retrospective'],
        writeFiles: [
          {
            relativePath: 'docs/forge/sessions/SESSION-001.md',
            content: sessionRecordText('retro'),
          },
        ],
      });
      const ctxB = fixtureContext(projectRoot, { runId: 'run-b', adapter: tracked.adapter });

      const stateB = await runEngine(REUSE_WORKFLOW, {}, ctxB);

      expect(stateB.runStatus).toBe('completed');
      expect(tracked.count).toBe(1);
    });

    it('a historical success recorded under a DIFFERENT step definition -- the same workflow/step id, but an edited agent and brief -- is never reused: the edited definition runs for real', async () => {
      // BLOCKING, found by a critic after the RunCompleted fix above: that fix excludes any candidate
      // run that itself completed, but says nothing about a candidate that genuinely never completed (a
      // real "partial integration") whose own step DEFINITION has since been edited. Compiled step ids
      // (`compileStepId`) are pure functions of a workflow's `id`s alone, never of its `agent`/`brief`/
      // `outputs` text -- so editing a step's own authored content between two runs, while keeping its
      // id and its workflow's id the same, recomputes the IDENTICAL step id both times, exactly like the
      // RunCompleted scenario, but now for a predecessor that is genuinely, legitimately partial.
      const projectRoot = await createTempRepo('reuse-definition-changed');

      const OLD_DEFINITION = [
        'id: reuse-wf3',
        'name: reuse-wf3',
        'version: 1.0.0',
        'description: d',
        'steps:',
        '  - id: a',
        '    kind: agent',
        '    agent: engineer',
        '    brief: do the thing, the old way',
        '    outputs: [{ type: SessionRecord, subtype: retrospective }]',
        '  - id: b',
        '    kind: agent',
        '    agent: engineer',
        '    brief: a later step this run never gets past',
        '    dependsOn: [a]',
        '',
      ].join('\n');
      // SAME workflow id, SAME step id `a`, but a materially different `agent` AND `brief` -- the exact
      // scenario a critic named: "someone edits the project's own workflow YAML... a materially
      // different brief/agent." Step `b` is dropped entirely (a materially different WORKFLOW, not just
      // a materially different step `a`): the earlier, partial run only ever needed `b` to exist long
      // enough to keep run A from completing, and this run's own completion depends only on `a`.
      const NEW_DEFINITION = [
        'id: reuse-wf3',
        'name: reuse-wf3',
        'version: 1.0.0',
        'description: d',
        'steps:',
        '  - id: a',
        '    kind: agent',
        '    agent: architect',
        '    brief: do a materially different thing, the new way',
        '    outputs: [{ type: SessionRecord, subtype: retrospective }]',
        '',
      ].join('\n');

      const adapterA = sessionWritingAdapter();
      for (let attempt = 0; attempt < 3; attempt += 1) {
        adapterA.injectFailure((request) => request.stepId.includes(':b'), 'error');
      }
      const ctxA = fixtureContext(projectRoot, {
        runId: 'run-a',
        adapter: adapterA,
        sleep: () => Promise.resolve(),
      });
      const stateA = await runEngine(OLD_DEFINITION, {}, ctxA);
      expect(stateA.runStatus).toBe('failed');
      expect(stateA.stepStatuses.get('reuse-wf3:a')).toBe('succeeded');

      // A fresh, independent run under the EDITED definition: `a` recurs with the identical compiled id
      // (`reuse-wf3:a`), but its own authored content changed. It must get a real session -- never
      // silently inherit run A's success, which was real work for a DIFFERENT agent/brief.
      const tracked = countingAdapter();
      tracked.adapter.script(() => true, {
        text: ['a materially different retrospective'],
        writeFiles: [
          {
            relativePath: 'docs/forge/sessions/SESSION-002.md',
            content: sessionRecordText('retro', 'SESSION-002'),
          },
        ],
      });
      const ctxB = fixtureContext(projectRoot, { runId: 'run-b', adapter: tracked.adapter });

      const stateB = await runEngine(NEW_DEFINITION, {}, ctxB);

      expect(stateB.runStatus).toBe('completed');
      expect(stateB.stepStatuses.get('reuse-wf3:a')).toBe('succeeded');
      // The decisive assertion: a REAL session ran for the edited definition's own step `a`, rather
      // than zero (what a fingerprint-blind reuse mechanism would produce here).
      expect(tracked.count).toBe(1);

      const { readEvents } = await import('@forge/telemetry/events');
      const aEventsB: string[] = [];
      for await (const event of readEvents(projectRoot, 'run-b')) {
        if (event.stepId === 'reuse-wf3:a') aEventsB.push(event.type);
      }
      expect(aEventsB).toContain('StepStarted');
      expect(aEventsB).toContain('LaneCreated');
    });

    it('an agent step with NO declared outputs is never "reused" off an unrelated historical success for its step id: a fresh run always gets a real session for it', async () => {
      // MAJOR, mutation-confirmed: `findReusableSuccess`'s very first guard
      // (`if (node.outputs.length === 0) return undefined`) is today the ONLY thing stopping a
      // zero-output agent step (legal today -- a review/notify-only step, `06` §6.2) from being
      // silently, permanently "reused" off any unrelated historical success recorded for its step id. A
      // critic found that deleting that one line leaves the full dispatch/run suites (1044+ tests) all
      // still green -- nothing before this test ever exercised a zero-output step reaching this path at
      // all.
      const projectRoot = await createTempRepo('reuse-zero-outputs');
      const ZERO_OUTPUT_WORKFLOW = [
        'id: reuse-wf4',
        'name: reuse-wf4',
        'version: 1.0.0',
        'description: d',
        'steps:',
        '  - id: a',
        '    kind: agent',
        '    agent: engineer',
        '    brief: review only, nothing declared',
        '    outputs: []',
        '  - id: b',
        '    kind: agent',
        '    agent: engineer',
        '    brief: a later step this run never gets past',
        '    dependsOn: [a]',
        '',
      ].join('\n');

      const adapterA = new FakePlatformAdapter();
      adapterA.script((request) => request.stepId.includes(':a'), {
        text: ['reviewed, nothing to declare'],
      });
      for (let attempt = 0; attempt < 3; attempt += 1) {
        adapterA.injectFailure((request) => request.stepId.includes(':b'), 'error');
      }
      const ctxA = fixtureContext(projectRoot, {
        runId: 'run-a',
        adapter: adapterA,
        sleep: () => Promise.resolve(),
      });
      const stateA = await runEngine(ZERO_OUTPUT_WORKFLOW, {}, ctxA);
      expect(stateA.runStatus).toBe('failed');
      expect(stateA.stepStatuses.get('reuse-wf4:a')).toBe('succeeded');

      const tracked = countingAdapter();
      tracked.adapter.script((request) => request.stepId.includes(':a'), {
        text: ['reviewed again, for real'],
      });
      tracked.adapter.script((request) => request.stepId.includes(':b'), {
        text: ['b succeeds this time'],
      });
      const ctxB = fixtureContext(projectRoot, { runId: 'run-b', adapter: tracked.adapter });
      const stateB = await runEngine(ZERO_OUTPUT_WORKFLOW, {}, ctxB);

      expect(stateB.runStatus).toBe('completed');
      // Both `a` and `b` ran for real this time -- neither was skipped/reused.
      expect(tracked.count).toBe(2);

      const { readEvents } = await import('@forge/telemetry/events');
      const aEventsB: string[] = [];
      for await (const event of readEvents(projectRoot, 'run-b')) {
        if (event.stepId === 'reuse-wf4:a') aEventsB.push(event.type);
      }
      expect(aEventsB).toContain('StepStarted');
    });
  });

  describe('retry write-ahead ordering, independently tested (specs/22 M17 P10) (#3)', () => {
    it('StepRetried is durably recorded BEFORE the backoff sleep is ever called, not merely before the run eventually ends: a probe placed inside sleep itself can tell the two orderings apart', async () => {
      // MAJOR, mutation-confirmed: the existing "resume mid-retry is deterministic" test (above) crashes
      // on a telemetry event TYPE being emitted -- it cannot distinguish emit-then-sleep from
      // sleep-then-emit, since `sleep` there is mocked to resolve immediately either way and nothing
      // ever inspects state DURING it. A critic found that swapping the real production ordering
      // (sleep first, emit after) leaves all 41 retry/budget tests green. This test makes `sleep` ITSELF
      // the probe: the very first thing it does, every time `driveToCompletion` calls it, is read the
      // run's own durable event log back off disk. `StepRetried` can only already be there if the write
      // genuinely happened BEFORE this call -- not just "before the run eventually ends."
      const projectRoot = await createTempRepo('retry-wal-ordering');
      const stepId = `${FIXTURE_WORKFLOW_ID}:implement:${FIXTURE_ITEM_IDS[0]}`;
      const adapter = fixtureAdapter();
      adapter.injectFailure((request) => request.stepId.includes(FIXTURE_ITEM_IDS[0]), 'error');
      const runId = 'run-retry-wal-ordering';
      let sawRetriedBeforeSleep: boolean | undefined;
      let sleepCalls = 0;
      const ctx = fixtureContext(projectRoot, {
        adapter,
        runId,
        sleep: async () => {
          sleepCalls += 1;
          const { readEvents } = await import('@forge/telemetry/events');
          let found = false;
          for await (const event of readEvents(projectRoot, runId)) {
            if (event.stepId === stepId && event.type === 'StepRetried') found = true;
          }
          sawRetriedBeforeSleep = found;
          return Promise.resolve();
        },
      });

      const runState = await runEngine(FIXTURE_WORKFLOW_SOURCE, fixtureExpressionContext(), ctx);

      expect(runState.runStatus).toBe('completed');
      expect(sleepCalls).toBe(1);
      expect(sawRetriedBeforeSleep).toBe(true);
    });
  });
});
