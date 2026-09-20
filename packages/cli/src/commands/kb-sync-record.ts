/**
 * The record `forge kb sync` leaves of the KB files it indexed: a content hash of every KB file, in
 * `.forge/state/kb-files.json`. `forge kb lint --rule kb-synced` (`G-Operate`) compares it with the files now.
 *
 * Why it exists: the derived index (`@forge/kb/db`) holds a hash of each PARSED entry, and it indexes only the
 * kb-entry, adr, diagram and runbook kinds. An edit to an ADR or runbook body, or to `components.md`,
 * `environments.md` or any register, leaves every indexed hash unchanged, so a check that only compared the index
 * would call an edited KB "synced". `08` §8.9 says human edits are detected "via content hash"; this is that hash,
 * over the file bytes, for every file the KB parser reads.
 *
 * @see specs/08 §8.9
 * @see PLAN-M13.md P25
 */
import { lstat } from 'node:fs/promises';

import {
  listDirEntriesSorted,
  pathExists,
  readTextFile,
  writeFileAtomic,
  type AbsolutePath,
  type ProjectPaths,
} from '@forge/core/fs';

import { sha256 } from '../init/hash.ts';

const RECORD_FILE = 'kb-files.json';

/** Generated or human-only files the KB parser skips (`@forge/kb/schema`); an edit to one is not KB drift. */
const SKIPPED_NAMES = new Set(['index.md', 'README.md']);

export type KbFileHashes = Readonly<Record<string, string>>;

async function walk(paths: ProjectPaths, kbRoot: string, relativeDir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await listDirEntriesSorted(
    paths.resolveWithin(relativeDir === '' ? kbRoot : `${kbRoot}/${relativeDir}`),
  );
  for (const entry of entries) {
    const relative = relativeDir === '' ? entry.name : `${relativeDir}/${entry.name}`;
    if (entry.isDirectory) files.push(...(await walk(paths, kbRoot, relative)));
    else files.push(relative);
  }
  return files;
}

/** What is recorded for a KB file that cannot be read (a dangling symlink, a permission error, a FIFO): a fixed
 * marker, so `forge kb sync` still succeeds and the file is not silently skipped. `parseKbTree` reports the same
 * file as a schema finding, which is what fails the `kb-synced` check. */
const UNREADABLE = 'unreadable';

/** A regular file only, read with a size cap: a FIFO would block a read and `/dev/zero` symlinked into the KB
 * would fill memory. */
async function hashOne(absolute: string): Promise<string> {
  try {
    const info = await lstat(absolute);
    if (!info.isFile() || info.size > MAX_HASHED_BYTES) return UNREADABLE;
    return sha256(await readTextFile(absolute as AbsolutePath));
  } catch {
    return UNREADABLE;
  }
}

const MAX_HASHED_BYTES = 8 * 1024 * 1024;

/** Content hash of every file the KB parser reads (`.md` and `.mmd.yaml`, not the generated index or README), keyed
 * by path relative to the KB root. A missing or unwalkable KB root is an empty set (the tree parse reports it). */
export async function hashKbFiles(paths: ProjectPaths, kbRoot: string): Promise<KbFileHashes> {
  if (!(await pathExists(paths.resolveWithin(kbRoot)))) return {};
  let relatives: string[];
  try {
    relatives = await walk(paths, kbRoot, '');
  } catch {
    return {};
  }
  const hashes: Record<string, string> = {};
  for (const relative of relatives) {
    const name = relative.split('/').at(-1) ?? relative;
    if (SKIPPED_NAMES.has(name)) continue;
    if (!relative.endsWith('.md') && !relative.endsWith('.mmd.yaml')) continue;
    hashes[relative] = await hashOne(paths.resolveWithin(`${kbRoot}/${relative}`));
  }
  return hashes;
}

export async function writeKbSyncRecord(paths: ProjectPaths, kbRoot: string): Promise<void> {
  const files = await hashKbFiles(paths, kbRoot);
  await writeFileAtomic(
    paths.resolveState(RECORD_FILE),
    `${JSON.stringify({ v: 1, files }, null, 2)}\n`,
  );
}

export type KbSyncRecordRead =
  | { readonly status: 'missing' }
  | { readonly status: 'unreadable'; readonly detail: string }
  | { readonly status: 'ok'; readonly files: KbFileHashes };

export async function readKbSyncRecord(paths: ProjectPaths): Promise<KbSyncRecordRead> {
  const file = paths.resolveState(RECORD_FILE);
  if (!(await pathExists(file))) return { status: 'missing' };
  try {
    const parsed = JSON.parse(await readTextFile(file)) as { v?: unknown; files?: unknown };
    const files = parsed.files;
    if (
      parsed.v !== 1 ||
      typeof files !== 'object' ||
      files === null ||
      !Object.values(files).every((value) => typeof value === 'string')
    ) {
      return { status: 'unreadable', detail: `${RECORD_FILE} is not a v1 record` };
    }
    return { status: 'ok', files: files as KbFileHashes };
  } catch (cause) {
    return {
      status: 'unreadable',
      detail: `${RECORD_FILE}: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
}
