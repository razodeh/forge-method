/**
 * `forge merge` — real `mergeLane`/`mergeAllReady` against a real lane a fixture run left `'ready'` (real
 * worktree, real branch), driving `@forge/vcs`'s own real merge queue — not a mocked `MergeQueueFacade`.
 *
 * A run no longer leaves a lane ready just because its workflow has no `merge` step: the engine integrates such
 * a lane itself (`PLAN-M13.md` P19, `06` §6.4 rule 4). What leaves one is a lane that did NOT land: here, a
 * `merge` step (or, for a workflow with none, the engine's own `execution.mergeChecks`) whose pre-merge check
 * failed, the case `forge merge` exists for (the user fixes the cause and lands the lane by hand).
 *
 * `PLAN-M14.md` P40: `mergeLane` now lands through `landLane` with the checks the run would itself have
 * applied — the run's own `merge` step's declared policy when the lane is in its landing scope, else
 * `execution.mergeChecks` — never the empty `{}` this command used to hand the queue.
 *
 * @see specs/03 §3.2.4
 * @see PLAN-M14.md P40
 */
import { execa } from 'execa';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ForgeConfig } from '@forge/schemas/config';
import { readEvents } from '@forge/telemetry/events';

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
  FIXTURE_STEP_IMPLEMENT_ID,
  FIXTURE_WORKFLOW_ID,
  FIXTURE_WORKFLOW_WITH_MERGE_SOURCE,
  WORKFLOWS_ROOT,
  cleanupAll,
  createTestProject,
  fixtureExpressionContext,
  testRunDeps,
  type TestProject,
} from './helpers.ts';

afterEach(cleanupAll);

/** A `'merge'`-variant project whose own `merge` step declares a pre-check that always fails
 * (`preChecks: "false"`, a literal command, not a named set — so it still passes the engine's own
 * preflight, which only refuses an unconfigured *named* check, `run-engine.ts`'s own
 * `preflightMergeChecks`) — leaving the `implement` lane `'ready'` for `merge.ts`'s own tests to drive
 * directly, exactly as the run's own `merge` step would have left it. */
