/**
 * `.forge/state/lock.json` — real, on-disk lock acquisition/release/signal, against a real pid (this
 * process's own, for the "alive" cases; a real, freshly-spawned then genuinely killed child process for
 * the "dead" and `stopLockedProcess` cases — never a faked `isProcessAlive`).
 *
 * @see specs/03 §3.2.4
 */
import { spawn } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';

import {
  acquireRunLock,
  assertRunLockStillHeld,
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

/** A real, genuinely-dead pid — spawned then confirmed exited — standing in for a rival process whose
 * own independently-successful lock-file create has since landed and finished, the identical technique
 * `collection-lock.test.ts`'s own `realDeadPid` already establishes for this exact anomaly-injection
 * shape. A real, once-live, now-dead pid (never a fabricated number like `999999`) keeps this honest
 * about what a real pid actually looks like on disk. */
async function realDeadPid(): Promise<number> {
  const child = spawn('node', ['-e', 'process.exit(0)']);
  const pid = child.pid;
  if (pid === undefined) throw new Error('child process has no pid');
  await new Promise((resolve) => child.on('exit', resolve));
  return pid;
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

/**
 * `assertRunLockStillHeld`'s own write-time fencing (`CFG-002` on a lost fence) — the identical
 * anomaly-injection technique `collection-lock.test.ts`'s own top doc comment establishes: directly
 * reassigning the lock file to a different real pid mid-operation stands in for the confirmed
 * double-`wx`-create race this mechanism exists to close, without needing to trigger that real
 * OS-level race itself.
 *
 * This is also the direct, falsifiable regression test for a round-2 critic finding: the first
 * version of this function threw `CFG-002` reporting the CALLER's own `lock.pid`/`lock.host` --
 * making the thrown error claim the rival holding the project is the caller itself. Asserting on the
 * error's actual `pid`/`host` payload (not merely that SOME `CFG-002` is thrown) is what actually
 * proves this: a test that only checked the error code would have passed just as happily against the
 * buggy version.
 */
describe('assertRunLockStillHeld — write-time fencing', () => {
  it('passes silently when the lock still names this exact (pid, runId) pair', async () => {
    const project = await createTestProject();
    const myLock = lockFor({ runId: 'run-mine' });
    await acquireRunLock(project.paths, myLock);
    await expect(assertRunLockStillHeld(project.paths, myLock)).resolves.toBeUndefined();
  });

  it('throws CFG-002 naming the RIVAL’s own pid/host -- never the caller’s own -- once the lock file has been reassigned', async () => {
    const project = await createTestProject();
    const myLock = lockFor({ runId: 'run-mine', host: 'my-host' });
    await acquireRunLock(project.paths, myLock);

    const rivalPid = await realDeadPid();
    const rivalLock = lockFor({ pid: rivalPid, host: 'rival-host', runId: 'run-rival' });
    // THE INJECTED ANOMALY: another process's own independently-successful `wx` create lands,
    // reassigning the lock file out from under this process -- this process's own in-flight `myLock`
    // has no way to observe that through anything it has already read.
    await writeFile(project.paths.resolveState('lock.json'), JSON.stringify(rivalLock), 'utf8');

    await expect(assertRunLockStillHeld(project.paths, myLock)).rejects.toMatchObject({
      code: 'CFG-002',
      // THE FIX, DIRECTLY DEMONSTRATED: the rival's own pid/host, not `myLock`'s (the caller's own).
      details: { pid: rivalPid, host: 'rival-host' },
    });
  });

  it('throws CFG-002 with the runId mismatch too (same pid, different runId -- a reused pid racing a new run)', async () => {
    const project = await createTestProject();
    const myLock = lockFor({ runId: 'run-mine', host: 'my-host' });
    await acquireRunLock(project.paths, myLock);

    const rivalLock = lockFor({ host: 'rival-host', runId: 'run-rival' });
    await writeFile(project.paths.resolveState('lock.json'), JSON.stringify(rivalLock), 'utf8');

    await expect(assertRunLockStillHeld(project.paths, myLock)).rejects.toMatchObject({
      code: 'CFG-002',
      details: { pid: rivalLock.pid, host: 'rival-host' },
    });
  });

  it('throws CFG-002 with the honest `0`/`unknown` sentinel -- never crashing, never the caller’s own values -- when the lock file is now genuinely unreadable (the ambiguous case)', async () => {
    const project = await createTestProject();
    const myLock = lockFor({ runId: 'run-mine', host: 'my-host' });
    await acquireRunLock(project.paths, myLock);

    // The lock file is now gone entirely -- `readRunLock` returns `undefined`, the genuinely
    // ambiguous case `migrate/lock.ts`'s own `assertMigrateLockStillHeld` already has an honest
    // sentinel for (`pid: 0`); this function's own fix mirrors that, extended to `host`.
    await rm(project.paths.resolveState('lock.json'), { force: true });

    await expect(assertRunLockStillHeld(project.paths, myLock)).rejects.toMatchObject({
      code: 'CFG-002',
      details: { pid: 0, host: 'unknown' },
    });
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
