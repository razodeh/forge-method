/**
 * `analyzeGitProfile` — the git-history signals `17` §17.2 phase 1 (SURVEY)'s own signal table names
 * under "Git profile": age, commit count, contributor count, churn hotspots, files changed together.
 * Genuinely new: no existing `@forge/vcs` export reads git *history* (`git log`) at all — every other
 * export in this package reads current working-tree/ref state (`status`, `rev-parse`) or mutates it
 * (`worktree add`, `commit`).
 *
 * Lives here, not in `@forge/kb`'s own `adopt/survey.ts`, because `kb`'s row in `specs/02` §2.2's
 * dependency graph (`kb: ['core', 'schemas', 'diagrams']`) does not include `vcs` — confirmed directly
 * against `tools/eslint-plugin-forge-boundaries/src/graph.mjs` before writing a line of this piece,
 * per `PLAN-M10.md` P15's own flagged open question. `vcs` already owns every other real git subprocess
 * call in this repo, and adding a `kb → vcs` edge for one new signal would be the wrong fix for a
 * one-piece need — the git-profile primitive belongs where every other git primitive already lives.
 * `@forge/kb`'s SURVEY code never imports this module: it accepts an already-computed `GitProfile`-
 * shaped value as a plain data parameter (structurally typed, so no import is even needed for the
 * shapes to match) supplied by whoever orchestrates SURVEY — `@forge/cli`, which already legally
 * depends on both `kb` and `vcs` (`cli ← everything`, `specs/02` §2.2). Full reasoning in
 * `SPEC-QUESTIONS.md` Q152.
 *
 * @see specs/17 §17.2
 * @see SPEC-QUESTIONS.md Q152
 * @see PLAN-M10.md P15
 */
import { execa } from 'execa';

import { SYSTEM_CLOCK, type VcsClock } from './clock.ts';
import { assertGitAvailable, resolveHeadShaOrUndefined, wrapGitFailure } from './git.ts';

/** One file whose commit count places it among the churn hotspots. */
export interface ChurnHotspot {
  readonly path: string;
  readonly commitCount: number;
}

/** Two files that were changed together in at least one commit, and how often. */
export interface CoChangePair {
  readonly paths: readonly [string, string];
  readonly count: number;
}

export interface GitProfile {
  /** `false` for a repository with no commits yet — every other field is then zero/empty, not absent,
   * so a caller can always destructure this shape without a second existence check. */
  readonly hasCommits: boolean;
  /** Age of the oldest commit reachable from `HEAD`, in whole days. `undefined` iff `!hasCommits`. */
  readonly ageDays: number | undefined;
  readonly commitCount: number;
  /** Distinct author emails across `HEAD`'s history. Case-sensitive: `git`'s own author identity is
   * whatever `user.email` was at commit time, and folding case would conflate genuinely distinct
   * configured identities on the strength of a coincidence — a wrong merge is worse than an
   * unmerged duplicate here, since this number feeds a fact report, not a dedup UI. */
  readonly contributorCount: number;
  /** Sorted by `commitCount` descending, ties broken by path for determinism. Capped at
   * `options.hotspotLimit`. */
  readonly churnHotspots: readonly ChurnHotspot[];
  /** Sorted by `count` descending, ties broken by the pair's own (already sorted) paths for
   * determinism. Capped at `options.coChangeLimit`. */
  readonly filesChangedTogether: readonly CoChangePair[];
}

export interface GitProfileOptions {
  /** @default 20 */
  readonly hotspotLimit?: number;
  /** @default 20 */
  readonly coChangeLimit?: number;
  /** Commits with more changed files than this are excluded from co-change pairing only (they still
   * count toward churn and commit/contributor totals). Without this cap, one large commit (an
   * initial import, a mass reformat) produces O(n²) pairs that swamp every real, meaningful pair
   * with noise from files that merely happened to exist at the same time.
   * @default 50 */
  readonly maxFilesPerCommitForCoChange?: number;
  /** Injected per `QUALITY-BAR.md` R10 — see `clock.ts`'s own doc comment.
   * @default SYSTEM_CLOCK */
  readonly clock?: VcsClock;
}

const DEFAULT_HOTSPOT_LIMIT = 20;
const DEFAULT_CO_CHANGE_LIMIT = 20;
const DEFAULT_MAX_FILES_PER_COMMIT_FOR_CO_CHANGE = 50;

/** A single-byte, non-printable delimiter that cannot appear in a commit sha or a file path, used to
 * split `git log`'s own single-stream stdout back into per-commit blocks without a second subprocess
 * per commit. */
const COMMIT_DELIMITER = '\x01';

interface ParsedCommit {
  readonly sha: string;
  readonly files: readonly string[];
}

function parseLogWithNameOnly(stdout: string): readonly ParsedCommit[] {
  return stdout
    .split(COMMIT_DELIMITER)
    .filter((block) => block.length > 0)
    .map((block) => {
      const lines = block.split('\n').filter((line) => line.length > 0);
      const [sha, ...files] = lines;
      return { sha: sha ?? '', files };
    })
    .filter((commit) => commit.sha.length > 0);
}

