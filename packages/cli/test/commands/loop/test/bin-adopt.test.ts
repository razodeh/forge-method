/**
 * `forge test adopt [--write] [--agent] [--json]` (`03` §3.2.5 row, `specs/22` M17 P6) -- real,
 * spawned `forge` subprocess tests, the same `bin-exempt.test.ts`-style discipline: a real binary
 * against a real, throwaway fixture directory, never a direct function call.
 *
 * @see specs/03 §3.2.5
 * @see specs/22 M17 P6
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const LAUNCHER = fileURLToPath(new URL('../../../../bin/forge.mjs', import.meta.url));

function run(
  args: readonly string[],
  cwd: string,
): { readonly status: number; readonly stdout: string; readonly stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [LAUNCHER, ...args, '-C', cwd], {
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
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

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-bin-adopt-'));
  dirs.push(dir);
  return dir;
}

describe('forge test adopt (specs/22 M17 P6)', () => {
  it('stages a real proposal for a real vitest fixture project and prints it with --json', async () => {
    const dir = await tempDir();
    await writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'fixture', devDependencies: { vitest: '2.0.0' } }),
      'utf8',
    );
    const result = run(['test', 'adopt', '--json'], dir);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      readonly v: number;
      readonly outcome: string;
      readonly layer: string;
      readonly candidate: { readonly runner: string; readonly confident: boolean };
    };
    expect(parsed).toMatchObject({
      v: 1,
      outcome: 'staged',
      layer: 'unit',
      candidate: { runner: 'vitest', confident: true },
    });
    const staged = await readFile(path.join(dir, '.forge/test-adopt/unit.proposal.yaml'), 'utf8');
    expect(staged).toContain('source: detected');
  });

  it('hands off (exit 1) for an unrecognised project, naming the agent workflow', async () => {
    const dir = await tempDir();
    const result = run(['test', 'adopt'], dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('specs/22 M17 P7');
  });

  it('--agent is a real, disclosed USR-003 refusal, not a silent fall-through to detection', async () => {
    const dir = await tempDir();
    const result = run(['test', 'adopt', '--agent'], dir);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('forge test adopt --agent');
    expect(result.stderr).toContain('specs/22 M17 P7');
  });

  it('--write refuses (exit 1) when nothing has been staged for this project yet', async () => {
    const dir = await tempDir();
    const result = run(['test', 'adopt', '--write', '--json'], dir);
    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout) as { readonly outcome: string };
    expect(parsed.outcome).toBe('no-staged-proposal');
  });

  it('--write still refuses after a bare detection has staged a proposal (no proof yet)', async () => {
    const dir = await tempDir();
    await writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'fixture', devDependencies: { vitest: '2.0.0' } }),
      'utf8',
    );
    run(['test', 'adopt'], dir);
    const result = run(['test', 'adopt', '--write', '--json'], dir);
    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout) as { readonly outcome: string };
    expect(parsed.outcome).toBe('proof-not-passing');
  });

  it('an unknown flag is a real usage error (exit 2), not silently ignored', async () => {
    const dir = await tempDir();
    const result = run(['test', 'adopt', '--bogus-flag'], dir);
    expect(result.status).toBe(2);
  });

  it('a stray positional argument is a real usage error (exit 2) -- there is no layer argument', async () => {
    const dir = await tempDir();
    const result = run(['test', 'adopt', 'unit'], dir);
    expect(result.status).toBe(2);
  });
});
