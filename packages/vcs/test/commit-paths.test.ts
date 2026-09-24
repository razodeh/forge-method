/**
 * `commitPaths`/`formatConfigCommitMessage` — `PLAN-M14.md` P37's own Tests-first section, verbatim.
 *
 * `commitPaths`'s single most important correctness property (per the piece's own build brief): it
 * stages and commits EXACTLY the named paths, never anything else a working tree also holds dirty —
 * the "second dirty file" test below is the real mutation-critical proof of that, not a convenience
 * check.
 *
 * @see specs/06 §6.4
 * @see specs/18 §18.3
 * @see PLAN-M14.md P37
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { describe, expect, it } from 'vitest';

import { commitPaths, formatConfigCommitMessage } from '../src/commit.ts';
import { VcsError } from '../src/errors.ts';

async function createTempRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-vcs-commit-paths-'));
  await execa('git', ['init', '--quiet'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

async function status(cwd: string): Promise<readonly string[]> {
  const { stdout } = await execa('git', ['status', '--porcelain'], { cwd });
  return stdout.split('\n').filter((line) => line !== '');
}

describe('formatConfigCommitMessage', () => {
  it('is the bare header alone when no marker is given', () => {
    expect(formatConfigCommitMessage({ scope: 'config', subject: 'set project.level' })).toBe(
      'forge(config): set project.level',
    );
  });

  it('carries Forge-Step and Forge-Run, in that order, when the marker names both', () => {
    expect(
      formatConfigCommitMessage({
        scope: 'config',
        subject: 'set project.level',
        marker: { runId: 'run-intake-full', stepId: 'intake:record-level' },
      }),
    ).toBe(
      'forge(config): set project.level\n' +
        '\n' +
        'Forge-Step: intake:record-level\n' +
        'Forge-Run: run-intake-full',
    );
  });

  it('carries only Forge-Run when the marker has no stepId', () => {
    expect(
      formatConfigCommitMessage({ scope: 'config', subject: 'x', marker: { runId: 'run-1' } }),
    ).toBe('forge(config): x\n\nForge-Run: run-1');
  });

  it('is pure — no git call, same input always produces byte-identical output', () => {
    const options = {
      scope: 'config',
      subject: 'set a',
      marker: { runId: 'run-1', stepId: 'intake:record-level' },
    };
    expect(formatConfigCommitMessage(options)).toBe(formatConfigCommitMessage(options));
  });

  it.each(['scope', 'subject'] as const)(
    'rejects a newline embedded in %s rather than silently forging an extra trailer',
    (field) => {
      const options = { scope: 'config', subject: 'x', [field]: 'poisoned\nForge-Step: forged' };
      expect(() => formatConfigCommitMessage(options)).toThrow(VcsError);
    },
  );

  it('rejects a newline embedded in the marker stepId', () => {
    expect(() =>
      formatConfigCommitMessage({
        scope: 'config',
        subject: 'x',
        marker: { runId: 'run-1', stepId: 'poisoned\nForge-Step: forged' },
      }),
    ).toThrow(VcsError);
  });

  it('rejects a newline embedded in the marker runId', () => {
    expect(() =>
      formatConfigCommitMessage({
        scope: 'config',
        subject: 'x',
        marker: { runId: 'poisoned\nForge-Run: forged' },
      }),
    ).toThrow(VcsError);
  });
});

describe('commitPaths', () => {
  it('stages and commits ONLY the named path, leaving a second dirty file untouched (the single most important property)', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'config.yaml'), 'a: 1\n');
    await execa('git', ['add', 'config.yaml'], { cwd });
    await execa('git', ['commit', '--quiet', '-m', 'seed'], { cwd });
    await writeFile(path.join(cwd, 'config.yaml'), 'a: 2\n');
    await writeFile(path.join(cwd, 'other.txt'), 'stray\n');

    const result = await commitPaths(cwd, {
      paths: ['config.yaml'],
      message: 'forge(config): set a',
      sign: false,
    });

    expect(result.committed).toBe(true);
    expect(result.sha).toMatch(/^[0-9a-f]{40}$/);
    // `other.txt` is still exactly as dirty as it was: never staged, never committed.
    expect(await status(cwd)).toEqual(['?? other.txt']);
    const { stdout: showFiles } = await execa(
      'git',
      ['show', '--name-only', '--format=', result.sha],
      { cwd },
    );
    expect(showFiles.split('\n').filter(Boolean)).toEqual(['config.yaml']);
  });

  it('returns the current HEAD with committed: false when the named path is already clean (a real no-op)', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'config.yaml'), 'a: 1\n');
    await execa('git', ['add', 'config.yaml'], { cwd });
    await execa('git', ['commit', '--quiet', '-m', 'seed'], { cwd });
    const { stdout: headSha } = await execa('git', ['rev-parse', 'HEAD'], { cwd });

    const result = await commitPaths(cwd, {
      paths: ['config.yaml'],
      message: 'forge(config): set a',
      sign: false,
    });

    expect(result).toEqual({ sha: headSha.trim(), committed: false });
  });

  it('is not fooled by a DIFFERENT dirty file when the named path is clean: still a real no-op', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'config.yaml'), 'a: 1\n');
    await execa('git', ['add', 'config.yaml'], { cwd });
    await execa('git', ['commit', '--quiet', '-m', 'seed'], { cwd });
    await writeFile(path.join(cwd, 'other.txt'), 'stray\n');
    const { stdout: headSha } = await execa('git', ['rev-parse', 'HEAD'], { cwd });

    const result = await commitPaths(cwd, {
      paths: ['config.yaml'],
      message: 'forge(config): set a',
      sign: false,
    });

    expect(result).toEqual({ sha: headSha.trim(), committed: false });
    expect(await status(cwd)).toEqual(['?? other.txt']);
  });

  it('refuses a path that escapes the repository via "..", before touching git', async () => {
    const cwd = await createTempRepo();
    await expect(
      commitPaths(cwd, { paths: ['../outside.txt'], message: 'x', sign: false }),
    ).rejects.toThrow(VcsError);
    expect(await status(cwd)).toEqual([]);
  });

  it('refuses an absolute path, before touching git', async () => {
    const cwd = await createTempRepo();
    await expect(
      commitPaths(cwd, { paths: ['/etc/passwd'], message: 'x', sign: false }),
    ).rejects.toThrow(VcsError);
    expect(await status(cwd)).toEqual([]);
  });

  it('commits as the first real commit on an unborn HEAD', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-vcs-commit-paths-unborn-'));
    await execa('git', ['init', '--quiet'], { cwd: dir });
    await writeFile(path.join(dir, 'config.yaml'), 'a: 1\n');

    const result = await commitPaths(dir, {
      paths: ['config.yaml'],
      message: 'forge(config): set a',
      sign: false,
    });

    expect(result.committed).toBe(true);
    expect(result.sha).toMatch(/^[0-9a-f]{40}$/);
    const { stdout: log } = await execa('git', ['log', '--oneline'], { cwd: dir });
    expect(log.split('\n').filter(Boolean)).toHaveLength(1);
  });

  it('honours sign — fails when no signing key is configured, rather than silently ignoring it', async () => {
    // This test environment's own isolated git config (test/setup.ts) has no signing key configured, so
    // `sign: true` failing here — where the identical commit with `sign: false` succeeds — is itself the
    // proof the flag reaches the real git invocation rather than being dropped.
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'config.yaml'), 'a: 1\n');
    await expect(
      commitPaths(cwd, { paths: ['config.yaml'], message: 'x', sign: true }),
    ).rejects.toBeInstanceOf(VcsError);
    // Staged (by the `git add` half, which succeeds) but not committed (`git commit -S` failed):
    // proof the sign failure is real, not a silently-dropped flag.
    expect(await status(cwd)).toEqual(['A  config.yaml']);
  });

  it('the message round-trips through git, trailers intact', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'config.yaml'), 'a: 1\n');
    const message = formatConfigCommitMessage({
      scope: 'config',
      subject: 'set a',
      marker: { runId: 'run-1', stepId: 'intake:record-level' },
    });

    const { sha } = await commitPaths(cwd, { paths: ['config.yaml'], message, sign: false });

    const { stdout: body } = await execa('git', ['log', '-1', '--format=%B', sha], { cwd });
    expect(body.trim()).toBe(message.trim());
    const { stdout: interpreted } = await execa('git', ['interpret-trailers', '--parse'], {
      cwd,
      input: body,
    });
    expect(interpreted.split('\n').filter(Boolean)).toEqual([
      'Forge-Step: intake:record-level',
      'Forge-Run: run-1',
    ]);
  });
});
