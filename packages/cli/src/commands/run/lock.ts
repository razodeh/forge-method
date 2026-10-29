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

/**
 * `undefined` whenever this process cannot currently prove a lock exists — a genuine absence, one
 * removed by a concurrent release/reclaim in the gap between this function's own existence check and
 * its read, or content caught mid-write. Never throws for any of those: confirmed live (a real
 * 28-process x 6-cycle acquire/release contention run crashed 90 of 118 total failures outright, via
 * an uncaught `JSON.parse` `SyntaxError` on an empty read or a `RUN-034` `ENOENT` from `readTextFile`)
 * that the previous version — `pathExists` then a *separate* `readTextFile`/`JSON.parse` — left a real
 * gap a concurrent writer's own release-then-recreate could land in, taking the whole acquire attempt
 * down with it rather than letting its caller treat the lock as merely indeterminate for this read.
 */
export async function readRunLock(paths: ProjectPaths): Promise<RunLock | undefined> {
  const resolved = lockPath(paths);
  try {
    return JSON.parse(await readTextFile(resolved)) as RunLock;
  } catch {
    return undefined;
  }
}

const MAX_ACQUIRE_ATTEMPTS = 100;

/** How long `acquireRunLock` waits before retrying after an ambiguous (`undefined`) `readRunLock`
 * result -- the identical short, fixed-delay shape `@forge/cli`'s own `withCollectionLock`
 * (`LOCK_RETRY_DELAY_MS`) already uses for its own "not yet provably stale" retry path. */
const AMBIGUOUS_LOCK_RETRY_DELAY_MS = 10;

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
 *
 * **Fixed bug class, identical to `@forge/telemetry`'s own `withEventLogLock` (`379eb26`) and
 * `@forge/cli`'s own `withCollectionLock` (`e2a42d5`):** `readRunLock` returning `undefined` used to
 * be folded into "not a real, live holder, reclaim" the same way a genuinely dead pid is. But
 * `undefined` only ever means this process could not prove a holder exists a moment ago — nothing
 * about the actual instant of the `rm` call below, which runs on a separate, later `await`. Treating
 * that stale, ambiguous observation as license to delete whatever currently sits at `resolved` could
 * destroy a brand-new, genuinely live lock a different process legitimately created in the gap. Only
 * a lock this process can actually read AND prove names a dead pid is real, positive evidence of
 * staleness; `undefined` is retried instead, never reclaimed.
 *
 * **Disclosed asymmetry (round 3, correcting round-1/round-2 doc comments elsewhere in this codebase
 * that mischaracterized this function as one of two "siblings" that already has the complete fix
 * below): unlike `migrate/lock.ts`'s own `acquireMigrateLock` and `module.ts`'s own
 * `withManifestLock`, this function's ambiguous (`undefined`) branch has NO self-heal path at all.**
 * Both of those siblings reclaim an ambiguous/unreadable lock once it has measurably sat that way
 * past their own age-gate grace window (`AMBIGUOUS_LOCK_GRACE_MS`), closing exactly the "a
 * permanently-corrupted lock file wedges this forever" failure mode. This function does something
 * narrower instead: it retries the exclusive create at a fixed `AMBIGUOUS_LOCK_RETRY_DELAY_MS` delay,
 * bounded by `MAX_ACQUIRE_ATTEMPTS`, and once that budget is exhausted while STILL ambiguous, throws a
 * plain, untyped `Error` ("gave up after N attempts") — not a `ForgeError`, and not a self-heal. A
 * lock that is permanently ambiguous (hand-edited, genuinely corrupted on disk) therefore stays wedged
 * until a human runs `forge doctor --reclaim-lock` to clear it by hand; it never recovers on its own
 * the way the two siblings above now do.
 *
 * This asymmetry is SUSPECTED, not confirmed, deliberate: this file's own header doc comment's
 * reasoning for never force-reclaiming a live-pid-held lock (`CFG-002` guards against two concurrent
 * `forge run` supervisors mutating the same project at once — the highest-risk scenario of the three
 * locks) plausibly extends to the ambiguous case too (an unreadable lock might still be a live
 * supervisor whose write is mid-flight), which would make "require a human in the loop" the right
 * call here even though it is not for the other two locks. But that extension has not actually been
 * decided and recorded — it is this comment's own inference, not a reviewed decision. Changing this
 * behavior (adding the identical age-gated self-heal the other two locks have) is a real design
 * question for a human to decide and record, not something this comment or any fix-the-doc-comment
 * pass should do unilaterally.
 *
 * @see SPEC-QUESTIONS.md Q359
 */
