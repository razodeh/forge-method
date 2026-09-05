/**
 * `rcaSchema` — `13` §13's RCA, written at the debug loop's RECORD step.
 *
 * @see specs/13-frameworks-testing-and-debugging.md §13
 */
import { z } from 'zod';

import { baseFrontMatterShape, checkIdMatchesRegisteredType } from '../registry/front-matter.ts';
import { SEVERITIES } from './defect.ts';

const hypothesisSchema = z
  .object({
    claim: z.string().min(1),
    refuted_by: z.string().min(1).nullable(),
    // The worked example uses only these two — RCA is written after FALSIFY has completed, so every
    // hypothesis it records is already settled one way or the other.
    status: z.enum(['confirmed', 'refuted']),
  })
  .strict();

export const rcaSchema = baseFrontMatterShape
  .extend({
    type: z.literal('RCA'),
    defect: z.string().min(1),
    severity: z.enum(SEVERITIES),
    symptom: z.string().min(1),
    reproduction: z.string().min(1),
    // Each timeline entry in the worked example carries a single, differently-named key
    // (first_seen, detected_by, ...) rather than one fixed shape — modelled as an open record rather
    // than inventing a closed field list the example does not support.
    timeline: z.array(z.record(z.string(), z.string())),
    hypotheses: z.array(hypothesisSchema),
    root_cause: z.string().min(1),
    causal_chain: z.array(z.string().min(1)),
    fix: z.string().min(1),
    prevention: z.array(z.string().min(1)),
    blast_radius: z.array(z.string().min(1)),
    kb_writes: z.array(z.string().min(1)),
    time_to_diagnose_min: z.number().nonnegative(),
  })
  .strict()
  .superRefine(checkIdMatchesRegisteredType);

export type RCA = z.infer<typeof rcaSchema>;
