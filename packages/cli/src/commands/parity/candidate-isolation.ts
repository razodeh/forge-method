/**
 * `withParityDirHidden` — makes `.forge/parity/` ABSENT, under `root`, for the duration of a callback
 * (`specs/22` M17 P14, `13` F-TEST-9: "the directory is either absent from the tree the case's own
 * `run` sees, or mounted read-only for it"). This piece's own DECISION is "absent": a rename-away and
 * rename-back, rather than a recursive `chmod`, because it needs no awareness of which entries under
 * `.forge/parity/` exist or what mode each one needs (a probe script, a nested `captures/` directory,
 * …) and because a read-only mode can still be bypassed by a process with the right privilege, while a
 * path that does not exist cannot be read by anything.
 *
 * **Closes the self-reverting-tamper gap `specs/22` M16 P7 and `SPEC-QUESTIONS.md` Q294 Decision 7
 * disclosed rather than closed:** a candidate case that reads a capture's own stored observation while
 * it runs, edits it, and restores it before the trust anchor's second comparison, which that anchor's
 * two comparisons (bracketing the whole run, never watching it continuously) cannot see either way.
 * With `.forge/parity/` absent for the single command's own duration, the read this gap depends on
 * fails outright (`ENOENT`) — there is no longer a window in which the directory is both reachable by
 * the case's own command and unwatched by anything else.
 *
 * **Scoped to the CANDIDATE side only.** The reference is observed in a scratch worktree holding only
 * the reference commit's own tracked files (`observe.ts`'s own file header) — a tree the trust anchor
 * never compares and that is discarded once capture finishes, so there is nothing there for this
 * mechanism to protect.
 *
 * **Why bracketing the exact command, not the whole observation.** A case's own overlay inputs (and
 * any probe a command's own line names under `.forge/parity/probes/`) are read FROM `.forge/parity/`
 * immediately before that case's command runs (`overlay.ts`'s `readOverlaySourceBytes`, called from
 * `observe.ts`'s `observeOneCase` and `observe-http.ts`'s own pre-read step) — hiding the directory for
 * anything wider than the command itself would break that read. Bracketing precisely the command
 * (never the before/after cleanliness snapshot either, `observe.ts`'s own `takeTreeSnapshot` calls)
 * also means neither snapshot ever observes the hide/restore itself: both see the directory in its
 * one, ordinary, present state, so `isCleanExcluding`'s before/after comparison is unaffected by this
 * mechanism's own bookkeeping.
 *
 * **Surviving an ordinary interrupt, not only a clean return or a thrown error.** A real Ctrl+C on a
 * hanging candidate command (not an adversarial scenario — an ordinary operator action) delivers
 * `SIGINT` to this process while `.forge/parity/` sits renamed away; with nothing catching that signal,
 * the process ends immediately and the rename is never undone, leaving a user's real declarations
 * looking as if the project has none at all. {@link installIsolationSignalHandlers} closes this the
 * identical way `run/run.ts`'s own `installRunSignalHandlers` already closes the analogous risk for its
 * own owned resource (the launcher shim directory): a synchronous restore, then the conventional
 * `128 + signal` exit code the shell itself already expects, scoped to exactly the window a directory
 * is hidden (installed right after the rename, removed right before the restore) — "a process that
 * keeps living after the window gets its own signal behaviour back," the identical scoping comment
 * that module's own `installRunSignalHandlers` gives. `SIGKILL` cannot be caught by any handler in any
 * process; {@link recoverOrphanedParityDir} is this mechanism's OWN second layer for exactly that case,
 * mirroring `observe.ts`'s own dual-layer approach (a signal handler plus `listOrphanedWorktrees`) to
 * the identical "a signal this process cannot catch still has to leave something recoverable" problem.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M17.md P14
 * @see process/SPEC-QUESTIONS.md Q294 Decision 7
 */
