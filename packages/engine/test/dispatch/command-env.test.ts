/**
 * The environment a run's shell commands inherit (`ExecuteStepContext.commandEnv`, `PLAN-M13.md` P12,
 * `Q208` finding 3): a `command` step, a gate check and a merge check that call `forge ...` reach the
 * `forge` that launched the run, even though none is on the ambient `PATH`.
 *
 * @see specs/06 §6.4, §6.5
 * @see specs/10 §10.1, §10.3
 */
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { executeStep } from '../../src/dispatch/execute.ts';
import {
  createGateEvaluator,
  createMergeQueueFacade,
  createVcsFacade,
} from '../../src/dispatch/facades.ts';
import type { GateDefinition } from '../../src/gates/index.ts';
import { createTestContext, node } from './helpers.ts';

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempRepo(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `forge-cmdenv-${prefix}-`));
  cleanup.push(dir);
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

/** A directory holding a `forge` that prints `launched-by-the-run <args>`; `name` may contain spaces/quotes. */
async function launcherDir(name = 'forge-bin'): Promise<string> {
  const parent = await mkdtemp(path.join(tmpdir(), 'forge-cmdenv-bin-'));
  cleanup.push(parent);
  const dir = path.join(parent, name);
  await mkdir(dir);
  const file = path.join(dir, 'forge');
  await writeFile(file, '#!/bin/sh\necho "launched-by-the-run $*"\n');
  await chmod(file, 0o755);
  return dir;
}

/** `PATH` with the launcher first and only the system directories after: no real `forge` anywhere. */
const envWith = (dir: string): Record<string, string> => ({
  PATH: `${dir}${path.delimiter}/usr/bin${path.delimiter}/bin`,
});

describe('a command step under the run launcher environment', () => {
  it('reaches the launcher `forge` although the ambient PATH has none (inline step)', async () => {
    const projectRoot = await tempRepo('inline');
    const ctx = createTestContext({ projectRoot });
    const dir = await launcherDir();
    const outcome = await executeStep(
      node({ id: 'wf:sync', kind: 'command', run: 'forge kb sync', laneAffinity: 'inline' }),
      { ...ctx, commandEnv: envWith(dir) },
    );
    expect(outcome.status).toBe('succeeded');
    if (outcome.detail.kind === 'command') {
      expect(outcome.detail.stdout).toBe('launched-by-the-run kb sync');
    }
  });

  it('reaches it from a lane worktree too (the non-inline path)', async () => {
    const projectRoot = await tempRepo('lane');
    const ctx = createTestContext({ projectRoot });
    const dir = await launcherDir();
    const outcome = await executeStep(
      node({ id: 'wf:sync', kind: 'command', run: 'forge plan run-plan S1' }),
      { ...ctx, commandEnv: envWith(dir) },
    );
    expect(outcome.status).toBe('succeeded');
    if (outcome.detail.kind === 'command') {
      expect(outcome.detail.stdout).toBe('launched-by-the-run plan run-plan S1');
    }
  });

  it('works when the launcher directory contains spaces and quotes: the path is data, not shell syntax', async () => {
    const projectRoot = await tempRepo('spaces');
    const ctx = createTestContext({ projectRoot });
    const dir = await launcherDir(`my forge's "bin" $HOME`);
    const outcome = await executeStep(
      node({ id: 'wf:sync', kind: 'command', run: 'forge --version', laneAffinity: 'inline' }),
      { ...ctx, commandEnv: envWith(dir) },
    );
    expect(outcome.status).toBe('succeeded');
    if (outcome.detail.kind === 'command') {
      expect(outcome.detail.stdout).toBe('launched-by-the-run --version');
    }
  });

  it('without the environment, a `forge` command still fails as before (127), proving the overlay is what fixes it', async () => {
    const projectRoot = await tempRepo('absent');
    const ctx = createTestContext({ projectRoot });
    const outcome = await executeStep(
      node({
        id: 'wf:sync',
        kind: 'command',
        run: 'forge-not-installed-anywhere kb sync',
        laneAffinity: 'inline',
      }),
      ctx,
    );
    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.code).toBe('127');
  });

  it('leaves the rest of the parent environment in place (only PATH is overlaid)', async () => {
    const projectRoot = await tempRepo('rest');
    const ctx = createTestContext({ projectRoot });
    const outcome = await executeStep(
      node({ id: 'wf:env', kind: 'command', run: 'echo "$HOME"', laneAffinity: 'inline' }),
      { ...ctx, commandEnv: { FORGE_TEST_MARKER: 'x' } },
    );
    if (outcome.detail.kind === 'command') {
      expect(outcome.detail.stdout).toBe(process.env['HOME'] ?? '');
    }
  });

  it('carries the FORGE run/step marker (@forge/core/session-marker, PLAN-M14.md P4): FORGE_RUN_ID === ctx.runId, FORGE_STEP_ID === the step id', async () => {
    const projectRoot = await tempRepo('marker');
    const ctx = createTestContext({ projectRoot, runId: 'run-cmdenv-marker' });
    const outcome = await executeStep(
      node({
        id: 'wf:marker',
        kind: 'command',
        run: 'echo "$FORGE_RUN_ID:$FORGE_STEP_ID"',
        laneAffinity: 'inline',
      }),
      ctx,
    );
    expect(outcome.status).toBe('succeeded');
    if (outcome.detail.kind === 'command') {
      expect(outcome.detail.stdout).toBe('run-cmdenv-marker:wf:marker');
    }
  });

  it('carries the marker even when the launcher shim never ran (ctx.commandEnv undefined) -- the step stamps it itself, not merely inheriting it', async () => {
    const projectRoot = await tempRepo('marker-no-shim');
    const ctx = createTestContext({ projectRoot, runId: 'run-no-shim' });
    const outcome = await executeStep(
      node({
        id: 'wf:marker-no-shim',
        kind: 'command',
        run: 'echo "$FORGE_RUN_ID"',
        laneAffinity: 'inline',
      }),
      { ...ctx, commandEnv: undefined },
    );
    expect(outcome.status).toBe('succeeded');
    if (outcome.detail.kind === 'command') {
      expect(outcome.detail.stdout).toBe('run-no-shim');
    }
  });
});

