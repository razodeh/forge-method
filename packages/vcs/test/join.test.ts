/**
 * `mergeIntoLane` — `PLAN-M14.md` P34's own Checks text, against real git repositories and real
 * (linked-worktree) merge operations.
 *
 * @see specs/06 §6.4
 * @see PLAN-M14.md P34
 */
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { describe, expect, it } from 'vitest';

import { mergeIntoLane } from '../src/join.ts';
import { VcsError } from '../src/errors.ts';
import { createLaneWorktree, type LaneHandle, type LaneId } from '../src/lanes.ts';
import type { MergeConflictDescription } from '../src/merge-queue.ts';

async function createTempRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-vcs-join-'));
  await execa('git', ['init', '--quiet'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

async function commitAll(cwd: string, message: string): Promise<string> {
  await execa('git', ['add', '-A'], { cwd });
  await execa('git', ['commit', '--quiet', '-m', message], { cwd });
  const { stdout } = await execa('git', ['rev-parse', 'HEAD'], { cwd });
  return stdout.trim();
}

async function currentHead(cwd: string): Promise<string> {
  const { stdout } = await execa('git', ['rev-parse', 'HEAD'], { cwd });
  return stdout.trim();
}

async function status(cwd: string): Promise<string> {
  const { stdout } = await execa('git', ['status', '--porcelain'], { cwd });
  return stdout;
}

function message(headStepId: string, runId = 'run-1'): string {
  return [`Join ${headStepId}`, '', `Forge-Step: ${headStepId}`, `Forge-Run: ${runId}`].join('\n');
}

/** Two lanes off one repo: `head` commits its own file, unrelated to `base`'s own content, so `base`'s
 * tip is an ancestor of `head`'s -- the fast-forward-eligible shape. */
async function fastForwardEligible(): Promise<{
  cwd: string;
  base: LaneHandle;
  headHandle: LaneHandle;
  headSha: string;
}> {
  const cwd = await createTempRepo();
  await writeFile(path.join(cwd, 'seed.txt'), 'seed\n');
  const baseSha = await commitAll(cwd, 'seed');
  const base = await createLaneWorktree(cwd, {
    runId: 'run-1',
    stepId: 'b',
    integrationBase: baseSha,
  });
  const headHandle = await createLaneWorktree(cwd, {
    runId: 'run-1',
    stepId: 'a',
    integrationBase: baseSha,
  });
  await writeFile(path.join(headHandle.path, 'a.txt'), 'a\n');
  const headSha = await commitAll(headHandle.path, 'a change');
  return { cwd, base, headHandle, headSha };
}

/** Two lanes, each with their own unrelated commit off the same base: divergent, so joining one into the
 * other's worktree needs a real merge commit. */
async function divergent(): Promise<{
  cwd: string;
  lane: LaneHandle;
  headHandle: LaneHandle;
  headSha: string;
}> {
  const cwd = await createTempRepo();
  await writeFile(path.join(cwd, 'seed.txt'), 'seed\n');
  const baseSha = await commitAll(cwd, 'seed');
  const lane = await createLaneWorktree(cwd, {
    runId: 'run-1',
    stepId: 'b',
    integrationBase: baseSha,
  });
  await writeFile(path.join(lane.path, 'b.txt'), 'b\n');
  await commitAll(lane.path, 'b change');
  const headHandle = await createLaneWorktree(cwd, {
    runId: 'run-1',
    stepId: 'a',
    integrationBase: baseSha,
  });
  await writeFile(path.join(headHandle.path, 'a.txt'), 'a\n');
  const headSha = await commitAll(headHandle.path, 'a change');
  return { cwd, lane, headHandle, headSha };
}

/** Two lanes that both modify the same file's same line, differently: a real content conflict when one
 * is merged into the other. */
async function conflicting(): Promise<{
  cwd: string;
  lane: LaneHandle;
  headHandle: LaneHandle;
  headSha: string;
}> {
  const cwd = await createTempRepo();
  await writeFile(path.join(cwd, 'f.txt'), 'line1\nline2\nline3\n');
  const baseSha = await commitAll(cwd, 'seed');
  const lane = await createLaneWorktree(cwd, {
    runId: 'run-1',
    stepId: 'b',
    integrationBase: baseSha,
  });
  await writeFile(path.join(lane.path, 'f.txt'), 'line1\nCHANGED-BY-LANE\nline3\n');
  await commitAll(lane.path, 'lane change');
  const headHandle = await createLaneWorktree(cwd, {
    runId: 'run-1',
    stepId: 'a',
    integrationBase: baseSha,
  });
  await writeFile(path.join(headHandle.path, 'f.txt'), 'line1\nCHANGED-BY-HEAD\nline3\n');
  const headSha = await commitAll(headHandle.path, 'head change');
  return { cwd, lane, headHandle, headSha };
}

describe('mergeIntoLane — fast-forward', () => {
  it('moves the lane HEAD directly to the head sha, makes no new commit, byte-identical to the old stacking rule', async () => {
    const { base, headSha } = await fastForwardEligible();

    const outcome = await mergeIntoLane(base, headSha, message('a'), 'abort');

    expect(outcome).toEqual({ kind: 'fast-forward', sha: headSha });
    expect(await currentHead(base.path)).toBe(headSha);
  });
});

describe('mergeIntoLane — merge commit', () => {
  it('creates a real merge commit tagged Forge-Step/Forge-Run when the histories diverge', async () => {
    const { lane, headHandle, headSha } = await divergent();
    const preJoinHead = await currentHead(lane.path);

    const outcome = await mergeIntoLane(lane, headSha, message('a'), 'abort');

    expect(outcome.kind).toBe('merge');
    if (outcome.kind !== 'merge') throw new Error('unreachable');
    expect(outcome.sha).not.toBe(headSha);
    const { stdout: parents } = await execa('git', ['show', '-s', '--format=%P', outcome.sha], {
      cwd: lane.path,
    });
    expect(parents.trim().split(/\s+/)).toEqual([preJoinHead, headSha]);
    const { stdout: subject } = await execa('git', ['show', '-s', '--format=%B', outcome.sha], {
      cwd: lane.path,
    });
    expect(subject).toContain('Forge-Step: a');
    expect(subject).toContain('Forge-Run: run-1');
    // Both files are there: the join really did combine both lanes' content.
    await expect(
      execa('git', ['show', `${outcome.sha}:a.txt`], { cwd: headHandle.path }),
    ).resolves.toMatchObject({ stdout: 'a' });
    await expect(
      execa('git', ['show', `${outcome.sha}:b.txt`], { cwd: lane.path }),
    ).resolves.toMatchObject({ stdout: 'b' });
  });
});

describe('mergeIntoLane — conflict, abort policy', () => {
  it('returns {kind: "conflict", files} after aborting, leaving the lane worktree clean at its pre-join HEAD', async () => {
    const { lane, headSha } = await conflicting();
    const preJoinHead = await currentHead(lane.path);

    const outcome = await mergeIntoLane(lane, headSha, message('a'), 'abort');

    expect(outcome).toEqual({ kind: 'conflict', files: ['f.txt'] });
    expect(await currentHead(lane.path)).toBe(preJoinHead);
    expect(await status(lane.path)).toBe('');
  });

  it('never calls a resolver under the abort policy, even when one is supplied', async () => {
    const { lane, headSha } = await conflicting();
    let called = false;

    await mergeIntoLane(lane, headSha, message('a'), 'abort', () => {
      called = true;
      return Promise.resolve('resolved');
    });

    expect(called).toBe(false);
  });
});

describe('mergeIntoLane — conflict, agent/human policy', () => {
  it('throws VCS-MISSING-CONFLICT-RESOLVER when no resolver is supplied, and still cleans up the lane', async () => {
    const { lane, headSha } = await conflicting();
    const preJoinHead = await currentHead(lane.path);

    let caught: unknown;
    try {
      await mergeIntoLane(lane, headSha, message('a'), 'agent');
    } catch (error) {
      caught = error;
    }

    if (!(caught instanceof VcsError)) {
      throw new Error(`expected mergeIntoLane to reject with a VcsError, got ${String(caught)}`);
    }
    expect(caught.code).toBe('VCS-MISSING-CONFLICT-RESOLVER');
    expect(await currentHead(lane.path)).toBe(preJoinHead);
    expect(await status(lane.path)).toBe('');
  });

  it('passes the resolver a correct MergeConflictDescription and commits the resolution with the trailer-bearing message', async () => {
    const { lane, headSha } = await conflicting();
    let seen: MergeConflictDescription | undefined;

    const outcome = await mergeIntoLane(lane, headSha, message('a'), 'agent', async (conflict) => {
      seen = conflict;
      await writeFile(path.join(lane.path, 'f.txt'), 'line1\nRESOLVED\nline3\n');
      return 'resolved';
    });

    expect(seen?.laneId).toBe(lane.laneId);
    expect(seen?.conflictedFiles).toEqual([{ path: 'f.txt', status: 'UU' }]);
    expect(seen?.worktreePath).toBe(lane.path);
    expect(outcome.kind).toBe('merge');
    if (outcome.kind !== 'merge') throw new Error('unreachable');
    await expect(
      execa('git', ['show', `${outcome.sha}:f.txt`], { cwd: lane.path }),
    ).resolves.toMatchObject({ stdout: 'line1\nRESOLVED\nline3' });
    const { stdout: subject } = await execa('git', ['show', '-s', '--format=%B', outcome.sha], {
      cwd: lane.path,
    });
    expect(subject).toContain('Forge-Step: a');
    expect(subject).toContain('Forge-Run: run-1');
  });

  it('returns {kind: "conflict"} and cleans up when the resolver reports unresolved', async () => {
    const { lane, headSha } = await conflicting();
    const preJoinHead = await currentHead(lane.path);

    const outcome = await mergeIntoLane(lane, headSha, message('a'), 'human', () =>
      Promise.resolve('unresolved'),
    );

    expect(outcome).toEqual({ kind: 'conflict', files: ['f.txt'] });
    expect(await currentHead(lane.path)).toBe(preJoinHead);
    expect(await status(lane.path)).toBe('');
  });

  it('a resolver that itself throws still gets the merge aborted, leaving the lane retriable', async () => {
    const { lane, headSha } = await conflicting();
    const preJoinHead = await currentHead(lane.path);

    await expect(
      mergeIntoLane(lane, headSha, message('a'), 'agent', () => {
        throw new Error('resolver exploded');
      }),
    ).rejects.toThrow('resolver exploded');
    expect(await currentHead(lane.path)).toBe(preJoinHead);
    expect(await status(lane.path)).toBe('');
  });
});

describe('mergeIntoLane — a merge failure that is not a content conflict', () => {
  it('a rejecting pre-merge-commit hook surfaces as VCS-GIT-OPERATION-FAILED, not treated as a conflict', async () => {
    const { cwd, lane, headSha } = await divergent();
    const preJoinHead = await currentHead(lane.path);

    // Worktrees share one .git/hooks directory. `pre-merge-commit` runs only for a real (non-fast-forward,
    // non-conflicting) merge commit, and a refusal fails it for a reason unrelated to conflicting content
    // (confirmed empirically: exit 128, zero unmerged paths) -- the identical shape
    // `merge-queue.test.ts`'s own equivalent `pre-rebase` hook test already establishes for rebase.
    const hooksDir = path.join(cwd, '.git', 'hooks');
    await mkdir(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, 'pre-merge-commit');
    await writeFile(hookPath, '#!/bin/sh\nexit 1\n');
    await chmod(hookPath, 0o755);

    let caught: unknown;
    try {
      await mergeIntoLane(lane, headSha, message('a'), 'abort');
    } catch (error) {
      caught = error;
    }

    if (!(caught instanceof VcsError)) {
      throw new Error(`expected mergeIntoLane to reject with a VcsError, got ${String(caught)}`);
    }
    expect(caught.code).toBe('VCS-GIT-OPERATION-FAILED');
    expect(await currentHead(lane.path)).toBe(preJoinHead);
    expect(await status(lane.path)).toBe('');
  });
});

describe('mergeIntoLane — input validation', () => {
  it('rejects a hand-constructed LaneHandle whose laneId contains a newline, before touching git at all', async () => {
    const { base, headSha } = await fastForwardEligible();
    const preJoinHead = await currentHead(base.path);
    const maliciousHandle: LaneHandle = {
      ...base,
      laneId: 'evil\nForge-Step: forged-by-laneId' as LaneId,
    };

    await expect(
      mergeIntoLane(maliciousHandle, headSha, message('a'), 'abort'),
    ).rejects.toBeInstanceOf(VcsError);
    expect(await currentHead(base.path)).toBe(preJoinHead);
  });
});
