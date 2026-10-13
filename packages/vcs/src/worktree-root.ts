/**
 * Where lane and integration worktrees live, post-v1.0 (`specs/22` M17, Decision 6): a per-project
 * directory under the user's cache directory, keyed by a stable hash of the project's own real path —
 * never inside the project tree, which is what let any runner that globs the whole project (looking
 * for its own test files) discover a lane's own in-progress copy of them (`06` §6.4's own "Worktree
 * location" paragraph, `18` §18.3).
 *
 * Decision 6 (`PLAN-M17.md`) rejected the cheaper alternative — an exclusion list a runner's own
 * globbing config would have to carry — because that list would have to be taught to every runner
 * FORGE might ever work with, directly contradicting Decision 1 ("runner-agnostic testing is a
 * contract, not a list of supported runners"): a translator-based or in-house runner would need its
 * own copy of the exclusion, with no way for FORGE to ever prove it was applied. Moving the worktree
 * itself needs no runner cooperation at all.
 *
 * @see specs/06 §6.4
 * @see specs/18 §18.3
 * @see PLAN-M17.md P8 (Decision 6)
 */
import { createHash } from 'node:crypto';
import { access, realpath } from 'node:fs/promises';
import path from 'node:path';

import { systemCacheDirRoot } from './system-cache-dir.ts';

/** Hex characters of the project's own path digest kept in the cache directory name — short enough to
 * stay a readable path segment, long enough (64 bits) that no realistic number of real projects on one
 * machine, across any realistic span of time, collides by accident. */
const PROJECT_HASH_LENGTH = 16;

/**
 * A short, stable, filesystem- and git-ref-safe digest of `realProjectRoot` (already resolved through
 * `realpath`, so two different-looking paths that name the same real directory — a symlinked `/tmp` on
 * macOS, say — always hash identically). Deterministic (`QUALITY-BAR.md` R10): the same real path
 * always produces the same digest, on any machine, in any process.
 *
 * Hashes the real, absolute path rather than any project-level identity that could survive a move on
 * disk (a persisted project id, or the git repository's own root commit) — a deliberate, documented
 * DECISION (`PLAN-M17.md` P8's own report): two independent checkouts of the identical repository at
 * two different paths must never collide on one cache slot (which a content-derived key, such as the
 * root commit, cannot promise), and resuming a run that is still at the path it started from — by far
 * the overwhelmingly common case, since a resume exists to recover from a *crash*, not a relocation —
 * is what `06` §6.4's own "resume can find the same directory again" is actually asking for. The
 * documented cost: a project moved between a crash and its resume gets a fresh cache slot and starts
 * fresh lanes rather than reusing the old ones, which the old slot's own now-unreachable worktrees
 * still exist under — `forge doctor` (`locks-and-worktrees.ts`) is the reclaim path for those.
 */
export function projectCacheHash(realProjectRoot: string): string {
  return createHash('sha256').update(realProjectRoot).digest('hex').slice(0, PROJECT_HASH_LENGTH);
}

/**
 * Resolves `candidate`'s real path by walking up to its deepest *existing* ancestor and realpath-ing
 * that — the identical pattern (async form) `@forge/cli`'s own `ensureIntegrationWorktree` already
 * establishes (`context.ts`'s own private `realpathOfDeepestExistingAncestor`, built from its own
 * `pathExistsRaw`), itself mirroring `@forge/core/fs`'s sync original (`paths.ts`) for the identical
 * "the leaf may not exist yet, but the comparison still needs to be symlink-correct" problem;
 * duplicated locally (this package has no `core` edge, `specs/02` §2.2) rather than reused, the same
 * "a tiny, already-proven wrapper duplicated locally over a whole new package dependency" choice this
 * file's own sibling `lanes.ts` already makes for `listDirEntriesSorted`. `worktreesRootFor` below
 * calls this with `cacheDirRoot` alone as `candidate` — never the full, FORGE-specific
 * `forge/<hash>/worktrees` suffix, which is joined on afterward, outside this function entirely, since
 * nothing this codebase itself ever creates under that suffix is a symlink, so there is nothing further
 * down worth resolving. `cacheDirRoot` itself (`~/.cache`, `~/Library/Caches`, ...) is the one real case
 * genuinely worth guarding: it almost always already exists, but a sufficiently fresh machine or
 * container (nothing has ever created it yet) is the realistic case where it does not, and this walks
 * up to whichever real ancestor of it does.
 */
