/**
 * Post-execution write-policy enforcement on a real, completed lane worktree: diffing what actually
 * changed against a step's declared `produces` claim, and the three named strategies for shared mutable
 * paths many lanes unavoidably touch (`06` §6.7, verbatim). The *scheduling-time* interval map deciding
 * which claims may run concurrently is `@forge/engine`'s job (`SPEC-QUESTIONS.md` Q62's sixth note), not
 * this package's — everything here only ever looks backward, at a lane whose session has already ended.
 *
 * @see specs/06 §6.7
 * @see specs/18 §18.3
 * @see specs/20 §20.2 point 3, §20.10 S1
 * @see PLAN-M5.md P4
 */
import { execa } from 'execa';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { minimatch } from 'minimatch';

import { VcsError } from './errors.ts';
import { errorMessage, resolveRevision, wrapGitFailure } from './git.ts';
import type { LaneHandle } from './lanes.ts';

/** Every path that differs between `baseSha` and the lane worktree's *actual current state* — committed,
 * staged, unstaged, and untracked alike — added, modified, and deleted. `baseSha` is resolved via
 * `resolveRevision` before it ever reaches `git diff` as a bare positional argument, for the same reason
 * `lanes.ts`'s own `createLaneWorktree` resolves `integrationBase` first: a flag-shaped caller-supplied
 * ref must never reach a git subcommand unresolved.
 *
 * Two flags on the `git diff` call, neither optional, both fixing a real bug a gauntlet critic round
 * found by actually constructing the failure rather than assuming git's behaviour:
 *
 * 1. **`--no-renames`.** Porcelain `git diff` enables rename detection *by default* — confirmed
 *    empirically, correcting an earlier, wrong assumption in this same function that it was already off.
 *    Left at the default, a step renaming an out-of-claim file into a claimed directory collapses to a
 *    single line for the *new* path only, with the old (out-of-claim) path never reported at all —
 *    a complete, silent bypass of claim enforcement. Worse, a step renaming an in-claim file *out* of
 *    its claim makes `enforceClaim` below treat it as a brand-new file with nothing to check out at
 *    `baseSha` under its new name, and delete it outright — destroying content a `strict` policy exists
 *    to protect. `--no-renames` restores the intended behaviour: a rename is reported as a deletion of
 *    the old path plus an addition of the new one, so *both* paths are independently checked against
 *    `declaredGlobs` below, exactly the property claim enforcement needs.
 * 2. **`-z`.** git's default `core.quotePath` C-quotes any path containing non-ASCII bytes or special
 *    characters in `--name-only` output (confirmed empirically: a real file named with an accented
 *    character round-trips as the literal 17-character string `"caf\303\251.txt"`, quote marks and all)
 *    — silently corrupting both the glob match below (a legitimate in-claim file misclassified as
 *    out-of-claim) and `enforceClaim`'s own `existsAtRevision` check (a `cat-file -e` lookup for the
 *    mangled path fails for a reason *other than* "the file is absent," steering a modified pre-existing
 *    file onto the destructive `git rm` branch instead of the restorative `git checkout` one). `-z`
 *    emits raw, unquoted, NUL-separated paths instead — confirmed empirically via `xxd` that the same
 *    accented filename survives byte-for-byte once split on `\0` rather than `\n`. `git ls-files` below
 *    gets the identical treatment for the identical reason.
 *
 * A third gap the same critic round found: this function used to diff only `baseSha..HEAD`, silently
 * ignoring anything uncommitted in the lane worktree — an untracked `.env` file (`20` §20.2 point 2's
 * own deny-list entry) written but never committed passed through completely unreported. The first fix
 * attempted here — asserting the working tree clean before diffing, refusing to proceed otherwise — was
 * itself found broken by the very next gauntlet round: `enforceClaim` below deliberately leaves its own
 * reverts uncommitted (a caller decides when/how to commit, `SPEC-QUESTIONS.md` Q66's own design point
 * 4), so a *successful* revert made the lane "dirty" for every subsequent call, and the exact
 * recovery-after-partial-failure workflow this file's own error message recommends — fix the blocker,
 * call this again — immediately hit an unrelated, misleading `VCS-DIRTY-TREE` rejection instead.
 *
 * Fixed properly by diffing `baseSha` against a *single* ref (git's own two-argument-vs-one-argument
 * `diff` distinction: one ref compares against the live working tree and index, not just the other
 * commit) plus `git ls-files --others --exclude-standard` for untracked files `git diff` never reports
 * regardless of ref count — together, the actual current state, committed or not. This has a second,
 * load-bearing property beyond just closing the original gap: it makes a lane handle safe to diff or
 * enforce more than once. A file `enforceClaim` has already reverted to its exact `baseSha` content
 * naturally stops appearing in this output on the next call — confirmed empirically — with no special
 * retry logic needed anywhere; a file that failed to revert (`VCS-CLAIM-REVERT-FAILED`) naturally keeps
 * appearing until it's actually fixed. */
