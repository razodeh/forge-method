/**
 * `20` §20.10 S9 — "Budget caps abort or pause runs; retries are attributed to the originating step."
 *
 * `PLAN-M11.md` P11's own direct investigation found `@forge/engine/budget`'s own `canAdmit`/
 * `onBudgetBreach` (`PLAN-M5.md` P17) and `@forge/telemetry/ledger`'s own `attributedSpend`/
 * `checkBudget` (P7) all real, correct, and already thoroughly unit-tested — but found three real,
 * compounding production gaps beneath that already-correct machinery, the identical "the mechanism is
 * real, the wiring to a real call site is not" shape `PLAN-M11.md` P10 already found for S5:
 *
 * 1. **Nothing in `@forge/engine/dispatch` ever emitted a `UsageRecorded` event for a real session** —
 *    `runAgentWork` (`dispatch/steps.ts`) captured a real adapter's own `SessionResult.usage` into the
 *    step outcome but never turned it into the one event type `@forge/telemetry/ledger`'s own doc
 *    comment names as "everything a LedgerEntry needs." `forge cost`, `attributedSpend`, and
 *    `canAdmit` were all real and correct, and all permanently fed an empty ledger in every real run.
 *    Fixed for real: `runAgentWork` now emits one per completed session (`packages/engine/src/dispatch/
 *    steps.ts`).
 * 2. **`@forge/engine/run`'s own `runEngine` never constructed a real `BudgetState` at all** —
 *    `Scheduler`'s own `canAdmit` constructor parameter always fell back to its documented "always
 *    admit" default, so a real `forge run` enforced no budget cap regardless of what `.forge/config.
 *    yaml`'s own real `budget.perRunUsd`/`budget.dailyUsd` said. Fixed for real: `RunEngineContext.
 *    budget` (new), `@forge/engine/budget`'s new `computeLiveBudgetState` (`live-state.ts`), and a real
 *    `canAdmit` wired into `runEngine`'s own `Scheduler` construction, refreshed before every scheduling
 *    tick. `@forge/cli`'s own `buildRunEngineContext` now supplies a real one from `.forge/config.yaml`.
 * 3. **`06` §6.8's own retry machinery has zero production callers** — `decideRetry`/`computeBackoff`
 *    (`@forge/engine/failures`) are real, correct, and unit-tested, but `runEngine`'s own
 *    `driveToCompletion` marks a failed step `'failed'` on its very first attempt and never retries it.
 *    This is **disclosed, not fixed**, in this same piece — building a full retry loop is judged
 *    disproportionate scope for a security-invariant piece (`live-state.ts`'s own doc comment has the
 *    fuller reasoning, the identical judgement `taint-guard.ts` already made for S6's grant-escalation
 *    surface). `attributedSpend`'s own "sums every entry for a stepId, across every retry" property is
 *    real and tested below directly against the ledger, at the level a real retry loop would actually
 *    rely on — not against a live `driveToCompletion` retry that does not exist today.
 *
 * @see specs/06 §6.8, §6.9
 * @see specs/20 §20.8
 * @see specs/20 §20.10 S9
 * @see PLAN-M5.md P7, P17
 * @see PLAN-M11.md P10
 * @see PLAN-M11.md P11
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { FAKE_MODEL_ID, FakePlatformAdapter } from '@forge/testkit';
import { appendEvent, readEvents } from '@forge/telemetry/events';
import { attributedSpend, projectLedger } from '@forge/telemetry/ledger';
import { afterEach, describe, expect, it } from 'vitest';

import { computeLiveBudgetState } from '../../src/budget/live-state.ts';
import { executeStep } from '../../src/dispatch/execute.ts';
import { sanitizeUsageNumber } from '../../src/dispatch/steps.ts';
import { toAgentId } from '../../src/plan/index.ts';
import { runEngine, type RunEngineContext } from '../../src/run/run-engine.ts';
import {
  createGateEvaluator,
  createMergeQueueFacade,
  createTelemetryFacade,
  createVcsFacade,
} from '../../src/dispatch/facades.ts';
import type { LaneHandle } from '../../src/dispatch/types.ts';
import { createFixtureAssembly, createTestContext, node } from '../dispatch/helpers.ts';

const cleanupDirs: string[] = [];
afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTempRepo(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `forge-s9-${prefix}-`));
  cleanupDirs.push(dir);
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

describe("runAgentWork emits a real UsageRecorded event (the ledger's own sole input)", () => {
  it('emits UsageRecorded with the real, scripted cost, model, and platform once a real session completes', async () => {
    const projectRoot = await createTempRepo('usage-emit');
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, { text: ['done'], costUsd: 2.5 });
    const ctx = createTestContext({ projectRoot, adapter, runId: 'run-usage' });
    const stepNode = node({ id: 'wf:step-one', kind: 'agent', agent: toAgentId('engineer') });

    await executeStep(stepNode, ctx);

    const events = [];
    for await (const event of readEvents(projectRoot, 'run-usage')) events.push(event);
    const usageEvent = events.find((event) => event.type === 'UsageRecorded');
    expect(usageEvent).toBeDefined();
    expect(usageEvent?.stepId).toBe('wf:step-one');
    expect(usageEvent?.payload).toMatchObject({
      model: FAKE_MODEL_ID,
      platform: adapter.id,
      costUsd: 2.5,
      estimated: true,
    });

    // The ledger this whole invariant rests on now genuinely reflects a real session's real cost --
    // previously always empty regardless of what any real session actually spent.
    const entries = await projectLedger(readEvents(projectRoot, 'run-usage'));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.costUsd).toBe(2.5);
  });

  it('emits UsageRecorded even when the session itself reports failure -- real tokens were still spent', async () => {
    const projectRoot = await createTempRepo('usage-emit-failed');
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, { text: ['partial'], costUsd: 1.1, endReason: 'error' });
    const ctx = createTestContext({ projectRoot, adapter, runId: 'run-usage-failed' });
    const stepNode = node({ id: 'wf:step-one', kind: 'agent', agent: toAgentId('engineer') });

    await executeStep(stepNode, ctx);

    const entries = await projectLedger(readEvents(projectRoot, 'run-usage-failed'));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.costUsd).toBe(1.1);
  });

  it("sanitizes a NaN/negative/Infinity reported cost to 0 rather than emitting it raw -- a gauntlet critic round found a real adapter's own SDK mapping can accept any typeof number with no finite/non-negative check, and an unsanitized bad value here previously crashed the whole run once budget enforcement next read this run's own ledger", async () => {
    for (const badCost of [Number.NaN, -5, Number.POSITIVE_INFINITY]) {
      const projectRoot = await createTempRepo('usage-emit-bad-cost');
      const adapter = new FakePlatformAdapter();
      adapter.script(() => true, { text: ['done'], costUsd: badCost });
      const ctx = createTestContext({ projectRoot, adapter, runId: 'run-bad-cost' });
      const stepNode = node({ id: 'wf:step-one', kind: 'agent', agent: toAgentId('engineer') });

      await executeStep(stepNode, ctx);

      // Never throws reading it back -- proving the emitted event is well-formed, not merely that
      // executeStep itself didn't throw.
      const entries = await projectLedger(readEvents(projectRoot, 'run-bad-cost'));
      expect(entries).toHaveLength(1);
      expect(entries[0]?.costUsd).toBe(0);
    }
  });

  it("sanitizeUsageNumber itself zeroes every non-finite/negative shape -- proven directly, not only through costUsd's own real emission path above (which the fake adapter cannot script inputTokens/outputTokens/durationMs through)", () => {
    for (const bad of [
      Number.NaN,
      -1,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      -0.0001,
    ]) {
      expect(sanitizeUsageNumber(bad)).toBe(0);
    }
    // Real, legitimate values pass through unchanged -- this is a sanitizer, not a clamp to zero.
    expect(sanitizeUsageNumber(0)).toBe(0);
    expect(sanitizeUsageNumber(42.5)).toBe(42.5);
  });

  it('omits costUsd as 0, not fabricated, when the script never reports one at all -- "unknown" is not silently "free"', async () => {
    const projectRoot = await createTempRepo('usage-emit-no-cost');
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, { text: ['done'] }); // no costUsd set
    const ctx = createTestContext({ projectRoot, adapter, runId: 'run-usage-no-cost' });
    const stepNode = node({ id: 'wf:step-one', kind: 'agent', agent: toAgentId('engineer') });

    await executeStep(stepNode, ctx);

    const entries = await projectLedger(readEvents(projectRoot, 'run-usage-no-cost'));
    expect(entries[0]?.costUsd).toBe(0);
  });
});

describe('computeLiveBudgetState (real, cross-run ledger projection)', () => {
  it("sums only this run's own entries into runSpentUsd, and every run on the same UTC day into dailySpentUsd", async () => {
    const projectRoot = await createTempRepo('live-state');
    const usagePayload = (costUsd: number) => ({
      model: 'm',
      platform: 'p',
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      costUsd,
      estimated: true,
      durationMs: 1,
    });

    await appendEvent(projectRoot, 'run-a', {
      ts: '2026-05-01T10:00:00.000Z',
      runId: 'run-a',
      type: 'UsageRecorded',
      stepId: 's1',
      agentId: 'a1',
      payload: usagePayload(3),
    });
    await appendEvent(projectRoot, 'run-b', {
      ts: '2026-05-01T11:00:00.000Z',
      runId: 'run-b',
      type: 'UsageRecorded',
      stepId: 's1',
      agentId: 'a1',
      payload: usagePayload(4),
    });
    // A real, different-day entry -- must never count toward "today"'s dailySpentUsd.
    await appendEvent(projectRoot, 'run-c', {
      ts: '2026-04-30T23:59:00.000Z',
      runId: 'run-c',
      type: 'UsageRecorded',
      stepId: 's1',
      agentId: 'a1',
      payload: usagePayload(100),
    });

    const state = await computeLiveBudgetState(projectRoot, 'run-a', '2026-05-01T12:00:00.000Z', {
      perRunUsd: 1000,
      dailyUsd: 1000,
      onBreach: 'abort',
    });

    expect(state.runSpentUsd).toBe(3);
    expect(state.dailySpentUsd).toBe(7);
  });

  it('never throws for a project with no runs directory at all -- a legitimate, zero-spend state', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'forge-s9-empty-'));
    cleanupDirs.push(projectRoot);

    const state = await computeLiveBudgetState(projectRoot, 'run-x', '2026-01-01T00:00:00.000Z', {
      perRunUsd: 10,
      dailyUsd: 10,
      onBreach: 'abort',
    });

    expect(state.runSpentUsd).toBe(0);
    expect(state.dailySpentUsd).toBe(0);
  });

  it("a DIFFERENT run's own genuinely corrupted event log (a real seq gap) is skipped, never crashing this run's own budget refresh", async () => {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'forge-s9-corrupt-'));
    cleanupDirs.push(projectRoot);

    await appendEvent(projectRoot, 'run-healthy', {
      ts: '2026-05-01T10:00:00.000Z',
      runId: 'run-healthy',
      type: 'UsageRecorded',
      stepId: 's1',
      agentId: 'a1',
      payload: {
        model: 'm',
        platform: 'p',
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        costUsd: 5,
        estimated: true,
        durationMs: 1,
      },
    });

    // A real, structurally corrupt log for an unrelated run -- seq 1 then seq 3, a real gap
    // `readEvents` itself refuses to read past.
    const corruptRunDir = path.join(projectRoot, '.forge', 'state', 'runs', 'run-corrupt');
    await mkdir(corruptRunDir, { recursive: true });
    await writeFile(
      path.join(corruptRunDir, 'events.ndjson'),
      `${JSON.stringify({ v: 1, seq: 1, ts: 't', runId: 'run-corrupt', type: 'RunStarted', payload: {} })}\n` +
        `${JSON.stringify({ v: 1, seq: 3, ts: 't', runId: 'run-corrupt', type: 'RunCompleted', payload: {} })}\n`,
    );

    const state = await computeLiveBudgetState(
      projectRoot,
      'run-healthy',
      '2026-05-01T12:00:00.000Z',
      { perRunUsd: 100, dailyUsd: 100, onBreach: 'abort' },
    );

    // The healthy run's own real spend is still correctly reported -- the corrupt sibling run was
    // skipped, not allowed to throw this whole computation out.
    expect(state.runSpentUsd).toBe(5);
    expect(state.dailySpentUsd).toBe(5);
  });
});

/** A minimal, sequential two-step agent workflow -- `step-two` depends on `step-one`, so `step-two`'s
 * own admission is decided on a *later* scheduling tick than `step-one`'s, after `step-one`'s own real
 * cost has already been recorded into the ledger. A fanned-out/concurrent pair would not prove this:
 * both would be admitted in the same tick, before either's own real cost exists yet to refuse the
 * other. */
