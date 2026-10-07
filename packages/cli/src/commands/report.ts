/**
 * `forge report`/`forge report --baseline` -- `specs/22` M15 P12: a pure projection of M15 P11's own
 * real telemetry (`PLAN-M15.md` P11, already landed) into the milestone's own scorecard, so a later
 * milestone can ask "did this help?" against a real captured number instead of memory. This module
 * reads; it never judges or aggregates beyond counting and summing what the event log already says --
 * whether a number here is "good" is explicitly a later piece's job (`PLAN-M15.md` P12's own Mandate:
 * "Discloses: a scorecard invites gaming; that is the point of M17 measuring on a project FORGE did
 * not build.").
 *
 * **State metrics vs. occurrence metrics** -- the concrete resolution of the Mandate's own named
 * mutation ("compute the rate over attempts rather than stories: the exact-numbers test fails"):
 *
 * - Metric 1 (binding pass rate / non-binding count per story) is a STATE metric. A story can be
 *   `CheckRun{kind:'binding'}`-checked more than once, across separate real `forge run` invocations
 *   (different `runId`s, different event logs) -- it fails twice during iteration, passes on the third
 *   real check, say. The correct rate is "fraction of stories CURRENTLY passing," not "fraction of all
 *   CheckRun occurrences that passed" (the latter is the exact bug the Mandate's own mutation evidence
 *   names). `latestBindingStateByStory` concatenates every real `CheckRun{kind:'binding'}` event across
 *   every run, groups by `storyId`, and keeps only each story's chronologically LATEST occurrence
 *   (`ts`, not `seq` -- `seq` is only run-local, never comparable across two different runs' own event
 *   logs).
 * - Metrics 4a (exemptions opened), 2 (critic rounds consumed, stop-and-disclose occurrences) are
 *   OCCURRENCE metrics -- every real event is counted, no dedup. A story whose critic loop exhausts in
 *   one run and is retried in a later run is two real occurrences, not one; a real exemption
 *   declaration is a real, independent fact each time.
 * - Metric 4b (exemptions expired) sits in between: derived from metric 1's own already-collected
 *   events (`CheckRun{kind:'binding'}.payload.expiredExemptionIds`, when present -- a real check
 *   DISCOVERING a stale exemption, not a separate proactive watcher this piece would have to invent),
 *   but deduplicated by exemption id: an exemption discovered expired by two separate checks is one
 *   real expired exemption, not two.
 *
 * **Disclosed, known gap in metric 1's own "passing" definition.** The real CLI command
 * (`story.ts`'s `checkBinding`) fails a story for either of two reasons: an uncovered non-binding test
 * (`application.nonBinding.length > 0`, i.e. `nonBinding - exempted > 0` on the emitted payload) OR a
 * STALE exemption (`application.staleExemptions`, `describeExemptionProblems`). `CheckRun{kind:
 * 'binding'}`'s own payload carries `expiredExemptionIds` but NOT a stale-exemption signal -- P11 never
 * emitted one. This projector's own "passing" therefore approximates the real command's full verdict
 * (`nonBinding - exempted === 0`) and is STRICTLY LOOSER than it: a story the real CLI would fail for a
 * stale exemption can still be counted "passing" here. A real, disclosed scope gap (P11's own event
 * shape is outside this piece's Surface to extend), not a silent inaccuracy -- a future piece widening
 * `CheckRun{kind:'binding'}`'s own payload to also carry stale-exemption ids would close this exactly.
 *
 * **Metric 3 (gate failures before first pass, per gate/check) is scoped per `(runId, gateId)` pair,
 * not project-wide-ever-per-gate-id.** The same gate id is legitimately re-evaluated fresh in every new
 * real run (`G-Verify` once per story's own verify phase, say) -- collapsing every run's own attempts
 * into one global "time to first-ever pass" per gate id would conflate genuinely different real
 * attempts into one number. `GateRejected` (not `GateEvaluated.passed === false`) is the actual
 * "failure" signal counted: `GateEvaluated` only ever fires from the engine's own automatic gate step
 * (`dispatch/steps.ts`'s `runGateStep`), but a human's own `forge gate reject` (`gate-commands.ts`'s
 * `gateReject`) emits a real `GateRejected` with no accompanying `GateEvaluated` at all -- counting only
 * `GateEvaluated.passed === false` would silently miss every human-driven rejection. `GateApproved` and
 * `GateWaived` both count as reaching "first pass": a waiver is a real, deliberate way a gate becomes
 * satisfied, not a different outcome this metric should treat as still-failing.
 *
 * **Metric 5 (real cost per delivered story) sums every tagged `UsageRecorded` event's own `costUsd`
 * directly -- it is NOT `@forge/telemetry/ledger`'s own `attributedSpend`.** `attributedSpend` is a
 * different, per-STEP retry-collapsing view built for `03` §3.2.8's cost-ceiling use case; reusing it
 * here would silently produce a different number than "real cost including any wasted retries," which
 * is what "real cost per delivered story" means. Read directly off raw `ForgeEvent`s, not via
 * `projectLedger`/`toLedgerEntry`: those throw (`TELEMETRY-LEDGER-MALFORMED-USAGE-EVENT`) on any
 * `UsageRecorded` event missing a `stepId`/`agentId` -- too strict for a forward-compatible projector
 * that must skip, never crash on, an event shape it does not fully recognise (see below).
 *
 * **Metric 6 (KB reads preceding a decision artifact) -- disclosed: within `packages/engine/src`,
 * `ArtifactCreated` is, as of this piece, emitted ONLY by `swarm-review-step.ts`, only for
 * `ReviewReport` artifacts** (confirmed by grep: zero other real call sites anywhere in
 * `packages/engine/src`, and `ArtifactUpdated`/`ArtifactValidated`/`ArtifactRejected` are emitted
 * nowhere at all in this codebase today). A second, real `ArtifactCreated` call site exists OUTSIDE
 * `packages/engine/src` -- `packages/agents/src/handoff/emit-handoff.ts`'s `emitHandoff`, for a
 * `HandoffRecord` payload -- but is, as of this piece, genuinely unreachable in any real run: its own
 * only real caller would be `ForgeMcpBackend.handoff`, which (like the rest of that interface, `specs/22`
 * M15 P11's own disclosure in `forge-mcp/backend.ts`) has zero real implementations anywhere, and no
 * `ParsedControlToken`/`FORGE_HANDOFF` consumer exists in `packages/engine/src` either -- so this metric's
 * own code is correctly generic (it filters on `event.type === 'ArtifactCreated'` alone, never on a
 * payload's own `type` field), and would pick up `emitHandoff`'s own events automatically and correctly
 * the moment that path is ever wired up for real, with no change needed here. "Every real
 * `ArtifactCreated` event counts as a decision artifact" is the literal,
 * unnarrowed reading of the Mandate's own text (this codebase has no narrower "decision artifact"
 * concept to borrow), but in a REAL project today this metric's own real denominator will, in practice,
 * almost always be "every `ReviewReport`" -- an ADR, a spec, a story, an `EvidenceBundle`, a
 * `Disclosure` never shows up here at all, since the engine never emits `ArtifactCreated` for any of
 * them (the P7 output-contract check that validates a step's declared `outputs` folds its verdict into
 * `StepSucceeded`/`StepFailed` directly, with no dedicated artifact event). This is a genuine,
 * surprising, real scope gap in what this metric can measure TODAY -- not a defect in this piece, but
 * worth a prominent flag for whoever next extends the `Artifact*` event group to fire for ordinary
 * step outputs, since that is the one change that would make this metric's own denominator reflect
 * "every decision artifact" rather than "every review." Correlation itself: for each `ArtifactCreated`
 * event, this reads whether any `SessionEvent{kind:'kb-read'}` with the SAME `stepId`, in the SAME run,
 * occurred at a strictly earlier `seq` (both share one run's own event log here, so `seq` -- unlike
 * metric 1's cross-run case above -- IS safely comparable).
 *
 * **Forward compatibility** (the Mandate's own second named mutation: "silently drop unknown event
 * kinds: the forward-compatibility test fails"): every `kind:`/`code:`-tagged payload this module reads
 * is checked against a real, explicit recognized value before being counted into any bucket -- never an
 * untagged `if/else` chain whose final `else` would silently misclassify a genuinely new, future `kind`
 * value as whichever branch happens to be the fallback. An event this module does not recognise is
 * skipped, not miscounted and not fatal to the rest of the read.
 *
 * **`--baseline`: a plain tracked file, not a new git-commit mechanism.** Investigated directly before
 * deciding this: zero real CLI command writers in this codebase (`EvidenceBundle`, `Exemption`,
 * `Disclosure`, `GateReport`) ever issue a real `git commit` themselves -- each writes a plain tracked
 * file and leaves the actual commit to a human, or (for a per-story artifact like `EvidenceBundle`) to
 * the engine's own lane-commit machinery, which is architecturally scoped to one story's lane and does
 * not fit a project-wide, cross-story command like this one. `forge report --baseline` writes a plain
 * tracked file (`writeFileAtomic`, a single well-known path, OVERWRITTEN in place on every call -- "a
 * baseline," singular, the one reference point a later milestone compares against, not an
 * append-only collection) whose own front matter names the real commit it was captured at
 * (`resolveHeadShaOrUndefined`, `@forge/vcs`) and a real `capturedAt` (from the injected `Clock`, never
 * `Date.now()` directly -- this codebase's own determinism discipline). This `commit:` field is the
 * real, literal substance of "committed with trailers" this piece can honestly test: not that this
 * piece makes a git commit, but that the snapshot's own provenance names the real commit it was
 * captured at, so a human committing it afterward (or a reader comparing it later) has real, verifiable
 * grounding, not a bare timestamp.
 *
 * @see specs/22 M15 P12
 * @see PLAN-M15.md P11
 * @see PLAN-M15.md P12
 *
 * **`specs/22` M16 P15 addendum.** Two new, fully ADDITIVE metrics ride this same projection:
 * `parity` (every real `CheckRun{kind:'parity'}` occurrence) and `hunks` (the optional hunk-mode
 * fields M16 P15 adds to the EXISTING `CheckRun{kind:'binding'}` payload, read here as one more
 * optional group on `RecognizedBindingPayload`, exactly like `expiredExemptionIds` already is).
 * Both are OCCURRENCE metrics (`ExemptionMetric.opened`'s own "every real event is counted, no dedup"
 * stance), never a STATE metric keyed by story the way `BindingMetric` is: a parity check has no
 * per-story subject in general (Decision 5's own shared `project` literal), and a later PLAIN
 * `forge test binding` run for a story that was once checked with `--hunks` is a separate, later real
 * fact about ordinary pass/fail state, never a reason to retroactively erase an earlier real hunk-mode
 * investigation's own findings.
 *
 * **Golden compatibility (`18` §18.4's payload-versioning rule, pinned by P1 and this piece).** Both
 * `MilestoneScorecard.parity`/`.hunks` are OPTIONAL fields, present if and only if this project has at
 * least one real occurrence to report (`checksRun > 0`) — never present as an all-zero object. A
 * pre-M16 event log (no `CheckRun{kind:'parity'}` event, no binding payload carrying a hunk field)
 * therefore produces the IDENTICAL `MilestoneScorecard` object, and so the identical `--json` string
 * and the identical human-text rendering (`bin.ts`'s own `runReportCommand`), that the pre-M16 code
 * produced for that same log — never merely the same TEXT with an extra always-present `"parity":
 * {...}`/`"hunks": {...}` key silently added to the JSON. `report.test.ts`'s own golden test proves
 * this at the data level; `bin.test.ts`'s own proves it at the rendered-text level.
 *
 * @see specs/22 M16 P15
 */
