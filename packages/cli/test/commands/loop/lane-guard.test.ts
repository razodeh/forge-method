/**
 * The git calls FORGE makes in a `forge debug` lane the FIX session can write (`PLAN-M13.md` P28, `SPEC-QUESTIONS.md`
 * Q222): real git, real worktree, hostile files written the way a FIX session could write them.
 */
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { scanFixDiff } from '@forge/engine/rca';
import { createLaneWorktree, resolveRevision } from '@forge/vcs';
import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { collectLaneChanges, createLaneGuard } from '../../../src/commands/loop/lane-guard.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const ROOTS = {
  kb: 'docs/forge/kb',
  specs: 'docs/forge/specs',
  plans: 'docs/forge/plans',
  sessions: 'docs/forge/sessions',
  reports: 'docs/forge/reports',
};

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-lane-guard-'));
  dirs.push(dir);
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 'f@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'F'], { cwd: dir });
  await writeFile(path.join(dir, '.gitignore'), '.env\nnode_modules/\n.forge/state/\n');
  await writeFile(path.join(dir, 'a.txt'), 'hello\n');
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'init'], { cwd: dir });
  const baseSha = await resolveRevision(dir, 'main');
  const lane = await createLaneWorktree(dir, {
    runId: 'r1',
    stepId: 'debug-fix',
    integrationBase: 'main',
  });
  const guard = await createLaneGuard(lane, {
    PATH: process.env['PATH'],
    ANTHROPIC_API_KEY: 'canary-key',
  });
  return { dir, lane, guard, baseSha };
}

async function violationsOf(setupResult: Awaited<ReturnType<typeof setup>>) {
  const { changes, ignored } = await collectLaneChanges(setupResult.guard, setupResult.baseSha);
  return scanFixDiff({ changes, ignored, docRoots: ROOTS });
}

describe('collectLaneChanges reads git’s machine listing, so no file name hides a change', () => {
  it('a name git QUOTES (a double quote, non-ASCII, a space) is still scanned: a symlink and a secret in them are found', async () => {
    const ctx = await setup();
    const key = 'AKIA' + 'ABCDEFGHIJKLMNOP';
    await symlink('/etc/passwd', path.join(ctx.lane.path, '"quoted'));
    await writeFile(path.join(ctx.lane.path, 'ä b.txt'), `token ${key}\n`);
    const found = await violationsOf(ctx);
    expect(found.map((violation) => [violation.rule, violation.path]).sort()).toEqual(
      [
        ['secret', 'ä b.txt'],
        ['symlink', '"quoted'],
      ].sort(),
    );
  });

  it('an added line that starts with "++ " (it arrives as "+++ ...") is content, not a header', async () => {
    const ctx = await setup();
    const key = 'AKIA' + 'ABCDEFGHIJKLMNOP';
    await writeFile(path.join(ctx.lane.path, 'notes.md'), `++ ${key}\n`);
    expect((await violationsOf(ctx)).map((violation) => violation.rule)).toEqual(['secret']);
  });

  it('a binary file holding a secret-shaped value is scanned as text', async () => {
    const ctx = await setup();
    const key = 'AKIA' + 'ABCDEFGHIJKLMNOP';
    await writeFile(
      path.join(ctx.lane.path, 'blob.bin'),
      Buffer.concat([Buffer.from([0, 1, 2, 0]), Buffer.from(key)]),
    );
    expect((await violationsOf(ctx)).map((violation) => violation.rule)).toEqual(['secret']);
  });

  it('an IGNORED file (which git add -A never lists) is refused', async () => {
    const ctx = await setup();
    await writeFile(path.join(ctx.lane.path, '.env'), 'A=1\n');
    await mkdir(path.join(ctx.lane.path, 'node_modules', 'x'), { recursive: true });
    await writeFile(path.join(ctx.lane.path, 'node_modules', 'x', 'index.js'), 'x');
    const found = await violationsOf(ctx);
    expect(found.map((violation) => violation.rule)).toEqual(['ignored-file', 'ignored-file']);
  });

  it('a clean fix is clean; a deleted file and a modified one are listed with their modes', async () => {
    const ctx = await setup();
    await writeFile(path.join(ctx.lane.path, 'a.txt'), 'hello\nfixed\n');
    await writeFile(path.join(ctx.lane.path, 'src.ts'), 'export const x = 1;\n');
    const { changes } = await collectLaneChanges(ctx.guard, ctx.baseSha);
    expect(changes.map((entry) => [entry.path, entry.mode]).sort()).toEqual([
      ['a.txt', '100644'],
      ['src.ts', '100644'],
    ]);
    expect(await violationsOf(ctx)).toEqual([]);
  });
});

