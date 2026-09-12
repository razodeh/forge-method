/**
 * `@forge/extensions/install` — the overlay/module bundle fetch orchestration layer (`19` §19.5,
 * `PLAN-M11.md` P1/P2): the local path, git, and npm channels, all refusing the identical way when
 * the fetched content is not a real, installable overlay/module; plus `PLAN-M11.md` P4's own static
 * safety scan, the pre-install gate that runs on whatever a channel above fetched, strictly before
 * anything is written to `.forge/`.
 *
 * @see specs/19 §19.5
 * @see PLAN-M11.md P1
 * @see PLAN-M11.md P2
 * @see PLAN-M11.md P4
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
  findBundleSafetyFindings,
  scanBundleForSafety,
  type SafetyScanFinding,
  type SafetyScanFindingCode,
} from './safety-scan.ts';
export {
  extractNpmTarball,
  DEFAULT_MAX_DECOMPRESSED_BYTES,
  DEFAULT_MAX_ENTRIES,
  type ExtractTarballOptions,
} from './tar-extract.ts';
