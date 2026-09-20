/**
 * A run that admission control refuses must say why (`PLAN-M13.md` P12, `Q208` findings 1 and 2), through
 * the same `BudgetBreached` machinery a spend breach uses (`06` §6.9, `20` §20.8, `18` §18.4), and the
 * reservation it checks is the agent's own ceiling, and nothing for a step that costs nothing.
 *
 * The shipped `retro` workflow (agent `em`, `max_cost_usd: 3`, then `command` `forge kb sync`) is the
 * reproduction: it was refused below about $2.75 (the placeholder charged to the command step) instead of
 * below the agent's own ceiling.
 *
 * @see specs/06 §6.3, §6.9
 * @see specs/18 §18.4
 * @see specs/20 §20.8
 */
import { mkdtemp, readFile, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { ForgeError } from '@forge/core/errors';
import { FakePlatformAdapter } from '@forge/testkit';
import { readEvents } from '@forge/telemetry/events';
import type { ForgeEvent } from '@forge/telemetry/events';
import { loadAgentDefinition } from '@forge/agents/schema';
import { afterEach, describe, expect, it } from 'vitest';

import type { BudgetConfig } from '../../src/budget/index.ts';
import { runEngine, type RunEngineContext } from '../../src/run/run-engine.ts';
import { createFixtureAssembly, createTestContext, fixtureAgent } from '../dispatch/helpers.ts';

const REPO = path.resolve(import.meta.dirname, '../../../..');
const RETRO_SOURCE = await readFile(
  path.join(REPO, 'packages/templates/templates/workflows/retro.workflow.yaml'),
  'utf8',
);
const EM_SOURCE = await readFile(path.join(REPO, 'modules/fm-core/agents/em.agent.yaml'), 'utf8');

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempRepo(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `forge-budget-refusal-${prefix}-`));
  cleanup.push(dir);
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

/** A `PATH` whose first entry holds a `forge` that exits 0: the shipped `forge kb sync` step needs one. */
async function fakeForgeEnv(): Promise<Record<string, string>> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-fake-bin-'));
  cleanup.push(dir);
  const file = path.join(dir, 'forge');
  await writeFile(file, '#!/bin/sh\nexit 0\n');
  await chmod(file, 0o755);
  return { PATH: `${dir}${path.delimiter}${process.env['PATH'] ?? ''}` };
}

async function events(projectRoot: string, runId: string): Promise<ForgeEvent[]> {
  const all: ForgeEvent[] = [];
  for await (const event of readEvents(projectRoot, runId)) all.push(event);
  return all;
}

function emAgent() {
  const parsed = loadAgentDefinition(EM_SOURCE, 'em.agent.yaml');
  if (!parsed.success) throw new Error('shipped em agent does not parse');
  return parsed.agent;
}

async function runRetro(
  budget: Partial<BudgetConfig> & { readonly perRunUsd: number },
  options: { readonly costUsd?: number } = {},
) {
  const projectRoot = await tempRepo('retro');
  const adapter = new FakePlatformAdapter();
  adapter.script(() => true, { text: ['a retrospective'], costUsd: options.costUsd ?? 0.4 });
  const agent = emAgent();
  const base = createTestContext({
    projectRoot,
    adapter,
    runId: 'run-retro',
    assembly: createFixtureAssembly(projectRoot, {
      loadAgent: (id) => Promise.resolve(id === 'em' ? agent : fixtureAgent(id)),
    }),
  });
  const ctx: RunEngineContext = {
    ...base,
    limits: { global: 4, perAgent: new Map(), perResourceClass: new Map() },
    seed: 'seed',
    commandEnv: await fakeForgeEnv(),
    budget: { dailyUsd: 100, onBreach: 'pause', ...budget },
  };
  const runState = await runEngine(RETRO_SOURCE, {}, ctx);
  return { runState, log: await events(projectRoot, 'run-retro') };
}

