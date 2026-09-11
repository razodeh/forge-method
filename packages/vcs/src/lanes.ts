/**
 * Lane worktree lifecycle: `06` §6.4's own lane lifecycle steps 1 ("`git worktree add -b
 * forge/<runId>/<stepId-slug> <path> <integration-base>`") and 5 ("`git worktree remove --force`,
 * delete branch (configurable retain)"). Direct `git` subprocess via `execa`, not `simple-git` — `02`
 * §2.1's own tech decision: "worktree support in libs is weak."
 *
 * @see specs/06 §6.4
 * @see specs/18 §18.2
 * @see specs/20 §20.2, §20.10
 * @see PLAN-M5.md P2
 */
import { execa } from 'execa';
import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import { readFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';

import { resolveRevision, wrapGitFailure } from './git.ts';

interface SortedDirEntry {
  readonly name: string;
  readonly isDirectory: boolean;
}

/** `fs.readdir`'s own order is filesystem-dependent (platform, filesystem implementation, a
 * directory's own history of added/removed entries) — R10 requires sorting explicitly before any
 * caller ever sees the result, the identical "the unordered read is contained here and never returned
 * without the sort immediately below" wrapper `@forge/core/fs`'s own `listDirEntriesSorted` already
 * establishes for the identical reason (this module cannot depend on `@forge/core` at all — `vcs`'s own
 * row in `specs/02` §2.2's dependency graph is `['schemas']`, deliberately minimal — so the tiny, already-
 * proven wrapper is duplicated locally rather than pulling in a whole new package dependency for it).
 * Empty (never throws) when `dir` does not exist at all — every real call site in this module already
 * treats "nothing here yet" as a legitimate, expected outcome, never a real failure to propagate. */
async function listDirEntriesSorted(dir: string): Promise<readonly SortedDirEntry[]> {
  let entries;
  try {
    // eslint-disable-next-line no-restricted-syntax -- sorted immediately below, see this function's own doc comment
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

declare const LANE_ID_BRAND: unique symbol;

/** `${runId}-${slugifyStepId(stepId)}` — the `.forge/state/worktrees/<laneId>/` path segment (`18`
 * §18.2). Deliberately not the same string as the branch name: a branch name uses `/` as a namespace
 * separator (`forge/<runId>/<slug>`), which is exactly what a filesystem path segment must not contain
 * — flattening it here, once, is what keeps every other function in this module from having to think
 * about the difference. Branded so a plain string cannot be passed where a real, derived lane id is
 * expected without going through `formatLaneId`. */
export type LaneId = string & { readonly [LANE_ID_BRAND]: true };

export interface LaneHandle {
  readonly laneId: LaneId;
  /** Absolute path to the worktree. */
  readonly path: string;
  /** The lane branch name, e.g. `forge/run_01H.../implement-story-014-a1b2c3d4`. */
  readonly branch: string;
}

const SLUG_MAX_READABLE_LENGTH = 40;
const SLUG_HASH_LENGTH = 8;

/** A deterministic, git-ref-safe and filesystem-safe rendering of `stepId`, always ending in a short
 * hash of the *full, original* `stepId` — never bare. Two distinct, necessary properties this buys:
 *
 * 1. **Collision resistance.** The human-readable portion is lossy by design (case and most
 *    punctuation folded away) — `06` §6.2's own step id format is `${workflowId}:${stepId}
 *    [:${itemKey}]`, and two realistic, *different* ids like `STORY-014` and `story:014` fold to the
 *    identical string without it. A gauntlet critic round found that, without a disambiguator, git's
 *    own "branch already exists" refusal (`createLaneWorktree`'s own collision guard) only catches this
 *    while the *first* colliding lane is still alive — once it completes and is removed, creating a
 *    second lane for the colliding id silently succeeds and produces an indistinguishable `laneId`/
 *    branch/path, with no error at all. A hash of the full, unfolded input makes two different inputs
 *    collide only if they also collide on the hash — astronomically unlikely at 8 hex characters for
 *    any realistic number of concurrent or historical lanes — while the *same* input still slugifies
 *    identically every time (this function stays a pure, deterministic map).
 * 2. **No bare Windows-reserved device name.** Confirmed empirically that git itself performs no
 *    cross-platform ref-safety check and will happily create a branch literally named `con`, `nul`,
 *    `aux`, `prn`, `com1`, `lpt1`, etc. — reserved words a Windows-hosted git using loose refs would
 *    plausibly fail to create as a file (`02` §2.1: Windows is first-class). Because the hash suffix is
 *    never omitted, the final path segment can never be *exactly* one of those words.
 *
 * The readable portion is also length-capped (`02` §2.1, Windows' legacy `MAX_PATH` budget matters more
 * here than on POSIX, and this segment nests under `.forge/state/worktrees/<laneId>/` plus a full
 * checked-out repository) — the hash suffix keeps the result unique even after truncation collapses two
 * different long ids' readable portions together. */
export function slugifyStepId(stepId: string): string {
  const readable = stepId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_READABLE_LENGTH)
    .replace(/-+$/g, '');
  const base = readable === '' ? 'step' : readable;
  const disambiguator = createHash('sha256')
    .update(stepId)
    .digest('hex')
    .slice(0, SLUG_HASH_LENGTH);
  return `${base}-${disambiguator}`;
}

/** `forge/<runId>/<stepId-slug>` — `06` §6.4's own literal branch naming pattern, namespaced so a lane
 * branch can never collide with a human branch (`20` §20.2 point 4). `runId` is trusted as already
 * ref-safe (a FORGE-generated identifier, not user-authored text — unlike `stepId`, which flows from a
 * workflow YAML file `15` lets a project overlay). */
export function laneBranchName(runId: string, stepId: string): string {
  return `forge/${runId}/${slugifyStepId(stepId)}`;
}

function formatLaneId(runId: string, slug: string): LaneId {
  return `${runId}-${slug}` as LaneId;
}

function laneIdFor(runId: string, stepId: string): LaneId {
  return formatLaneId(runId, slugifyStepId(stepId));
}

function worktreePath(cwd: string, laneId: LaneId): string {
  return path.join(cwd, '.forge', 'state', 'worktrees', laneId);
}

/** `cwd`, with every symlink in it resolved — required before computing or comparing any worktree path
 * against git's own `worktree list` output, which canonicalises the path it was given internally
 * before reporting it back. Confirmed empirically (not merely suspected): on macOS, `os.tmpdir()`
 * itself is a symlink (`/var` → `/private/var`), so a path built from an *unresolved* `cwd` and a path
 * git reports for the exact same real directory compare unequal as plain strings even though they name
 * the same location — the identical class of bug a prior gauntlet round (`PLAN-M4.md` P4, C2) already
 * hit once for a different check in this same codebase. Requires `cwd` to already exist (the main
 * repository — every caller of this module already requires that to be true) — wrapped in
 * `wrapGitFailure` like every other fallible call in this module, so a nonexistent `cwd` rejects with
 * the same `VcsError` guarantee as everything else here, not a raw `ENOENT` from `node:fs`. */
async function resolveCwd(cwd: string): Promise<string> {
  return wrapGitFailure(() => realpath(cwd), `resolving "${cwd}" to its real, symlink-free path`);
}

/** `git worktree add -b <branch> <path> <resolved-integration-base>`, into `.forge/state/worktrees/
 * <laneId>/` (git creates every missing parent directory itself, confirmed empirically — no separate
 * `mkdir` needed). Two lane creations for the same `(runId, stepId)` pair collide on the branch name;
 * git's own "a branch named '...' already exists" refusal is what surfaces that (wrapped into a
 * `VcsError` like every other failure in this package), not a separate check here — one collision
 * detector, not two that could disagree. */
export async function createLaneWorktree(
  cwd: string,
  options: { readonly runId: string; readonly stepId: string; readonly integrationBase: string },
): Promise<LaneHandle> {
  const resolvedCwd = await resolveCwd(cwd);
  const laneId = laneIdFor(options.runId, options.stepId);
  const branch = laneBranchName(options.runId, options.stepId);
  const target = worktreePath(resolvedCwd, laneId);
  const resolvedBase = await resolveRevision(resolvedCwd, options.integrationBase);

  await wrapGitFailure(
    () =>
      execa('git', ['worktree', 'add', '-b', branch, target, resolvedBase], { cwd: resolvedCwd }),
    `creating lane worktree for "${options.stepId}" (run "${options.runId}")`,
  );

  return { laneId, path: target, branch };
}

/** Whether `targetPath` is currently a worktree git itself knows about — read from `git worktree list`,
 * the same source-of-truth `listOrphanedWorktrees` uses, never a bare filesystem existence check (which
 * would miss a *prunable* worktree: one whose directory is already gone but git's own registration is
 * not, still a real worktree as far as `git worktree remove` is concerned). */
async function isRegisteredWorktree(cwd: string, targetPath: string): Promise<boolean> {
  const { stdout } = await execa('git', ['worktree', 'list', '--porcelain'], { cwd });
  const resolvedTarget = path.resolve(targetPath);
  return extractWorktreePaths(stdout).some(
    (worktreePathValue) => path.resolve(worktreePathValue) === resolvedTarget,
  );
}

/** Whether `branch` currently exists — `git branch --list <branch>` reliably returns empty output
 * (exit 0, no error) for a branch that does not exist, never throwing, so this needs no `wrapGitFailure`
 * classification of its own. */
async function branchExists(cwd: string, branch: string): Promise<boolean> {
  const { stdout } = await execa('git', ['branch', '--list', branch], { cwd });
  return stdout.trim() !== '';
}

/** `git worktree remove` plus `git branch -D`, or neither when `retain` is true — `06` §6.4 step 5's
 * own "configurable retain" governs both together, matching `execution.retainLaneWorktrees` (`18`
 * §18.3: `never | on-failure | always`) — translating that three-way policy into this one boolean is
 * the caller's job, not this function's.
 *
 * Each of the two steps only runs if its own target still exists, checked structurally against git's
 * own state immediately beforehand — not attempted unconditionally and not inferred from whether the
 * *other* step succeeded. This is what makes the whole function safely retriable after a partial
 * failure: a gauntlet critic round found that killing the process between the worktree-remove and the
 * branch-delete steps left a branch with no worktree that neither a retried `createLaneWorktree` (git's
 * own "branch already exists" refusal fires forever) nor a retried call to this same function (the old
 * unconditional `worktree remove` call failed first, on a path that was already gone, so `branch -D`
 * was never reached) could ever recover from — and that was true even though `listOrphanedWorktrees`
 * cannot see a branch-with-no-worktree at all, so nothing in this module's public surface could
 * discover it either. Checking first removes the dependency on *how* a prior attempt failed.
 *
 * `-f -f` (double force, not single), confirmed empirically to be git's own documented override for a
 * *locked* worktree ("use 'remove -f -f' to override or unlock first") — a plausible state for a failed
 * lane a human is inspecting (`06` §6.4 step 4 explicitly leaves a failed lane's worktree in place for
 * inspection) to end up in, and one a single `--force` cannot clear on its own.
 *
 * Even `-f -f` still refuses outright — "validation failed, cannot remove working tree: '.../.git' is
 * not a .git file" (confirmed empirically, git 2.39.5) — for one further real state double-force does
 * not override: a worktree git's own `worktree list --porcelain` already registers (the state
 * `isRegisteredWorktree` checks above) but whose own `.git` pointer file was never written, because a
 * real crash landed mid `git worktree add` before that step (`parseLaneWorktrees`'s own doc comment has
 * the fuller reasoning for why this exact leftover needs recognising at all). Falls back, only on that
 * failure, to a raw filesystem removal of the worktree directory plus `git worktree prune --force` — the
 * one recipe that *does* work here: `prune` exists specifically to reconcile git's own administrative
 * record for a worktree whose directory is already gone, which `rm` just made true. No `--force`/`-f`
 * flag: unlike `worktree remove`, `prune` has no such option at all (confirmed empirically, git 2.39.5:
 * "error: unknown option `force'") — it is not itself a destructive operation needing an override, only
 * a reconciliation against real, already-gone directories this function's own `rm` call just produced.
 *
 * `worktree unlock` runs first, before `prune`, its own failure deliberately swallowed — confirmed
 * empirically that `prune` silently, deliberately leaves a *locked* worktree's own administrative record
 * untouched even once its directory is already gone (git's own protection against pruning something a
 * human locked on purpose), exactly the state the real leftover this whole fallback exists for is in
 * (`parseLaneWorktrees`'s own doc comment: a real crash can land while `git worktree add` still has the
 * placeholder in its own `locked initializing` state) — but `unlock` itself refuses, "fatal: '...' is not
 * locked" (confirmed empirically, exit 128), the moment the worktree was never locked at all, which is
 * every bit as real and expected a case as the locked one (an earlier-stage crash, before `git worktree
 * add` ever reaches its own locking step) and not itself a reason to give up on `prune` ever running. */
export async function removeLaneWorktree(
  cwd: string,
  handle: LaneHandle,
  options: { readonly retain: boolean },
): Promise<void> {
  if (options.retain) return;

  if (
    await wrapGitFailure(
      () => isRegisteredWorktree(cwd, handle.path),
      `checking worktree state at "${handle.path}"`,
    )
  ) {
    try {
      await execa('git', ['worktree', 'remove', '-f', '-f', handle.path], { cwd });
    } catch {
      await wrapGitFailure(
        () => rm(handle.path, { recursive: true, force: true }),
        `removing lane worktree directory at "${handle.path}" after "git worktree remove" itself refused`,
      );
      try {
        await execa('git', ['worktree', 'unlock', handle.path], { cwd });
      } catch {
        // Was never locked at all -- see this function's own doc comment for why that is an expected,
        // harmless case here, not a real failure.
      }
      await wrapGitFailure(
        () => execa('git', ['worktree', 'prune'], { cwd }),
        `pruning stale worktree administrative state for "${handle.path}"`,
      );
    }
  }

  if (
    await wrapGitFailure(
      () => branchExists(cwd, handle.branch),
      `checking whether branch "${handle.branch}" exists`,
    )
  ) {
    await wrapGitFailure(
      () => execa('git', ['branch', '-D', handle.branch], { cwd }),
      `deleting lane branch "${handle.branch}"`,
    );
  }
}

const WORKTREE_BLOCK_SEPARATOR = /\r?\n\r?\n/;
const BRANCH_LINE = /^branch refs\/heads\/(.+)$/;
const WORKTREE_LINE = /^worktree (.+)$/;

export interface ParsedWorktreeBlock {
  readonly path: string;
  /** `undefined` for a detached-HEAD worktree, which has no `branch` line at all. */
  readonly branch: string | undefined;
}

/** One entry per `worktree`-led block in `git worktree list --porcelain` output, the one parser both
 * `isRegisteredWorktree` and `parseLaneWorktrees` build on — one place that understands the format,
 * not two that could drift apart. A block with no `worktree` line at all is silently skipped rather
 * than crashing this on a future git version's own format change; exported so this is directly
 * testable against a hand-constructed string, since a real `execa`-mediated call never actually
 * produces one in practice — confirmed empirically that `execa`'s own `stdout` already has exactly one
 * trailing newline stripped, so the raw trailing `"...\n\n"` a real `git worktree list --porcelain`
 * invocation ends with (also confirmed directly, via a raw pipe) never survives as a distinct,
 * blank final block by the time this function ever sees it. */
export function parseWorktreeBlocks(porcelain: string): readonly ParsedWorktreeBlock[] {
  const blocks: ParsedWorktreeBlock[] = [];
  for (const block of porcelain.split(WORKTREE_BLOCK_SEPARATOR)) {
    let worktreePathValue: string | undefined;
    let branchName: string | undefined;
    for (const line of block.split(/\r?\n/)) {
      const worktreeMatch = WORKTREE_LINE.exec(line);
      if (worktreeMatch !== null) worktreePathValue = worktreeMatch[1];
      const branchMatch = BRANCH_LINE.exec(line);
      if (branchMatch !== null) branchName = branchMatch[1];
    }
    if (worktreePathValue !== undefined)
      blocks.push({ path: worktreePathValue, branch: branchName });
  }
  return blocks;
}

function extractWorktreePaths(porcelain: string): readonly string[] {
  return parseWorktreeBlocks(porcelain).map((block) => block.path);
}

/** `laneId` is derived from the worktree's own path (`worktreePath`'s own `.forge/state/worktrees/
 * <laneId>/` construction, the exact same segment a `createLaneWorktree` call used to build the path in
 * the first place), never from the branch — a gauntlet critic round found `git worktree add -b <branch>
 * <path> <base>` registers the worktree itself (`git worktree list --porcelain` already reports it) in a
 * real, observed `locked initializing`, detached, *branchless* placeholder state before it ever creates
 * the branch or finishes checkout, so a real crash landing in that early window leaves a worktree this
 * function must still recognise with no `branch refs/heads/...` line to derive anything from at all —
 * confirmed empirically (`git version 2.39.5`), not merely a theoretical gap. Deriving from the path
 * instead is unconditionally reliable (every forge-managed worktree's own path is fully deterministic,
 * `worktreePath`'s own construction), and doubles as the "is this even forge-managed" filter on its own
 * (a path outside `.forge/state/worktrees/` — a human's own unrelated worktree elsewhere in the same
 * repository — was never a candidate the branch-namespace check above was actually needed to exclude).
 * `branch` still comes from the porcelain output when present; `''` for the branchless placeholder case,
 * safe because every real caller of a returned `LaneHandle.branch` (`branchExists` before ever attempting
 * a delete) already treats "does not exist" as a safe no-op, never an error — `''` can never collide with
 * a real branch name. */
function parseLaneWorktrees(porcelain: string, mainWorktreePath: string): readonly LaneHandle[] {
  const resolvedMain = path.resolve(mainWorktreePath);
  const worktreesRoot = path.join(resolvedMain, '.forge', 'state', 'worktrees');
  const handles: LaneHandle[] = [];
  for (const { path: worktreePathValue, branch: branchName } of parseWorktreeBlocks(porcelain)) {
    const resolvedPath = path.resolve(worktreePathValue);
    const relative = path.relative(worktreesRoot, resolvedPath);
    // Must be a direct child of worktreesRoot -- not worktreesRoot itself (relative === ''), not
    // outside it (relative starting with '..'), and not nested deeper under it (a real path separator
    // remaining in `relative`) -- `worktreePath`'s own construction never produces anything but a
    // direct child, so anything else here is not a forge-managed lane worktree at all.
    if (relative === '' || relative.startsWith('..') || relative.includes(path.sep)) continue;
    handles.push({
      laneId: relative as LaneId,
      path: worktreePathValue,
      branch: branchName ?? '',
    });
  }
  return handles;
}

/** `06` §6.10 step 2's own "roll the lane worktree back to its last FORGE commit (or lane base)" —
 * a real `git reset --hard <targetCommit>` plus `git clean -fd`, both scoped to `handle.path` alone
 * (`cwd: handle.path`, never the main repository) — this can never touch the integration branch, only
 * the disposable lane branch/worktree `handle` itself names, matching `20` §20.2 point 4's "never
 * rewrites published history" (a lane branch is not published history; integration is). `targetCommit`
 * is resolved via `resolveRevision` before being handed to `git reset`, not passed through raw — the
 * identical flag-injection defence `createLaneWorktree` already applies to `integrationBase`, and for
 * the identical reason: `resolveRevision`'s own doc comment confirms empirically that an unresolved,
 * flag-shaped ref reaching a git subcommand as a trailing argument is not safely rejected by git itself.
 * `git clean -fd` runs after the reset, not merged into one call: a crash mid-session can leave behind
 * new, never-staged files a bare `reset --hard` does not remove (it only rewinds tracked content), and
 * `06` §6.10 step 2's own "roll... back" is understood to mean a pristine lane worktree, not merely one
 * whose tracked files match a prior commit. */
/** Every `*.lock` file anywhere under `dir`, found by a plain recursive walk — no assumption about
 * which of git's own several lock-file shapes (`index.lock`/`HEAD.lock` at a repo or worktree's own
 * top level, `refs/heads/**\/*.lock` for a single ref, `packed-refs.lock`, and others) might exist,
 * because a critic round already found two different ones in two different real call sites (`git reset
 * --hard`'s own `HEAD.lock`, `git branch -D`'s own `refs/heads/<branch>.lock`) and chasing them
 * individually, one newly-discovered shape at a time, was not converging. A directory this small (one
 * repository's own administrative area) makes a plain recursive walk fast enough to not need a real
 * glob library. */
async function findLockFiles(dir: string): Promise<readonly string[]> {
  const entries = await listDirEntriesSorted(dir);
  const found: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory) {
      found.push(...(await findLockFiles(entryPath)));
    } else if (entry.name.endsWith('.lock')) {
      found.push(entryPath);
    }
  }
  return found;
}

