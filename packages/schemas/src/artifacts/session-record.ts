/**
 * `sessionRecordSchema` — `16` §16.5's Session record.
 *
 * `sessionType` (not `type`): `16` §16.5's own worked example names this field `type`, colliding with
 * the base front matter's `type` discriminator (`18` §18.6) — the same defect Story's own example
 * had (`SPEC-QUESTIONS.md` Q19), here a second time. See `SPEC-QUESTIONS.md` Q22.
 *
 * `no_disagreement_observed` — `16` §16.7 point 4's own anti-groupthink flag ("the record flags a
 * session where no participant disagreed with any other, so the user can see when a session was
 * theatre"), added by `PLAN-M10.md` P11. Optional: this is a small, additive field on an artifact
 * schema that is not one of `19` §19.5's own seven named extension-authoring contracts (agent
 * definition/workflow DSL/skill format/check format/framework schema/`PlatformAdapter`/internal
 * `@forge/*` APIs) at all — `SessionRecord` is an internal, engine-produced runtime artifact, not a
 * contract a third-party module author writes against, so that table's tier column has no row for it
 * (confirmed directly against `specs/19` §19.5's own table before adding this field; see
 * `SPEC-QUESTIONS.md`). Optional rather than required so every `SessionRecord` written before this
 * piece (none yet ship in this repo, but any hand-authored fixture predating it) remains valid without
 * a migration — the same additive-field discipline the closest analogous, actually-tiered contract
 * (`evolving`) would require even if this schema were formally governed by that table.
 *
 * @see specs/16 §16.5
 * @see specs/16 §16.7
 * @see SPEC-QUESTIONS.md Q22
 * @see PLAN-M10.md P11
 */
import { z } from 'zod';

import { baseFrontMatterShape, checkIdMatchesRegisteredType } from '../registry/front-matter.ts';

// The closed, ten-row table at 16 §16.2.
const SESSION_TYPES = [
  'brainstorm',
  'design-review',
  'tradeoff',
  'premortem',
  'retro',
  'war-room',
  'estimation',
  'standup',
  'discovery-interview',
  'story-refinement',
] as const;

export const sessionRecordSchema = baseFrontMatterShape
  .extend({
    type: z.literal('SessionRecord'),
    sessionType: z.enum(SESSION_TYPES),
    technique: z.array(z.string().min(1)),
    question: z.string().min(1),
    constraints_applied: z.array(z.string().min(1)),
    participants: z.array(z.string().min(1)),
    started: z.string().datetime(),
    ended: z.string().datetime(),
    cost_usd: z.number().nonnegative(),
    // `16` §16.7 point 4 — see this file's own top-of-file doc comment for why this is optional.
    no_disagreement_observed: z.boolean().optional(),
  })
  .strict()
  .superRefine(checkIdMatchesRegisteredType);

export type SessionRecord = z.infer<typeof sessionRecordSchema>;