import type { Clock } from '@forge/core';
import { ForgeError } from '@forge/core/errors';
import { pathExists, readTextFile, writeFileAtomic, type ProjectPaths } from '@forge/core/fs';
import { resolveHeadShaOrUndefined } from '@forge/vcs';
import { readEvents, type ForgeEvent } from '@forge/telemetry/events';
import * as YAML from 'yaml';

import { listRunIds } from './run-ids.ts';

export interface ReportCommandContext {
  readonly paths: ProjectPaths;
  readonly projectRoot: string;
  readonly reportsRoot: string;
  readonly clock: Clock;
}

export interface ReportOptions {
  /** Only events at or after this instant are projected. `undefined` means no cutoff -- every real
   * event this project has ever logged. */
  readonly since?: Date;
}

export interface StoryBindingState {
  readonly storyId: string;
  readonly testsNamed: number;
  readonly bound: number;
  readonly nonBinding: number;
  readonly exempted: number;
  /** `nonBinding - exempted === 0` -- see this module's own top doc comment for the disclosed gap
   * against the real CLI's fuller (stale-exemption-aware) verdict. */
  readonly passing: boolean;
}

export interface BindingMetric {
  /** One entry per distinct `storyId` ever seen, each its own chronologically LATEST occurrence. */
  readonly stories: readonly StoryBindingState[];
  readonly passingCount: number;
  readonly totalCount: number;
  /** `0` (never `NaN`) when `totalCount` is `0`. */
  readonly passRate: number;
}