/** Removes every `*.lock` file under `cwd`'s own real git-dir (`git rev-parse --absolute-git-dir`,
 * confirmed empirically to resolve to the *main* repository's `.git` for `cwd` at that repository's
 * main worktree — the one call site this function actually has, `resumeRun` against `ctx.projectRoot`
 * — and to already contain every worktree's own private admin dir nested under `worktrees/`, so one
 * sweep from the main repo's git-dir reaches every lane worktree's own locks too, not only the main
 * repo's) — any git operation against a ref or a worktree's own `HEAD`/`index` this run might still
 * need to touch refuses outright, "File exists," the moment its own lock is present, whether or not the
 * process that created it is still alive to ever finish and remove it itself.
 *
 * **Only ever safe to call once every process that could have created any of these locks is already
 * known, structurally, to be dead** — a real, uncontrolled crash (this milestone's own E3 crash-resume
 * test: `06` §6.10, `21` §21.3) can land a real `git` subprocess mid-write, abandoning its own lock
 * forever; deleting a lock a *live*, still-running git process is legitimately holding would corrupt
 * that process's own in-progress write. `@forge/engine/resume`'s own `resumeRun` is the one real caller
 * for which that precondition already holds by construction (it only ever runs once the crashed
 * process's own PID has already been confirmed gone, and this project's own single-writer-per-run
 * design means nothing else is legitimately touching this exact repository concurrently with a
 * resume) — called there, once, before anything else that touches git state for the run being resumed,
 * rather than chased at each individual call site that happens to trip over a lock. */
