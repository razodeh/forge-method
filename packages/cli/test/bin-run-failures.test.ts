/**
 * Real-subprocess proof of `PLAN-M13.md` P12 (`Q208` findings 1, 3, 6, 7) through the actual `forge`
 * launcher: a failed run says why (with a remedy and its own exit code), a dirty tree is a refusal and not a
 * stack trace, `forge` resolves inside command steps with no `forge` on `PATH`, and `forge init -C <dir>`
 * writes into `<dir>` and nowhere else.
 *
 * @see specs/02 §2.6
 * @see specs/03 §3.2
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { execa } from 'execa';
import { DEFAULT_CONFIG } from '@forge/schemas/config';
import * as YAML from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

const LAUNCHER = fileURLToPath(new URL('../bin/forge.mjs', import.meta.url));
const SYSTEM_PATH = '/usr/bin:/bin';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function scratch(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `forge-cli-p12-${prefix}-`));
  dirs.push(dir);
  return dir;
}

interface Result {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

function run(
  args: readonly string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
): Result {
  try {
    const stdout = execFileSync(process.execPath, [LAUNCHER, ...args], {
      encoding: 'utf8',
      timeout: 60_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      env: { ...process.env, ...options.env },
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const e = error as { status: number | null; stdout: string; stderr: string };
    return { status: e.status ?? 1, stdout: e.stdout, stderr: e.stderr };
  }
}

const workflow = (id: string, steps: string): string => `id: ${id}
name: P12 fixture
version: 1.0.0
description: Real-subprocess fixture for the P12 fixes.

steps:
${steps}
`;

const COMMAND_ONLY = `  - id: check-forge
    kind: command
    run: "forge --version | grep -q ."
    inline: true`;

const SLOW_COMMAND = `  - id: wait
    kind: command
    run: "forge --version >/dev/null && sleep 20"
    inline: true`;

/** An agent step whose reservation (the compile placeholder, $2.00: the agent file is absent) exceeds a
 * $1.00 run budget, so admission control refuses it before any session could start: no model, no spend. */
const AGENT_STEP = `  - id: think
    kind: agent
    agent: engineer
    brief: briefs/think.md
  - id: after
    kind: command
    run: "true"
    inline: true
    dependsOn: [ think ]`;

async function project(
  options: { readonly perRunUsd?: number; readonly perStepUsdDefault?: number } = {},
): Promise<string> {
  const dir = await scratch('project');
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 'fixture@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'Fixture'], { cwd: dir });
  const config = {
    ...DEFAULT_CONFIG,
    budget: {
      ...DEFAULT_CONFIG.budget,
      perRunUsd: options.perRunUsd ?? DEFAULT_CONFIG.budget.perRunUsd,
      perStepUsdDefault: options.perStepUsdDefault ?? DEFAULT_CONFIG.budget.perStepUsdDefault,
    },
  };
  await mkdir(path.join(dir, '.forge/workflows'), { recursive: true });
  await mkdir(path.join(dir, '.forge/checks'), { recursive: true });
  await writeFile(path.join(dir, '.forge/config.yaml'), YAML.stringify(config));
  await writeFile(
    path.join(dir, '.forge/workflows/p12-command.workflow.yaml'),
    workflow('p12-command', COMMAND_ONLY),
  );
  await writeFile(
    path.join(dir, '.forge/workflows/p12-slow.workflow.yaml'),
    workflow('p12-slow', SLOW_COMMAND),
  );
  await writeFile(
    path.join(dir, '.forge/workflows/p12-agent.workflow.yaml'),
    workflow('p12-agent', AGENT_STEP),
  );
  await writeFile(path.join(dir, '.gitignore'), '.forge/state/\n');
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: dir });
  return dir;
}

