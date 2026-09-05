/**
 * `capabilitySchema` — `specs/09` §9.3's Capability (`CAP-###`).
 *
 * @see specs/09 §9.3
 */
import { z } from 'zod';

import { baseFrontMatterShape, checkIdMatchesRegisteredType } from '../registry/front-matter.ts';

export const capabilitySchema = baseFrontMatterShape
  .extend({
    type: z.literal('Capability'),
    statement: z.string().min(1),
    // PLAN-M1.md P6 Check: "priority is the MoSCoW literal union; stage required."
    priority: z.enum(['must', 'should', 'could', 'wont']),
    stage: z.string().min(1),
    depends_on: z.array(z.string().min(1)),
    nfrs: z.array(z.string().min(1)),
    metrics: z.array(z.string().min(1)),
    acceptance_summary: z.string().min(1),
    epics: z.array(z.string().min(1)),
  })
  .strict()
  .superRefine(checkIdMatchesRegisteredType);

export type Capability = z.infer<typeof capabilitySchema>;