export async function clearStaleRepoLocks(cwd: string): Promise<void> {
  const gitDir = await wrapGitFailure(async () => {
    const { stdout } = await execa('git', ['rev-parse', '--absolute-git-dir'], { cwd });
    return stdout.trim();
  }, `resolving the git-dir for "${cwd}"`);
  const lockFiles = await findLockFiles(gitDir);
  await Promise.all(lockFiles.map((lockFile) => rm(lockFile, { force: true })));
}

export async function resetLaneWorktree(handle: LaneHandle, targetCommit: string): Promise<void> {
  const resolved = await resolveRevision(handle.path, targetCommit);
  await wrapGitFailure(
    () => execa('git', ['reset', '--hard', resolved], { cwd: handle.path }),
    `resetting lane worktree at "${handle.path}" to "${resolved}"`,
  );
  await wrapGitFailure(
    () => execa('git', ['clean', '-fd'], { cwd: handle.path }),
    `cleaning untracked files from lane worktree at "${handle.path}"`,
  );
}

/** Removes the administrative subdirectory (`<gitDir>/worktrees/<name>/`) for any worktree whose own
 * `commondir` file — the pointer back to the *shared* repository data every worktree's own private
 * admin dir carries, confirmed empirically to be among the very first files `git worktree add` writes —
 * is missing or empty, the state an even earlier-landing real crash than `parseLaneWorktrees`'s own
 * `locked initializing` case leaves behind (confirmed empirically, git 2.39.5: "fatal: failed to read
 * .git/worktrees/<name>/commondir: Undefined error: 0"), one so broken that git's own `worktree list
 * --porcelain` refuses outright — for *every* worktree in the repository, not merely the broken one —
 * making the ordinary "list, then reconcile" reclaim flow impossible to even start. Never scoped to a
 * `runId`: a fully-corrupt admin entry serves no legitimate purpose for any run, crashed or not — a live
 * `git worktree add` in genuine progress always has a real `commondir` by the time anything else could
 * observe it at all, so "missing or empty" is never a state a concurrent, still-running attempt could be
 * legitimately caught in. Only ever the admin entry, never the worktree's own working directory (if one
 * even exists yet) — that is `listOrphanedWorktreeDirectories`'s own, separate job, reachable again once
 * this repair makes `git worktree list --porcelain` itself work again. */