describe('forge run: a failed run says why (Q208 finding 1)', () => {
  it('a budget refusal prints the step, its reservation, the remaining budget and the remedy, and exits 4', async () => {
    const dir = await project({ perRunUsd: 1 });
    const result = run(['run', 'p12-agent', '-C', dir]);

    expect(result.stdout).toContain('status=failed');
    expect(result.status).toBe(4);
    expect(result.stderr).toContain('Step p12-agent:think was not started');
    expect(result.stderr).toContain('$0.00 already spent plus its $2.00 reservation');
    expect(result.stderr).toContain('would reach the run budget of $1.00');
    expect(result.stderr).toContain('Raise `budget.perRunUsd`');
    expect(result.stderr).toContain('limits.max_cost_usd');
    expect(result.stderr).not.toMatch(/\n\s+at /u);
  });

  it('--json keeps stdout one JSON line carrying runState.runFailure, and reports the same reason and exit code', async () => {
    const dir = await project({ perRunUsd: 1 });
    const result = run(['run', 'p12-agent', '-C', dir, '--json']);

    expect(result.status).toBe(4);
    expect(result.stderr).toContain('Step p12-agent:think was not started');
    const lines = result.stdout.trim().split('\n');
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? '') as {
      readonly runState: {
        readonly runStatus: string;
        readonly runFailure: { readonly reason: string };
      };
    };
    expect(parsed.runState.runStatus).toBe('failed');
    expect(parsed.runState.runFailure.reason).toBe('budget');
  });
});

describe("forge run: the step reservation comes from the project's budget.perStepUsdDefault", () => {
  it('reserves the configured per-step default (no step limit, no agent file), not the placeholder', async () => {
    const dir = await project({ perRunUsd: 1, perStepUsdDefault: 1.5 });
    const result = run(['run', 'p12-agent', '-C', dir]);
    expect(result.status).toBe(4);
    expect(result.stderr).toContain('its $1.50 reservation');
  });

  it('and is admitted when the run budget covers it: the command step after it is free', async () => {
    const dir = await project({ perRunUsd: 1, perStepUsdDefault: 0.5 });
    const result = run(['run', 'p12-agent', '-C', dir]);
    // Admitted (0.5 < 1); the agent's own session then fails for lack of an agent file, which is a
    // different, named failure: not a budget one.
    expect(result.stderr).not.toContain('was not started');
    expect(result.stdout).toContain('status=failed');
  });
});

describe('forge run: `forge` resolves inside command steps (Q208 finding 3)', () => {
  it('a command step that calls `forge` succeeds with no `forge` on PATH, and leaves no shim behind', async () => {
    const dir = await project();
    // A private temp dir whose own path contains a space: the shim lives under it and must still work.
    const tmp = path.join(await scratch('tmp'), 'my tmp dir');
    await mkdir(tmp);

    const result = run(['run', 'p12-command', '-C', dir], {
      env: { PATH: SYSTEM_PATH, TMPDIR: tmp },
    });

    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('status=completed');
    expect(result.status).toBe(0);
    expect(await readdir(tmp)).toEqual([]);
  });

  it('removes the shim after a failed run too', async () => {
    const dir = await project({ perRunUsd: 1 });
    const tmp = await scratch('tmp-failed');
    run(['run', 'p12-agent', '-C', dir], { env: { PATH: SYSTEM_PATH, TMPDIR: tmp } });
    expect(await readdir(tmp)).toEqual([]);
  });
});

/** Starts `forge <args>` in its own process group, waits until a launcher directory appears under `tmp`, sends
 * `signal` to the whole group and resolves when the launcher process has exited. */
async function signalWhileRunning(
  args: readonly string[],
  tmp: string,
  signal: NodeJS.Signals,
): Promise<void> {
  const child = spawn(process.execPath, [LAUNCHER, ...args], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, PATH: SYSTEM_PATH, TMPDIR: tmp },
  });
  const exited = new Promise<void>((resolve) =>
    child.once('exit', () => {
      resolve();
    }),
  );
  const deadline = Date.now() + 40_000;
  while ((await readdir(tmp)).length === 0) {
    if (Date.now() > deadline) throw new Error('the launcher directory never appeared');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  process.kill(-(child.pid ?? 0), signal);
  await exited;
  // The child of the launcher may outlive its parent by a moment; wait for the group to drain.
  await new Promise((resolve) => setTimeout(resolve, 500));
}

describe('forge run and forge resume remove the launcher shim when interrupted', () => {
  it.each(['SIGTERM', 'SIGINT'] as const)(
    '%s during forge run',
    async (signal) => {
      const dir = await project();
      const tmp = await scratch('tmp-signal');
      await signalWhileRunning(['run', 'p12-slow', '-C', dir], tmp, signal);
      expect(await readdir(tmp)).toEqual([]);
    },
    90_000,
  );

  it('SIGTERM during forge resume', async () => {
    const dir = await project();
    const tmp = await scratch('tmp-resume');
    // Interrupt a first run so there is something to resume (SIGKILL leaves its shim: clear it by hand).
    await signalWhileRunning(['run', 'p12-slow', '-C', dir], tmp, 'SIGKILL');
    for (const leftover of await readdir(tmp))
      await rm(path.join(tmp, leftover), { recursive: true });
    await signalWhileRunning(['resume', '-C', dir], tmp, 'SIGTERM');
    expect(await readdir(tmp)).toEqual([]);
  }, 120_000);
});

