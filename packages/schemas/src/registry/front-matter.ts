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

/**
 * The front-matter fields, as a plain `ZodObject` — not yet refined, and deliberately not `.strict()`
 * either (a per-type schema built by `.extend()`-ing this needs to add its own `.strict()` *after*
 * extending, since `.strict()` here would freeze the shape before any type-specific fields join it).
 *
 * Exported (unlike `changelogEntrySchema`) specifically so `PLAN-M1.md` P6's per-type schemas can
 * `.extend()` it: `baseFrontMatterSchema` below cannot be extended directly once
 * `checkIdMatchesRegisteredType` is attached to it — `.superRefine()` returns a `ZodEffects`, which
 * has no `.extend()` method in zod 3. Every per-type schema still needs the same id/type cross-check,
 * so it re-applies `checkIdMatchesRegisteredType` itself after extending and re-`.strict()`-ing.
 */
export const baseFrontMatterShape = z.object({
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
});

/**
 * Ties `id` to the registry's declared `idPrefix` and `idWidth` for `type` — the "from which ...
 * ID widths ... are derived" half of P5's mandate, not a check the base regex above (which only
 * knows a *shape*, not which type it belongs to) can express on its own. Exported so every per-type
 * schema in `@forge/schemas/artifacts` reapplies the identical check, rather than each `.extend()`
 * silently losing it (an `id`/`type` mismatch is exactly as much a defect on a `Story` as on the
 * bare base front matter).
 *
 * Typed generically over any shape carrying at least `{ id, type }` — every per-type schema extends
 * `baseFrontMatterShape`, so `data` always has more fields than this needs, and a generic signature
 * lets a single implementation serve all of them instead of one refinement per schema.
 */
export function checkIdMatchesRegisteredType(
  data: { readonly id: string; readonly type: ArtifactTypeId },
  ctx: z.RefinementCtx,
): void {
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
}

export const baseFrontMatterSchema = baseFrontMatterShape
  .strict()
  .superRefine(checkIdMatchesRegisteredType);

export type BaseFrontMatter = z.infer<typeof baseFrontMatterSchema>;
