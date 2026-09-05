/**
 * `storySchema` — `specs/09` §9.3's Story (`STORY-###`), the central execution unit.
 *
 * `storyType` (not `type`): `09` §9.3's own worked example names this field `type`, colliding with
 * the base front matter's `type` discriminator (`18` §18.6) — the same document cannot have two keys
 * both named `type` with different meanings. See `SPEC-QUESTIONS.md` Q19.
 *
 * @see specs/09 §9.3
 * @see SPEC-QUESTIONS.md Q19
 */
import { z } from 'zod';

import { baseFrontMatterShape, checkIdMatchesRegisteredType } from '../registry/front-matter.ts';
import { acceptanceCriterionSchema } from './acceptance-criterion.ts';

const STORY_STATUSES = [
  'draft',
  'ready',
  'in-progress',
  'in-review',
  'verified',
  'done',
  'blocked',
] as const;

export const storySchema = baseFrontMatterShape
  .extend({
    type: z.literal('Story'),
    epic: z.string().min(1),
    capability: z.string().min(1),
    storyType: z.enum(['feature', 'tech', 'spike', 'bug', 'chore', 'migration']),
    size: z.enum(['S', 'M', 'L']),
    status: z.enum(STORY_STATUSES),
    owner_role: z.string().min(1),
    depends_on: z.array(z.string().min(1)),
    blocked_by: z.array(z.string().min(1)),
    interfaces: z.array(z.string().min(1)),
    data: z.array(z.string().min(1)),
    files_expected: z.array(z.string().min(1)),
    context_refs: z.array(z.string().min(1)),
    acceptance: z.array(acceptanceCriterionSchema),
    tests: z.array(z.string().min(1)),
    dod_profile: z.string().min(1),
  })
  .strict()
  .superRefine(checkIdMatchesRegisteredType)
  .superRefine((data, ctx) => {
    // "size: L is accepted at status: draft and refused at status: ready" (PLAN-M1.md P6), per §9.3's
    // own inline comment: "L must be split before G-Ready" — draft is the only status before that
    // gate, so L is invalid at every other status, not only 'ready'.
    if (data.size === 'L' && data.status !== 'draft') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['size'],
        message: 'a size L story must be split before it reaches status "ready" or later.',
      });
    }

    // "files_expected non-empty for ready" (PLAN-M1.md P6) — one of §9.3's Definition-of-Ready rules,
    // checked here for the one status the Check names; the rest of that rule list is a G-Ready gate
    // check, not a front-matter shape validation, and out of this schema's scope.
    if (data.status === 'ready' && data.files_expected.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['files_expected'],
        message: 'files_expected must be non-empty once a story reaches status "ready".',
      });
    }

    // "AC ids ... are unique within the story" (PLAN-M1.md P6).
    const seen = new Map<string, number>();
    data.acceptance.forEach((criterion, index) => {
      const firstIndex = seen.get(criterion.id);
      if (firstIndex !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['acceptance', index, 'id'],
          message: `duplicate acceptance criterion id "${criterion.id}" (already used at acceptance[${String(firstIndex)}]).`,
        });
      } else {
        seen.set(criterion.id, index);
      }
    });
  });

export type Story = z.infer<typeof storySchema>;