describe('forge run: a corrupt event log is a refusal, not a stack trace', () => {
  it('prints the log error and its remedy without a Node stack', async () => {
    const dir = await project();
    const first = run(['run', 'p12-command', '-C', dir], { env: { PATH: SYSTEM_PATH } });
    expect(first.status).toBe(0);
    const runsDir = path.join(dir, '.forge/state/runs');
    const [runId] = await readdir(runsDir);
    const log = path.join(runsDir, runId ?? '', 'events.ndjson');
    const lines = (await readFile(log, 'utf8')).trim().split('\n');
    // Remove one middle event: a gap in `seq`, which `18` §18.4 says means corruption.
    lines.splice(1, 1);
    await writeFile(log, `${lines.join('\n')}\n`);

    const result = run(['resume', '-C', dir], { env: { PATH: SYSTEM_PATH } });

    expect(result.status).not.toBe(0);
    expect(result.stderr).not.toMatch(/\n\s+at /u);
    expect(result.stderr.trim().split('\n').length).toBeGreaterThanOrEqual(2);
  });
});

describe('forge run: a dirty working tree is a refusal, not a stack trace (Q208 finding 6)', () => {
  it('names the files, says to commit or stash, exits 5, prints no Node stack', async () => {
    const dir = await project();
    await writeFile(path.join(dir, 'stray.txt'), 'uncommitted');
    await writeFile(path.join(dir, 'run.err'), 'uncommitted');

    const result = run(['run', 'p12-command', '-C', dir]);

    expect(result.status).toBe(5);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      'The working tree has 2 uncommitted change(s): run.err, stray.txt.',
    );
    expect(result.stderr).toContain('Run `git stash`, or commit your changes');
    expect(result.stderr).not.toContain('VcsError');
    expect(result.stderr).not.toContain('assertCleanWorkingTree');
    expect(result.stderr).not.toMatch(/\n\s+at /u);
  });

  it('is identical under --json on stderr and exit code, and stdout is the one-line JSON error envelope (P21)', async () => {
    const dir = await project();
    await writeFile(path.join(dir, 'stray.txt'), 'uncommitted');
    const plain = run(['run', 'p12-command', '-C', dir]);
    const json = run(['run', 'p12-command', '-C', dir, '--json']);
    expect(json.status).toBe(plain.status);
    expect(json.stderr).toBe(plain.stderr);
    // Was: nothing on stdout ("this dispatcher has no JSON error envelope for any refusal", Q210 decision 8).
    expect(plain.stdout).toBe('');
    expect(json.stdout.trimEnd().split('\n')).toHaveLength(1);
    const envelope = JSON.parse(json.stdout) as {
      v: number;
      ok: boolean;
      error: { code: string; message: string; remedy: string; exitCode: number };
    };
    expect(envelope.v).toBe(1);
    expect(envelope.ok).toBe(false);
    expect(Object.keys(envelope.error).sort()).toEqual(['code', 'exitCode', 'message', 'remedy']);
    expect(envelope.error.code).toBe('VCS-010');
    expect(envelope.error.exitCode).toBe(5);
    expect(envelope.error.message).toContain(
      'The working tree has 1 uncommitted change(s): stray.txt.',
    );
    expect(envelope.error.remedy).toContain('Run `git stash`, or commit your changes');
    expect(json.stdout).not.toMatch(/\n\s+at /u);
  });

  it('never leaves the run half-started: no run directory is created for a refused run', async () => {
    const dir = await project();
    await writeFile(path.join(dir, 'stray.txt'), 'uncommitted');
    run(['run', 'p12-command', '-C', dir]);
    expect(existsSync(path.join(dir, '.forge/state/runs'))).toBe(false);
  });
});

