/**
 * `forge land [--run <id>]` (`specs/22` M17 P9, `06` §6.5's "Landing a finished run on trunk"
 * paragraph), invoked as a real subprocess: proves the CLI dispatch wiring itself (`bin.ts`'s `land`
 * branch — reading `--run`, resolving the run's own integration branch, calling the real
 * `landRunOnTrunk`, printing the exact `--json` envelope and returning the right exit code).
 * `context.test.ts`'s own direct, in-process calls of `landRunOnTrunk` already prove the underlying
 * git mechanics exhaustively (both no-op shapes, the fast-forward, and both refusals); this file
 * proves only that the real CLI reaches that function with the real, resolved arguments — the
 * identical split `bin-parity-check.test.ts` already establishes for `forge parity check` versus
 * `check-command.test.ts`.
 *
 * `DEFAULT_CONFIG` (confirmed valid against the real `configSchema` directly, `bin-parity-check.
 * test.ts`'s own identical `freshCapturedProject` doc comment has the fuller reasoning) builds each
 * project's `.forge/config.yaml`, never a fresh `forge init`. `resolveDispatchRunId`/
 * `integrationBranchOfRun` tolerate a run with no manifest at all (falling back to the default
 * `execution.integrationBranch` template), so these tests never need a real agent-driven `forge run`
 * to have happened first — a real `ensureIntegrationWorktree` call, the identical real primitive
 * `forge merge`/a real run both use to find or create it, is enough to set the stage.
 *
 * @see specs/06 §6.5
 * @see PLAN-M17.md P9
 */
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { execa } from 'execa';
import { ProjectPaths } from '@forge/core/fs';
import { DEFAULT_CONFIG, type ForgeConfig } from '@forge/schemas/config';
import { appendEvent } from '@forge/telemetry/events';
import { afterEach, describe, expect, it } from 'vitest';
import * as YAML from 'yaml';

import { ensureIntegrationWorktree } from '../src/commands/run/context.ts';

const LAUNCHER = fileURLToPath(new URL('../bin/forge.mjs', import.meta.url));

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

