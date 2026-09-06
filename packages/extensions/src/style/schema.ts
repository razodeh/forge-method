/**
 * `styleProfileSchema` — `15` §15.8's "Voice, language and house style" document shape.
 *
 * @see specs/15 §15.8
 * @see PLAN-M2.md P7
 */
import { DIAGRAM_NOTATIONS } from '@forge/schemas';
import { z } from 'zod';

/**
 * `artifact_conventions`'s own worked example gives one value each for `headings`/`dates`/
 * `code_fences` with no enumerated set (unlike `person`, which the example itself comments `# first |
 * third`), so those three stay open strings — the same "no spec source, don't invent a closed set"
 * precedent `@forge/schemas/config`'s own `configSchema` already applies to its own single-example
 * fields. `diagrams` reuses `@forge/schemas`' own `DIAGRAM_NOTATIONS`, since it names the same real,
 * already-closed concept (a diagram's notation), not a second one this piece would have to invent.
 */
const artifactConventionsSchema = z
  .object({
    headings: z.string().min(1),
    dates: z.string().min(1),
    code_fences: z.string().min(1),
    diagrams: z.enum(DIAGRAM_NOTATIONS),
  })
  .strict();

export const styleProfileSchema = z
  .object({
    id: z.string().min(1),
    language: z.string().min(1),
    tone: z.string().min(1),
    person: z.enum(['first', 'third']),
    banned_phrases: z.array(z.string().min(1)),
    artifact_conventions: artifactConventionsSchema,
    commit_style: z.string().min(1),
    doc_length: z.record(z.string(), z.string().min(1)),
  })
  .strict();

export type StyleProfile = z.infer<typeof styleProfileSchema>;
