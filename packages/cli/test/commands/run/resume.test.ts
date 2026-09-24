/**
 * `forge resume [runId]` — a real crash-then-resume proof against the CLI's own real `runWorkflow`/
 * `resumeWorkflow`: a real child process, genuinely `SIGKILL`'d mid-run, then resumed in-process by this
 * test, reaching the identical completed state an uninterrupted run would. Also covers `resumeWorkflow`'s
 * own real precondition/error paths (`RUN-048` no last run, `CFG-002` a live lock).
 *
 * @see specs/03 §3.2.4
 * @see specs/06 §6.10
 */
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { execa } from 'execa';
import { pathExists, writeFileAtomic, type ProjectPaths } from '@forge/core/fs';
import * as planIndexModule from '@forge/engine/plan';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { acquireRunLock, readRunLock } from '../../../src/commands/run/lock.ts';
import { currentLauncher } from '../../../src/commands/run/launcher-shim.ts';
import { resumeWorkflow } from '../../../src/commands/run/resume.ts';
import { runLanes } from '../../../src/commands/run/status.ts';
import {
  CHECKS_ROOT,
  FIXTURE_GATE_ID,
  FIXTURE_ITEM_ID,
  FIXTURE_WORKFLOW_ID,
  WORKFLOWS_ROOT,
  cleanupAll,
  createTestProject,
  fixtureExpressionContext,
  testRunDeps,
  type TestProject,
} from './helpers.ts';

/** Writes a real manifest directly — the identical shape `runWorkflow`'s own first durable write
 * produces — without paying for a full run, for the two tests below that only care about what
 * `resumeWorkflow` does with a workflow source that fails to parse/compile by the time it re-reads it
 * fresh from disk. */
async function writeManifest(
  project: TestProject,
  runId: string,
  externalKbIds?: readonly string[],
): Promise<void> {
  await writeFileAtomic(
    project.paths.resolveState(`runs/${runId}/manifest.json`),
    JSON.stringify({
      workflowId: FIXTURE_WORKFLOW_ID,
      expressionContext: fixtureExpressionContext(),
      // `PLAN-M14.md` P30: only written when a test actually cares -- every manifest write before this
      // piece (and most of this file's own real-manifest fixtures) legitimately have no such key at all.
      ...(externalKbIds === undefined ? {} : { externalKbIds }),
    }),
  );
}

afterEach(cleanupAll);

const CHILD_PATH = fileURLToPath(new URL('./fixtures/run-child.ts', import.meta.url));

/** Spawns the real child fixture and `SIGKILL`s it once its own manifest file (`runWorkflow`'s own
 * first durable write, before it ever reaches the slow `prepare` step) genuinely exists on disk —
 * polled for, rather than a fixed delay: the child's own cold start (loading `@forge/engine`/`@forge/
 * vcs`/`@forge/telemetry`'s full module graph via `--experimental-strip-types`) has no fixed, portable
 * duration a constant sleep could safely assume. The slow fixture workflow's own `prepare` step
 * (`sleep 0.4`) then gives a genuine, real wall-clock window past that point to land the kill inside.
 * Resolves once the OS confirms the pid is genuinely gone, the same structural proof
 * `packages/engine/test/e2e/crash-resume.test.ts`'s own `waitForProcessGone` uses. */
async function spawnAndKill(
  paths: ProjectPaths,
  projectRoot: string,
  runId: string,
): Promise<void> {
  const child = spawn('node', [
    '--experimental-strip-types',
    CHILD_PATH,
    projectRoot,
    runId,
    'test-host',
  ]);
  const pid = child.pid;
  if (pid === undefined) throw new Error('child process failed to spawn (no pid)');

  const manifestPath = paths.resolveState(`runs/${runId}/manifest.json`);
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (await pathExists(manifestPath)) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await new Promise((resolve) => setTimeout(resolve, 100));

  child.kill('SIGKILL');
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`pid ${String(pid)} still exists after waiting`);
}