async function repairUnlistableWorktreeAdminEntries(cwd: string): Promise<void> {
  const gitDir = await wrapGitFailure(async () => {
    const { stdout } = await execa('git', ['rev-parse', '--absolute-git-dir'], { cwd });
    return stdout.trim();
  }, `resolving the git-dir for "${cwd}"`);
  const adminRoot = path.join(gitDir, 'worktrees');
  const entries = await listDirEntriesSorted(adminRoot);
  for (const entry of entries) {
    if (!entry.isDirectory) continue;
    const commondirPath = path.join(adminRoot, entry.name, 'commondir');
    let commondirContent: string;
    try {
      commondirContent = (await readFile(commondirPath, 'utf8')).trim();
    } catch {
      commondirContent = '';
    }
    if (commondirContent === '') {
      await rm(path.join(adminRoot, entry.name), { recursive: true, force: true });
    }
  }
}

/** Every worktree `git` itself already knows about whose branch matches the `forge/<runId>/<slug>`
 * namespace — excluding `cwd`'s own main worktree, even if it happens to have a matching branch checked
 * out directly (see `parseLaneWorktrees`'s own comment) — minus any `laneId` already present in
 * `knownLaneIds` — the crash-recovery primitive `20` §20.10 S12 needs ("no orphaned worktrees... that
 * block a resume"). Reads git's own worktree list, not an in-memory registry this package would have to
 * keep in sync and which a crash would simply lose — a worktree created by a since-killed process is
 * exactly as discoverable as one this process created itself, since both are recorded the same way, by
 * git, on disk. Deciding whether to reclaim or merely report what this returns is the caller's own job.
 *
 * The underlying `git worktree list --porcelain` call is retried exactly once, after
 * `repairUnlistableWorktreeAdminEntries`, if its first attempt fails at all — cheaper and simpler than
 * trying to distinguish this specific failure from every other reason the call could fail, and safe to
 * attempt unconditionally: the repair itself is a no-op on a repository that was never broken this way
 * (`readdir`'s own `catch` returns early, and a `commondir` that reads back non-empty is left alone),
 * so retrying after a repair that changed nothing just reproduces the original, still-real failure for
 * `wrapGitFailure` to report normally. */
