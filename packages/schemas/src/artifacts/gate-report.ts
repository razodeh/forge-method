/**
 * `gateReportSchema` — base front matter narrowed to `type: 'GateReport'`; see `SPEC-QUESTIONS.md`
 * Q23 for why this schema carried no type-specific fields until now.
 *
 * `10` §10's gate rules state only that "every gate evaluation writes a `GateReport` artifact...
 * with the exact command output" — no field-level spec exists for the document itself, which is why
 * every field below is optional: a report written before `PLAN-M14.md` P17 (or the static stub
 * template, `templates/artifacts/GateReport.md`) carries none of them and must keep validating.
 *
 * `gate` is the gate definition's own id (`G-Design`), distinct from `id` (`GATE-###`, this
 * document's own place in the registry's numbering, `18` §18.7). `outcome` is the evaluation's own
 * verdict (`10` §10.3 rule 1: `passed` when every deterministic check passed, `waived` when a
 * recorded waiver covers what failed, `failed` otherwise). `evaluatedAt` is the real instant the
 * evaluation ran, injected by the caller's own clock (`21` §21.1) — never read here.
 *
 * @see specs/10-workflow-engine-and-lifecycle.md §10
 * @see specs/10-workflow-engine-and-lifecycle.md §10.3
 * @see SPEC-QUESTIONS.md Q23
 * @see PLAN-M14.md P17
 */
import { z } from 'zod';

import { baseFrontMatterShape, checkIdMatchesRegisteredType } from '../registry/front-matter.ts';

export const gateReportSchema = baseFrontMatterShape
  .extend({
    type: z.literal('GateReport'),
    gate: z.string().min(1).optional(),
    outcome: z.enum(['passed', 'failed', 'waived']).optional(),
    evaluatedAt: z.string().datetime().optional(),
  })
  .strict()
  .superRefine(checkIdMatchesRegisteredType);

export type GateReport = z.infer<typeof gateReportSchema>;