async function readyLaneProject(runId: string): Promise<{ project: TestProject; laneId: string }> {
  const project = await createTestProject({ variant: 'merge' });
  await writeFile(
    path.join(project.dir, WORKFLOWS_ROOT, `${FIXTURE_WORKFLOW_ID}.workflow.yaml`),
    FIXTURE_WORKFLOW_WITH_MERGE_SOURCE.replace(
      'policy: { conflict: abort }',
      'policy: { conflict: abort, preChecks: "false" }',
    ),
  );
  await execa('git', ['commit', '--quiet', '-am', 'a merge whose pre-merge check fails'], {
    cwd: project.dir,
  });
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

/** The `'default'`-variant fixture (no `merge` step at all): the `implement` lane the engine tries to
 * integrate itself (`integrateLane`, `06` §6.4 rule 4), against `execution.mergeChecks` set to
 * `mergeChecks` — a literal command so it still passes preflight, chosen by the caller so it fails at
 * runtime and leaves the lane `'ready'` for a lane in no `merge` step's own landing scope. */
async function readyDefaultLaneProject(
  runId: string,
  mergeChecks: { readonly pre?: string; readonly post?: string },
): Promise<{ project: TestProject; laneId: string }> {
  const project = await createTestProject({ variant: 'default' });
  const runProject: TestProject = {
    ...project,
    config: { ...project.config, execution: { ...project.config.execution, mergeChecks } },
  };
  await runWorkflow(testRunDeps(runProject), {
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

async function mergeContextFor(
  project: TestProject,
  runId: string,
  executionOverrides: Partial<ForgeConfig['execution']> = {},
): Promise<MergeContext> {
  const integrationPath = await ensureIntegrationWorktree(
    project.paths,
    project.dir,
    'forge/integration/current',
    'main',
  );
  return {
    paths: project.paths,
    projectRoot: project.dir,
    runId,
    integrationPath,
    workflowsRoot: WORKFLOWS_ROOT,
    config: { ...project.config, execution: { ...project.config.execution, ...executionOverrides } },
  };
}

async function stepIdsOf(
  project: TestProject,
  runId: string,
  type: string,
  laneId: string,
): Promise<readonly (string | undefined)[]> {
  const stepIds: (string | undefined)[] = [];
  for await (const event of readEvents(project.dir, runId)) {
    if (event.type === type && event.laneId === laneId) stepIds.push(event.stepId);
  }
  return stepIds;
}

describe('mergeLane', () => {
  it("reapplies the run's own declared merge-step preCheck by default, naming what ran, and does not land", async () => {
    const { project, laneId } = await readyLaneProject('run-merge-declared-fail');
    const ctx = await mergeContextFor(project, 'run-merge-declared-fail');

    const result = await mergeLane(ctx, laneId);

    expect(result.failure?.code).toBe('MERGE-PRE-CHECK-FAILED');
    expect(result.outcome?.kind).toBe('pre-check-failed');
    expect(result.checks).toEqual({ pre: ['literal command'], post: [] });
    expect(result.warning).toBeUndefined();

    const lanes = await runLanes(project.paths, project.dir, 'run-merge-declared-fail');
    expect(lanes.find((lane) => lane.laneId === laneId)?.status).toBe('ready');
  });

  it("runs the run's own declared fast preCheck and full postCheck (06 §6.5's own worked example), landing and reporting labels and skipped layers", async () => {
    const { project, laneId } = await readyLaneProject('run-merge-fast-full');
    // `declaredChecksFor` reads the workflow FRESH off disk every call (never trusted stale from when the
    // run started) — the same technique the "no longer compiles" test below uses, here with a still-valid
    // edit: the merge policy's checks change from the always-failing literal `"false"` to the real
    // `fast`/`full` named sets, after the run already left the lane `'ready'`.
    await writeFile(
      path.join(project.dir, WORKFLOWS_ROOT, `${FIXTURE_WORKFLOW_ID}.workflow.yaml`),
      FIXTURE_WORKFLOW_WITH_MERGE_SOURCE.replace(
        'policy: { conflict: abort }',
        'policy: { conflict: abort, preChecks: fast, postChecks: full }',
      ),
    );
    // `typecheck`/`lint` configured, `unit`/`integration`/`contract` left unconfigured: real, non-empty
    // `skippedLayers` on both sides (`full` names two layers `fast` does not).
    const ctx = await mergeContextFor(project, 'run-merge-fast-full', {
      testCommands: { typecheck: 'true', lint: 'true' },
    });

    const result = await mergeLane(ctx, laneId);

    expect(result.failure).toBeUndefined();
    expect(result.outcome?.kind).toBe('clean');
    expect(result.checks).toEqual({
      pre: ['execution.testCommands.typecheck', 'execution.testCommands.lint'],
      post: ['execution.testCommands.typecheck', 'execution.testCommands.lint'],
      skippedLayers: { pre: ['unit'], post: ['unit', 'integration', 'contract'] },
    });

    const written = await readFile(
      path.join(ctx.integrationPath, `${FIXTURE_ITEM_ID}.txt`),
      'utf8',
    );
    expect(written).toBe(`${FIXTURE_ITEM_ID}\n`);
  });

  it('an override lands the lane despite the declared preCheck still failing, is named, and records events under the lane\'s own step id', async () => {
    const { project, laneId } = await readyLaneProject('run-merge-override-lands');
    const ctx = await mergeContextFor(project, 'run-merge-override-lands', {
      testCommands: { unit: 'true' },
    });

    const result = await mergeLane(ctx, laneId, { pre: 'unit' });

    expect(result.failure).toBeUndefined();
    expect(result.outcome?.kind).toBe('clean');
    expect(result.checks).toEqual({ pre: ['execution.testCommands.unit'], post: [] });

    const written = await readFile(
      path.join(ctx.integrationPath, `${FIXTURE_ITEM_ID}.txt`),
      'utf8',
    );
    expect(written).toBe(`${FIXTURE_ITEM_ID}\n`);

    // The run's own (failed) `merge` step already recorded an earlier `MergeStarted` under its own step id
    // (`cli-fixture:merge`) before this call — only the LAST `MergeStarted`, and the one real
    // `MergeCompleted`, are this call's own, and both must carry the lane's own step id, not the merge
    // step's (`integrateLane`'s own convention for a lane no `merge` step lands, reused here).
    const started = await stepIdsOf(project, 'run-merge-override-lands', 'MergeStarted', laneId);
    const completed = await stepIdsOf(project, 'run-merge-override-lands', 'MergeCompleted', laneId);
    expect(started.at(-1)).toBe(FIXTURE_STEP_IMPLEMENT_ID);
    expect(completed).toEqual([FIXTURE_STEP_IMPLEMENT_ID]);
  });

  it("a lane in no merge step's own landing scope falls back to execution.mergeChecks, naming it, and lands once it resolves", async () => {
    const { project, laneId } = await readyDefaultLaneProject('run-merge-fallback', { pre: 'false' });

    const failCtx = await mergeContextFor(project, 'run-merge-fallback', {
      mergeChecks: { post: 'unit' },
    });
    const failed = await mergeLane(failCtx, laneId);
    expect(failed.failure?.code).toBe('MERGE-CHECKS-UNCONFIGURED');
    expect(failed.failure?.message).toContain('execution.mergeChecks.post');
    expect(failed.failure?.message).toContain('execution.testCommands.unit');

    const okCtx = await mergeContextFor(project, 'run-merge-fallback', {
      mergeChecks: { pre: 'true' },
    });
    const landed = await mergeLane(okCtx, laneId);
    expect(landed.failure).toBeUndefined();
    expect(landed.outcome?.kind).toBe('clean');
    expect(landed.checks).toEqual({ pre: ['literal command'], post: [] });
  });

  it('refuses MERGE-CHECKS-UNCONFIGURED, naming both sides, when neither pre nor post names any check at all', async () => {
    const { project, laneId } = await readyDefaultLaneProject('run-merge-unconfigured', {
      pre: 'false',
    });
    const ctx = await mergeContextFor(project, 'run-merge-unconfigured', { mergeChecks: {} });

    const result = await mergeLane(ctx, laneId);

    expect(result.failure?.code).toBe('MERGE-CHECKS-UNCONFIGURED');
    expect(result.failure?.message).toContain('execution.mergeChecks.pre');
    expect(result.failure?.message).toContain('execution.mergeChecks.post');
    expect(result.failure?.message).toContain('execution.testCommands');
    expect(result.outcome).toBeUndefined();
    expect(result.checks).toEqual({ pre: [], post: [] });
  });

  it('falls back to execution.mergeChecks with no warning when the run has no manifest at all', async () => {
    const { project, laneId } = await readyDefaultLaneProject('run-merge-no-manifest', {
      pre: 'false',
    });
    await rm(project.paths.resolveState('runs/run-merge-no-manifest/manifest.json'));
    const ctx = await mergeContextFor(project, 'run-merge-no-manifest', {
      mergeChecks: { pre: 'true' },
    });

    const result = await mergeLane(ctx, laneId);

    expect(result.warning).toBeUndefined();
    expect(result.failure).toBeUndefined();
    expect(result.outcome?.kind).toBe('clean');
    expect(result.checks).toEqual({ pre: ['literal command'], post: [] });
  });

  it('throws RUN-054 for a manifest that exists but cannot be parsed, rather than guessing which checks apply', async () => {
    const { project, laneId } = await readyLaneProject('run-merge-bad-manifest');
    const ctx = await mergeContextFor(project, 'run-merge-bad-manifest');
    await writeFile(
      project.paths.resolveState('runs/run-merge-bad-manifest/manifest.json'),
      '{ not valid json',
    );

    await expect(mergeLane(ctx, laneId)).rejects.toMatchObject({ code: 'RUN-054' });
  });

  it('falls back to execution.mergeChecks with a warning when the workflow no longer compiles', async () => {
    const { project, laneId } = await readyLaneProject('run-merge-non-compiling');
    await writeFile(
      path.join(project.dir, WORKFLOWS_ROOT, `${FIXTURE_WORKFLOW_ID}.workflow.yaml`),
      'not-a-real-workflow: true\n',
    );
    const ctx = await mergeContextFor(project, 'run-merge-non-compiling', {
      mergeChecks: { pre: 'true' },
    });

    const result = await mergeLane(ctx, laneId);

    expect(result.warning).toContain(FIXTURE_WORKFLOW_ID);
    expect(result.failure).toBeUndefined();
    expect(result.outcome?.kind).toBe('clean');
  });

  it('falls back to execution.mergeChecks with a warning when the workflow file no longer exists at all', async () => {
    const { project, laneId } = await readyLaneProject('run-merge-deleted-workflow');
    await rm(path.join(project.dir, WORKFLOWS_ROOT, `${FIXTURE_WORKFLOW_ID}.workflow.yaml`));
    const ctx = await mergeContextFor(project, 'run-merge-deleted-workflow', {
      mergeChecks: { pre: 'true' },
    });

    const result = await mergeLane(ctx, laneId);

    expect(result.warning).toContain(FIXTURE_WORKFLOW_ID);
    expect(result.failure).toBeUndefined();
    expect(result.outcome?.kind).toBe('clean');
  });

  it('throws RUN-051 for a lane id this run never recorded', async () => {
    const { project } = await readyLaneProject('run-merge-missing-lane');
    const ctx = await mergeContextFor(project, 'run-merge-missing-lane');
    await expect(mergeLane(ctx, 'no-such-lane')).rejects.toMatchObject({ code: 'RUN-051' });
  });
});

describe('mergeAllReady', () => {
  it('merges every real ready lane with the overrides given, and returns its real outcome per lane', async () => {
    const { project, laneId } = await readyLaneProject('run-merge-all');
    const ctx = await mergeContextFor(project, 'run-merge-all', { testCommands: { unit: 'true' } });

    const results = await mergeAllReady(ctx, { pre: 'unit' });
    expect(results).toHaveLength(1);
    expect(results[0]?.laneId).toBe(laneId);
    expect(results[0]?.result.outcome?.kind).toBe('clean');
    expect(results[0]?.result.checks.pre).toEqual(['execution.testCommands.unit']);
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
