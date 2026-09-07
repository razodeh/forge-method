/**
 * `assertGitAvailable`/`getDirtyFiles`/`snapshotRepoState`/`assertCleanWorkingTree` — `PLAN-M5.md` P1's
 * own Checks section, verbatim, against real git repositories (no mocking: `21` §21.1's own "package-
 * to-package with a real filesystem and real git" integration-test tier). Every rejection is asserted
 * as a genuine `VcsError` with the right `.code`/`.remedy`, not merely a message-matching `toThrow`
 * regex — a gauntlet critic round found the original version of this file only ever checked messages,
 * which would not have caught a future edit that swapped codes or blanked a remedy.
 *
 * @see specs/06 §6.4
 * @see specs/20 §20.2
 * @see PLAN-M5.md P1
 */
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa, ExecaError } from 'execa';
import { describe, expect, it, vi } from 'vitest';

import { VcsError } from '../src/errors.ts';
import {
  assertCleanWorkingTree,
  assertGitAvailable,
  getDirtyFiles,
  isNoCommitsYetResult,
  resolveHeadShaOrUndefined,
  resolveRevision,
  snapshotRepoState,
  wrapGitFailure,
} from '../src/git.ts';

async function createTempRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-vcs-git-'));
  await execa('git', ['init', '--quiet'], { cwd: dir });
  return dir;
}

async function commitAll(cwd: string, message: string): Promise<void> {
  await execa('git', ['add', '-A'], { cwd });
  await execa('git', ['commit', '--quiet', '-m', message], { cwd });
}

describe('assertGitAvailable', () => {
  it('resolves for a real git repository', async () => {
    const cwd = await createTempRepo();
    await expect(assertGitAvailable(cwd)).resolves.toBeUndefined();
  });

  it('rejects with VCS-NOT-A-REPO and an actionable remedy when cwd is not inside a git repository', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'forge-vcs-not-a-repo-'));
    const rejection = assertGitAvailable(cwd);
    await expect(rejection).rejects.toBeInstanceOf(VcsError);
    await expect(rejection).rejects.toMatchObject({
      code: 'VCS-NOT-A-REPO',
      remedy: expect.stringContaining('git init') as unknown as string,
    });
  });

  it('rejects with ENV-GIT-MISSING, not a raw spawn error, when git is not on PATH', async () => {
    const cwd = await createTempRepo();
    const emptyDir = await mkdtemp(path.join(tmpdir(), 'forge-vcs-no-git-on-path-'));
    vi.stubEnv('PATH', emptyDir);

    const rejection = assertGitAvailable(cwd);
    await expect(rejection).rejects.toBeInstanceOf(VcsError);
    await expect(rejection).rejects.toMatchObject({ code: 'ENV-GIT-MISSING' });
  });

  it('rejects with a VcsError, not a raw simple-git error, for a nonexistent directory', async () => {
    const cwd = path.join(await mkdtemp(path.join(tmpdir(), 'forge-vcs-')), 'does-not-exist');
    const rejection = assertGitAvailable(cwd);
    await expect(rejection).rejects.toBeInstanceOf(VcsError);
    await expect(rejection).rejects.toMatchObject({ code: 'VCS-GIT-OPERATION-FAILED' });
  });

  it('rejects with VCS-NOT-A-REPO for a bare repository — no working tree, so not a repo this package can use', async () => {
    // checkIsRepo() itself returns false (not a thrown error) for a bare repository, since it checks
    // specifically for a *working-tree* repo — this already takes the same-code path as "not a
    // repository at all" rather than needing wrapGitFailure's own generic fallback.
    const parent = await mkdtemp(path.join(tmpdir(), 'forge-vcs-bare-'));
    const bareDir = path.join(parent, 'bare.git');
    await execa('git', ['init', '--quiet', '--bare', bareDir]);

    const rejection = assertGitAvailable(bareDir);
    await expect(rejection).rejects.toBeInstanceOf(VcsError);
    await expect(rejection).rejects.toMatchObject({ code: 'VCS-NOT-A-REPO' });
  });
});

