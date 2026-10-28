/**
 * `withCollectionLock` — a REAL, cross-process exclusive lock around a `collection: true` artifact's
 * own read-modify-write cycle (`18` §18.7: one shared, repeatedly-modified file, never a
 * write-once-per-record file the way `MutationEvidence` is).
 *
 * `specs/22` M15 P10: extracted out of `loop/test/exemptions.ts`'s own `withExemptionsLock`
 * (M15 P6), parameterized by lock file name, so a SECOND collection file needing the identical real
 * exclusivity guarantee (this piece's own `kb/disclosures.md`) does not re-fight the same hard
 * concurrency problem from scratch, with its own, independent chance of repeating every subtle bug
 * `withExemptionsLock` took three full gauntlet rounds to find and fix (`GAUNTLET-LOG.md`'s own
 * `## M15 P6` entry has the complete list: silent data loss under real I/O contention with the
 * exclusive-create primitive itself occasionally not holding, a `resolveState`-path TOCTOU race in
 * shared `@forge/core/fs` infrastructure, an immediate-reclaim-on-empty-lock rule that was itself
 * unsafe against an ordinary in-flight writer, and a reclaim's own `ENOENT` race against a
 * concurrent read-back). Every one of those fixes lives here now, unchanged in substance — this
 * extraction moves the code, it does not re-derive or re-verify the reasoning behind it a second
 * time; see `withExemptionsLock`'s own prior doc comment (preserved in this module's git history) for
 * the full original diagnosis.
 *
 * `lockFileName` is the one real difference between two callers: `exemptions.lock` and
 * `disclosures.lock` live side by side in `.forge/state/`, never contending with each other, so a
 * `forge test exempt` and a `forge kb disclose` running at the same real moment never wait on a lock
 * neither of them actually needs.
 *
 * `.forge/state/`, not `reports/`/`kb/`, because it is already git-ignored and already the
 * deny-listed, run-owned directory `ProjectPaths.resolveState` exists for: a lock file left behind by
 * a crashed process can never show up as uncommitted dirty-tree debris blocking a later
 * `assertCleanWorkingTree` call the way a stray file under a real content root would.
 *
 * **Honestly-claimed reliability ceiling, carried over unchanged from `withExemptionsLock`'s own
 * record:** repeated empirical testing (M15 P6, both the round-2 and round-3 gauntlet's own
 * independent reproductions) found this exact exclusive-create-plus-read-back-plus-age-gated-reclaim
 * design clean at 20-way real concurrency, with intermittent loss reappearing starting around 25-30 —
 * not a proof of correctness at arbitrary scale, carried here as the honest ceiling this module's own
 * callers inherit, not silently assumed away. See `SPEC-QUESTIONS.md`'s own `## Q285` (M15 P6) for the
 * complete record of why this was fixed and reverified, not escalated, despite being found on the
 * third and final allowed gauntlet round.
 *
 * @see SPEC-QUESTIONS.md Q285
 * @see GAUNTLET-LOG.md ## M15 P6
 */
import { mkdir, rm, stat } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Clock } from '@forge/core';
import type { ForgeError } from '@forge/core/errors';
import { readTextFile, type AbsolutePath, type ProjectPaths } from '@forge/core/fs';

import { isProcessAlive } from './run/lock.ts';

/** `400` (10s at `LOCK_RETRY_DELAY_MS` below), not the original `200` (5s) -- raised by a round-2
 * critic finding on this milestone's own lock-reliability round: `kb-disclosures.test.ts`,
 * `run/lock.test.ts`, and `module.test.ts` each independently added their own real, 28-OS-process
 * stress test for this exact bug class, and running all three together (as the gauntlet's own
 * specified acceptance command does) spikes to up to ~84 real, competing child processes at once --
 * confirmed live at an 80% failure rate (4/5 runs) for exactly this reason: `kb-disclosures.test.ts`'s
 * OWN 28-worker test exhausted the original 5s budget under that COMBINED host load, not because any
 * lock was actually held longer by its true owner, but because real OS scheduling contention across
 * ~84 competing processes slows down every single `open`+`writeFile`+`sync`+`close`/`stat` cycle this
 * loop depends on. The data-integrity assertion itself (no lost/duplicated id) was never violated in
 * any failing run -- a budget problem under combined test-suite load, not a correctness regression,
 * so the fix widens the budget rather than touching the locking logic itself. Still finite and still
 * a real, named `KB-018`/`GATE-515` refusal if a lock is EVER wedged for 10 real seconds -- this is
 * headroom for legitimate contention, not an unbounded wait. */
