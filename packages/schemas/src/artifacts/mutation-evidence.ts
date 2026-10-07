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
 * - `mutationKind`: v1 named exactly one strategy as a literal; M16 P5 widens it to an enum of two
 *   (`revert-implementation`, unchanged, and `revert-hunks` — `18` §18.7, `13` F-TEST-10) via the
 *   `1→2` migration below, exactly the "widening this later is a schema migration" this comment
 *   already anticipated. A `revert-hunks` record carries `hunkRun` (below) in addition to every v1
 *   field — `18` §18.7: "carries, BEYOND what schema version 1 records carry, the base sha...". It
 *   still carries `revertedRange` too: F-TEST-10's own change-level credit for a file mutant or the
 *   whole-change mutant ("a file mutant and the whole-change mutant take the change-level credit")
 *   is the identical revert-and-rerun procedure a `revert-implementation` record already describes,
 *   so nothing about v1's own fields is removed, only added to — a DECISION this piece's own report
 *   discloses, since `18` §18.7's prose names `hunkRun`'s own fields as new without stating in so
 *   many words whether `revertedRange` is kept or replaced alongside them.
 * - `revertedRange`: a commit range (`fromSha`/`toSha`, full 40-hex SHA-1), the right grain for v1's
 *   whole-change revert. A hunk-set shape is M16's to add once per-hunk mutation exists.
 * - `failedUnderMutation` is checked (below) to be a SUBSET of `namedTests`: evidence cannot name a
 *   failure for a test it never named as covered. `nonBinding` (a named test NOT in
 *   `failedUnderMutation`) is deliberately not its own field — it is derivable from the two fields
 *   above, and storing it separately would be redundant data that could drift out of sync.
 * - `ranAt`: a real ISO instant, distinct from the base front matter's date-only `created` — the
 *   identical reason `gate-report.ts`'s own `evaluatedAt` exists apart from `created`.
 * - `hunkRun.hunks[].killedBy` (`specs/22` M16 P13): widened from this field's own M16 P5 first cut
 *   (a bare `z.string()`) to a non-empty array once the real producer (`hunk-mutation.ts`, M16 P12)
 *   existed and was found to genuinely need more than one name — see `hunkEntrySchema`'s own doc
 *   comment below for the full reasoning. The first, SINGULAR cut was never exercised by any real
 *   caller (M16 P13 is the first piece to write a `hunkRun` through this schema at all), so widening
 *   it is a correction to an unused sub-field, not a break to shipped behaviour.
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

/**
 * One hunk's own range within its file, as a unified-diff hunk header already states it
 * (`@@ -oldStart,oldLength +newStart,newLength @@`) — `13` F-TEST-10 names "ranges" as a fact a hunk
 * entry carries without fixing a literal shape (the hunk ID format itself is explicitly left to
 * `specs/22` M16 P11: "The format is not fixed here"). This structured, numeric shape is this piece's
 * own DECISION, not a transcription: P11 has not landed as of this piece, so no real type exists yet
 * to mirror. Chosen over a raw header string because the two numbers are what every later consumer
 * (surfacing, a project-authored hunk check, `specs/22` M16 P13) would otherwise have to re-parse out
 * of one.
 */
const hunkRangeSchema = z
  .object({
    start: z.number().int().min(0),
    length: z.number().int().min(0),
  })
  .strict();

/**
 * One hunk's own record (`13` F-TEST-10: "each hunk's id, path, ranges, content hash, verdict and
 * `killedBy`" — `18` §18.7's own words, transcribed field for field). `id`'s format is P11's to fix
 * (`13` F-TEST-10: "the piece that builds the parser... fixes it under these two requirements" —
 * stable per base/head pair, distinct for textually identical hunks in one file); this schema treats
 * it as an opaque non-empty string rather than guessing a shape P11 has not yet built, an additive-
 * safe choice since any format P11 settles on is still a non-empty string. `contentHash` is a sha256
 * hex digest of the hunk's own reversed content, never the content itself — the identical
 * content-hash-only discipline `parity-evidence.ts`'s own case entries use, for the same reason (`13`
 * F-TEST-9/F-TEST-10's shared information boundary: evidence carries hashes, never source text).
 *
 * `killedBy` is a non-empty ARRAY of test names (`specs/22` M16 P13, widened from this field's own
 * first cut — a bare `z.string()` — written before M16 P12's own real hunk-mutation engine
 * (`hunk-mutation.ts`) existed to produce a real value for it). That engine's own `HunkVerdict`
 * carries `killedBy: readonly string[]`: reversing ONE hunk can make MORE than one baseline-passing
 * test fail (`hunk-mutation.test.ts`'s own "degrades to granularity file" case already exercises
 * `killedBy: ['adds', 'subtracts']`, two real killing tests from one whole-file revert). A singular
 * `killedBy` cannot hold that without either dropping every killing test but one (real binding
 * evidence lost) or forcing an unparsed joined string a reader would have to re-split — the identical
 * "a raw string a consumer must re-parse" shape `hunkRangeSchema`'s own doc comment above already
 * argues against for ranges. Widened losslessly to match the real producer's own shape: no real
 * record had ever been written through this exact sub-shape before M16 P13 (P5's own fixtures used a
 * placeholder string that no production code had ever actually constructed), so this is a narrow,
 * additive correction to an as-yet-unused field, not a break to anything shipped.
 */
