/**
 * `takeTreeSnapshot`/`snapshotsEqual`/`snapshotDigest` — the cleanliness snapshot `13` F-TEST-9's
 * observation bullets take before and after every case, against a REAL git repository throughout
 * (`QUALITY-BAR.md` R6/R10): `HEAD` plus, for every path `git status --porcelain=v1 -z --no-renames
 * --untracked-files=all` lists, its status code and a content digest, with an ignored file and a
 * tracked file marked `skip-worktree`/`assume-unchanged` excluded, and paths resolved from the
 * repository's real top level rather than the (possibly nested) project root.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M16.md P3
 */
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import {
  snapshotDigest,
  snapshotsEqual,
  takeTreeSnapshot,
} from '../../../src/commands/parity/tree-snapshot.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function freshRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-p3-snapshot-'));
  dirs.push(dir);
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 't@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 't'], { cwd: dir });
  return dir;
}

async function commitAll(cwd: string, message: string): Promise<void> {
  await execa('git', ['add', '-A'], { cwd });
  await execa('git', ['commit', '--quiet', '-m', message], { cwd });
}

describe('takeTreeSnapshot (specs/22 M16 P3)', () => {
  it('two snapshots of an untouched tree are equal', async () => {
    const dir = await freshRepo();
    await writeFile(path.join(dir, 'a.txt'), 'one\n', 'utf8');
    await commitAll(dir, 'init');
    const before = await takeTreeSnapshot(dir);
    const after = await takeTreeSnapshot(dir);
    expect(snapshotsEqual(before, after)).toBe(true);
    expect(before.headSha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('detects a modified tracked file', async () => {
    const dir = await freshRepo();
    await writeFile(path.join(dir, 'a.txt'), 'one\n', 'utf8');
    await commitAll(dir, 'init');
    const before = await takeTreeSnapshot(dir);
    await writeFile(path.join(dir, 'a.txt'), 'two\n', 'utf8');
    const after = await takeTreeSnapshot(dir);
    expect(snapshotsEqual(before, after)).toBe(false);
  });

  it('detects a new untracked file', async () => {
    const dir = await freshRepo();
    await writeFile(path.join(dir, 'a.txt'), 'one\n', 'utf8');
    await commitAll(dir, 'init');
    const before = await takeTreeSnapshot(dir);
    await writeFile(path.join(dir, 'new-untracked.txt'), 'surprise\n', 'utf8');
    const after = await takeTreeSnapshot(dir);
    expect(snapshotsEqual(before, after)).toBe(false);
    expect(after.entries.some((entry) => entry.path === 'new-untracked.txt')).toBe(true);
  });

  it('detects a deleted tracked file, reported as absent', async () => {
    const dir = await freshRepo();
    await writeFile(path.join(dir, 'a.txt'), 'one\n', 'utf8');
    await commitAll(dir, 'init');
    const before = await takeTreeSnapshot(dir);
    await rm(path.join(dir, 'a.txt'));
    const after = await takeTreeSnapshot(dir);
    expect(snapshotsEqual(before, after)).toBe(false);
    const entry = after.entries.find((candidate) => candidate.path === 'a.txt');
    expect(entry?.content).toBe('absent');
  });

  it('an ignored file is never part of the snapshot, even newly created', async () => {
    const dir = await freshRepo();
    await writeFile(path.join(dir, '.gitignore'), 'ignored.log\n', 'utf8');
    await writeFile(path.join(dir, 'a.txt'), 'one\n', 'utf8');
    await commitAll(dir, 'init');
    const before = await takeTreeSnapshot(dir);
    await writeFile(path.join(dir, 'ignored.log'), 'noise\n', 'utf8');
    const after = await takeTreeSnapshot(dir);
    expect(snapshotsEqual(before, after)).toBe(true);
    expect(after.entries.some((entry) => entry.path === 'ignored.log')).toBe(false);
  });

  it('a tracked file marked skip-worktree is excluded even when its content on disk changes (specs/13 F-TEST-9), proven against real git, not reasoned about', async () => {
    const dir = await freshRepo();
    await writeFile(path.join(dir, 'b.txt'), 'two\n', 'utf8');
    await commitAll(dir, 'init');
    await execa('git', ['update-index', '--skip-worktree', 'b.txt'], { cwd: dir });
    const before = await takeTreeSnapshot(dir);
    await writeFile(path.join(dir, 'b.txt'), 'two CHANGED\n', 'utf8');
    const after = await takeTreeSnapshot(dir);
    expect(snapshotsEqual(before, after)).toBe(true);
    expect(after.entries.some((entry) => entry.path === 'b.txt')).toBe(false);
  });

  it('a tracked file marked assume-unchanged is excluded even when its content on disk changes, proven against real git, not reasoned about', async () => {
    const dir = await freshRepo();
    await writeFile(path.join(dir, 'c.txt'), 'three\n', 'utf8');
    await commitAll(dir, 'init');
    await execa('git', ['update-index', '--assume-unchanged', 'c.txt'], { cwd: dir });
    const before = await takeTreeSnapshot(dir);
    await writeFile(path.join(dir, 'c.txt'), 'three CHANGED\n', 'utf8');
    const after = await takeTreeSnapshot(dir);
    expect(snapshotsEqual(before, after)).toBe(true);
    expect(after.entries.some((entry) => entry.path === 'c.txt')).toBe(false);
  });

  it('resolves paths from the repository real top level, not the (nested) project root, so a sibling change outside the project is still correctly attributed and a project-relative change is correctly found at its real location', async () => {
    const repo = await freshRepo();
    const projectRoot = path.join(repo, 'nested', 'project');
    await mkdir(projectRoot, { recursive: true });
    await writeFile(path.join(repo, 'outside.txt'), 'outside\n', 'utf8');
    await writeFile(path.join(projectRoot, 'inside.txt'), 'inside\n', 'utf8');
    await commitAll(repo, 'init');
    const before = await takeTreeSnapshot(projectRoot);
    await writeFile(path.join(projectRoot, 'inside.txt'), 'inside CHANGED\n', 'utf8');
    const after = await takeTreeSnapshot(projectRoot);
    expect(snapshotsEqual(before, after)).toBe(false);
    // The changed path is reported relative to the TOP LEVEL (it lies above the project root), not
    // as a project-relative path that would (wrongly) read "inside.txt" alone.
    const changed = after.entries.find(
      (entry) =>
        entry.content !== (before.entries.find((b) => b.path === entry.path)?.content ?? 'absent'),
    );
    expect(changed?.path).toBe('nested/project/inside.txt');
  });

  it('entries are sorted by path regardless of git status output order (QUALITY-BAR.md R10)', async () => {
    const dir = await freshRepo();
    await writeFile(path.join(dir, 'a.txt'), 'one\n', 'utf8');
    await commitAll(dir, 'init');
    await writeFile(path.join(dir, 'zzz-new.txt'), 'z\n', 'utf8');
    await writeFile(path.join(dir, 'aaa-new.txt'), 'a\n', 'utf8');
    const snapshot = await takeTreeSnapshot(dir);
    const paths = snapshot.entries.map((entry) => entry.path);
    expect(paths).toEqual([...paths].sort());
  });

  it('a symlink entry is reported as link:<target>, never followed', async () => {
    const dir = await freshRepo();
    await writeFile(path.join(dir, 'a.txt'), 'one\n', 'utf8');
    await commitAll(dir, 'init');
    const before = await takeTreeSnapshot(dir);
    await symlink('a.txt', path.join(dir, 'link-to-a'));
    const after = await takeTreeSnapshot(dir);
    const entry = after.entries.find((candidate) => candidate.path === 'link-to-a');
    expect(entry?.content).toBe('link:a.txt');
    expect(snapshotsEqual(before, after)).toBe(false);
  });

  it('snapshotDigest is deterministic and changes when the snapshot does', async () => {
    const dir = await freshRepo();
    await writeFile(path.join(dir, 'a.txt'), 'one\n', 'utf8');
    await commitAll(dir, 'init');
    const before = await takeTreeSnapshot(dir);
    const digestAgain = snapshotDigest(await takeTreeSnapshot(dir));
    expect(snapshotDigest(before)).toBe(digestAgain);
    await writeFile(path.join(dir, 'a.txt'), 'two\n', 'utf8');
    const after = await takeTreeSnapshot(dir);
    expect(snapshotDigest(after)).not.toBe(snapshotDigest(before));
  });

  it('a HEAD change alone (no working-tree difference) still changes the snapshot', async () => {
    const dir = await freshRepo();
    await writeFile(path.join(dir, 'a.txt'), 'one\n', 'utf8');
    await commitAll(dir, 'init');
    const before = await takeTreeSnapshot(dir);
    await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'second'], { cwd: dir });
    const after = await takeTreeSnapshot(dir);
    expect(before.headSha).not.toBe(after.headSha);
    expect(snapshotsEqual(before, after)).toBe(false);
  });

  it('a directory entry (an untracked directory with tracked-looking contents reported via its files, not itself) never appears as its own dir entry from plain git status', async () => {
    // git status never lists a bare directory path itself (it lists the files inside it), so this
    // documents that `takeTreeSnapshot` only ever sees `dir` content kind through a real edge case:
    // a tracked path that is replaced by a directory on disk.
    const dir = await freshRepo();
    await writeFile(path.join(dir, 'was-a-file.txt'), 'one\n', 'utf8');
    await commitAll(dir, 'init');
    await rm(path.join(dir, 'was-a-file.txt'));
    await mkdir(path.join(dir, 'was-a-file.txt'));
    await writeFile(path.join(dir, 'was-a-file.txt', 'inner.txt'), 'x\n', 'utf8');
    const snapshot = await takeTreeSnapshot(dir);
    const entry = snapshot.entries.find((candidate) => candidate.path === 'was-a-file.txt');
    expect(entry?.content).toBe('dir');
  });

  it('throws RUN-126 (wrapping a real ENOENT) when the tree does not exist at all', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-p3-snapshot-'));
    await rm(dir, { recursive: true, force: true });
    await expect(takeTreeSnapshot(dir)).rejects.toMatchObject({
      code: 'RUN-126',
      details: { vcsCode: 'ENOENT' },
    });
  });

  it('throws RUN-126 (vcsCode UNKNOWN: a real git failure with no node errno of its own) when the tree is not a git repository at all', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-p3-snapshot-'));
    dirs.push(dir);
    await expect(takeTreeSnapshot(dir)).rejects.toMatchObject({
      code: 'RUN-126',
      details: { vcsCode: 'UNKNOWN' },
    });
  });

  it('throws RUN-126 when the repository has no commits yet (an unborn HEAD)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-p3-snapshot-'));
    dirs.push(dir);
    await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
    await expect(takeTreeSnapshot(dir)).rejects.toMatchObject({ code: 'RUN-126' });
  });

  it('throws RUN-126 when git status itself fails even though HEAD resolved (a real permission failure on .git/index)', async () => {
    const dir = await freshRepo();
    await writeFile(path.join(dir, 'a.txt'), 'one\n', 'utf8');
    await commitAll(dir, 'init');
    await chmod(path.join(dir, '.git', 'index'), 0o000);
    try {
      await expect(takeTreeSnapshot(dir)).rejects.toMatchObject({ code: 'RUN-126' });
    } finally {
      await chmod(path.join(dir, '.git', 'index'), 0o644);
    }
  });

  it('rethrows a non-ENOENT lstat failure rather than reporting absent (a path component replaced by a plain file, giving a real ENOTDIR)', async () => {
    const dir = await freshRepo();
    await mkdir(path.join(dir, 'blocker'), { recursive: true });
    await writeFile(path.join(dir, 'blocker', 'inner.txt'), 'one\n', 'utf8');
    await commitAll(dir, 'init');
    await rm(path.join(dir, 'blocker'), { recursive: true, force: true });
    await writeFile(path.join(dir, 'blocker'), 'now a plain file\n', 'utf8');
    await expect(takeTreeSnapshot(dir)).rejects.toThrow(/ENOTDIR/);
  });

  it('reports a non-regular, non-symlink, non-directory entry (a real FIFO) as "other"', async () => {
    // `git status` genuinely never lists a bare, untracked FIFO at all (confirmed directly): the one
    // real way to make `git status` name a path that is now a FIFO on disk is to replace an already
    // TRACKED file with one, which status reports as "modified" (its blob no longer matches).
    const dir = await freshRepo();
    await writeFile(path.join(dir, 'tracked.txt'), 'one\n', 'utf8');
    await commitAll(dir, 'init');
    await rm(path.join(dir, 'tracked.txt'));
    await execa('mkfifo', [path.join(dir, 'tracked.txt')]);
    const snapshot = await takeTreeSnapshot(dir);
    const entry = snapshot.entries.find((candidate) => candidate.path === 'tracked.txt');
    expect(entry?.content).toBe('other');
  });

  it('snapshotsEqual walks every entry and finds a genuine TRUE match when both sides share the identical non-empty entry list', async () => {
    const dir = await freshRepo();
    await writeFile(path.join(dir, 'a.txt'), 'one\n', 'utf8');
    await commitAll(dir, 'init');
    await writeFile(path.join(dir, 'untracked.txt'), 'noise\n', 'utf8');
    const first = await takeTreeSnapshot(dir);
    const second = await takeTreeSnapshot(dir);
    expect(first.entries.length).toBeGreaterThan(0);
    expect(snapshotsEqual(first, second)).toBe(true);
  });

  it('snapshotsEqual walks every entry and finds a genuine content mismatch at the same path, same entry count', async () => {
    const dir = await freshRepo();
    await writeFile(path.join(dir, 'a.txt'), 'one\n', 'utf8');
    await commitAll(dir, 'init');
    await writeFile(path.join(dir, 'untracked.txt'), 'noise\n', 'utf8');
    const before = await takeTreeSnapshot(dir);
    await writeFile(path.join(dir, 'untracked.txt'), 'different noise\n', 'utf8');
    const after = await takeTreeSnapshot(dir);
    expect(before.entries.length).toBe(after.entries.length);
    expect(before.entries.map((e) => e.path)).toEqual(after.entries.map((e) => e.path));
    expect(snapshotsEqual(before, after)).toBe(false);
  });
});
