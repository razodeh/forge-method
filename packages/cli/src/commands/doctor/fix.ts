/**
 * `forge doctor --fix` — real, safe, automatic remediation for the three real checks
 * (`stale-lock`/`orphaned-worktrees`/`legacy-in-tree-worktrees`, the last since `PLAN-M17.md` P8) that
 * have one. Every other failing check has no safe automatic fix (deleting a possibly-unmerged dangling
 * lane branch, guessing at a missing `${secret:...}` value, rewriting a malformed `.forge/config.yaml`,
 * ...) and is reported here as exactly that — `applied: false`, with an honest reason — never a
 * fabricated "fixed" claim.
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
import path from 'node:path';

import { execa } from 'execa';
import type { ProjectPaths } from '@forge/core/fs';
import { listOrphanedWorktrees, parseWorktreeBlocks } from '@forge/vcs';

import { isProcessAlive, readRunLock, releaseRunLock } from '../run/lock.ts';
import { listLegacyRegisteredWorktrees } from './locks-and-worktrees.ts';
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

/** The real, registered worktree paths `git worktree list --porcelain` reports right now — used only
 * to snapshot state immediately around the unscoped `git worktree prune` call below, never as a
 * general-purpose listing (that is `@forge/vcs`'s own `listOrphanedWorktrees`/`parseWorktreeBlocks`,
 * reused here directly rather than re-implemented). */
async function registeredWorktreePaths(cwd: string): Promise<readonly string[]> {
  const { stdout } = await execa('git', ['worktree', 'list', '--porcelain'], { cwd });
  return parseWorktreeBlocks(stdout).map((block) => path.resolve(block.path));
}

/** The result of one `removeOrphanedWorktreeOnly` call: `collateralLoss` names every OTHER real,
 * registered worktree (never the one this call was actually asked to remove) whose own git
 * registration vanished as a side effect of this call's own `git worktree prune` fallback step —
 * DECISION (`PLAN-M17.md` P8's own report): see this function's own doc comment for why this is
 * detected and surfaced rather than prevented outright. Empty for the overwhelmingly common case
 * (`git worktree remove -f -f` itself succeeds, so `prune` is never even reached). */
