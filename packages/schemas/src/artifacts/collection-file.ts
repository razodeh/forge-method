/**
 * `risksFileSchema`/`assumptionsFileSchema`/`openQuestionsFileSchema`/`environmentsFileSchema` — the
 * on-disk shape of a `collection: true` file once it holds more than one entry (`08` §8.2 calls these
 * "registers": `risks.md`, `assumptions.md`, `open-questions.md`, `kb/delivery/environments.md`). No
 * spec page states this shape — `SPEC-QUESTIONS.md` Q29 (M1) found the gap and deferred it; this
 * closes that deferral (Q50).
 *
 * Modelled on the one concrete precedent the spec pack gives for "a list of these exact entry-shaped
 * objects": `05` §5.6's `HandoffRecord` example embeds
 * `assumptions: [ { id: ASM-004, text: ..., confidence: ..., validate_by: ... } ]` — a YAML list of
 * the exact shape `assumptionSchema` already validates, living directly in a document's front matter.
 * That is also already this codebase's own established shape for `baseFrontMatterShape.changelog`
 * (an array of structured objects in front matter) — not a new pattern being invented here.
 *
 * Extends `baseFrontMatterShape` minus `id` — a gauntlet critic found a first version of this file
 * dropped the *entire* `18` §18.6 base (`title`/`status`/`created`/`updated`/`revision`/`author`/
 * `changelog`), not just `id`, with no stated reason beyond the one given for `id` itself, and
 * `.strict()` then actively rejected a compliant author who tracked who last touched the register and
 * when — exactly what every sibling schema in this registry (`adrSchema`, `diagramSchema`) already
 * supports. `id` alone is omitted because a collection file names many ids, not one, so the single-id
 * `checkIdMatchesRegisteredType` cross-check does not apply — the same reasoning `entry-id.ts` already
 * gives for why the entry schemas themselves skip `baseFrontMatterShape` entirely.
 *
 * Deliberately not checked here: two entries in the same array sharing one id (`RISK-001` twice).
 * `18` §18.8 says ids are "never reused," a project-wide invariant that needs a scan broader than one
 * file parsed in isolation — the KB linter (`08` §8.7, `PLAN-M3.md` P10) is where that check belongs,
 * not a single file's own schema.
 *
 * @see specs/08 §8.2
 * @see specs/18 §18.6
 * @see SPEC-QUESTIONS.md Q29
 * @see SPEC-QUESTIONS.md Q50
 */
import { z } from 'zod';

import { baseFrontMatterShape } from '../registry/front-matter.ts';
import { assumptionSchema } from './assumption.ts';
import { environmentSchema } from './environment.ts';
import { openQuestionSchema } from './open-question.ts';
import { riskSchema } from './risk.ts';

const collectionFileBase = baseFrontMatterShape.omit({ id: true });

export const risksFileSchema = collectionFileBase
  .extend({
    type: z.literal('Risk'),
    risks: z.array(riskSchema),
  })
  .strict();
export type RisksFile = z.infer<typeof risksFileSchema>;

export const assumptionsFileSchema = collectionFileBase
  .extend({
    type: z.literal('Assumption'),
    assumptions: z.array(assumptionSchema),
  })
  .strict();
export type AssumptionsFile = z.infer<typeof assumptionsFileSchema>;

export const openQuestionsFileSchema = collectionFileBase
  .extend({
    type: z.literal('OpenQuestion'),
    open_questions: z.array(openQuestionSchema),
  })
  .strict();
export type OpenQuestionsFile = z.infer<typeof openQuestionsFileSchema>;

export const environmentsFileSchema = collectionFileBase
  .extend({
    type: z.literal('Environment'),
    environments: z.array(environmentSchema),
  })
  .strict();
export type EnvironmentsFile = z.infer<typeof environmentsFileSchema>;