const hunkEntrySchema = z
  .object({
    id: z.string().min(1),
    path: z.string().min(1),
    ranges: z.object({ old: hunkRangeSchema, new: hunkRangeSchema }).strict(),
    contentHash: z.string().regex(/^[0-9a-f]{64}$/),
    verdict: z.enum(['killed', 'uncovered', 'invalid', 'timeout', 'skipped']),
    killedBy: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.verdict === 'killed' && entry.killedBy === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['killedBy'],
        message: `hunk "${entry.id}" is killed but names no killedBy test.`,
      });
    }
    if (entry.verdict !== 'killed' && entry.killedBy !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['killedBy'],
        message: `hunk "${entry.id}" has verdict "${entry.verdict}" but names a killedBy test; only a killed hunk has one.`,
      });
    }
  });

/**
 * `revert-hunks`' own second shape (`13` F-TEST-10, `18` §18.7): the base sha the hunks were taken
 * against, the pinned diff algorithm, the `granularity` actually used and the hunk list.
 * `diffAlgorithm` is free text, not a literal: the algorithm is "pinned and recorded in the evidence"
 * (`process/SPEC-QUESTIONS.md` Q294 Decision 8 — `git diff -U0 --no-renames`, Myers), but P11, which
 * fixes the real invocation, has not landed as of this piece, so a literal risks being the wrong exact
 * spelling of a string nothing yet produces; a free-text field records whatever P11's writer states
 * without this schema guessing it first.
 */
const hunkRunSchema = z
  .object({
    baseSha: z.string().regex(/^[0-9a-f]{40}$/),
    diffAlgorithm: z.string().min(1),
    granularity: z.enum(['hunk', 'file', 'change']),
    // `.min(1)` (`specs/22` M16 P13, round-2 gauntlet fix, defence in depth): a plain
    // `z.array(hunkEntrySchema)` accepted `hunks: []`, which this file's own comment on `mutationKind`
    // below asserted could not happen ("there is no hunk run with zero hunks to speak of") without
    // this schema ever actually enforcing it. It can happen: `--base` resolved further back than the
    // implementation's own last real change makes `computeHunks` find zero real hunks while the
    // change-level check still reaches `'completed'` (`hunk-mutation.ts`'s own `runHunkMutationCheck`
    // now omits `hunkMutation` entirely for exactly that reason, so no real caller reaches this schema
    // with an empty list) — but a `revert-hunks` record with nothing in its own hunk list is not a
    // valid record on its own terms either way, the identical "a declaration with no surface that is
    // not exempt is `nothing-compared`, never a vacuous pass" stance `13` F-TEST-9's own counting
    // algebra already takes for the parity oracle.
    hunks: z.array(hunkEntrySchema).min(1),
  })
  .strict();

export const mutationEvidenceSchema = baseFrontMatterShape
  .extend({
    type: z.literal('MutationEvidence'),
    story: z.string().min(1),
    mutationKind: z.enum(['revert-implementation', 'revert-hunks']),
    revertedRange: z
      .object({
        fromSha: z.string().regex(/^[0-9a-f]{40}$/),
        toSha: z.string().regex(/^[0-9a-f]{40}$/),
      })
      .strict(),
    hunkRun: hunkRunSchema.optional(),
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
    // `specs/22` M16 P5: `hunkRun` is `revert-hunks`' own shape; a `revert-implementation` record
    // carries no hunk list to report, and a `revert-hunks` record always has one.
    //
    // CORRECTED (`specs/22` M16 P13, round-2 gauntlet fix): this comment used to go on to claim
    // "there is no hunk run with zero hunks to speak of", inferred from `13` F-TEST-10's own cost
    // accounting ("N hunks cost N + 3 runs" presumes N is at least 1) -- but that was never actually
    // enforced by this schema (a plain `z.array(hunkEntrySchema)` accepts `[]`), and the inference
    // itself turned out to be false: `--base` resolved further back than the implementation's own
    // last real change makes the real engine (`hunk-mutation.ts`'s `computeHunks`) find zero real
    // hunks while the change-level check still reaches `'completed'`. Now closed at both ends:
    // `hunkRunSchema.hunks` is `.min(1)` (see its own doc comment above) so this schema can no longer
    // accept the empty-hunks shape at all, and `runHunkMutationCheck` omits `hunkMutation` entirely
    // in that state, so no real caller ever constructs one to begin with.
    if (data.mutationKind === 'revert-hunks' && data.hunkRun === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['hunkRun'],
        message: 'mutationKind is "revert-hunks" but hunkRun is absent.',
      });
    }
    if (data.mutationKind === 'revert-implementation' && data.hunkRun !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['hunkRun'],
        message:
          'mutationKind is "revert-implementation" but hunkRun is present; only a revert-hunks record has one.',
      });
    }
    // The identical "a field version 1 lacks forces schemaVersion 2" discipline
    // `evidenceBundleSchema`'s own `parityEvidence` check enforces (`18` §18.6/§18.7).
    if (data.hunkRun !== undefined && data.schemaVersion < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['schemaVersion'],
        message: `hunkRun is present but schemaVersion is ${String(data.schemaVersion)}; a record carrying it must be schemaVersion 2 or higher.`,
      });
    }
    // Round-2 critic: `revertedRange` and `hunkRun` both name a base/from commit, and this schema
    // keeps BOTH fields on a `revert-hunks` record (see this file's own DECISION above) specifically
    // because they are meant to describe the SAME revert-and-rerun base -- a record whose two fields
    // named two unrelated commits was accepted before this check existed. Checked only when both are
    // present (a `revert-implementation` record's own mismatched-field case is already refused above).
    if (data.hunkRun !== undefined && data.hunkRun.baseSha !== data.revertedRange.fromSha) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['hunkRun', 'baseSha'],
        message: `hunkRun.baseSha ("${data.hunkRun.baseSha}") does not match revertedRange.fromSha ("${data.revertedRange.fromSha}") -- both name the same revert base and must agree.`,
      });
    }
  });

export type MutationEvidence = z.infer<typeof mutationEvidenceSchema>;