describe('getDirtyFiles', () => {
  it('reports an empty list for a clean, committed repository', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'a.txt'), 'a');
    await commitAll(cwd, 'initial');

    expect(await getDirtyFiles(cwd)).toEqual([]);
  });

  it('reports a staged file', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'a.txt'), 'a');
    await commitAll(cwd, 'initial');
    await writeFile(path.join(cwd, 'b.txt'), 'b');
    await execa('git', ['add', 'b.txt'], { cwd });

    expect(await getDirtyFiles(cwd)).toEqual(['b.txt']);
  });

  it('reports an unstaged modification to a tracked file', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'a.txt'), 'a');
    await commitAll(cwd, 'initial');
    await writeFile(path.join(cwd, 'a.txt'), 'a changed');

    expect(await getDirtyFiles(cwd)).toEqual(['a.txt']);
  });

  it('reports an untracked file', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'a.txt'), 'a');
    await commitAll(cwd, 'initial');
    await writeFile(path.join(cwd, 'untracked.txt'), 'x');

    expect(await getDirtyFiles(cwd)).toEqual(['untracked.txt']);
  });

  it('reports a file inside a brand-new untracked directory individually, not the collapsed directory path', async () => {
    // The exact collapsing bug a prior gauntlet round (PLAN-M4.md P4) found in an equivalent check:
    // git's own default untracked-files mode reports only the new directory itself, hiding what's
    // inside it. `getDirtyFiles` must not reintroduce it.
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'a.txt'), 'a');
    await commitAll(cwd, 'initial');
    await mkdir(path.join(cwd, 'newdir'), { recursive: true });
    await writeFile(path.join(cwd, 'newdir', 'nested.txt'), 'secret');

    const dirty = await getDirtyFiles(cwd);
    expect(dirty).toContain('newdir/nested.txt');
    expect(dirty).not.toContain('newdir/');
  });

  it('reports a deleted-but-unstaged file', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'a.txt'), 'a');
    await commitAll(cwd, 'initial');
    await rm(path.join(cwd, 'a.txt'));

    expect(await getDirtyFiles(cwd)).toEqual(['a.txt']);
  });

  it('reports a staged deletion', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'a.txt'), 'a');
    await commitAll(cwd, 'initial');
    await execa('git', ['rm', '--quiet', 'a.txt'], { cwd });

    expect(await getDirtyFiles(cwd)).toEqual(['a.txt']);
  });

  it('reports a renamed file by its new path (a documented, safety-neutral simplification)', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'old.txt'), 'content');
    await commitAll(cwd, 'initial');
    await execa('git', ['mv', 'old.txt', 'new.txt'], { cwd });

    expect(await getDirtyFiles(cwd)).toEqual(['new.txt']);
  });

  it('reports both sides of a merge conflict as dirty', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'a.txt'), 'base');
    await commitAll(cwd, 'base');
    // Branch from the base commit's own sha, not a named branch (e.g. "main"): this test's isolated
    // git config (test/setup.ts) does not set init.defaultBranch, so the real default name is
    // whatever this git installation ships with, not necessarily "main" — the sha sidesteps that.
    const { stdout: baseSha } = await execa('git', ['rev-parse', 'HEAD'], { cwd });
    await execa('git', ['switch', '-c', 'branch-a'], { cwd });
    await writeFile(path.join(cwd, 'a.txt'), 'from branch a');
    await commitAll(cwd, 'change on a');
    await execa('git', ['switch', '-c', 'branch-b', baseSha.trim()], { cwd });
    await writeFile(path.join(cwd, 'a.txt'), 'from branch b');
    await commitAll(cwd, 'change on b');
    await execa('git', ['merge', '--no-edit', 'branch-a'], { cwd, reject: false });

    expect(await getDirtyFiles(cwd)).toEqual(['a.txt']);
  });
});