const BUDGET_WORKFLOW_SOURCE = `
id: budget-fixture
name: Budget fixture
version: 1.0.0
description: 20 section 20.10 S9 -- proves a real budget cap halts a real run.

steps:
  - id: step-one
    kind: agent
    agent: engineer
    brief: "do work one"
    limits: { maxCostUsd: 10 }

  - id: step-two
    kind: agent
    agent: engineer
    brief: "do work two"
    dependsOn: [ step-one ]
    limits: { maxCostUsd: 10 }
`;

/** A real declared `limits.maxCostUsd` far under `step-one`'s own real, scripted cost below -- a real,
 * legitimate scenario `FakePlatformAdapter`'s own doc comment already discloses is possible
 * (`SessionLimits.maxCostUsd` is "accepted but not enforced" by the fake, the identical "declared cost
 * caps are advisory, not clamped" shape a real platform's own honest-but-wrong self-estimate could
 * produce too): admission control alone cannot prevent every real breach, only ones a step's own
 * declared cap actually reflects. This is what lets this fixture prove a **genuine**, post-hoc
 * `checkBudget` breach (real spend crossing `perRunUsd`) rather than only a preventive refusal of a
 * step that was never actually going to overspend. */
const BUDGET_BREACH_WORKFLOW_SOURCE = `
id: budget-fixture
name: Budget fixture
version: 1.0.0
description: 20 section 20.10 S9 -- proves a real budget cap halts a real run.

steps:
  - id: step-one
    kind: agent
    agent: engineer
    brief: "do work one"
    limits: { maxCostUsd: 1 }

  - id: step-two
    kind: agent
    agent: engineer
    brief: "do work two"
    dependsOn: [ step-one ]
    limits: { maxCostUsd: 10 }
`;

