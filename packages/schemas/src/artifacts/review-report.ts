/**
 * `reviewReportSchema` — base front matter narrowed to `type: 'ReviewReport'`; the identical
 * "no field-level spec exists for the document itself" situation `gate-report.ts`'s own doc comment
 * (`SPEC-QUESTIONS.md` Q23) already establishes.
 *
 * `10` §10.6's own canonical `implement-story` workflow and `05` §5.2's `reviewer` agent persona both
 * describe the *process* that produces a `ReviewReport` (a `swarm-review` across design/security/
 * testing/performance perspectives, "cites the exact line and the exact standard it violates") but
 * neither, nor `18` §18.7 itself, specifies a field-level shape for the document — added to the
 * registry post-v1.0 (see `artifact-types.ts`'s own trailing entry).
 *
 * @see specs/10-workflow-engine-and-lifecycle.md §10.6
 * @see specs/05-agent-system.md §5.2
 * @see SPEC-QUESTIONS.md
 */
import { z } from 'zod';

import { baseFrontMatterShape, checkIdMatchesRegisteredType } from '../registry/front-matter.ts';

export const reviewReportSchema = baseFrontMatterShape
  .extend({ type: z.literal('ReviewReport') })
  .strict()
  .superRefine(checkIdMatchesRegisteredType);

export type ReviewReport = z.infer<typeof reviewReportSchema>;
