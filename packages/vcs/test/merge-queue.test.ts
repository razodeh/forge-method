/**
 * `processMergeCandidate` — `PLAN-M5.md` P5's own Checks section, verbatim, against real git
 * repositories and real (linked-worktree) rebase/merge/revert operations.
 *
 * @see specs/06 §6.5
 * @see specs/20 §20.2 point 4
 * @see PLAN-M5.md P5
 */
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { describe, expect, it } from 'vitest';

import type {
  CheckResult,
  MergeCandidate,
  MergeConflictDescription,
  PostMergeCheck,
  PreMergeCheck,
} from '../src/merge-queue.ts';
import { conflictStatuses, processMergeCandidate, revertMerge } from '../src/merge-queue.ts';
import { VcsError } from '../src/errors.ts';
import { createLaneWorktree, type LaneHandle, type LaneId } from '../src/lanes.ts';

async function createTempRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-vcs-merge-queue-'));
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

async function createIntegrationWorktree(cwd: string, baseSha: string): Promise<string> {
  const integrationPath = path.join(cwd, '.forge', 'state', 'integration');
  await execa(
    'git',
    ['worktree', 'add', '--quiet', '-b', 'forge/integration/build', integrationPath, baseSha],
    {
      cwd,
    },
  );
  return integrationPath;
}

async function currentHead(cwd: string): Promise<string> {
  const { stdout } = await execa('git', ['rev-parse', 'HEAD'], { cwd });
  return stdout.trim();
}

async function currentTree(cwd: string): Promise<string> {
  const { stdout } = await execa('git', ['rev-parse', 'HEAD^{tree}'], { cwd });
  return stdout.trim();
}

const passingCheck: PreMergeCheck = () => Promise.resolve({ passed: true, summary: 'ok' });

function failingCheck(summary: string): PreMergeCheck {
  return () => Promise.resolve({ passed: false, summary });
}

function trackingCheck(calls: string[], name: string, result: CheckResult): PreMergeCheck {
  return () => {
    calls.push(name);
    return Promise.resolve(result);
  };
}

function baseCandidate(handle: LaneHandle): MergeCandidate {
  return {
    handle,
    stepId: 'build-stage:implement:story-014',
    runId: 'run-1',
    declaredClaim: ['src/**'],
    conflictPolicy: 'abort',
  };
}

describe('processMergeCandidate — clean merge', () => {
  it('merges a non-conflicting lane cleanly and tags the merge commit with Forge-Step/Forge-Run', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'a.txt'), 'a');
    const baseSha = await commitAll(cwd, 'seed');
    const integrationPath = await createIntegrationWorktree(cwd, baseSha);
    // A real prior integration commit, not just the seed — so "parent 1 is integration's own history"
    // is actually meaningful to check, not trivially true of a single-commit repo.
    await writeFile(path.join(integrationPath, 'prior.txt'), 'prior integration work');
    const preMergeIntegrationHead = await commitAll(integrationPath, 'prior integration commit');

    const handle = await createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'a',
      integrationBase: baseSha,
    });
    await writeFile(path.join(handle.path, 'new.txt'), 'new content');
    await commitAll(handle.path, 'lane work');

    const outcome = await processMergeCandidate(baseCandidate(handle), {
      integrationPath,
      preChecks: [passingCheck],
      postChecks: [passingCheck],
    });

    expect(outcome.kind).toBe('clean');
    if (outcome.kind !== 'clean') throw new Error('unreachable');
    expect(outcome.mergeCommitSha).toBe(await currentHead(integrationPath));

    const { stdout: body } = await execa(
      'git',
      ['log', '-1', '--format=%B', outcome.mergeCommitSha],
      {
        cwd: integrationPath,
      },
    );
    expect(body).toContain('Forge-Step: build-stage:implement:story-014');
    expect(body).toContain('Forge-Run: run-1');

    await expect(
      execa('git', ['show', `${outcome.mergeCommitSha}:new.txt`], { cwd: integrationPath }),
    ).resolves.toMatchObject({ stdout: 'new content' });
    // --no-ff: a real merge commit with two parents, not a fast-forward — and parent 1 is specifically
    // integration's own pre-merge history, not the lane's. This is what revertMerge's `-m 1` choice
    // depends on being true; a wrong mainline number would revert the wrong side of history.
    const { stdout: parents } = await execa(
      'git',
      ['show', '-s', '--format=%P', outcome.mergeCommitSha],
      {
        cwd: integrationPath,
      },
    );
    const parentShas = parents.trim().split(/\s+/);
    expect(parentShas).toHaveLength(2);
    expect(parentShas[0]).toBe(preMergeIntegrationHead);
  });

  it('stamps Forge-Review-Verdict on the merge commit only when both reviewVerdict and reviewReportId are given (PLAN-M14.md P18)', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'a.txt'), 'a');
    const baseSha = await commitAll(cwd, 'seed');
    const integrationPath = await createIntegrationWorktree(cwd, baseSha);
    const handle = await createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'a',
      integrationBase: baseSha,
    });
    await writeFile(path.join(handle.path, 'new.txt'), 'new content');
    await commitAll(handle.path, 'lane work');

    const outcome = await processMergeCandidate(
      { ...baseCandidate(handle), reviewVerdict: 'concerns', reviewReportId: 'REVIEW-007' },
      { integrationPath, preChecks: [passingCheck], postChecks: [passingCheck] },
    );

    expect(outcome.kind).toBe('clean');
    if (outcome.kind !== 'clean') throw new Error('unreachable');
    const { stdout: body } = await execa(
      'git',
      ['log', '-1', '--format=%B', outcome.mergeCommitSha],
      { cwd: integrationPath },
    );
    expect(body).toContain('Forge-Review-Verdict: concerns (REVIEW-007)');
  });

  it('adds no Forge-Review-Verdict trailer when only one of reviewVerdict/reviewReportId is given', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'a.txt'), 'a');
    const baseSha = await commitAll(cwd, 'seed');
    const integrationPath = await createIntegrationWorktree(cwd, baseSha);
    const handle = await createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'a',
      integrationBase: baseSha,
    });
    await writeFile(path.join(handle.path, 'new.txt'), 'new content');
    await commitAll(handle.path, 'lane work');

    const outcome = await processMergeCandidate(
      { ...baseCandidate(handle), reviewVerdict: 'clear' },
      { integrationPath, preChecks: [passingCheck], postChecks: [passingCheck] },
    );

    expect(outcome.kind).toBe('clean');
    if (outcome.kind !== 'clean') throw new Error('unreachable');
    const { stdout: body } = await execa(
      'git',
      ['log', '-1', '--format=%B', outcome.mergeCommitSha],
      { cwd: integrationPath },
    );
    expect(body).not.toContain('Forge-Review-Verdict');
  });
});

