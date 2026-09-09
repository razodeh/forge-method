/**
 * `forge doctor`'s own lock/worktree checks.
 *
 * @see specs/03 §3.7
 */
import { spawn } from 'node:child_process';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import {
  checkDanglingLaneBranches,
  checkOrphanedWorktrees,
  checkStaleLock,
} from '../../../src/commands/doctor/locks-and-worktrees.ts';
import { acquireRunLock } from '../../../src/commands/run/lock.ts';
import { cleanupAll, createTestProject } from './helpers.ts';

afterEach(cleanupAll);

describe('checkStaleLock', () => {
  it('passes when no lock is held', async () => {
    const project = await createTestProject();
    const result = await checkStaleLock(project.paths);
    expect(result.ok).toBe(true);
  });

  it('passes (informationally) for a lock held by a real, live process', async () => {
    const project = await createTestProject();
    await acquireRunLock(project.paths, {
      pid: process.pid,
      host: 'h',
      runId: 'r',
      startedAt: '2026-01-01T00:00:00.000Z',
    });
    const result = await checkStaleLock(project.paths);
    expect(result.ok).toBe(true);
  });

  it('is a real, honest warning for a lock naming a real, genuinely dead pid', async () => {
    const project = await createTestProject();
    const child = spawn('node', ['-e', 'process.exit(0)']);
    const deadPid = child.pid;
    if (deadPid === undefined) throw new Error('child process failed to spawn (no pid)');
    await new Promise((resolve) => child.on('exit', resolve));
    await acquireRunLock(project.paths, {
      pid: deadPid,
      host: 'h',
      runId: 'r',
      startedAt: '2026-01-01T00:00:00.000Z',
    });
    const result = await checkStaleLock(project.paths);
    expect(result.ok).toBe(false);
    expect(result.severity).toBe('warning');
  });
});

describe('checkOrphanedWorktrees', () => {
  it('passes for a real project with no worktrees at all', async () => {
    const project = await createTestProject();
    const result = await checkOrphanedWorktrees(project.dir);
    expect(result.ok).toBe(true);
  });

  it('is a real warning for a real, orphaned forge-namespaced worktree', async () => {
    const project = await createTestProject();
    await execa(
      'git',
      ['worktree', 'add', '-b', 'forge/run-1/implement-abcd1234', '.forge/state/worktrees/orphan'],
      { cwd: project.dir },
    );
    const result = await checkOrphanedWorktrees(project.dir);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('1 real orphaned');
  });
});

describe('checkDanglingLaneBranches', () => {
  it('passes for a real project with no forge-namespaced branches', async () => {
    const project = await createTestProject();
    const result = await checkDanglingLaneBranches(project.dir);
    expect(result.ok).toBe(true);
  });

  it('is a real warning for a real forge-namespaced branch with no matching worktree', async () => {
    const project = await createTestProject();
    await execa('git', ['branch', 'forge/run-1/implement-abcd1234'], { cwd: project.dir });
    const result = await checkDanglingLaneBranches(project.dir);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('forge/run-1/implement-abcd1234');
  });

  it('does not flag a real forge-namespaced branch that does have a real worktree checked out', async () => {
    const project = await createTestProject();
    await execa(
      'git',
      ['worktree', 'add', '-b', 'forge/run-1/implement-abcd1234', '.forge/state/worktrees/lane-1'],
      { cwd: project.dir },
    );
    const result = await checkDanglingLaneBranches(project.dir);
    expect(result.ok).toBe(true);
  });
});
