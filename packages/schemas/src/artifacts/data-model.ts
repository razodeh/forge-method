/**
 * `dataModelSchema` — `specs/09` §9.6's Data Model element (`DM-###`).
 *
 * `09` §9.6 describes this type only by purpose and producer ("entity, table, index, or migration
 * with its invariants"), with no field list or example. This schema is the base front matter
 * narrowed to `type: 'DataModel'`, with no invented business fields. See `SPEC-QUESTIONS.md` Q20.
 *
 * @see specs/09 §9.6
 * @see SPEC-QUESTIONS.md Q20
 */
import { z } from 'zod';

import { baseFrontMatterShape, checkIdMatchesRegisteredType } from '../registry/front-matter.ts';

export const dataModelSchema = baseFrontMatterShape
  .extend({ type: z.literal('DataModel') })
  .strict()
  .superRefine(checkIdMatchesRegisteredType);

export type DataModel = z.infer<typeof dataModelSchema>;