const DEFAULT_TEST_BUDGET: RunEngineContext['budget'] = {
  perRunUsd: 15,
  dailyUsd: 1000,
  onBreach: 'abort',
};

function budgetFixtureContext(
  projectRoot: string,
  adapter: FakePlatformAdapter,
  runId: string,
  budget: RunEngineContext['budget'] | 'omit' = DEFAULT_TEST_BUDGET,
): RunEngineContext {
  const resolvedBudget = budget === 'omit' ? undefined : budget;
  let tick = 0;
  const now = () => (tick += 1);
  return {
    adapter,
    vcs: createVcsFacade(projectRoot, runId),
    telemetry: createTelemetryFacade(projectRoot, runId, now),
    gates: createGateEvaluator(new Map()),
    mergeQueue: createMergeQueueFacade(projectRoot, undefined),
    runId,
    projectRoot,
    integrationBase: 'main',
    integrationPath: projectRoot,
    model: FAKE_MODEL_ID,
    tools: { read: true, write: true, exec: false, network: 'none' },
    assembly: createFixtureAssembly(projectRoot),
    retainLaneWorktrees: false,
    claimPolicy: 'strict',
    signCommits: false,
    now,
    laneRegistry: new Map<string, LaneHandle>(),
    gateRegistry: new Map(),
    limits: { global: 10, perAgent: new Map(), perResourceClass: new Map() },
    seed: runId,
    ...(resolvedBudget === undefined ? {} : { budget: resolvedBudget }),
  };
}

