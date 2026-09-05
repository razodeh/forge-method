/**
 * `diagramSchema` — `08` §8.11.5's Diagram artifact.
 *
 * @see specs/08 §8.11.5
 */
import { z } from 'zod';

import { baseFrontMatterShape, checkIdMatchesRegisteredType } from '../registry/front-matter.ts';

/** `08` §8.11.2's notation table. Exported so `@forge/schemas/config`'s `diagrams.*Notation*` keys
 * reuse the same closed set rather than a second transcription. */
export const DIAGRAM_NOTATIONS = ['mermaid', 'plantuml', 'd2', 'dot', 'structurizr'] as const;

export const diagramSchema = baseFrontMatterShape
  .extend({
    type: z.literal('Diagram'),
    // The §8.11.3 taxonomy's "notation kind" column (C4Context, sequenceDiagram, erDiagram, ...) is a
    // reference table of common values, not stated as an exhaustive enum, and includes qualified
    // forms ("flowchart LR") that a closed union would reject unfairly — left open.
    kind: z.string().min(1),
    notation: z.enum(DIAGRAM_NOTATIONS),
    source: z.string().min(1),
    generated: z.boolean(),
    generator: z.string().min(1).optional(),
    depicts: z.array(z.string().min(1)),
    explains: z.array(z.string().min(1)),
    // "caption and alt_text are required" (08 §8.11.5, PLAN-M1.md P7's Check).
    caption: z.string().min(1),
    alt_text: z.string().min(1),
    owner: z.string().min(1),
    verified: z.string().date().optional(),
    review_by: z.string().date().optional(),
  })
  .strict()
  .superRefine(checkIdMatchesRegisteredType)
  .superRefine((data, ctx) => {
    // "generated: true requires a generator" (PLAN-M1.md P7's Check) — a diagram claiming to be
    // machine-produced with no named generator cannot actually be regenerated to check for drift
    // (08 §8.11.6).
    if (data.generated && data.generator === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['generator'],
        message: 'a diagram with generated: true must name the generator that produces it.',
      });
    }
  });

export type Diagram = z.infer<typeof diagramSchema>;