export async function diffLaneChanges(handle: LaneHandle, baseSha: string): Promise<readonly string[]> {
  const resolvedBase = await resolveRevision(handle.path, baseSha);
  const { stdout: diffOutput } = await wrapGitFailure(
    () => execa('git', ['diff', '--no-renames', '-z', '--name-only', resolvedBase], { cwd: handle.path }),
    `diffing the lane worktree at "${handle.path}" against "${baseSha}"`,
  );
  const { stdout: untrackedOutput } = await wrapGitFailure(
    () => execa('git', ['ls-files', '-z', '--others', '--exclude-standard'], { cwd: handle.path }),
    `listing untracked files in the lane worktree at "${handle.path}"`,
  );
  const changed = new Set([
    ...diffOutput.split('\0').filter((entry) => entry !== ''),
    ...untrackedOutput.split('\0').filter((entry) => entry !== ''),
  ]);
  return [...changed].sort();
}

/** `{ dot: true }`: a claim like `src/**` must also match a legitimate dotfile the step created inside
 * its own claimed directory (`src/.eslintrc.json`, a per-package config, `.gitkeep`) — `minimatch`'s
 * default excludes any path segment starting with `.` from a wildcard match, confirmed empirically to
 * otherwise misclassify exactly such a file as out-of-claim and, under `strict`, delete it outright. This
 * does not reach the separate, global deny-list (`20` §20.2 point 2: `.git/`, `.forge/state/`, `.env*`)
 * — that list is enforced earlier, at write time, by a different layer; a file already on disk by the
 * time this piece runs has already passed it, and this function's only job is matching it against the
 * step's own declared globs correctly. */
function matchesAnyGlob(file: string, globs: readonly string[]): boolean {
  return globs.some((glob) => minimatch(file, glob, { dot: true }));
}

/** Whether `file` existed at `revision` at all — decides which of `enforceClaim`'s two revert operations
 * applies to it. Any `cat-file -e` failure is treated as "does not exist": `revision` here is always
 * already a resolved sha (never caller-supplied text directly) and `file` is sourced from `diffLaneChanges`,
 * so "the path is absent at this revision" is overwhelmingly the only realistic reason this would fail —
 * the same accepted imprecision `assertGitAvailable` already documents for its own `--version` check, not
 * a new one invented here. This *did* have a second, realistic failure mode until `diffLaneChanges` itself
 * started passing `-z` to `git diff`: a quoted/escaped path (from `core.quotePath`'s default handling of
 * non-ASCII filenames) made this check fail for a modified, pre-existing file for a reason having nothing
 * to do with whether it existed at `revision` — steering it onto the destructive `git rm` branch below
 * instead of the restorative `git checkout` one. Fixed at the source (raw, unquoted paths in, from
 * `diffLaneChanges`), not by adding a second check here, since every caller benefits from the fix once
 * instead of only this one call site. */
