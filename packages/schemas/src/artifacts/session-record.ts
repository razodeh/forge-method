/**
 * `sessionRecordSchema` — `16` §16.5's Session record.
 *
 * `sessionType` (not `type`): `16` §16.5's own worked example names this field `type`, colliding with
 * the base front matter's `type` discriminator (`18` §18.6) — the same defect Story's own example
 * had (`SPEC-QUESTIONS.md` Q19), here a second time. See `SPEC-QUESTIONS.md` Q22.
 *
 * @see specs/16 §16.5
 * @see SPEC-QUESTIONS.md Q22
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
  })
  .strict()
  .superRefine(checkIdMatchesRegisteredType);

export type SessionRecord = z.infer<typeof sessionRecordSchema>;