import { renameSync, existsSync } from 'node:fs';
import { lstat, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';

import { ForgeError } from '@forge/core/errors';

/** Whether `absolutePath` exists, by any entry type — never branded `AbsolutePath` (`@forge/core/fs`'s
 * own `pathExists`), since the two paths this module checks are synthesised from `root` (an already-
 * absolute string handed in by `observe.ts`/`observe-http.ts`, never user input of its own), not drawn
 * from a `ProjectPaths` containment check this module has no reason to require one just to ask "is
 * anything here right now". */
async function exists(absolutePath: string): Promise<boolean> {
  try {
    await lstat(absolutePath);
    return true;
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return false;
    throw cause;
  }
}

/** The directory this module hides — `13` F-TEST-9's own fixed location, never configurable. */
const PARITY_DIR_NAME = 'parity';

/** Where the hidden directory moves to while absent: a FIXED, non-random sibling under `.forge/state/`
 * (gitignored, `18` §18.2) rather than a per-call generated name — `observe.ts`'s own "Sequential, one
 * case at a time" ordering already guarantees at most one case's command runs against a given `root`
 * at once, so there is no concurrent second caller for a fixed name to collide with, and a fixed name
 * needs no uninjected randomness (`QUALITY-BAR.md` R10). The identical fixed name is also what makes
 * {@link recoverOrphanedParityDir} decidable with no process-liveness check at all — see its own doc
 * comment. */
const HIDDEN_DIR_NAME = 'parity-isolated';

function parityDirPath(root: string): string {
  return path.join(root, '.forge', PARITY_DIR_NAME);
}

function hiddenDirPath(root: string): string {
  return path.join(root, '.forge', 'state', HIDDEN_DIR_NAME);
}

/** The real-and-hidden path pair for whichever single window is currently open — module-level,
 * deliberately: a signal can arrive on any turn of the event loop, and the handler that reacts to it
 * needs to know what to restore without the specific `withParityDirHidden` call that opened the window
 * passing it anything (the handler is installed and removed by that same call, but the restore target
 * has to be reachable from a plain, zero-argument signal callback). `observe.ts`'s own "Sequential, one
 * case at a time" ordering is what makes a single module-level slot sufficient: at most one window is
 * ever open at once for one process. */
let openWindow: { readonly real: string; readonly hidden: string } | undefined;

/** Restores `.forge/parity/` synchronously if, and only if, a window is currently open and the real
 * path is genuinely still absent — `node:fs`'s sync API, never the promise-based one, because a signal
 * handler that calls `process.exit` right after must not leave an `await` in flight (`process.exit`
 * skips everything still pending, the identical reason `run/run.ts`'s own `handleInterrupt` uses
 * `removeLiveLauncherShims`'s synchronous form instead of an async equivalent). Swallows its own
 * failure: a signal handler is the last code that will ever run in this process, so there is nothing
 * further it could do with an error besides report it, and reporting competes with the exit this
 * function exists to let happen cleanly. */
function restoreSyncIfWindowOpen(): void {
  if (openWindow === undefined) return;
  const { real, hidden } = openWindow;
  try {
    if (!existsSync(real) && existsSync(hidden)) {
      renameSync(hidden, real);
    }
  } catch {
    // Last resort already exhausted; see this function's own doc comment.
  }
  openWindow = undefined;
}

/** `128 + signal number`, the exit code a POSIX shell itself reports for a signalled process — the
 * identical convention `run/run.ts`'s own `handleInterrupt`/`installRunSignalHandlers` already use for
 * `SIGINT`/`SIGHUP`; `SIGTERM` mirrors that module's own `handleSigterm` in exiting `0` rather than
 * `128 + 15`, since a `SIGTERM` here (unlike an operator's own Ctrl+C) is far more often another part
 * of this same toolchain asking the process to stop cleanly. */
const SIGNAL_EXIT_CODES: Readonly<Record<'SIGINT' | 'SIGHUP' | 'SIGTERM', number>> = {
  SIGINT: 130,
  SIGHUP: 129,
  SIGTERM: 0,
};

/**
 * Installs `SIGINT`/`SIGHUP`/`SIGTERM` handlers that synchronously restore `.forge/parity/` if a
 * window is open when the signal arrives, then exit with the stated conventional code — and returns
 * the function that removes exactly those listeners again. Scoped to the duration a window is open,
 * mirroring `run/run.ts`'s own `installRunSignalHandlers` doc comment verbatim in spirit: "a process
 * that keeps living after the run gets its own signal behaviour back." `SIGKILL` cannot be caught by
 * any handler in any process — {@link recoverOrphanedParityDir} is this mechanism's own second layer
 * for exactly that case, not a gap this function is expected to also close.
 */
function installIsolationSignalHandlers(): () => void {
  const handlers: Record<'SIGINT' | 'SIGHUP' | 'SIGTERM', () => void> = {
    SIGINT: () => {
      restoreSyncIfWindowOpen();
      process.exit(SIGNAL_EXIT_CODES.SIGINT);
    },
    SIGHUP: () => {
      restoreSyncIfWindowOpen();
      process.exit(SIGNAL_EXIT_CODES.SIGHUP);
    },
    SIGTERM: () => {
      restoreSyncIfWindowOpen();
      process.exit(SIGNAL_EXIT_CODES.SIGTERM);
    },
  };
  process.on('SIGINT', handlers.SIGINT);
  process.on('SIGHUP', handlers.SIGHUP);
  process.on('SIGTERM', handlers.SIGTERM);
  return () => {
    process.off('SIGINT', handlers.SIGINT);
    process.off('SIGHUP', handlers.SIGHUP);
    process.off('SIGTERM', handlers.SIGTERM);
  };
}

/**
 * Whether the observed command re-created `.forge/parity/` while it was supposed to be absent — the
 * ONE check shared by every path `withParityDirHidden` can take (`fn` returning normally, `fn`
 * throwing, or both at once), so a case whose command tampers AND fails is caught exactly as reliably
 * as one that tampers and succeeds (a real gap a gauntlet round found: the original version of this
 * function checked for recreation only on `fn`'s success path, so a command that recreated the
 * directory and then threw its own error slipped past this check entirely, leaving the real original
 * stranded at `hidden` while a candidate-created `.forge/parity/` sat live and unflagged).
 */
async function wasRecreatedWhileHidden(real: string): Promise<boolean> {
  return exists(real);
}

/**
 * Runs `fn` with `.forge/parity/` (under `root`) absent, then restores it, returning `fn`'s own
 * result. Resolves to a no-op (no hide, no restore) when `.forge/parity/` does not exist under `root`
 * at all — a declaration-free project, or a reference-side call (never reached in practice: this
 * piece's own callers only ever pass the candidate's `root`, which is `projectRoot` itself).
 *
 * `fn`'s own thrown error, if any, propagates after the directory is restored (a `try`/`catch`), so a
 * case that fails for an unrelated reason never leaves the candidate's own `.forge/parity/` missing —
 * UNLESS `fn` also re-created `.forge/parity/` before throwing, in which case this throws `RUN-153`
 * instead of `fn`'s own error, for the identical reason the success path below does (see
 * {@link wasRecreatedWhileHidden}'s own doc comment for why both paths need the identical check, and
 * `QUALITY-BAR.md` R2: a recreated, unflagged directory silently masking `fn`'s own real failure would
 * itself be the more useful signal lost, so this one case is a deliberate, narrow exception to "a real
 * failure always wins over this module's own bookkeeping" — the recreation is real evidence about
 * `.forge/parity/`'s own trustworthiness that `fn`'s unrelated failure reason must not bury).
 *
 * @throws {ForgeError} `RUN-153` if `fn` itself created a NEW `.forge/parity/` while the real one was
 * absent (the observed command does not merely tamper with an existing file, but recreates the
 * directory outright, whether or not `fn` itself also threw) — refused rather than silently restored
 * over, which could either discard what the command wrote or silently adopt it as the new "capture
 * store", neither of which this piece is willing to decide on the command's behalf.
 */
export async function withParityDirHidden<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const real = parityDirPath(root);
  const hidden = hiddenDirPath(root);
  const existed = await exists(real);
  if (!existed) {
    let result: T;
    let fnError: unknown;
    let fnFailed = false;
    try {
      result = await fn();
    } catch (cause) {
      fnFailed = true;
      fnError = cause;
      result = undefined as never; // never read: `fnFailed` gates every use of `result` below.
    }
    if (await wasRecreatedWhileHidden(real)) {
      throw new ForgeError('RUN-153', { path: '.forge/parity' });
    }
    if (fnFailed) throw fnError;
    return result;
  }
  // `.forge/state/` is gitignored and not every project has created it yet by the time a case first
  // runs (no scratch worktree has been created under it, say) -- `rename`'s own target needs its
  // parent directory to already exist, so this module ensures it rather than assume some earlier
  // step already has.
  await mkdir(path.dirname(hidden), { recursive: true });
  await rename(real, hidden);
  openWindow = { real, hidden };
  const removeSignalHandlers = installIsolationSignalHandlers();
  let result: T;
  let fnError: unknown;
  let fnFailed = false;
  try {
    result = await fn();
  } catch (cause) {
    fnFailed = true;
    fnError = cause;
    result = undefined as never; // never read: `fnFailed` gates every use of `result` below.
  }
  removeSignalHandlers();
  openWindow = undefined;
  const recreated = await wasRecreatedWhileHidden(real);
  if (recreated) {
    // The observed command re-created `.forge/parity/` from scratch while it was supposed to be
    // absent -- refused rather than silently clobbered either way (see this function's own doc
    // comment), whether or not `fn` ALSO threw. The hidden, ORIGINAL directory is left at `hidden`
    // rather than discarded, since nothing in this module deletes real content a human authored.
    throw new ForgeError('RUN-153', { path: '.forge/parity' });
  }
  if (fnFailed) {
    // `fn` itself failed (very often BECAUSE `.forge/parity/` is absent -- exactly the point) and did
    // NOT recreate the directory: restore and propagate `fn`'s own error, never masked by a less
    // useful one from this function's own bookkeeping (the identical "a real failure wins over a
    // cleanup failure" rule `observe.ts`'s own `withReferenceWorktree` already follows).
    await rename(hidden, real);
    throw fnError;
  }
  await rename(hidden, real);
  return result;
}

