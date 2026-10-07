/**
 * `parityEvidenceSchema` — `specs/18` §18.7's `ParityEvidence` registry entry, made real: one record
 * per `forge parity check` invocation (never for `--no-record`), holding verdicts, digests and
 * content hashes, and never an observed value (`13` F-TEST-9's own information boundary).
 *
 * There is no dedicated F-TEST-9 subsection giving this record's own literal field list (F-TEST-9
 * names what a `ParityEvidence` record is FOR — `PLAN-M16.md` P5's own brief says so explicitly). The
 * field list below is assembled from two independent, closely-paraphrasing normative sources that
 * agree with each other: F-TEST-9's own "Evidence" bullet and `18` §18.7's own, more detailed
 * paraphrase of it. Where either names a fact this schema had no field for, that was a defect to
 * report, not a licence to invent one silently; this piece's own report says whether any were found.
 *
 * **Verdict/surface literals are independently re-declared, not imported.** `specs/02` §2.2 places
 * `@forge/schemas` at the bottom of the dependency graph — it may import nothing under `@forge/*` —
 * and the real nine-verdict precedence and four-surface-kind sets are owned by
 * `packages/cli/src/commands/parity/{counting,declaration-types}.ts` (P4/P2's own, already-landed
 * types: `CaseVerdict`, `DeclarationStopVerdict`, `SurfaceKind`). The literal string values below are
 * copied verbatim from those modules (never a paraphrase), the identical boundary `@forge/templates`'s
 * own `TemplateArtifactTypeId` already crosses by independently re-declaring `ArtifactTypeId`'s own
 * members (`packages/templates/src/index.ts`'s own doc comment). Unlike that pair, this one has no
 * automatic cross-check: `@forge/cli`'s `package.json` exports only its compiled binary entry
 * (`"." -> "./dist/forge.mjs"`), not a subpath for `commands/parity/*`, so no repo-root test can
 * cross-check the two lists the way `test/templates.test.ts` cross-checks `TemplateArtifactTypeId`
 * against `ArtifactTypeId` — disclosed in this piece's own report as a residual sync risk, not closed
 * here.
 *
 * - `story`: optional, `--story <id>`'s own value when the check was given one; its absence means the
 *   record's retention subject is the single shared literal `project`, never this record's own id
 *   (`13` F-TEST-9; `18` §18.7 Retention; `process/SPEC-QUESTIONS.md` Q294 Decision 5, Decision 9).
 * - `trusted`: the trust anchor's own commit sha (`--trusted <ref>`, resolved once), or `null` when no
 *   `--trusted` was given — NOT the same thing as a declaration's own `reference.ref`
 *   (`process/SPEC-QUESTIONS.md` Q294 Decision 3/A3): a full, lower-case commit sha, 40 digits in a
 *   SHA-1 repository or 64 in a SHA-256 one, the exact digit-count rule the trust anchor's own
 *   exactness check enforces.
 * - `headSha`/`dirty`/`deltaDigest`: the candidate's own head commit, whether its tree was dirty
 *   around the run, and the sha256 of its pre-first-case cleanliness snapshot (`tree-snapshot.ts`'s
 *   own `snapshotDigest`, by name, never reinvented).
 * - `toolVersions`: the identical `Record<string, string>` shape `mutationEvidenceSchema`'s own field
 *   of the same name already uses. No "tool version" concept exists anywhere in the already-landed
 *   M16 P2/P3/P4 parity code (confirmed by a repo-wide search before writing this), so this is a fresh
 *   field modelled on that one precedent, not a value this piece invented from nothing.
 * - `verdict`/`reason`: the overall verdict (one of all nine `13` F-TEST-9 names, never a paraphrase of
 *   one), and the check's OWN reason where the check itself stopped before any declaration's result
 *   could count (`no-declarations`, or a free-text `oracle-changed: <path>, ...`-shaped message) —
 *   this is unrelated to any one declaration's own `reason` field below, checked separately.
 * - `declarations`: in order of `name` (enforced below — `13` F-TEST-9's own stated order), each entry
 *   holding the declaration's `name` and `digest` (P2's `computeParityDeclarationDigest` output),
 *   `reference.ref`/`reference.sha` and `platform`, `captureDigest` (the sha256 of the SELECTED
 *   capture's own canonical bytes — `capture.ts`'s `captureFileName`/`serialiseCapture`, deliberately
 *   distinct from this entry's own `digest`, which is the DECLARATION's digest the capture itself also
 *   carries), the declaration's own `verdict`/`reason`, its `cases` (surface, case index, verdict and
 *   a content hash ONLY — never observed content, enforced structurally, see below) and `exemptCount`.
 *
 * **The content-hash-only guarantee is structural, not a convention.** A case entry's only fields are
 * `surface`, `caseIndex`, `verdict` and an OPTIONAL `contentHash` constrained to exactly 64 lower-case
 * hex digits (a sha256 hex digest) — there is no field shaped to hold a string of arbitrary length or
 * content, so a writer that tried to put raw observed text into `contentHash` fails validation at the
 * type's own boundary (the text would not match the hex-digest pattern), not merely violate an
 * unenforced naming convention. This mirrors `compare.ts`'s own `CaseComparisonResult`, which likewise
 * has no field that could hold observed content (`13` F-TEST-9's own information boundary, enforced at
 * the type level there too) — `contentHash` is optional because `compare.ts`'s own result carries no
 * hash at all for any verdict (only a verdict, and for `mismatch`, a structural *location*, never
 * content), so a writer that cannot yet derive a meaningful hash for every verdict (nothing calls this
 * type yet — P7 is the first real writer) is not forced to invent one.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see specs/18-persistence-config-and-schemas.md §18.7
 * @see process/plans/PLAN-M16.md P5
 * @see process/SPEC-QUESTIONS.md Q294 Decision 3/A3, Decision 5/A4, Decision 9, Decision 10
 */