describe('the lane guard: the session cannot make FORGE’s own git run its program', () => {
  it('a `.git` pointer replaced by a directory with a core.fsmonitor script is put back, reported, and the script never runs (with or without the guard’s scrubbed env)', async () => {
    const ctx = await setup();
    const marker = path.join(ctx.dir, 'fsmonitor-ran');
    const envDump = path.join(ctx.dir, 'fsmonitor-env');
    const pointerPath = path.join(ctx.lane.path, '.git');
    const original = await readFile(pointerPath, 'utf8');
    // What a session with a write tool could do: replace the pointer with a repository of its own.
    await rm(pointerPath);
    await execa('git', ['init', '--quiet'], { cwd: ctx.lane.path });
    const script = path.join(ctx.lane.path, 'hook.sh');
    await writeFile(script, `#!/bin/sh\ntouch '${marker}'\nenv > '${envDump}'\n`);
    await chmod(script, 0o755);
    await execa('git', ['config', 'core.fsmonitor', script], { cwd: ctx.lane.path });

    // Control (so the assertions below are not vacuous): plain git in the tampered lane DOES run the script.
    await execa('git', ['add', '-A'], { cwd: ctx.lane.path, reject: false });
    await stat(marker);
    await rm(marker);

    expect(await ctx.guard.restore()).toBe(false);
    expect(await readFile(pointerPath, 'utf8')).toBe(original);
    await collectLaneChanges(ctx.guard, ctx.baseSha);
    await expect(stat(marker)).rejects.toThrow();
    expect(await ctx.guard.restore()).toBe(true);
  });

  it('even if a fsmonitor is configured in the repository, the guarded call switches it off and passes no secret', async () => {
    const ctx = await setup();
    const marker = path.join(ctx.dir, 'ran');
    const script = path.join(ctx.dir, 'fs.sh');
    await writeFile(script, `#!/bin/sh\nenv > '${marker}'\n`);
    await chmod(script, 0o755);
    await execa('git', ['config', 'core.fsmonitor', script], { cwd: ctx.dir });
    await writeFile(path.join(ctx.lane.path, 'x.txt'), 'x');
    await ctx.guard.git(['add', '-A']);
    await expect(stat(marker)).rejects.toThrow();
  });

  it('the guarded git runs with the scrubbed environment: a canary key in the parent is not visible', async () => {
    const ctx = await setup();
    const out = await ctx.guard.git(['-c', 'alias.dump=!env', 'dump']);
    expect(out).not.toContain('canary-key');
    expect(out).toContain('PATH=');
  });
});

