/**
 * `.forge/migrate/lock.json` — a real, on-disk, cross-process lock serializing `forge migrate run`'s
 * own read-modify-write of `.forge/migrate/applied.json` (critic-reproduced defect, `specs/22` M17
 * P18: two concurrent, otherwise-unrelated invocations each genuinely ran their own script, but the
 * ledger ended up with only one entry — the other's application was silently lost, with no
 * `problems` entry and no nonzero exit, and a follow-up invocation then re-ran the lost entry's
 * script a second time, defeating `12` F-DATA-6's own idempotency requirement outright).
 *
 * `F-DATA-6` explicitly names "a decision on the multi-instance race" as part of this area's own
 * scope; this file is that decision. The shape is deliberately `commands/run/lock.ts`'s own, already
 * reviewed, already fixed-after-a-critic-round pattern (`.forge/state/lock.json`, `acquireRunLock`),
 * reused rather than re-derived — `isProcessAlive` is imported from it directly, not duplicated. It
 * differs in one load-bearing way: `acquireRunLock` REFUSES outright (`CFG-002`) when another live
 * process already holds it, because only one real supervisor may ever drive a run. Two `forge migrate
 * run` invocations naming different, unrelated migration ids are not mutually exclusive in that
 * sense — both are legitimate and both must eventually succeed — so this lock WAITS (bounded,
 * polling) for the holder to finish rather than refusing, and only throws once that wait is
 * genuinely exhausted.
 *
 * Also layers the read-back-after-write and age-gated-reclaim protections this codebase's own
 * cross-process locking experience calls for beyond a bare `open(path, 'wx')`: the exclusive create
 * is fsynced then immediately read back to confirm THIS process's own write is the one that landed
 * (never assumed from the absence of an `EEXIST` alone), and a lock whose `startedAt` is older than
 * `MAX_LOCK_AGE_MS` is reclaimed as a last-resort self-healing fallback even when `isProcessAlive`
 * alone would read "alive" (a pid can be reused by an unrelated process across a long enough gap).
 *
 * @see specs/03 §3.2.5
 * @see specs/12 F-DATA-6
 * @see specs/22 M17 P18
 */
import { mkdir, open, rm } from 'node:fs/promises';
import path from 'node:path';

import { SYSTEM_CLOCK, type Clock } from '@forge/core';
import { ForgeError } from '@forge/core/errors';
import { pathExists, readTextFile, type AbsolutePath, type ProjectPaths } from '@forge/core/fs';

import { isProcessAlive } from '../run/lock.ts';

interface MigrateLock {
  readonly pid: number;
  readonly startedAt: string;
}

const LOCK_RELATIVE_PATH = '.forge/migrate/lock.json';

/** How long this process waits, polling, for another holder to finish before giving up (`RUN-157`).
 * Generous by design: a real migrate run can apply many entries, each up to its own real script
 * timeout, so "another holder is still working" is the ordinary case, not a hang. */
const DEFAULT_LOCK_WAIT_MS = 30 * 60 * 1000;

const POLL_INTERVAL_MS = 100;

/** A lock older than this is reclaimed even when its own pid still reads alive (this file's own
 * header doc comment explains why: a long-enough gap lets the OS recycle a pid onto an unrelated
 * process). Six hours comfortably exceeds any real `forge migrate run` invocation's own total
 * runtime (one 20-minute `DEFAULT_SCRIPT_TIMEOUT_MS` per entry, many entries), so this never fires
 * against a legitimately still-running holder. */
const MAX_LOCK_AGE_MS = 6 * 60 * 60 * 1000;

function lockPath(paths: ProjectPaths): AbsolutePath {
  return paths.resolveWithin(LOCK_RELATIVE_PATH);
}

function isMigrateLock(value: unknown): value is MigrateLock {
  if (typeof value !== 'object' || value === null) return false;
  // Sound: the guard just above already refused every shape but a real, non-null object.
  const candidate = value as Readonly<Record<string, unknown>>;
  return typeof candidate['pid'] === 'number' && typeof candidate['startedAt'] === 'string';
}

/** A lock file that cannot be read at all (missing, unreadable, malformed) is treated as absent —
 * `acquireMigrateLock`'s own retry loop then attempts the identical exclusive create a real absence
 * would, which is the safe reading either way: a genuinely absent lock and an unreadable one both
 * mean "nothing provably holds this right now." */
async function readMigrateLock(paths: ProjectPaths): Promise<MigrateLock | undefined> {
  const resolved = lockPath(paths);
  if (!(await pathExists(resolved))) return undefined;
  try {
    const raw: unknown = JSON.parse(await readTextFile(resolved));
    return isMigrateLock(raw) ? raw : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Acquires `.forge/migrate/lock.json`, waiting (bounded by `maxWaitMs`) for any other real,
 * live, non-stale holder to release it first. Throws `ForgeError('RUN-157', ...)` only once that
 * wait is genuinely exhausted — never earlier, and never silently proceeding unlocked.
 *
 * @see specs/22 M17 P18
 */
export async function acquireMigrateLock(
  paths: ProjectPaths,
  clock: Clock = SYSTEM_CLOCK,
  maxWaitMs: number = DEFAULT_LOCK_WAIT_MS,
): Promise<void> {
  const resolved = lockPath(paths);
  await mkdir(path.dirname(resolved), { recursive: true });
  const payload: MigrateLock = { pid: process.pid, startedAt: clock.now() };
  const serialized = JSON.stringify(payload, null, 2);
  const deadline = Date.parse(clock.now()) + maxWaitMs;

  for (;;) {
    try {
      const handle = await open(resolved, 'wx');
      try {
        await handle.writeFile(serialized);
        await handle.sync();
      } finally {
        await handle.close();
      }
      // Read back: confirms THIS process's own write is the one that landed, rather than trusting
      // the absence of an EEXIST alone (this file's own header doc comment has the full reasoning).
      const confirmed = await readMigrateLock(paths);
      if (confirmed?.pid === payload.pid && confirmed.startedAt === payload.startedAt) return;
      // An exclusive create that did not actually win (should not happen on a real POSIX/NTFS
      // filesystem, but this is exactly the layer the lesson above asks for): fall through to the
      // same contention handling any other EEXIST gets, rather than trusting the create blindly.
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }

    const existing = await readMigrateLock(paths);
    const now = Date.parse(clock.now());
    const stale =
      existing === undefined ||
      !isProcessAlive(existing.pid) ||
      now - Date.parse(existing.startedAt) > MAX_LOCK_AGE_MS;
    if (stale) {
      await rm(resolved, { force: true });
      continue;
    }

    if (now >= deadline) {
      throw new ForgeError('RUN-157', { pid: existing.pid });
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/** Releases `.forge/migrate/lock.json`. A no-op if it is already absent (the identical tolerance
 * `releaseRunLock` already establishes). */
export async function releaseMigrateLock(paths: ProjectPaths): Promise<void> {
  await rm(lockPath(paths), { force: true });
}
