/**
 * `mutationEvidenceSchema` — `specs/18` §18.7's `MutationEvidence` registry entry, made real.
 *
 * Every field is committed verbatim from `PLAN-M15.md` P2's own Mandate, quoted in full in
 * `SPEC-QUESTIONS.md` Q280's Decision 3: "the story/piece id, the mutation kind
 * (`revert-implementation` in v1), the exact commit range or hunk set reverted, the named tests,
 * which tests failed under mutation, the restore verification, tool versions, and a timestamp."
 *
 * - `story`: `z.string().min(1)`, the identical loose-reference shape `story.ts`'s own `epic`/
 *   `capability` fields use for cross-referencing another artifact's id — not re-validated against
 *   the base `id` regex, since this field names a DIFFERENT artifact's id, not this one's own.
 * - `mutationKind`: a literal, not an enum. v1 names exactly one strategy; widening this later
 *   (per-hunk/operator mutation, `specs/22` M16) is a schema migration, not a config toggle.
 * - `revertedRange`: a commit range (`fromSha`/`toSha`, full 40-hex SHA-1), the right grain for v1's
 *   whole-change revert. A hunk-set shape is M16's to add once per-hunk mutation exists.
 * - `failedUnderMutation` is checked (below) to be a SUBSET of `namedTests`: evidence cannot name a
 *   failure for a test it never named as covered. `nonBinding` (a named test NOT in
 *   `failedUnderMutation`) is deliberately not its own field — it is derivable from the two fields
 *   above, and storing it separately would be redundant data that could drift out of sync.
 * - `ranAt`: a real ISO instant, distinct from the base front matter's date-only `created` — the
 *   identical reason `gate-report.ts`'s own `evaluatedAt` exists apart from `created`.
 *
 * One file per `forge test binding` run (`reports/mutation/{story}-{ts}.md`, `specs/18` §18.7) — never
 * revisited after it is written. The path template alone makes a COLLISION unlikely (two runs of the
 * same story in the same second), not impossible — `specs/18` §18.7's own normative text and
 * `SPEC-QUESTIONS.md` Q280 Decision 3 are both explicit that the naming scheme is not the enforcement
 * mechanism: "the writer must actively refuse an attempt to write an already-existing path." Checked
 * directly against this codebase's two pre-existing write paths before building anything new: `@forge/
 * kb`'s `KbWriter.write()` throws `ForgeError('KB-009')` on an existing path, but that check is
 * specific to `kb/`-rooted entries (Risk/Assumption/ADR/...), a different artifact family;
 * `GateReport`/`ReviewReport` are written via a direct, unguarded `writeFileAtomic()` call
 * (`packages/engine/src/interaction/swarm-review-step.ts`) with no existing-file check at all. Neither
 * pre-existing mechanism covered a `reports/`-rooted, non-KB, append-only type like this one, so
 * `@forge/core/fs` gained a third primitive for exactly this family: `writeNewFileAtomic`, which refuses
 * (`RUN-114`) rather than silently overwriting — proven, end to end, against a real `MutationEvidence`
 * record in `packages/core/test/artifacts/append-only-evidence.test.ts`.
 *
 * @see specs/18-persistence-config-and-schemas.md §18.7
 * @see PLAN-M15.md P2
 * @see SPEC-QUESTIONS.md Q280
 */
import { z } from 'zod';

import { baseFrontMatterShape, checkIdMatchesRegisteredType } from '../registry/front-matter.ts';

export const mutationEvidenceSchema = baseFrontMatterShape
  .extend({
    type: z.literal('MutationEvidence'),
    story: z.string().min(1),
    mutationKind: z.literal('revert-implementation'),
    revertedRange: z
      .object({
        fromSha: z.string().regex(/^[0-9a-f]{40}$/),
        toSha: z.string().regex(/^[0-9a-f]{40}$/),
      })
      .strict(),
    namedTests: z.array(z.string().min(1)).min(1),
    failedUnderMutation: z.array(z.string().min(1)),
    restoreVerified: z.boolean(),
    toolVersions: z.record(z.string(), z.string()),
    ranAt: z.string().datetime(),
  })
  .strict()
  .superRefine(checkIdMatchesRegisteredType)
  .superRefine((data, ctx) => {
    const named = new Set(data.namedTests);
    const unnamed = data.failedUnderMutation.find((test) => !named.has(test));
    if (unnamed !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['failedUnderMutation'],
        message: `"${unnamed}" is not present in namedTests — evidence cannot reference a test it never named.`,
      });
    }
  });

export type MutationEvidence = z.infer<typeof mutationEvidenceSchema>;