describe('gate checks and merge checks share the run environment', () => {
  it('a gate check that calls `forge` reaches the launcher', async () => {
    const dir = await launcherDir();
    const projectRoot = await tempRepo('gate');
    const gate: GateDefinition = {
      id: 'G-Check',
      checks: {
        deterministic: [{ id: 'launcher', run: 'forge spec validate --rule x', failOn: 'false' }],
        advisory: [],
      },
      openQuestionsPolicy: 'warn',
    };
    const evaluator = createGateEvaluator(new Map([[gate.id, gate]]), { env: envWith(dir) });
    const report = await evaluator.evaluate(gate.id, projectRoot);
    const check = report.checks.find((c) => c.checkId === 'launcher');
    expect(check?.exitCode).toBe(0);
    expect(check?.stdout).toBe('launched-by-the-run spec validate --rule x');
  });

  it('a merge pre-check that calls `forge` reaches the launcher', async () => {
    const dir = await launcherDir();
    const projectRoot = await tempRepo('merge');
    const base = createTestContext({ projectRoot, runId: 'run-merge-env' });
    const ctx = {
      ...base,
      vcs: createVcsFacade(projectRoot, 'run-merge-env'),
      mergeQueue: createMergeQueueFacade(projectRoot, undefined, { env: envWith(dir) }),
    };
    await executeStep(
      node({ id: 'wf:produce', kind: 'command', run: 'echo x > out.txt', produces: ['out.txt'] }),
      ctx,
    );
    const outcome = await executeStep(
      node({
        id: 'wf:merge',
        kind: 'merge',
        dependsOn: ['wf:produce'],
        // Passes only if `forge` resolves to the launcher (its marker), not to any other `forge`.
        mergePolicy: {
          conflict: 'abort',
          preChecks: 'forge kb sync | grep -q launched-by-the-run',
        },
      }),
      ctx,
    );
    expect(outcome.status).toBe('succeeded');
  });
});
