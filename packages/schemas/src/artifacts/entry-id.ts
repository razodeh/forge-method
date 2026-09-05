/**
 * `entryIdSchema` — the `id` shape for one entry inside a `collection: true` artifact file.
 *
 * A collection entry (a Risk, an Assumption, ...) is not a whole front-matter document — `18` §18.6's
 * base shape and `checkIdMatchesRegisteredType` (built for a document carrying its own `type` field)
 * do not apply to it. But its `id` still has to match the registry's `idPrefix`/`idWidth` for its
 * type, exactly as a document's would; this derives that regex from the same `ARTIFACT_TYPES` data
 * `checkIdMatchesRegisteredType` uses, at module-load time, since a collection entry schema always
 * knows which type it is for (unlike the base check, which has to work for any of the 21 at once).
 */
import { z } from 'zod';

import { definitionForType, type ArtifactTypeId } from '../registry/artifact-types.ts';

export function entryIdSchema(type: ArtifactTypeId): z.ZodString {
  const definition = definitionForType(type);
  return z
    .string()
    .regex(new RegExp(`^${definition.idPrefix}-\\d{${String(definition.idWidth)}}(-\\d+)?$`));
}
