/**
 * `fetchGitOverlay`/`parseGitOverlaySpec`/`computeContentChecksum` — `19` §19.5's own git channel,
 * against a real, disposable local git remote this file constructs itself (never a live network
 * call, matching `tag.test.ts`'s own established real-git tier).
 *
 * @see specs/19 §19.5
 * @see PLAN-M11.md P1
 */
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { VcsError } from '../src/errors.ts';
import {
  computeContentChecksum,
  fetchGitOverlay,
  parseGitOverlaySpec,
} from '../src/overlay-fetch.ts';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function freshTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** A real, disposable local git "remote" — an ordinary (non-bare) repository on disk, cloned via a
 * `file://` URL. `git clone` works identically against a local path and a real remote, so this is a
 * genuine exercise of the clone/checkout/ls-remote machinery, never a mock. */
async function createRemoteRepo(): Promise<{ dir: string; url: string; firstSha: string }> {
  const dir = await freshTempDir('forge-vcs-overlay-remote-');
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });

  await writeFile(path.join(dir, 'overlay.yaml'), 'name: acme-standards\nversion: 1.0.0\n');
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'v1'], { cwd: dir });
  const { stdout: firstSha } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
  await execa('git', ['tag', '-a', 'v1.0.0', '-m', 'v1.0.0'], { cwd: dir });

  await writeFile(path.join(dir, 'overlay.yaml'), 'name: acme-standards\nversion: 2.0.0\n');
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'v2'], { cwd: dir });

  return { dir, url: `file://${dir}`, firstSha: firstSha.trim() };
}

/** Creates a second, real branch (in addition to `main`) at `dir` and pushes... no push needed: this
 * repo *is* the "remote" a `file://` clone reads directly, so committing on a branch there is enough
 * for `git ls-remote`/`git clone` to see it. */
async function createBranch(dir: string, branchName: string): Promise<void> {
  await execa('git', ['checkout', '-b', branchName], { cwd: dir });
  await execa('git', ['checkout', 'main'], { cwd: dir });
}

describe('parseGitOverlaySpec', () => {
  it('parses the literal git+<url>#<tag-or-sha> format', () => {
    expect(parseGitOverlaySpec('git+https://example.com/acme/repo.git#v3.2.0')).toEqual({
      url: 'https://example.com/acme/repo.git',
      ref: 'v3.2.0',
    });
  });

  it('rejects a spec with no "git+" prefix', () => {
    expect(() => parseGitOverlaySpec('https://example.com/repo.git#v1.0.0')).toThrow(VcsError);
  });

  it('rejects a spec with no pinned ref fragment', () => {
    expect(() => parseGitOverlaySpec('git+https://example.com/repo.git')).toThrow(VcsError);
  });

  it('rejects a flag-shaped ref before ever spawning git', () => {
    expect(() => parseGitOverlaySpec('git+https://example.com/repo.git#-q')).toThrow(VcsError);
  });

  it('rejects a whitespace-containing ref', () => {
    expect(() => parseGitOverlaySpec('git+https://example.com/repo.git#bad ref')).toThrow(VcsError);
  });

  it('rejects a ref containing a glob metacharacter', () => {
    expect(() => parseGitOverlaySpec('git+https://example.com/repo.git#v*')).toThrow(VcsError);
    expect(() => parseGitOverlaySpec('git+https://example.com/repo.git#v?')).toThrow(VcsError);
    expect(() => parseGitOverlaySpec('git+https://example.com/repo.git#v[1]')).toThrow(VcsError);
  });

  it('rejects a disallowed git URL scheme (command/fd injection surface)', () => {
    expect(() => parseGitOverlaySpec('git+ext::sh,-c,id#v1.0.0')).toThrow(VcsError);
    expect(() => parseGitOverlaySpec('git+fd::0#v1.0.0')).toThrow(VcsError);
  });

  it('accepts every allowlisted URL scheme', () => {
    for (const scheme of ['http', 'https', 'ssh', 'git', 'file']) {
      expect(() =>
        parseGitOverlaySpec(`git+${scheme}://example.com/repo.git#v1.0.0`),
      ).not.toThrow();
    }
  });

  it('accepts a scp-like (user@host:path) git remote with no scheme', () => {
    expect(parseGitOverlaySpec('git+git@example.com:acme/repo.git#v1.0.0')).toEqual({
      url: 'git@example.com:acme/repo.git',
      ref: 'v1.0.0',
    });
  });

  it('rejects a schemeless, non-scp-like URL', () => {
    expect(() => parseGitOverlaySpec('git+not-a-real-remote#v1.0.0')).toThrow(VcsError);
  });
});

