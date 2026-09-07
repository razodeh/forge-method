/**
 * `createLaneWorktree`/`removeLaneWorktree`/`listOrphanedWorktrees`/`slugifyStepId` — `PLAN-M5.md` P2's
 * own Checks section, verbatim, against real git repositories.
 *
 * @see specs/06 §6.4
 * @see specs/18 §18.2
 * @see specs/20 §20.2, §20.10
 * @see PLAN-M5.md P2
 */
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { describe, expect, it } from 'vitest';

import { VcsError } from '../src/errors.ts';
import {
  createLaneWorktree,
  laneBranchName,
  listOrphanedWorktrees,
  parseWorktreeBlocks,
  removeLaneWorktree,
  slugifyStepId,
} from '../src/lanes.ts';

const SLUG_SHAPE = /^[a-z0-9-]+-[0-9a-f]{8}$/;

async function createTempRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-vcs-lanes-'));
  await execa('git', ['init', '--quiet'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

async function branchExistsInRepo(cwd: string, branch: string): Promise<boolean> {
  const { stdout } = await execa('git', ['branch', '--list', branch], { cwd });
  return stdout.trim() !== '';
}

describe('slugifyStepId', () => {
  it('produces a readable prefix followed by a hyphen and an 8-hex-character disambiguator', () => {
    expect(slugifyStepId('implement-story-014')).toMatch(SLUG_SHAPE);
  });

  it('is deterministic — the same input always slugifies identically, byte for byte', () => {
    const results = new Set(Array.from({ length: 5 }, () => slugifyStepId('Build-Stage:Implement:STORY-014')));
    expect(results.size).toBe(1);
  });

  it('replaces colons — an ordinary part of the real 06 §6.2 step id format — with hyphens in the readable prefix', () => {
    expect(slugifyStepId('build-stage:implement:STORY-014')).toMatch(/^build-stage-implement-story-014-[0-9a-f]{8}$/);
  });

  it('never returns a bare, un-suffixed string, even for input that folds to nothing', () => {
    expect(slugifyStepId(':::')).toMatch(/^step-[0-9a-f]{8}$/);
    expect(slugifyStepId('')).toMatch(/^step-[0-9a-f]{8}$/);
  });

  it('two different, realistic step ids that fold to the identical readable prefix produce different slugs', () => {
    // The exact collision a gauntlet critic round found: "STORY-014" and "story:014" both fold their
    // readable portion to "story-014" — without the hash suffix these would be fully indistinguishable.
    const a = slugifyStepId('STORY-014');
    const b = slugifyStepId('story:014');
    expect(a).not.toBe(b);
    expect(a.replace(/-[0-9a-f]{8}$/, '')).toBe('story-014');
    expect(b.replace(/-[0-9a-f]{8}$/, '')).toBe('story-014');
  });

  it('never produces a bare Windows-reserved device name as the full slug', () => {
    // git itself performs no such check (confirmed empirically against a real repository) and will
    // happily create a branch literally named "con" — the hash suffix, always present, guarantees the
    // final segment can never be exactly "con", "nul", "aux", "prn", "com1", "lpt1", etc.
    for (const reserved of ['con', 'nul', 'aux', 'prn', 'com1', 'lpt1']) {
      expect(slugifyStepId(reserved)).not.toMatch(/^(con|nul|aux|prn|com\d|lpt\d)$/);
    }
  });

  it('caps the readable portion so a very long step id does not produce an unbounded slug', () => {
    const slug = slugifyStepId('x'.repeat(500));
    expect(slug.length).toBeLessThan(60);
  });
});

describe('laneBranchName', () => {
  it('matches the forge/<runId>/<stepId-slug> pattern, with the slug\'s own hash-suffixed shape', () => {
    expect(laneBranchName('run_01H', 'implement:story-014')).toMatch(
      /^forge\/run_01H\/implement-story-014-[0-9a-f]{8}$/,
    );
  });
});

describe('parseWorktreeBlocks', () => {
  it('parses a worktree with a branch and one without (detached) from a real multi-worktree listing', () => {
    const porcelain =
      'worktree /repo\nHEAD abc123\nbranch refs/heads/main\n\n' +
      'worktree /repo/wt1\nHEAD def456\nbranch refs/heads/forge/run-1/a\n\n' +
      'worktree /repo/wt2\nHEAD abc123\ndetached';
    expect(parseWorktreeBlocks(porcelain)).toEqual([
      { path: '/repo', branch: 'main' },
      { path: '/repo/wt1', branch: 'forge/run-1/a' },
      { path: '/repo/wt2', branch: undefined },
    ]);
  });

  it('silently skips a block with no worktree line at all, rather than throwing', () => {
    // Never actually produced by a real execa-mediated call (execa's own stdout already has the one
    // trailing newline real git output ends with stripped, confirmed empirically), but this parser
    // must not crash a future git version's own format change if one ever did appear — proven directly
    // against a hand-constructed string, the only way to exercise this without a real execa call.
    const porcelain = 'worktree /repo\nHEAD abc123\nbranch refs/heads/main\n\n';
    expect(parseWorktreeBlocks(porcelain)).toEqual([{ path: '/repo', branch: 'main' }]);
  });
});

describe('createLaneWorktree / removeLaneWorktree', () => {
  it('creates a real worktree on a real, correctly-named branch, round-tripping through removal', async () => {
    const cwd = await createTempRepo();
    const handle = await createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'implement:story-014',
      integrationBase: 'HEAD',
    });

    expect(handle.branch).toMatch(/^forge\/run-1\/implement-story-014-[0-9a-f]{8}$/);
    expect(existsSync(handle.path)).toBe(true);
    expect(await branchExistsInRepo(cwd, handle.branch)).toBe(true);

    await removeLaneWorktree(cwd, handle, { retain: false });

    expect(existsSync(handle.path)).toBe(false);
    expect(await branchExistsInRepo(cwd, handle.branch)).toBe(false);
  });

  it('creates the lane checked out at the resolved integration base, not silently at HEAD', async () => {
    const cwd = await createTempRepo();
    const { stdout: firstSha } = await execa('git', ['rev-parse', 'HEAD'], { cwd });
    await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'second'], { cwd });

    const handle = await createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'a',
      integrationBase: firstSha.trim(),
    });

    const { stdout: laneSha } = await execa('git', ['rev-parse', 'HEAD'], { cwd: handle.path });
    expect(laneSha.trim()).toBe(firstSha.trim());
  });

  it('slugifies a stepId containing branch-illegal characters (colons) into a valid, working branch', async () => {
    const cwd = await createTempRepo();
    const handle = await createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'build-stage:implement:STORY-014',
      integrationBase: 'HEAD',
    });

    expect(handle.branch).toMatch(/^forge\/run-1\/build-stage-implement-story-014-[0-9a-f]{8}$/);
    expect(existsSync(handle.path)).toBe(true);
  });

  it('two different step ids that collide on their readable slug prefix get two independent lanes, never one silently reused', async () => {
    const cwd = await createTempRepo();
    const first = await createLaneWorktree(cwd, { runId: 'run-1', stepId: 'STORY-014', integrationBase: 'HEAD' });
    await removeLaneWorktree(cwd, first, { retain: false });

    // The realistic, more dangerous case a gauntlet critic round found: the *first* lane has already
    // completed and been cleaned up before the colliding second one is ever created.
    const second = await createLaneWorktree(cwd, { runId: 'run-1', stepId: 'story:014', integrationBase: 'HEAD' });

    expect(second.laneId).not.toBe(first.laneId);
    expect(second.branch).not.toBe(first.branch);
    expect(existsSync(second.path)).toBe(true);
  });

  it('retain: true leaves both the worktree and the branch in place', async () => {
    const cwd = await createTempRepo();
    const handle = await createLaneWorktree(cwd, { runId: 'run-1', stepId: 'a', integrationBase: 'HEAD' });

    await removeLaneWorktree(cwd, handle, { retain: true });

    expect(existsSync(handle.path)).toBe(true);
    expect(await branchExistsInRepo(cwd, handle.branch)).toBe(true);
  });

  it('removeLaneWorktree is idempotent — calling it a second time on an already-removed lane does not throw', async () => {
    const cwd = await createTempRepo();
    const handle = await createLaneWorktree(cwd, { runId: 'run-1', stepId: 'a', integrationBase: 'HEAD' });

    await removeLaneWorktree(cwd, handle, { retain: false });
    await expect(removeLaneWorktree(cwd, handle, { retain: false })).resolves.toBeUndefined();
  });

  it('recovers from a partial removal — worktree already gone, branch still present — by deleting only the branch', async () => {
    // The exact interrupted-mid-cleanup state a gauntlet critic round constructed: kill the process
    // between the worktree-remove and branch-delete steps of a *previous* removeLaneWorktree call.
    // Simulated directly here by removing the worktree out from under this package, bypassing it.
    const cwd = await createTempRepo();
    const handle = await createLaneWorktree(cwd, { runId: 'run-1', stepId: 'a', integrationBase: 'HEAD' });
    await execa('git', ['worktree', 'remove', '--force', handle.path], { cwd });
    expect(await branchExistsInRepo(cwd, handle.branch)).toBe(true);

    await removeLaneWorktree(cwd, handle, { retain: false });

    expect(await branchExistsInRepo(cwd, handle.branch)).toBe(false);
  });

  it('removes a locked worktree (a human may lock one while inspecting a failed lane, per 06 §6.4 step 4)', async () => {
    const cwd = await createTempRepo();
    const handle = await createLaneWorktree(cwd, { runId: 'run-1', stepId: 'a', integrationBase: 'HEAD' });
    await execa('git', ['worktree', 'lock', handle.path, '--reason', 'inspecting'], { cwd });

    await removeLaneWorktree(cwd, handle, { retain: false });

    expect(existsSync(handle.path)).toBe(false);
    expect(await branchExistsInRepo(cwd, handle.branch)).toBe(false);
  });

  it('rejects with a VcsError, not a raw execa error, when the same (runId, stepId) lane is created twice while the first is still alive', async () => {
    const cwd = await createTempRepo();
    await createLaneWorktree(cwd, { runId: 'run-1', stepId: 'a', integrationBase: 'HEAD' });

    const rejection = createLaneWorktree(cwd, { runId: 'run-1', stepId: 'a', integrationBase: 'HEAD' });
    await expect(rejection).rejects.toBeInstanceOf(VcsError);
    await expect(rejection).rejects.toMatchObject({ code: 'VCS-GIT-OPERATION-FAILED' });
  });

  it('rejects with a VcsError, not a raw execa error, for a nonexistent integration base', async () => {
    const cwd = await createTempRepo();
    const rejection = createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'a',
      integrationBase: 'this-ref-does-not-exist',
    });
    await expect(rejection).rejects.toBeInstanceOf(VcsError);
  });

  it('rejects with a VcsError, not a raw node:fs ENOENT, for a nonexistent cwd', async () => {
    // A gauntlet verify round found resolveCwd's own realpath(cwd) call was not wrapped, leaking a
    // plain Node Error (no .code/.remedy) from exactly the two functions that call it.
    const cwd = path.join(await mkdtemp(path.join(tmpdir(), 'forge-vcs-lanes-')), 'does-not-exist');
    const rejection = createLaneWorktree(cwd, { runId: 'run-1', stepId: 'a', integrationBase: 'HEAD' });
    await expect(rejection).rejects.toBeInstanceOf(VcsError);
  });

  it('rejects a flag-shaped integrationBase rather than silently misinterpreting it as an option', async () => {
    // A gauntlet critic round found that passing a value like "-q" straight through to
    // `git worktree add` as its own trailing <commit-ish> argument was silently consumed as
    // `--quiet` (even behind a `--` separator) rather than erroring — the created lane ended up
    // checked out at HEAD instead of failing, with no signal anything was wrong. This must now fail.
    const cwd = await createTempRepo();
    const rejection = createLaneWorktree(cwd, { runId: 'run-1', stepId: 'a', integrationBase: '-q' });
    await expect(rejection).rejects.toBeInstanceOf(VcsError);

    // And no lane worktree/branch should exist as a side effect of the rejected attempt.
    expect(await listOrphanedWorktrees(cwd)).toEqual([]);
  });
});

