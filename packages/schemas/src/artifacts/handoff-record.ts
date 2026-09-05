/**
 * `handoffRecordSchema` — one `HO-###` entry in `reports/handoffs.md`, a `collection: true` type per
 * `18` §18.7, per `05` §5.6's worked example.
 *
 * @see specs/05 §5.6
 */
import { z } from 'zod';

import { assumptionSchema } from './assumption.ts';
import { entryIdSchema } from './entry-id.ts';

export const handoffRecordSchema = z
  .object({
    id: entryIdSchema('HandoffRecord'),
    from: z.string().min(1),
    to: z.string().min(1),
    step: z.string().min(1),
    timestamp: z.string().datetime(),
    delivered: z.array(z.string().min(1)),
    open_questions: z.array(z.string().min(1)),
    // Reuses assumptionSchema for its entries rather than a second transcription of the same shape —
    // 05 §5.6's own worked example is field-for-field identical to 08 §8.2's Assumption entry.
    assumptions: z.array(assumptionSchema),
    constraints_for_receiver: z.array(z.string().min(1)),
    acceptance_for_receiver: z.array(z.string().min(1)),
  })
  .strict();

export type HandoffRecord = z.infer<typeof handoffRecordSchema>;
