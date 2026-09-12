/**
 * `@forge/extensions/install` — the overlay/module bundle fetch orchestration layer (`19` §19.5,
 * `PLAN-M11.md` P1): the local path and git channels, both refusing the identical way when the
 * fetched content is not a real, installable overlay/module.
 *
 * @see specs/19 §19.5
 * @see PLAN-M11.md P1
 */
export { fetchGitOverlayBundle, type GitOverlayBundleResult } from './fetch-git.ts';
export { fetchLocalOverlay, type LocalOverlayFetchResult } from './fetch-local.ts';
export { findManifestKind, type OverlayManifestKind } from './manifest.ts';