export interface CriticLoopMetric {
  /** Every real `StepProgress{kind:'critic-round'}` occurrence, across every run. */
  readonly roundsConsumed: number;
  /** Every real terminal `RUN-113` `StepFailed` occurrence, across every run. */
  readonly stopAndDiscloseCount: number;
}

export interface GateMetric {
  /** Distinct `(runId, gateId)` pairs with at least one real `GateRejected`/`GateApproved`/
   * `GateWaived` event. */
  readonly pairsEvaluated: number;
  /** Of those, how many reached `GateApproved`/`GateWaived` with zero `GateRejected` beforehand. */
  readonly pairsWithCleanFirstPass: number;
  /** Summed across every pair: every real `GateRejected` that occurred before that pair's own first
   * `GateApproved`/`GateWaived` (every rejection, if no pass has happened yet in the read window). */
  readonly totalRejectionsBeforeFirstPass: number;
}

export interface ExemptionMetric {
  /** Every real `CheckRun{kind:'exemption-declared'}` occurrence, across every run -- no dedup, each
   * is a real, independent declaration. */
  readonly opened: number;
  /** Distinct exemption ids any real binding check discovered expired -- deduplicated by id, since the
   * SAME exemption discovered expired by two separate checks is one real expired exemption. */
  readonly expiredIds: readonly string[];
}

export interface StoryCostMetric {
  readonly storyId: string;
  readonly totalUsd: number;
}

export interface CostMetric {
  /** One entry per distinct `storyId` any real `UsageRecorded` event ever named. */
  readonly byStory: readonly StoryCostMetric[];
  /** The sum of every entry in `byStory` -- real spend attributable to a specific story, NOT this
   * project's total spend (`forge cost`'s own job; most `UsageRecorded` events carry no `storyId` at
   * all -- `freeze-contracts`/`standup`/a non-story resolver session -- and are not counted here). */
  readonly totalUsd: number;
}

export interface KbReadMetric {
  /** Every real `ArtifactCreated` event read -- see this module's own top doc comment for the real,
   * disclosed gap in what this counts today. */
  readonly artifactsCreated: number;
  /** Of those, how many had at least one real `SessionEvent{kind:'kb-read'}` in the SAME step, in the
   * SAME run, at an earlier `seq`. */
  readonly precededByKbRead: number;
  /** `0` (never `NaN`) when `artifactsCreated` is `0`. */
  readonly rate: number;
}

export interface MilestoneScorecard {
  readonly v: 1;
  /** The real `--since` cutoff this report was generated with, ISO-8601, or `null` when none was
   * given -- echoed back so a `--json` consumer never has to guess which invocation produced a given
   * report, the identical shape `forge audit`'s own `AuditReport.since` already establishes. */
  readonly since: string | null;
  readonly binding: BindingMetric;
  readonly criticLoop: CriticLoopMetric;
  readonly gates: GateMetric;
  readonly exemptions: ExemptionMetric;
  readonly cost: CostMetric;
  readonly kbReads: KbReadMetric;
  /** `specs/22` M16 P15, additive -- omitted (never present as an all-zero object) when this project
   * has never run a real `forge parity check` with `FORGE_RUN_ID` set: see this module's own top doc
   * comment for the full golden-compatibility reasoning. */
  readonly parity?: ParityMetric;
  /** `specs/22` M16 P15, additive -- omitted under the identical rule `parity` above states, for a
   * project that has never run `forge test binding --hunks`. */
  readonly hunks?: HunkMetric;
}

/** The identical "an unparseable `ts` must never be silently excluded by a `--since` cutoff" stance
 * `@forge/telemetry/audit`'s own `queryAuditEvents`/`tsToComparableMs` already established and
 * gauntleted (a bare `NaN < sinceMs` is always `false`, so a naive comparison would silently let a
 * malformed-`ts` event bypass a filter meant to exclude old data) -- re-derived here as this module's
 * own small, local copy rather than importing a private helper outside this piece's Surface, matching
 * the shape exactly so the two stay in agreement by construction, not by convention alone. */