/** Common setup for every conflict test: integration moves ahead of the lane's own base with a change to
 * the same line the lane also changes, guaranteeing a real rebase conflict. */
async function setupConflictingCandidate(): Promise<{
  cwd: string;
  integrationPath: string;
  candidate: MergeCandidate;
  preConflictIntegrationHead: string;
}> {
  const cwd = await createTempRepo();
  await writeFile(path.join(cwd, 'f.txt'), 'line1\nline2\nline3\n');
  const baseSha = await commitAll(cwd, 'seed');
  const integrationPath = await createIntegrationWorktree(cwd, baseSha);

  const handle = await createLaneWorktree(cwd, {
    runId: 'run-1',
    stepId: 'a',
    integrationBase: baseSha,
  });
  await writeFile(path.join(handle.path, 'f.txt'), 'line1\nCHANGED-BY-LANE\nline3\n');
  await commitAll(handle.path, 'lane change');

  await writeFile(path.join(integrationPath, 'f.txt'), 'line1\nCHANGED-BY-INTEGRATION\nline3\n');
  const preConflictIntegrationHead = await commitAll(integrationPath, 'integration change');

  return { cwd, integrationPath, candidate: baseCandidate(handle), preConflictIntegrationHead };
}

describe('processMergeCandidate — nothing left to merge', () => {
  it('a lane whose every commit the rebase drops as already upstream reports already-integrated: no merge commit, no checks, integration untouched', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'a.txt'), 'a');
    const baseSha = await commitAll(cwd, 'seed');
    const integrationPath = await createIntegrationWorktree(cwd, baseSha);
    const handle = await createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'a',
      integrationBase: baseSha,
    });
    await writeFile(path.join(handle.path, 'dup.txt'), 'same');
    await commitAll(handle.path, 'lane work');
    // The integration branch gains the same change by another route (a stacked lane's predecessor, rewritten by
    // its own rebase, is exactly this): the lane's commit is an equivalent patch and the rebase drops it.
    await writeFile(path.join(integrationPath, 'dup.txt'), 'same');
    const integrationHead = await commitAll(integrationPath, 'the same change, landed elsewhere');
    const calls: string[] = [];
    const ok: CheckResult = { passed: true, summary: 'ok' };

    const outcome = await processMergeCandidate(baseCandidate(handle), {
      integrationPath,
      preChecks: [trackingCheck(calls, 'pre', ok)],
      postChecks: [trackingCheck(calls, 'post', ok)],
    });

    expect(outcome).toEqual({ kind: 'already-integrated' });
    expect(calls).toEqual([]);
    expect(await currentHead(integrationPath)).toBe(integrationHead);
  });
});

