/**
 * `defectSchema` — `13` §13's `DefectRecord`, from the debug loop's INTAKE step.
 *
 * `13` §13: "Normalise the symptom into a `DefectRecord`: observed vs expected behaviour, first seen,
 * frequency, environment, severity (Sev1–4), affected `CAP`/`STORY`, and evidence (failing test,
 * stack trace, log excerpt, trace id, screenshot)."
 *
 * @see specs/13-frameworks-testing-and-debugging.md §13
 */
import { z } from 'zod';

import { baseFrontMatterShape, checkIdMatchesRegisteredType } from '../registry/front-matter.ts';

/** Shared with `rcaSchema` — `13` §13's RECORD step reuses the same Sev1–4 scale on a defect's RCA. */
export const SEVERITIES = ['Sev1', 'Sev2', 'Sev3', 'Sev4'] as const;

export const defectSchema = baseFrontMatterShape
  .extend({
    type: z.literal('Defect'),
    observed: z.string().min(1),
    expected: z.string().min(1),
    first_seen: z.string().date(),
    frequency: z.string().min(1),
    environment: z.string().min(1),
    severity: z.enum(SEVERITIES),
    affected: z.array(z.string().min(1)),
    evidence: z.array(z.string().min(1)),
  })
  .strict()
  .superRefine(checkIdMatchesRegisteredType);

export type Defect = z.infer<typeof defectSchema>;