function tsToComparableMs(ts: string): number {
  const ms = new Date(ts).getTime();
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

/** A DELIBERATELY DIFFERENT sentinel from `tsToComparableMs` above, for a DIFFERENT question: "is this
 * occurrence the latest, therefore authoritative, state for its own story" (metric 1's own dedup), not
 * "should this event survive a `--since` cutoff." Reusing `tsToComparableMs`'s own `+Infinity` mapping
 * here would make a malformed `ts` incorrectly WIN that slot over every legitimately later, well-formed
 * occurrence — the opposite of the safe direction for THIS question, even though `+Infinity` is exactly
 * the safe direction for the `--since` one above. Mapped to `-Infinity` instead: a malformed-`ts`
 * occurrence can never be mistaken for a story's own current state. In real operation this is inert —
 * every real `ts` this codebase writes comes from an injected `Clock` (`check-telemetry.ts`'s own
 * `emitBindingCheckTelemetry`, `dispatch/facades.ts`'s `createTelemetryFacade`), never malformed — but a
 * hand-edited or corrupted event log is exactly the kind of input this piece's own forward-compatibility
 * discipline elsewhere already treats as a real, if rare, possibility to defend against, not assume away. */
function tsToComparableMsForDedup(ts: string): number {
  const ms = new Date(ts).getTime();
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/** Every real `ForgeEvent` across every real run this project has ever executed, optionally filtered to
 * `ts >= options.since`, in no particular cross-run order (each metric below sorts/groups whatever it
 * actually needs -- `seq` is only meaningfully ordered within one run's own log). */
async function allEvents(
  ctx: ReportCommandContext,
  options: ReportOptions,
): Promise<readonly ForgeEvent[]> {
  const sinceMs = options.since?.getTime();
  const runIds = await listRunIds(ctx.paths);
  const events: ForgeEvent[] = [];
  for (const runId of runIds) {
    for await (const event of readEvents(ctx.projectRoot, runId)) {
      if (sinceMs !== undefined && tsToComparableMs(event.ts) < sinceMs) continue;
      events.push(event);
    }
  }
  return events;
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/** `typeof value === 'object'` alone accepts an array, and `null` -- rejects both, the identical
 * `coverage.ts`'s own `isPlainObject` precedent (not imported: that one is module-private, outside
 * this piece's own Surface to reach into). */
function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface RecognizedBindingPayload {
  readonly storyId: string;
  readonly testsNamed: number;
  readonly bound: number;
  readonly nonBinding: number;
  readonly exempted: number;
  readonly expiredExemptionIds?: readonly string[];
  /** `specs/22` M16 P15, additive -- see {@link asHunkFields}. */
  readonly hunks?: RecognizedHunkFields;
}

/** `specs/22` M16 P15's own additive hunk-mode fields on the EXISTING `kind: 'binding'` payload
 * (`check-telemetry.ts`'s own `emitBindingCheckTelemetry`) -- present only when `forge test binding
 * --hunks` genuinely ran the hunk-mutation engine for that check, never the plain change-level check.
 * Read as one all-or-nothing group (the identical "never independently optional" stance
 * `emitBindingCheckTelemetry`'s own `hunkMutation` input field already takes): a payload carrying only
 * SOME of these six is forward-compatibility noise, not a future shape worth guessing at, so it is
 * treated exactly like a payload with none of them. */
interface RecognizedHunkFields {
  readonly granularity: 'hunk' | 'file' | 'change';
  readonly killedHunks: number;
  readonly uncoveredHunks: number;
  readonly invalidHunks: number;
  readonly timeoutHunks: number;
  readonly skippedHunks: number;
}

function asHunkFields(p: Readonly<Record<string, unknown>>): RecognizedHunkFields | undefined {
  const granularity = p['granularity'];
  if (granularity !== 'hunk' && granularity !== 'file' && granularity !== 'change') {
    return undefined;
  }
  if (
    !isFiniteNumber(p['killedHunks']) ||
    !isFiniteNumber(p['uncoveredHunks']) ||
    !isFiniteNumber(p['invalidHunks']) ||
    !isFiniteNumber(p['timeoutHunks']) ||
    !isFiniteNumber(p['skippedHunks'])
  ) {
    return undefined;
  }
  return {
    granularity,
    killedHunks: p['killedHunks'],
    uncoveredHunks: p['uncoveredHunks'],
    invalidHunks: p['invalidHunks'],
    timeoutHunks: p['timeoutHunks'],
    skippedHunks: p['skippedHunks'],
  };
}

/** `kind` is checked FIRST and explicitly -- never inferred from "has these fields" -- so a future,
 * differently-shaped `CheckRun` payload sharing some field names cannot be silently misread as this
 * one (the Mandate's own named forward-compatibility requirement). */
function asBindingPayload(payload: unknown): RecognizedBindingPayload | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const p = payload as Record<string, unknown>;
  if (p['kind'] !== 'binding') return undefined;
  if (
    !isNonBlankString(p['storyId']) ||
    !isFiniteNumber(p['testsNamed']) ||
    !isFiniteNumber(p['bound']) ||
    !isFiniteNumber(p['nonBinding']) ||
    !isFiniteNumber(p['exempted'])
  ) {
    return undefined;
  }
  const expiredExemptionIds = p['expiredExemptionIds'];
  const hunks = asHunkFields(p);
  return {
    storyId: p['storyId'],
    testsNamed: p['testsNamed'],
    bound: p['bound'],
    nonBinding: p['nonBinding'],
    exempted: p['exempted'],
    ...(isStringArray(expiredExemptionIds) ? { expiredExemptionIds } : {}),
    ...(hunks === undefined ? {} : { hunks }),
  };
}

export interface HunkMetric {
  /** Every real `CheckRun{kind:'binding'}` occurrence that carried real hunk-mode fields (`--hunks`
   * genuinely ran), across every run -- no dedup, the identical "every real event is counted" stance
   * `ExemptionMetric.opened` already establishes. */
  readonly checksRun: number;
  readonly killedHunks: number;
  readonly uncoveredHunks: number;
  readonly invalidHunks: number;
  readonly timeoutHunks: number;
  readonly skippedHunks: number;
}

function buildHunkMetric(events: readonly ForgeEvent[]): HunkMetric {
  let checksRun = 0;
  let killedHunks = 0;
  let uncoveredHunks = 0;
  let invalidHunks = 0;
  let timeoutHunks = 0;
  let skippedHunks = 0;
  for (const event of events) {
    if (event.type !== 'CheckRun') continue;
    const hunks = asBindingPayload(event.payload)?.hunks;
    if (hunks === undefined) continue;
    checksRun += 1;
    killedHunks += hunks.killedHunks;
    uncoveredHunks += hunks.uncoveredHunks;
    invalidHunks += hunks.invalidHunks;
    timeoutHunks += hunks.timeoutHunks;
    skippedHunks += hunks.skippedHunks;
  }
  return { checksRun, killedHunks, uncoveredHunks, invalidHunks, timeoutHunks, skippedHunks };
}

function isHunkMetric(value: unknown): value is HunkMetric {
  return (
    isPlainObject(value) &&
    isFiniteNumber(value['checksRun']) &&
    isFiniteNumber(value['killedHunks']) &&
    isFiniteNumber(value['uncoveredHunks']) &&
    isFiniteNumber(value['invalidHunks']) &&
    isFiniteNumber(value['timeoutHunks']) &&
    isFiniteNumber(value['skippedHunks'])
  );
}

/** `13` F-TEST-9's nine verdicts -- `report.ts`'s own independent copy of the shape
 * `parity/check-telemetry.ts`'s own `ParityVerdictCounts` already carries on the WRITE side: this
 * module validates an event payload's `unknown` shape on its own terms (Decision 10: "the contract
 * lives in... these tests"), the identical independence `RecognizedBindingPayload` already keeps from
 * `BindingCheckTelemetryInput` -- never importing a sibling command's write-side type for a read this
 * file must validate for itself regardless of what wrote it. */
export interface ParityVerdictCounts {
  readonly invalid: number;
  readonly expired: number;
  readonly missing: number;
  readonly ambiguous: number;
  readonly error: number;
  readonly unclean: number;
  readonly unstable: number;
  readonly mismatch: number;
  readonly match: number;
}

function isParityVerdictCounts(value: unknown): value is ParityVerdictCounts {
  return (
    isPlainObject(value) &&
    isFiniteNumber(value['invalid']) &&
    isFiniteNumber(value['expired']) &&
    isFiniteNumber(value['missing']) &&
    isFiniteNumber(value['ambiguous']) &&
    isFiniteNumber(value['error']) &&
    isFiniteNumber(value['unclean']) &&
    isFiniteNumber(value['unstable']) &&
    isFiniteNumber(value['mismatch']) &&
    isFiniteNumber(value['match'])
  );
}

interface RecognizedParityPayload {
  readonly total: number;
  readonly verdictCounts: ParityVerdictCounts;
  readonly evidenceId: string | null;
  readonly declarationNames: readonly string[];
}

/** `kind` checked FIRST and explicitly -- the identical forward-compatibility discriminator
 * `asBindingPayload` already establishes. */
function asParityPayload(payload: unknown): RecognizedParityPayload | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const p = payload as Record<string, unknown>;
  if (p['kind'] !== 'parity') return undefined;
  const evidenceId = p['evidenceId'];
  if (
    !isFiniteNumber(p['total']) ||
    !isParityVerdictCounts(p['verdictCounts']) ||
    !(evidenceId === null || isNonBlankString(evidenceId)) ||
    !isStringArray(p['declarationNames'])
  ) {
    return undefined;
  }
  return {
    total: p['total'],
    verdictCounts: p['verdictCounts'],
    evidenceId,
    declarationNames: p['declarationNames'],
  };
}

export interface ParityMetric {
  /** Every real `CheckRun{kind:'parity'}` occurrence, across every run -- no dedup (the identical
   * "every real event is counted" convention `ExemptionMetric.opened` already establishes): there is
   * no natural per-subject state to dedup by the way `BindingMetric`'s own per-story metric has one. */
  readonly checksRun: number;
  /** Summed across every occurrence counted above. */
  readonly totalDeclarations: number;
  /** Summed across every occurrence counted above. */
  readonly verdictCounts: ParityVerdictCounts;
  /** `verdictCounts.match / totalDeclarations` -- `0` (never `NaN`) when `totalDeclarations` is `0`. */
  readonly passRate: number;
}

function buildParityMetric(events: readonly ForgeEvent[]): ParityMetric {
  let checksRun = 0;
  let invalid = 0;
  let expired = 0;
  let missing = 0;
  let ambiguous = 0;
  let error = 0;
  let unclean = 0;
  let unstable = 0;
  let mismatch = 0;
  let match = 0;
  for (const event of events) {
    if (event.type !== 'CheckRun') continue;
    const payload = asParityPayload(event.payload);
    if (payload === undefined) continue;
    checksRun += 1;
    invalid += payload.verdictCounts.invalid;
    expired += payload.verdictCounts.expired;
    missing += payload.verdictCounts.missing;
    ambiguous += payload.verdictCounts.ambiguous;
    error += payload.verdictCounts.error;
    unclean += payload.verdictCounts.unclean;
    unstable += payload.verdictCounts.unstable;
    mismatch += payload.verdictCounts.mismatch;
    match += payload.verdictCounts.match;
  }
  const totalDeclarations =
    invalid + expired + missing + ambiguous + error + unclean + unstable + mismatch + match;
  return {
    checksRun,
    totalDeclarations,
    verdictCounts: {
      invalid,
      expired,
      missing,
      ambiguous,
      error,
      unclean,
      unstable,
      mismatch,
      match,
    },
    passRate: totalDeclarations === 0 ? 0 : match / totalDeclarations,
  };
}

function isParityMetric(value: unknown): value is ParityMetric {
  return (
    isPlainObject(value) &&
    isFiniteNumber(value['checksRun']) &&
    isFiniteNumber(value['totalDeclarations']) &&
    isParityVerdictCounts(value['verdictCounts']) &&
    isFiniteNumber(value['passRate'])
  );
}

function buildBindingMetric(events: readonly ForgeEvent[]): BindingMetric {
  const latestByStory = new Map<
    string,
    { readonly event: ForgeEvent; readonly payload: RecognizedBindingPayload }
  >();
  for (const event of events) {
    if (event.type !== 'CheckRun') continue;
    const payload = asBindingPayload(event.payload);
    if (payload === undefined) continue;
    const existing = latestByStory.get(payload.storyId);
    if (
      existing === undefined ||
      tsToComparableMsForDedup(event.ts) >= tsToComparableMsForDedup(existing.event.ts)
    ) {
      latestByStory.set(payload.storyId, { event, payload });
    }
  }
  const stories: StoryBindingState[] = [...latestByStory.values()]
    .map(({ payload }) => ({
      storyId: payload.storyId,
      testsNamed: payload.testsNamed,
      bound: payload.bound,
      nonBinding: payload.nonBinding,
      exempted: payload.exempted,
      passing: payload.nonBinding - payload.exempted === 0,
    }))
    .sort((a, b) => (a.storyId < b.storyId ? -1 : a.storyId > b.storyId ? 1 : 0));
  const passingCount = stories.filter((story) => story.passing).length;
  return {
    stories,
    passingCount,
    totalCount: stories.length,
    passRate: stories.length === 0 ? 0 : passingCount / stories.length,
  };
}

function buildExemptionMetric(events: readonly ForgeEvent[]): ExemptionMetric {
  let opened = 0;
  const expiredIds = new Set<string>();
  for (const event of events) {
    if (event.type !== 'CheckRun') continue;
    const payload = event.payload;
    if (typeof payload !== 'object' || payload === null) continue;
    const p = payload as Record<string, unknown>;
    if (p['kind'] === 'exemption-declared' && isNonBlankString(p['exemptionId'])) {
      opened += 1;
    }
    if (p['kind'] === 'binding') {
      const bindingPayload = asBindingPayload(payload);
      for (const id of bindingPayload?.expiredExemptionIds ?? []) {
        expiredIds.add(id);
      }
    }
  }
  return { opened, expiredIds: [...expiredIds].sort() };
}

function buildCriticLoopMetric(events: readonly ForgeEvent[]): CriticLoopMetric {
  let roundsConsumed = 0;
  let stopAndDiscloseCount = 0;
  for (const event of events) {
    if (event.type === 'StepProgress') {
      const payload = event.payload;
      if (
        typeof payload === 'object' &&
        payload !== null &&
        (payload as Record<string, unknown>)['kind'] === 'critic-round'
      ) {
        roundsConsumed += 1;
      }
      continue;
    }
    if (event.type === 'StepFailed') {
      const payload = event.payload;
      if (
        typeof payload === 'object' &&
        payload !== null &&
        (payload as Record<string, unknown>)['code'] === 'RUN-113'
      ) {
        stopAndDiscloseCount += 1;
      }
    }
  }
  return { roundsConsumed, stopAndDiscloseCount };
}

function gateIdOf(event: ForgeEvent): string | undefined {
  const payload = event.payload;
  if (typeof payload !== 'object' || payload === null) return undefined;
  const gateId = (payload as Record<string, unknown>)['gateId'];
  return isNonBlankString(gateId) ? gateId : undefined;
}

function buildGateMetric(events: readonly ForgeEvent[]): GateMetric {
  const byPair = new Map<string, ForgeEvent[]>();
  for (const event of events) {
    if (
      event.type !== 'GateRejected' &&
      event.type !== 'GateApproved' &&
      event.type !== 'GateWaived'
    ) {
      continue;
    }
    const gateId = gateIdOf(event);
    if (gateId === undefined) continue;
    // `JSON.stringify` of a real tuple, not a `\0`-joined string: a gate id is only ever validated as
    // `isNonBlankString` (`packages/engine/src/gates/document.ts`), with nothing rejecting a control
    // character, so a `\0`-joined key's own safety would rest on an invariant this codebase does not
    // actually enforce. A JSON-encoded array has no such assumption -- a literal NUL byte inside either
    // half renders as `\u0000` in the encoded string, never as a real separator, so two different real
    // `(runId, gateId)` pairs can never collide into the same key regardless of their own content.
    const key = JSON.stringify([event.runId, gateId]);
    const group = byPair.get(key);
    if (group === undefined) byPair.set(key, [event]);
    else group.push(event);
  }
  let pairsWithCleanFirstPass = 0;
  let totalRejectionsBeforeFirstPass = 0;
  for (const group of byPair.values()) {
    const ordered = [...group].sort((a, b) => a.seq - b.seq);
    let rejectionsSoFar = 0;
    let reachedPass = false;
    for (const event of ordered) {
      if (event.type === 'GateRejected') {
        rejectionsSoFar += 1;
        continue;
      }
      // GateApproved or GateWaived: this pair's own first pass. Stop counting for this pair.
      reachedPass = true;
      break;
    }
    totalRejectionsBeforeFirstPass += rejectionsSoFar;
    if (reachedPass && rejectionsSoFar === 0) pairsWithCleanFirstPass += 1;
  }
  return {
    pairsEvaluated: byPair.size,
    pairsWithCleanFirstPass,
    totalRejectionsBeforeFirstPass,
  };
}

function buildCostMetric(events: readonly ForgeEvent[]): CostMetric {
  const byStory = new Map<string, number>();
  for (const event of events) {
    if (event.type !== 'UsageRecorded') continue;
    const payload = event.payload;
    if (typeof payload !== 'object' || payload === null) continue;
    const p = payload as Record<string, unknown>;
    const storyId = p['storyId'];
    const costUsd = p['costUsd'];
    if (!isNonBlankString(storyId) || !isFiniteNumber(costUsd) || costUsd < 0) continue;
    byStory.set(storyId, (byStory.get(storyId) ?? 0) + costUsd);
  }
  const entries: StoryCostMetric[] = [...byStory.entries()]
    .map(([storyId, totalUsd]) => ({ storyId, totalUsd }))
    .sort((a, b) => (a.storyId < b.storyId ? -1 : a.storyId > b.storyId ? 1 : 0));
  return {
    byStory: entries,
    totalUsd: entries.reduce((sum, entry) => sum + entry.totalUsd, 0),
  };
}

function isKbReadEvent(event: ForgeEvent): boolean {
  if (event.type !== 'SessionEvent') return false;
  const payload = event.payload;
  return (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as Record<string, unknown>)['kind'] === 'kb-read'
  );
}

