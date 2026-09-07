/**
 * `initGitRepo`/`gitStatusPaths` — direct tests. A gauntlet critic found these were previously exercised
 * only indirectly through C14's own single always-happy-path fixture (one fresh untracked file), which
 * never surfaced the rename-line parsing bug this file's own regression test now covers.
 *
 * @see PLAN-M4.md P4
 */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { gitStatusPaths, initGitRepo } from '../../src/conformance/git.ts';

const execFileAsync = promisify(execFile);

async function createRepoDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'forge-git-test-'));
}

describe('initGitRepo', () => {
  it('makes a bare directory a real git repository git status can run against', async () => {
    const dir = await createRepoDir();
    await expect(gitStatusPaths(dir)).rejects.toThrow();
    await initGitRepo(dir);
    await expect(gitStatusPaths(dir)).resolves.toEqual([]);
  });
});

describe('gitStatusPaths', () => {
  it('reports a newly-created untracked file by its relative path', async () => {
    const dir = await createRepoDir();
    await initGitRepo(dir);
    await writeFile(path.join(dir, 'new-file.txt'), 'content', 'utf8');
    expect(await gitStatusPaths(dir)).toEqual(['new-file.txt']);
  });

  it('reports a modified tracked file by its relative path', async () => {
    const dir = await createRepoDir();
    await initGitRepo(dir);
    const target = path.join(dir, 'tracked.txt');
    await writeFile(target, 'v1', 'utf8');
    // No commit needed: git status --porcelain reports untracked files too, and this suite never
    // commits — only ever inits and inspects — matching how the real C13/C14 checks use it.
    expect(await gitStatusPaths(dir)).toEqual(['tracked.txt']);
  });

  it('reports the new path for a rename, not the glued "old -> new" porcelain line', async () => {
    // git only performs rename *detection* relative to some prior known state (the index, compared
    // against HEAD) — a rename between two states neither of which was ever staged/committed just looks
    // like "delete an untracked file, add a different untracked file," with no `R` status line at all.
    // A real commit is needed first for the `R  old -> new` porcelain line this test exists to parse.
    const dir = await createRepoDir();
    await initGitRepo(dir);
    await execFileAsync('git', ['config', 'user.email', 'conformance-test@example.com'], { cwd: dir });
    await execFileAsync('git', ['config', 'user.name', 'Conformance Test'], { cwd: dir });
    const oldPath = path.join(dir, 'old-name.txt');
    await writeFile(oldPath, 'content long enough for git\'s own similarity-based rename detection', 'utf8');
    await execFileAsync('git', ['add', 'old-name.txt'], { cwd: dir });
    await execFileAsync('git', ['commit', '--quiet', '-m', 'initial'], { cwd: dir });
    await rename(oldPath, path.join(dir, 'new-name.txt'));
    await execFileAsync('git', ['add', '-A'], { cwd: dir });
    const paths = await gitStatusPaths(dir);
    expect(paths).toContain('new-name.txt');
    expect(paths.some((p) => p.includes(' -> '))).toBe(false);
    expect(paths.some((p) => p.includes('old-name.txt'))).toBe(false);
  });

  it('reports a file inside a brand-new untracked directory individually, not the collapsed directory line', async () => {
    // git's own default (status.showUntrackedFiles=normal) collapses a new untracked directory into a
    // single "?? newdir/" line, never listing files inside it — a gauntlet verify pass found this made
    // C13's own leak-check silently miss a secret written inside a fresh subdirectory, and separately
    // made C14 wrongly reject a compliant adapter that wrote into one. --untracked-files=all fixes it.
    const dir = await createRepoDir();
    await initGitRepo(dir);
    await mkdir(path.join(dir, 'newdir'));
    await writeFile(path.join(dir, 'newdir', 'inner.txt'), 'content', 'utf8');
    const paths = await gitStatusPaths(dir);
    expect(paths).toEqual(['newdir/inner.txt']);
  });

  it('returns an empty array for a clean repository', async () => {
    const dir = await createRepoDir();
    await initGitRepo(dir);
    expect(await gitStatusPaths(dir)).toEqual([]);
  });

  it('reports multiple changed files, each by its own relative path', async () => {
    const dir = await createRepoDir();
    await initGitRepo(dir);
    await writeFile(path.join(dir, 'a.txt'), 'a', 'utf8');
    await writeFile(path.join(dir, 'b.txt'), 'b', 'utf8');
    const paths = [...(await gitStatusPaths(dir))].sort();
    expect(paths).toEqual(['a.txt', 'b.txt']);
  });
});