import { z } from 'zod';

import { baseFrontMatterShape, checkIdMatchesRegisteredType } from '../registry/front-matter.ts';

/** A sha256 hex digest: 64 lower-case hex digits. `digest`/`captureDigest`/`deltaDigest`/
 * `contentHash` below all share this shape — every one of them is a `node:crypto` `sha256` digest,
 * hex-encoded, never a different algorithm or a different encoding. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

/** A full, lower-case commit sha: 40 hex digits in a SHA-1 repository, 64 in a SHA-256 one — the
 * identical digit-count rule `13` F-TEST-9's trust anchor and `reference.ref` exactness checks both
 * enforce (`process/SPEC-QUESTIONS.md` Q294 Decision 3). Never an abbreviation or an upper-case
 * spelling: both are refused by the real resolver before a value would ever reach this type. */
const COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** `<os>-<arch>`, as the harness's own Node runtime reports it (`darwin-arm64`, `linux-x64` — `13`
 * F-TEST-9: "not the agent platform of `07`"). Lower-case ASCII letters/digits on each side of exactly
 * one hyphen; this schema does not hard-code the closed `process.platform`/`process.arch` value sets,
 * matching how the real capture writer records whatever the running Node reports. */
const PLATFORM_PATTERN = /^[a-z0-9]+-[a-z0-9]+$/;

/** The four verdicts decided about a declaration BEFORE any of its cases run (`13` F-TEST-9) — copied
 * verbatim from `packages/cli/src/commands/parity/counting.ts`'s own `DeclarationStopVerdict`/
 * `DECLARATION_STOP_PRECEDENCE` (see this module's own file header for why this is a copy, not an
 * import). Used below only for the runtime "did this declaration run any case" check — the full nine-
 * member set a `verdict` field itself accepts is written inline at each `z.enum(...)` call, the
 * identical "no shared const, write the literal" convention `evidence-bundle.ts`'s own
 * `evidenceReviewSchema`/`evidenceGateSchema` already use for a `z.enum`, since a `readonly` tuple
 * `const` is not assignable to the mutable-tuple generic `z.enum` expects in this codebase's zod
 * version (`front-matter.ts`'s own `ARTIFACT_TYPE_IDS` drops `readonly` with an explicit cast for the
 * identical reason). */
const DECLARATION_STOP_VERDICTS = ['invalid', 'expired', 'missing', 'ambiguous'] as const;

