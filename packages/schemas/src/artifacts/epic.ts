/**
 * `epicSchema` — `specs/09` §9.3's Epic (`EPIC-###`).
 *
 * @see specs/09 §9.3
 */
import { z } from 'zod';

import { baseFrontMatterShape, checkIdMatchesRegisteredType } from '../registry/front-matter.ts';

export const epicSchema = baseFrontMatterShape
  .extend({
    type: z.literal('Epic'),
    capability: z.string().min(1),
    stage: z.string().min(1),
    goal: z.string().min(1),
    scope_in: z.array(z.string().min(1)),
    scope_out: z.array(z.string().min(1)),
    stories: z.array(z.string().min(1)),
    interfaces: z.array(z.string().min(1)),
    data: z.array(z.string().min(1)),
    exit_criteria: z.array(z.string().min(1)),
  })
  .strict()
  .superRefine(checkIdMatchesRegisteredType);

export type Epic = z.infer<typeof epicSchema>;
