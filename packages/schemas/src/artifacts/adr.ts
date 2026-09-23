/**
 * `adrSchema` — `08` §8.4's ADR (`ADR-####`, 4-digit per `18` §18.7).
 *
 * `sources` is OPTIONAL here (`PLAN-M14.md` P11): `08` §8.6's own "every write records sources" is a
 * `KbWriter`/output-CHECK invariant, not a schema constraint (a hand-written or pre-P11 ADR without one
 * stays valid to `forge spec validate`/`forge kb lint`); `@forge/engine`'s output check requires it on
 * every produced ADR instead (`dispatch/outputs.ts`).
 *
 * @see specs/08 §8.4
 * @see specs/08 §8.6
 * @see PLAN-M14.md P11
 */
import { z } from 'zod';

import { baseFrontMatterShape, checkIdMatchesRegisteredType } from '../registry/front-matter.ts';
import { artifactSourceSchema } from './source.ts';

const ADR_STATUSES = ['proposed', 'accepted', 'rejected', 'superseded', 'deprecated'] as const;

export const adrSchema = baseFrontMatterShape
  .extend({
    type: z.literal('ADR'),
    status: z.enum(ADR_STATUSES),
    category: z.enum(['product', 'architecture', 'data', 'delivery', 'ops', 'security', 'process']),
    deciders: z.array(z.string().min(1)),
    date: z.string().date(),
    reversibility: z.enum(['trivial', 'easy', 'medium', 'hard', 'one-way']),
    blast_radius: z.array(z.string().min(1)),
    revisit_trigger: z.string().min(1),
    supersedes: z.array(z.string().min(1)),
    superseded_by: z.string().min(1).nullable(),
    related: z.array(z.string().min(1)),
    diagrams: z.array(z.string().min(1)),
    framework: z.string().min(1),
    sources: z.array(artifactSourceSchema).optional(),
  })
  .strict()
  .superRefine(checkIdMatchesRegisteredType)
  .superRefine((data, ctx) => {
    // "supersedes and superseded_by are mutually consistent" (PLAN-M1.md P7's Check): an ADR whose
    // status says it has been superseded must name what superseded it, and vice versa — the two
    // fields describe the same fact from two directions and must not disagree.
    if (data.status === 'superseded' && data.superseded_by === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['superseded_by'],
        message: 'an ADR with status "superseded" must name the ADR that superseded it.',
      });
    }
    if (data.status !== 'superseded' && data.superseded_by !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['status'],
        message: 'an ADR with superseded_by set must have status "superseded".',
      });
    }
  });

export type ADR = z.infer<typeof adrSchema>;