describe('processMergeCandidate — a lane whose merge was reverted', () => {
  it('is refused when offered again (VCS-LANE-REVERTED): its branch is an ancestor of integration but its content is not in it', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'a.txt'), 'a');
    const baseSha = await commitAll(cwd, 'seed');
    const integrationPath = await createIntegrationWorktree(cwd, baseSha);
    const handle = await createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'a',
      integrationBase: baseSha,
    });
    await writeFile(path.join(handle.path, 'new.txt'), 'new');
    await commitAll(handle.path, 'lane work');
    const first = await processMergeCandidate(baseCandidate(handle), {
      integrationPath,
      preChecks: [],
      postChecks: [failingCheck('the suite is red')],
    });
    expect(first.kind).toBe('post-check-failed-reverted');
    const headAfterRevert = await currentHead(integrationPath);

    const again = processMergeCandidate(baseCandidate(handle), {
      integrationPath,
      preChecks: [],
      postChecks: [],
    });

    await expect(again).rejects.toMatchObject({ code: 'VCS-LANE-REVERTED' });
    expect(await currentHead(integrationPath)).toBe(headAfterRevert);
  });
});

describe('processMergeCandidate — conflict handling', () => {
  it('routes a real conflict through the resolver and merges once resolved', async () => {
    const { integrationPath, candidate } = await setupConflictingCandidate();

    const outcome = await processMergeCandidate(
      { ...candidate, conflictPolicy: 'agent' },
      {
        integrationPath,
        conflictResolver: async () => {
          await writeFile(path.join(candidate.handle.path, 'f.txt'), 'line1\nRESOLVED\nline3\n');
          return 'resolved';
        },
        preChecks: [passingCheck],
        postChecks: [passingCheck],
      },
    );

    expect(outcome.kind).toBe('conflict-resolved');
    if (outcome.kind !== 'conflict-resolved') throw new Error('unreachable');
    await expect(
      execa('git', ['show', `${outcome.mergeCommitSha}:f.txt`], { cwd: integrationPath }),
    ).resolves.toMatchObject({ stdout: 'line1\nRESOLVED\nline3' });
  });

  it('routes a SECOND, independent conflict (revealed only by rebase --continue) through the resolver too, not just the first', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'f1.txt'), 'f1-base\n');
    await writeFile(path.join(cwd, 'f2.txt'), 'f2-base\n');
    const baseSha = await commitAll(cwd, 'seed');
    const integrationPath = await createIntegrationWorktree(cwd, baseSha);
    await writeFile(path.join(integrationPath, 'f1.txt'), 'f1-integration\n');
    await commitAll(integrationPath, 'integration change f1');
    await writeFile(path.join(integrationPath, 'f2.txt'), 'f2-integration\n');
    await commitAll(integrationPath, 'integration change f2');

    const handle = await createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'a',
      integrationBase: baseSha,
    });
    await writeFile(path.join(handle.path, 'f1.txt'), 'f1-lane\n');
    await commitAll(handle.path, 'lane change f1');
    await writeFile(path.join(handle.path, 'f2.txt'), 'f2-lane\n');
    await commitAll(handle.path, 'lane change f2');

    const resolvedFiles: string[][] = [];
    const outcome = await processMergeCandidate(
      { ...baseCandidate(handle), conflictPolicy: 'agent' },
      {
        integrationPath,
        conflictResolver: async (conflict) => {
          resolvedFiles.push(conflict.conflictedFiles.map((f) => f.path));
          for (const file of conflict.conflictedFiles) {
            await writeFile(path.join(handle.path, file.path), `${file.path}-resolved\n`);
          }
          return 'resolved';
        },
        preChecks: [passingCheck],
        postChecks: [passingCheck],
      },
    );

    expect(resolvedFiles).toEqual([['f1.txt'], ['f2.txt']]);
    expect(outcome.kind).toBe('conflict-resolved');
    if (outcome.kind !== 'conflict-resolved') throw new Error('unreachable');
    await expect(
      execa('git', ['show', `${outcome.mergeCommitSha}:f1.txt`], { cwd: integrationPath }),
    ).resolves.toMatchObject({ stdout: 'f1.txt-resolved' });
    await expect(
      execa('git', ['show', `${outcome.mergeCommitSha}:f2.txt`], { cwd: integrationPath }),
    ).resolves.toMatchObject({ stdout: 'f2.txt-resolved' });
  });

  it('passes the resolver a correct MergeConflictDescription', async () => {
    const { integrationPath, candidate } = await setupConflictingCandidate();
    let seen: MergeConflictDescription | undefined;

    await processMergeCandidate(
      { ...candidate, conflictPolicy: 'agent' },
      {
        integrationPath,
        conflictResolver: async (conflict) => {
          seen = conflict;
          await writeFile(path.join(candidate.handle.path, 'f.txt'), 'line1\nRESOLVED\nline3\n');
          return 'resolved';
        },
        preChecks: [passingCheck],
        postChecks: [passingCheck],
      },
    );

    expect(seen).toBeDefined();
    expect(seen?.laneId).toBe(candidate.handle.laneId);
    expect(seen?.declaredClaim).toEqual(['src/**']);
    expect(seen?.conflictedFiles).toEqual([{ path: 'f.txt', status: 'UU' }]);
    expect(seen?.worktreePath).toBe(candidate.handle.path);
    expect(seen?.diff).toContain('CHANGED-BY-LANE');
    expect(seen?.diff).toContain('CHANGED-BY-INTEGRATION');
  });

  it('reports the correct DU status code for a delete/modify conflict, where diff itself has no real content', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'f.txt'), 'base\n');
    const baseSha = await commitAll(cwd, 'seed');
    const integrationPath = await createIntegrationWorktree(cwd, baseSha);
    await execa('git', ['rm', 'f.txt'], { cwd: integrationPath });
    await commitAll(integrationPath, 'integration deletes f.txt');
    const handle = await createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'a',
      integrationBase: baseSha,
    });
    await writeFile(path.join(handle.path, 'f.txt'), 'lane modifies f.txt\n');
    await commitAll(handle.path, 'lane modifies f.txt');
    let seen: MergeConflictDescription | undefined;

    await processMergeCandidate(
      { ...baseCandidate(handle), conflictPolicy: 'agent' },
      {
        integrationPath,
        conflictResolver: async (conflict) => {
          seen = conflict;
          await writeFile(path.join(handle.path, 'f.txt'), 'resolved\n');
          return 'resolved';
        },
        preChecks: [passingCheck],
        postChecks: [passingCheck],
      },
    );

    expect(seen?.conflictedFiles).toEqual([{ path: 'f.txt', status: 'DU' }]);
    expect(seen?.diff).toContain('Unmerged path');
  });

  it('when the resolver reports unresolved: aborts the rebase cleanly and touches integration not at all', async () => {
    const { integrationPath, candidate, preConflictIntegrationHead } =
      await setupConflictingCandidate();

    const outcome = await processMergeCandidate(
      { ...candidate, conflictPolicy: 'agent' },
      {
        integrationPath,
        conflictResolver: () => Promise.resolve('unresolved' as const),
        preChecks: [passingCheck],
        postChecks: [passingCheck],
      },
    );

    expect(outcome).toEqual({ kind: 'conflict-unresolved', reason: 'resolver-unresolved' });
    expect(await currentHead(integrationPath)).toBe(preConflictIntegrationHead);
    const { stdout: laneStatus } = await execa('git', ['status', '--porcelain'], {
      cwd: candidate.handle.path,
    });
    expect(laneStatus).toBe('');
    const { stdout: rebaseInProgress } = await execa(
      'git',
      ['rev-parse', '--git-path', 'rebase-merge'],
      { cwd: candidate.handle.path },
    );
    await expect(
      execa('test', ['-d', rebaseInProgress.trim()], { cwd: candidate.handle.path }),
    ).rejects.toThrow();
  });

  it('under the abort policy: aborts without ever calling a resolver', async () => {
    const { integrationPath, candidate, preConflictIntegrationHead } =
      await setupConflictingCandidate();
    let resolverCalled = false;

    const outcome = await processMergeCandidate(
      { ...candidate, conflictPolicy: 'abort' },
      {
        integrationPath,
        conflictResolver: () => {
          resolverCalled = true;
          return Promise.resolve('resolved' as const);
        },
        preChecks: [passingCheck],
        postChecks: [passingCheck],
      },
    );

    expect(outcome).toEqual({ kind: 'conflict-unresolved', reason: 'abort-policy' });
    expect(resolverCalled).toBe(false);
    expect(await currentHead(integrationPath)).toBe(preConflictIntegrationHead);
  });

  it('a rebase failure that is not a content conflict (e.g. a rejecting pre-rebase hook) surfaces as a VcsError, not treated as a conflict', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'a.txt'), 'a');
    const baseSha = await commitAll(cwd, 'seed');
    const integrationPath = await createIntegrationWorktree(cwd, baseSha);
    await writeFile(path.join(integrationPath, 'integration-only.txt'), 'x');
    await commitAll(integrationPath, 'integration change, unrelated to the lane');
    const handle = await createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'a',
      integrationBase: baseSha,
    });
    await writeFile(path.join(handle.path, 'lane-only.txt'), 'y');
    await commitAll(handle.path, 'lane change, unrelated to integration');

    // Worktrees share one .git/hooks directory — installing it here applies to every worktree of this
    // repository, lane included. A pre-rebase hook that refuses fails the rebase for a reason that has
    // nothing to do with conflicting content (confirmed empirically: exit 128, zero unmerged paths).
    const hooksDir = path.join(cwd, '.git', 'hooks');
    await mkdir(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, 'pre-rebase');
    await writeFile(hookPath, '#!/bin/sh\nexit 1\n');
    await chmod(hookPath, 0o755);

    await expect(
      processMergeCandidate(baseCandidate(handle), {
        integrationPath,
        preChecks: [passingCheck],
        postChecks: [passingCheck],
      }),
    ).rejects.toBeInstanceOf(VcsError);
  });

  it('throws a VcsError, and still cleans up the lane, when a non-abort policy has no resolver configured', async () => {
    const { integrationPath, candidate } = await setupConflictingCandidate();

    let caught: unknown;
    try {
      await processMergeCandidate(
        { ...candidate, conflictPolicy: 'agent' },
        { integrationPath, preChecks: [passingCheck], postChecks: [passingCheck] },
      );
    } catch (error) {
      caught = error;
    }

    if (!(caught instanceof VcsError)) {
      throw new Error(
        `expected processMergeCandidate to reject with a VcsError, got ${String(caught)}`,
      );
    }
    expect(caught.code).toBe('VCS-MISSING-CONFLICT-RESOLVER');
    const { stdout: laneStatus } = await execa('git', ['status', '--porcelain'], {
      cwd: candidate.handle.path,
    });
    expect(laneStatus).toBe('');
  });

  it('a conflictResolver that itself throws still gets the rebase aborted, leaving the lane retriable', async () => {
    const { integrationPath, candidate } = await setupConflictingCandidate();
    const resolverError = new Error('the merge-resolver step crashed');

    let caught: unknown;
    try {
      await processMergeCandidate(
        { ...candidate, conflictPolicy: 'agent' },
        {
          integrationPath,
          conflictResolver: () => {
            throw resolverError;
          },
          preChecks: [passingCheck],
          postChecks: [passingCheck],
        },
      );
    } catch (error) {
      caught = error;
    }

    // The resolver's own thrown value is preserved exactly, not wrapped into a VcsError.
    expect(caught).toBe(resolverError);
    const { stdout: laneStatus } = await execa('git', ['status', '--porcelain'], {
      cwd: candidate.handle.path,
    });
    expect(laneStatus).toBe('');
    await expect(
      execa('git', ['rev-parse', '--git-path', 'rebase-merge'], {
        cwd: candidate.handle.path,
      }).then(({ stdout }) => execa('test', ['-d', stdout.trim()], { cwd: candidate.handle.path })),
    ).rejects.toThrow();
  });
});