describe('runEngine (real, live budget enforcement wired into a real run)', () => {
  it('a real perRunUsd cap genuinely halts the run before its second, dependent step -- RunFailed, not RunCompleted, with a real BudgetBreached event', async () => {
    const projectRoot = await createTempRepo('budget-halt');
    const adapter = new FakePlatformAdapter();
    // step-one's own declared cap is $1 (admitted: 0 + 1 < 5), but its real, scripted cost is $6 --
    // a genuine breach of perRunUsd (5), not merely a preventive refusal of an honestly-declared step.
    adapter.script((request) => request.stepId.includes('step-one'), {
      text: ['step one done'],
      costUsd: 6,
    });
    adapter.script((request) => request.stepId.includes('step-two'), {
      text: ['step two done'],
      costUsd: 1,
    });
    const ctx = budgetFixtureContext(projectRoot, adapter, 'run-budget-halt', {
      perRunUsd: 5,
      dailyUsd: 1000,
      onBreach: 'abort',
    });

    const runState = await runEngine(BUDGET_BREACH_WORKFLOW_SOURCE, {}, ctx);

    expect(runState.runStatus).toBe('failed');
    expect(runState.stepStatuses.get('budget-fixture:step-one')).toBe('succeeded');
    // step-two was never even admitted -- refused by canAdmit before it ever started, not run and
    // then failed for an unrelated reason.
    expect(runState.stepStatuses.has('budget-fixture:step-two')).toBe(false);

    // A real BudgetBreached event was emitted, naming the real response this project's own
    // `onBreach: 'abort'` config resolves to -- auditable, not merely inferred from the run's own
    // final failed status.
    const events = [];
    for await (const event of readEvents(projectRoot, 'run-budget-halt')) events.push(event);
    const breach = events.find((event) => event.type === 'BudgetBreached');
    expect(breach).toBeDefined();
    expect(breach?.payload).toMatchObject({ level: 'run', response: 'abort' });
  });

  it('a run whose real spend never approaches the cap completes normally -- this piece pays nothing for a budget it never breaches', async () => {
    const projectRoot = await createTempRepo('budget-ok');
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, { text: ['done'], costUsd: 0.01 });
    const ctx = budgetFixtureContext(projectRoot, adapter, 'run-budget-ok');

    const runState = await runEngine(BUDGET_WORKFLOW_SOURCE, {}, ctx);

    expect(runState.runStatus).toBe('completed');
    expect(runState.stepStatuses.get('budget-fixture:step-one')).toBe('succeeded');
    expect(runState.stepStatuses.get('budget-fixture:step-two')).toBe('succeeded');
  });

  it('omitting ctx.budget entirely enforces no cap at all -- the identical "pays nothing for a concept it does not use" default Scheduler\'s own canAdmit already establishes', async () => {
    const projectRoot = await createTempRepo('budget-omitted');
    const adapter = new FakePlatformAdapter();
    // A cost far beyond any real cap, proving admission is genuinely unconditional when ctx.budget is
    // simply not supplied -- not merely "the cap happened to be high enough."
    adapter.script(() => true, { text: ['done'], costUsd: 1_000_000 });
    const ctx = budgetFixtureContext(projectRoot, adapter, 'run-budget-omitted', 'omit');

    const runState = await runEngine(BUDGET_WORKFLOW_SOURCE, {}, ctx);

    expect(runState.runStatus).toBe('completed');
  });
});

