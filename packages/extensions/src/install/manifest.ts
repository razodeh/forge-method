/**
 * `findManifestKind` — whether a fetched bundle directory is a real, installable overlay or module
 * (`19` §19.5 step 2: "Parse overlay.yaml / module.yaml"), shared by every channel's own fetch
 * orchestration (`fetch-local.ts`, `fetch-git.ts`) rather than each re-deriving the same two-filename
 * check.
 *
 * @see specs/19 §19.5
 * @see PLAN-M11.md P1
 */
import { stat } from 'node:fs/promises';
import path from 'node:path';

import { ForgeError } from '@forge/core';

export type OverlayManifestKind = 'overlay' | 'module';

/** Checked in this fixed order (not derived from a directory listing) so the result never depends on
 * filesystem enumeration order — a directory could in principle carry both files, and `'overlay'`
 * winning is a deliberate, documented tie-break, not an accident of `readdir`'s own ordering. */
const MANIFEST_FILENAMES: readonly (readonly [OverlayManifestKind, string])[] = [
  ['overlay', 'overlay.yaml'],
  ['module', 'module.yaml'],
];

/** Narrows a caught value to a Node error code, without asserting anything about the rest of it —
 * the identical narrowing `@forge/core/fs/operations.ts`'s own `errorCode` already establishes for
 * the identical "is this ENOENT or something else" question. */
function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

/**
 * Whether `dir` contains a real `overlay.yaml` or `module.yaml` at its root, and which kind. Returns
 * `undefined` for "not present" (`ENOENT`) — an expected outcome for at least one of the two
 * channel-level callers below, which turn it into a real, actionable `ForgeError` themselves once
 * they also know which source (a local path, or a git spec) to name in the message.
 *
 * A `stat` failure that is *not* "this filename does not exist" (a permission error, most notably) is
 * a genuinely different problem than "no manifest here" and is not conflated with it — a critic round
 * found the first version of this function swallowed every `stat` failure identically, so a real
 * `overlay.yaml` a caller merely lacked permission to read would be reported as "no overlay.yaml or
 * module.yaml found," a diagnosis pointing the reader at exactly the wrong fix.
 *
 * @throws {ForgeError} `CFG-028` for a `stat` failure other than the file not existing.
 */
export async function findManifestKind(dir: string): Promise<OverlayManifestKind | undefined> {
  for (const [kind, filename] of MANIFEST_FILENAMES) {
    const manifestPath = path.join(dir, filename);
    try {
      const stats = await stat(manifestPath);
      if (stats.isFile()) return kind;
    } catch (cause) {
      if (errorCode(cause) === 'ENOENT') continue;
      throw new ForgeError('CFG-028', { path: manifestPath }, { cause });
    }
  }
  return undefined;
}
