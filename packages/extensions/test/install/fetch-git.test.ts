/**
 * `fetchGitOverlayBundle` — the git-channel orchestration layer over `@forge/vcs`'s own real
 * `fetchGitOverlay`, against a real, disposable local git remote this file constructs (never a live
 * network call), matching `packages/vcs/test/overlay-fetch.test.ts`'s own established real-git tier.
 *
 * @see specs/19 §19.5
 * @see PLAN-M11.md P1
 */
import { isForgeError } from '@forge/core';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { fetchGitOverlayBundle } from '../../src/install/fetch-git.ts';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function freshDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

async function createRemoteRepo(withManifest: boolean): Promise<{ url: string }> {
  const dir = await freshDir('forge-extensions-git-remote-');
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });

  if (withManifest) {
    await writeFile(path.join(dir, 'overlay.yaml'), 'name: acme-standards\nversion: 1.0.0\n');
  } else {
    await writeFile(path.join(dir, 'README.md'), 'not a manifest\n');
  }
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'initial'], { cwd: dir });
  await execa('git', ['tag', '-a', 'v1.0.0', '-m', 'v1.0.0'], { cwd: dir });

  return { url: `file://${dir}` };
}

async function expectForgeError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    expect.unreachable('fetchGitOverlayBundle should have thrown');
  } catch (error) {
    expect(isForgeError(error)).toBe(true);
    if (isForgeError(error)) expect(error.code).toBe(code);
  }
}

describe('fetchGitOverlayBundle', () => {
  it('round-trips a real git-channel fetch with a manifest present', async () => {
    const { url } = await createRemoteRepo(true);
    const workDir = await freshDir('forge-extensions-git-work-');

    const result = await fetchGitOverlayBundle(`git+${url}#v1.0.0`, { workDir });

    expect(result.manifestKind).toBe('overlay');
    expect(result.refKind).toBe('tag');
    expect(result.warnings).toEqual([]);
  });

  it('refuses a fetched bundle with no manifest, named CFG-027, and removes the checkout', async () => {
    const { url } = await createRemoteRepo(false);
    const workDir = await freshDir('forge-extensions-git-work-');

    await expectForgeError(fetchGitOverlayBundle(`git+${url}#v1.0.0`, { workDir }), 'CFG-027');

    // No orphaned checkout directory should remain under workDir.
    const remaining = await readdir(workDir);
    expect(remaining).toEqual([]);
  });

  it('wraps an underlying VcsError as a ForgeError VCS-008, for a malformed spec', async () => {
    const workDir = await freshDir('forge-extensions-git-work-');
    await expectForgeError(fetchGitOverlayBundle('not-a-git-spec', { workDir }), 'VCS-008');
  });

  it('wraps an underlying VcsError as a ForgeError VCS-008, for a ref that does not exist, and leaves workDir clean', async () => {
    const { url } = await createRemoteRepo(true);
    const workDir = await freshDir('forge-extensions-git-work-');

    await expectForgeError(fetchGitOverlayBundle(`git+${url}#no-such-ref`, { workDir }), 'VCS-008');

    expect(await readdir(workDir)).toEqual([]);
  });

  it('VCS-008 carries the real underlying VcsError code/message, not a generic UNKNOWN', async () => {
    const { url } = await createRemoteRepo(true);
    const workDir = await freshDir('forge-extensions-git-work-');

    try {
      await fetchGitOverlayBundle(`git+${url}#no-such-ref`, { workDir });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(isForgeError(error)).toBe(true);
      if (isForgeError(error)) {
        expect(error.details['vcsCode']).not.toBe('UNKNOWN');
        expect(typeof error.details['vcsMessage']).toBe('string');
      }
    }
  });
});
