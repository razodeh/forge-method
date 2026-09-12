/**
 * The single filesystem walk every SURVEY/INVENTORY signal extractor runs against, so a target repo
 * is only ever traversed once regardless of how many facts get pulled out of it. `17` §17.2 phase 1 is
 * explicit that SURVEY is "read-only" — nothing here writes to the target repository.
 *
 * Built on `@forge/core/fs`'s `ProjectPaths`/`listDirEntriesSorted` rather than a bare `fs.readdir`:
 * the same recursive-scan shape `@forge/core`'s own ID-allocator project walk already uses
 * (`listDirEntriesSorted`'s own doc comment names it directly), and — a real bonus, not just
 * convention-following — `ProjectPaths.resolveWithin` rejects a symlink that would escape `rootDir`
 * for every path this walker touches, for free.
 *
 * @see specs/17 §17.2
 * @see PLAN-M10.md P15
 */
import { listDirEntriesSorted, ProjectPaths, type AbsolutePath } from '@forge/core/fs';

/** A file found while walking a target repository, relative to its root. */
export interface WalkedFile {
  /** POSIX-separated, relative to the repo root — stable across platforms so a fixture's expected
   * facts can be written once, not per-OS. */
  readonly relPath: string;
  readonly absPath: string;
}

/**
 * Directory names never descended into. Each owns a real, distinct reason: `.git` is VCS-internal
 * state, not source; `node_modules`/`vendor`/`.venv`/`venv`/`target` (Cargo's build dir, distinct
 * from a source dir also plausibly named `target`) are dependency or build output, not written by
 * this repository's own contributors; `dist`/`build`/`out`/`.next`/`.turbo`/coverage/cache dirs are
 * generated. Walking any of these would make every size/health signal measure the target's tooling
 * instead of its code — the opposite of `17` §17.2's own "facts only" mandate. Kept as an exported
 * `Set` (not inlined) so a caller can extend it for a target-repo-specific convention SURVEY has no
 * way to know about in advance (`--depth quick` in `17` §17.6, for instance, may want a narrower set).
 */
export const DEFAULT_IGNORED_DIR_NAMES: ReadonlySet<string> = new Set([
  '.git',
  'node_modules',
  'vendor',
  '.venv',
  'venv',
  '__pycache__',
  'target',
  'dist',
  'build',
  'out',
  '.next',
  '.turbo',
  'coverage',
  '.cache',
  '.pytest_cache',
  '.mypy_cache',
]);

/**
 * Every entry under `rootDir` not itself a directory, skipping `ignoredDirNames`. Symlinked
 * directories are not followed — a `Dirent`'s own `isDirectory()` reports the entry's own type, never
 * the target of a symlink — a deliberate choice: following symlinks in an arbitrary, "possibly wrong
 * about itself" target repo (`17` §17.1) risks an unbounded or cyclic walk this function has no way
 * to detect in advance. A symlink (or a socket, fifo, or other non-regular entry) is still recorded
 * as a `WalkedFile`, on the same reasoning `survey.ts`'s own module doc comment gives for a malformed
 * file: every text-reading extractor already tolerates an unreadable path by contributing no fact
 * rather than throwing, so there is nothing this function needs to special-case here.
 *
 * Entries are read in sorted order at each directory level (`listDirEntriesSorted`'s own contract),
 * so the result is deterministic across platforms and filesystem implementations, which is what lets
 * a fixture-based test assert an exact array rather than an unordered set.
 */
export async function walkRepository(
  rootDir: string,
  ignoredDirNames: ReadonlySet<string> = DEFAULT_IGNORED_DIR_NAMES,
): Promise<readonly WalkedFile[]> {
  const paths = new ProjectPaths(rootDir);
  const results: WalkedFile[] = [];

  async function recurse(relDir: string, absDir: AbsolutePath): Promise<void> {
    const entries = await listDirEntriesSorted(absDir);
    for (const entry of entries) {
      const relPath = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
      if (entry.isDirectory) {
        if (ignoredDirNames.has(entry.name)) continue;
        await recurse(relPath, paths.resolveWithin(relPath));
      } else {
        results.push({ relPath, absPath: paths.resolveWithin(relPath) });
      }
    }
  }

  await recurse('', paths.resolveWithin('.'));
  return results;
}
