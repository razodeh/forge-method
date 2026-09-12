/**
 * `techniqueSchema` — `16` §16.4's technique library, as data (`techniques/*.technique.yaml`).
 *
 * A technique is deliberately small: an id, a display name, what it's best for, which phase(s) of
 * `16` §16.3's own anatomy it applies to, and one facilitator prompt template. `16` §16.4's own three
 * tables (12 divergent, 8 convergent) plus its own prose row of six retro techniques name every real
 * technique this schema's instances describe -- see `load.ts`'s own header for why that is 25 files,
 * not 26.
 *
 * `phases` (plural, an array), not the singular `phase` the plan's own prose describes: `five-whys`
 * is real, named content that appears in *both* `16` §16.4's own Divergent techniques table ("Best
 * for: Retros and RCA") and its own retro-techniques prose row -- one real technique with two real
 * phases, which a singular field cannot express without either duplicating the id (breaking
 * `loadTechnique`'s own "one real answer per id" contract) or silently picking one table and losing
 * the other's own citation. An array with the identical enum of allowed values keeps every other
 * technique (all of which cite exactly one phase) trivially expressible as a one-element array, so
 * this costs nothing for the 24 techniques that don't need it. See `SPEC-QUESTIONS.md`.
 *
 * @see specs/16 §16.4
 * @see PLAN-M10.md P9
 * @see SPEC-QUESTIONS.md
 */
import { z } from 'zod';

/** `16` §16.3's own anatomy: divergent techniques apply in DIVERGE, convergent in CONVERGE, and the
 * six named retro techniques in a `retro` session's own DECIDE-adjacent reflection work. */
export const TECHNIQUE_PHASES = ['diverge', 'converge', 'retro'] as const;

export type TechniquePhase = (typeof TECHNIQUE_PHASES)[number];

export const techniqueSchema = z
  .object({
    /** Kebab-ish, matching `16` §16.4's own table verbatim -- one table entry
     * (`what-would-X-do`) capitalises a letter mid-id, so the pattern allows letters of either case
     * rather than forcing every id to lowercase and silently diverging from the spec's own text. */
    id: z.string().regex(/^[A-Za-z][A-Za-z0-9-]*$/, 'must be a bare, hyphenated identifier'),
    name: z.string().min(1),
    /** `16` §16.4's own table "Best for" column, verbatim. */
    bestFor: z.string().min(1),
    phases: z.array(z.enum(TECHNIQUE_PHASES)).min(1),
    /** The facilitator's own prompt template for running this technique -- free text, since `16`
     * §16.4 gives no fixed template grammar; may reference `{{question}}` for the framed question. */
    prompt: z.string().min(1),
  })
  .strict();

export type Technique = z.infer<typeof techniqueSchema>;
