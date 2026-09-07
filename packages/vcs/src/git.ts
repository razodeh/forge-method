/**
 * Git primitives every later `@forge/vcs` piece builds on: is git usable at all, is the working tree
 * clean, and a pre-run snapshot of exactly what state to return to. `specs/02` §2.1's own tech
 * decision: porcelain reads go through `simple-git`, direct mutation (later pieces: worktrees,
 * commits) goes through a raw `git` subprocess via `execa` — "worktree support in libs is weak."
 *
 * Every exported function here rejects/throws only `VcsError` — never a raw `simple-git`/`execa`
 * error — so a caller can always safely inspect `.code`/`.remedy` without first checking what kind of
 * failure it received. A prior gauntlet round found several call sites leaking the underlying library's
 * own exception type for realistic failures (a bare repository, a permission error, a corrupted
 * `.git`), contradicting each function's own documented contract; `wrapGitFailure` is the one place
 * that guarantee is enforced, so a future new call site cannot reintroduce the same gap silently.
 *
 * @see specs/06 §6.4
 * @see specs/20 §20.2
 * @see PLAN-M5.md P1
 */
import { execa, ExecaError } from 'execa';
import { simpleGit, type SimpleGit } from 'simple-git';

import { VcsError } from './errors.ts';

export interface RepoSnapshot {
  /** `undefined` for a brand-new repository with no commits yet — a legitimate state, not an error. */
  readonly sha: string | undefined;
  readonly dirtyFiles: readonly string[];
}

function openGit(cwd: string): SimpleGit {
  return simpleGit(cwd);
}

/** Wraps any non-`VcsError` failure from a git operation into one, preserving the original as `cause`
 * so no diagnostic detail is lost — just consistently reachable through one type. A `VcsError` thrown
 * from inside `operation` itself (a caller-visible, already-classified failure — none of this module's
 * own current call sites produce one, but a future one might) passes through unchanged rather than
 * being double-wrapped. Exported so both branches are directly testable without needing a specific
 * shape of real git failure to construct one. */
export async function wrapGitFailure<T>(operation: () => Promise<T>, context: string): Promise<T> {
  try {
    return await operation();
  } catch (cause) {
    if (cause instanceof VcsError) throw cause;
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new VcsError(
      {
        code: 'VCS-GIT-OPERATION-FAILED',
        message: `git operation failed while ${context}: ${message}`,
        remedy:
          'Ensure the target directory is a valid git repository with a working tree (not bare), ' +
          'that git is installed and on PATH, and that this process has permission to read it. See ' +
          'the underlying cause for the exact git error.',
      },
      { cause },
    );
  }
}

/** Throws a `VcsError` if `git` is not on `PATH`, or if `cwd` is not inside a git repository — the two
 * distinct failure modes `06` §6.4's own "FORGE requires git" line collapses into one sentence, kept
 * separate here since each has a genuinely different remedy. Reports the fact; per `06` §6.4's own
 * "if refused, parallelism is disabled and lanes degrade to sequential in-place execution", a caller
 * — not this function — decides what a refusal means for the run.
 *
 * `ENV-GIT-MISSING` is reported for *any* `git --version` failure, not only a genuinely missing
 * binary — `--version` itself can fail for other reasons (e.g. a corrupt global config it still reads
 * before printing) — accepted as a known imprecision: the common case is overwhelmingly "not
 * installed," and the alternative (guessing at a cause from `--version`'s own failure text) would be
 * exactly the locale-fragile message-matching this module deliberately avoids elsewhere in it (see
 * `isNoCommitsYetResult` below). */
export async function assertGitAvailable(cwd: string): Promise<void> {
  try {
    await execa('git', ['--version']);
  } catch (cause) {
    throw new VcsError(
      {
        code: 'ENV-GIT-MISSING',
        message: 'git was not found on PATH.',
        remedy: 'Install git (https://git-scm.com/downloads) and ensure it is on PATH, then retry.',
      },
      { cause },
    );
  }

  const isRepo = await wrapGitFailure(
    () => openGit(cwd).checkIsRepo(),
    `checking whether "${cwd}" is a git repository`,
  );
  if (!isRepo) {
    throw new VcsError({
      code: 'VCS-NOT-A-REPO',
      message: `"${cwd}" is not inside a git repository.`,
      remedy:
        'Run `git init` in this directory, or point FORGE at an existing git repository. Without ' +
        'git, parallelism is disabled and lanes degrade to sequential in-place execution.',
    });
  }
}

/** Every changed path — staged, unstaged, and untracked alike — relative to `cwd`. Untracked files
 * inside a brand-new directory are listed individually, not collapsed into the directory's own path:
 * `simple-git`'s own default `status()` call passes bare `-u` to `git status`, which is documented to
 * behave as `--untracked-files=all`, not git's own collapsing `normal` default — confirmed empirically
 * against a real repository before relying on it, since a prior gauntlet round (`PLAN-M4.md` P4) found
 * this exact collapsing behaviour silently hid a file inside a new directory from an equivalent check.
 *
 * Two accepted, documented limitations, neither a safety gap (the tree is still correctly reported
 * non-empty/dirty in both cases, so `assertCleanWorkingTree` still halts the run): a renamed file is
 * reported only by its new path, not `"old -> new"`; a change *inside* a submodule's own working tree
 * is reported only as the submodule's own gitlink path (e.g. `"vendor/lib"`), never the individual
 * file(s) that changed inside it — submodule content is opaque to the superproject's own `git status`
 * by design, and seeing inside one needs a separate, recursive status call this piece does not make. */
