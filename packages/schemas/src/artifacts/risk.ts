/**
 * `riskSchema` — one `RISK-###` entry in `kb/risks.md` ("register with likelihood/impact/mitigation/
 * owner", `08` §8.2), a `collection: true` type per `18` §18.7.
 *
 * `statement` is not one of the four fields `08` §8.2 names, but every register needs some text
 * saying what the risk actually is; reuses the field name NFR and Capability already use for the
 * same purpose elsewhere in this registry rather than inventing a new one. See `SPEC-QUESTIONS.md`
 * Q23.
 *
 * `sources` is OPTIONAL here (`PLAN-M14.md` P11): `08` §8.6's own "every write records sources" is a
 * `KbWriter`/output-CHECK invariant, not a schema constraint; `@forge/engine`'s output check requires
 * it on every new or changed produced entry instead (`dispatch/outputs.ts`).
 *
 * @see specs/08 §8.2
 * @see specs/08 §8.6
 * @see SPEC-QUESTIONS.md Q23
 * @see PLAN-M14.md P11
 */
import { z } from 'zod';

import { entryIdSchema } from './entry-id.ts';
import { artifactSourceSchema } from './source.ts';

export const riskSchema = z
  .object({
    id: entryIdSchema('Risk'),
    statement: z.string().min(1),
    likelihood: z.string().min(1),
    impact: z.string().min(1),
    mitigation: z.string().min(1),
    owner: z.string().min(1),
    sources: z.array(artifactSourceSchema).optional(),
  })
  .strict();

export type Risk = z.infer<typeof riskSchema>;
