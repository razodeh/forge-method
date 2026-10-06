/**
 * `takeTreeSnapshot`/`snapshotsEqual`/`snapshotDigest` — the cleanliness snapshot `13` F-TEST-9's
 * observation bullets take before and after every case, so that a case which left the observed tree
 * dirty (or wrote outside its declared `outputs`) can be told apart from one that did not.
 *
 * **Why `git status`, not the index or a recursive `fs` walk.** `13` F-TEST-9 says plainly: `HEAD`,
 * plus every path `git status --porcelain=v1 -z --no-renames --untracked-files=all` lists, its status
 * code and a content digest. Letting git decide which paths are "changed" is what makes an ignored
 * file, and a tracked file marked `skip-worktree` or `assume-unchanged`, fall out of this function for
 * free: confirmed directly against a real repository (this module's own test file) that
 * `git status` never lists either kind at all, even after the file's content on disk is edited or the
 * file is deleted — there is no separate filter to write or to forget.
 *
 * **Why the repository's real top level, not `root`.** `git status`'s own paths are relative to the
 * repository's top level, which can lie ABOVE a project that sits in a subdirectory of a larger
 * repository. Resolving a listed path against `root` directly, instead of against the real top level,
 * would silently compute the wrong absolute path for a nested project — this module's own test proves
 * the difference matters by using a repository whose top level genuinely differs from `root`.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M16.md P3
 */
import { createHash } from 'node:crypto';
import { lstat, readFile, readlink } from 'node:fs/promises';
import path from 'node:path';

import { ForgeError } from '@forge/core/errors';
import { execa } from 'execa';

import { toCanonicalJson } from './canonical-json.ts';
import type { TreeSnapshot, TreeSnapshotEntry } from './observe-types.ts';

function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function isNodeErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

/** Why a git command this module ran failed, as the identical `vcsCode`/`vcsMessage` shape
 * `RUN-037`/`RUN-124` already give a wrapped `VcsError` — this module has no `@forge/vcs` dependency
 * of its own (it needs only `execa`), so the shape is built locally rather than pulled in for one
 * reuse. */
function wrapGitFailure(path_: string, operation: string, cause: unknown): ForgeError {
  const vcsCode = isNodeErrnoException(cause) && cause.code !== undefined ? cause.code : 'UNKNOWN';
  const vcsMessage = cause instanceof Error ? cause.message : String(cause);
  return new ForgeError('RUN-126', { path: path_, vcsCode, vcsMessage }, { cause });
}

async function repositoryTopLevel(root: string): Promise<string> {
  try {
    const { stdout } = await execa('git', ['rev-parse', '--show-toplevel'], { cwd: root });
    return stdout.trim();
  } catch (cause) {
    throw wrapGitFailure(root, 'resolving the repository top level', cause);
  }
}

async function headSha(topLevel: string): Promise<string> {
  try {
    const { stdout } = await execa('git', ['rev-parse', '--verify', 'HEAD'], { cwd: topLevel });
    return stdout.trim();
  } catch (cause) {
    throw wrapGitFailure(topLevel, 'resolving HEAD', cause);
  }
}

/** Parses `git status --porcelain=v1 -z --no-renames --untracked-files=all`'s own NUL-terminated
 * output: each entry is exactly `XY path\0` with `--no-renames` (no `path -> newpath` to split), so
 * the two status characters and one separating space are simply sliced off the front of each
 * NUL-delimited record. */
function parsePorcelainEntries(stdout: string): readonly { path: string; status: string }[] {
  const entries: { path: string; status: string }[] = [];
  for (const record of stdout.split('\0')) {
    if (record === '') continue;
    const status = record.slice(0, 2);
    const entryPath = record.slice(3);
    entries.push({ path: entryPath, status });
  }
  return entries;
}

/** `absent`/`dir`/`link:<target>` for anything that is not a regular file, or the sha256 of a
 * regular file's bytes (`13` F-TEST-9). `lstat`, never `stat`: a symlink is reported as itself, never
 * followed. */
async function contentDigest(absolutePath: string): Promise<string> {
  let stats;
  try {
    stats = await lstat(absolutePath);
  } catch (cause) {
    if (isNodeErrnoException(cause) && cause.code === 'ENOENT') return 'absent';
    throw cause;
  }
  if (stats.isSymbolicLink()) {
    const target = await readlink(absolutePath);
    return `link:${target}`;
  }
  if (stats.isDirectory()) return 'dir';
  if (!stats.isFile()) return 'other';
  const bytes = await readFile(absolutePath);
  return sha256Hex(bytes);
}

/**
 * Takes a cleanliness snapshot of the tree containing `root` (`13` F-TEST-9): `HEAD`, plus every path
 * `git status` lists, each with its status code and a content digest, sorted by path.
 *
 * @throws {ForgeError} `RUN-126` if the underlying git commands fail (not a git repository, a
 * corrupted one, or similar) — "a snapshot that cannot be taken" is one of the harness's own named
 * failure causes (`13` F-TEST-9's Verdicts section).
 */
export async function takeTreeSnapshot(root: string): Promise<TreeSnapshot> {
  const topLevel = await repositoryTopLevel(root);
  const sha = await headSha(topLevel);
  let stdout: string;
  try {
    ({ stdout } = await execa(
      'git',
      ['status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all'],
      { cwd: topLevel },
    ));
  } catch (cause) {
    throw wrapGitFailure(topLevel, 'reading git status', cause);
  }
  const parsed = parsePorcelainEntries(stdout);
  const entries: TreeSnapshotEntry[] = await Promise.all(
    parsed.map(async ({ path: entryPath, status }) => ({
      path: entryPath,
      status,
      content: await contentDigest(path.join(topLevel, entryPath)),
    })),
  );
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { headSha: sha, entries };
}

/** Whether two snapshots describe the identical tree state: the same `HEAD` and the identical set of
 * entries (path, status and content digest all equal) — never a partial or best-effort comparison. */
export function snapshotsEqual(a: TreeSnapshot, b: TreeSnapshot): boolean {
  if (a.headSha !== b.headSha) return false;
  if (a.entries.length !== b.entries.length) return false;
  for (let index = 0; index < a.entries.length; index += 1) {
    const left = a.entries[index];
    const right = b.entries[index];
    if (left === undefined || right === undefined) return false;
    if (
      left.path !== right.path ||
      left.status !== right.status ||
      left.content !== right.content
    ) {
      return false;
    }
  }
  return true;
}

/** A sha256 over `snapshot`'s canonical form (`canonical-json.ts`'s own `toCanonicalJson`) — what
 * `13` F-TEST-9 calls "the delta digest recorded for the candidate", taken of the snapshot before the
 * FIRST case, never recomputed per case. */
export function snapshotDigest(snapshot: TreeSnapshot): string {
  return sha256Hex(
    toCanonicalJson({
      headSha: snapshot.headSha,
      entries: snapshot.entries.map((entry) => ({
        path: entry.path,
        status: entry.status,
        content: entry.content,
      })),
    }),
  );
}
