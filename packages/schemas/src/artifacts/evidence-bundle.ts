/**
 * `evidenceBundleSchema` — `PLAN-M15.md` P7's own Mandate, made real: "binding evidence, test
 * results, coverage delta, every `ReviewReport` verdict ..., gate outcomes, exemptions in force, and
 * real cost." `P2`'s own placeholder version of this file (`SPEC-QUESTIONS.md` Q280 Decision 3) is
 * superseded here, the identical way `ReviewReport`'s own `verdict` field was added by a later piece
 * than the one that first registered the type.
 *
 * Every field below is REAL data this piece's own assembly function (`packages/cli/src/commands/
 * loop/test/evidence-bundle.ts`) gathers from already-shipped machinery — nothing here invents a new
 * source of truth:
 *
 * - `story`: the identical loose cross-reference shape `mutationEvidenceSchema`'s own `story` field
 *   already uses — not re-validated against the base `id` regex, since it names a DIFFERENT
 *   artifact's id.
 * - `verify`: this story's own most recent `done`-phase `StoryVerifyReport` (`commands/story.ts`),
 *   re-run fresh at assembly time rather than read from a prior, possibly-stale write — `done-check`
 *   always runs immediately before `evidence` in `implement-story.workflow.yaml`, so re-running it
 *   costs nothing beyond what the workflow already paid once. `checks` requires at least one entry:
 *   a DoD profile with zero checks for the `done` phase is not a real verification, the identical
 *   stance `StoryVerifyReport.passed`'s own doc comment already takes ("a profile with no checks for
 *   this phase is not a pass").
 * - `coverage`: `testCoverage`'s own already-built, honest signals — `rule: 'acceptance-criteria'` for
 *   `acCoveragePercent`/`missingAcIds`, `rule: 'ratchet'` for `ratchetRegressions` — combined rather
 *   than a genuine before/after diff invented from scratch, since no such mechanism exists anywhere in
 *   this codebase (confirmed by direct search before writing this). `problems`, when present, names
 *   every real reason either call could not fully complete (`TestCoverageResult.problems`) — coverage
 *   tooling is not configured in every project, and that is reported honestly, not treated as a
 *   missing required kind (unlike `verify`/`reviews` below, no upstream workflow step guarantees
 *   coverage data exists by the time `evidence` runs). Deliberately NOT scoped to this story, the
 *   identical disclosed-v1 shape `gates` below is — `runAcceptanceCriteriaCoverage` (`loop/test/
 *   coverage.ts`) computes `acIds`/`missingAcIds` over EVERY `status: 'done'` story in the project
 *   (confirmed directly against its own source), and no story-scoped variant exists; the story this
 *   bundle is FOR is typically not even `'done'` yet at the moment `evidence` runs (nothing in
 *   `implement-story.workflow.yaml` sets it), so in practice `coverage` almost always describes OTHER,
 *   already-`done` stories' acceptance criteria, not this one's — caught by a gauntlet critic round
 *   after this field shipped with no disclosure of that fact. A genuinely story-scoped AC-coverage
 *   signal would need `runAcceptanceCriteriaCoverage` itself to accept a story filter, a change to
 *   shared coverage machinery `G-Verify`'s own gate check also depends on — out of this piece's own
 *   Surface, not attempted here rather than half-built; named for a later piece.
 * - `bindingEvidence`: the ids of every `MutationEvidence` artifact already on disk for this story
 *   (`reports/mutation/{story}-*.md`, the registered path template) — a reference list, not a copy of
 *   their content, the identical "references a set of evidence artifacts" framing `P2`'s own
 *   placeholder doc comment already used. `forge test binding` is a separate, standalone verb with no
 *   step of its own in `implement-story.workflow.yaml`; an empty array is a story that never ran it,
 *   not a failure.
 * - `reviews`: every `ReviewReport` this RUN's own event log (`@forge/telemetry/events`) recorded via
 *   an `ArtifactCreated` event whose `stepId` matches `implement-story`'s own compiled `review` step id
 *   (`compileStepId('implement-story', 'review')`, `06` §6.2 — the BARE two-argument form: `implement-
 *   story` is never a fanout target or a subworkflow anywhere in this codebase, confirmed directly, so
 *   it always runs standalone, one story per `forge run`, and `runId` alone already scopes this run's
 *   event log to the one story it concerns — no per-story `itemKey` qualification exists or is needed;
 *   an earlier version of this comment, and of the real assembly code, both wrongly assumed one, caught
 *   by a gauntlet critic round) — never a project-wide scan, which would pull in another story's
 *   reviews with no way to tell them apart (`ReviewReport`'s own path, `sessions/reviews/{id}.md`,
 *   carries no story reference at all, confirmed by direct inspection of its registry entry before
 *   writing this). Requires at least one entry, and every entry's `verdict` must be `concerns` or
 *   `clear` — the only two verdicts the real engine ever lands at a merge
 *   (`resolveSwarmReviewLanding`, `packages/engine/src/dispatch/steps.ts`: a `blocked` OR `incomplete`
 *   verdict both refuse with `MERGE-REVIEW-INCOMPLETE`, treated identically). `blocked` already fails
 *   the review step itself (`onFailure: escalate`) so it rarely reaches assembly at all, but
 *   `incomplete` does NOT fail the step — an ordinary reviewer-session hiccup lets the DAG proceed
 *   through `document`/`done-check`/`evidence`/`commit` with no error, so a story genuinely reaching
 *   assembly with zero recorded reviews, an undefined verdict, or a `blocked`/`incomplete` one, means
 *   the evidence could not be gathered as real, mergeable evidence — not that none exists. `GATE-516`
 *   refuses the whole write rather than committing a bundle for a story that was always going to be
 *   refused at the merge this bundle is itself evidence for (`PLAN-M15.md` P7's own "Mutation
 *   evidence": "Omit the review verdict: the required-kind test fails" — an earlier version of this
 *   check only matched that one literal example and missed the `incomplete` case, caught by a gauntlet
 *   critic round).
 * - `gates`: the single most recent `GateReport` per gate name, project-wide (`reports/gates/*.md`) —
 *   deliberately NOT scoped to this story. `GateReport`'s own registered path
 *   (`reports/gates/{gate}-{ts}.md`) carries no story reference and no gate in
 *   `implement-story.workflow.yaml` runs per-story at all (gates are a stage/run-level checkpoint,
 *   confirmed by direct inspection of the real workflow file before writing this) — a disclosed v1
 *   simplification, not an oversight: this is the current state of the project's gates AT THE TIME
 *   this story's evidence was assembled, offered as accompanying context, not a claim that any gate
 *   evaluated this specific story.
 * - `exemptions`: the ids of every currently-declared `Exemption` (`loadExemptions`, M15 P6) whose own
 *   `testId` is qualified under this story (`qualifiedTestId`'s own `"<storyId>: <testName>"` shape) —
 *   an empty array is a story with nothing exempted, the ordinary case, not a failure.
 * - `cost`: `attributedSpend` (`@forge/telemetry/ledger`) summed across this story's own known step
 *   ids (`plan`/`red`/`green`/`refactor`/`self-verify`/`review`/`document`/`done-check`/`evidence`),
 *   each the BARE `compileStepId('implement-story', stepId)` — exact, not approximate, for the
 *   identical reason `reviews` above is: `implement-story` always runs standalone, one story per
 *   `forge run`, so `runId` alone (never a per-story `itemKey`) already isolates this run's own
 *   `UsageRecorded` events from any other run's identically-named steps. `estimated` is
 *   `true` if ANY contributing ledger entry was itself estimated (every real adapter this codebase can
 *   construct today reports `estimated: true` unconditionally, `packages/engine/src/dispatch/
 *   steps.ts`), so this is `true` in every real run today, not a vestigial field. `problems`, when
 *   present, names why cost could not be computed (`FORGE_RUN_ID` absent from the environment — a
 *   story evidenced by a hand run outside any real workflow run has no event log to sum).
 * - `assembledAt`: the real instant assembly ran, the identical `ranAt`/`evaluatedAt` pattern
 *   `mutationEvidenceSchema`/`gateReportSchema` already establish.
 *
 * Genuinely append-only (`specs/18` §18.7, `08` §8.3/§8.4's real "superseded" meaning): every
 * assembly gets its own, newly-allocated `EVID-###` id and its own file
 * (`reports/evidence/{id}-{story}.md`, never a second write to an existing path — `writeNewFileAtomic`,
 * `RUN-114`, the identical primitive `mutationEvidenceSchema`'s own writer uses).
 *
 * @see specs/18-persistence-config-and-schemas.md §18.7
 * @see PLAN-M15.md P2, P7
 * @see SPEC-QUESTIONS.md Q280, Q286
 */