describe('forge run: a diverged integration branch is a refusal, not a stack trace (M14 P9, SPEC-QUESTIONS.md Q232 decision 18)', () => {
  it('exits 1, names RUN-107, leaves no MERGE_HEAD or half-merge in the integration worktree, and creates no new run directory', async () => {
    const dir = await project();
    // A first, real run: creates the integration branch (equal to main, no lane in this fixture).
    const first = run(['run', 'p12-command', '-C', dir]);
    expect(first.status).toBe(0);
    const runsDir = path.join(dir, '.forge/state/runs');
    const runDirsBefore = await readdir(runsDir);

    // Diverge main and the integration branch for real: a commit on each side the other does not have.
    await writeFile(path.join(dir, 'main-only.txt'), 'm\n');
    await execa('git', ['add', 'main-only.txt'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'main-only'], { cwd: dir });
    const integrationPath = path.join(
      dir,
      '.forge/state/worktrees/integration-forge-integration-current',
    );
    await writeFile(path.join(integrationPath, 'integration-only.txt'), 'i\n');
    await execa('git', ['add', 'integration-only.txt'], { cwd: integrationPath });
    await execa('git', ['commit', '--quiet', '-m', 'integration-only'], { cwd: integrationPath });

    const second = run(['run', 'p12-command', '-C', dir]);

    expect(second.status).toBe(1);
    expect(second.stdout).toBe('');
    // Plain-text refusals print the message and remedy, not the bare code (`--json` below carries that).
    // The message names the real `trunk` value passed to the sync (always `main` in production), not a
    // hardcoded literal.
    expect(second.stderr).toContain('diverged from main');
    expect(second.stderr).toContain('Merge the trunk branch into the integration branch');
    expect(second.stderr).not.toContain('VcsError');
    expect(second.stderr).not.toMatch(/\n\s+at /u);

    // No merge was ever attempted: no MERGE_HEAD, a perfectly clean status in the integration worktree.
    await expect(
      execa('git', ['rev-parse', '--verify', 'MERGE_HEAD'], { cwd: integrationPath }),
    ).rejects.toThrow();
    expect((await execa('git', ['status', '--porcelain'], { cwd: integrationPath })).stdout).toBe(
      '',
    );

    // No new run directory for the refused second attempt.
    expect((await readdir(runsDir)).sort()).toEqual(runDirsBefore.sort());
  });

  it('is identical under --json: one-line envelope, code RUN-107, exit 1', async () => {
    const dir = await project();
    const first = run(['run', 'p12-command', '-C', dir]);
    expect(first.status).toBe(0);

    await writeFile(path.join(dir, 'main-only.txt'), 'm\n');
    await execa('git', ['add', 'main-only.txt'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'main-only'], { cwd: dir });
    const integrationPath = path.join(
      dir,
      '.forge/state/worktrees/integration-forge-integration-current',
    );
    await writeFile(path.join(integrationPath, 'integration-only.txt'), 'i\n');
    await execa('git', ['add', 'integration-only.txt'], { cwd: integrationPath });
    await execa('git', ['commit', '--quiet', '-m', 'integration-only'], { cwd: integrationPath });

    const json = run(['run', 'p12-command', '-C', dir, '--json']);
    expect(json.status).toBe(1);
    expect(json.stdout.trimEnd().split('\n')).toHaveLength(1);
    const envelope = JSON.parse(json.stdout) as {
      v: number;
      ok: boolean;
      error: { code: string; message: string; remedy: string; exitCode: number };
    };
    expect(envelope.v).toBe(1);
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe('RUN-107');
    expect(envelope.error.exitCode).toBe(1);
    expect(envelope.error.remedy).toContain('Merge the trunk branch into the integration branch');
  });
});