export async function listOrphanedWorktrees(
  cwd: string,
  knownLaneIds: ReadonlySet<LaneId> = new Set(),
): Promise<readonly LaneHandle[]> {
  const resolvedCwd = await resolveCwd(cwd);
  let stdout: string;
  try {
    ({ stdout } = await execa('git', ['worktree', 'list', '--porcelain'], { cwd: resolvedCwd }));
  } catch {
    await repairUnlistableWorktreeAdminEntries(resolvedCwd);
    ({ stdout } = await wrapGitFailure(
      () => execa('git', ['worktree', 'list', '--porcelain'], { cwd: resolvedCwd }),
      `listing worktrees for "${resolvedCwd}"`,
    ));
  }
  return parseLaneWorktrees(stdout, resolvedCwd).filter(
    (handle) => !knownLaneIds.has(handle.laneId),
  );
}

/** Every branch in `runId`'s own `forge/<runId>/` namespace that `git branch --list` itself knows
 * about but which has no corresponding *registered* worktree (`listOrphanedWorktrees`'s own real source
 * of truth, `git worktree list --porcelain`) — a real, separate leftover `listOrphanedWorktrees` cannot
 * see at all, since it only ever enumerates worktrees git has fully registered, never a bare branch ref.
 * `createLaneWorktree`'s own single `git worktree add -b <branch> <path> <base>` call is not atomic: a
 * gauntlet critic round found a real crash landing mid-command can leave the branch ref created (git's
 * own first internal step) with the worktree-registration/checkout step that follows it never reached —
 * this module's own `removeLaneWorktree` doc comment already documented the identical class of gap on
 * the *removal* side ("a branch with no worktree... neither a retried `createLaneWorktree`... nor a
 * retried call to this same function... could ever recover from"); this is that same shape of leftover,
 * on the creation side instead. A branch outside this run's own namespace is never a candidate — the
 * identical per-run ownership scoping `reclaimOrphanedWorktrees` (`@forge/engine/resume`) already applies
 * to worktrees, so a resume for one run can never touch a branch a completely different, still-live run
 * owns. */