function buildKbReadMetric(events: readonly ForgeEvent[]): KbReadMetric {
  const byRun = new Map<
    string,
    { readonly artifacts: ForgeEvent[]; readonly kbReads: ForgeEvent[] }
  >();
  for (const event of events) {
    if (event.type !== 'ArtifactCreated' && !isKbReadEvent(event)) continue;
    let group = byRun.get(event.runId);
    if (group === undefined) {
      group = { artifacts: [], kbReads: [] };
      byRun.set(event.runId, group);
    }
    if (event.type === 'ArtifactCreated') group.artifacts.push(event);
    else group.kbReads.push(event);
  }
  let artifactsCreated = 0;
  let precededByKbRead = 0;
  for (const group of byRun.values()) {
    artifactsCreated += group.artifacts.length;
    for (const artifact of group.artifacts) {
      const preceded = group.kbReads.some(
        (read) =>
          read.stepId !== undefined && read.stepId === artifact.stepId && read.seq < artifact.seq,
      );
      if (preceded) precededByKbRead += 1;
    }
  }
  return {
    artifactsCreated,
    precededByKbRead,
    rate: artifactsCreated === 0 ? 0 : precededByKbRead / artifactsCreated,
  };
}

/** Pure projection: the real `MilestoneScorecard` over every real event this project has ever logged
 * (optionally `--since`-filtered). An empty project (no runs at all, or `--since` filtering out
 * everything) reports real, explicit zero values for every metric -- never throws, never reports
 * `undefined`/`null` for a metric with no data. */
