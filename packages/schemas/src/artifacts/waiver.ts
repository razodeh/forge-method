/**
 * `waiverSchema` — one `WAIVER-###` entry in `reports/waivers.md`, a `collection: true` type per
 * `18` §18.7.
 *
 * `PLAN-M1.md` P7's own Check: "Waiver requires a reason, an owner and an expiry" — matching
 * `20` §20 ("Every gate decision, approval, rejection and waiver (with reason, owner, expiry)") and
 * `21` §21.3's E4 ("waiver requires reason + expiry").
 *
 * @see specs/20-security-safety-and-cost.md §20
 * @see specs/21 §21.3 E4
 */
import { z } from 'zod';

import { entryIdSchema } from './entry-id.ts';

export const waiverSchema = z
  .object({
    id: entryIdSchema('Waiver'),
    reason: z.string().min(1),
    owner: z.string().min(1),
    expiry: z.string().date(),
  })
  .strict();

export type Waiver = z.infer<typeof waiverSchema>;
