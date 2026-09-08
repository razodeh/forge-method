/**
 * `forge merge` — real `mergeLane`/`mergeAllReady` against a real lane a merge-less fixture run left
 * `'ready'` (real worktree, real branch), driving `@forge/vcs`'s own real merge queue — not a mocked
 * `MergeQueueFacade`.
 *
 * @see specs/03 §3.2.4
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ensureIntegrationWorktree } from '../../../src/commands/run/context.ts';
import {
  mergeAbort,
  mergeAllReady,
  mergeLane,
  type MergeContext,
} from '../../../src/commands/run/merge.ts';
import { runLanes } from '../../../src/commands/run/status.ts';
import { runWorkflow } from '../../../src/commands/run/run.ts';
import {
  FIXTURE_ITEM_ID,
  FIXTURE_WORKFLOW_ID,
  cleanupAll,
  createTestProject,
  fixtureExpressionContext,
  testRunDeps,
  type TestProject,
} from './helpers.ts';

afterEach(cleanupAll);

async function readyLaneProject(runId: string): Promise<{ project: TestProject; laneId: string }> {
  const project = await createTestProject();
  await runWorkflow(testRunDeps(project), {
    workflowId: FIXTURE_WORKFLOW_ID,
    expressionContext: fixtureExpressionContext(),
    runId,
    host: 'test-host',
  });
  const lanes = await runLanes(project.paths, project.dir, runId);
  const ready = lanes.find((lane) => lane.status === 'ready');
  if (ready === undefined) throw new Error('fixture run left no ready lane');
  return { project, laneId: ready.laneId };
}

async function mergeContextFor(project: TestProject, runId: string): Promise<MergeContext> {
  const integrationPath = await ensureIntegrationWorktree(
    project.paths,
    project.dir,
    'forge/integration/current',
    'main',
  );
  return { paths: project.paths, projectRoot: project.dir, runId, integrationPath };
}

describe('mergeLane', () => {
  it('merges a real, ready lane cleanly into the real integration branch', async () => {
    const { project, laneId } = await readyLaneProject('run-merge-lane');
    const ctx = await mergeContextFor(project, 'run-merge-lane');

    const outcome = await mergeLane(ctx, laneId);
    expect(outcome.kind).toBe('clean');

    const written = await readFile(
      path.join(ctx.integrationPath, `${FIXTURE_ITEM_ID}.txt`),
      'utf8',
    );
    expect(written).toBe(`${FIXTURE_ITEM_ID}\n`);
  });

  it('throws RUN-051 for a lane id this run never recorded', async () => {
    const { project } = await readyLaneProject('run-merge-missing-lane');
    const ctx = await mergeContextFor(project, 'run-merge-missing-lane');
    await expect(mergeLane(ctx, 'no-such-lane')).rejects.toMatchObject({ code: 'RUN-051' });
  });
});

describe('mergeAllReady', () => {
  it('merges every real ready lane and returns its real outcome', async () => {
    const { project, laneId } = await readyLaneProject('run-merge-all');
    const ctx = await mergeContextFor(project, 'run-merge-all');

    const results = await mergeAllReady(ctx);
    expect(results).toHaveLength(1);
    expect(results[0]?.laneId).toBe(laneId);
    expect(results[0]?.outcome.kind).toBe('clean');
  });

  it('is a real no-op when no lane is ready', async () => {
    const project = await createTestProject();
    const ctx = await mergeContextFor(project, 'run-merge-none');
    // No workflow was ever run for this runId — `reconstructRunState` over an empty log has no lanes.
    expect(await mergeAllReady(ctx)).toEqual([]);
  });
});

describe('mergeAbort', () => {
  it('throws USR-003 — not implemented, refused rather than guessed at', () => {
    expect(() => mergeAbort()).toThrow(expect.objectContaining({ code: 'USR-003' }));
  });
});
