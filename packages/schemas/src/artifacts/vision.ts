/**
 * `visionSchema` — `specs/09` §9.3's Vision (`VIS-001`).
 *
 * @see specs/09 §9.3
 */
import { z } from 'zod';

import { baseFrontMatterShape, checkIdMatchesRegisteredType } from '../registry/front-matter.ts';

const successMetricSchema = z
  .object({
    id: z.string().min(1),
    statement: z.string().min(1),
    baseline: z.string().min(1),
    target: z.string().min(1),
    instrumentation: z.string().min(1),
  })
  .strict();

export const visionSchema = baseFrontMatterShape
  .extend({
    type: z.literal('Vision'),
    product: z.string().min(1),
    one_liner: z.string().min(1),
    problem: z.string().min(1),
    target_users: z.array(z.string().min(1)),
    value_hypothesis: z.string().min(1),
    success_metrics: z.array(successMetricSchema),
    non_goals: z.array(z.string().min(1)),
    horizon: z.string().min(1),
  })
  .strict()
  .superRefine(checkIdMatchesRegisteredType);

export type Vision = z.infer<typeof visionSchema>;