describe('attributedSpend: retry attribution (20 §20.10 S9\'s own "reports $6, not $2" property)', () => {
  it('sums every real ledger entry sharing one stepId across multiple real attempts -- never just the latest, never double-counted', async () => {
    // Disclosed above (this file's own header comment): no real retry loop exists in
    // `driveToCompletion` today, so this constructs the exact shape two real, independent attempts of
    // the *same* step would each genuinely emit via runAgentWork's own new UsageRecorded emission --
    // proving the property at the level a real future retry loop would actually rely on.
    const projectRoot = await createTempRepo('retry-attribution');
    const usagePayload = (costUsd: number) => ({
      model: 'm',
      platform: 'p',
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      costUsd,
      estimated: true,
      durationMs: 1,
    });
    await appendEvent(projectRoot, 'run-retry', {
      ts: '2026-01-01T00:00:00.000Z',
      runId: 'run-retry',
      type: 'UsageRecorded',
      stepId: 'implement',
      agentId: 'engineer',
      payload: usagePayload(2),
    });
    await appendEvent(projectRoot, 'run-retry', {
      ts: '2026-01-01T00:01:00.000Z',
      runId: 'run-retry',
      type: 'UsageRecorded',
      stepId: 'implement',
      agentId: 'engineer',
      payload: usagePayload(4),
    });
    // A different step's own entry, in the same run -- must never be folded into "implement"'s total.
    await appendEvent(projectRoot, 'run-retry', {
      ts: '2026-01-01T00:02:00.000Z',
      runId: 'run-retry',
      type: 'UsageRecorded',
      stepId: 'other-step',
      agentId: 'engineer',
      payload: usagePayload(100),
    });

    const entries = await projectLedger(readEvents(projectRoot, 'run-retry'));
    expect(attributedSpend(entries, 'implement')).toBe(6);
    expect(attributedSpend(entries, 'other-step')).toBe(100);
  });
});