describe('the shipped retro workflow under a per-run budget', () => {
  it("reads the agent's own ceiling from the shipped em agent: 3, not the compile placeholder", () => {
    expect(emAgent().limits.max_cost_usd).toBe(3);
  });

  it("is admitted when perRunUsd is just above the agent's ceiling (the command step reserves nothing)", async () => {
    const { log } = await runRetro({ perRunUsd: 3.01 });
    const scheduled = log.filter((e) => e.type === 'StepScheduled').map((e) => e.stepId);
    expect(scheduled).toContain('retro:run-retro');
    expect(log.some((e) => e.type === 'BudgetBreached')).toBe(false);
  });

  it('charges the command step nothing: with $0.02 left after the agent, `forge kb sync` is still admitted', async () => {
    // Not the shipped retro workflow: its agent step now also owes declared outputs (a separate check),
    // which would fail the fake session before the command step. Same shape, no declared outputs.
    const projectRoot = await tempRepo('command-free');
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, { text: ['done'], costUsd: 2.99 });
    const agent = emAgent();
    const base = createTestContext({
      projectRoot,
      adapter,
      runId: 'run-free',
      assembly: createFixtureAssembly(projectRoot, { loadAgent: () => Promise.resolve(agent) }),
    });
    const ctx: RunEngineContext = {
      ...base,
      limits: { global: 4, perAgent: new Map(), perResourceClass: new Map() },
      seed: 'seed',
      commandEnv: await fakeForgeEnv(),
      budget: { perRunUsd: 3.01, dailyUsd: 100, onBreach: 'pause' },
    };
    const source = `
id: free
name: Agent then command
version: 1.0.0
description: a costly agent step then a free command step
levels: [L0]
steps:
  - id: think
    kind: agent
    agent: em
    brief: briefs/run-retro.md
  - id: sync
    kind: command
    run: 'forge kb sync'
    inline: true
    dependsOn: [think]
`;
    const runState = await runEngine(source, {}, ctx);
    // Spent $2.99 of $3.01: $0.02 left, far below the old $2 placeholder a command step was charged.
    expect(runState.runStatus).toBe('completed');
    expect(runState.stepStatuses.get('free:sync')).toBe('succeeded');
    expect(runState.runFailure).toBeUndefined();
  });

  it("is refused, with the reason recorded, when perRunUsd is just below the agent's ceiling", async () => {
    const { runState, log } = await runRetro({ perRunUsd: 2.99 });

    expect(log.some((e) => e.type === 'StepScheduled')).toBe(false);
    expect(runState.runStatus).toBe('failed');

    const breach = log.find((e) => e.type === 'BudgetBreached');
    expect(breach?.payload).toEqual({
      trigger: 'admission',
      level: 'run',
      capUsd: 2.99,
      spentUsd: 0,
      reservationUsd: 3,
      stepId: 'retro:run-retro',
      refusedSteps: 1,
      response: 'pause',
      applied: 'run-stopped',
    });
    expect(breach?.stepId).toBe('retro:run-retro');

    const failed = log.find((e) => e.type === 'RunFailed');
    expect(failed?.payload).toMatchObject({
      reason: 'budget',
      failedSteps: [],
      failedTotal: 0,
      unfinishedTotal: 2,
    });
    // The breach precedes the failure it explains.
    expect(log.indexOf(breach!)).toBeLessThan(log.indexOf(failed!));

    expect(runState.runFailure?.reason).toBe('budget');
    expect(runState.runFailure?.message).toContain('retro:run-retro reserves $3.00');
    expect(runState.runFailure?.unfinished.map((u) => [u.stepId, u.cause.kind])).toEqual([
      ['retro:run-retro', 'budget'],
      ['retro:write-back-kb', 'dependency-unfinished'],
    ]);
  });

  it("reports onBudgetBreach's own response for the level: `abort` when the project says abort", async () => {
    const { log } = await runRetro({ perRunUsd: 1, onBreach: 'abort' });
    expect(log.find((e) => e.type === 'BudgetBreached')?.payload).toMatchObject({
      level: 'run',
      response: 'abort',
    });
  });

  it('names the daily cap and reports `refuse-new-run` when the period budget is what refuses', async () => {
    const { runState, log } = await runRetro({ perRunUsd: 100, dailyUsd: 2 });
    expect(log.find((e) => e.type === 'BudgetBreached')?.payload).toMatchObject({
      level: 'period',
      capUsd: 2,
      reservationUsd: 3,
      response: 'refuse-new-run',
    });
    expect(runState.runFailure?.message).toContain('daily budget (budget.dailyUsd)');
  });
});

describe('a transient failure resolving the step ceilings', () => {
  it('fails the run on the record, with a reason and RunStarted, instead of leaving it eventless', async () => {
    const projectRoot = await tempRepo('resolver-fails');
    const base = createTestContext({
      projectRoot,
      runId: 'run-resolver',
      assembly: createFixtureAssembly(projectRoot, {
        loadAgent: () =>
          Promise.reject(new ForgeError('RUN-034', { operation: 'read', path: 'em.yaml' })),
      }),
    });
    const ctx: RunEngineContext = {
      ...base,
      limits: { global: 4, perAgent: new Map(), perResourceClass: new Map() },
      seed: 'seed',
    };
    const runState = await runEngine(RETRO_SOURCE, {}, ctx);
    const log = await events(projectRoot, 'run-resolver');
    expect(log.map((e) => e.type)).toEqual(['RunPlanned', 'RunStarted', 'RunFailed']);
    expect(runState.runStatus).toBe('failed');
    expect(runState.runFailure?.reason).toBe('setup');
    expect(runState.runFailure?.message).toContain('could not be resolved');
  });
});