describe('fetchGitOverlay', () => {
  it('resolves a pinned tag with no warning', async () => {
    const { url } = await createRemoteRepo();
    const workDir = await freshTempDir('forge-vcs-overlay-work-');

    const result = await fetchGitOverlay(`git+${url}#v1.0.0`, { workDir });

    expect(result.refKind).toBe('tag');
    expect(result.warnings).toEqual([]);
    const content = await readFile(path.join(result.path, 'overlay.yaml'), 'utf8');
    expect(content).toContain('version: 1.0.0');
  });

  it('resolves a pinned SHA with no warning', async () => {
    const { url, firstSha } = await createRemoteRepo();
    const workDir = await freshTempDir('forge-vcs-overlay-work-');

    const result = await fetchGitOverlay(`git+${url}#${firstSha}`, { workDir });

    expect(result.refKind).toBe('sha');
    expect(result.warnings).toEqual([]);
    expect(result.resolvedCommit).toBe(firstSha);
  });

  it('warns on a floating branch ref', async () => {
    const { url } = await createRemoteRepo();
    const workDir = await freshTempDir('forge-vcs-overlay-work-');

    const result = await fetchGitOverlay(`git+${url}#main`, { workDir });

    expect(result.refKind).toBe('branch');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/floating/i);
  });

  it('checks out the content at the pinned ref, not the tip of the default branch', async () => {
    const { url } = await createRemoteRepo();
    const workDir = await freshTempDir('forge-vcs-overlay-work-');

    const pinned = await fetchGitOverlay(`git+${url}#v1.0.0`, { workDir });
    const floating = await fetchGitOverlay(`git+${url}#main`, { workDir });

    expect(pinned.checksum).not.toBe(floating.checksum);
  });

  it('rejects a ref that does not exist at the remote', async () => {
    const { url } = await createRemoteRepo();
    const workDir = await freshTempDir('forge-vcs-overlay-work-');

    await expect(fetchGitOverlay(`git+${url}#no-such-tag`, { workDir })).rejects.toBeInstanceOf(
      VcsError,
    );
  });

  it('rejects an unreachable URL', async () => {
    const workDir = await freshTempDir('forge-vcs-overlay-work-');
    const missing = await freshTempDir('forge-vcs-overlay-missing-');
    await rm(missing, { recursive: true, force: true });

    await expect(
      fetchGitOverlay(`git+file://${missing}#v1.0.0`, { workDir }),
    ).rejects.toBeInstanceOf(VcsError);
  });

  it('leaves no orphaned checkout directory behind when checkout fails', async () => {
    const { url } = await createRemoteRepo();
    const workDir = await freshTempDir('forge-vcs-overlay-work-');

    await expect(fetchGitOverlay(`git+${url}#no-such-tag`, { workDir })).rejects.toBeInstanceOf(
      VcsError,
    );

    expect(await readdir(workDir)).toEqual([]);
  });

  it('leaves no orphaned checkout directory behind when the fetched content contains a symlink', async () => {
    const { dir, url } = await createRemoteRepo();
    await symlink('/etc/hosts', path.join(dir, 'escape-link'));
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'add a symlink'], { cwd: dir });
    await execa('git', ['tag', '-a', 'v-symlink', '-m', 'v-symlink'], { cwd: dir });
    const workDir = await freshTempDir('forge-vcs-overlay-work-');

    await expect(fetchGitOverlay(`git+${url}#v-symlink`, { workDir })).rejects.toMatchObject({
      code: 'VCS-OVERLAY-SYMLINK-REJECTED',
    });
    expect(await readdir(workDir)).toEqual([]);
  });

  it('classifies a real branch whose own name happens to be hex-shaped as floating, not a pinned SHA', async () => {
    const { url, dir } = await createRemoteRepo();
    await createBranch(dir, 'deadbeef');
    const workDir = await freshTempDir('forge-vcs-overlay-work-');

    const result = await fetchGitOverlay(`git+${url}#deadbeef`, { workDir });

    expect(result.refKind).toBe('branch');
    expect(result.warnings).toHaveLength(1);
  });
});