/**
 * Restores a `.forge/parity/` left renamed away by a prior, now-dead invocation that could not clean
 * up after itself — `SIGKILL`, a host power loss, an OOM kill — none of which any in-process signal
 * handler can ever observe. Intended to run once, at the very start of `forge parity capture`/`check`,
 * before either command loads a single declaration (`capture-command.ts`/`check-command.ts`'s own
 * call sites).
 *
 * **Decidable with no process-liveness check at all — confirmed by the mechanism's own real
 * invariants, not assumed.** `withParityDirHidden` only ever opens one window per process, for the
 * exact duration of one case's own command (`observe.ts`'s own "Sequential, one case at a time"), and
 * always restores before returning control to its own caller on every path that function can take
 * (clean return, `fn` throwing, or a caught signal) — the only way `hiddenDirPath(root)` can still
 * exist at the moment a BRAND NEW top-level `forge parity capture`/`check` invocation starts is that
 * the process which created it is no longer running at all (a `SIGKILL`'d predecessor): nothing in
 * this file, or anywhere else, ever leaves it behind otherwise. This is the identical "ask git's own
 * worktree list, not an in-memory registry a crash would simply lose" reasoning `@forge/vcs`'s own
 * `listOrphanedWorktrees` doc comment gives for its own structurally-equivalent problem — here the
 * filesystem itself, rather than `git worktree list`, is the one source of truth neither process needs
 * to separately track.
 *
 * A no-op when `.forge/parity/` itself is ALSO present (both paths existing at once is not a shape
 * this module's own invariants predict, so this function deliberately does not guess which one is
 * "real" — a human reconciling the two by hand is safer than this function silently discarding
 * either), or when the hidden directory simply does not exist.
 */
export async function recoverOrphanedParityDir(root: string): Promise<void> {
  const real = parityDirPath(root);
  const hidden = hiddenDirPath(root);
  if ((await exists(hidden)) && !(await exists(real))) {
    await rename(hidden, real);
  }
}