describe('the remedy works: raise the budget, then resume', () => {
  it('a run refused for budget completes when resumed under a budget that covers its reservation', async () => {
    const projectRoot = await tempRepo('resume-after-raise');
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, { text: ['done'], costUsd: 0.1 });
    const agent = emAgent();
    const base = createTestContext({
      projectRoot,
      adapter,
      runId: 'run-raise',
      assembly: createFixtureAssembly(projectRoot, { loadAgent: () => Promise.resolve(agent) }),
    });
    const contextWith = (perRunUsd: number): RunEngineContext => ({
      ...base,
      limits: { global: 4, perAgent: new Map(), perResourceClass: new Map() },
      seed: 'seed',
      budget: { perRunUsd, dailyUsd: 100, onBreach: 'pause' },
    });
    const source = `
id: raise
name: Agent then command
version: 1.0.0
description: refused, then resumed under a larger budget
levels: [L0]
steps:
  - id: think
    kind: agent
    agent: em
    brief: briefs/run-retro.md
  - id: after
    kind: command
    run: 'true'
    inline: true
    dependsOn: [think]
`;
    const refused = await runEngine(source, {}, contextWith(2));
    expect(refused.runStatus).toBe('failed');
    expect(refused.runFailure?.reason).toBe('budget');

    const resumed = await runEngine(source, {}, contextWith(10), refused);
    expect(resumed.runStatus).toBe('completed');
    expect(resumed.runFailure).toBeUndefined();
    expect(resumed.stepStatuses.get('raise:think')).toBe('succeeded');
    expect(resumed.stepStatuses.get('raise:after')).toBe('succeeded');
    // One admission breach, recorded once: the resumed run did not add another.
    const breaches = (await events(projectRoot, 'run-raise')).filter(
      (e) => e.type === 'BudgetBreached',
    );
    expect(breaches).toHaveLength(1);
  });
});

describe('a run never fails without a reason', () => {
  it('records a reason when the scheduler can admit nothing for a non-budget cause (concurrency 0)', async () => {
    const projectRoot = await tempRepo('zero-concurrency');
    const base = createTestContext({ projectRoot, runId: 'run-zero' });
    const ctx: RunEngineContext = {
      ...base,
      limits: { global: 0, perAgent: new Map(), perResourceClass: new Map() },
      seed: 'seed',
    };
    const runState = await runEngine(RETRO_SOURCE, {}, ctx);
    expect(runState.runStatus).toBe('failed');
    expect(runState.runFailure?.reason).toBe('no-admissible-step');
    expect(runState.runFailure?.message).toContain('the global concurrency limit is 0');
    expect(runState.runFailure?.unfinishedTotal).toBe(2);
  });

  it('records the failed step and its blocked dependents when a step fails', async () => {
    const projectRoot = await tempRepo('step-failed');
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, { text: ['partial'], endReason: 'error' });
    const base = createTestContext({ projectRoot, adapter, runId: 'run-fail' });
    const ctx: RunEngineContext = {
      ...base,
      limits: { global: 4, perAgent: new Map(), perResourceClass: new Map() },
      seed: 'seed',
    };
    const runState = await runEngine(RETRO_SOURCE, {}, ctx);
    expect(runState.runFailure?.reason).toBe('step-failed');
    expect(runState.runFailure?.failedSteps).toEqual(['retro:run-retro']);
    expect(runState.runFailure?.unfinished).toEqual([
      {
        stepId: 'retro:write-back-kb',
        cause: { kind: 'dependency-failed', dependencyId: 'retro:run-retro' },
      },
    ]);
  });
});

describe('admission counts the steps it has already admitted this tick', () => {
  it('does not admit two steps that each fit the remaining budget alone but not together', async () => {
    const projectRoot = await tempRepo('co-admission');
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, { text: ['ok'], costUsd: 0.1 });
    const agent = fixtureAgent('worker', {
      limits: { max_turns: 10, wall_clock_ms: 600_000, max_cost_usd: 2 },
    });
    const base = createTestContext({
      projectRoot,
      adapter,
      runId: 'run-co',
      assembly: createFixtureAssembly(projectRoot, { loadAgent: () => Promise.resolve(agent) }),
    });
    const ctx: RunEngineContext = {
      ...base,
      limits: { global: 4, perAgent: new Map(), perResourceClass: new Map() },
      seed: 'seed',
      budget: { perRunUsd: 3, dailyUsd: 100, onBreach: 'pause' },
    };
    const source = `
id: two
name: Two workers
version: 1.0.0
description: two independent agent steps
levels: [L0]
steps:
  - id: one
    kind: agent
    agent: worker
    brief: briefs/one.md
  - id: two
    kind: agent
    agent: worker
    brief: briefs/two.md
`;
    const runState = await runEngine(source, {}, ctx);
    const log = await events(projectRoot, 'run-co');

    // Both eventually run (one after the other): $0.10 spent leaves room for the second $2 reservation.
    expect(runState.runStatus).toBe('completed');
    const first = log.find((e) => e.type === 'StepSucceeded');
    const scheduled = log.filter((e) => e.type === 'StepScheduled');
    expect(scheduled).toHaveLength(2);
    // The second was not scheduled until the first had finished: had both been admitted together, up to
    // $4 could have been in flight against a $3 cap.
    expect(log.indexOf(scheduled[1]!)).toBeGreaterThan(log.indexOf(first!));
  });
});