describe('resumeWorkflow', () => {
  it('throws RUN-048 when there is no last run to resume', async () => {
    const project = await createTestProject();
    await expect(resumeWorkflow(testRunDeps(project), { host: 'test-host' })).rejects.toMatchObject(
      {
        code: 'RUN-048',
      },
    );
  });

  it('throws CFG-002 when a real, still-alive process already holds the project lock', async () => {
    const project = await createTestProject();
    await acquireRunLock(project.paths, {
      pid: process.pid,
      host: 'other-host',
      runId: 'run-1',
      startedAt: '2026-01-01T00:00:00.000Z',
    });
    await expect(
      resumeWorkflow(testRunDeps(project), { runId: 'run-1', host: 'test-host' }),
    ).rejects.toMatchObject({ code: 'CFG-002' });
  });

  it('throws RUN-054 when the named run has no real manifest (never started by forge run)', async () => {
    const project = await createTestProject();
    await expect(
      resumeWorkflow(testRunDeps(project), { runId: 'run-never-started', host: 'test-host' }),
    ).rejects.toMatchObject({ code: 'RUN-054' });
  });

  // `PLAN-M14.md` P30: `resumeWorkflow` recompiles from the manifest's own `externalKbIds` snapshot, not
  // a fresh KB read -- both of its own two real `compileRunPlan` call sites (its own direct recompile
  // for `resumeRun`'s `ResumeContext`, and the one `runEngine` makes internally once handed
  // `ctx.externalKbIds`) must agree with the manifest, and with each other. Spied (real implementation
  // still runs via `mockImplementation`) rather than proved only through a tainted grant, the same
  // "reach the one thing an end-to-end proof cannot isolate" reason `run-engine.test.ts`'s own identical
  // spy gives.
  it("recompiles with the manifest's own externalKbIds snapshot -- both of its own compileRunPlan call sites agree", async () => {
    const project = await createTestProject();
    await writeManifest(project, 'run-ext-kb', ['KB-ARCH-0001']);
    const originalCompileRunPlan = planIndexModule.compileRunPlan;
    const spy = vi
      .spyOn(planIndexModule, 'compileRunPlan')
      .mockImplementation((wf, context, options) => originalCompileRunPlan(wf, context, options));
    try {
      const result = await resumeWorkflow(testRunDeps(project), {
        runId: 'run-ext-kb',
        host: 'test-host',
      });
      expect(result.runState.runStatus).toBe('completed');
      expect(spy.mock.calls.length).toBeGreaterThan(0);
      for (const call of spy.mock.calls) {
        expect(call[2]).toEqual({ taint: { externalKbIds: new Set(['KB-ARCH-0001']) } });
      }
    } finally {
      spy.mockRestore();
    }
  });

  it('an old manifest with no externalKbIds key at all (a pre-P30 run) recompiles with an empty set, never throwing', async () => {
    const project = await createTestProject();
    await writeManifest(project, 'run-pre-p30');
    const result = await resumeWorkflow(testRunDeps(project), {
      runId: 'run-pre-p30',
      host: 'test-host',
    });
    expect(result.runState.runStatus).toBe('completed');
  });

  it('throws RUN-045 when the workflow source no longer parses by the time resume re-reads it', async () => {
    const project = await createTestProject();
    await writeManifest(project, 'run-bad-parse');
    await writeFile(
      path.join(project.dir, WORKFLOWS_ROOT, `${FIXTURE_WORKFLOW_ID}.workflow.yaml`),
      'not: [valid, workflow',
    );
    await expect(
      resumeWorkflow(testRunDeps(project), { runId: 'run-bad-parse', host: 'test-host' }),
    ).rejects.toMatchObject({ code: 'RUN-045' });
  });

  it('throws RUN-045 when the workflow source parses but no longer compiles (a dangling dependsOn)', async () => {
    const project = await createTestProject();
    await writeManifest(project, 'run-bad-compile');
    await writeFile(
      path.join(project.dir, WORKFLOWS_ROOT, `${FIXTURE_WORKFLOW_ID}.workflow.yaml`),
      `id: ${FIXTURE_WORKFLOW_ID}
name: Broken
version: 1.0.0
description: A broken fixture — parses fine, fails to compile.
steps:
  - id: only
    kind: command
    run: "true"
    dependsOn: [ nonexistent ]
`,
    );
    await expect(
      resumeWorkflow(testRunDeps(project), { runId: 'run-bad-compile', host: 'test-host' }),
    ).rejects.toMatchObject({ code: 'RUN-045' });
  });

  it('a real SIGKILL mid-run, then resumed, reaches the same completed state as an uninterrupted run', async () => {
    const project = await createTestProject({ variant: 'slow' });
    const runId = 'run-crash';

    await spawnAndKill(project.paths, project.dir, runId);

    const { runId: resumedRunId, runState } = await resumeWorkflow(testRunDeps(project), {
      runId,
      host: 'test-host',
    });

    expect(resumedRunId).toBe(runId);
    expect(runState.runStatus).toBe('completed');
    expect(runState.unresolvedStepIds).toEqual([]);

    // No merge step in this fixture — the produced artifact lives in the real lane worktree, not the
    // main project root (`run.test.ts`'s own merge-step case covers the merged-into-integration path).
    const lanes = await runLanes(project.paths, project.dir, runId);
    const laneId = lanes[0]?.laneId;
    if (laneId === undefined) throw new Error('resumed run left no lane');
    const written = await readFile(
      project.paths.resolveState(`worktrees/${laneId}/${FIXTURE_ITEM_ID}.txt`),
      'utf8',
    );
    expect(written).toBe(`${FIXTURE_ITEM_ID}\n`);

    // The lock is released once resume finishes.
    expect(await readRunLock(project.paths)).toBeUndefined();

    // Resolving an omitted runId via the real last-run.json pointer works too — the crashed run's own
    // `runWorkflow` call already wrote that pointer before it was killed.
    const explicit = await resumeWorkflow(testRunDeps(project), { host: 'test-host' });
    expect(explicit.runId).toBe(runId);
  }, 30_000);

  it('SPEC-QUESTIONS.md Q232 decision 18: a resumed run never re-syncs the integration branch with main, even when they have diverged since the crash — only runWorkflow syncs', async () => {
    const project = await createTestProject({ variant: 'slow' });
    const runId = 'run-crash-no-resync';

    // The crashed run's own `runWorkflow` already synced once, before it was killed (the manifest —
    // its first durable write — is written only after that sync succeeds, so a crash `spawnAndKill`
    // waits for is always a crash *after* it).
    await spawnAndKill(project.paths, project.dir, runId);

    const integrationPath = project.paths.resolveState(
      'worktrees/integration-forge-integration-current',
    );

    // Diverge main and the integration branch for real, *after* the crash the killed run already
    // synced against — a resume that re-synced would either throw RUN-107 here or fast-forward the
    // branch; this proves it does neither.
    await writeFile(path.join(project.dir, 'hotfix-after-crash.txt'), 'h\n');
    await execa('git', ['add', 'hotfix-after-crash.txt'], { cwd: project.dir });
    await execa('git', ['commit', '--quiet', '-m', 'hotfix after crash'], { cwd: project.dir });
    await writeFile(path.join(integrationPath, 'integration-only-after-crash.txt'), 'i\n');
    await execa('git', ['add', 'integration-only-after-crash.txt'], { cwd: integrationPath });
    await execa('git', ['commit', '--quiet', '-m', 'integration-only after crash'], {
      cwd: integrationPath,
    });
    const integrationTipDiverged = (
      await execa('git', ['rev-parse', 'HEAD'], { cwd: integrationPath })
    ).stdout.trim();

    const { runState } = await resumeWorkflow(testRunDeps(project), { runId, host: 'test-host' });
    expect(runState.runStatus).toBe('completed');

    // Resume neither refused (`RUN-107`) nor fast-forwarded/reset the branch to `main` — it continued
    // building on the diverged tip exactly as it was (its own `implement` lane is later auto-merged on
    // top, `06` §6.4, so `HEAD` moves *forward* from here, but never discards or bypasses this commit,
    // and `main`'s own hotfix is never folded in).
    const mainTip = (await execa('git', ['rev-parse', 'main'], { cwd: project.dir })).stdout.trim();
    const headAfter = (
      await execa('git', ['rev-parse', 'HEAD'], { cwd: integrationPath })
    ).stdout.trim();
    const stillHasDivergedCommit = await execa(
      'git',
      ['merge-base', '--is-ancestor', integrationTipDiverged, headAfter],
      { cwd: integrationPath, reject: false },
    );
    expect(stillHasDivergedCommit.exitCode).toBe(0);
    const hotfixWasFoldedIn = await execa(
      'git',
      ['merge-base', '--is-ancestor', mainTip, headAfter],
      {
        cwd: integrationPath,
        reject: false,
      },
    );
    expect(hotfixWasFoldedIn.exitCode).not.toBe(0);

    // And the resumed run's own lane, branched from that same diverged tip, genuinely does not see the
    // hotfix main gained after the crash -- proof by absence, not merely "no error was thrown".
    const lanes = await runLanes(project.paths, project.dir, runId);
    const laneId = lanes[0]?.laneId;
    if (laneId === undefined) throw new Error('resumed run left no lane');
    const laneDir = project.paths.resolveState(`worktrees/${laneId}`);
    await expect(readFile(path.join(laneDir, 'hotfix-after-crash.txt'), 'utf8')).rejects.toThrow();
    await expect(
      readFile(path.join(laneDir, 'integration-only-after-crash.txt'), 'utf8'),
    ).resolves.toBe('i\n');
  }, 30_000);

  it('a resumed run threads the real run id into the launcher shim, so a gate check it genuinely re-dispatches after the crash carries the FORGE run marker (@forge/core/session-marker, PLAN-M14.md P4) -- not merely a command step (which self-stamps regardless), but the gate-check path, which depends on this threading', async () => {
    const project = await createTestProject({ variant: 'slow' });
    const runId = 'run-crash-marker';

    // The fixture gate's own check, extended (not replaced) to also record $FORGE_RUN_ID to a file in
    // its own cwd (`ctx.integrationPath`, `runGateStep`'s own doc comment) -- the check still returns
    // the required `{"ok":true}` JSON envelope on stdout, unaffected.
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

    await spawnAndKill(project.paths, project.dir, runId);

    const deps = { ...testRunDeps(project), launcher: currentLauncher(process.env) };
    const { runState } = await resumeWorkflow(deps, { runId, host: 'test-host' });
    expect(runState.runStatus).toBe('completed');
    expect(runState.unresolvedStepIds).toEqual([]);

    const marker = await readFile(
      path.join(
        project.dir,
        '.forge/state/worktrees/integration-forge-integration-current',
        'run-id-marker.txt',
      ),
      'utf8',
    );
    expect(marker).toBe(runId);
  }, 30_000);
});