describe('listOrphanedWorktrees', () => {
  it('returns an empty list when no forge-managed worktrees exist', async () => {
    const cwd = await createTempRepo();
    expect(await listOrphanedWorktrees(cwd)).toEqual([]);
  });

  it('rejects with a VcsError, not a raw node:fs ENOENT, for a nonexistent cwd', async () => {
    const cwd = path.join(await mkdtemp(path.join(tmpdir(), 'forge-vcs-lanes-')), 'does-not-exist');
    await expect(listOrphanedWorktrees(cwd)).rejects.toBeInstanceOf(VcsError);
  });

  it('finds a forge-managed worktree created directly via a raw git worktree add, bypassing this package entirely', async () => {
    // The whole point of S12 (20 §20.10): a worktree left behind by a since-killed process is
    // discoverable via git's own bookkeeping, never this package's own in-memory state (which a crash
    // would simply lose). Bypassing createLaneWorktree entirely is what actually proves that.
    const cwd = await createTempRepo();
    const target = path.join(cwd, '.forge', 'state', 'worktrees', 'run-1-a-00000000');
    await execa('git', ['worktree', 'add', '-b', 'forge/run-1/a-00000000', target, 'HEAD'], { cwd });

    const orphans = await listOrphanedWorktrees(cwd);
    expect(orphans).toHaveLength(1);
    expect(orphans[0]?.branch).toBe('forge/run-1/a-00000000');
    expect(orphans[0]?.laneId).toBe('run-1-a-00000000');
  });

  it('excludes a worktree whose branch is not in the forge/ namespace — a human\'s own worktree', async () => {
    const cwd = await createTempRepo();
    const target = path.join(cwd, 'human-worktree');
    await execa('git', ['worktree', 'add', '-b', 'my-feature-branch', target, 'HEAD'], { cwd });

    expect(await listOrphanedWorktrees(cwd)).toEqual([]);
  });

  it('excludes a detached-HEAD worktree — no branch line in porcelain output at all, so never forge-managed', async () => {
    const cwd = await createTempRepo();
    const target = path.join(cwd, 'detached-worktree');
    await execa('git', ['worktree', 'add', '--detach', target, 'HEAD'], { cwd });

    expect(await listOrphanedWorktrees(cwd)).toEqual([]);
  });

  it('excludes the main worktree itself, even when a human has checked out a forge/-namespaced branch directly in it', async () => {
    // A gauntlet critic round found this exact false positive: with no explicit "this is the main
    // worktree" marker in porcelain output, a naive branch-namespace-only filter misreports the main
    // worktree as an orphaned lane whenever its own checked-out branch happens to match the pattern.
    const cwd = await createTempRepo();
    await execa('git', ['switch', '-c', 'forge/run-1/oops'], { cwd });

    expect(await listOrphanedWorktrees(cwd)).toEqual([]);
  });

  it('excludes a lane already present in the caller-supplied knownLaneIds set', async () => {
    const cwd = await createTempRepo();
    const handle = await createLaneWorktree(cwd, { runId: 'run-1', stepId: 'a', integrationBase: 'HEAD' });

    expect(await listOrphanedWorktrees(cwd, new Set([handle.laneId]))).toEqual([]);
    expect(await listOrphanedWorktrees(cwd)).toHaveLength(1);
  });
});