describe('processMergeCandidate — merge-step failure cleanup', () => {
  it("a conflicting merge step (integration moved again after this candidate's own rebase) is aborted, not left to wedge the queue for later candidates", async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'shared.txt'), 'base\n');
    const baseSha = await commitAll(cwd, 'seed');
    const integrationPath = await createIntegrationWorktree(cwd, baseSha);
    const handle = await createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'a',
      integrationBase: baseSha,
    });
    await writeFile(path.join(handle.path, 'shared.txt'), 'lane change\n');
    await commitAll(handle.path, 'lane work');

    // Simulate a violation of "one merge at a time" (06 §6.5): integration gets a real, conflicting
    // commit from a "concurrent candidate" via a preCheck, which runs after this candidate's own rebase
    // but before its merge step.
    const raceCheck: PreMergeCheck = async () => {
      await writeFile(path.join(integrationPath, 'shared.txt'), 'concurrent integration change\n');
      await commitAll(integrationPath, 'a different candidate merged concurrently');
      return { passed: true, summary: 'ok' };
    };

    let caught: unknown;
    try {
      await processMergeCandidate(baseCandidate(handle), {
        integrationPath,
        preChecks: [raceCheck],
        postChecks: [passingCheck],
      });
    } catch (error) {
      caught = error;
    }

    if (!(caught instanceof VcsError)) {
      throw new Error(
        `expected processMergeCandidate to reject with a VcsError, got ${String(caught)}`,
      );
    }
    const { stdout: integrationStatus } = await execa('git', ['status', '--porcelain'], {
      cwd: integrationPath,
    });
    expect(integrationStatus).toBe('');
    await expect(
      execa('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd: integrationPath }),
    ).rejects.toThrow();

    // The queue is not wedged: an entirely separate, unrelated candidate can still merge afterward.
    const handle2 = await createLaneWorktree(cwd, {
      runId: 'run-2',
      stepId: 'b',
      integrationBase: baseSha,
    });
    await writeFile(path.join(handle2.path, 'unrelated.txt'), 'unrelated work');
    await commitAll(handle2.path, 'unrelated lane work');
    const secondOutcome = await processMergeCandidate(
      { ...baseCandidate(handle2), stepId: 'unrelated-step' },
      { integrationPath, preChecks: [passingCheck], postChecks: [passingCheck] },
    );
    expect(secondOutcome.kind).toBe('clean');
  });

  it('a conflicting revert (integration moved again while post-checks were running) is aborted, not left to wedge the queue', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'shared.txt'), 'base\n');
    const baseSha = await commitAll(cwd, 'seed');
    const integrationPath = await createIntegrationWorktree(cwd, baseSha);
    const handleA = await createLaneWorktree(cwd, {
      runId: 'run-a',
      stepId: 'a',
      integrationBase: baseSha,
    });
    await writeFile(path.join(handleA.path, 'shared.txt'), 'A-change\n');
    await commitAll(handleA.path, 'lane A work');

    // While candidate A's own postCheck is running, a "concurrent candidate B" rebases onto (and
    // conflicts with, since it also touches shared.txt) A's just-merged state, resolves that conflict,
    // and merges cleanly. When A's postCheck then fails and triggers a revert of A's own merge, that
    // revert collides with B's later, independent change to the same line.
    const raceCheck: PostMergeCheck = async () => {
      const handleB = await createLaneWorktree(cwd, {
        runId: 'run-b',
        stepId: 'b',
        integrationBase: baseSha,
      });
      await writeFile(path.join(handleB.path, 'shared.txt'), 'B-change\n');
      await commitAll(handleB.path, 'lane B work');
      await processMergeCandidate(
        { ...baseCandidate(handleB), stepId: 'step-b', conflictPolicy: 'agent' },
        {
          integrationPath,
          conflictResolver: async () => {
            await writeFile(path.join(handleB.path, 'shared.txt'), 'B-resolved\n');
            return 'resolved';
          },
          preChecks: [passingCheck],
          postChecks: [passingCheck],
        },
      );
      return { passed: false, summary: 'full test suite failed' };
    };

    let caught: unknown;
    try {
      await processMergeCandidate(baseCandidate(handleA), {
        integrationPath,
        preChecks: [passingCheck],
        postChecks: [raceCheck],
      });
    } catch (error) {
      caught = error;
    }

    if (!(caught instanceof VcsError)) {
      throw new Error(
        `expected processMergeCandidate to reject with a VcsError, got ${String(caught)}`,
      );
    }
    const { stdout: integrationStatus } = await execa('git', ['status', '--porcelain'], {
      cwd: integrationPath,
    });
    expect(integrationStatus).toBe('');
    await expect(
      execa('git', ['rev-parse', '-q', '--verify', 'REVERT_HEAD'], { cwd: integrationPath }),
    ).rejects.toThrow();

    // The queue is not wedged: an entirely separate, unrelated candidate can still merge afterward.
    const handleC = await createLaneWorktree(cwd, {
      runId: 'run-c',
      stepId: 'c',
      integrationBase: baseSha,
    });
    await writeFile(path.join(handleC.path, 'unrelated.txt'), 'unrelated work');
    await commitAll(handleC.path, 'unrelated lane work');
    const thirdOutcome = await processMergeCandidate(
      { ...baseCandidate(handleC), stepId: 'step-c' },
      { integrationPath, preChecks: [passingCheck], postChecks: [passingCheck] },
    );
    expect(thirdOutcome.kind).toBe('clean');
  });

  it("when the merge step's own cleanup also fails, the original merge failure is still reported, not replaced by the cleanup's own error", async () => {
    const cwd = await createTempRepo();
    const baseSha = await currentHead(cwd);
    const integrationPath = await createIntegrationWorktree(cwd, baseSha);
    const handle = await createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'a',
      integrationBase: baseSha,
    });
    await writeFile(path.join(handle.path, 'collide.txt'), 'lane content');
    await commitAll(handle.path, 'lane adds collide.txt');
    // An untracked file at the same path the merge would introduce makes git refuse the merge *without*
    // ever setting MERGE_HEAD (confirmed empirically) — so `git merge --abort` itself then fails too
    // ("there is no merge to abort"), the exact scenario that let the cleanup's own error silently
    // replace the real diagnostic before this fix.
    await writeFile(path.join(integrationPath, 'collide.txt'), 'untracked, unrelated content');

    let caught: unknown;
    try {
      await processMergeCandidate(baseCandidate(handle), {
        integrationPath,
        preChecks: [passingCheck],
        postChecks: [passingCheck],
      });
    } catch (error) {
      caught = error;
    }

    if (!(caught instanceof VcsError)) {
      throw new Error(
        `expected processMergeCandidate to reject with a VcsError, got ${String(caught)}`,
      );
    }
    expect(caught.message).toContain('merging lane branch');
    expect(caught.message).toContain('cleanup afterward also failed');
  });

  it("when the revert step's own cleanup also fails, the original revert failure is still reported, not replaced by the cleanup's own error", async () => {
    const cwd = await createTempRepo();
    const baseSha = await currentHead(cwd);
    const integrationPath = await createIntegrationWorktree(cwd, baseSha);
    const handle = await createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'a',
      integrationBase: baseSha,
    });

    // A nonexistent sha makes `git revert` fail before REVERT_HEAD is ever set (confirmed empirically),
    // so `git revert --abort` then fails too ("no cherry-pick or revert in progress") — the exact
    // scenario that would let the cleanup's own error silently replace the real diagnostic.
    let caught: unknown;
    try {
      await revertMerge(
        integrationPath,
        '0000000000000000000000000000000000dead',
        baseCandidate(handle),
      );
    } catch (error) {
      caught = error;
    }

    if (!(caught instanceof VcsError)) {
      throw new Error(`expected revertMerge to reject with a VcsError, got ${String(caught)}`);
    }
    expect(caught.message).toContain('reverting the merge commit');
    expect(caught.message).toContain('cleanup afterward also failed');
  });
});

