/**
 * `forge config set <key> <value> --commit` through the real CLI subprocess — `PLAN-M14.md` P37.
 * `packages/cli/test/commands/config.test.ts` proves `configSet`'s own logic directly; this file proves
 * `bin.ts` actually wires `--commit` and the `--json` line's own `committed` field end to end, through a
 * real subprocess against a real git repository.
 *
 * @see specs/03 §3.2.7
 * @see PLAN-M14.md P37
 */
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';
import * as YAML from 'yaml';
import { DEFAULT_CONFIG } from '@forge/schemas/config';

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

/** Run from a neutral cwd with `-C`, so the repository is never the project (matching
 * `bin-owner-role.test.ts`'s own established pattern). */
function forge(args: readonly string[], project: string): Result {
  try {
    const stdout = execFileSync(process.execPath, [LAUNCHER, '-C', project, ...args], {
      encoding: 'utf8',
      cwd: tmpdir(),
      timeout: 60_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const e = error as { status: number | null; stdout: string; stderr: string };
    return { status: e.status ?? 1, stdout: e.stdout, stderr: e.stderr };
  }
}

/** A real, committed git repository holding only `.forge/config.yaml` — enough for `forge config set`,
 * without the full `forge init` tree this file's own tests do not need. */
async function project(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-cli-config-commit-'));
  dirs.push(dir);
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 't@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'T'], { cwd: dir });
  await mkdir(path.join(dir, '.forge'), { recursive: true });
  await writeFile(path.join(dir, '.forge/config.yaml'), YAML.stringify(DEFAULT_CONFIG), 'utf8');
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'init'], { cwd: dir });
  return dir;
}

describe('forge config set <key> <value> --commit', () => {
  it('--json carries committed.sha, and the working tree is left clean', async () => {
    const dir = await project();
    const result = forge(['config', 'set', 'project.level', 'L2', '--commit', '--json'], dir);
    expect(result.status, result.stderr).toBe(0);
    const lines = result.stdout.trim().split('\n');
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? '') as {
      v: number;
      key: string;
      value: string;
      committed: { sha: string } | null;
    };
    expect(parsed.key).toBe('project.level');
    expect(parsed.value).toBe('L2');
    expect(parsed.committed).not.toBeNull();
    expect(parsed.committed?.sha).toMatch(/^[0-9a-f]{40}$/);
    const status = (await execa('git', ['status', '--porcelain'], { cwd: dir })).stdout;
    expect(status).toBe('');
    const subject = (
      await execa('git', ['log', '-1', '--format=%s'], { cwd: dir })
    ).stdout.trim();
    expect(subject).toBe('forge(config): set project.level');
  });

  it('without --commit, --json still carries the new committed field, as null, and writes but does not commit', async () => {
    const dir = await project();
    const result = forge(['config', 'set', 'project.level', 'L2', '--json'], dir);
    expect(result.status, result.stderr).toBe(0);
    const parsed = JSON.parse(result.stdout.trim()) as { committed: { sha: string } | null };
    expect(parsed.committed).toBeNull();
    const status = (await execa('git', ['status', '--porcelain'], { cwd: dir })).stdout.trim();
    expect(status).toBe('M .forge/config.yaml');
  });

  it('a pending, uncommitted edit to .forge/config.yaml refuses --commit with CFG-055, writing nothing', async () => {
    const dir = await project();
    const configPath = path.join(dir, '.forge/config.yaml');
    const before = await readFile(configPath, 'utf8');
    await writeFile(configPath, `${before}\n# pending edit\n`);
    const result = forge(['config', 'set', 'project.level', 'L2', '--commit', '--json'], dir);
    expect(result.status).not.toBe(0);
    const parsed = JSON.parse(result.stdout.trim()) as {
      ok: boolean;
      error: { code: string };
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('CFG-055');
    const after = await readFile(configPath, 'utf8');
    expect(after).toBe(`${before}\n# pending edit\n`);
  });

  it('rejects an unrecognized flag on config set the same way as before (--commit does not open a general flag door)', async () => {
    const dir = await project();
    const result = forge(['config', 'set', 'project.level', 'L2', '--bogus'], dir);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Invalid value');
  });
});