export async function buildReport(
  ctx: ReportCommandContext,
  options: ReportOptions = {},
): Promise<MilestoneScorecard> {
  const events = await allEvents(ctx, options);
  const parity = buildParityMetric(events);
  const hunks = buildHunkMetric(events);
  return {
    v: 1,
    since: options.since === undefined ? null : options.since.toISOString(),
    binding: buildBindingMetric(events),
    criticLoop: buildCriticLoopMetric(events),
    gates: buildGateMetric(events),
    exemptions: buildExemptionMetric(events),
    cost: buildCostMetric(events),
    kbReads: buildKbReadMetric(events),
    // `specs/22` M16 P15: omitted (never an all-zero object) when this project has no real occurrence
    // to report -- see this module's own top doc comment for the full golden-compatibility reasoning.
    ...(parity.checksRun === 0 ? {} : { parity }),
    ...(hunks.checksRun === 0 ? {} : { hunks }),
  };
}

const BASELINE_RELATIVE_PATH_SUFFIX = 'baseline.md';

function baselineRelativePath(reportsRoot: string): string {
  return `${reportsRoot}/${BASELINE_RELATIVE_PATH_SUFFIX}`;
}

export interface BaselineSnapshot {
  readonly v: 1;
  readonly capturedAt: string;
  /** The real `HEAD` commit sha this snapshot was captured at, or `null` for a repository with no
   * commits yet (`resolveHeadShaOrUndefined`'s own documented case) -- never a placeholder string. */
  readonly commit: string | null;
  readonly scorecard: MilestoneScorecard;
}