async function pathExistsRaw(candidate: string): Promise<boolean> {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function realpathOfDeepestExistingAncestor(candidate: string): Promise<string> {
  let probe = candidate;
  while (!(await pathExistsRaw(probe))) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  const realAncestor = await realpath(probe);
  const suffix = path.relative(probe, candidate);
  return suffix === '' ? realAncestor : path.join(realAncestor, suffix);
}

/**
 * `<cacheDirRoot>/forge/<project-hash>/worktrees` — the one function every lane and integration
 * worktree path in this codebase is built from (`lanes.ts`'s own `createLaneWorktree`/
 * `listOrphanedWorktrees`/`listOrphanedWorktreeDirectories`, `@forge/cli`'s own `ensureIntegrationWorktree`
 * and `mergeLane`, `@forge/engine`'s own `resumeRun`) — never recomputed ad hoc at a second call site,
 * which is exactly how two of those (`engine/src/resume/orchestrate.ts`'s own `laneWorktreePath`,
 * `cli/src/commands/run/merge.ts`'s own hand-built `LaneHandle`) drifted from this package's own
 * internal `worktreePath` before this piece, silently keeping the pre-M17 in-tree path indefinitely.
 *
 * `cacheDirRoot` defaults to the real platform cache directory (`systemCacheDirRoot`) — every real
 * caller omits it and gets the real location; a test passes a disposable one instead, so no test run
 * ever needs to touch (or can accidentally pollute) the real one. `test/global-setup.ts` additionally
 * pins the real `XDG_CACHE_HOME` env var itself to a disposable directory for the whole suite, so even
 * a call that omits this parameter stays sandboxed during a test run.
 *
 * Asynchronous — unlike `projectCacheHash` above — because `cacheDirRoot` is resolved through
 * `realpathOfDeepestExistingAncestor` before being joined: confirmed the hard way (a round of real
 * test failures this piece's own report records) that skipping this, unlike `realProjectRoot` — which
 * every real caller already resolves before calling this — reproduces the identical "os.tmpdir() is a
 * symlink on macOS" class of bug `lanes.ts`'s own `resolveCwd` doc comment already names, one level
 * up: `git worktree add` canonicalises the path it is given when it registers a worktree internally,
 * so a target built from an *unresolved* cache directory and the SAME real target git itself reports
 * back later (`isRegisteredWorktree`, `git branch -D`'s own "checked out at ...") compare unequal as
 * plain strings — observed directly as `removeLaneWorktree`'s final `git branch -D` step refusing,
 * "cannot delete branch ... checked out at" the fully-resolved path, even after the worktree-remove
 * step immediately before it reported success.
 */
export async function worktreesRootFor(
  realProjectRoot: string,
  cacheDirRoot: string = systemCacheDirRoot(),
): Promise<string> {
  const realCacheDirRoot = await realpathOfDeepestExistingAncestor(cacheDirRoot);
  return path.join(realCacheDirRoot, 'forge', projectCacheHash(realProjectRoot), 'worktrees');
}

/**
 * `<project>/.forge/state/worktrees` — where a lane or integration worktree lived before this piece
 * (`06` §6.4's own old rule). The engine itself never creates a worktree here again; this exists only
 * so `forge doctor` can recognise and offer to remove one left behind by a pre-M17 run, or by a project
 * upgraded mid-run (`06` §6.4's own "Worktree location" paragraph).
 */
export function legacyInTreeWorktreesRoot(realProjectRoot: string): string {
  return path.join(realProjectRoot, '.forge', 'state', 'worktrees');
}
