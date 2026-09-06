/**
 * `@forge/core/ids` — id allocation, per `18` §18.8.
 *
 * @see specs/18 §18.8
 * @see PLAN-M1.md P13
 */
export { IdAllocator, type ArtifactId, type IdAllocatorDeps } from './allocator.ts';
export {
  computeValidityHash,
  readIdCache,
  writeIdCache,
  type IdCacheReadResult,
  type IdIndex,
} from './cache.ts';
export { DEFAULT_ID_REGISTRY, type IdRegistry, type IdRegistryEntry } from './registry.ts';
export { countIdsFromFiles, listArtifactFiles, scanProject, type ScanResult } from './scan.ts';