/** **CONFIRMED, deeper bug underneath every reasoning gap this doc comment and `run/lock.ts`'s own
 * siblings already closed, closed here too: write-time fencing.** A dedicated investigation found
 * that `open(path, 'wx')` itself -- the "exclusive create, atomic at the OS level" guarantee this
 * function's own doc comment above relies on -- can, under dense, synchronous create/delete churn
 * against the identical lock-file path from many real processes at once, let TWO concurrent creates
 * BOTH report success, with neither ever seeing `EEXIST`. See `@forge/cli`'s own `collection-lock.ts`
 * (top doc comment) for the complete empirical repro and reasoning, confirmed identical in substance
 * here, not re-derived a third time.
 *
 * Unlike `withCollectionLock`/`withManifestLock`/`withEventLogLock` (each a generic wrapper around a
 * caller-supplied `operation`), `acquireRunLock`/`releaseRunLock` bracket an entire `forge run`/`forge
 * resume` invocation manually — there is no single wrapped write this function itself could fence on
 * its own. `assertRunLockStillHeld` below is this lock's own version of the identical `verifyFence`
 * primitive: a caller (`run.ts`, `resume.ts`) that is about to commit a real, shared-file write while
 * believing it holds this lock calls it immediately beforehand, and it throws the identical `CFG-002`
 * a live rival already throws if the lock file no longer names this process's own pid. This is
 * narrower than the other four locks' own fully automatic "unwind and re-acquire" loop — deliberately
 * so, consistent with this lock's own already-disclosed asymmetry (no self-heal; `CFG-002`'s blast
 * radius, two concurrent `forge run` supervisors, is the highest of the five, and this file's own
 * doc comment above already keeps a human in the loop for a merely ambiguous lock, let alone a
 * confirmed-lost one) — a caller that catches `CFG-002` here must treat the whole run as unable to
 * continue, never silently retry the one write; a fresh `forge run`/`forge resume` invocation is what
 * "re-enter the full acquire loop from scratch" means for this particular lock. */
export async function assertRunLockStillHeld(paths: ProjectPaths, lock: RunLock): Promise<void> {
  const current = await readRunLock(paths);
  if (current?.pid !== lock.pid || current.runId !== lock.runId) {
    // Report the RIVAL's pid/host, matching every other real `CFG-002` throw site
    // (`acquireRunLock`'s own `existing.pid`/`existing.host`, `resume.ts`'s pre-flight check) -- never
    // the caller's own `lock.pid`/`lock.host`, which would make this message claim the rival is the
    // caller itself. `current` is `undefined` only in the genuinely ambiguous case (the lock file is
    // now missing/unreadable rather than reassigned to a different real holder); `migrate/lock.ts`'s
    // own `assertMigrateLockStillHeld` already has the honest pattern for that case (an explicit `0`
    // sentinel for `pid`, since `RUN-157`'s own shape has no "unknown" variant either) -- mirrored here
    // for `host` too, since `CFG-002`'s own `host: string` has no "unknown" variant of its own.
    throw new ForgeError('CFG-002', { pid: current?.pid ?? 0, host: current?.host ?? 'unknown' });
  }
}

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
      const code = (error as NodeJS.ErrnoException).code;
      // A real CI failure on `next` (run 40813893964, job 123250350362, `lock-stress (sequential,
      // windows-latest)`) crashed a spawned fixture process outright with a raw `EPERM` from
      // `open(path, 'wx')` above, not the `EEXIST` this catch block otherwise expects, under dense
      // create/delete churn from many real processes racing the same lock path. Confirmed against
      // libuv's own `src/win/fs.c` (`fs__open`): Windows' `CreateFile`+`CREATE_NEW` (what libuv maps
      // `wx` to) is not as strictly atomic under this kind of churn as POSIX's `O_EXCL` -- a lost race
      // there can surface as `ERROR_ACCESS_DENIED` (Node's `EPERM`) instead of `ERROR_FILE_EXISTS`
      // (`EEXIST`). Treated identically to `EEXIST` here, on win32 only -- the same fix
      // `@forge/telemetry`'s own `acquireEventLogLockOnce` (`events.ts`) already applies, there for the
      // sync `writeFileSync(..., {flag:'wx'})` surface rather than this function's async
      // `fsPromises.open(path, 'wx')` surface, but both funnel through the identical libuv code path;
      // see that function's own doc comment for the fuller empirical record. POSIX's own `O_EXCL` is
      // already atomic, so an `EPERM` there remains a real, unrelated failure that must still
      // propagate.
      const isWindowsCreateRace = process.platform === 'win32' && code === 'EPERM';
      if (code !== 'EEXIST' && !isWindowsCreateRace) throw error;
    }

    const existing = await readRunLock(paths);
    if (existing === undefined) {
      // Ambiguous, not stale: retry the exclusive create rather than blindly deleting whatever may
      // now sit at `resolved` -- see this function's own doc comment for the full reasoning.
      await new Promise((resolveDelay) => setTimeout(resolveDelay, AMBIGUOUS_LOCK_RETRY_DELAY_MS));
      continue;
    }
    if (isProcessAlive(existing.pid)) {
      throw new ForgeError('CFG-002', { pid: existing.pid, host: existing.host });
    }
    // A genuinely dead pid is real, positive proof of staleness -- safe to reclaim outright.
    await rm(resolved, { force: true });
  }

  throw new Error(`acquireRunLock: gave up after ${String(MAX_ACQUIRE_ATTEMPTS)} attempts`);
}

