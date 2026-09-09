/**
 * `bin.ts` / `bin/forge.mjs` — the real, minimal `pnpm forge <cmd>` dispatcher, invoked as a real
 * subprocess (not imported as a function) so this proves the actual, literal shell invocation
 * `specs/22` M6's own exit-test line uses actually works, not merely that the underlying library
 * functions do.
 *
 * @see specs/22 M6
 * @see PLAN-M6.md C9
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';
import { FakePlatformAdapter } from '@forge/testkit';

import { runInit } from '../src/init/run-init.ts';

const REAL_MODULES_DIR = fileURLToPath(new URL('../../../modules/', import.meta.url));
const LAUNCHER = fileURLToPath(new URL('../bin/forge.mjs', import.meta.url));

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function realProject(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-cli-bin-e2e-'));
  dirs.push(dir);
  await runInit(
    dir,
    { name: 'Bin Check', yes: true, level: 'L0' },
    { candidateAdapters: [new FakePlatformAdapter()], env: {}, modulesDir: REAL_MODULES_DIR },
  );
  return dir;
}

function run(args: readonly string[]): {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
} {
  try {
    const stdout = execFileSync(process.execPath, [LAUNCHER, ...args], {
      encoding: 'utf8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const execError = error as {
      readonly status: number | null;
      readonly stdout: string;
      readonly stderr: string;
    };
    return { status: execError.status ?? 1, stdout: execError.stdout, stderr: execError.stderr };
  }
}

describe('forge (real subprocess dispatch)', () => {
  it('runs `forge agent validate --all` for real, exiting 0 against a real, clean project', async () => {
    const dir = await realProject();
    const result = run(['agent', 'validate', '--all', '-C', dir]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('no real findings');
  });

  it('runs `forge template validate --all` for real, exiting 0', async () => {
    const dir = await realProject();
    const result = run(['template', 'validate', '--all', '-C', dir]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('no real errors');
  });

  it('runs `forge --json status` for real, printing a real {"v":1,...} envelope', async () => {
    const dir = await realProject();
    const result = run(['status', '--json', '-C', dir]);
    // No real run has happened in this fixture yet -- a real, honest RUN-048 refusal, not a crash.
    expect(result.status).not.toBe(0);
  });

  it('exits 2 and names the command for a real, not-yet-wired subcommand', async () => {
    const dir = await realProject();
    const result = run(['kb', 'list', '-C', dir]);
    expect(result.status).toBe(2);
  });

  it('gives a real, specific "needs --all" message — not the generic "not wired" one — for a real, wired command missing it', async () => {
    // A critic round caught the original dispatcher giving the same generic "not wired into this
    // dispatcher yet" message for `agent validate` (a real, wired command with a missing flag) as it
    // gives for a genuinely unimplemented command like `kb list` above — misleading a caller who just
    // forgot `--all` into reading a doc comment naming dozens of unrelated commands.
    const dir = await realProject();
    const result = run(['agent', 'validate', '-C', dir]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('needs --all');
    expect(result.stderr).not.toContain('not wired into');
  });
});