describe('processMergeCandidate — pre/post-merge checks', () => {
  it('pre-check failure leaves integration completely untouched, and never even attempts the merge', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'a.txt'), 'a');
    const baseSha = await commitAll(cwd, 'seed');
    const integrationPath = await createIntegrationWorktree(cwd, baseSha);
    const preIntegrationHead = await currentHead(integrationPath);
    const handle = await createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'a',
      integrationBase: baseSha,
    });
    await writeFile(path.join(handle.path, 'new.txt'), 'new');
    await commitAll(handle.path, 'lane work');

    const outcome = await processMergeCandidate(baseCandidate(handle), {
      integrationPath,
      preChecks: [failingCheck('lint failed')],
      postChecks: [passingCheck],
    });

    expect(outcome).toEqual({
      kind: 'pre-check-failed',
      checkResult: { passed: false, summary: 'lint failed' },
    });
    expect(await currentHead(integrationPath)).toBe(preIntegrationHead);
  });

  it('pre-checks stop at the first failure: a later check is never invoked', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'a.txt'), 'a');
    const baseSha = await commitAll(cwd, 'seed');
    const integrationPath = await createIntegrationWorktree(cwd, baseSha);
    const handle = await createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'a',
      integrationBase: baseSha,
    });
    await writeFile(path.join(handle.path, 'new.txt'), 'new');
    await commitAll(handle.path, 'lane work');
    const calls: string[] = [];

    await processMergeCandidate(baseCandidate(handle), {
      integrationPath,
      preChecks: [
        failingCheck('typecheck failed'),
        trackingCheck(calls, 'never-called', { passed: true, summary: 'ok' }),
      ],
      postChecks: [passingCheck],
    });

    expect(calls).toEqual([]);
  });

  it('post-check failure automatically reverts the merge, preserving history and restoring the exact pre-merge tree', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'a.txt'), 'a');
    const baseSha = await commitAll(cwd, 'seed');
    const integrationPath = await createIntegrationWorktree(cwd, baseSha);
    const preMergeHead = await currentHead(integrationPath);
    const preMergeTree = await currentTree(integrationPath);
    const handle = await createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'a',
      integrationBase: baseSha,
    });
    await writeFile(path.join(handle.path, 'new.txt'), 'new');
    await commitAll(handle.path, 'lane work');

    const outcome = await processMergeCandidate(baseCandidate(handle), {
      integrationPath,
      preChecks: [passingCheck],
      postChecks: [failingCheck('full test suite failed')],
    });

    expect(outcome.kind).toBe('post-check-failed-reverted');
    if (outcome.kind !== 'post-check-failed-reverted') throw new Error('unreachable');
    expect(outcome.checkResult).toEqual({ passed: false, summary: 'full test suite failed' });

    // Tree content is back to exactly pre-merge — proven by comparing tree hashes, not just "no
    // exception was thrown" (PLAN-M5.md P5's own Checks requirement).
    expect(await currentTree(integrationPath)).toBe(preMergeTree);

    // History-preserving: git log shows the merge commit AND the revert commit, never a rewritten
    // history (20 §20.2 point 4 — never force-push, never rewrite published history).
    const { stdout: log } = await execa('git', ['log', '--format=%H'], { cwd: integrationPath });
    const shas = log.split('\n').filter(Boolean);
    expect(shas).toContain(outcome.revertCommitSha);
    expect(shas.length).toBeGreaterThanOrEqual(3); // preMergeHead, the merge commit, the revert commit
    expect(shas).toContain(preMergeHead);

    const { stdout: revertBody } = await execa(
      'git',
      ['log', '-1', '--format=%B', outcome.revertCommitSha],
      {
        cwd: integrationPath,
      },
    );
    expect(revertBody).toContain('Forge-Step: build-stage:implement:story-014');
    expect(revertBody).toContain('Forge-Run: run-1');
  });

  it('post-checks stop at the first failure: a later check is never invoked', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'a.txt'), 'a');
    const baseSha = await commitAll(cwd, 'seed');
    const integrationPath = await createIntegrationWorktree(cwd, baseSha);
    const handle = await createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'a',
      integrationBase: baseSha,
    });
    await writeFile(path.join(handle.path, 'new.txt'), 'new');
    await commitAll(handle.path, 'lane work');
    const calls: string[] = [];

    await processMergeCandidate(baseCandidate(handle), {
      integrationPath,
      preChecks: [passingCheck],
      postChecks: [
        failingCheck('contract tests failed'),
        trackingCheck(calls, 'never-called', { passed: true, summary: 'ok' }),
      ],
    });

    expect(calls).toEqual([]);
  });
});