/** Releases `.forge/state/lock.json`, unconditionally — deliberately NOT given the release-time
 * ownership re-check `collection-lock.ts`/`module.ts`/`events.ts` each now apply symmetrically at
 * their own equivalent release step (their own doc comments explain that mechanism in full). This
 * lock's own real callers are not only the normal end-of-run self-release (`run.ts`/`resume.ts`'s own
 * `finally`, where this process genuinely still owns the lock the overwhelming majority of the time —
 * `assertRunLockStillHeld` above, called before this lock's own two real shared-file writes, already
 * narrows that remaining risk the same way the other four locks' write-time fence does) but also
 * `forge doctor --fix`'s own `fixStaleLock` (`doctor/fix.ts`), which exists SPECIFICALLY to delete a
 * lock naming a DIFFERENT, confirmed-dead pid on a human's behalf — an ownership check here would
 * make that entire remedy a permanent no-op, since the deleting process's own pid is never the dead
 * one it is trying to clear. `fixStaleLock` already gates on its own `isProcessAlive` check before
 * ever calling this, so the one case this file's own release genuinely needs to protect against (this
 * process deleting a DIFFERENT, still-live process's own legitimate lock) is not actually reachable
 * through that call site. */
export async function releaseRunLock(paths: ProjectPaths): Promise<void> {
  const resolved = lockPath(paths);
  if (!(await pathExists(resolved))) return;
  await rm(resolved, { force: true });
}

/** The ownership-checked release `run.ts`/`resume.ts`'s own `finally` blocks use instead of the bare
 * `releaseRunLock` above -- this is the one place that unconditional version's own doc comment
 * flags as the real residual risk `assertRunLockStillHeld` alone does not cover: if this process's
 * fence was already lost earlier in the very same run (another process's own independently-
 * successful create landed, `assertRunLockStillHeld` threw, and that threw all the way out to this
 * `finally`), the plain `releaseRunLock` would otherwise delete that OTHER process's now-genuinely-
 * legitimate lock on this process's own way out — defeating `CFG-002` a second way, on exit rather
 * than on write. Deletes only when `lock.json` still names this exact `(pid, runId)` pair, or is
 * already absent; a mismatch is left untouched. Not used by `doctor/fix.ts`'s own `fixStaleLock`,
 * which legitimately needs to clear a DIFFERENT process's dead-pid lock and already gates on
 * `isProcessAlive` itself before calling the unconditional version above. */
export async function releaseRunLockIfStillOwned(
  paths: ProjectPaths,
  lock: RunLock,
): Promise<void> {
  const current = await readRunLock(paths);
  if (current === undefined || (current.pid === lock.pid && current.runId === lock.runId)) {
    await rm(lockPath(paths), { force: true });
  }
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
