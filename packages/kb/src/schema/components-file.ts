/**
 * `componentSchema`/`componentsFileSchema` — `architecture/components.md`'s own on-disk shape: "the
 * component inventory: responsibility, owner, deps, failure modes" (`08` §8.2), a `collection: true`
 * register the same way `risks.md`/`assumptions.md`/`open-questions.md`/`delivery/environments.md`
 * already are (`SPEC-QUESTIONS.md` Q50) — except `Component` is not one of `18` §18.7's 21 registered
 * types, so this lives here in `@forge/kb/schema` rather than `@forge/schemas/artifacts`, the same
 * place `KbEntry` itself already lives for the identical reason.
 *
 * `id`/`label`/`dependsOn` match `@forge/diagrams`' own `ComponentsToC4Input.components` field names
 * exactly where they overlap (`PLAN-M3.md` P3) — the one other real, load-bearing consumer of "a
 * component" already settled those three names; `responsibility`/`owner`/`failureModes` add the rest
 * of `08` §8.2's own directory-table description. `id` is `component:<slug>`, the same tag format
 * `applies_to`/`depicts` already use everywhere else in this codebase for the identical concept — not
 * a new `CMP-###` numbering scheme, so a component id is directly usable everywhere that space is
 * already referenced.
 *
 * @see specs/08 §8.2
 * @see SPEC-QUESTIONS.md Q50
 * @see SPEC-QUESTIONS.md Q56
 * @see PLAN-M3.md P10
 */
import { z } from 'zod';

import { baseFrontMatterShape } from '@forge/schemas';

const COMPONENT_ID_PATTERN = /^component:[a-z][a-z0-9-]*$/;

export const componentSchema = z
  .object({
    id: z.string().regex(COMPONENT_ID_PATTERN),
    label: z.string().min(1),
    responsibility: z.string().min(1),
    owner: z.string().min(1),
    dependsOn: z.array(z.string().regex(COMPONENT_ID_PATTERN)),
    failureModes: z.array(z.string().min(1)),
  })
  .strict();

export type Component = z.infer<typeof componentSchema>;

// `id` omitted for the same reason `SPEC-QUESTIONS.md` Q50 already gives every other collection-file
// wrapper: a collection file names many ids (one per component), not one, so the single-id
// `checkIdMatchesRegisteredType` cross-check baseFrontMatterShape's own `id` field exists for does not
// apply here either.
export const componentsFileSchema = baseFrontMatterShape
  .omit({ id: true })
  .extend({
    type: z.literal('Component'),
    components: z.array(componentSchema),
  })
  .strict();

export type ComponentsFile = z.infer<typeof componentsFileSchema>;