describe('wrapGitFailure', () => {
  it('returns the operation result unchanged on success', async () => {
    await expect(wrapGitFailure(() => Promise.resolve(42), 'doing something')).resolves.toBe(42);
  });

  it('wraps a non-VcsError failure into a VcsError, preserving the cause', async () => {
    const original = new Error('raw underlying failure');
    const rejection = wrapGitFailure(() => Promise.reject(original), 'doing something');
    await expect(rejection).rejects.toBeInstanceOf(VcsError);
    await expect(rejection).rejects.toMatchObject({ code: 'VCS-GIT-OPERATION-FAILED' });
    await expect(rejection).rejects.toThrow(/raw underlying failure/);
    await rejection.catch((error: unknown) => {
      expect(error).toBeInstanceOf(VcsError);
      expect((error as VcsError).cause).toBe(original);
    });
  });

  it('wraps a non-Error thrown value into a real VcsError using its string form', async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- deliberately non-Error, to prove wrapGitFailure normalises it
    const rejection = wrapGitFailure(() => Promise.reject('a plain string'), 'doing something');
    await expect(rejection).rejects.toBeInstanceOf(VcsError);
    await expect(rejection).rejects.toMatchObject({ code: 'VCS-GIT-OPERATION-FAILED' });
    await expect(rejection).rejects.toThrow(/a plain string/);
  });

  it('passes an already-thrown VcsError through unchanged, never double-wrapping it', async () => {
    const original = new VcsError({ code: 'VCS-ALREADY-CLASSIFIED', message: 'already classified', remedy: 'n/a' });
    const rejection = wrapGitFailure(() => Promise.reject(original), 'doing something');
    await expect(rejection).rejects.toBe(original);
  });
});

/** Corrupts `cwd`'s own `.git/HEAD` so it names neither a valid ref nor an unborn one — the "genuinely
 * unexpected failure" fixture both `isNoCommitsYetResult` and `resolveHeadShaOrUndefined`'s own tests
 * need: real git, verified empirically to exit 128 with real `stderr` output, structurally distinct
 * from the exit-1-empty-stderr shape "no commits yet" produces. */
async function corruptHead(cwd: string): Promise<void> {
  await rm(path.join(cwd, '.git', 'HEAD'));
  await writeFile(path.join(cwd, '.git', 'HEAD'), 'garbage not a ref');
}

describe('isNoCommitsYetResult', () => {
  it('matches a real "no commits yet" result: exit code 1, empty stderr', async () => {
    const cwd = await createTempRepo();
    const error: unknown = await execa('git', ['rev-parse', '--verify', '-q', 'HEAD'], { cwd }).catch(
      (caught: unknown) => caught,
    );
    expect(isNoCommitsYetResult(error)).toBe(true);
  });

  it('does not match a genuinely different git failure (a different exit code and real stderr)', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'a.txt'), 'a');
    await commitAll(cwd, 'initial');
    await corruptHead(cwd);

    const error: unknown = await execa('git', ['rev-parse', '--verify', '-q', 'HEAD'], { cwd }).catch(
      (caught: unknown) => caught,
    );
    expect(isNoCommitsYetResult(error)).toBe(false);
  });

  it('does not match a non-ExecaError value', () => {
    expect(isNoCommitsYetResult(new Error('not an ExecaError'))).toBe(false);
    expect(isNoCommitsYetResult('a plain string')).toBe(false);
  });
});

describe('resolveHeadShaOrUndefined', () => {
  it('returns the trimmed sha when HEAD resolves', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'a.txt'), 'a');
    await commitAll(cwd, 'initial');
    const { stdout: expectedSha } = await execa('git', ['rev-parse', 'HEAD'], { cwd });

    expect(await resolveHeadShaOrUndefined(cwd)).toBe(expectedSha.trim());
  });

  it('returns undefined for a repository with no commits yet', async () => {
    const cwd = await createTempRepo();
    expect(await resolveHeadShaOrUndefined(cwd)).toBeUndefined();
  });

  it('propagates a genuinely unexpected failure rather than swallowing it as "no commits yet"', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'a.txt'), 'a');
    await commitAll(cwd, 'initial');
    await corruptHead(cwd);

    await expect(resolveHeadShaOrUndefined(cwd)).rejects.toBeInstanceOf(ExecaError);
  });
});

describe('resolveRevision', () => {
  it('resolves a branch name to its full commit sha', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'a.txt'), 'a');
    await commitAll(cwd, 'initial');
    const { stdout: expectedSha } = await execa('git', ['rev-parse', 'HEAD'], { cwd });

    expect(await resolveRevision(cwd, 'HEAD')).toBe(expectedSha.trim());
  });

  it('rejects a flag-shaped ref with a VcsError rather than letting it reach a later git subcommand unresolved', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'a.txt'), 'a');
    await commitAll(cwd, 'initial');

    await expect(resolveRevision(cwd, '-q')).rejects.toBeInstanceOf(VcsError);
  });

  it('rejects a genuinely nonexistent ref with a VcsError', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'a.txt'), 'a');
    await commitAll(cwd, 'initial');

    await expect(resolveRevision(cwd, 'not-a-real-ref')).rejects.toBeInstanceOf(VcsError);
  });
});