export async function listOrphanedLaneBranches(
  cwd: string,
  runId: string,
): Promise<readonly string[]> {
  const resolvedCwd = await resolveCwd(cwd);
  // `for-each-ref`, not `branch --list`: the latter prefixes a two-character marker per line (`* ` for
  // the current branch, `+ ` for one checked out in *another* worktree -- exactly the common case here,
  // a lane branch checked out in its own lane worktree) that a caller must strip correctly to recover
  // the bare name, confirmed the hard way (a first version of this function stripped only `*`, leaving
  // a literal leading `+ ` on every real lane branch, which then failed every deletion attempt with
  // "branch ... not found" against the mangled name). `for-each-ref %(refname:short)` has no such
  // decoration at all -- built for exactly this kind of scripting, not interactive display.
  const { stdout: branchOutput } = await wrapGitFailure(
    () =>
      execa('git', ['for-each-ref', '--format=%(refname:short)', `refs/heads/forge/${runId}/*`], {
        cwd: resolvedCwd,
      }),
    `listing branches in the "forge/${runId}/" namespace for "${resolvedCwd}"`,
  );
  const allBranches = branchOutput.split('\n').filter((line) => line.trim() !== '');
  if (allBranches.length === 0) return [];

  const { stdout: worktreeOutput } = await wrapGitFailure(
    () => execa('git', ['worktree', 'list', '--porcelain'], { cwd: resolvedCwd }),
    `listing worktrees for "${resolvedCwd}"`,
  );
  const branchesWithWorktrees = new Set(
    parseWorktreeBlocks(worktreeOutput)
      .map((block) => block.branch)
      .filter((branch) => branch !== undefined),
  );
  return allBranches.filter((branch) => !branchesWithWorktrees.has(branch));
}