describe('the lane guard: reset and commit', () => {
  it('a hook and a core.fsmonitor planted in the SHARED git directory do not run when FORGE resets and commits through the guard, and no secret is in their environment', async () => {
    const ctx = await setup();
    const ran = path.join(ctx.dir, 'ran');
    const hook = path.join(ctx.dir, '.git', 'hooks', 'pre-commit');
    await writeFile(hook, `#!/bin/sh\nenv > '${ran}'\n`);
    await chmod(hook, 0o755);
    const fs = path.join(ctx.dir, 'fs.sh');
    await writeFile(fs, `#!/bin/sh\nenv > '${ran}.fs'\n`);
    await chmod(fs, 0o755);
    await execa('git', ['config', 'core.fsmonitor', fs], { cwd: ctx.dir });

    await writeFile(path.join(ctx.lane.path, 'fix.txt'), 'fix\n');
    await collectLaneChanges(ctx.guard, ctx.baseSha); // stages
    const sha = await ctx.guard.commit('fix: a test', false);
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    await ctx.guard.reset(ctx.baseSha);
    await expect(stat(ran)).rejects.toThrow();
    await expect(stat(`${ran}.fs`)).rejects.toThrow();
    // The commit is the scanned index: a file written after the scan is not in it.
    const files = (await execa('git', ['show', '--name-only', '--format=', sha], { cwd: ctx.dir }))
      .stdout;
    expect(files.trim()).toBe('fix.txt');
  });

  it('what is written after the scan is not committed (the commit takes the index the scan staged)', async () => {
    const ctx = await setup();
    await writeFile(path.join(ctx.lane.path, 'scanned.txt'), 'a\n');
    await collectLaneChanges(ctx.guard, ctx.baseSha);
    await writeFile(path.join(ctx.lane.path, 'late.txt'), 'b\n');
    const sha = await ctx.guard.commit('m', false);
    const files = (await execa('git', ['show', '--name-only', '--format=', sha], { cwd: ctx.dir }))
      .stdout;
    expect(files.trim()).toBe('scanned.txt');
  });

  it('reset also removes ignored files and a nested repository the session left', async () => {
    const ctx = await setup();
    await writeFile(path.join(ctx.lane.path, '.env'), 'A=1\n');
    await mkdir(path.join(ctx.lane.path, 'nested'), { recursive: true });
    await execa('git', ['init', '--quiet'], { cwd: path.join(ctx.lane.path, 'nested') });
    await ctx.guard.reset(ctx.baseSha);
    await expect(stat(path.join(ctx.lane.path, '.env'))).rejects.toThrow();
    await expect(stat(path.join(ctx.lane.path, 'nested'))).rejects.toThrow();
  });

  it('every guarded call restores the pointer first, and reports the tamper once', async () => {
    const ctx = await setup();
    await rm(path.join(ctx.lane.path, '.git'));
    await ctx.guard.git(['status']); // would fail ("not a git repository") had the pointer not been restored
    expect(ctx.guard.takeTamper()).toBe(true);
    expect(ctx.guard.takeTamper()).toBe(false);
  });
});

describe('the lane guard: the user’s own git configuration', () => {
  it('a global commit.gpgsign=true does not break an unsigned commit, and identity from the environment is kept', async () => {
    const ctx = await setup();
    const home = await mkdtemp(path.join(tmpdir(), 'forge-guard-home-'));
    dirs.push(home);
    await writeFile(
      path.join(home, '.gitconfig'),
      '[commit]\n\tgpgsign = true\n[gpg]\n\tprogram = false\n',
    );
    const guard = await createLaneGuard(ctx.lane, {
      PATH: process.env['PATH'],
      HOME: home,
      GIT_AUTHOR_NAME: 'Env Author',
      GIT_AUTHOR_EMAIL: 'env@example.com',
      GIT_COMMITTER_NAME: 'Env Author',
      GIT_COMMITTER_EMAIL: 'env@example.com',
    });
    await writeFile(path.join(ctx.lane.path, 'x.txt'), 'x\n');
    await collectLaneChanges(guard, ctx.baseSha);
    const sha = await guard.commit('m', false);
    const author = (await execa('git', ['log', '-1', '--format=%an', sha], { cwd: ctx.dir }))
      .stdout;
    expect(author).toBe('Env Author');
  });

  it('reset copes with a directory the tests made read-only', async () => {
    const ctx = await setup();
    await mkdir(path.join(ctx.lane.path, 'ro'));
    await writeFile(path.join(ctx.lane.path, 'ro', 'f'), 'x');
    await chmod(path.join(ctx.lane.path, 'ro'), 0o555);
    await ctx.guard.reset(ctx.baseSha);
    await expect(stat(path.join(ctx.lane.path, 'ro'))).rejects.toThrow();
  });
});
