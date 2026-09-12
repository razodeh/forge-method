/**
 * `fetchGitOverlayBundle` — the orchestration half of the git channel (`19` §19.5): calls
 * `@forge/vcs`'s own real `fetchGitOverlay` (the raw clone/checkout/checksum primitive, deliberately
 * kept manifest-agnostic — see that module's own doc comment) and applies the identical
 * "does this actually contain an installable manifest" business rule `fetch-local.ts` applies to the
 * local channel, so both channels refuse the identical way for the identical reason.
 *
 * `PLAN-M11.md` P1's own recorded Surface deviation: this is the reason the raw git fetch lives in
 * `@forge/vcs` rather than here — `@forge/extensions` gained a new, deliberate `extensions -> vcs`
 * graph edge for exactly this call, rather than `@forge/vcs` growing a manifest-shape opinion of its
 * own (a package the whole rest of this codebase already treats as manifest-agnostic git plumbing).
 *
 * @see specs/19 §19.5
 * @see PLAN-M11.md P1
 */
import { rm } from 'node:fs/promises';

import { ForgeError } from '@forge/core';
import {
  fetchGitOverlay,
  type FetchGitOverlayOptions,
  type GitOverlayFetchResult,
} from '@forge/vcs';

import { findManifestKind, type OverlayManifestKind } from './manifest.ts';
import { vcsFailureDetails } from './vcs-error.ts';

export interface GitOverlayBundleResult extends GitOverlayFetchResult {
  readonly manifestKind: OverlayManifestKind;
}

/**
 * Fetches `spec` via `@forge/vcs`'s `fetchGitOverlay`, then validates the checked-out content has a
 * real `overlay.yaml`/`module.yaml` at its root.
 *
 * A bundle with no manifest is refused with the checkout removed immediately, not left behind as an
 * orphaned directory under the caller's own `workDir` — the identical leak `PLAN-M10.md` P17's own
 * `createSandboxClone` gauntlet round already found and fixed for the adjacent "clone succeeded, the
 * next step failed" shape (`GAUNTLET-LOG.md`'s own M10 P17 entry).
 *
 * A `VcsError` thrown by `fetchGitOverlay` itself (an unreachable URL, a spec that fails to parse, a
 * ref that does not exist) is wrapped into a real `ForgeError` (`VCS-008`) here, at this module's own
 * one orchestration function every git-channel caller goes through — `@forge/vcs` has no `core` edge
 * and so cannot throw `ForgeError` itself (`git.ts`'s own doc comment); this function's own thrown
 * type is uniformly `ForgeError`, matching `fetchLocalOverlay`'s own local-channel contract exactly,
 * rather than leaking `VcsError` as a second, differently-shaped failure type from one of two
 * otherwise-symmetric channel functions.
 *
 * @throws {ForgeError} `VCS-008` if the underlying fetch itself fails (a malformed spec, an
 * unreachable URL, or a ref that does not exist).
 * @throws {ForgeError} `CFG-027` if the checked-out content has no `overlay.yaml`/`module.yaml`.
 */
export async function fetchGitOverlayBundle(
  spec: string,
  options: FetchGitOverlayOptions,
): Promise<GitOverlayBundleResult> {
  let result: GitOverlayFetchResult;
  try {
    result = await fetchGitOverlay(spec, options);
  } catch (cause) {
    throw new ForgeError('VCS-008', { spec, ...vcsFailureDetails(cause) }, { cause });
  }

  // `findManifestKind` can itself throw (`CFG-028`, a permission error) as well as return
  // `undefined` — either way the checkout is removed before the error propagates, not left behind
  // as an orphaned directory under `workDir`; a critic round found the first version of this
  // function only cleaned up the "returned undefined" case, leaking on the "threw" case exactly the
  // same way `fetchGitOverlay`'s own gauntlet round already found and fixed one layer down.
  let manifestKind: OverlayManifestKind | undefined;
  try {
    manifestKind = await findManifestKind(result.path);
  } catch (cause) {
    await rm(result.path, { recursive: true, force: true });
    throw cause;
  }
  if (manifestKind === undefined) {
    await rm(result.path, { recursive: true, force: true });
    throw new ForgeError('CFG-027', { source: spec });
  }

  return { ...result, manifestKind };
}