/** Every subdirectory of `<cwd>/.forge/state/worktrees/` whose name starts with `${runId}-` (this run's
 * own `laneId` namespace, `worktreePath`'s own naming convention) but which git itself does *not*
 * currently recognise as a registered worktree (`git worktree list --porcelain`, the same real source
 * of truth `listOrphanedWorktrees` reads) — a third, distinct shape of leftover `git worktree add -b
 * <branch> <path> <base>` can produce when a real crash lands mid-command, on top of the other two this
 * module already reclaims (a bare branch ref with no worktree, `listOrphanedLaneBranches`; a stale lock
 * file, `clearStaleRepoLocks`): the target *directory* itself, created (`mkdir`, at minimum) before
 * registration with git ever completed, so `git worktree list --porcelain` has no trace of it at all —
 * yet `worktreePath`'s own naming is fully deterministic (no per-attempt nonce), so a retried
 * `createLaneWorktree` for the identical `(runId, stepId)` collides with it regardless, refusing outright
 * ("fatal: '...' already exists," confirmed empirically, distinct from and unrelated to the *branch*
 * collision `listOrphanedLaneBranches` already guards against). Cross-checked against git's own real
 * worktree registrations (not merely assumed orphaned from the naming convention alone) for the same
 * "never trust one signal alone" reason `repopulateLaneRegistry`'s own `existsSync` cross-check already
 * applies in the opposite direction (`@forge/engine/resume`'s own doc comment) — a directory that *is* a
 * real, currently-registered worktree must never be torn down by this path; that is `removeLaneWorktree`'s
 * own, safer, git-mediated job. */
