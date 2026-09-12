/**
 * `@forge/extensions/install` — the overlay/module bundle fetch orchestration layer (`19` §19.5,
 * `PLAN-M11.md` P1/P2): the local path, git, and npm channels, all refusing the identical way when
 * the fetched content is not a real, installable overlay/module.
 *
 * @see specs/19 §19.5
 * @see PLAN-M11.md P1
 * @see PLAN-M11.md P2
 */
export { fetchGitOverlayBundle, type GitOverlayBundleResult } from './fetch-git.ts';
export { fetchLocalOverlay, type LocalOverlayFetchResult } from './fetch-local.ts';
export {
  fetchNpmOverlay,
  parseNpmOverlaySpec,
  parseNpmPackJson,
  verifyTarballIntegrity,
  type FetchNpmOverlayOptions,
  type NpmOverlaySpec,
  type NpmOverlayFetchResult,
  type NpmPackJsonEntry,
} from './fetch-npm.ts';
export { findManifestKind, type OverlayManifestKind } from './manifest.ts';
export {
  extractNpmTarball,
  DEFAULT_MAX_DECOMPRESSED_BYTES,
  DEFAULT_MAX_ENTRIES,
  type ExtractTarballOptions,
} from './tar-extract.ts';