export async function getDirtyFiles(cwd: string): Promise<readonly string[]> {
  return wrapGitFailure(async () => {
    const status = await openGit(cwd).status();
    return status.files.map((file) => file.path);
  }, `reading git status for "${cwd}"`);
}

/** Whether `error` is exactly "`HEAD` has no commits yet" — decided structurally, from `git rev-parse
 * --verify -q HEAD`'s own exit code and (lack of) `stderr` output, never by matching English message
 * text. `-q`/`--quiet` specifically suppresses git's own "not a valid ref" message for precisely this
 * case (confirmed empirically against a real repository: exit code 1, empty `stderr`), so an unborn
 * `HEAD` is structurally distinguishable from a genuinely unexpected failure (a corrupted repository
 * still exits differently — 128, in practice — *and* still writes a real `fatal:` line to `stderr`,
 * confirmed the same way) without depending on git's own locale at all. An earlier version of this
 * check matched git's own English error text, which broke under a non-English `LANG`/`LC_ALL`; the fix
 * attempted next — forcing the git subprocess's locale via `simple-git`'s own `env()` — turned out to
 * replace the *entire* subprocess environment rather than merge with it (losing `PATH` among other
 * things) and separately tripped `simple-git`'s own unsafe-operations guard on an ambient `GIT_EDITOR`
 * variable already present in the calling environment. This structural check needed neither fix, and
 * needs no pinned locale, no `execa`-inherited-environment reasoning, and no `simple-git` `env()` call
 * at all — the property it depends on (exit code, `stderr` emptiness) is not locale text. */
export function isNoCommitsYetResult(error: unknown): boolean {
  // `ExecaError`'s own `stderr` field type is generic over the spawn options TS cannot recover from a
  // bare `instanceof` check, so it widens to a union `no-unnecessary-condition` considers incapable of
  // ever equaling a literal `''` — true only in that general, unconstrained type, not for this actual
  // default-options spawn (plain `execa(...)`, no custom stdio/encoding), where `stderr` is a real
  // string at runtime. The explicit `typeof` check below is a genuine runtime guard, not a formality:
  // it is what makes the subsequent `=== ''` comparison type-correct without asserting the type away.
  return (
    error instanceof ExecaError && error.exitCode === 1 && typeof error.stderr === 'string' && error.stderr === ''
  );
}

/** `HEAD`'s own SHA has no meaning in a repository with zero commits — returns `undefined` for that
 * case (via `isNoCommitsYetResult`) rather than throwing; any other failure propagates as whatever
 * `execa` itself threw (this function does not know about `VcsError` and is not responsible for that
 * wrapping — its own caller, `snapshotRepoState`, is, via `wrapGitFailure`). Uses `execa` directly
 * rather than `simple-git`'s own `revparse`: `--verify -q` is the one flag combination that makes the
 * "no commits yet" case structurally recognisable at all (see `isNoCommitsYetResult`), and it also
 * conveniently returns the resolved sha on `stdout` when `HEAD` *does* resolve, so one spawn serves
 * both purposes. */
export async function resolveHeadShaOrUndefined(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execa('git', ['rev-parse', '--verify', '-q', 'HEAD'], { cwd });
    return stdout.trim();
  } catch (error) {
    if (!isNoCommitsYetResult(error)) throw error;
    return undefined;
  }
}

/** The pre-run snapshot `20` §20.2 point 6 requires: the exact starting SHA and dirty-file list, so a
 * later `forge doctor` can always report exactly what state to return to. */
export async function snapshotRepoState(cwd: string): Promise<RepoSnapshot> {
  const dirtyFiles = await getDirtyFiles(cwd);
  const sha = await wrapGitFailure(
    () => resolveHeadShaOrUndefined(cwd),
    `resolving HEAD for "${cwd}"`,
  );
  return { sha, dirtyFiles };
}

/** Throws a `VcsError` naming every dirty file when the working tree is not clean. `20` §20.2 point 5:
 * "the user's uncommitted work is sacred" — FORGE never discards it, and never starts a run that could
 * conflict with work it cannot see. The three offered remedies (stash/commit/abort) are named in the
 * error's own `remedy` text; which one to take is not this function's decision. */
export async function assertCleanWorkingTree(cwd: string): Promise<void> {
  const dirtyFiles = await getDirtyFiles(cwd);
  if (dirtyFiles.length === 0) return;
  throw new VcsError({
    code: 'VCS-DIRTY-TREE',
    message:
      `The working tree has ${String(dirtyFiles.length)} uncommitted change(s): ` +
      `${dirtyFiles.join(', ')}.`,
    remedy:
      'Stash your changes (`git stash`), commit them, or explicitly abort this run. FORGE never ' +
      'discards uncommitted work.',
  });
}