interface Result {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

function forge(args: readonly string[], cwd: string): Result {
  try {
    const stdout = execFileSync(process.execPath, [LAUNCHER, ...args], {
      encoding: 'utf8',
      cwd,
      timeout: 60_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const e = error as { status: number | null; stdout: string; stderr: string };
    return { status: e.status ?? 1, stdout: e.stdout, stderr: e.stderr };
  }
}

function lastJsonLine(stdout: string): unknown {
  const lines = stdout.split('\n').filter((line) => line.trim().length > 0);
  expect(lines).toHaveLength(1); // `--json` prints exactly one line (`03` §3.5).
  return JSON.parse(lines[0] ?? '');
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await execa('git', args, { cwd })).stdout;
}

async function commitAll(dir: string, message: string): Promise<void> {
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', message], { cwd: dir });
}

/** A real project on `trunk` with a real `forge/integration/current` worktree already created from it
 * (`ensureIntegrationWorktree`, the identical real primitive a lane's own first commit, or `forge
 * merge`, would already have caused to exist) — what a run that reached its own first lane leaves
 * behind, without needing a real agent session to get there. */
async function projectWithIntegrationWorktree(
  trunk: string,
  config: ForgeConfig = DEFAULT_CONFIG,
): Promise<{ readonly dir: string; readonly integrationPath: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-p9-bin-land-'));
  dirs.push(dir);
  await mkdir(path.join(dir, '.forge'), { recursive: true });
  await writeFile(path.join(dir, '.forge/config.yaml'), YAML.stringify(config), 'utf8');
  await execa('git', ['init', '--quiet', '-b', trunk], { cwd: dir });
  await execa('git', ['config', 'user.email', 't@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 't'], { cwd: dir });
  await writeFile(path.join(dir, '.gitignore'), '.forge/state/\n', 'utf8');
  await commitAll(dir, 'init');

  const integrationPath = await ensureIntegrationWorktree(
    new ProjectPaths(dir),
    dir,
    'forge/integration/current',
    trunk,
  );
  return { dir, integrationPath };
}

describe('forge land (real subprocess dispatch) (specs/22 M17 P9)', () => {
  it("fast-forwards trunk to the integration branch's tip for real, under --json", async () => {
    const { dir, integrationPath } = await projectWithIntegrationWorktree('main');
    await writeFile(path.join(integrationPath, 'landed.txt'), 'work\n', 'utf8');
    await execa('git', ['add', 'landed.txt'], { cwd: integrationPath });
    await execa('git', ['commit', '--quiet', '-m', 'lane work'], { cwd: integrationPath });
    const integrationTip = (await git(integrationPath, 'rev-parse', 'HEAD')).trim();

    const result = forge(['land', '--run', 'run-x', '--json', '-C', dir], dir);

    expect(result.status).toBe(0);
    const envelope = lastJsonLine(result.stdout) as {
      readonly v: number;
      readonly mergesDirectly: boolean;
      readonly trunkTip: string;
      readonly landed: boolean;
    };
    expect(envelope).toEqual({
      v: 1,
      mergesDirectly: false,
      trunkTip: integrationTip,
      landed: true,
    });
    expect((await git(dir, 'rev-parse', 'main')).trim()).toBe(integrationTip);
  });

  it("warns (never refuses) when --run names an earlier run but the shared integration branch also carries a LATER run's own work (critic round 1: --run does not scope what lands)", async () => {
    const { dir, integrationPath } = await projectWithIntegrationWorktree('main');
    // Run A lands its own one commit, and a real engine would have logged exactly this MergeCompleted.
    await writeFile(path.join(integrationPath, 'a.txt'), 'a\n', 'utf8');
    await execa('git', ['add', 'a.txt'], { cwd: integrationPath });
    await execa('git', ['commit', '--quiet', '-m', 'run A lane work'], { cwd: integrationPath });
    const runATip = (await git(integrationPath, 'rev-parse', 'HEAD')).trim();
    await appendEvent(dir, 'run-a', {
      ts: '2026-01-01T00:00:00.000Z',
      runId: 'run-a',
      type: 'MergeCompleted',
      payload: { mergeCommitSha: runATip },
    });
    // Run B lands onto the SAME shared branch afterward -- the exact repro the critic constructed.
    await writeFile(path.join(integrationPath, 'b.txt'), 'b\n', 'utf8');
    await execa('git', ['add', 'b.txt'], { cwd: integrationPath });
    await execa('git', ['commit', '--quiet', '-m', 'run B lane work'], { cwd: integrationPath });
    const runBTip = (await git(integrationPath, 'rev-parse', 'HEAD')).trim();

    const result = forge(['land', '--run', 'run-a', '--json', '-C', dir], dir);

    expect(result.status).toBe(0);
    const envelope = lastJsonLine(result.stdout) as {
      readonly landed: boolean;
      readonly trunkTip: string;
      readonly warning?: string;
    };
    // It still lands everything -- there is no partial-landing mechanism -- but says so honestly.
    expect(envelope.landed).toBe(true);
    expect(envelope.trunkTip).toBe(runBTip);
    expect(envelope.warning).toBeDefined();
    expect(envelope.warning).toContain('run-a');
    expect(envelope.warning).toContain(runATip.slice(0, 12));
    expect((await git(dir, 'rev-parse', 'main')).trim()).toBe(runBTip);
  });

  it('prints a human-readable summary naming trunk and the new tip without --json', async () => {
    const { dir, integrationPath } = await projectWithIntegrationWorktree('main');
    await writeFile(path.join(integrationPath, 'landed.txt'), 'work\n', 'utf8');
    await execa('git', ['add', 'landed.txt'], { cwd: integrationPath });
    await execa('git', ['commit', '--quiet', '-m', 'lane work'], { cwd: integrationPath });
    const integrationTip = (await git(integrationPath, 'rev-parse', 'HEAD')).trim();

    const result = forge(['land', '--run', 'run-x', '-C', dir], dir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('main');
    expect(result.stdout).toContain(integrationTip);
  });

  it('is a real no-op (exit 0) when there is nothing to land', async () => {
    const { dir } = await projectWithIntegrationWorktree('main');

    const result = forge(['land', '--run', 'run-x', '--json', '-C', dir], dir);

    expect(result.status).toBe(0);
    const envelope = lastJsonLine(result.stdout) as { readonly landed: boolean };
    expect(envelope.landed).toBe(false);
  });

  it('merges directly to trunk (no-op, exit 0) when execution.integrationBranch already names trunk itself (06 §6.5)', async () => {
    const config: ForgeConfig = {
      ...DEFAULT_CONFIG,
      execution: { ...DEFAULT_CONFIG.execution, integrationBranch: 'main' },
    };
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-p9-bin-land-direct-'));
    dirs.push(dir);
    await mkdir(path.join(dir, '.forge'), { recursive: true });
    await writeFile(path.join(dir, '.forge/config.yaml'), YAML.stringify(config), 'utf8');
    await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
    await execa('git', ['config', 'user.email', 't@example.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 't'], { cwd: dir });
    await writeFile(path.join(dir, '.gitignore'), '.forge/state/\n', 'utf8');
    await commitAll(dir, 'init');

    const result = forge(['land', '--run', 'run-x', '--json', '-C', dir], dir);

    expect(result.status).toBe(0);
    const envelope = lastJsonLine(result.stdout) as {
      readonly mergesDirectly: boolean;
      readonly landed: boolean;
    };
    expect(envelope).toMatchObject({ mergesDirectly: true, landed: false });
  });

  it("refuses typed (RUN-155) when the project's own working tree is not on trunk", async () => {
    const { dir } = await projectWithIntegrationWorktree('main');
    await execa('git', ['checkout', '-b', 'feature'], { cwd: dir });

    const result = forge(['land', '--run', 'run-x', '--json', '-C', dir], dir);

    expect(result.status).toBe(1);
    const envelope = lastJsonLine(result.stdout) as {
      readonly ok: boolean;
      readonly error: { readonly code: string };
    };
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe('RUN-155');
  });

  it('refuses typed (RUN-156) when trunk has diverged from the integration branch', async () => {
    const { dir, integrationPath } = await projectWithIntegrationWorktree('main');
    await writeFile(path.join(dir, 'main-only.txt'), 'm\n', 'utf8');
    await commitAll(dir, 'main-only');
    await writeFile(path.join(integrationPath, 'integration-only.txt'), 'i\n', 'utf8');
    await execa('git', ['add', '-A'], { cwd: integrationPath });
    await execa('git', ['commit', '--quiet', '-m', 'integration-only'], { cwd: integrationPath });

    const result = forge(['land', '--run', 'run-x', '--json', '-C', dir], dir);

    expect(result.status).toBe(1);
    const envelope = lastJsonLine(result.stdout) as {
      readonly ok: boolean;
      readonly error: { readonly code: string };
    };
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe('RUN-156');
  });

  it('works for a real, non-default vcs.trunk ("master"), through the real CLI', async () => {
    const config: ForgeConfig = {
      ...DEFAULT_CONFIG,
      vcs: { ...DEFAULT_CONFIG.vcs, trunk: 'master' },
    };
    const { dir, integrationPath } = await projectWithIntegrationWorktree('master', config);
    await writeFile(path.join(integrationPath, 'landed.txt'), 'work\n', 'utf8');
    await execa('git', ['add', 'landed.txt'], { cwd: integrationPath });
    await execa('git', ['commit', '--quiet', '-m', 'lane work'], { cwd: integrationPath });
    const integrationTip = (await git(integrationPath, 'rev-parse', 'HEAD')).trim();

    const result = forge(['land', '--run', 'run-x', '--json', '-C', dir], dir);

    expect(result.status).toBe(0);
    expect((await git(dir, 'rev-parse', 'master')).trim()).toBe(integrationTip);
  });

  it("resolves --run from the project's own last-run.json when --run is omitted, exactly as forge merge does", async () => {
    const { dir, integrationPath } = await projectWithIntegrationWorktree('main');
    await writeFile(path.join(integrationPath, 'landed.txt'), 'work\n', 'utf8');
    await execa('git', ['add', 'landed.txt'], { cwd: integrationPath });
    await execa('git', ['commit', '--quiet', '-m', 'lane work'], { cwd: integrationPath });
    await mkdir(path.join(dir, '.forge/state'), { recursive: true });
    await writeFile(
      path.join(dir, '.forge/state/last-run.json'),
      JSON.stringify({ runId: 'run-from-last-run-json' }),
      'utf8',
    );

    const result = forge(['land', '--json', '-C', dir], dir);

    expect(result.status).toBe(0);
    const envelope = lastJsonLine(result.stdout) as { readonly landed: boolean };
    expect(envelope.landed).toBe(true);
  });

  it('refuses RUN-048 (never a crash) when neither --run nor a last-run.json is available', async () => {
    const { dir } = await projectWithIntegrationWorktree('main');

    const result = forge(['land', '--json', '-C', dir], dir);

    // `RUN-048` is registered at `EXIT_CODES.usage` (2) -- "no run specified and nothing to default
    // to" (codes.ts's own comment on it), not a generic failure.
    expect(result.status).toBe(2);
    const envelope = lastJsonLine(result.stdout) as {
      readonly ok: boolean;
      readonly error: { readonly code: string };
    };
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe('RUN-048');
  });
});
