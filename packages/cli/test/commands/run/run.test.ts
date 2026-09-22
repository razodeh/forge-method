/**
 * `forge run <workflow> [--dry-run]` — real `dryRunWorkflow` compilation and a real, in-process
 * `runWorkflow` end-to-end run against the real `@forge/engine` scheduler, a real git repository, and a
 * real (fake-adapter) session — never mocked engine internals.
 *
 * @see specs/03 §3.2.4
 * @see PLAN-M5.md P20
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { dryRunWorkflow, handleSigterm, runWorkflow } from '../../../src/commands/run/run.ts';
import { acquireRunLock, readRunLock } from '../../../src/commands/run/lock.ts';
import { currentLauncher } from '../../../src/commands/run/launcher-shim.ts';
import { runLanes } from '../../../src/commands/run/status.ts';
import {
  CHECKS_ROOT,
  FIXTURE_GATE_ID,
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

  it('20 §20.10 S8: refuses to start a real, non-dry-run run against a dirty working tree, before acquiring the lock or writing any run state', async () => {
    const project = await createTestProject();
    // A real, adversarial uncommitted edit to the user's own working tree -- not a FORGE-internal file,
    // a real source file a human would plausibly still be mid-edit on.
    await writeFile(path.join(project.dir, 'work-in-progress.txt'), 'not yet committed');

    await expect(
      runWorkflow(testRunDeps(project), {
        workflowId: FIXTURE_WORKFLOW_ID,
        expressionContext: fixtureExpressionContext(),
        runId: 'run-dirty',
        host: 'test-host',
      }),
    ).rejects.toMatchObject({ code: 'VCS-DIRTY-TREE' });

    // Halted *before* any of runWorkflow's own side effects -- no lock left behind, no manifest/
    // last-run pointer written for a run that never really started.
    expect(await readRunLock(project.paths)).toBeUndefined();
    await expect(
      readFile(path.join(project.dir, '.forge/state/runs/run-dirty/manifest.json'), 'utf8'),
    ).rejects.toThrow();

    // The uncommitted work itself survives untouched -- S8's own "never discarded" half.
    await expect(readFile(path.join(project.dir, 'work-in-progress.txt'), 'utf8')).resolves.toBe(
      'not yet committed',
    );
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

  it('a real gate check spawned by a fresh run carries the FORGE run marker (@forge/core/session-marker, PLAN-M14.md P4), through the real commandEnvFor -> commandEnv -> createGateEvaluator chain, not a hand-built env', async () => {
    const project = await createTestProject();
    // The fixture gate's own check, extended (not replaced) to also record $FORGE_RUN_ID to a file in
    // its own cwd (`ctx.integrationPath`) -- still returns the required `{"ok":true}` JSON envelope.
    await writeFile(
      path.join(project.dir, CHECKS_ROOT, `${FIXTURE_GATE_ID}.gate.yaml`),
      `id: ${FIXTURE_GATE_ID}\n` +
        'name: Always-passing fixture gate\n' +
        'phase: verify\n' +
        'checks:\n' +
        '  deterministic:\n' +
        '    - id: always-ok\n' +
        '      run: "printf \'%s\' \\"$FORGE_RUN_ID\\" > run-id-marker.txt && echo \'{\\"ok\\":true}\'"\n' +
        '      failOn: "!ok"\n' +
        '  advisory: []\n' +
        'openQuestionsPolicy: warn\n',
    );
    await execa('git', ['add', '-A'], { cwd: project.dir });
    await execa('git', ['commit', '--quiet', '-m', 'gate check also records FORGE_RUN_ID'], {
      cwd: project.dir,
    });

    const deps = { ...testRunDeps(project), launcher: currentLauncher(process.env) };
    const result = await runWorkflow(deps, {
      workflowId: FIXTURE_WORKFLOW_ID,
      expressionContext: fixtureExpressionContext(),
      runId: 'run-gate-marker',
      host: 'test-host',
    });
    expect(result.kind).toBe('run');
    if (result.kind !== 'run') throw new Error('unreachable');
    expect(result.runState.runStatus).toBe('completed');

    const marker = await readFile(
      path.join(
        project.dir,
        '.forge/state/worktrees/integration-forge-integration-current',
        'run-id-marker.txt',
      ),
      'utf8',
    );
    expect(marker).toBe('run-gate-marker');
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