const MAX_LOCK_ATTEMPTS = 400;
const LOCK_RETRY_DELAY_MS = 25;
/** See `withExemptionsLock`'s own original doc comment (M15 P6) for the full reasoning: well above
 * any real `open`+`writeFile`+`sync`+`close` sequence even under heavy contention, well below
 * anything a human would read as "stuck." */
const STALE_EMPTY_LOCK_MS = 2000;

export async function withCollectionLock<T>(
  paths: ProjectPaths,
  clock: Clock,
  lockFileName: string,
  // The caller builds its own, fully-typed `ForgeError` (each collection file's own real code --
  // `GATE-515` for `Exemption`, `KB-018` for `Disclosure` -- has its own message/remedy text naming
  // ITS OWN file) rather than this generic module hardcoding either one or erasing the per-code
  // detail typing through a loosely-typed intermediate shape.
  onExhausted: (maxAttempts: number) => ForgeError,
  operation: () => Promise<T>,
): Promise<T> {
  const stateDir = paths.resolveState('.');
  await mkdir(stateDir, { recursive: true });
  const resolved = path.join(stateDir, lockFileName) as AbsolutePath;

  let acquired = false;
  for (let attempt = 0; attempt < MAX_LOCK_ATTEMPTS && !acquired; attempt += 1) {
    try {
      // Synchronous, deliberately: a single call does create+write+close with no `await` (no Node
      // microtask yield, no OS-scheduler preemption point) between the file coming into existence
      // and its content being the real pid.
      writeFileSync(resolved, String(process.pid), { flag: 'wx' });
      // Trust, but verify: read the file straight back and confirm it is still, exactly, our own
      // pid before treating the lock as genuinely acquired (`wx`'s own atomicity guarantee does not
      // reliably hold under this environment's real I/O contention -- `withExemptionsLock`'s own
      // original doc comment, M15 P6 round 2, has the full empirical record).
      let readBack: string | undefined;
      try {
        readBack = readFileSync(resolved, 'utf8').trim();
      } catch {
        // A concurrent process's own empty-lock reclaim can delete this just-written, legitimately
        // owned lock file in the gap between the write above and this read -- M15 P6 round 3's own
        // finding. Treated identically to a genuine pid mismatch: this process cannot currently
        // prove it holds the lock, so it must not proceed as if it does.
        readBack = undefined;
      }
      if (readBack !== String(process.pid)) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, LOCK_RETRY_DELAY_MS));
        continue;
      }
      acquired = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const ownerPidText = (await readTextFile(resolved).catch(() => '')).trim();
      const ownerPid = Number(ownerPidText);
      if (ownerPid > 0) {
        if (!isProcessAlive(ownerPid)) {
          await rm(resolved, { force: true });
          continue;
        }
      } else {
        // Empty or unparseable content is genuinely ambiguous (a crash right after `open('wx')`,
        // reclaimable, vs. an ordinary live writer about to finish its own very next line, NOT
        // reclaimable) -- age-gated, not resolved from content alone (M15 P6 round 2's own finding).
        // CONFIRMED LIVE DATA-LOSS BUG, FIXED: an indeterminate age (`stat` itself failed -- most
        // commonly ENOENT from a real, tiny multi-process race, where the true lock owner releases
        // its PREVIOUS lock and creates a brand-new one for its own NEXT write fast enough that this
        // process's `stat` lands in the gap and finds nothing) is NOT "stale" -- it is "unknown," and
        // must fall through to the ordinary retry-after-delay path below, the identical "owner alive,
        // not stale" treatment the branch above already gives. The previous version of this check
        // (`ageMs === undefined || ...`) forcibly reclaimed on ANY stat failure, deleting that still-
        // live owner's brand-new lock out from under it and letting a second process win the
        // immediate retry while the first was still mid-write -- both then computing and writing the
        // identical collection entry, the exact duplicate/overwrite race this reclaim path must not
        // itself cause. Only a real, MEASURED age over the threshold may ever force a reclaim now.
        // This is the identical root cause and fix as `@forge/telemetry`'s own `withEventLogLock`
        // (`packages/telemetry/src/events.ts`) -- see that function's own doc comment for the full
        // empirical repro this was independently confirmed against.
        const ageMs = await stat(resolved)
          .then((info) => Date.parse(clock.now()) - info.mtimeMs)
          .catch(() => undefined);
        if (ageMs !== undefined && ageMs > STALE_EMPTY_LOCK_MS) {
          await rm(resolved, { force: true });
          continue;
        }
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, LOCK_RETRY_DELAY_MS));
    }
  }
  if (!acquired) {
    throw onExhausted(MAX_LOCK_ATTEMPTS);
  }
  try {
    return await operation();
  } finally {
    await rm(resolved, { force: true });
  }
}