async function existsAtRevision(cwd: string, revision: string, file: string): Promise<boolean> {
  try {
    await execa('git', ['cat-file', '-e', `${revision}:${file}`], { cwd });
    return true;
  } catch {
    return false;
  }
}

export interface ClaimEnforcementResult {
  /** Every changed path (see `diffLaneChanges`) outside `declaredGlobs`. */
  readonly outOfClaim: readonly string[];
  /** Paths actually reverted to their pre-lane state — always empty for `warn`; equal to `outOfClaim`
   * for `strict`. Recorded explicitly rather than left for a caller to re-derive from `outOfClaim` plus
   * the policy it passed in, since this result is what the audit trail (`20` §20.9) ultimately keeps. */
  readonly reverted: readonly string[];
}

/** `06` §6.7's own two policies for an out-of-claim write: `strict` reverts every offending path to its
 * exact state at `baseSha` — or removes it entirely, if it did not exist at `baseSha` at all, since a
 * brand new file has no prior state to check out — while `warn` reverts nothing and only reports.
 *
 * Reverting never fails "the step" directly: nothing in this package knows what a step or failing one
 * structurally means (`SPEC-QUESTIONS.md` Q62's own forward-dependency precedent — that decision belongs
 * to `@forge/engine`, a caller this piece cannot reach). This function's job ends at giving that caller
 * the structured facts — what was out of claim, what was actually reverted — needed to make it. */
export async function enforceClaim(
  handle: LaneHandle,
  baseSha: string,
  declaredGlobs: readonly string[],
  policy: 'strict' | 'warn',
): Promise<ClaimEnforcementResult> {
  const resolvedBase = await resolveRevision(handle.path, baseSha);
  const changed = await diffLaneChanges(handle, resolvedBase);
  const outOfClaim = changed.filter((file) => !matchesAnyGlob(file, declaredGlobs));

  if (policy === 'warn' || outOfClaim.length === 0) {
    return { outOfClaim, reverted: [] };
  }

  // Every file gets a real attempt regardless of an earlier one's failure — a gauntlet critic round
  // found the original version of this loop stopped at the first failure, silently leaving every
  // out-of-claim file *after* it in the list untouched, with no signal to the caller that they were
  // never even attempted. Collecting failures and throwing one aggregate error only after the loop
  // finishes maximises how reverted the worktree actually ends up, and the thrown error names exactly
  // which files still need attention rather than leaving that to be rediscovered by a fresh diff.
  const reverted: string[] = [];
  const failures: { readonly file: string; readonly cause: unknown }[] = [];
  for (const file of outOfClaim) {
    try {
      if (await existsAtRevision(handle.path, resolvedBase, file)) {
        await wrapGitFailure(
          () => execa('git', ['checkout', resolvedBase, '--', file], { cwd: handle.path }),
          `reverting out-of-claim file "${file}" to its state at "${baseSha}"`,
        );
      } else {
        await wrapGitFailure(
          () => execa('git', ['rm', '-f', '--', file], { cwd: handle.path }),
          `removing out-of-claim new file "${file}"`,
        );
      }
      reverted.push(file);
    } catch (cause) {
      failures.push({ file, cause });
    }
  }

  if (failures.length > 0) {
    const failedFiles = failures.map((failure) => failure.file);
    throw new VcsError(
      {
        code: 'VCS-CLAIM-REVERT-FAILED',
        message:
          `Failed to revert ${String(failures.length)} out-of-claim file(s) in the lane worktree at ` +
          `"${handle.path}": ${failedFiles.join(', ')}. ` +
          `${String(reverted.length)} file(s) were successfully reverted: ${reverted.join(', ') || '(none)'}.`,
        remedy:
          'Inspect the lane worktree directly — the listed file(s) may still be in their out-of-claim ' +
          'state and need manual reversion. See the underlying cause(s) for why each one failed.',
      },
      { cause: failures },
    );
  }
  return { outOfClaim, reverted };
}

