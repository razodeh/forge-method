/**
 * `forge doctor`'s own lock/worktree checks — `03` §3.7's "Locks: stale supervisor lock, orphaned
 * worktrees, dangling lane branches" bullet.
 *
 * @see specs/03 §3.7
 */
import { execa } from 'execa';
import { listDirEntriesSorted, pathExists, type ProjectPaths } from '@forge/core/fs';
import { listOrphanedWorktrees } from '@forge/vcs';

import { isProcessAlive, readRunLock } from '../run/lock.ts';
import type { CheckSeverity, DoctorCheck } from './types.ts';

function check(
  id: string,
  ok: boolean,
  severity: CheckSeverity,
  message: string,
  fix?: string,
): DoctorCheck {
  return fix === undefined ? { id, ok, severity, message } : { id, ok, severity, message, fix };
}

/** `.forge/state/lock.json` (`PLAN-M6.md` C4) — a lock naming a real, still-alive pid is not itself a
 * problem (a real `forge run` is genuinely in progress); a lock naming a dead pid is stale, real,
 * warning-worthy state `forge run`'s own `acquireRunLock` already reclaims silently on its own next
 * invocation, so this is informational, not `hard`. */
export async function checkStaleLock(paths: ProjectPaths): Promise<DoctorCheck> {
  const lock = await readRunLock(paths);
  if (lock === undefined) {
    return check('stale-lock', true, 'warning', 'No project lock held.');
  }
  if (isProcessAlive(lock.pid)) {
    return check(
      'stale-lock',
      true,
      'warning',
      `Lock held by real, live pid ${String(lock.pid)} (run ${lock.runId}).`,
    );
  }
  return check(
    'stale-lock',
    false,
    'warning',
    `Stale lock naming dead pid ${String(lock.pid)} (run ${lock.runId}).`,
    'The next `forge run`/`forge resume` reclaims this automatically, or run `forge doctor --fix`.',
  );
}

/** `@forge/vcs`'s own real `listOrphanedWorktrees` (M5) — every real worktree git itself still tracks
 * under the `forge/<runId>/<slug>` branch namespace that no *known* lane currently owns. `forge
 * doctor` has no live run's own `laneRegistry` to exclude against (unlike `resumeRun`'s own real
 * caller), so every real worktree this finds is, from a standalone `forge doctor` invocation's own
 * point of view, genuinely orphaned. */
export async function checkOrphanedWorktrees(projectRoot: string): Promise<DoctorCheck> {
  const orphans = await listOrphanedWorktrees(projectRoot);
  const ok = orphans.length === 0;
  return check(
    'orphaned-worktrees',
    ok,
    'warning',
    ok
      ? 'No orphaned lane worktrees.'
      : `${String(orphans.length)} real orphaned lane worktree(s).`,
    ok ? undefined : 'Run `git worktree remove <path>` for each, or `forge doctor --fix`.',
  );
}

/** `.forge/state/worktrees/` itself — where a lane or integration worktree lived before `PLAN-M17.md`
 * P8 (`06` §6.4's own pre-M17 rule) — still having any real entry in it at all, left by a pre-M17 run,
 * or by a project upgraded mid-run (`06` §6.4's own "Worktree location" paragraph: "`forge doctor`
 * reports any worktree it still finds under the old, in-tree location — left by a pre-M17 run, or by a
 * project upgraded mid-run — and offers to remove it; a project is not blocked from running while one
 * exists, since the engine itself never creates a lane there again"). `warning`, never `hard`, for the
 * identical reason that same sentence gives: a project with one of these is not broken, only carrying
 * disposable, no-longer-read leftover state.
 *
 * `paths.resolveState('worktrees')` (not `@forge/vcs`'s own `legacyInTreeWorktreesRoot`, which this
 * check's own report corroborates against the identical literal, `.forge/state/worktrees` — `18`
 * §18.3): the one route that reaches `.forge/state/` with a real, branded `AbsolutePath` back, rather
 * than an unexplained cast. `pathExists` first, same as `checkStaleLock`'s own "no lock file is
 * present" reads a missing lock file: a missing directory is the common, healthy case (nothing
 * pre-M17 ever ran against this project), never itself treated as a failure to list it; `pathExists`
 * already draws that exact "not found vs. a genuine failure" line (`@forge/core/fs`'s own doc
 * comment), so a real permission error past this point still surfaces honestly rather than being
 * silently read as "nothing here." */
export async function checkLegacyInTreeWorktrees(paths: ProjectPaths): Promise<DoctorCheck> {
  const legacyRoot = paths.resolveState('worktrees');
  const entries = (await pathExists(legacyRoot)) ? await listDirEntriesSorted(legacyRoot) : [];
  const ok = entries.length === 0;
  return check(
    'legacy-in-tree-worktrees',
    ok,
    'warning',
    ok
      ? 'No legacy in-tree worktrees (pre-M17 `.forge/state/worktrees/`).'
      : `${String(entries.length)} real entr${entries.length === 1 ? 'y' : 'ies'} under the legacy, ` +
          `pre-M17 ".forge/state/worktrees/" — the engine itself never reads or writes there any more.`,
    ok
      ? undefined
      : 'Confirm nothing references it (no run is mid-flight from before this project upgraded), ' +
          'then remove ".forge/state/worktrees/" by hand, or run `forge doctor --fix`.',
  );
}

/** A real branch under the `forge/` namespace with no matching real worktree currently checked out —
 * `@forge/vcs` has no such detector of its own (`listOrphanedWorktrees` only ever finds the reverse:
 * a worktree with no known lane, never a *branch* with no worktree at all), so this is genuinely new,
 * real logic: cross-references `git branch --list 'forge/*'` against `git worktree list
 * --porcelain`'s own real branch column. */
export async function checkDanglingLaneBranches(projectRoot: string): Promise<DoctorCheck> {
  const [branchListing, worktreeListing] = await Promise.all([
    execa('git', ['branch', '--list', 'forge/*'], { cwd: projectRoot }),
    execa('git', ['worktree', 'list', '--porcelain'], { cwd: projectRoot }),
  ]);
  const laneBranches = branchListing.stdout
    .split('\n')
    .map((line) => line.replace(/^\*?\s+/, '').trim())
    .filter((name) => name.startsWith('forge/'));
  const checkedOutBranches = new Set(
    worktreeListing.stdout
      .split('\n')
      .filter((line) => line.startsWith('branch '))
      .map((line) =>
        line
          .slice('branch '.length)
          .replace(/^refs\/heads\//, '')
          .trim(),
      ),
  );
  const dangling = laneBranches.filter((branch) => !checkedOutBranches.has(branch));
  const ok = dangling.length === 0;
  return check(
    'dangling-lane-branches',
    ok,
    'warning',
    ok
      ? 'No dangling lane branches.'
      : `${String(dangling.length)} real dangling lane branch(es): ${dangling.join(', ')}.`,
    ok
      ? undefined
      : 'Run `git branch -D <branch>` for each, once you have confirmed its work already merged.',
  );
}
