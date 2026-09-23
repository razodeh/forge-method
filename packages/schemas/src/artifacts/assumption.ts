/**
 * `assumptionSchema` — one `ASM-###` entry in `kb/assumptions.md` ("open assumptions with validation
 * triggers", `08` §8.2), a `collection: true` type per `18` §18.7.
 *
 * A collection entry, not a whole front-matter document — see `entry-id.ts`'s doc comment for why
 * this does not extend `baseFrontMatterShape`.
 *
 * `sources` is OPTIONAL here (`PLAN-M14.md` P11): `08` §8.6's own "every write records sources" is a
 * `KbWriter`/output-CHECK invariant, not a schema constraint; `@forge/engine`'s output check requires
 * it on every new or changed produced entry instead (`dispatch/outputs.ts`). Also reused, unchanged, as
 * `HandoffRecord`'s own `assumptions` field shape (`handoff-record.ts`) -- an optional field there does
 * not change what `05` §5.6's worked example already requires of it.
 *
 * @see specs/08 §8.2
 * @see specs/08 §8.6
 * @see specs/05 §5.6 (a worked example, embedded in HandoffRecord)
 * @see PLAN-M14.md P11
 */
import { z } from 'zod';

import { entryIdSchema } from './entry-id.ts';
import { artifactSourceSchema } from './source.ts';

export const assumptionSchema = z
  .object({
    id: entryIdSchema('Assumption'),
    text: z.string().min(1),
    confidence: z.enum(['low', 'medium', 'high']),
    validate_by: z.string().min(1),
    sources: z.array(artifactSourceSchema).optional(),
  })
  .strict();

export type Assumption = z.infer<typeof assumptionSchema>;
