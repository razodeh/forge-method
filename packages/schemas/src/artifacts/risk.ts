/**
 * `riskSchema` — one `RISK-###` entry in `kb/risks.md` ("register with likelihood/impact/mitigation/
 * owner", `08` §8.2), a `collection: true` type per `18` §18.7.
 *
 * `statement` is not one of the four fields `08` §8.2 names, but every register needs some text
 * saying what the risk actually is; reuses the field name NFR and Capability already use for the
 * same purpose elsewhere in this registry rather than inventing a new one. See `SPEC-QUESTIONS.md`
 * Q23.
 *
 * @see specs/08 §8.2
 * @see SPEC-QUESTIONS.md Q23
 */
import { z } from 'zod';

import { entryIdSchema } from './entry-id.ts';

export const riskSchema = z
  .object({
    id: entryIdSchema('Risk'),
    statement: z.string().min(1),
    likelihood: z.string().min(1),
    impact: z.string().min(1),
    mitigation: z.string().min(1),
    owner: z.string().min(1),
  })
  .strict();

export type Risk = z.infer<typeof riskSchema>;
