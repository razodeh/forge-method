/**
 * `forge status` / `forge lanes` / `forge logs` — real state read back from a real completed run's own
 * event log, via the identical `reconstructRunState` replay machinery the crash-resume capstone already
 * proves correct.
 *
 * @see specs/03 §3.2.4
 */
import { afterEach, describe, expect, it } from 'vitest';

import { runLanes, runLogs, runStatus } from '../../../src/commands/run/status.ts';
import type { ForgeEvent } from '@forge/telemetry/events';
import { runWorkflow } from '../../../src/commands/run/run.ts';
import {
  FIXTURE_STEP_IMPLEMENT_ID,
  FIXTURE_WORKFLOW_ID,
  cleanupAll,
  createTestProject,
  fixtureExpressionContext,
  testRunDeps,
} from './helpers.ts';

afterEach(cleanupAll);

async function runFixture(runId: string, variant: Parameters<typeof createTestProject>[0] = {}) {
  const project = await createTestProject(variant);
  await runWorkflow(testRunDeps(project), {
    workflowId: FIXTURE_WORKFLOW_ID,
    expressionContext: fixtureExpressionContext(),
    runId,
    host: 'test-host',
  });
  return project;
}

describe('runStatus', () => {
  it('throws RUN-048 when there is no last run and none is named', async () => {
    const project = await createTestProject();
    await expect(runStatus(project.paths, project.dir, undefined)).rejects.toMatchObject({
      code: 'RUN-048',
    });
  });

  it('reports the real, completed status of a real finished run', async () => {
    const project = await runFixture('run-status');
    const status = await runStatus(project.paths, project.dir, 'run-status');
    expect(status.runId).toBe('run-status');
    expect(status.runStatus).toBe('completed');
    expect(status.unresolvedStepIds).toEqual([]);
    expect(status.stepCounts['succeeded']).toBe(3);
    // The lock was already released when the run finished — no live lock to report.
    expect(status.lock).toBeUndefined();
  });

  it('resolves an omitted runId via the real last-run.json pointer', async () => {
    const project = await runFixture('run-implicit');
    const status = await runStatus(project.paths, project.dir, undefined);
    expect(status.runId).toBe('run-implicit');
  });
});

describe('runLanes', () => {
  it('reports the real lane left ready by a merge-less fixture run, with its true origin', async () => {
    const project = await runFixture('run-lanes', { variant: 'default' });
    const lanes = await runLanes(project.paths, project.dir, 'run-lanes');
    expect(lanes).toHaveLength(1);
    expect(lanes[0]?.status).toBe('ready');
    expect(lanes[0]?.stepId).toBe(FIXTURE_STEP_IMPLEMENT_ID);
    expect(lanes[0]?.baseSha).toBeDefined();
  });

  it('reports no lanes left once a real merge step has removed them', async () => {
    const project = await runFixture('run-lanes-merged', { variant: 'merge' });
    const lanes = await runLanes(project.paths, project.dir, 'run-lanes-merged');
    expect(lanes.every((lane) => lane.status !== 'ready')).toBe(true);
  });
});

describe('runLogs', () => {
  it('yields the real, ordered event log for a run', async () => {
    const project = await runFixture('run-logs');
    const events: ForgeEvent[] = [];
    for await (const event of runLogs(project.paths, project.dir, { runId: 'run-logs' })) {
      events.push(event);
    }
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((event) => event.type === 'RunCompleted')).toBe(true);
    expect(events.every((event, index) => index === 0 || event.seq > events[index - 1]!.seq)).toBe(
      true,
    );
  });

  it('filters real events down to just one step id', async () => {
    const project = await runFixture('run-logs-filtered');
    const events: ForgeEvent[] = [];
    for await (const event of runLogs(project.paths, project.dir, {
      runId: 'run-logs-filtered',
      stepId: FIXTURE_STEP_IMPLEMENT_ID,
    })) {
      events.push(event);
    }
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.stepId === FIXTURE_STEP_IMPLEMENT_ID)).toBe(true);
  });

  it('throws RUN-048 when there is no last run and none is named', async () => {
    const project = await createTestProject();
    const iterator = runLogs(project.paths, project.dir, {});
    await expect(iterator.next()).rejects.toMatchObject({ code: 'RUN-048' });
  });
});