describe('snapshotRepoState', () => {
  it('returns the real HEAD sha and an accurate dirty-file list', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'a.txt'), 'a');
    await commitAll(cwd, 'initial');
    const { stdout: expectedSha } = await execa('git', ['rev-parse', 'HEAD'], { cwd });
    await writeFile(path.join(cwd, 'b.txt'), 'b');

    const snapshot = await snapshotRepoState(cwd);
    expect(snapshot.sha).toBe(expectedSha.trim());
    expect(snapshot.dirtyFiles).toEqual(['b.txt']);
  });

  it('returns sha: undefined for a repository with no commits yet, without throwing', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'untracked.txt'), 'x');

    const snapshot = await snapshotRepoState(cwd);
    expect(snapshot.sha).toBeUndefined();
    expect(snapshot.dirtyFiles).toEqual(['untracked.txt']);
  });

  it('rejects with a VcsError, not a raw simple-git error, for a bare repository', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'forge-vcs-bare-'));
    const bareDir = path.join(parent, 'bare.git');
    await execa('git', ['init', '--quiet', '--bare', bareDir]);

    await expect(snapshotRepoState(bareDir)).rejects.toBeInstanceOf(VcsError);
  });

  it('rejects with a VcsError, not a raw simple-git construction error, for a nonexistent directory', async () => {
    // A gauntlet verify round found an earlier version of this function called openGit(cwd) — which
    // throws synchronously for a nonexistent cwd — before any wrapGitFailure boundary existed.
    const cwd = path.join(await mkdtemp(path.join(tmpdir(), 'forge-vcs-')), 'does-not-exist');
    await expect(snapshotRepoState(cwd)).rejects.toBeInstanceOf(VcsError);
  });

  it('rejects with a VcsError, not a raw ExecaError, when HEAD resolution fails unexpectedly', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'a.txt'), 'a');
    await commitAll(cwd, 'initial');
    await corruptHead(cwd);

    const rejection = snapshotRepoState(cwd);
    await expect(rejection).rejects.toBeInstanceOf(VcsError);
    await expect(rejection).rejects.toMatchObject({ code: 'VCS-GIT-OPERATION-FAILED' });
  });
});

describe('assertCleanWorkingTree', () => {
  it('resolves for a clean tree', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'a.txt'), 'a');
    await commitAll(cwd, 'initial');

    await expect(assertCleanWorkingTree(cwd)).resolves.toBeUndefined();
  });

  it('rejects with a VCS-DIRTY-TREE VcsError naming every dirty file and a real remedy, never silently discarding them', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'a.txt'), 'a');
    await commitAll(cwd, 'initial');
    await writeFile(path.join(cwd, 'a.txt'), 'changed');
    await writeFile(path.join(cwd, 'untracked.txt'), 'x');

    const rejection = assertCleanWorkingTree(cwd);
    await expect(rejection).rejects.toBeInstanceOf(VcsError);
    await expect(rejection).rejects.toMatchObject({
      code: 'VCS-DIRTY-TREE',
      remedy: expect.stringContaining('git stash') as unknown as string,
    });
    await expect(assertCleanWorkingTree(cwd)).rejects.toThrow(/a\.txt/);
    await expect(assertCleanWorkingTree(cwd)).rejects.toThrow(/untracked\.txt/);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'rejects with a VcsError, not a raw simple-git error, when cwd has no permission to read',
    // POSIX permission bits only: chmod 0o000 does not restrict a Windows ACL the same way, and root
    // bypasses the permission check entirely, so neither would exercise the failure this test targets.
    async () => {
      const cwd = await createTempRepo();
      await writeFile(path.join(cwd, 'a.txt'), 'a');
      await commitAll(cwd, 'initial');
      await chmod(cwd, 0o000);
      try {
        await expect(assertCleanWorkingTree(cwd)).rejects.toBeInstanceOf(VcsError);
      } finally {
        await chmod(cwd, 0o755);
      }
    },
  );
});
