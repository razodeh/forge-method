/**
 * `disclosureSchema` — one `DISC-###` entry in `kb/disclosures.md`, a `collection: true` type per
 * `18` §18.7.
 *
 * `specs/22` M15 P10's own Mandate: a user project's own analogue of `SPEC-QUESTIONS.md` — "every
 * disclosed trade-off [and] known gap... recorded with provenance and an owner." Only these two kinds
 * are ever REALLY written as a `Disclosure` document: an exemption already has its own real register
 * (`reports/exemptions.md`, `exemptionSchema`, M15 P6) and a stopped critic loop already has its own
 * real, durable record (the run event log's own `StepFailed`/`RUN-113`, M15 P9) — both are surfaced
 * into the SAME merged view a human reads (`forge kb disclosures`, `forge doctor`) by reading those
 * two sources directly at view time, not by this piece re-writing either one as a second, independently
 * driftable copy. `DisclosureKind` is therefore deliberately narrower than the Mandate's own four-item
 * prose list — see `packages/cli/src/commands/kb-disclosures.ts`'s own doc comment for the full
 * reasoning and the synthesized view type that reunites all four.
 *
 * `sources` mirrors `artifactSourceSchema`'s own already-established "provenance is mandatory, min 1"
 * convention (`08` §8.3) — the one field `exemptionSchema` itself does not carry (an exemption's own
 * provenance is the `forge test exempt` invocation that created it, inherently singular and already
 * named by `owner`), but a free-text, human-or-agent-authored trade-off/known-gap needs a real "why do
 * I believe this" trail the way any other KB-located judgment call does.
 *
 * `resolved`/`resolution` is the one real lifecycle addition no sibling collection-entry schema in
 * this registry has: "a disclosure is never deleted, only resolved with a reason" (the Mandate's own
 * words) needs a THIRD state beyond "exists"/"doesn't exist" that `exemptionSchema`'s own simpler
 * create-only shape never needed (an exemption's own de-facto resolution is `expiry`, already a plain
 * field with no separate reason/owner of its own). The `superRefine` below ties `resolved` and
 * `resolution` together exactly the way `adrSchema`'s own `status`/`superseded_by` pair already is
 * (`18` §18.6) — the identical "two fields that describe one fact from two directions must not
 * disagree" shape, not a new pattern invented here.
 *
 * @see specs/22 M15 P10
 * @see PLAN-M15.md P10
 */
import { z } from 'zod';

import { entryIdSchema } from './entry-id.ts';
import { artifactSourceSchema } from './source.ts';

/** Only the two kinds ever REALLY persisted as a `Disclosure` document — see this file's own top doc
 * comment for why `exemption`/`stopped-critic-loop` are synthesized at read time instead, from their
 * own already-real sources, never written here. */
export const DISCLOSURE_KINDS = ['trade-off', 'known-gap'] as const;
export type DisclosureKind = (typeof DISCLOSURE_KINDS)[number];

export const disclosureResolutionSchema = z
  .object({
    reason: z.string().min(1),
    by: z.string().min(1),
    at: z.string().date(),
  })
  .strict();
export type DisclosureResolution = z.infer<typeof disclosureResolutionSchema>;

export const disclosureSchema = z
  .object({
    id: entryIdSchema('Disclosure'),
    kind: z.enum(DISCLOSURE_KINDS),
    summary: z.string().min(1),
    owner: z.string().min(1),
    sources: z.array(artifactSourceSchema).min(1),
    resolved: z.boolean(),
    resolution: disclosureResolutionSchema.optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.resolved && data.resolution === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['resolution'],
        message: 'a resolved disclosure must name its own resolution (reason/by/at).',
      });
    }
    if (!data.resolved && data.resolution !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['resolved'],
        message: 'resolution is set, but resolved is false -- the two must agree.',
      });
    }
  });

export type Disclosure = z.infer<typeof disclosureSchema>;
