/**
 * `gateReportSchema` — base front matter narrowed to `type: 'GateReport'`; see `SPEC-QUESTIONS.md`
 * Q23 for why this schema carries no type-specific fields.
 *
 * `10` §10's gate rules state only that "every gate evaluation writes a `GateReport` artifact...
 * with the exact command output" — no field-level spec exists for the document itself.
 *
 * @see specs/10-workflow-engine-and-lifecycle.md §10
 * @see SPEC-QUESTIONS.md Q23
 */
import { z } from 'zod';

import { baseFrontMatterShape, checkIdMatchesRegisteredType } from '../registry/front-matter.ts';

export const gateReportSchema = baseFrontMatterShape
  .extend({ type: z.literal('GateReport') })
  .strict()
  .superRefine(checkIdMatchesRegisteredType);

export type GateReport = z.infer<typeof gateReportSchema>;
