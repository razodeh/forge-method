/**
 * `fetchLocalOverlay` — the local-path overlay/module channel (`19` §19.5's own "Development and
 * monorepo-internal sharing" row): reads and validates a local directory is a real, installable
 * overlay/module. No network, and no integrity check *against an expected value* is meaningful here
 * (the user already has direct filesystem access to what they are installing) — but a checksum is
 * still computed and returned, matching the git channel's own shape exactly, so `manifest.yaml` (`19`
 * §19.5 step 5) can record one uniformly regardless of which channel a given entry came from.
 *
 * This also closes the real, local-path half of `PLAN-M10.md` P7's own original scope (`PLAN-M11.md`'s
 * own recorded "P1-P6 complete M10 P7/P8" resolution): a local-path lifecycle needs a real "resolve
 * this path into installable content" step even before any consent/install logic runs.
 *
 * @see specs/19 §19.5
 * @see PLAN-M11.md P1
 */
import { stat } from 'node:fs/promises';
import path from 'node:path';

import { ForgeError } from '@forge/core';
import { computeContentChecksum } from '@forge/vcs';

import { findManifestKind, type OverlayManifestKind } from './manifest.ts';
import { vcsFailureDetails } from './vcs-error.ts';

export interface LocalOverlayFetchResult {
  /** The resolved, absolute source path — identical to the input for an already-installable local
   * directory (no copy is made; the local channel installs directly from where the user pointed). */
  readonly path: string;
  readonly manifestKind: OverlayManifestKind;
  readonly checksum: string;
}

/**
 * Validates `sourcePath` is a real, existing directory containing a real `overlay.yaml` or
 * `module.yaml`, and computes its content checksum.
 *
 * @throws {ForgeError} `CFG-026` if `sourcePath` does not exist or is not a directory.
 * @throws {ForgeError} `CFG-027` if `sourcePath` exists but has no `overlay.yaml`/`module.yaml`.
 * @throws {ForgeError} `CFG-028` if a manifest file's own presence could not be checked (a
 * permission error).
 * @throws {ForgeError} `VCS-009` if computing the content checksum fails (a permission error, a
 * rejected symlink, a TOCTOU race).
 */
export async function fetchLocalOverlay(sourcePath: string): Promise<LocalOverlayFetchResult> {
  const absolutePath = path.resolve(sourcePath);

  let stats;
  try {
    stats = await stat(absolutePath);
  } catch (cause) {
    throw new ForgeError('CFG-026', { path: sourcePath }, { cause });
  }
  if (!stats.isDirectory()) {
    throw new ForgeError('CFG-026', { path: sourcePath });
  }

  const manifestKind = await findManifestKind(absolutePath);
  if (manifestKind === undefined) {
    throw new ForgeError('CFG-027', { source: sourcePath });
  }

  let checksum: string;
  try {
    checksum = await computeContentChecksum(absolutePath);
  } catch (cause) {
    // `computeContentChecksum` (`@forge/vcs`) throws only `VcsError` (that package has no `core`
    // edge) — wrapped here, at this function's own boundary, so `fetchLocalOverlay`'s thrown type is
    // uniformly `ForgeError`, the same discipline `fetchGitOverlayBundle`'s own `VCS-008` wrap
    // already applies for the git channel.
    throw new ForgeError('VCS-009', { path: sourcePath, ...vcsFailureDetails(cause) }, { cause });
  }
  return { path: absolutePath, manifestKind, checksum };
}
