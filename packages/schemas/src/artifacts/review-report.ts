/**
 * `reviewReportSchema` — base front matter narrowed to `type: 'ReviewReport'`; the identical
 * "no field-level spec exists for the document itself" situation `gate-report.ts`'s own doc comment
 * (`SPEC-QUESTIONS.md` Q23) already establishes for everything BUT `verdict` (below).
 *
 * `10` §10.6's own canonical `implement-story` workflow and `05` §5.2's `reviewer` agent persona both
 * describe the *process* that produces a `ReviewReport` (a `swarm-review` across design/security/
 * testing/performance perspectives, "cites the exact line and the exact standard it violates") but
 * neither, nor `18` §18.7 itself, specifies a field-level shape for the document — added to the
 * registry post-v1.0 (see `artifact-types.ts`'s own trailing entry).
 *
 * `verdict` (`PLAN-M14.md` P14, `SPEC-QUESTIONS.md` Q232 decision 7) is the one field this piece adds:
 * the engine's own merged `blocked|incomplete|concerns|clear` verdict (`@forge/engine/interaction`'s
 * `ReviewVerdict`), written by `reviewFrontMatter` and validated here BEFORE the write, exactly as
 * every other engine-stamped field already is. Optional, not required: every report this engine wrote
 * before this piece has no such key, and it must keep validating unchanged (`ArtifactDocument.parse`
 * reads the file at whatever revision it was committed at, never migrated in place).
 *
 * @see specs/10-workflow-engine-and-lifecycle.md §10.6
 * @see specs/05-agent-system.md §5.2
 * @see specs/18-persistence-config-and-schemas.md §18.7
 * @see SPEC-QUESTIONS.md
 */
import { z } from 'zod';

import { baseFrontMatterShape, checkIdMatchesRegisteredType } from '../registry/front-matter.ts';

export const reviewReportSchema = baseFrontMatterShape
  .extend({
    type: z.literal('ReviewReport'),
    verdict: z.enum(['blocked', 'incomplete', 'concerns', 'clear']).optional(),
  })
  .strict()
  .superRefine(checkIdMatchesRegisteredType);

export type ReviewReport = z.infer<typeof reviewReportSchema>;
