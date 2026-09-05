/**
 * `openQuestionSchema` — one `OQ-###` entry in `kb/open-questions.md` ("unanswered questions
 * blocking or shadowing work", `08` §8.2), a `collection: true` type per `18` §18.7.
 *
 * No field-level spec exists for this type at all — `08` §8.2 gives only the purpose description
 * above, and `05` §5.6's only usage is a plain string list, not a structured entry. Kept minimal:
 * `question` and `status`, the latter justified directly by `10` §10's gate rule that "blocking OQs
 * must be resolved," which presupposes an open/resolved state to check. See `SPEC-QUESTIONS.md` Q23.
 *
 * @see specs/08 §8.2
 * @see SPEC-QUESTIONS.md Q23
 */
import { z } from 'zod';

import { entryIdSchema } from './entry-id.ts';

export const openQuestionSchema = z
  .object({
    id: entryIdSchema('OpenQuestion'),
    question: z.string().min(1),
    status: z.enum(['open', 'resolved']),
  })
  .strict();

export type OpenQuestion = z.infer<typeof openQuestionSchema>;
