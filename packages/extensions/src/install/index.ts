/**
 * `@forge/extensions/install` — the overlay/module bundle fetch orchestration layer (`19` §19.5,
 * `PLAN-M11.md` P1/P2): the local path, git, and npm channels, all refusing the identical way when
 * the fetched content is not a real, installable overlay/module; `PLAN-M11.md` P3's own capability
 * consent screen; plus `PLAN-M11.md` P4's own static safety scan, the pre-install gate that runs on
 * whatever a channel above fetched, strictly before anything is written to `.forge/`.
 *
 * `describeRequestedCapabilities`/`promptForConsent` were not re-exported here by P3 itself (confirmed
 * by direct inspection before this piece added the two-line fix above) — `PLAN-M11.md` P5's own real
 * `forge module add`/`forge overlay add` is this package's first real caller of either, and needs them
 * reachable through this package's own public `./install` subpath export (`package.json`'s `exports`
 * map declares no deeper subpath a caller could import from instead, and this codebase's own
 * `boundaries` check would refuse a deep, non-exported import regardless).
 *
 * @see specs/19 §19.5
 * @see PLAN-M11.md P1
 * @see PLAN-M11.md P2
 * @see PLAN-M11.md P3
 * @see PLAN-M11.md P4
 * @see PLAN-M11.md P5
 */
export {
  describeRequestedCapabilities,
  promptForConsent,
  type CapabilityDescription,
  type CapabilityDescriptionEntry,
  type CapabilityKind,
  type CapabilityManifestInput,
  type ConsentPromptOptions,
  type OverlayCapabilityManifest,
} from './consent.ts';
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
