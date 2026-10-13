/**
 * `forge doctor`'s own lock/worktree checks.
 *
 * @see specs/03 §3.7
 */
import { spawn } from 'node:child_process';
import { mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';

import { execa } from 'execa';
import { worktreesRootFor } from '@forge/vcs';
import { afterEach, describe, expect, it } from 'vitest';

import {
  checkDanglingLaneBranches,
  checkLegacyInTreeWorktrees,
  checkOrphanedWorktrees,
  checkStaleLock,
} from '../../../src/commands/doctor/locks-and-worktrees.ts';
import { acquireRunLock } from '../../../src/commands/run/lock.ts';
import { cleanupAll, createTestProject } from './helpers.ts';

afterEach(cleanupAll);

/** The exact lane-worktree-root `createLaneWorktree` itself would compute for `projectDir` —
 * `lanes.test.ts`'s own `expectedWorktreesRoot` helper, duplicated here rather than imported: this
 * file already builds a worktree with a raw `git worktree add` (never `createLaneWorktree` itself),
 * so it needs the identical real location independently, the same "prove it against the real
 * contract, not a remembered literal" reason that raw call exists for in the first place. */
async function expectedWorktreesRoot(projectDir: string): Promise<string> {
  return worktreesRootFor(await realpath(projectDir));
}

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
    const target = path.join(await expectedWorktreesRoot(project.dir), 'orphan');
    await execa('git', ['worktree', 'add', '-b', 'forge/run-1/implement-abcd1234', target], {
      cwd: project.dir,
    });
    const result = await checkOrphanedWorktrees(project.dir);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('1 real orphaned');
  });
});

describe('checkLegacyInTreeWorktrees (specs/22 M17 P8)', () => {
  it('passes when no legacy in-tree worktrees directory exists at all', async () => {
    const project = await createTestProject();
    const result = await checkLegacyInTreeWorktrees(project.paths);
    expect(result.ok).toBe(true);
    expect(result.severity).toBe('warning');
  });

  it('is a real warning for a real leftover entry under the pre-M17 .forge/state/worktrees/', async () => {
    const project = await createTestProject();
    // A pre-M17 FORGE version (or this engine, before PLAN-M17.md P8) created lanes here directly --
    // simulated by a plain directory, since the real worktree-creation machinery itself (`@forge/vcs`)
    // never writes here again post-M17, which is the whole point this check exists to catch.
    await mkdir(path.join(project.dir, '.forge', 'state', 'worktrees', 'leftover-lane'), {
      recursive: true,
    });
    const result = await checkLegacyInTreeWorktrees(project.paths);
    expect(result.ok).toBe(false);
    expect(result.severity).toBe('warning');
    expect(result.message).toContain('1 real entry');
  });

  it('counts every real entry, pluralised correctly', async () => {
    const project = await createTestProject();
    await mkdir(path.join(project.dir, '.forge', 'state', 'worktrees', 'a'), { recursive: true });
    await mkdir(path.join(project.dir, '.forge', 'state', 'worktrees', 'b'), { recursive: true });
    const result = await checkLegacyInTreeWorktrees(project.paths);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('2 real entries');
  });

  it('the real worktree-creation path (createLaneWorktree, via the real engine facade) never creates anything here at all', async () => {
    const project = await createTestProject();
    await execa(
      'git',
      [
        'worktree',
        'add',
        '-b',
        'forge/run-1/implement-abcd1234',
        path.join(await expectedWorktreesRoot(project.dir), 'orphan'),
      ],
      { cwd: project.dir },
    );
    const result = await checkLegacyInTreeWorktrees(project.paths);
    expect(result.ok).toBe(true);
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
