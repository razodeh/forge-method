/**
 * `templateOverlaySchema`, `requiredFieldsFor`, `checkTemplateRequiredFields` — `15` §15.7's
 * "Template overlays" subsection.
 *
 * @see specs/15 §15.7
 * @see PLAN-M2.md P6
 * @see SPEC-QUESTIONS.md Q37
 */
import { ARTIFACT_SCHEMAS, type ArtifactTypeId } from '@forge/schemas';
import { z } from 'zod';

import type { TemplateFieldFinding } from './types.ts';

/**
 * A template overlay is a whole replacement front-matter document (`packages/templates/src/artifacts/
 * *.md`'s own shape — front-matter keys are literally the artifact type's schema field names, holding
 * placeholder values), not one of `15` §15.2's incrementally-merged operator documents. This schema
 * validates only that a parsed overlay is a plain field/value bag; `checkTemplateRequiredFields` does
 * the actual per-type comparison (`SPEC-QUESTIONS.md` Q37 records why nothing more specific is given).
 */
export const templateOverlaySchema = z.record(z.string(), z.unknown());

/**
 * Every `ARTIFACT_SCHEMAS` entry is built as `baseFrontMatterShape.extend({...}).strict()`, optionally
 * wrapped in one or more `.superRefine()` calls — always a `ZodObject` underneath any `ZodEffects`
 * layers, by construction, so unwrapping needs no runtime guard for a shape that cannot occur here.
 */
function unwrapToObjectSchema(schema: z.ZodTypeAny): z.AnyZodObject {
  let current: z.ZodTypeAny = schema;
  while (current instanceof z.ZodEffects) {
    current = (current as z.ZodEffects<z.ZodTypeAny>).innerType();
  }
  return current as z.AnyZodObject;
}

/**
 * The required (non-`.optional()`) top-level field names of `artifactType`'s real, already-committed
 * `@forge/schemas` zod schema — read directly off it via the newly-exported `ARTIFACT_SCHEMAS` table,
 * not a second, hand-kept list that could drift from the schema it is supposed to describe.
 */
export function requiredFieldsFor(artifactType: ArtifactTypeId): readonly string[] {
  const objectSchema = unwrapToObjectSchema(ARTIFACT_SCHEMAS[artifactType].schema);
  const shape = objectSchema.shape as z.ZodRawShape;
  return Object.entries(shape)
    .filter(([, field]) => !field.isOptional())
    .map(([key]) => key);
}

/**
 * `15` §15.7: "Required schema fields stay required — a template that omits one fails compile with
 * the field name, rather than producing artifacts that fail validation later." `frontMatter` is the
 * overlay's own already-parsed front matter (via `@forge/core`'s `splitFrontMatter`/
 * `parseFrontMatterYaml`, the same primitives P4 reused for `SKILL.md`).
 */
export function checkTemplateRequiredFields(
  artifactType: ArtifactTypeId,
  frontMatter: Readonly<Record<string, unknown>>,
): readonly TemplateFieldFinding[] {
  const present = new Set(Object.keys(frontMatter));
  return requiredFieldsFor(artifactType)
    .filter((field) => !present.has(field))
    .map((field) => ({
      severity: 'error' as const,
      code: 'required-field-missing' as const,
      message: `Template overlay for "${artifactType}" omits required field "${field}".`,
    }));
}