function renderBaselineFile(snapshot: BaselineSnapshot): string {
  const frontMatter = YAML.stringify(snapshot).trimEnd();
  return `---\n${frontMatter}\n---\n\n# Milestone baseline\n\nCaptured ${snapshot.capturedAt} at commit \`${snapshot.commit ?? '(no commits yet)'}\`. Machine-readable data is in this file's own YAML front matter above -- read it back with \`readBaseline\`/\`forge report --baseline --json\`, not by parsing this prose.\n`;
}

function isBindingMetric(value: unknown): value is BindingMetric {
  if (!isPlainObject(value)) return false;
  return (
    Array.isArray(value['stories']) &&
    value['stories'].every(
      (story: unknown) =>
        isPlainObject(story) &&
        isNonBlankString(story['storyId']) &&
        isFiniteNumber(story['testsNamed']) &&
        isFiniteNumber(story['bound']) &&
        isFiniteNumber(story['nonBinding']) &&
        isFiniteNumber(story['exempted']) &&
        typeof story['passing'] === 'boolean',
    ) &&
    isFiniteNumber(value['passingCount']) &&
    isFiniteNumber(value['totalCount']) &&
    isFiniteNumber(value['passRate'])
  );
}

function isCriticLoopMetric(value: unknown): value is CriticLoopMetric {
  return (
    isPlainObject(value) &&
    isFiniteNumber(value['roundsConsumed']) &&
    isFiniteNumber(value['stopAndDiscloseCount'])
  );
}

function isGateMetric(value: unknown): value is GateMetric {
  return (
    isPlainObject(value) &&
    isFiniteNumber(value['pairsEvaluated']) &&
    isFiniteNumber(value['pairsWithCleanFirstPass']) &&
    isFiniteNumber(value['totalRejectionsBeforeFirstPass'])
  );
}

