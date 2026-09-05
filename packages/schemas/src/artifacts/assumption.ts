/**
 * `assumptionSchema` — one `ASM-###` entry in `kb/assumptions.md` ("open assumptions with validation
 * triggers", `08` §8.2), a `collection: true` type per `18` §18.7.
 *
 * A collection entry, not a whole front-matter document — see `entry-id.ts`'s doc comment for why
 * this does not extend `baseFrontMatterShape`.
 *
 * @see specs/08 §8.2
 * @see specs/05 §5.6 (a worked example, embedded in HandoffRecord)
 */
import { z } from 'zod';

import { entryIdSchema } from './entry-id.ts';

export const assumptionSchema = z
  .object({
    id: entryIdSchema('Assumption'),
    text: z.string().min(1),
    confidence: z.enum(['low', 'medium', 'high']),
    validate_by: z.string().min(1),
  })
  .strict();

export type Assumption = z.infer<typeof assumptionSchema>;
