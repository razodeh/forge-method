/**
 * `evidenceBundleSchema` — base front matter narrowed to `type: 'EvidenceBundle'`; the identical
 * "no field-level spec exists for the document itself yet" situation `gate-report.ts`'s own doc
 * comment (`SPEC-QUESTIONS.md` Q23) already establishes for `GateReport`.
 *
 * `PLAN-M15.md` P2's own Mandate for `EvidenceBundle` is a genuine placeholder — "references a set
 * of evidence artifacts plus the gate they support" — unlike `MutationEvidence`'s complete field
 * list in the same Mandate sentence. `SPEC-QUESTIONS.md` Q280's Decision 3 records this asymmetry
 * explicitly: the real, detailed shape (binding evidence, test results, coverage delta, every
 * `ReviewReport` verdict, gate outcomes, exemptions in force, real cost) is `PLAN-M15.md` P7's own
 * Mandate, added when P7 actually assembles one — the identical way `ReviewReport`'s own `verdict`
 * field was added by a later piece than the one that first registered it.
 *
 * Genuinely append-only (`specs/18` §18.7, `08` §8.3/§8.4's real "superseded" meaning): every
 * assembly gets its own, newly-allocated `EVID-####` id and its own file
 * (`reports/evidence/{id}-{story}.md`), never a second write to an existing path.
 *
 * @see specs/18-persistence-config-and-schemas.md §18.7
 * @see PLAN-M15.md P2, P7
 * @see SPEC-QUESTIONS.md Q280
 */
import { z } from 'zod';

import { baseFrontMatterShape, checkIdMatchesRegisteredType } from '../registry/front-matter.ts';

export const evidenceBundleSchema = baseFrontMatterShape
  .extend({
    type: z.literal('EvidenceBundle'),
  })
  .strict()
  .superRefine(checkIdMatchesRegisteredType);

export type EvidenceBundle = z.infer<typeof evidenceBundleSchema>;
