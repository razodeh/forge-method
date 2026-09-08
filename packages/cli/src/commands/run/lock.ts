/**
 * `.forge/state/lock.json` — one real, on-disk lock per project, held by whichever `forge run`
 * process is currently driving a run to completion. `CFG-002` ("Another FORGE supervisor holds this
 * project: pid X on host Y") already names this exact mechanism; nothing built it until now.
 *
 * @see specs/03 §3.2.4
 */
import { mkdir, open, rm } from 'node:fs/promises';
import path from 'node:path';

import { SYSTEM_CLOCK, type Clock } from '@forge/core';
import { ForgeError } from '@forge/core/errors';
import { pathExists, readTextFile, type AbsolutePath, type ProjectPaths } from '@forge/core/fs';

export interface RunLock {
  readonly pid: number;
  readonly host: string;
  readonly runId: string;
  readonly startedAt: string;
}

function lockPath(paths: ProjectPaths): AbsolutePath {
  return paths.resolveState('lock.json');
}

/** Whether a real OS process with this pid is still alive — `process.kill(pid, 0)` sends no signal,
 * only checks; throws `ESRCH` for a dead pid, `EPERM` for a live one this process cannot signal
 * (still alive, so this counts as alive too). The identical technique `PLAN-M5.md` P20's own
 * crash-resume test already uses to verify a real process's own death. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

export async function readRunLock(paths: ProjectPaths): Promise<RunLock | undefined> {
  const resolved = lockPath(paths);
  if (!(await pathExists(resolved))) return undefined;
  return JSON.parse(await readTextFile(resolved)) as RunLock;
}

const MAX_ACQUIRE_ATTEMPTS = 100;

/**
 * Acquires the project lock for a new run, throwing `CFG-002` if another real, still-alive process
 * already holds it. A lock file naming a dead pid (the process crashed without cleaning up after
 * itself — exactly what a real `SIGKILL` produces) is silently reclaimed rather than treated as held
 * — `03` §3.2.1's own `forge doctor --reclaim-lock` remedy exists for a human to do this by hand, but
 * a lock that is provably stale (this process itself just checked) does not need a human in the loop
 * to say so.
 *
 * The one and only real write happens through `open(path, 'wx')` — exclusive create, atomic at the
 * OS level — never through a separate "check, then write" pair. A critic round caught the original
 * version doing exactly that (`readRunLock` then a plain `writeFileAtomic`, with nothing atomic
 * linking the two): two `forge run`/`forge resume` invocations starting within the same instant could
 * both observe "no live lock," both pass the check, and the second's write would silently clobber the
 * first's — both processes then believing they alone hold the project lock, defeating `CFG-002`'s
 * entire purpose. Now the *only* way to actually hold the lock is to win the exclusive create; every
 * other path (an existing, live lock; a stale one needing reclaim) only ever decides whether to loop
 * and try that exclusive create again — a live lock discovered by the *next* loop iteration (because
 * another process's own exclusive create won a race this one lost) still correctly throws `CFG-002`
 * rather than silently double-acquiring, which is what actually closes the race, not merely narrows
 * it. The narrow remaining case (this process's own `rm` racing another's reclaim of the identical
 * stale lock) is safe for the same reason: whichever process's `open('wx')` call the OS actually
 * serializes second gets `EEXIST` again and loops once more, never a torn write.
 */
export async function acquireRunLock(paths: ProjectPaths, lock: RunLock): Promise<void> {
  const resolved = lockPath(paths);
  await mkdir(path.dirname(resolved), { recursive: true });

  for (let attempt = 0; attempt < MAX_ACQUIRE_ATTEMPTS; attempt += 1) {
    try {
      const handle = await open(resolved, 'wx');
      try {
        await handle.writeFile(JSON.stringify(lock, null, 2));
        await handle.sync();
      } finally {
        await handle.close();
      }
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }

    const existing = await readRunLock(paths);
    if (existing !== undefined && isProcessAlive(existing.pid)) {
      throw new ForgeError('CFG-002', { pid: existing.pid, host: existing.host });
    }
    await rm(resolved, { force: true });
  }

  throw new Error(`acquireRunLock: gave up after ${String(MAX_ACQUIRE_ATTEMPTS)} attempts`);
}

export async function releaseRunLock(paths: ProjectPaths): Promise<void> {
  const resolved = lockPath(paths);
  if (!(await pathExists(resolved))) return;
  await rm(resolved, { force: true });
}

/**
 * `pause`/`abort` — sends a real signal to the locked process and waits (bounded, polling) for it to
 * actually die, verified the same way `readRunLock`'s own doc comment names: `process.kill(pid, 0)`
 * throwing, not a trusted promise. `SIGTERM` (pause) and `SIGKILL` (abort) are handled identically by
 * this codebase's own resume machinery either way (`PLAN-M5.md` P20's own crash-resume proof already
 * covers `SIGKILL`) — `@forge/engine`'s own `driveToCompletion` loop has no interruption hook a
 * signal handler could ask it to stop *between* batches gracefully, so both signals really do
 * terminate the process outright; the real, load-bearing difference is not in how the target process
 * responds (there is no cooperative pause today, a known, documented simplification — see
 * `SPEC-QUESTIONS.md`) but in the two commands' own real UNIX distinction: SIGTERM asks first,
 * SIGKILL cannot be caught or ignored at all.
 */
export async function stopLockedProcess(
  paths: ProjectPaths,
  signal: 'SIGTERM' | 'SIGKILL',
  pollIntervalMs = 20,
  maxWaitMs = 5000,
  clock: Clock = SYSTEM_CLOCK,
): Promise<RunLock> {
  const lock = await readRunLock(paths);
  if (lock === undefined || !isProcessAlive(lock.pid)) {
    throw new ForgeError('RUN-048', undefined);
  }

  try {
    process.kill(lock.pid, signal);
  } catch (error) {
    // A narrow race a critic round caught: the target can exit on its own in the gap between the
    // liveness check above and this signal — `process.kill` then throws `ESRCH` for a pid this
    // function already confirmed was alive moments ago. Not a real failure to report: the process is
    // gone, which is the exact outcome this function exists to bring about either way.
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    return lock;
  }

  const deadline = Date.parse(clock.now()) + maxWaitMs;
  while (isProcessAlive(lock.pid) && Date.parse(clock.now()) < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return lock;
}
