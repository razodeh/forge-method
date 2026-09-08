/**
 * `forge run <workflow> [--dry-run]` — real `dryRunWorkflow` compilation and a real, in-process
 * `runWorkflow` end-to-end run against the real `@forge/engine` scheduler, a real git repository, and a
 * real (fake-adapter) session — never mocked engine internals.
 *
 * @see specs/03 §3.2.4
 * @see PLAN-M5.md P20
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { dryRunWorkflow, handleSigterm, runWorkflow } from '../../../src/commands/run/run.ts';
import { acquireRunLock, readRunLock } from '../../../src/commands/run/lock.ts';
import { runLanes } from '../../../src/commands/run/status.ts';
import {
  FIXTURE_ITEM_ID,
  FIXTURE_STEP_IMPLEMENT_ID,
  FIXTURE_STEP_PREPARE_ID,
  FIXTURE_STEP_VERIFY_ID,
  FIXTURE_WORKFLOW_ID,
  FIXTURE_WORKFLOW_SOURCE,
  cleanupAll,
  createTestProject,
  fixtureExpressionContext,
  testRunDeps,
} from './helpers.ts';

afterEach(cleanupAll);

describe('dryRunWorkflow', () => {
  it('plans and returns the real compiled plan without touching the filesystem or spawning a session', () => {
    const result = dryRunWorkflow(FIXTURE_WORKFLOW_SOURCE, fixtureExpressionContext());
    expect(result.kind).toBe('dry-run');
    expect(result.plan.success).toBe(true);
    if (result.plan.success) {
      expect(result.plan.nodes.map((node) => node.id).sort()).toEqual(
        [FIXTURE_STEP_IMPLEMENT_ID, FIXTURE_STEP_PREPARE_ID, FIXTURE_STEP_VERIFY_ID].sort(),
      );
    }
  });

  it('throws RUN-045 for a workflow that fails to parse', () => {
    expect(() => dryRunWorkflow('not: [valid, workflow', fixtureExpressionContext())).toThrow();
  });

  it('returns a failed plan (not a thrown error) for a workflow that parses but fails to compile', () => {
    // `dryRunWorkflow`'s own real contract: only a *parse* failure throws (there is no workflow to
    // report a plan for at all); a *compile* failure — a real, well-formed workflow whose own
    // `dependsOn` graph does not resolve — is itself the real, reportable "plan" `--dry-run` exists to
    // show, so it comes back as `plan.success === false` for the caller to print, not thrown.
    const source = `
id: broken
name: Broken
version: 1.0.0
description: A broken fixture — parses fine, fails to compile.
steps:
  - id: only
    kind: command
    run: "true"
    dependsOn: [ nonexistent ]
`;
    const result = dryRunWorkflow(source, fixtureExpressionContext());
    expect(result.plan.success).toBe(false);
    if (!result.plan.success) {
      expect(result.plan.issues[0]).toMatchObject({ code: 'dangling-dependency' });
    }
  });
});

describe('runWorkflow', () => {
  it('throws RUN-053 for an unknown workflow id', async () => {
    const project = await createTestProject();
    await expect(
      runWorkflow(testRunDeps(project), {
        workflowId: 'no-such-workflow',
        expressionContext: fixtureExpressionContext(),
        host: 'test-host',
      }),
    ).rejects.toMatchObject({ code: 'RUN-053' });
  });

  it('dry-run mode never acquires the lock or writes any run state', async () => {
    const project = await createTestProject();
    const result = await runWorkflow(testRunDeps(project), {
      workflowId: FIXTURE_WORKFLOW_ID,
      expressionContext: fixtureExpressionContext(),
      dryRun: true,
      host: 'test-host',
    });
    expect(result.kind).toBe('dry-run');
    expect(await readRunLock(project.paths)).toBeUndefined();
  });

  it('runs a real workflow to completion: real event log, real lock lifecycle, real produced artifact', async () => {
    const project = await createTestProject();
    const result = await runWorkflow(testRunDeps(project), {
      workflowId: FIXTURE_WORKFLOW_ID,
      expressionContext: fixtureExpressionContext(),
      runId: 'run-fixed',
      host: 'test-host',
    });

    expect(result.kind).toBe('run');
    if (result.kind !== 'run') throw new Error('unreachable');
    expect(result.runId).toBe('run-fixed');
    expect(result.runState.runStatus).toBe('completed');
    expect(result.runState.unresolvedStepIds).toEqual([]);

    // The lock is released once the run finishes.
    expect(await readRunLock(project.paths)).toBeUndefined();

    // The real produced artifact from the fake adapter's own scripted write really landed on disk, in
    // the real lane worktree — this fixture has no merge step, so nothing brings it back to the main
    // project root (the merge-step case below covers that path).
    const lanes = await runLanes(project.paths, project.dir, 'run-fixed');
    const laneId = lanes[0]?.laneId;
    if (laneId === undefined) throw new Error('run left no lane');
    const written = await readFile(
      project.paths.resolveState(`worktrees/${laneId}/${FIXTURE_ITEM_ID}.txt`),
      'utf8',
    );
    expect(written).toBe(`${FIXTURE_ITEM_ID}\n`);

    // A real manifest and last-run pointer, readable back for a later `forge resume`.
    const manifest = JSON.parse(
      await readFile(path.join(project.dir, '.forge/state/runs/run-fixed/manifest.json'), 'utf8'),
    ) as { workflowId: string };
    expect(manifest.workflowId).toBe(FIXTURE_WORKFLOW_ID);
    const lastRun = JSON.parse(
      await readFile(path.join(project.dir, '.forge/state/last-run.json'), 'utf8'),
    ) as { runId: string };
    expect(lastRun.runId).toBe('run-fixed');
  });

  it('a full real run through a real merge step lands the change on the real integration branch', async () => {
    const project = await createTestProject({ variant: 'merge' });
    const result = await runWorkflow(testRunDeps(project), {
      workflowId: FIXTURE_WORKFLOW_ID,
      expressionContext: fixtureExpressionContext(),
      runId: 'run-merge',
      host: 'test-host',
    });
    expect(result.kind).toBe('run');
    if (result.kind !== 'run') throw new Error('unreachable');
    expect(result.runState.runStatus).toBe('completed');

    const integrationPath = path.join(
      project.dir,
      '.forge/state/worktrees/integration-forge-integration-current',
    );
    const written = await readFile(path.join(integrationPath, `${FIXTURE_ITEM_ID}.txt`), 'utf8');
    expect(written).toBe(`${FIXTURE_ITEM_ID}\n`);

    const { stdout } = await execa('git', ['log', '--oneline', 'forge/integration/current'], {
      cwd: project.dir,
    });
    expect(stdout).toContain('Merge lane');
  });

  it('derives a deterministic runId from the injected clock when none is given', async () => {
    const project = await createTestProject();
    const clock = { now: () => '2026-01-01T00:00:00.000Z' };
    const result = await runWorkflow(testRunDeps(project), {
      workflowId: FIXTURE_WORKFLOW_ID,
      expressionContext: fixtureExpressionContext(),
      host: 'test-host',
      clock,
    });
    expect(result.kind).toBe('run');
    if (result.kind !== 'run') throw new Error('unreachable');
    expect(result.runId).toBe(`run-${FIXTURE_WORKFLOW_ID}-20260101000000000`);
  });

  it('throws CFG-002 when a real, still-alive lock already holds the project', async () => {
    const project = await createTestProject();
    // Acquire the lock out from under runWorkflow by writing it directly, naming this test process's
    // own real, alive pid.
    await acquireRunLock(project.paths, {
      pid: process.pid,
      host: 'other-host',
      runId: 'run-other',
      startedAt: '2026-01-01T00:00:00.000Z',
    });

    await expect(
      runWorkflow(testRunDeps(project), {
        workflowId: FIXTURE_WORKFLOW_ID,
        expressionContext: fixtureExpressionContext(),
        host: 'test-host',
      }),
    ).rejects.toMatchObject({ code: 'CFG-002' });
  });
});

describe('handleSigterm', () => {
  it('exits with code 0 — this codebase’s own real "pause terminates the process outright" contract', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    handleSigterm();
    expect(exit).toHaveBeenCalledWith(0);
    exit.mockRestore();
  });
});