export async function listOrphanedWorktreeDirectories(
  cwd: string,
  runId: string,
): Promise<readonly string[]> {
  const resolvedCwd = await resolveCwd(cwd);
  const worktreesRoot = path.join(resolvedCwd, '.forge', 'state', 'worktrees');
  const entries = await listDirEntriesSorted(worktreesRoot);
  const candidates = entries
    .filter((entry) => entry.isDirectory && entry.name.startsWith(`${runId}-`))
    .map((entry) => path.join(worktreesRoot, entry.name));
  if (candidates.length === 0) return [];

  const { stdout: worktreeOutput } = await wrapGitFailure(
    () => execa('git', ['worktree', 'list', '--porcelain'], { cwd: resolvedCwd }),
    `listing worktrees for "${resolvedCwd}"`,
  );
  const registeredPaths = new Set(
    parseWorktreeBlocks(worktreeOutput).map((block) => path.resolve(block.path)),
  );
  return candidates.filter((candidate) => !registeredPaths.has(path.resolve(candidate)));
}

/** `fs.rm(..., { recursive: true, force: true })` — a plain filesystem removal, deliberately never a
 * `git worktree remove` call: `listOrphanedWorktreeDirectories`'s own contract already guarantees
 * git itself has no registration for this path at all, so there is nothing for a git-mediated removal
 * to act on (`git worktree remove` would simply refuse, "not a working tree"). */
export async function removeOrphanedWorktreeDirectory(dirPath: string): Promise<void> {
  await rm(dirPath, { recursive: true, force: true });
}

/** `git branch -D <branch>` — the deletion half of `listOrphanedLaneBranches`'s own reclaim contract,
 * kept as a separate exported step (rather than folded into the listing call itself) for the identical
 * "deciding whether to reclaim is the caller's own job" reason `listOrphanedWorktrees`'s own doc comment
 * already gives for that function. */
export async function removeOrphanedLaneBranch(cwd: string, branch: string): Promise<void> {
  await wrapGitFailure(
    () => execa('git', ['branch', '-D', branch], { cwd }),
    `deleting orphaned lane branch "${branch}"`,
  );
}