interface OrphanRemovalResult {
  readonly collateralLoss: readonly string[];
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
 * decomposed into a worktree-only half and this file must never perform the branch-delete half.
 *
 * **DECISION — the fallback's own `git worktree prune` is unscoped, and that is now detected, not
 * merely documented.** A gauntlet critic round proved, directly, that `git worktree prune` treats ANY
 * worktree whose own `.git` pointer cannot be read as "gone" — not only one whose directory is
 * actually gone — and that this is repo-wide: a *second*, completely unrelated, still-real worktree
 * (not the one this call was asked to remove) that merely became transiently unreadable (a permission
 * hiccup, an unmounted path, nothing adversarial) loses its own git registration too, silently,
 * permanently (unlike the "directory already gone" case, this one does not self-heal — git's own
 * trace of it is what is gone, while its real directory and contents are left on disk, now invisible
 * to `listOrphanedWorktrees`/`checkOrphanedWorktrees`, both of which only ever consult `git worktree
 * list --porcelain`). Git offers no way to scope `prune` to one worktree, so this snapshots the real,
 * registered worktree set immediately before and after the fallback's own `prune` call and reports any
 * OTHER entry that disappeared as `collateralLoss` — surfaced loudly by both real callers below, never
 * silently absorbed the way a `prune` failure itself still safely is (that case, unlike this one,
 * genuinely self-heals: `listOrphanedWorktrees`'s own doc comment already covers it). This cannot
 * un-prune anything already gone — once git's own registration is gone, only a human re-adding it by
 * hand (after inspecting what is actually there) gets it back — so detection and a loud warning is the
 * most this function can honestly do, which is exactly why it matters this much that it is never
 * silent about it. */
async function removeOrphanedWorktreeOnly(
  cwd: string,
  targetPath: string,
): Promise<OrphanRemovalResult> {
  try {
    await execa('git', ['worktree', 'remove', '-f', '-f', targetPath], { cwd });
    return { collateralLoss: [] };
  } catch {
    // Falls through to the raw-filesystem fallback below — see this function's own doc comment.
  }
  const before = await registeredWorktreePaths(cwd);
  await rm(targetPath, { recursive: true, force: true });
  try {
    await execa('git', ['worktree', 'unlock', targetPath], { cwd });
  } catch {
    // Was never locked at all — an expected, harmless case, not a real failure.
  }
  let collateralLoss: readonly string[] = [];
  try {
    await execa('git', ['worktree', 'prune'], { cwd });
    // Only computed on a successful prune: a failed one changed nothing, so there is nothing new to
    // detect (and `registeredWorktreePaths` itself would be exactly as likely to fail again).
    const after = await registeredWorktreePaths(cwd);
    const resolvedTarget = path.resolve(targetPath);
    const afterResolved = new Set(after);
    collateralLoss = before.filter(
      (candidate) => candidate !== resolvedTarget && !afterResolved.has(candidate),
    );
  } catch {
    // The real, disk-level removal (`rm` above) already succeeded by the time `prune` runs — a real
    // gauntlet critic round found a `prune` failure here (transient, or a concurrent git operation)
    // was reported as this whole orphan's own removal having failed, undercounting a fix that had, in
    // every way that matters to the user, already happened. `prune` only reconciles git's own
    // administrative bookkeeping for a directory that is provably already gone; a caller re-running
    // `forge doctor` afterward reconciles this the identical way `listOrphanedWorktrees`'s own doc
    // comment already describes for the general case (a leftover git-only registration is still
    // rediscoverable and re-reclaimable on a later pass), so swallowing this one failure here is safe
    // — unlike a successful prune's own collateral loss above, which is not safe to swallow.
  }
  return { collateralLoss };
}

/** A loud, impossible-to-miss suffix for any `collateralLoss` a batch of `removeOrphanedWorktreeOnly`
 * calls accumulated — never folded quietly into the ordinary success message, and never dropped just
 * because the fix that caused it otherwise succeeded. Empty string when nothing collateral happened,
 * which is the overwhelmingly common case. */
function collateralLossWarning(collateralLoss: readonly string[]): string {
  if (collateralLoss.length === 0) return '';
  return (
    ` WARNING: removing the above also made git lose its OWN registration for ` +
    `${String(collateralLoss.length)} other real worktree(s), unrelated to the ones just fixed: ` +
    `${collateralLoss.join(', ')}. Their own directories and content are untouched on disk but no ` +
    `longer tracked by git at all — inspect each one by hand and re-register it with ` +
    `\`git worktree add --force <path> <branch>\` (reading what is really there first) before running ` +
    `\`forge doctor --fix\` again.`
  );
}

/** Each real orphan is removed independently, its own real failure isolated from every other's — a
 * fresh gauntlet critic round found the original version let one failing removal (a locked worktree, a
 * permission error, any real transient git failure) abort the whole loop, silently leaving every later
 * orphan in the list untouched and unreported. */
async function fixOrphanedWorktrees(projectRoot: string): Promise<DoctorFixResult> {
  let orphans;
  try {
    orphans = await listOrphanedWorktrees(projectRoot);
  } catch (cause) {
    // A second, independent gauntlet critic round found this exact call — `listOrphanedWorktrees`
    // itself, not just the per-orphan removal below — unguarded: it internally calls `wrapGitFailure`
    // (`@forge/vcs`), which throws a real `VcsError` for a `git worktree list --porcelain` failure
    // that survives even that function's own repair-and-retry path. Left unguarded, this would have
    // been the exact "one real exception to this file's own never-throws contract" shape a first
    // critic round already found and fixed once for `kbSync`, just relocated to a new call site.
    return {
      id: 'orphaned-worktrees',
      applied: false,
      message: `Could not list orphaned lane worktrees to fix them: ${causeMessage(cause)}.`,
    };
  }
  if (orphans.length === 0) {
    return {
      id: 'orphaned-worktrees',
      applied: false,
      message: 'No orphaned lane worktrees remain to fix.',
    };
  }

  let removedCount = 0;
  const failures: string[] = [];
  const collateralLoss: string[] = [];
  for (const handle of orphans) {
    try {
      const result = await removeOrphanedWorktreeOnly(projectRoot, handle.path);
      collateralLoss.push(...result.collateralLoss);
      removedCount += 1;
    } catch (cause) {
      failures.push(`${handle.path}: ${causeMessage(cause)}`);
    }
  }
  const warning = collateralLossWarning(collateralLoss);

  if (failures.length === 0) {
    return {
      id: 'orphaned-worktrees',
      applied: true,
      message:
        `Removed ${String(removedCount)} real orphaned lane worktree(s). Each one's own lane ` +
        'branch is deliberately left in place — resolve it by hand (see the dangling-lane-branches ' +
        `check) once you have confirmed its work already merged.${warning}`,
    };
  }
  return {
    id: 'orphaned-worktrees',
    applied: removedCount > 0,
    message: `Removed ${String(removedCount)} of ${String(orphans.length)} real orphaned lane worktree(s); ${String(failures.length)} failed: ${failures.join('; ')}.${warning}`,
  };
}

/** `.forge/state/worktrees/` (`checkLegacyInTreeWorktrees`'s own report, `locks-and-worktrees.ts`) —
 * each real entry removed the SAME way `fixOrphanedWorktrees` above removes one of ITS own real
 * targets (`removeOrphanedWorktreeOnly`, reused directly rather than duplicated): a project "upgraded
 * mid-run" (`06` §6.4's own "Worktree location" paragraph) can leave an entry here that git itself
 * STILL has a real, registered worktree record for — created by an older FORGE version, before this
 * piece's own `PLAN-M17.md` P8 moved where a new one is ever placed — so a plain filesystem `rm`
 * alone, skipping git entirely, would leave a dangling `.git/worktrees/<name>/` administrative entry
 * behind with nothing real to back it. `removeOrphanedWorktreeOnly`'s own `git worktree remove`-first,
 * raw-`rm`-fallback shape handles both that case and a genuinely disconnected leftover (never
 * registered with git at all, or already pruned) identically — never the branch-delete half
 * `removeLaneWorktree` also performs, for the identical "a human decides a branch's fate, not `--fix`"
 * reason `fixOrphanedWorktrees`'s own doc comment already gives.
 *
 * **Only ever touches entries `listLegacyRegisteredWorktrees` (`locks-and-worktrees.ts`) confirms are
 * real, git-registered worktrees** — never a bare directory listing. A gauntlet critic round proved
 * directly that the first version of this function, which treated ANY entry under the legacy path as
 * a worktree, deleted a stray file with real, unrelated user content outright the moment `git worktree
 * remove` refused it (correctly: it was never a worktree) and the old code fell through to an
 * unconditional `rm` regardless. See `checkLegacyInTreeWorktrees`'s own doc comment for the fuller
 * reasoning — once this migration ships, nothing ever creates a real worktree here again, so this is
 * the expected steady state of every ordinary file a project happens to have at this path, not a rare
 * shape worth trading off against. */
async function fixLegacyInTreeWorktrees(
  paths: ProjectPaths,
  projectRoot: string,
): Promise<DoctorFixResult> {
  const legacyRoot = paths.resolveState('worktrees');
  let realWorktrees: readonly string[];
  try {
    realWorktrees = await listLegacyRegisteredWorktrees(projectRoot, legacyRoot);
  } catch (cause) {
    return {
      id: 'legacy-in-tree-worktrees',
      applied: false,
      message: `Could not list the legacy in-tree worktrees directory to fix it: ${causeMessage(cause)}.`,
    };
  }
  if (realWorktrees.length === 0) {
    return {
      id: 'legacy-in-tree-worktrees',
      applied: false,
      message: 'No real, git-registered legacy in-tree worktrees remain to fix.',
    };
  }

  let removedCount = 0;
  const failures: string[] = [];
  const collateralLoss: string[] = [];
  for (const entryPath of realWorktrees) {
    try {
      const result = await removeOrphanedWorktreeOnly(projectRoot, entryPath);
      collateralLoss.push(...result.collateralLoss);
      removedCount += 1;
    } catch (cause) {
      failures.push(`${entryPath}: ${causeMessage(cause)}`);
    }
  }
  const warning = collateralLossWarning(collateralLoss);

  if (failures.length === 0) {
    return {
      id: 'legacy-in-tree-worktrees',
      applied: true,
      message: `Removed ${String(removedCount)} real legacy in-tree worktree entr${removedCount === 1 ? 'y' : 'ies'}.${warning}`,
    };
  }
  return {
    id: 'legacy-in-tree-worktrees',
    applied: removedCount > 0,
    message: `Removed ${String(removedCount)} of ${String(realWorktrees.length)} real legacy in-tree worktree entries; ${String(failures.length)} failed: ${failures.join('; ')}.${warning}`,
  };
}

/** Applies `--fix`'s real remediation for one failed check, or reports honestly that none exists.
 * Never called for a check that already passed (`runDoctor`'s own caller only invokes this for
 * `checks.filter((c) => !c.ok)`). Never throws: every branch that performs a real, external side
 * effect (`fixStaleLock`/`fixOrphanedWorktrees`/`fixLegacyInTreeWorktrees`) already catches its own
 * real failures into an honest `applied: false` result, matching `runChecks`'s own "never throws"
 * contract for the checks themselves. */
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
    case 'legacy-in-tree-worktrees':
      return fixLegacyInTreeWorktrees(paths, projectRoot);
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