import { z } from 'zod';

import { baseFrontMatterShape, checkIdMatchesRegisteredType } from '../registry/front-matter.ts';

const storyCheckSchema = z
  .object({
    check: z.string().min(1),
    status: z.enum(['pass', 'fail', 'unverifiable']),
    message: z.string(),
  })
  .strict();

const evidenceReviewSchema = z
  .object({
    id: z.string().min(1),
    verdict: z.enum(['blocked', 'incomplete', 'concerns', 'clear']).optional(),
  })
  .strict();

const evidenceGateSchema = z
  .object({
    id: z.string().min(1),
    gate: z.string().min(1),
    outcome: z.enum(['passed', 'failed', 'waived']).optional(),
  })
  .strict();

export const evidenceBundleSchema = baseFrontMatterShape
  .extend({
    type: z.literal('EvidenceBundle'),
    story: z.string().min(1),
    verify: z
      .object({
        phase: z.enum(['verify', 'done']),
        passed: z.boolean(),
        errors: z.number().int().min(0),
        checks: z.array(storyCheckSchema).min(1),
      })
      .strict(),
    coverage: z
      .object({
        acCoveragePercent: z.number().min(0).max(100),
        ratchetRegressions: z.number().int().min(0),
        missingAcIds: z.array(z.string().min(1)).optional(),
        problems: z.array(z.string().min(1)).optional(),
      })
      .strict(),
    bindingEvidence: z.array(z.string().min(1)),
    reviews: z.array(evidenceReviewSchema).min(1),
    gates: z.array(evidenceGateSchema),
    exemptions: z.array(z.string().min(1)),
    cost: z
      .object({
        totalUsd: z.number().min(0),
        estimated: z.boolean(),
        problems: z.array(z.string().min(1)).optional(),
      })
      .strict(),
    assembledAt: z.string().datetime(),
  })
  .strict()
  .superRefine(checkIdMatchesRegisteredType)
  .superRefine((data, ctx) => {
    const missingVerdict = data.reviews.find((review) => review.verdict === undefined);
    if (missingVerdict !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reviews'],
        message: `review ${missingVerdict.id} has no verdict recorded -- an EvidenceBundle cannot reference an unverdicted review.`,
      });
    }
  });

export type EvidenceBundle = z.infer<typeof evidenceBundleSchema>;
