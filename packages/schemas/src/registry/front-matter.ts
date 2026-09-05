/**
 * `baseFrontMatterSchema` — the front matter every artifact file carries, per `specs/18` §18.6.
 *
 * @see specs/18 §18.6
 * @see specs/09 §9.2
 */
import { z } from 'zod';

import { ARTIFACT_TYPES, definitionForType, type ArtifactTypeId } from './artifact-types.ts';

// Cast is sound because ARTIFACT_TYPES has at least one row and every `type.id` in it is, by
// construction, a member of ArtifactTypeId — this only reshapes a non-empty string[] into the tuple
// shape z.enum requires, it does not widen or narrow which values are actually possible.
const ARTIFACT_TYPE_IDS = ARTIFACT_TYPES.map((type) => type.id) as [
  ArtifactTypeId,
  ...ArtifactTypeId[],
];

const changelogEntrySchema = z
  .object({
    revision: z.number().int().positive(),
    date: z.string().date(),
    by: z.string().min(1),
    summary: z.string().min(1),
  })
  .strict();

export const baseFrontMatterSchema = z
  .object({
    id: z.string().regex(/^[A-Z]+-\d{3,4}(-\d+)?$/),
    type: z.enum(ARTIFACT_TYPE_IDS),
    schemaVersion: z.number().int().positive(),
    title: z.string().min(1),
    // "required, per-type enum" (18 §18.6): the concrete status values differ per artifact type
    // (a Story's draft|ready|... is not an ADR's proposed|accepted|...), so the base schema can only
    // constrain the shape common to every type; a per-type schema narrows this to its own enum.
    status: z.string().min(1),
    created: z.string().date(),
    updated: z.string().date(),
    revision: z.number().int().positive(),
    author: z.string().min(1),
    run: z.string().min(1).optional(),
    changelog: z.array(changelogEntrySchema),
  })
  .strict()
  .superRefine((data, ctx) => {
    // Ties `id` to the registry's declared `idPrefix` and `idWidth` for `type` — this is the "from
    // which ... ID widths ... are derived" half of P5's mandate, not a check the base regex above
    // (which only knows a *shape*, not which type it belongs to) can express on its own. `data.type`
    // is `ArtifactTypeId` here (zod's `z.enum` output, not a general `string`), so `definitionForType`
    // returns a definite value — see its doc comment for why no `undefined` branch is needed.
    const definition = definitionForType(data.type);

    const idPattern = new RegExp(
      `^${definition.idPrefix}-\\d{${String(definition.idWidth)}}(-\\d+)?$`,
    );
    if (!idPattern.test(data.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['id'],
        message: `id must match ${definition.idPrefix}-<${String(definition.idWidth)} digits> for type "${data.type}".`,
      });
    }
  });

export type BaseFrontMatter = z.infer<typeof baseFrontMatterSchema>;
