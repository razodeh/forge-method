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
 * **Why bracketing the exact command, not the whole observation.** A case's own overlay inputs (and,
 * for `library`, its probe) are read FROM `.forge/parity/` immediately before that case's command runs
 * (`overlay.ts`'s `readOverlaySourceBytes`, called from `observe.ts`'s `observeOneCase` and
 * `observe-http.ts`'s `observeOneHttpCase`) — hiding the directory for anything wider than the command
 * itself would break that read. Bracketing precisely the command (never the before/after cleanliness
 * snapshot either, `observe.ts`'s own `takeTreeSnapshot` calls) also means neither snapshot ever
 * observes the hide/restore itself: both see the directory in its one, ordinary, present state, so
 * `isCleanExcluding`'s before/after comparison is unaffected by this mechanism's own bookkeeping.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M17.md P14
 * @see process/SPEC-QUESTIONS.md Q294 Decision 7
 */
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
 * needs no uninjected randomness (`QUALITY-BAR.md` R10). */
const HIDDEN_DIR_NAME = 'parity-isolated';

function parityDirPath(root: string): string {
  return path.join(root, '.forge', PARITY_DIR_NAME);
}

function hiddenDirPath(root: string): string {
  return path.join(root, '.forge', 'state', HIDDEN_DIR_NAME);
}

/**
 * Runs `fn` with `.forge/parity/` (under `root`) absent, then restores it, returning `fn`'s own
 * result. Resolves to a no-op (no hide, no restore) when `.forge/parity/` does not exist under `root`
 * at all — a declaration-free project, or a reference-side call (never reached in practice: this
 * piece's own callers only ever pass the candidate's `root`, which is `projectRoot` itself).
 *
 * `fn`'s own thrown error, if any, propagates after the directory is restored (a `try`/`finally`), so
 * a case that fails for an unrelated reason never leaves the candidate's own `.forge/parity/` missing.
 *
 * @throws {ForgeError} `RUN-153` if `fn` itself created a NEW `.forge/parity/` while the real one was
 * absent (the observed command does not merely tamper with an existing file, but recreates the
 * directory outright) — refused rather than silently restored over, which could either discard what
 * the command wrote or silently adopt it as the new "capture store", neither of which this piece is
 * willing to decide on the command's behalf.
 */
export async function withParityDirHidden<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const real = parityDirPath(root);
  const hidden = hiddenDirPath(root);
  const existed = await exists(real);
  if (!existed) {
    const result = await fn();
    if (await exists(real)) {
      throw new ForgeError('RUN-153', { path: '.forge/parity' });
    }
    return result;
  }
  // `.forge/state/` is gitignored and not every project has created it yet by the time a case first
  // runs (no scratch worktree has been created under it, say) -- `rename`'s own target needs its
  // parent directory to already exist, so this module ensures it rather than assume some earlier
  // step already has.
  await mkdir(path.dirname(hidden), { recursive: true });
  await rename(real, hidden);
  let result: T;
  try {
    result = await fn();
  } catch (cause) {
    // `fn` itself failed (very often BECAUSE `.forge/parity/` is absent -- exactly the point): restore
    // on a best-effort basis and propagate `fn`'s own error, never masked by a less useful one from
    // this function's own bookkeeping (the identical "a real failure wins over a cleanup failure"
    // rule `observe.ts`'s own `withReferenceWorktree` already follows).
    if (!(await exists(real))) {
      await rename(hidden, real);
    }
    throw cause;
  }
  if (await exists(real)) {
    // `fn` succeeded, yet `.forge/parity/` now exists: the observed command re-created it from
    // scratch while it was supposed to be absent. Refused rather than silently clobbered either way
    // (see this function's own doc comment); the hidden, ORIGINAL directory is left at `hidden`
    // rather than discarded, since nothing in this module deletes real content a human authored.
    throw new ForgeError('RUN-153', { path: '.forge/parity' });
  }
  await rename(hidden, real);
  return result;
}
