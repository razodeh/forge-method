/**
 * `.forge/state/lock.json` — real, on-disk lock acquisition/release/signal, against a real pid (this
 * process's own, for the "alive" cases; a real, freshly-spawned then genuinely killed child process for
 * the "dead" and `stopLockedProcess` cases — never a faked `isProcessAlive`).
 *
 * @see specs/03 §3.2.4
 */
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

import {
  acquireRunLock,
  isProcessAlive,
  readRunLock,
  releaseRunLock,
  stopLockedProcess,
  type RunLock,
} from '../../../src/commands/run/lock.ts';
import { cleanupAll, createTestProject } from './helpers.ts';

afterEach(cleanupAll);

function lockFor(overrides: Partial<RunLock> = {}): RunLock {
  return {
    pid: process.pid,
    host: 'test-host',
    runId: 'run-1',
    startedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('isProcessAlive', () => {
  it('is true for this process’s own real pid', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it('is false once a real spawned child has genuinely exited', async () => {
    const child = spawn('node', ['-e', 'process.exit(0)']);
    const pid = child.pid;
    expect(pid).toBeDefined();
    await new Promise((resolve) => child.on('exit', resolve));
    // A dead pid can be recycled by the OS in principle; in practice this window is far too short for
    // that to happen in CI, the same assumption `packages/engine/test/e2e/crash-resume.test.ts`'s own
    // `waitForProcessGone` already relies on.
    expect(isProcessAlive(pid!)).toBe(false);
  });
});

describe('acquireRunLock / readRunLock / releaseRunLock', () => {
  it('writes a real lock file readable back byte-for-byte as the same lock', async () => {
    const project = await createTestProject();
    const lock = lockFor();
    await acquireRunLock(project.paths, lock);
    expect(await readRunLock(project.paths)).toEqual(lock);
  });

  it('readRunLock returns undefined when no lock file exists yet', async () => {
    const project = await createTestProject();
    expect(await readRunLock(project.paths)).toBeUndefined();
  });

  it('throws CFG-002 acquiring over a real, still-alive lock', async () => {
    const project = await createTestProject();
    await acquireRunLock(project.paths, lockFor());
    await expect(acquireRunLock(project.paths, lockFor({ runId: 'run-2' }))).rejects.toMatchObject({
      code: 'CFG-002',
    });
  });

  it('never double-acquires under real concurrency (two acquireRunLock calls fired at once)', async () => {
    // A gauntlet critic round found the original "readRunLock, then a separate writeFileAtomic" pair
    // had no real atomicity linking the two — two concurrent calls could both observe "no live lock"
    // and both write, the second silently clobbering the first, defeating CFG-002's entire purpose.
    // This is the regression test for the `open(path, 'wx')`-based exclusive-create fix: exactly one
    // of two simultaneous callers may ever actually hold the lock.
    const project = await createTestProject();
    const results = await Promise.allSettled([
      acquireRunLock(project.paths, lockFor({ runId: 'run-a' })),
      acquireRunLock(project.paths, lockFor({ runId: 'run-b' })),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({ code: 'CFG-002' });

    // The real, single winning lock is whichever one actually landed on disk.
    const onDisk = await readRunLock(project.paths);
    expect(['run-a', 'run-b']).toContain(onDisk?.runId);
  });

  it('silently reclaims a lock naming a real, genuinely dead pid', async () => {
    const project = await createTestProject();
    const child = spawn('node', ['-e', 'process.exit(0)']);
    const deadPid = child.pid!;
    await new Promise((resolve) => child.on('exit', resolve));

    await acquireRunLock(project.paths, lockFor({ pid: deadPid, runId: 'run-stale' }));
    const reclaimed = lockFor({ runId: 'run-2' });
    await acquireRunLock(project.paths, reclaimed);
    expect(await readRunLock(project.paths)).toEqual(reclaimed);
  });

  it('releaseRunLock removes a real lock file, and is a no-op when none exists', async () => {
    const project = await createTestProject();
    await acquireRunLock(project.paths, lockFor());
    await releaseRunLock(project.paths);
    expect(await readRunLock(project.paths)).toBeUndefined();
    await expect(releaseRunLock(project.paths)).resolves.toBeUndefined();
  });
});

describe('stopLockedProcess', () => {
  it('throws RUN-048 when no lock exists at all', async () => {
    const project = await createTestProject();
    await expect(stopLockedProcess(project.paths, 'SIGTERM')).rejects.toMatchObject({
      code: 'RUN-048',
    });
  });

  it('throws RUN-048 when the locked pid is already dead', async () => {
    const project = await createTestProject();
    const child = spawn('node', ['-e', 'process.exit(0)']);
    const deadPid = child.pid!;
    await new Promise((resolve) => child.on('exit', resolve));
    await acquireRunLock(project.paths, lockFor({ pid: deadPid }));
    await expect(stopLockedProcess(project.paths, 'SIGTERM')).rejects.toMatchObject({
      code: 'RUN-048',
    });
  });

  it('SIGKILLs a real, still-running locked process and confirms it is genuinely gone', async () => {
    const project = await createTestProject();
    const child = spawn('node', ['-e', 'setInterval(() => {}, 1000)']);
    const pid = child.pid!;
    await acquireRunLock(project.paths, lockFor({ pid }));

    const stopped = await stopLockedProcess(project.paths, 'SIGKILL');
    expect(stopped.pid).toBe(pid);
    expect(isProcessAlive(pid)).toBe(false);
  });

  it('honours an injected clock for its own poll-loop timing rather than reading Date.now()', async () => {
    const project = await createTestProject();
    const child = spawn('node', ['-e', 'setInterval(() => {}, 1000)']);
    const pid = child.pid!;
    await acquireRunLock(project.paths, lockFor({ pid }));

    let calls = 0;
    const clock = {
      now(): string {
        calls += 1;
        return new Date(calls * 1000).toISOString();
      },
    };
    await stopLockedProcess(project.paths, 'SIGKILL', 5, 5000, clock);
    expect(calls).toBeGreaterThan(0);
  });
});