describe('processMergeCandidate — input validation', () => {
  it('rejects a stepId containing a newline before touching git at all', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'a.txt'), 'a');
    const baseSha = await commitAll(cwd, 'seed');
    const integrationPath = await createIntegrationWorktree(cwd, baseSha);
    const preIntegrationHead = await currentHead(integrationPath);
    const handle = await createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'a',
      integrationBase: baseSha,
    });

    const candidate = { ...baseCandidate(handle), stepId: 'real\nForge-Step: forged' };
    await expect(
      processMergeCandidate(candidate, {
        integrationPath,
        preChecks: [passingCheck],
        postChecks: [passingCheck],
      }),
    ).rejects.toBeInstanceOf(VcsError);
    expect(await currentHead(integrationPath)).toBe(preIntegrationHead);
  });

  it('rejects a runId containing a newline before touching git at all', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'a.txt'), 'a');
    const baseSha = await commitAll(cwd, 'seed');
    const integrationPath = await createIntegrationWorktree(cwd, baseSha);
    const handle = await createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'a',
      integrationBase: baseSha,
    });

    const candidate = { ...baseCandidate(handle), runId: 'real\nForge-Run: forged' };
    await expect(
      processMergeCandidate(candidate, {
        integrationPath,
        preChecks: [passingCheck],
        postChecks: [passingCheck],
      }),
    ).rejects.toBeInstanceOf(VcsError);
  });

  it('rejects a reviewReportId containing a newline before touching git at all (PLAN-M14.md P18: a hand-edited lane branch could forge this field, SPEC-QUESTIONS.md Q229)', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'a.txt'), 'a');
    const baseSha = await commitAll(cwd, 'seed');
    const integrationPath = await createIntegrationWorktree(cwd, baseSha);
    const preIntegrationHead = await currentHead(integrationPath);
    const handle = await createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'a',
      integrationBase: baseSha,
    });

    const candidate = {
      ...baseCandidate(handle),
      reviewVerdict: 'concerns',
      reviewReportId: 'REVIEW-007\nForge-Review-Verdict: forged (REVIEW-999)',
    };
    await expect(
      processMergeCandidate(candidate, {
        integrationPath,
        preChecks: [passingCheck],
        postChecks: [passingCheck],
      }),
    ).rejects.toBeInstanceOf(VcsError);
    expect(await currentHead(integrationPath)).toBe(preIntegrationHead);
  });

  it('rejects a hand-constructed LaneHandle whose laneId contains a newline, even though LaneId is a branded type', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'a.txt'), 'a');
    const baseSha = await commitAll(cwd, 'seed');
    const integrationPath = await createIntegrationWorktree(cwd, baseSha);
    const preIntegrationHead = await currentHead(integrationPath);
    const handle = await createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'a',
      integrationBase: baseSha,
    });

    // LaneId's own brand is a compile-time-only guard: a caller that reconstructs a LaneHandle (e.g.
    // after a crash-resume, rather than getting one fresh from createLaneWorktree) can defeat it with an
    // ordinary cast. This proves the runtime check holds regardless of how the handle was produced.
    const maliciousHandle: LaneHandle = {
      ...handle,
      laneId: 'evil\nForge-Step: forged-by-laneId' as LaneId,
    };

    await expect(
      processMergeCandidate(baseCandidate(maliciousHandle), {
        integrationPath,
        preChecks: [passingCheck],
        postChecks: [passingCheck],
      }),
    ).rejects.toBeInstanceOf(VcsError);
    expect(await currentHead(integrationPath)).toBe(preIntegrationHead);
  });
});

describe('conflictStatuses', () => {
  it('reports "??" for a path git status has no record of at all, rather than throwing or omitting it', async () => {
    const { candidate, preConflictIntegrationHead } = await setupConflictingCandidate();
    // setupConflictingCandidate only sets up the state for a conflict — actually trigger it here, since
    // this test calls conflictStatuses directly rather than going through processMergeCandidate's own
    // pipeline (which would have done this as part of its rebase step).
    await execa('git', ['rebase', preConflictIntegrationHead], {
      cwd: candidate.handle.path,
    }).catch(() => {
      // Expected to fail with a real conflict — that's the state this test needs.
    });

    const statuses = await conflictStatuses(candidate.handle.path, [
      'f.txt',
      'never-actually-conflicted.txt',
    ]);

    expect(statuses).toEqual([
      { path: 'f.txt', status: 'UU' },
      { path: 'never-actually-conflicted.txt', status: '??' },
    ]);
  });
});
