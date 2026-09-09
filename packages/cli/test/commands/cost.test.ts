/**
 * `forge cost` — a real, project-wide spend report over `@forge/telemetry`'s own cost ledger.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { appendEvent, type NewForgeEvent } from '@forge/telemetry/events';
import type { UsageRecordedPayload } from '@forge/telemetry/ledger';

import { costForStep, costReport } from '../../src/commands/cost.ts';
import { cleanupAll, createTestProject } from './upgrade/helpers.ts';

afterEach(cleanupAll);

function usagePayload(overrides: Partial<UsageRecordedPayload> = {}): UsageRecordedPayload {
  return {
    model: 'test-model-1',
    platform: 'anthropic',
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    costUsd: 0.5,
    estimated: false,
    durationMs: 1000,
    ...overrides,
  };
}

function usageEvent(overrides: Partial<NewForgeEvent> = {}): NewForgeEvent {
  return {
    ts: '2026-01-01T00:00:00.000Z',
    runId: 'run-1',
    type: 'UsageRecorded',
    stepId: 'story-014:implement',
    agentId: 'engineer',
    payload: usagePayload(),
    ...overrides,
  };
}

describe('costReport', () => {
  it('reports zero real spend for a real project with no runs at all', async () => {
    const project = await createTestProject();
    const report = await costReport({
      paths: project.paths,
      projectRoot: project.dir,
      config: project.config,
    });
    expect(report.totalUsd).toBe(0);
    expect(report.byRun.size).toBe(0);
  });

  it('sums real UsageRecorded spend across every real run, grouped by run/agent/model', async () => {
    const project = await createTestProject();
    await appendEvent(
      project.dir,
      'run-1',
      usageEvent({ payload: usagePayload({ costUsd: 1.5 }) }),
    );
    await appendEvent(
      project.dir,
      'run-1',
      usageEvent({ agentId: 'reviewer', payload: usagePayload({ costUsd: 0.25 }) }),
    );
    await appendEvent(
      project.dir,
      'run-2',
      usageEvent({ runId: 'run-2', payload: usagePayload({ costUsd: 2 }) }),
    );

    const report = await costReport({
      paths: project.paths,
      projectRoot: project.dir,
      config: project.config,
    });
    expect(report.totalUsd).toBeCloseTo(3.75);
    expect(report.byRun.get('run-1')).toBeCloseTo(1.75);
    expect(report.byRun.get('run-2')).toBeCloseTo(2);
    expect(report.byAgent.get('engineer')).toBeCloseTo(3.5);
    expect(report.byAgent.get('reviewer')).toBeCloseTo(0.25);
    expect(report.byModel.get('test-model-1')).toBeCloseTo(3.75);
  });

  it('reports a real breached budget status against config.budget.dailyUsd', async () => {
    const project = await createTestProject();
    const overBudget = {
      ...project.config,
      budget: { ...project.config.budget, dailyUsd: 1 },
    };
    await appendEvent(project.dir, 'run-1', usageEvent({ payload: usagePayload({ costUsd: 5 }) }));
    const report = await costReport({
      paths: project.paths,
      projectRoot: project.dir,
      config: overBudget,
    });
    expect(report.budgetStatus).toBe('breached');
  });
});

describe('costForStep', () => {
  it('sums a real step’s own real spend across every real retry', async () => {
    const project = await createTestProject();
    await appendEvent(project.dir, 'run-1', usageEvent({ payload: usagePayload({ costUsd: 2 }) }));
    await appendEvent(project.dir, 'run-1', usageEvent({ payload: usagePayload({ costUsd: 4 }) }));
    const spend = await costForStep(
      { paths: project.paths, projectRoot: project.dir, config: project.config },
      'run-1',
      'story-014:implement',
    );
    expect(spend).toBeCloseTo(6);
  });
});