describe('computeContentChecksum', () => {
  it('is deterministic and stable across two fetches of the identical content', async () => {
    const { url } = await createRemoteRepo();
    const workDirA = await freshTempDir('forge-vcs-overlay-work-a-');
    const workDirB = await freshTempDir('forge-vcs-overlay-work-b-');

    const first = await fetchGitOverlay(`git+${url}#v1.0.0`, { workDir: workDirA });
    const second = await fetchGitOverlay(`git+${url}#v1.0.0`, { workDir: workDirB });

    expect(first.checksum).toBe(second.checksum);
    expect(first.path).not.toBe(second.path);
  });

  it('excludes .git from the checksum — two directories with identical content but different git history checksum the same', async () => {
    const dirA = await freshTempDir('forge-vcs-checksum-a-');
    const dirB = await freshTempDir('forge-vcs-checksum-b-');
    await writeFile(path.join(dirA, 'overlay.yaml'), 'name: acme\n');
    await writeFile(path.join(dirB, 'overlay.yaml'), 'name: acme\n');
    await execa('git', ['init', '--quiet'], { cwd: dirA });
    // dirB has no .git at all — the two are content-identical but structurally different on disk.

    const checksumA = await computeContentChecksum(dirA);
    const checksumB = await computeContentChecksum(dirB);

    expect(checksumA).toBe(checksumB);
  });

  it('changes when file content changes', async () => {
    const dir = await freshTempDir('forge-vcs-checksum-change-');
    await writeFile(path.join(dir, 'overlay.yaml'), 'name: acme\n');
    const before = await computeContentChecksum(dir);
    await writeFile(path.join(dir, 'overlay.yaml'), 'name: acme-changed\n');
    const after = await computeContentChecksum(dir);
    expect(before).not.toBe(after);
  });

  it('refuses a directory containing a symlink, rather than following it', async () => {
    const dir = await freshTempDir('forge-vcs-checksum-symlink-');
    await writeFile(path.join(dir, 'overlay.yaml'), 'name: acme\n');
    await symlink('/etc/hosts', path.join(dir, 'escape-link'));

    await expect(computeContentChecksum(dir)).rejects.toMatchObject({
      code: 'VCS-OVERLAY-SYMLINK-REJECTED',
    });
  });

  it('refuses a symlink nested in a subdirectory too, not only at the root', async () => {
    const dir = await freshTempDir('forge-vcs-checksum-nested-symlink-');
    await mkdir(path.join(dir, 'nested'));
    await writeFile(path.join(dir, 'nested', 'overlay.yaml'), 'name: acme\n');
    await symlink('/etc/hosts', path.join(dir, 'nested', 'escape-link'));

    await expect(computeContentChecksum(dir)).rejects.toMatchObject({
      code: 'VCS-OVERLAY-SYMLINK-REJECTED',
    });
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'wraps a real fs failure (unreadable file) as a VcsError, not a raw exception',
    // POSIX permission bits only, and never as root — see git.test.ts's identical precedent for why.
    async () => {
      const dir = await freshTempDir('forge-vcs-checksum-unreadable-');
      const filePath = path.join(dir, 'overlay.yaml');
      await writeFile(filePath, 'name: acme\n');
      await chmod(filePath, 0o000);
      try {
        await expect(computeContentChecksum(dir)).rejects.toBeInstanceOf(VcsError);
      } finally {
        await chmod(filePath, 0o644);
      }
    },
  );
});
