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
import { realpath } from 'node:fs/promises';
import path from 'node:path';

import { resolveRevision, wrapGitFailure } from './git.ts';

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
  const disambiguator = createHash('sha256').update(stepId).digest('hex').slice(0, SLUG_HASH_LENGTH);
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
    () => execa('git', ['worktree', 'add', '-b', branch, target, resolvedBase], { cwd: resolvedCwd }),
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
  return extractWorktreePaths(stdout).some((worktreePathValue) => path.resolve(worktreePathValue) === resolvedTarget);
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
 * inspection) to end up in, and one a single `--force` cannot clear on its own. */
export async function removeLaneWorktree(
  cwd: string,
  handle: LaneHandle,
  options: { readonly retain: boolean },
): Promise<void> {
  if (options.retain) return;

  if (await wrapGitFailure(() => isRegisteredWorktree(cwd, handle.path), `checking worktree state at "${handle.path}"`)) {
    await wrapGitFailure(
      () => execa('git', ['worktree', 'remove', '-f', '-f', handle.path], { cwd }),
      `removing lane worktree at "${handle.path}"`,
    );
  }

  if (await wrapGitFailure(() => branchExists(cwd, handle.branch), `checking whether branch "${handle.branch}" exists`)) {
    await wrapGitFailure(
      () => execa('git', ['branch', '-D', handle.branch], { cwd }),
      `deleting lane branch "${handle.branch}"`,
    );
  }
}

const WORKTREE_BLOCK_SEPARATOR = /\r?\n\r?\n/;
const BRANCH_LINE = /^branch refs\/heads\/(.+)$/;
const WORKTREE_LINE = /^worktree (.+)$/;
const LANE_BRANCH = /^forge\/([^/]+)\/(.+)$/;

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
    if (worktreePathValue !== undefined) blocks.push({ path: worktreePathValue, branch: branchName });
  }
  return blocks;
}

function extractWorktreePaths(porcelain: string): readonly string[] {
  return parseWorktreeBlocks(porcelain).map((block) => block.path);
}

function parseLaneWorktrees(porcelain: string, mainWorktreePath: string): readonly LaneHandle[] {
  const resolvedMain = path.resolve(mainWorktreePath);
  const handles: LaneHandle[] = [];
  for (const { path: worktreePathValue, branch: branchName } of parseWorktreeBlocks(porcelain)) {
    if (branchName === undefined) continue;
    // The main worktree is never forge-managed, even if a human happens to have checked out a branch
    // that matches the forge/<runId>/<slug> namespace directly in it — confirmed empirically that
    // `git worktree list --porcelain` carries no explicit "this is the main worktree" marker, so this
    // is the one reliable, position-independent signal available: it is always exactly `cwd` itself.
    if (path.resolve(worktreePathValue) === resolvedMain) continue;
    const laneBranchMatch = LANE_BRANCH.exec(branchName);
    if (laneBranchMatch === null) continue;
    // Both capture groups are present whenever LANE_BRANCH matches at all — noUncheckedIndexedAccess
    // cannot derive that from RegExpExecArray's own general (string | undefined)[] element type. `as`,
    // not `!` (banned in src/**): the more succinct style the linter suggests is exactly what is not
    // allowed here.
    // eslint-disable-next-line @typescript-eslint/non-nullable-type-assertion-style
    const runId = laneBranchMatch[1] as string;
    // eslint-disable-next-line @typescript-eslint/non-nullable-type-assertion-style
    const slug = laneBranchMatch[2] as string;
    handles.push({ laneId: formatLaneId(runId, slug), path: worktreePathValue, branch: branchName });
  }
  return handles;
}

/** Every worktree `git` itself already knows about whose branch matches the `forge/<runId>/<slug>`
 * namespace — excluding `cwd`'s own main worktree, even if it happens to have a matching branch checked
 * out directly (see `parseLaneWorktrees`'s own comment) — minus any `laneId` already present in
 * `knownLaneIds` — the crash-recovery primitive `20` §20.10 S12 needs ("no orphaned worktrees... that
 * block a resume"). Reads git's own worktree list, not an in-memory registry this package would have to
 * keep in sync and which a crash would simply lose — a worktree created by a since-killed process is
 * exactly as discoverable as one this process created itself, since both are recorded the same way, by
 * git, on disk. Deciding whether to reclaim or merely report what this returns is the caller's own job. */
export async function listOrphanedWorktrees(
  cwd: string,
  knownLaneIds: ReadonlySet<LaneId> = new Set(),
): Promise<readonly LaneHandle[]> {
  const resolvedCwd = await resolveCwd(cwd);
  const { stdout } = await wrapGitFailure(
    () => execa('git', ['worktree', 'list', '--porcelain'], { cwd: resolvedCwd }),
    `listing worktrees for "${resolvedCwd}"`,
  );
  return parseLaneWorktrees(stdout, resolvedCwd).filter((handle) => !knownLaneIds.has(handle.laneId));
}
