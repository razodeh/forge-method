/**
 * `projectCacheHash`/`worktreesRootFor`/`legacyInTreeWorktreesRoot` — direct, dedicated coverage of
 * this module's own promises, with no indirection through `createLaneWorktree` or any other real
 * caller. Before this file, every real test of these two functions ran only through `lanes.test.ts`'s
 * own `createLaneWorktree`-based fixtures (`describe('Worktree location: ...')`) — real, valuable
 * coverage of the *integration*, but it leaves two of this module's own direct, documented promises
 * unverified in isolation, both found by a gauntlet critic round:
 *
 * 1. `projectCacheHash`'s own doc comment promises "64 bits" (`PROJECT_HASH_LENGTH = 16` hex chars) of
 *    real path-collision resistance — mutating that constant to `4` leaves every existing test in this
 *    whole package (and the rest of the monorepo) green, since nothing anywhere pins the actual length
 *    or algorithm. Fixed below with a pinned golden value, not just a length check.
 * 2. `worktreesRootFor`'s own `cacheDirRoot` parameter is resolved through
 *    `realpathOfDeepestExistingAncestor` specifically so a *symlinked* cache directory (`/tmp` on
 *    macOS, `os.tmpdir()`-derived) hashes and joins identically to its real path — but every existing
 *    test that exercises this resolution does so only incidentally, through the sandboxed test
 *    suite's own `XDG_CACHE_HOME` (`test/global-setup.ts`), which happens to sit under exactly that
 *    symlink on macOS specifically. Nothing proves this on a platform with no such ambient coincidence
 *    (an ordinary Linux `/tmp` is not a symlink at all). Fixed below by constructing a real symlink
 *    explicitly and passing it as `cacheDirRoot` directly.
 *
 * @see specs/18 §18.3
 * @see PLAN-M17.md P8
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { describe, expect, it } from 'vitest';

import {
  legacyInTreeWorktreesRoot,
  projectCacheHash,
  worktreesRootFor,
} from '../src/worktree-root.ts';

describe('projectCacheHash (specs/22 M17 P8)', () => {
  it('is a pinned, golden sha256-hex value truncated to exactly 16 characters (64 bits) for a fixed input — regresses loudly if PROJECT_HASH_LENGTH or the algorithm itself ever changes', () => {
    // Computed independently, once, outside this suite, from the documented algorithm
    // (`createHash('sha256').update(realProjectRoot).digest('hex').slice(0, 16)`) and hardcoded here as
    // a literal — never recomputed inline via the same helper this test exists to pin, which would let
    // a `PROJECT_HASH_LENGTH` mutation (16 -> 4, the gauntlet critic round's own concrete example) pass
    // silently by shrinking both sides of the comparison together.
    const fixedPath = '/a/fixed/test/path/for/forge/project-cache-hash';
    expect(projectCacheHash(fixedPath)).toBe('7f28de99fcf729f2');
  });

  it('is exactly 16 lowercase hex characters, for any real-looking path — a second, independent guard on length and charset alone', () => {
    for (const candidate of [
      '/Users/someone/Desktop/projects/forge',
      '/home/ci/work/checkout',
      'C:\\Users\\someone\\projects\\forge',
      '/',
      '',
    ]) {
      expect(projectCacheHash(candidate)).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it('matches an independently recomputed sha256-hex digest, sliced to the same length — ties the pinned golden value above to the documented algorithm, not just its length', () => {
    const realProjectRoot = '/Users/someone/Desktop/projects/some-other-project';
    const expected = createHash('sha256').update(realProjectRoot).digest('hex').slice(0, 16);
    expect(projectCacheHash(realProjectRoot)).toBe(expected);
  });

  it('is deterministic: the same real path always produces the same digest, called repeatedly, in any order', () => {
    const a = '/Users/someone/Desktop/projects/forge';
    const b = '/home/ci/work/checkout';
    const firstA = projectCacheHash(a);
    const firstB = projectCacheHash(b);
    expect(projectCacheHash(a)).toBe(firstA);
    expect(projectCacheHash(b)).toBe(firstB);
    expect(projectCacheHash(a)).toBe(firstA);
  });

  it('two different real paths hash differently — not a proof of no collisions, but catches a degenerate implementation (a constant, or one that ignores its own input) outright', () => {
    const hashes = new Set(
      [
        '/Users/alice/projects/forge',
        '/Users/bob/projects/forge',
        '/home/ci/work/checkout-1',
        '/home/ci/work/checkout-2',
        '/',
      ].map((candidate) => projectCacheHash(candidate)),
    );
    expect(hashes.size).toBe(5);
  });
});

describe('worktreesRootFor (specs/22 M17 P8)', () => {
  it('resolves a symlinked cacheDirRoot to its real path when passed directly — proven here independent of any ambient OS tmp-dir symlink, unlike every other existing test of this resolution', async () => {
    const realCacheRoot = await mkdtemp(path.join(tmpdir(), 'forge-vcs-worktree-root-real-'));
    const linkedCacheRoot = `${realCacheRoot}-link`;
    await execa('ln', ['-s', realCacheRoot, linkedCacheRoot]);
    try {
      const realProjectRoot = '/Users/someone/Desktop/projects/forge';
      const root = await worktreesRootFor(realProjectRoot, linkedCacheRoot);

      // Resolved to the REAL path -- the symlink's own name never appears in the result at all.
      expect(root).not.toContain(path.basename(linkedCacheRoot));
      const realResolvedCacheRoot = await realpath(realCacheRoot);
      expect(root).toBe(
        path.join(realResolvedCacheRoot, 'forge', projectCacheHash(realProjectRoot), 'worktrees'),
      );

      // The identical real location is reached whether the caller goes through the symlink or the
      // real path directly -- the one property this resolution step exists to guarantee at all (a
      // caller resuming later, from whichever spelling it has on hand, must land on the same worktree).
      expect(await worktreesRootFor(realProjectRoot, realCacheRoot)).toBe(root);
    } finally {
      await rm(linkedCacheRoot, { force: true });
      await rm(realCacheRoot, { recursive: true, force: true });
    }
  });

  it('never creates cacheDirRoot, or anything under it, itself — a pure path computation', async () => {
    const realCacheRoot = await mkdtemp(path.join(tmpdir(), 'forge-vcs-worktree-root-nocreate-'));
    try {
      const root = await worktreesRootFor('/Users/someone/Desktop/projects/forge', realCacheRoot);
      expect(existsSync(root)).toBe(false);
      // Neither the `worktrees` leaf nor its own `forge/<hash>` parent -- nothing under the real,
      // already-existing cache root is ever created by this function, only computed.
      expect(existsSync(path.dirname(root))).toBe(false);
    } finally {
      await rm(realCacheRoot, { recursive: true, force: true });
    }
  });

  it('defaults cacheDirRoot to the real systemCacheDirRoot() when the caller omits it', async () => {
    const realProjectRoot = '/Users/someone/Desktop/projects/forge';
    const root = await worktreesRootFor(realProjectRoot);
    const xdgCacheHome = process.env['XDG_CACHE_HOME'];
    expect(xdgCacheHome).toBeDefined();
    const realXdgCacheHome = await realpath(String(xdgCacheHome));
    expect(root).toBe(
      path.join(realXdgCacheHome, 'forge', projectCacheHash(realProjectRoot), 'worktrees'),
    );
  });
});

describe('legacyInTreeWorktreesRoot (specs/22 M17 P8)', () => {
  it('is exactly <projectRoot>/.forge/state/worktrees — the pre-M17 in-tree location, verbatim', () => {
    expect(legacyInTreeWorktreesRoot('/Users/someone/Desktop/projects/forge')).toBe(
      path.join('/Users/someone/Desktop/projects/forge', '.forge', 'state', 'worktrees'),
    );
  });
});