export type SharedPathStrategyOptions =
  | { readonly glob: string; readonly strategy: 'serialize' }
  | { readonly glob: string; readonly strategy: 'append-only' }
  | { readonly glob: string; readonly strategy: 'regenerate'; readonly command: string };

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined;
}

/** Idempotently ensures `.gitattributes` in the lane worktree has a `<glob> merge=union` line — git's
 * own *built-in* union merge driver (confirmed empirically: two branches independently appending
 * distinct lines to a shared-ancestor file merge cleanly, with both additions present and no conflict
 * markers or manual driver registration needed), not a hand-written merge-driver script. `06` §6.7 only
 * ever says "merge driver concatenates" — it does not mandate a custom one, and `union` is exactly that
 * behaviour, already implemented, tested, and shipped as part of git itself for well over a decade,
 * which is strictly safer than this package reinventing the actual three-way concatenation logic (and
 * its quoting/portability) as an external command of its own. */
async function ensureUnionMergeAttribute(cwd: string, glob: string): Promise<void> {
  const attributesPath = path.join(cwd, '.gitattributes');
  const line = `${glob} merge=union`;
  const existing = await fsp.readFile(attributesPath, 'utf8').catch((error: unknown) => {
    if (errorCode(error) === 'ENOENT') return '';
    throw error;
  });
  // Trimmed, not an exact match: a hand-authored .gitattributes with incidental trailing whitespace on
  // an otherwise-identical line is still "already present" — gitattributes is last-match-wins for a
  // given attribute regardless, but a redundant near-duplicate append on every call is not truly
  // idempotent, which a gauntlet critic round flagged directly.
  if (existing.split(/\r?\n/).some((existingLine) => existingLine.trim() === line)) return;
  const withTrailingNewline = existing === '' || existing.endsWith('\n') ? existing : `${existing}\n`;
  await fsp.writeFile(attributesPath, `${withTrailingNewline}${line}\n`, 'utf8');
}

/** The three `06` §6.7 shared-mutable-path strategies. Neither `append-only` nor `regenerate` commits
 * anything — like `enforceClaim`'s own revert, both leave the lane worktree's changes uncommitted, for
 * the same forward-dependency reason: deciding when and how to fold this into a commit is a caller
 * concern, not this package's. */
export async function applySharedPathStrategy(
  handle: LaneHandle,
  options: SharedPathStrategyOptions,
): Promise<void> {
  switch (options.strategy) {
    case 'serialize':
      // A caller-side, scheduling-time concurrency concern (06 §6.7: "claim exclusively for the
      // duration") — @forge/engine's own interval map (SPEC-QUESTIONS.md Q62), not this package's. By
      // the time a lane reaches this function, any needed exclusivity was already held or it was not;
      // there is nothing left for this piece itself to enforce.
      return;
    case 'append-only': {
      const { glob } = options;
      await ensureUnionMergeAttribute(handle.path, glob);
      return;
    }
    case 'regenerate': {
      const { command, glob } = options;
      // Not `wrapGitFailure`: a gauntlet critic round found that reusing it here wrapped an ordinary
      // failing shell command (a network error, a missing dependency) in *git*-flavoured remedy text
      // ("ensure git is installed and on PATH") — actively misleading, since `command` is a configured
      // project command (`execution.sharedMutablePaths` in `.forge/config.yaml`, `18` §18.3), not a git
      // operation, and its failure has nothing to do with git at all.
      try {
        await execa(command, { cwd: handle.path, shell: true });
      } catch (cause) {
        const causeMessage = errorMessage(cause);
        throw new VcsError(
          {
            code: 'VCS-REGENERATE-COMMAND-FAILED',
            message:
              `The configured regenerate command "${command}" for "${glob}" failed in the lane ` +
              `worktree at "${handle.path}": ${causeMessage}`,
            remedy:
              `Verify the command "${command}" runs successfully on its own in this environment ` +
              '(it is a configured project command from execution.sharedMutablePaths, not a git ' +
              'operation — check it is installed and its dependencies are available).',
          },
          { cause },
        );
      }
      return;
    }
  }
}