/** `13` F-TEST-9's full nine-verdict total order, worst first — copied verbatim from `counting.ts`'s
 * own `[...DECLARATION_STOP_PRECEDENCE, ...CASE_VERDICT_PRECEDENCE]` (the exact spread
 * `countParityResults`'s own `worstBy` call uses to reduce a declaration's verdict from its
 * declarations', and the identical total order `countDeclaration` uses to reduce a declaration's
 * verdict from its cases'). Round-2 critics (two independent) found this schema accepted a
 * `verdict`/`cases`-or-`declarations` combination the real algebra can never produce (a `match`
 * declaration whose own cases include a `mismatch`; an overall verdict that is not the worst of its
 * declarations', in either direction) -- `worstOf` below and its two call sites close that. */
const PARITY_VERDICT_PRECEDENCE = [
  'invalid',
  'expired',
  'missing',
  'ambiguous',
  'error',
  'unclean',
  'unstable',
  'mismatch',
  'match',
] as const;

/** Reduces `verdicts` to the single worst one by `PARITY_VERDICT_PRECEDENCE`, mirroring `counting.ts`'s
 * own `worstBy` exactly (first-match-wins over the precedence list, worst first). Returns `undefined`
 * for an empty list -- both call sites below only call this when the list is non-empty, and check that
 * themselves first, so `undefined` here would mean this schema's own precedence list is missing a
 * value `verdicts` actually holds, a bug in this module rather than a fact about `verdicts`. */
function worstOf(verdicts: readonly string[]): string | undefined {
  for (const candidate of PARITY_VERDICT_PRECEDENCE) {
    if (verdicts.includes(candidate)) return candidate;
  }
  return undefined;
}

const referenceSchema = z
  .object({
    ref: z.string().min(1),
    sha: z.string().regex(COMMIT_SHA),
  })
  .strict();

const caseEntrySchema = z
  .object({
    surface: z.enum(['process', 'file', 'library', 'http']),
    caseIndex: z.number().int().min(0),
    verdict: z.enum(['error', 'unclean', 'unstable', 'mismatch', 'match']),
    contentHash: z.string().regex(SHA256_HEX).optional(),
  })
  .strict();

const declarationEntrySchema = z
  .object({
    name: z.string().min(1),
    digest: z.string().regex(SHA256_HEX),
    reference: referenceSchema,
    platform: z.string().regex(PLATFORM_PATTERN),
    captureDigest: z.string().regex(SHA256_HEX),
    verdict: z.enum([
      'invalid',
      'expired',
      'missing',
      'ambiguous',
      'error',
      'unclean',
      'unstable',
      'mismatch',
      'match',
    ]),
    reason: z.string().min(1).optional(),
    cases: z.array(caseEntrySchema),
    // `13` F-TEST-9 names exactly four surfaces (process/file/library/http); one declaration can
    // therefore never exempt more than four, the ceiling a round-2 critic found this schema did not
    // enforce at all (`exemptCount: 1_000_000` was accepted).
    exemptCount: z.number().int().min(0).max(4),
  })
  .strict()
  .superRefine((entry, ctx) => {
    // Sound: every member of `DECLARATION_STOP_VERDICTS` is itself one of `entry.verdict`'s own nine
    // literal members, so widening the LHS to `readonly string[]` only drops type information
    // `.includes` does not need -- it does not change which runtime strings this test can match,
    // and `entry.verdict` must likewise widen to line up with that widened element type.
    const stopped = (DECLARATION_STOP_VERDICTS as readonly string[]).includes(entry.verdict);
    if (stopped && entry.cases.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cases'],
        message: `declaration "${entry.name}" is stopped (verdict "${entry.verdict}") but carries ${String(entry.cases.length)} case(s); a stopped declaration never ran one (13 F-TEST-9).`,
      });
    }
    if (!stopped && entry.cases.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cases'],
        message: `declaration "${entry.name}" has verdict "${entry.verdict}" but no cases; every declaration that was not stopped runs at least one (13 F-TEST-9).`,
      });
    }
    // Round-2 critics (two independent): a declaration's own `verdict` must be the precedence-worst
    // of its own `cases`' verdicts (`13` F-TEST-9: "the same order picks a declaration's verdict from
    // its cases' verdicts") -- a `match` declaration whose cases include a `mismatch` was accepted
    // before this check existed.
    if (entry.cases.length > 0) {
      const worst = worstOf(entry.cases.map((caseEntry) => caseEntry.verdict));
      if (worst !== undefined && worst !== entry.verdict) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['verdict'],
          message: `declaration "${entry.name}" has verdict "${entry.verdict}" but the worst of its own cases' verdicts is "${worst}" -- 13 F-TEST-9: a declaration's verdict is the precedence-worst of its cases'.`,
        });
      }
    }
    if (entry.verdict === 'match' && entry.reason !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: `declaration "${entry.name}" matched but carries a "reason" -- 13 F-TEST-9 gives one only where the verdict is not "match".`,
      });
    }
    if (entry.verdict !== 'match' && entry.reason === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: `declaration "${entry.name}" has verdict "${entry.verdict}" but no "reason" -- 13 F-TEST-9 requires one wherever the verdict is not "match".`,
      });
    }
    // Round-2 critic: `exemptCount` plus the surfaces this declaration actually observed can never
    // exceed the four `13` F-TEST-9 defines, since every surface is either observed (has a case) or
    // exempt, never both and never a fifth kind.
    const observedSurfaces = new Set(entry.cases.map((caseEntry) => caseEntry.surface)).size;
    if (entry.exemptCount + observedSurfaces > 4) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['exemptCount'],
        message: `declaration "${entry.name}" claims ${String(entry.exemptCount)} exempt surface(s) plus ${String(observedSurfaces)} observed one(s) -- 13 F-TEST-9 names only four surfaces in total.`,
      });
    }
  });

