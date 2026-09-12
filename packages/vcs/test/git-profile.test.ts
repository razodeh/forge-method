/**
 * `analyzeGitProfile` against real git repositories — no mocking, matching this package's own
 * established pattern (`test/git.test.ts`'s own `createTempRepo`). Every fact asserted here is
 * constructed by hand first (a known number of commits, known authors, known co-changed files) so the
 * assertion is against a real, hand-verified history rather than the function's own output.
 *
 * @see specs/17 §17.2
 * @see PLAN-M10.md P15
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VcsError } from '../src/errors.ts';
import { analyzeGitProfile } from '../src/git-profile.ts';

const cleanupDirs: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTempRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-vcs-git-profile-'));
  cleanupDirs.push(dir);
  await execa('git', ['init', '--quiet'], { cwd: dir });
  await execa('git', ['config', 'user.email', 'a@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'A'], { cwd: dir });
  return dir;
}

async function commitFiles(
  cwd: string,
  files: Record<string, string>,
  message: string,
  author: { email: string; name: string },
): Promise<void> {
  for (const [file, contents] of Object.entries(files)) {
    const full = path.join(cwd, file);
    await writeFile(full, contents, 'utf8');
  }
  await execa('git', ['add', '-A'], { cwd });
  // The repo-wide test setup (`test/setup.ts`) pins `GIT_AUTHOR_EMAIL`/`GIT_COMMITTER_EMAIL` via
  // `process.env` for deterministic commit dates elsewhere in the suite — env vars win over `-c
  // user.email=...`, so distinguishing authors here needs an explicit `env` override per commit, not
  // `-c` flags (confirmed empirically: `-c` alone silently produced one author for every commit).
  await execa('git', ['commit', '--quiet', '-m', message], {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: author.name,
      GIT_AUTHOR_EMAIL: author.email,
      GIT_COMMITTER_NAME: author.name,
      GIT_COMMITTER_EMAIL: author.email,
    },
  });
}

describe('analyzeGitProfile', () => {
  it('reports zero facts, not an error, for a repository with no commits yet', async () => {
    const cwd = await createTempRepo();
    const profile = await analyzeGitProfile(cwd);
    expect(profile).toEqual({
      hasCommits: false,
      ageDays: undefined,
      commitCount: 0,
      contributorCount: 0,
      churnHotspots: [],
      filesChangedTogether: [],
    });
  });

  it('rejects with VCS-NOT-A-REPO, not a raw execa error, when cwd is not a git repository', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'forge-vcs-git-profile-not-a-repo-'));
    cleanupDirs.push(cwd);
    const rejection = analyzeGitProfile(cwd);
    await expect(rejection).rejects.toBeInstanceOf(VcsError);
    await expect(rejection).rejects.toMatchObject({ code: 'VCS-NOT-A-REPO' });
  });

  it('rejects with ENV-GIT-MISSING when git is not on PATH', async () => {
    const cwd = await createTempRepo();
    const emptyDir = await mkdtemp(path.join(tmpdir(), 'forge-vcs-git-profile-no-git-on-path-'));
    cleanupDirs.push(emptyDir);
    vi.stubEnv('PATH', emptyDir);

    const rejection = analyzeGitProfile(cwd);
    await expect(rejection).rejects.toBeInstanceOf(VcsError);
    await expect(rejection).rejects.toMatchObject({ code: 'ENV-GIT-MISSING' });
  });

  it('counts commits, distinct authors, churn, and co-change against a hand-built history', async () => {
    const cwd = await createTempRepo();
    const alice = { email: 'alice@example.com', name: 'Alice' };
    const bob = { email: 'bob@example.com', name: 'Bob' };

    // Commit 1: two files together (a.ts, b.ts) — a real co-change pair.
    await commitFiles(cwd, { 'a.ts': '1', 'b.ts': '1' }, 'first', alice);
    // Commit 2: a.ts again, alone — raises a.ts's own churn without adding a co-change pair.
    await commitFiles(cwd, { 'a.ts': '2' }, 'second', bob);
    // Commit 3: a.ts and b.ts together again — the pair recurs, count should be 2.
    await commitFiles(cwd, { 'a.ts': '3', 'b.ts': '2' }, 'third', alice);

    const profile = await analyzeGitProfile(cwd);

    expect(profile.hasCommits).toBe(true);
    expect(profile.commitCount).toBe(3);
    expect(profile.contributorCount).toBe(2);
    expect(profile.ageDays).toBeGreaterThanOrEqual(0);

    expect(profile.churnHotspots).toEqual([
      { path: 'a.ts', commitCount: 3 },
      { path: 'b.ts', commitCount: 2 },
    ]);

    expect(profile.filesChangedTogether).toEqual([{ paths: ['a.ts', 'b.ts'], count: 2 }]);
  });

  it('excludes a commit with more files than maxFilesPerCommitForCoChange from co-change pairing only', async () => {
    const cwd = await createTempRepo();
    const author = { email: 'x@example.com', name: 'X' };
    await commitFiles(cwd, { 'f1.ts': '1', 'f2.ts': '1', 'f3.ts': '1' }, 'big commit', author);

    const profile = await analyzeGitProfile(cwd, { maxFilesPerCommitForCoChange: 2 });

    // Churn still counts every file in the big commit.
    expect(profile.churnHotspots).toEqual(
      expect.arrayContaining([
        { path: 'f1.ts', commitCount: 1 },
        { path: 'f2.ts', commitCount: 1 },
        { path: 'f3.ts', commitCount: 1 },
      ]),
    );
    // But no co-change pair is recorded for it, since 3 files exceeds the cap of 2.
    expect(profile.filesChangedTogether).toEqual([]);
  });

  it('caps churnHotspots and filesChangedTogether at the configured limits, highest first', async () => {
    const cwd = await createTempRepo();
    const author = { email: 'x@example.com', name: 'X' };
    for (let i = 0; i < 5; i += 1) {
      await commitFiles(
        cwd,
        { 'hot.ts': String(i), [`other-${String(i)}.ts`]: '1' },
        `c${String(i)}`,
        author,
      );
    }

    const profile = await analyzeGitProfile(cwd, { hotspotLimit: 1, coChangeLimit: 1 });

    expect(profile.churnHotspots).toHaveLength(1);
    expect(profile.churnHotspots[0]).toEqual({ path: 'hot.ts', commitCount: 5 });
    expect(profile.filesChangedTogether).toHaveLength(1);
  });
});
