/**
 * The committed project: the files a clean clone of `HEAD` would contain, and their contents.
 *
 * `G-Foundation`'s three environment rules (`clean-build`, `reproducible-install`, `ci-skeleton`) ask about a clean
 * clone (`10` §10.3: "Clean clone doesn't build; no reproducible install; CI skeleton absent"). A file that exists
 * only in the working tree, or is staged but uncommitted, or is git-ignored, is not in a clean clone, so reading the
 * working tree would pass on exactly the input the rules exist to catch. This module lists and reads `HEAD` only.
 *
 * Paths are relative to the project root, which may sit below the git root (`git ls-tree ... -- .` shows paths
 * relative to the current directory). git is run with an argument vector, never a shell string.
 *
 * @see specs/10 §10.3
 * @see PLAN-M13.md P25
 */
import { execa } from 'execa';

export interface CommittedFile {
  readonly size: number;
  /** The blob's object id: how the content is read back. */
  readonly oid: string;
}

export interface CommittedTree {
  /** Project-relative POSIX paths in `HEAD` (blobs only), with their size. */
  readonly files: ReadonlyMap<string, CommittedFile>;
  /** The committed text of `path`, or why it cannot be had (not in `HEAD`, over the read cap, unreadable). A value,
   * not a rejection: a file that cannot be read is a finding for the rule, and is handled where it is read. */
  read(
    path: string,
  ): Promise<
    { readonly ok: true; readonly text: string } | { readonly ok: false; readonly detail: string }
  >;
}

export type CommittedTreeResult =
  | { readonly ok: true; readonly tree: CommittedTree }
  | {
      readonly ok: false;
      readonly reason: 'not-a-repository' | 'no-commit' | 'unreadable';
      readonly detail: string;
    };

/** The largest single file read back: a manifest or workflow, never a lockfile (only its size is needed). */
const MAX_READ_BYTES = 4 * 1024 * 1024;
const MAX_LISTING_BYTES = 64 * 1024 * 1024;

/** Never fetch from a promisor remote to answer a question about a local repository: the check reads project state
 * and must not touch the network (a partial clone would otherwise fetch each blob it reads). */
const GIT_ENV = { GIT_NO_LAZY_FETCH: '1' } as const;

/** Regular files only (mode 100644 / 100755): a committed symlink (120000) is a pointer, not the content, so a
 * `pnpm-lock.yaml` that links to `/dev/null` must not count as a lockfile. Submodules are `commit` entries and
 * never match. */
const LS_TREE_ENTRY = /^100(?:644|755) blob ([0-9a-f]+) +(\d+)\t([\s\S]+)$/;

function firstLine(text: string): string {
  return text.trim().split('\n')[0] ?? '';
}

/** Lists and reads what `HEAD` contains, relative to `projectRoot`. Never throws for a repository problem: a missing
 * repository, a repository with no commit and an unreadable listing are each a typed result the rule reports. */
export async function readCommittedTree(projectRoot: string): Promise<CommittedTreeResult> {
  const inside = await execa('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: projectRoot,
    reject: false,
    env: GIT_ENV,
  });
  if (inside.exitCode !== 0 || inside.stdout.trim() !== 'true') {
    return {
      ok: false,
      reason: 'not-a-repository',
      detail: firstLine(inside.stderr) || 'not inside a git work tree',
    };
  }
  const head = await execa('git', ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], {
    cwd: projectRoot,
    reject: false,
    env: GIT_ENV,
  });
  if (head.exitCode !== 0) {
    return { ok: false, reason: 'no-commit', detail: 'the repository has no commit yet' };
  }
  const listing = await execa('git', ['ls-tree', '-r', '-l', '-z', 'HEAD', '--', '.'], {
    cwd: projectRoot,
    reject: false,
    maxBuffer: MAX_LISTING_BYTES,
    env: GIT_ENV,
  });
  if (listing.exitCode !== 0) {
    return {
      ok: false,
      reason: 'unreadable',
      detail: firstLine(listing.stderr) || `git ls-tree exited ${String(listing.exitCode)}`,
    };
  }
  const files = new Map<string, CommittedFile>();
  for (const entry of listing.stdout.split('\0')) {
    const match = LS_TREE_ENTRY.exec(entry);
    if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) continue;
    files.set(match[3], { oid: match[1], size: Number(match[2]) });
  }
  return {
    ok: true,
    tree: {
      files,
      async read(path: string) {
        const file = files.get(path);
        if (file === undefined) return { ok: false, detail: `${path} is not committed` };
        if (file.size > MAX_READ_BYTES) {
          return {
            ok: false,
            detail: `${path} is ${String(file.size)} bytes, over the ${String(MAX_READ_BYTES)} byte read cap`,
          };
        }
        const blob = await execa('git', ['cat-file', 'blob', file.oid], {
          cwd: projectRoot,
          reject: false,
          maxBuffer: MAX_READ_BYTES,
          stripFinalNewline: false,
          env: GIT_ENV,
        });
        if (blob.exitCode !== 0) {
          return {
            ok: false,
            detail: firstLine(blob.stderr) || `git cat-file exited ${String(blob.exitCode)}`,
          };
        }
        return { ok: true, text: blob.stdout };
      },
    },
  };
}