export const parityEvidenceSchema = baseFrontMatterShape
  .extend({
    type: z.literal('ParityEvidence'),
    story: z.string().min(1).optional(),
    trusted: z.string().regex(COMMIT_SHA).nullable(),
    headSha: z.string().regex(COMMIT_SHA),
    dirty: z.boolean(),
    deltaDigest: z.string().regex(SHA256_HEX),
    toolVersions: z.record(z.string(), z.string()),
    verdict: z.enum([
      'invalid',
      'expired',
      'missing',
      'ambiguous',
      'error',
      'unclean',
      'unstable',
      'mismatch',
      'match',
    ]),
    reason: z.string().min(1).optional(),
    declarations: z.array(declarationEntrySchema),
  })
  .strict()
  .superRefine(checkIdMatchesRegisteredType)
  .superRefine((data, ctx) => {
    // `13` F-TEST-9: "A check with no declaration at all counts one failing and no passing, and its
    // overall verdict is `invalid` with the reason `no-declarations`" -- checked in BOTH directions.
    // The first direction (declarations non-empty despite reason "no-declarations") was already
    // checked; round-2 critics (two independent) found the REVERSE direction unchecked, so
    // `{declarations: [], verdict: 'match'}` was accepted.
    if (data.declarations.length === 0) {
      if (data.verdict !== 'invalid' || data.reason !== 'no-declarations') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['verdict'],
          message: `declarations is empty, which 13 F-TEST-9 states reads verdict "invalid" with reason "no-declarations"; got verdict "${data.verdict}" and reason ${JSON.stringify(data.reason ?? null)}.`,
        });
      }
    } else if (data.reason === 'no-declarations') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['declarations'],
        message: 'reason is "no-declarations" but declarations is non-empty.',
      });
    }
    // Round-2 critics (two independent): the overall `verdict` must be the precedence-worst of the
    // declarations' own verdicts, in EITHER direction (`13` F-TEST-9: "the same order picks... a
    // record's overall verdict from its declarations'") -- an overall `match` beside a sole `invalid`
    // declaration, and the exact reverse (overall `mismatch` beside a sole `match` declaration), were
    // both accepted before this check existed.
    if (data.declarations.length > 0) {
      const worst = worstOf(data.declarations.map((declaration) => declaration.verdict));
      if (worst !== undefined && worst !== data.verdict) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['verdict'],
          message: `verdict is "${data.verdict}" but the worst of the declarations' own verdicts is "${worst}" -- 13 F-TEST-9: the overall verdict is the precedence-worst of the declarations'.`,
        });
      }
    }
    for (let index = 1; index < data.declarations.length; index += 1) {
      const previous = data.declarations[index - 1];
      const current = data.declarations[index];
      if (previous !== undefined && current !== undefined && previous.name >= current.name) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['declarations', index],
          message: `declarations must be strictly ordered by name ("${previous.name}" is not before "${current.name}").`,
        });
      }
    }
  });

export type ParityEvidence = z.infer<typeof parityEvidenceSchema>;
