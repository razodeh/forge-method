/**
 * `readTextFile`, `pathExists`, `ensureDir`, `listDirSorted` — the remaining `@forge/core/fs`
 * operations, all requiring an `AbsolutePath` from `ProjectPaths.resolveWithin`.
 *
 * @see specs/02 §2.5
 * @see QUALITY-BAR.md R10
 */
import fsp from 'node:fs/promises';

import { ForgeError } from '../errors/forge-error.ts';
import type { AbsolutePath } from './paths.ts';

/** Narrows a caught value to a Node error code, without asserting anything about the rest of it. */
function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

/**
 * Reads `path` as UTF-8 text.
 * @throws {ForgeError} `RUN-034` on any failure, with the original error preserved as `cause`.
 */
export async function readTextFile(path: AbsolutePath): Promise<string> {
  try {
    return await fsp.readFile(path, 'utf8');
  } catch (cause) {
    throw new ForgeError('RUN-034', { operation: 'readTextFile', path }, { cause });
  }
}

/**
 * Whether `path` exists — a file, a directory, anything.
 *
 * Returns `false` for "does not exist" rather than throwing, since that is the expected outcome for
 * roughly half of this function's callers. Anything else (a permissions failure, most notably) is a
 * genuine, unexpected error and is not conflated with a plain "not found".
 *
 * @throws {ForgeError} `RUN-034` for a failure other than the path not existing.
 */
export async function pathExists(path: AbsolutePath): Promise<boolean> {
  try {
    await fsp.access(path);
    return true;
  } catch (cause) {
    if (errorCode(cause) === 'ENOENT') return false;
    throw new ForgeError('RUN-034', { operation: 'pathExists', path }, { cause });
  }
}

/**
 * Creates `path` as a directory, including any missing intermediate directories. A no-op if the
 * directory already exists.
 * @throws {ForgeError} `RUN-034` on any other failure.
 */
export async function ensureDir(path: AbsolutePath): Promise<void> {
  try {
    await fsp.mkdir(path, { recursive: true });
  } catch (cause) {
    throw new ForgeError('RUN-034', { operation: 'ensureDir', path }, { cause });
  }
}

/**
 * Code-unit-order comparison — see `listDirSorted`'s doc comment for why this is not
 * `localeCompare`. Plain `<`/`>` on a JS string compares UTF-16 code units, which agrees with true
 * UTF-8 byte order for every character in the Basic Multilingual Plane but can diverge for an
 * astral-plane character (a surrogate pair, e.g. many emoji): the property this function actually
 * needs — deterministic, locale-independent, and not dependent on the host machine — holds either
 * way, so this divergence is a naming nuance, not a correctness gap against R10.
 */
function byteCompare(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Lists the entries directly inside `path`, sorted by byte value.
 *
 * `fs.readdir`'s order is filesystem-dependent — it can vary by platform, by filesystem
 * implementation, and by history (entries added and removed over a directory's lifetime). Anything
 * built from that order (ID allocation scanning artifacts, schema emission, a generated index) would
 * inherit that non-determinism. Sorting explicitly, and with a comparator that does not call
 * `localeCompare` — whose collation order varies by the host's locale, `QUALITY-BAR.md` R10's other
 * named hazard — makes the result identical on every machine that runs it.
 *
 * @throws {ForgeError} `RUN-034` on any failure, including `path` not existing.
 */
export async function listDirSorted(path: AbsolutePath): Promise<readonly string[]> {
  try {
    // This *is* the sanctioned wrapper R10 points callers at: the unordered read is contained here
    // and never returned without the sort immediately below.
    // eslint-disable-next-line no-restricted-syntax -- see comment above
    const entries = await fsp.readdir(path);
    return entries.sort(byteCompare);
  } catch (cause) {
    throw new ForgeError('RUN-034', { operation: 'listDirSorted', path }, { cause });
  }
}

/** One entry from `listDirEntriesSorted` — a name plus whether it is itself a directory. */
export interface DirEntry {
  readonly name: string;
  readonly isDirectory: boolean;
}

/**
 * Lists the entries directly inside `path`, sorted by byte value, each tagged with whether it is
 * itself a directory — a recursive walk (ID allocation's project scan, `PLAN-M1.md` P13) needs this
 * to decide whether to recurse into an entry, which `listDirSorted`'s bare names cannot answer
 * without a second, separately-unordered `stat` call per entry.
 *
 * @throws {ForgeError} `RUN-034` on any failure, including `path` not existing.
 */
export async function listDirEntriesSorted(path: AbsolutePath): Promise<readonly DirEntry[]> {
  try {
    // Same sanctioned wrapper as listDirSorted above — the unordered read never leaves this
    // function without the sort immediately below.
    // eslint-disable-next-line no-restricted-syntax -- see listDirSorted's comment above
    const entries = await fsp.readdir(path, { withFileTypes: true });
    return entries
      .map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }))
      .sort((a, b) => byteCompare(a.name, b.name));
  } catch (cause) {
    throw new ForgeError('RUN-034', { operation: 'listDirEntriesSorted', path }, { cause });
  }
}