describe('forge merge: never re-syncs the integration branch with main (M14 P9, SPEC-QUESTIONS.md Q232 decision 18 — only forge run syncs)', () => {
  it('a real forge merge --all leaves a diverged integration branch untouched: no RUN-107, no fast-forward, no crash', async () => {
    // A critic round found this guarantee ("forge merge is excluded") was pinned only by replicating
    // `runMergeCommand`'s own call sequence by hand, never by exercising the real CLI entry point --
    // this drives the actual `forge merge` subprocess instead. `mergeAllReady` needs no real, landed
    // lane to prove the point: with zero `ready` lanes it is a real no-op after the exact two git calls
    // (`integrationBranchOfRun` + `ensureIntegrationWorktree`) `runMergeCommand` makes before ever
    // reaching it -- neither one syncs, so a genuinely diverged branch is simply not this command's
    // concern, and it exits cleanly rather than refusing.
    const dir = await project();
    const first = run(['run', 'p12-command', '-C', dir]);
    expect(first.status).toBe(0);

    // Diverge main and the integration branch for real: a commit on each side the other does not have.
    await writeFile(path.join(dir, 'main-only.txt'), 'm\n');
    await execa('git', ['add', 'main-only.txt'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'main-only'], { cwd: dir });
    const integrationPath = path.join(
      dir,
      '.forge/state/worktrees/integration-forge-integration-current',
    );
    await writeFile(path.join(integrationPath, 'integration-only.txt'), 'i\n');
    await execa('git', ['add', 'integration-only.txt'], { cwd: integrationPath });
    await execa('git', ['commit', '--quiet', '-m', 'integration-only'], { cwd: integrationPath });
    const integrationTipDiverged = (
      await execa('git', ['rev-parse', 'HEAD'], { cwd: integrationPath })
    ).stdout.trim();

    const merge = run(['merge', '--all', '-C', dir]);

    expect(merge.status).toBe(0);
    expect(merge.stderr).not.toContain('RUN-107');
    expect(merge.stderr).not.toMatch(/\n\s+at /u);
    expect(JSON.parse(merge.stdout)).toEqual([]);

    // Concretely: the integration branch was never fast-forwarded or reset -- still exactly where the
    // test's own manual commit left it.
    expect(
      (await execa('git', ['rev-parse', 'HEAD'], { cwd: integrationPath })).stdout.trim(),
    ).toBe(integrationTipDiverged);
  });
});

describe('forge init honours -C (Q208 finding 7)', () => {
  /** A directory `forge init` treats as already initialised, so no platform CLI is needed. */
  async function initialised(): Promise<string> {
    const dir = await scratch('init-target');
    await mkdir(path.join(dir, '.forge'), { recursive: true });
    await writeFile(path.join(dir, '.forge/config.yaml'), YAML.stringify(DEFAULT_CONFIG));
    return dir;
  }

  it('writes into <dir> and nothing into the current directory', async () => {
    const target = await initialised();
    const cwd = await scratch('init-cwd');

    const result = run(['init', '-C', target, '--name', 'Elsewhere', '--yes', '--json'], { cwd });

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      readonly result: { readonly projectRoot: string };
    };
    expect(parsed.result.projectRoot).toBe(target);
    expect(existsSync(path.join(target, '.forge/workflows'))).toBe(true);
    expect(await readdir(cwd)).toEqual([]);
  });

  it('resolves a [dir] argument against -C', async () => {
    const base = await scratch('init-base');
    const sub = path.join(base, 'sub');
    await mkdir(path.join(sub, '.forge'), { recursive: true });
    await writeFile(path.join(sub, '.forge/config.yaml'), YAML.stringify(DEFAULT_CONFIG));
    const cwd = await scratch('init-cwd2');

    const result = run(['init', 'sub', '-C', base, '--name', 'Nested', '--yes', '--json'], { cwd });

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      readonly result: { readonly projectRoot: string };
    };
    expect(parsed.result.projectRoot).toBe(sub);
    expect(await readdir(cwd)).toEqual([]);
  });

  it('a relative [dir] that climbs out of -C is refused and creates nothing', async () => {
    const base = await scratch('init-escape');
    const cwd = await scratch('init-cwd4');
    const result = run(['init', '../escaped', '-C', base, '--name', 'Nope', '--yes'], { cwd });
    expect(result.status).toBe(2);
    expect(existsSync(path.join(path.dirname(base), 'escaped'))).toBe(false);
    expect(await readdir(cwd)).toEqual([]);
  });

  it('a missing -C directory is created for the project, never substituted by the current directory', async () => {
    const parent = await scratch('init-parent');
    const target = path.join(parent, 'brand-new');
    const cwd = await scratch('init-cwd3');

    // Whether platform selection then succeeds depends on a real platform CLI being installed; either way,
    // nothing may land in the current directory.
    const result = run(['init', '-C', target, '--name', 'Fresh', '--yes', '--level', 'L0'], {
      cwd,
    });

    expect(await readdir(cwd)).toEqual([]);
    // The target was created and used (the platform selection that follows may still fail without a CLI).
    expect(existsSync(target)).toBe(true);
    if (result.status === 0) expect(existsSync(path.join(target, '.forge/config.yaml'))).toBe(true);
  });
});
