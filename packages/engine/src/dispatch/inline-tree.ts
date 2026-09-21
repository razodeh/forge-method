/**
 * The integration worktree an inline `command` step runs in, and the check that the step left it as it found
 * it (`PLAN-M13.md` P19, `06` §6.2 `laneAffinity: 'inline'`, `10` §10.1, `SPEC-QUESTIONS.md` Q221).
 *
 * An inline step "runs in the supervisor, no worktree" (`06` §6.2): it does not get a lane, so it runs against
 * the integrated state of the run, the same tree a `gate` reads and a `merge` writes: the integration worktree.
 * That is what lets `derive-run-plan` see the Epics and Stories earlier lanes created. It is also a tree the
 * merge queue owns: a merge into a worktree with local changes fails, and a worktree moved to another branch
 * merges into the wrong one. So an inline step is read-only with respect to it, and the engine enforces that
 * rather than trusting each command: the tree's HEAD, branch and non-ignored changes are recorded before the
 * step and compared after; anything the step changed is reverted and the step fails, naming what it touched.
 * Ignored paths (`.forge/state/`, build output the project ignores) are not the merge's concern and may be
 * written freely.
 */
import { rm } from 'node:fs/promises';
import path from 'node:path';

import { execa } from 'execa';

export interface TreeSnapshot {
  readonly head: string;
  /** The checked-out branch, or `undefined` for a detached HEAD. */
  readonly branch: string | undefined;
  /** `git status --porcelain` entries (status code plus path) present before the step. */
  readonly dirty: ReadonlySet<string>;
}

interface StatusEntry {
  readonly code: string;
  readonly path: string;
  readonly raw: string;
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await execa('git', [...args], { cwd, env: { LC_ALL: 'C', LANG: 'C' } });
  return result.stdout;
}

async function readStatus(cwd: string): Promise<readonly StatusEntry[]> {
  const raw = await git(cwd, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--no-renames',
  ]);
  return raw
    .split('\0')
    .filter((entry) => entry.length > 3)
    .map((entry) => ({ code: entry.slice(0, 2), path: entry.slice(3), raw: entry }));
}

async function readBranch(cwd: string): Promise<string | undefined> {
  const result = await execa('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
    cwd,
    reject: false,
  });
  return result.exitCode === 0 ? result.stdout.trim() : undefined;
}

/** Records what the integration worktree looks like now. */
export async function snapshotIntegrationTree(cwd: string): Promise<TreeSnapshot> {
  const [head, branch, status] = await Promise.all([
    git(cwd, ['rev-parse', 'HEAD']),
    readBranch(cwd),
    readStatus(cwd),
  ]);
  return { head: head.trim(), branch, dirty: new Set(status.map((entry) => entry.raw)) };
}

/** A path git reported relative to `cwd`, resolved and refused if it would leave `cwd`. */
function insideTree(cwd: string, relative: string): string | undefined {
  const root = path.resolve(cwd);
  const target = path.resolve(root, relative);
  return target === root || !target.startsWith(root + path.sep) ? undefined : target;
}

/**
 * Puts the worktree back the way `before` recorded it and returns what the step had changed (empty when it
 * changed nothing). Order: the checked-out branch and commit first (a step that switched branches or committed
 * is undone, with a hard reset that also drops anything else in the tree, before its file changes are looked
 * at), then every non-ignored change that was not already there is reverted, path by path (`--literal-pathspecs`:
 * a file named `*` or `[a]` is that file). The integration tree is clean between steps (a merge needs it to be),
 * so "already there" is empty in practice; a change that was already there is not touched, and re-modifying an
 * already-modified file is not seen. Refs a step created (a stray branch after `git switch -c`) are not removed.
 */
export async function restoreIntegrationTree(
  cwd: string,
  before: TreeSnapshot,
): Promise<readonly string[]> {
  const changes: string[] = [];
  const branch = await readBranch(cwd);
  const head = (await git(cwd, ['rev-parse', 'HEAD'])).trim();
  if (branch !== before.branch) {
    changes.push(
      `switched the worktree from ${before.branch ?? 'a detached HEAD'} to ${branch ?? 'a detached HEAD'}`,
    );
    await git(
      cwd,
      before.branch === undefined
        ? ['checkout', '--force', '--detach', before.head]
        : ['checkout', '--force', before.branch],
    );
  }
  if ((await git(cwd, ['rev-parse', 'HEAD'])).trim() !== before.head) {
    if (branch === before.branch) changes.push(`moved HEAD from ${before.head} to ${head}`);
    await git(cwd, ['reset', '--hard', '--quiet', before.head]);
  }

  for (const entry of await readStatus(cwd)) {
    if (before.dirty.has(entry.raw)) continue;
    const target = insideTree(cwd, entry.path);
    if (target === undefined) continue;
    if (entry.code === '??') {
      changes.push(`created ${entry.path}`);
      await rm(target, { recursive: true, force: true });
      continue;
    }
    const inHead = await execa('git', ['cat-file', '-e', `HEAD:${entry.path}`], {
      cwd,
      reject: false,
    });
    if (inHead.exitCode === 0) {
      changes.push(`modified ${entry.path}`);
      await git(cwd, [
        '--literal-pathspecs',
        'restore',
        '--source=HEAD',
        '--staged',
        '--worktree',
        '--',
        entry.path,
      ]);
    } else {
      changes.push(`added ${entry.path}`);
      await git(cwd, ['--literal-pathspecs', 'rm', '-rf', '--quiet', '--', entry.path]);
    }
  }
  return changes;
}
