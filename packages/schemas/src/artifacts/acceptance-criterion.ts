/**
 * `acceptanceCriterionSchema` — one Given/When/Then acceptance criterion, `specs/09` §9.5.
 *
 * @see specs/09 §9.3
 * @see specs/09 §9.5
 */
import { z } from 'zod';

export const acceptanceCriterionSchema = z
  .object({
    // specs/09 §9.5's own binding-rule examples ("AC-014-2") and PLAN-M1.md P6's Check.
    id: z.string().regex(/^AC-\d{3,4}-\d+$/),
    given: z.string().min(1),
    when: z.string().min(1),
    // "every AC is Given/When/Then with a kind" (PLAN-M1.md P6): a kind is required, but the spec's
    // three examples (functional, error-handling, nfr) are not stated as an exhaustive enum the way
    // NFR's `category` or `verification.kind` are — left open rather than inventing a closed set.
    then: z.string().min(1),
    kind: z.string().min(1),
    nfr: z.string().min(1).optional(),
  })
  .strict();

export type AcceptanceCriterion = z.infer<typeof acceptanceCriterionSchema>;