function isExemptionMetric(value: unknown): value is ExemptionMetric {
  return (
    isPlainObject(value) && isFiniteNumber(value['opened']) && isStringArray(value['expiredIds'])
  );
}

function isCostMetric(value: unknown): value is CostMetric {
  if (!isPlainObject(value)) return false;
  return (
    Array.isArray(value['byStory']) &&
    value['byStory'].every(
      (entry: unknown) =>
        isPlainObject(entry) &&
        isNonBlankString(entry['storyId']) &&
        isFiniteNumber(entry['totalUsd']),
    ) &&
    isFiniteNumber(value['totalUsd'])
  );
}

function isKbReadMetric(value: unknown): value is KbReadMetric {
  return (
    isPlainObject(value) &&
    isFiniteNumber(value['artifactsCreated']) &&
    isFiniteNumber(value['precededByKbRead']) &&
    isFiniteNumber(value['rate'])
  );
}

function isMilestoneScorecard(value: unknown): value is MilestoneScorecard {
  if (!isPlainObject(value)) return false;
  return (
    value['v'] === 1 &&
    (value['since'] === null || isNonBlankString(value['since'])) &&
    isBindingMetric(value['binding']) &&
    isCriticLoopMetric(value['criticLoop']) &&
    isGateMetric(value['gates']) &&
    isExemptionMetric(value['exemptions']) &&
    isCostMetric(value['cost']) &&
    isKbReadMetric(value['kbReads']) &&
    (value['parity'] === undefined || isParityMetric(value['parity'])) &&
    (value['hunks'] === undefined || isHunkMetric(value['hunks']))
  );
}

/** A real, malformed-tolerant shape check on the one document `readBaseline` trusts -- the identical
 * "never silently trust a cast, never crash on a raw parse failure" discipline `coverage.ts`'s own
 * `isRatchetBaseline`/`readBaseline` already establish for the sibling coverage-ratchet baseline. A
 * baseline has no per-row granularity to be tolerant WITHIN the way a collection file
 * (`Exemption`/`Disclosure`) can be -- it is one document, so "mostly valid" is not a real state this
 * checks for; either the whole thing is the real shape `writeBaseline` produces, or it is not. */
function isBaselineSnapshot(value: unknown): value is BaselineSnapshot {
  if (!isPlainObject(value)) return false;
  return (
    value['v'] === 1 &&
    isNonBlankString(value['capturedAt']) &&
    (value['commit'] === null || isNonBlankString(value['commit'])) &&
    isMilestoneScorecard(value['scorecard'])
  );
}

/** Writes the real, CURRENT scorecard (unfiltered -- a baseline is always "everything so far," never
 * itself `--since`-scoped) to \`\${reportsRoot}/baseline.md\`, OVERWRITING any previous snapshot at that
 * same well-known path: "a baseline," singular, the one reference point a later milestone compares
 * against, not an append-only collection the way `Exemption`/`Disclosure` are. Plain `writeFileAtomic`
 * (never `writeNewFileAtomic`, which refuses on an existing target) is the deliberate choice this
 * overwrite semantics needs -- see this module's own top doc comment for the full "committed with
 * trailers" reasoning. */
export async function writeBaseline(ctx: ReportCommandContext): Promise<BaselineSnapshot> {
  const [scorecard, commit] = await Promise.all([
    buildReport(ctx),
    resolveHeadShaOrUndefined(ctx.projectRoot),
  ]);
  const snapshot: BaselineSnapshot = {
    v: 1,
    capturedAt: ctx.clock.now(),
    commit: commit ?? null,
    scorecard,
  };
  await writeFileAtomic(
    ctx.paths.resolveWithin(baselineRelativePath(ctx.reportsRoot)),
    renderBaselineFile(snapshot),
  );
  return snapshot;
}

/** Reads back whatever `writeBaseline` last wrote, or `undefined` ONLY when no baseline has ever been
 * captured for this project -- a real file that exists but is not genuinely readable as one (broken
 * YAML, a missing front-matter fence, a wrong shape from a hand edit or a future schema change) throws
 * `USR-004` rather than being silently treated the same as "never captured." Collapsing those two real,
 * different states into one `undefined` would be actively dangerous for this function's own two real
 * callers: `forge report --baseline` could silently overwrite a human's hand-recoverable file thinking
 * there was nothing there to lose, and a later milestone's own "compare against the committed baseline"
 * could silently compare against nothing at all with no error telling it why. Round-trips
 * `writeBaseline`'s own output exactly when the file IS genuinely well-formed: the front matter is the
 * one source of truth, the prose body below it is for a human only. */
export async function readBaseline(
  ctx: ReportCommandContext,
): Promise<BaselineSnapshot | undefined> {
  const target = ctx.paths.resolveWithin(baselineRelativePath(ctx.reportsRoot));
  if (!(await pathExists(target))) return undefined;
  const text = await readTextFile(target);
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (match?.[1] === undefined) {
    throw new ForgeError('USR-004', {
      path: baselineRelativePath(ctx.reportsRoot),
      detail: 'no YAML front-matter fence (--- ... ---) found at the start of the file',
    });
  }
  let parsed: unknown;
  try {
    parsed = YAML.parse(match[1]);
  } catch (cause) {
    throw new ForgeError(
      'USR-004',
      {
        path: baselineRelativePath(ctx.reportsRoot),
        detail: cause instanceof Error ? cause.message : String(cause),
      },
      { cause },
    );
  }
  if (!isBaselineSnapshot(parsed)) {
    throw new ForgeError('USR-004', {
      path: baselineRelativePath(ctx.reportsRoot),
      detail:
        'the front matter does not have the real BaselineSnapshot shape writeBaseline produces',
    });
  }
  return parsed;
}
