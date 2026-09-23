/**
 * `runbookSchema` — `14` §14's Runbook, one per identified Sev1 failure mode.
 *
 * `14` §14: "a `RUN-###` artifact: symptoms, immediate mitigation, diagnosis steps (with the exact
 * commands), escalation, and post-incident actions."
 *
 * `sources` is OPTIONAL here (`PLAN-M14.md` P11): `08` §8.6's own "every write records sources" is a
 * `KbWriter`/output-CHECK invariant, not a schema constraint; `@forge/engine`'s output check requires
 * it on every produced Runbook instead (`dispatch/outputs.ts`).
 *
 * @see specs/14-frameworks-delivery-and-operations.md §14
 * @see specs/08 §8.6
 * @see PLAN-M14.md P11
 */
import { z } from 'zod';

import { baseFrontMatterShape, checkIdMatchesRegisteredType } from '../registry/front-matter.ts';
import { artifactSourceSchema } from './source.ts';

export const runbookSchema = baseFrontMatterShape
  .extend({
    type: z.literal('Runbook'),
    symptoms: z.string().min(1),
    immediate_mitigation: z.string().min(1),
    // "with the exact commands" — an ordered list, not one paragraph, so each step is executable.
    diagnosis_steps: z.array(z.string().min(1)),
    escalation: z.string().min(1),
    post_incident_actions: z.array(z.string().min(1)),
    sources: z.array(artifactSourceSchema).optional(),
  })
  .strict()
  .superRefine(checkIdMatchesRegisteredType);

export type Runbook = z.infer<typeof runbookSchema>;