function pairKey(a: string, b: string): readonly [string, string] {
  return a < b ? [a, b] : [b, a];
}

/** Plain code-unit-order comparison, never `localeCompare` (`QUALITY-BAR.md` R10): collation order
 * varies by the host's locale, which would make a fact report non-reproducible across machines. */
function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Deterministic git-history facts for `cwd`, reachable from `HEAD`. Read-only: `17` §17.2 phase 1 is
 * explicitly "no LLM... read-only", and this makes no subprocess call that can mutate the repository.
 *
 * @throws {VcsError} `ENV-GIT-MISSING`/`VCS-NOT-A-REPO` — from an explicit `assertGitAvailable` call
 * at the top of this function, so the specific, actionable code is always what a caller sees for
 * those two conditions, never the generic `VCS-GIT-OPERATION-FAILED` a later git subprocess failing
 * for the same underlying reason would otherwise surface. Calling this a second time for a `cwd` a
 * caller already checked (SURVEY's own caller does, to fail the whole run fast) repeats that one
 * cheap check, not the more expensive `git log` calls below it, which only run once it passes.
 */
export async function analyzeGitProfile(
  cwd: string,
  options: GitProfileOptions = {},
): Promise<GitProfile> {
  await assertGitAvailable(cwd);

  const hotspotLimit = options.hotspotLimit ?? DEFAULT_HOTSPOT_LIMIT;
  const coChangeLimit = options.coChangeLimit ?? DEFAULT_CO_CHANGE_LIMIT;
  const maxFilesPerCommitForCoChange =
    options.maxFilesPerCommitForCoChange ?? DEFAULT_MAX_FILES_PER_COMMIT_FOR_CO_CHANGE;
  const clock = options.clock ?? SYSTEM_CLOCK;

  const headSha = await wrapGitFailure(
    () => resolveHeadShaOrUndefined(cwd),
    `resolving HEAD for "${cwd}"`,
  );
  if (headSha === undefined) {
    return {
      hasCommits: false,
      ageDays: undefined,
      commitCount: 0,
      contributorCount: 0,
      churnHotspots: [],
      filesChangedTogether: [],
    };
  }

  const [logResult, authorsResult, timestampsResult] = await wrapGitFailure(
    () =>
      Promise.all([
        execa('git', ['log', `--pretty=format:${COMMIT_DELIMITER}%H`, '--name-only', 'HEAD'], {
          cwd,
        }),
        execa('git', ['log', '--pretty=format:%ae', 'HEAD'], { cwd }),
        execa('git', ['log', '--pretty=format:%at', 'HEAD'], { cwd }),
      ]),
    `reading commit history for "${cwd}"`,
  );

  const commits = parseLogWithNameOnly(logResult.stdout);
  const commitCount = commits.length;

  const contributorEmails = new Set(
    authorsResult.stdout.split('\n').filter((line) => line.length > 0),
  );

  const timestamps = timestampsResult.stdout
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => Number.parseInt(line, 10));
  // `git log` orders newest-first; the oldest commit's timestamp is therefore the last entry, not the
  // first — confirmed against real output rather than assumed from the flag name alone.
  const oldestEpochSeconds = timestamps.at(-1);
  const ageDays =
    oldestEpochSeconds === undefined
      ? undefined
      : Math.floor((clock.now() / 1000 - oldestEpochSeconds) / 86_400);

  const churnCounts = new Map<string, number>();
  const coChangeCounts = new Map<string, { pair: readonly [string, string]; count: number }>();

  for (const commit of commits) {
    for (const file of commit.files) {
      churnCounts.set(file, (churnCounts.get(file) ?? 0) + 1);
    }
    if (commit.files.length >= 2 && commit.files.length <= maxFilesPerCommitForCoChange) {
      commit.files.forEach((fileA, i) => {
        for (const fileB of commit.files.slice(i + 1)) {
          const pair = pairKey(fileA, fileB);
          const key = pair.join('\0');
          const existing = coChangeCounts.get(key);
          coChangeCounts.set(key, { pair, count: (existing?.count ?? 0) + 1 });
        }
      });
    }
  }

  const churnHotspots = [...churnCounts.entries()]
    .map(([path, count]) => ({ path, commitCount: count }))
    .sort((a, b) => b.commitCount - a.commitCount || compareStrings(a.path, b.path))
    .slice(0, hotspotLimit);

  const filesChangedTogether = [...coChangeCounts.values()]
    .map(({ pair, count }) => ({ paths: pair, count }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        compareStrings(a.paths[0], b.paths[0]) ||
        compareStrings(a.paths[1], b.paths[1]),
    )
    .slice(0, coChangeLimit);

  return {
    hasCommits: true,
    ageDays,
    commitCount,
    contributorCount: contributorEmails.size,
    churnHotspots,
    filesChangedTogether,
  };
}
