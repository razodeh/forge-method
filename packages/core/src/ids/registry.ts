/**
 * `IdRegistry` — the `idPrefix`/`idWidth` per type that `scanProject` and `IdAllocator` both need.
 *
 * A `Record`, not a lookup function, so a test can override one type's `idWidth` (to exercise the
 * `CFG-010` overflow path without needing thousands of fixture files) by spreading
 * `DEFAULT_ID_REGISTRY` and replacing one entry, the same pattern `@forge/core/artifacts`'s
 * `ArtifactSchemaRegistry` already established.
 *
 * @see specs/18 §18.8
 * @see PLAN-M1.md P13
 */
import { ARTIFACT_TYPES, type ArtifactTypeId } from '@forge/schemas';

export interface IdRegistryEntry {
  readonly idPrefix: string;
  readonly idWidth: number;
}

export type IdRegistry = Readonly<Record<ArtifactTypeId, IdRegistryEntry>>;

/** The real registry, transcribed from `@forge/schemas`'s own `ARTIFACT_TYPES`. */
export const DEFAULT_ID_REGISTRY: IdRegistry = Object.fromEntries(
  ARTIFACT_TYPES.map((type) => [type.id, { idPrefix: type.idPrefix, idWidth: type.idWidth }]),
) as IdRegistry;
