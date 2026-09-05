/**
 * `nfrSchema` — `specs/09` §9.3's NFR (`NFR-###`), "must be numeric and verifiable".
 *
 * @see specs/09 §9.3
 */
import { z } from 'zod';

import { baseFrontMatterShape, checkIdMatchesRegisteredType } from '../registry/front-matter.ts';

const verificationSchema = z
  .object({
    kind: z.enum(['test', 'benchmark', 'monitor', 'review', 'audit']),
    ref: z.string().min(1),
    command: z.string().min(1).optional(),
  })
  .strict();

export const nfrSchema = baseFrontMatterShape
  .extend({
    type: z.literal('NFR'),
    category: z.enum([
      'performance',
      'availability',
      'scalability',
      'security',
      'privacy',
      'maintainability',
      'operability',
      'cost',
      'accessibility',
      'compliance',
    ]),
    statement: z.string().min(1),
    metric: z.string().min(1),
    // "A non-numeric NFR ('should be fast') is a validation error" (specs/09 §9.3). Requires the
    // value to *start* with an optional comparison operator followed by a number — every one of the
    // spec's own examples ("< 300ms", "< 10 minutes") is exactly this shape. A "contains a digit
    // anywhere" check was tried and rejected: it let ordinary prose like "reduce onboarding to 1
    // click before launch" or "ship version 2 of the dashboard" through as "numeric and verifiable"
    // merely because a number appeared in the sentence, which is exactly the unverifiable-target
    // defect this check exists to catch.
    target: z
      .string()
      .regex(
        /^(?:[<>]=?|=)?\s*\d+(?:\.\d+)?/,
        'target must start with a number (optionally preceded by a comparison operator), not a qualitative phrase',
      ),
    conditions: z.string().min(1).optional(),
    verification: verificationSchema,
    applies_to: z.array(z.string().min(1)),
  })
  .strict()
  .superRefine(checkIdMatchesRegisteredType);

export type NFR = z.infer<typeof nfrSchema>;
