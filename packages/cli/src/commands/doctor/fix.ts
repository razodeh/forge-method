/**
 * `forge doctor --fix` — real, safe, automatic remediation for the two real checks
 * (`stale-lock`/`orphaned-worktrees`) that have one. Every other failing check has no safe automatic
 * fix (deleting a possibly-unmerged dangling lane branch, guessing at a missing `${secret:...}` value,
 * rewriting a malformed `.forge/config.yaml`, ...) and is reported here as exactly that —
 * `applied: false`, with an honest reason — never a fabricated "fixed" claim.
 *
 * Every real, external operation in this file (a git subprocess, a filesystem removal) is wrapped so a
 * genuine failure degrades to an honest `DoctorFixResult` rather than throwing out of `applyDoctorFix`
 * — a fresh gauntlet critic round found the first version of this file let a single failing
 * `removeLaneWorktree` call (a real, documented `VcsError` path) propagate straight out of `runDoctor`,
 * crashing the whole `--fix` run and losing every result already computed for prior fixes in the same
 * pass. `--fix` is explicitly the one place in this module that performs real, external, potentially
 * fallible side effects — the existing checks it builds on stay read-only.
 *
 * @see specs/03 §3.7
 * @see specs/21 E10
 * @see PLAN-M11.md P14
 * @see SPEC-QUESTIONS.md
 */
import { rm } from 'node:fs/promises';

import { execa } from 'execa';
import type { ProjectPaths } from '@forge/core/fs';
import { listOrphanedWorktrees } from '@forge/vcs';

import { isProcessAlive, readRunLock, releaseRunLock } from '../run/lock.ts';
import type { DoctorCheck, DoctorFixResult } from './types.ts';

function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

async function fixStaleLock(paths: ProjectPaths): Promise<DoctorFixResult> {
  let lock;
  try {
    lock = await readRunLock(paths);
  } catch (cause) {
    return {
      id: 'stale-lock',
      applied: false,
      message: `Could not read the lock file to fix it: ${causeMessage(cause)}.`,
    };
  }
  if (lock === undefined) {
    return { id: 'stale-lock', applied: false, message: 'No lock file is present to fix.' };
  }
  if (isProcessAlive(lock.pid)) {
    return {
      id: 'stale-lock',
      applied: false,
      message: `Lock is held by real, live pid ${String(lock.pid)}; not touched.`,
    };
  }
  try {
    await releaseRunLock(paths);
  } catch (cause) {
    return {
      id: 'stale-lock',
      applied: false,
      message: `Found a real, stale lock naming dead pid ${String(lock.pid)} but could not clear it: ${causeMessage(cause)}.`,
    };
  }
  return {
    id: 'stale-lock',
    applied: true,
    message: `Cleared stale lock naming dead pid ${String(lock.pid)} (run ${lock.runId}).`,
  };
}

/** Removes the real, registered worktree at `targetPath` — the worktree only, deliberately never its
 * own lane branch (`checkOrphanedWorktrees`'s own remedy text, `locks-and-worktrees.ts`, names only
 * `git worktree remove <path>`, never a branch delete). `@forge/vcs`'s own `removeLaneWorktree` does
 * both together (`git branch -D` as well), the right choice for its own real caller (`06` §6.4 step
 * 5's own normal, successful lane cleanup) but the wrong one here: an *orphaned* worktree is exactly
 * the state a crashed or deliberately-retained failed lane leaves behind
 * (`execution.retainLaneWorktrees: on-failure`, `18` §18.3) — its branch can carry real, unmerged
 * commits a human has not yet reviewed. `checkDanglingLaneBranches`'s own remedy text already treats
 * branch deletion as the one operation in this whole checklist that needs a human to "confirm its work
 * already merged" first; `--fix` does not override that judgment call merely because the worktree that
 * used to make the branch reachable by checkout is now gone. A newly-dangling branch left behind here
 * is a real, expected, honestly-reported outcome of this function — `checkDanglingLaneBranches` picks
 * it up on the very next `forge doctor` run. See `SPEC-QUESTIONS.md` for the full record.
 *
 * `-f -f` plus the raw-filesystem/`prune` fallback mirrors `removeLaneWorktree`'s own real,
 * empirically-verified worktree-removal half exactly (see its own doc comment for the full reasoning
 * per step); duplicated locally, deliberately, rather than reused, since the shared function is not
 * decomposed into a worktree-only half and this file must never perform the branch-delete half. */
async function removeOrphanedWorktreeOnly(cwd: string, targetPath: string): Promise<void> {
  try {
    await execa('git', ['worktree', 'remove', '-f', '-f', targetPath], { cwd });
    return;
  } catch {
    // Falls through to the raw-filesystem fallback below — see this function's own doc comment.
  }
  await rm(targetPath, { recursive: true, force: true });
  try {
    await execa('git', ['worktree', 'unlock', targetPath], { cwd });
  } catch {
    // Was never locked at all — an expected, harmless case, not a real failure.
  }
  await execa('git', ['worktree', 'prune'], { cwd });
}

/** Each real orphan is removed independently, its own real failure isolated from every other's — a
 * fresh gauntlet critic round found the original version let one failing removal (a locked worktree, a
 * permission error, any real transient git failure) abort the whole loop, silently leaving every later
 * orphan in the list untouched and unreported. */
async function fixOrphanedWorktrees(projectRoot: string): Promise<DoctorFixResult> {
  const orphans = await listOrphanedWorktrees(projectRoot);
  if (orphans.length === 0) {
    return {
      id: 'orphaned-worktrees',
      applied: false,
      message: 'No orphaned lane worktrees remain to fix.',
    };
  }

  let removedCount = 0;
  const failures: string[] = [];
  for (const handle of orphans) {
    try {
      await removeOrphanedWorktreeOnly(projectRoot, handle.path);
      removedCount += 1;
    } catch (cause) {
      failures.push(`${handle.path}: ${causeMessage(cause)}`);
    }
  }

  if (failures.length === 0) {
    return {
      id: 'orphaned-worktrees',
      applied: true,
      message:
        `Removed ${String(removedCount)} real orphaned lane worktree(s). Each one's own lane ` +
        'branch is deliberately left in place — resolve it by hand (see the dangling-lane-branches ' +
        'check) once you have confirmed its work already merged.',
    };
  }
  return {
    id: 'orphaned-worktrees',
    applied: removedCount > 0,
    message: `Removed ${String(removedCount)} of ${String(orphans.length)} real orphaned lane worktree(s); ${String(failures.length)} failed: ${failures.join('; ')}.`,
  };
}

/** Applies `--fix`'s real remediation for one failed check, or reports honestly that none exists.
 * Never called for a check that already passed (`runDoctor`'s own caller only invokes this for
 * `checks.filter((c) => !c.ok)`). Never throws: every branch that performs a real, external side
 * effect (`fixStaleLock`/`fixOrphanedWorktrees`) already catches its own real failures into an honest
 * `applied: false` result, matching `runChecks`'s own "never throws" contract for the checks
 * themselves. */
export async function applyDoctorFix(
  check: DoctorCheck,
  paths: ProjectPaths,
  projectRoot: string,
): Promise<DoctorFixResult> {
  switch (check.id) {
    case 'stale-lock':
      return fixStaleLock(paths);
    case 'orphaned-worktrees':
      return fixOrphanedWorktrees(projectRoot);
    default:
      return {
        id: check.id,
        applied: false,
        message:
          check.fix === undefined
            ? 'No safe automatic fix exists for this check; it must be resolved by hand.'
            : `No safe automatic fix exists for this check; ${check.fix}`,
      };
  }
}
