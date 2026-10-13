/**
 * `runSwarmReviewStep` — a workflow `agent` step with `mode: swarm-review` (`PLAN-M13.md` P17, the owner
 * decision that the ENGINE, not the reviewer, writes and validates the `ReviewReport`).
 *
 * Before this, `executeStep` ignored `mode` and ran one ordinary session for the reviewer, which is
 * `write: false`: the step declared `outputs: [{type: ReviewReport}]` and nothing could ever produce it, so
 * the output contract check (`PLAN-M13.md` P7) failed it (`RUN-084`) or, before P7, reported success with no
 * file. Now, in order:
 *
 * 1. One read-only session per perspective (`dispatchAgentStep`'s `swarm-review`: the P5 participant sessions,
 *    each with the reviewer's role block and `prompt.briefs.swarm-review`). Nothing is written and no lane
 *    of the review's own exists yet, so a refused or failed perspective leaves no worktree behind and no partial
 *    report. The sessions run in the worktree of the lane the review is stacked on when there is one (`lane-base.ts`,
 *    `PLAN-M13.md` P38, `SPEC-QUESTIONS.md` Q226: the diff under review is on that lane, not in the project
 *    checkout), else in the project checkout; a session that leaves a change in a lane it reviews fails the step
 *    (the lane is one a merge will land).
 * 2. Only if every perspective session ended ok, the engine creates the step's lane through the same
 *    `runLaneLifecycle` every agent step uses (`LaneCreated`, commit on the lane branch, claim enforcement,
 *    then the P7 output check, then `LaneReady`), writes `REVIEW-NNN.md` into it and commits it. The reviewer
 *    agent's grant is never touched: it stays read-only, the engine writes.
 * 3. The output check is not skipped or reimplemented: `runLaneLifecycle` runs `verifyDeclaredOutputs` on the
 *    committed lane exactly as for any agent step, so a report that is missing, or that fails
 *    `validateArtifact` there, fails the step with the typed `RUN-083`.
 * 4. Only once that check has passed (a genuinely valid, committed report) does the merged verdict itself
 *    bind (`PLAN-M14.md` P14, `SPEC-QUESTIONS.md` Q232 decision 7): `blocked` fails the step with `RUN-108`
 *    even though the report is valid — the lane already reached `LaneReady` and the registry by then (the
 *    same "a lane-based handler's `LaneReady` outlives its step's own eventual status" precedent
 *    `executeStep`'s own doc comment already states, Q217 (g)), so it is explicitly pulled back out.
 *    `incomplete`/`concerns`/`clear` succeed unchanged; `resumeSwarmReviewStep` re-applies this same rule
 *    from the committed report, with zero sessions.
 *
 * The step's `outputs` are treated as including `ReviewReport` whether or not the workflow lists it (the mode
 * implies the output, and the claim and the check must cover what the engine writes).
 *
 * **Numbering.** `REVIEW-NNN` is the smallest number above every `REVIEW-*.md` visible in the lane, the
 * integration worktree, the project root and every lane still waiting to merge, and above every number this
 * run already handed to another step whose lane still exists (a sibling lane that has not registered yet). The
 * whole allocation runs in one per-(project, run) queue, so concurrent review steps of a fan-out never take the
 * same number and their lanes merge without an add/add conflict.
 *
 * **Crash and resume; idempotent by (run, step).** The report records its run and step in two engine-written
 * lines. `resumeSwarmReviewStep` finishes a lane that already committed the report for this (run, step) (the
 * output check and `LaneReady`) without running a perspective again; a lane with no committed report is
 * discarded by the caller and the step re-runs from the start, into a fresh lane whose number is the discarded
 * attempt's own (a step's earlier reservation is superseded when it allocates again). So no resume ever leaves
 * two `REVIEW-NNN` for one step, and nothing is reused across runs (the run id is part of the key).
 *
 * @see specs/05 §5.7
 * @see specs/06 §6.4, §6.7, §6.10
 * @see specs/13 §13.3
 * @see PLAN-M13.md P17
 * @see PLAN-M14.md P14
 * @see SPEC-QUESTIONS.md Q217, Q232 decision 7
 */
import path from 'node:path';

import { ArtifactDocument } from '@forge/core/artifacts';
import { ForgeError, isForgeError } from '@forge/core/errors';
import { resolveStepModel } from '@forge/agents/resolve';
import type { AgentDefinition } from '@forge/agents/schema';
import { ProjectPaths, writeFileAtomic } from '@forge/core/fs';
import { definitionForType } from '@forge/schemas';
import { TelemetryError } from '@forge/telemetry/errors';

import { isAssemblyRefusal, markRefusal, refusalFailure } from '../dispatch/assemble.ts';
import { docRootsOf, documentProblems, outputPathFor } from '../dispatch/outputs.ts';
import { directoryIdScan, reserveIds } from '../dispatch/output-ids.ts';
import { resolveLaneBase } from '../dispatch/lane-base.ts';
import { runAgentWork, runLaneLifecycle, sanitizeUsageNumber } from '../dispatch/steps.ts';
import type {
  ExecuteStepContext,
  LaneHandle,
  StepFailureInfo,
  StepOutcome,
  StepOutcomeDetail,
} from '../dispatch/types.ts';
import { deriveStoryId, type StepNode } from '../plan/index.ts';
import { dispatchAgentStep } from './dispatch-agent-step.ts';
import {
  buildReviewReport,
  countBlockingFindings,
  parseReviewRounds,
  parseReviewVerdict,
  provenanceLines,
  renderReviewReportFile,
  reviewFrontMatter,
  type ReviewReportContent,
} from './review-report.ts';
import type { InteractionOutcome, InteractionParticipant, PerspectiveReview } from './types.ts';

const EMPTY_SESSION = {
  sessionId: '',
  ok: false,
  finalText: '',
  usage: { inputTokens: 0, outputTokens: 0, turns: 0 },
  durationMs: 0,
  changedFiles: [],
  controlTokens: [],
} as const;

const ID_PREFIX = 'REVIEW';
const ID_WIDTH = 3;
const REPORT_FILE = /^REVIEW-(\d{3})(?:-.*)?\.md$/;

/** The step as the lane lifecycle and the output check see it: the `swarm-review` mode implies a
 * `ReviewReport` output, so the claim covers the file the engine writes and the check demands it. */
function withReviewReportOutput(node: StepNode): StepNode {
  return node.outputs.some((output) => output.type === 'ReviewReport')
    ? node
    : { ...node, outputs: [...node.outputs, { type: 'ReviewReport' }] };
}

function failed(
  node: StepNode,
  startedAt: number,
  finishedAt: number,
  detail: StepOutcomeDetail,
  failure: StepFailureInfo,
): StepOutcome {
  return { stepId: node.id, status: 'failed', startedAt, finishedAt, detail, failure };
}

function outputFailure(node: StepNode, detail: string): StepFailureInfo {
  const error = new ForgeError('RUN-083', { stepId: node.id, detail });
  return {
    source: 'output',
    code: error.code,
    message: `${error.message} -- Remedy: ${error.remedy}`,
    cause: error,
  };
}

/** `PLAN-M14.md` P14, `SPEC-QUESTIONS.md` Q232 decision 7: the report is a valid, committed document (the
 * P7 output check already passed it) — this is not that check failing again, so `RUN-108`, not `RUN-083`.
 * `source: 'output'` still: the step's own output is what is at fault (a `blocked` review), not the
 * adapter, a claim, or the vcs layer. */
function blockedVerdictFailure(
  node: StepNode,
  file: string,
  blockingCount: number,
): StepFailureInfo {
  const error = new ForgeError('RUN-108', { stepId: node.id, file, count: blockingCount });
  return {
    source: 'output',
    code: error.code,
    message: `${error.message} -- Remedy: ${error.remedy}`,
    cause: error,
  };
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** The outcome of one `restoreReviewedLane` attempt: what was found dirty, and whether the reset itself
 * is actually trustworthy. Kept as two separate signals rather than one, because a critic round found
 * collapsing them loses real information a caller needs: `resetLane` can itself fail (a stale git lock,
 * a permissions error) independently of whether `changedFiles` could list what was dirty, and a caller
 * reporting "restored" when the reset call actually threw would be reporting something that never
 * happened. */
interface ReviewedLaneRestoreOutcome {
  /** Paths dirty before the reset attempt (`[]` when the lane was already clean); `undefined` only when
   * they could not even be listed (the worktree itself is gone, or some other real I/O failure) -- the
   * same fail-closed "cannot tell, so do not claim clean" stance the pre-existing guard's own
   * `.catch(() => true)` already took for the identical uncertainty (`hasChanges`'s own doc comment). A
   * caller must fail closed on `undefined` here exactly as that guard did, not read the absence of a
   * proven dirty list as proof of a clean one. */
  readonly dirtyPaths: readonly string[] | undefined;
  /** Whether `resetLane` itself completed without throwing. `false` means the lane's actual state after
   * this call is NOT confirmed -- whatever `dirtyPaths` says, a caller must not report the lane as
   * restored, only that a reset was attempted. */
  readonly resetOk: boolean;
}

/**
 * `PLAN-M14.md` P36: restores `reviewedLane` to `reviewedRevision` after the perspectives ran, on every
 * path the caller can be on -- not only the "every perspective ended ok" success path the pre-existing
 * guard checked (below, still typed `RUN-083`). Before this, `hasChanges` ran only once `dispatchAgentStep`
 * had already returned: a perspective session that threw straight out of it (an adapter crash, mid-write)
 * skipped the guard entirely and left whatever it had written behind, and a dirty lane the guard DID catch
 * on the success path was reported but never cleaned, so a retry of the identical step read the identical
 * dirty lane and failed the identical way forever.
 *
 * `resetLane` (`git reset --hard` + `git clean -fd`, ignored files untouched, `types.ts`'s own doc comment)
 * is attempted unconditionally here, not only after first confirming dirt: it is a no-op on an already-clean
 * lane, and that is what makes calling it from one place, on every path, simpler and safer than trying to
 * skip it exactly when it is not needed. `changedFiles` is read FIRST, before the reset, purely so a
 * caller can name what was restored (a failure message, an audit trail) -- reading it after the reset
 * would report nothing was ever there. Its own failure is caught here (not left to propagate) so it never
 * masks whatever the caller was already about to report -- e.g. a thrown adapter error this same call is
 * racing to restore behind -- but it is caught into `resetOk`, not silently discarded: a caller must read
 * it, not assume a caught failure means success. A lane this cannot actually clean is Q226 (f)'s own
 * remaining, disclosed gap, not a new failure mode this function invents.
 */
async function restoreReviewedLane(
  ctx: ExecuteStepContext,
  reviewedLane: LaneHandle,
  reviewedRevision: string,
): Promise<ReviewedLaneRestoreOutcome> {
  const dirtyPaths = await ctx.vcs
    .changedFiles(reviewedLane, reviewedRevision)
    .then((changed) => [...changed.committed, ...changed.uncommitted])
    .catch(() => undefined);
  const resetOk = await ctx.vcs
    .resetLane(reviewedLane, reviewedRevision)
    .then(() => true)
    .catch(() => false);
  return { dirtyPaths, resetOk };
}

/** Whether the caller-visible outcome above must be treated as "the lane may still hold an unreviewed
 * change" -- known dirty, OR genuinely unknown (fail closed on `dirtyPaths === undefined`, the identical
 * stance the pre-existing guard's own `.catch(() => true)` already took), OR the reset itself did not
 * provably succeed (so even a `dirtyPaths: []` read from before the attempt is not trustworthy proof the
 * lane is clean now). Only `dirtyPaths: []` AND `resetOk: true` together prove the lane is genuinely, now,
 * clean at `reviewedRevision`. */
function reviewedLaneNeedsAttention(outcome: ReviewedLaneRestoreOutcome): boolean {
  return outcome.dirtyPaths === undefined || outcome.dirtyPaths.length > 0 || !outcome.resetOk;
}

/** Describes what `restoreReviewedLane` actually found and did, honestly: never claims "restored" when
 * `resetOk` is `false`, and never claims the lane was clean when `dirtyPaths` could not even be listed. */
function describeRestoreOutcome(
  reviewedLane: LaneHandle,
  { dirtyPaths, resetOk }: ReviewedLaneRestoreOutcome,
): string {
  if (dirtyPaths === undefined) {
    return resetOk
      ? `whether a review perspective left the lane under review (${reviewedLane.path}) dirty could not be confirmed, though a reset of it to its reviewed revision was attempted`
      : `whether a review perspective left the lane under review (${reviewedLane.path}) dirty could not be confirmed, and resetting it also failed -- inspect it directly before reusing it`;
  }
  if (dirtyPaths.length === 0) {
    // Only reachable with `resetOk: false` -- both callers (the adapter-failure note and the success-path
    // `reviewedLaneNeedsAttention` check) skip this function entirely for a known-empty `dirtyPaths` paired
    // with a confirmed-ok reset, the one combination that proves the lane is genuinely clean. This is the
    // rarer case: nothing was ever found dirty, but the reset attempt itself still failed -- worth
    // disclosing even though there was nothing to restore.
    return `resetting the lane under review (${reviewedLane.path}) to its reviewed revision failed, though nothing was found dirty there`;
  }
  return resetOk
    ? `a review perspective also left the lane under review (${reviewedLane.path}) dirty before this failure; restored: ${dirtyPaths.join(', ')}`
    : `a review perspective also left the lane under review (${reviewedLane.path}) dirty before this failure (${dirtyPaths.join(', ')}), and resetting it back also failed -- inspect it directly before reusing it`;
}

/** The adapter-failure message (the `dispatchAgentStep` call itself threw) with a note describing whatever
 * `restoreReviewedLane` found and did, so a reader is told the same thing the success-path `RUN-083`
 * failure already says explicitly, instead of the restore happening silently underneath a message that
 * only describes the original throw. Unchanged when there was nothing to restore (no reviewed lane, or a
 * lane that was confirmed already clean and confirmed reset): the ordinary adapter failure message,
 * exactly as before this piece. */
function restoreFailureNote(
  message: string,
  reviewedLane: LaneHandle | undefined,
  restoreOutcome: ReviewedLaneRestoreOutcome | undefined,
): string {
  if (reviewedLane === undefined || restoreOutcome === undefined) return message;
  if (restoreOutcome.dirtyPaths?.length === 0 && restoreOutcome.resetOk) {
    return message;
  }
  return `${message} -- ${describeRestoreOutcome(reviewedLane, restoreOutcome)}`;
}

/** A `swarm-review` step declares its perspectives; an empty list would be an empty review, not a clean one. */
function noPerspectives(node: StepNode): StepFailureInfo {
  const error = new ForgeError('RUN-046', { stepId: node.id, mode: 'swarm-review' });
  return { source: 'prompt', code: error.code, message: error.message, cause: error };
}

/** `UsageRecorded` for a perspective session: without it the cost of a review would never reach the ledger
 * the budget reads (`runAgentWork` records its one session; participants recorded nothing). */
async function recordUsage(
  node: StepNode,
  ctx: ExecuteStepContext,
  model: string,
  session: InteractionParticipant,
): Promise<void> {
  const storyId = deriveStoryId(node);
  await ctx.telemetry.emit({
    type: 'UsageRecorded',
    stepId: node.id,
    agentId: node.agent,
    payload: {
      model,
      platform: ctx.adapter.id,
      inputTokens: sanitizeUsageNumber(session.session.usage.inputTokens),
      outputTokens: sanitizeUsageNumber(session.session.usage.outputTokens),
      // M17 P11 (the milestone's own defect #11): mirrors `steps.ts`'s own identical fix -- see that
      // module's own `UsageRecorded` emission for the full reasoning.
      cacheReadTokens: sanitizeUsageNumber(session.session.usage.cacheReadTokens ?? 0),
      cacheCreationTokens: sanitizeUsageNumber(session.session.usage.cacheCreationTokens ?? 0),
      costUsd:
        session.session.usage.costUsd === undefined
          ? 0
          : sanitizeUsageNumber(session.session.usage.costUsd),
      estimated: true,
      durationMs: sanitizeUsageNumber(session.session.durationMs),
      role: session.role,
      ...(storyId === undefined ? {} : { storyId }),
    },
  });
}

// --- numbering ---------------------------------------------------------------------------------------
//
// `PLAN-M14.md` P8 moved this queue to `dispatch/output-ids.ts`, generalised (`idPrefix`, `idWidth`,
// scan target, count) so a declared KB output's id reserves through the identical module and rule. The
// numbering RULE below is unchanged from `PLAN-M13.md` P17: `allocateNumber` is now a thin caller of
// `reserveIds`, not a reimplementation -- `output-ids.ts`'s own doc comment carries the full reasoning.

function reportsDirOf(ctx: ExecuteStepContext): string {
  return path.posix.dirname(outputPathFor('ReviewReport', docRootsOf(ctx), `${ID_PREFIX}-000`));
}

function isProvenance(text: string, stepId: string, runId: string): boolean {
  const lines = new Set(text.split('\n'));
  return provenanceLines(stepId, runId).every((line) => lines.has(line));
}

/**
 * The id this step's report takes: the smallest `REVIEW-NNN` above everything visible in the trees a
 * later merge would collide with (this lane, the integration worktree, the project root, every lane
 * still waiting to merge) and above every reservation this run's other steps already hold. A step that
 * allocates again supersedes its own earlier reservation, so a re-run of a discarded attempt gets the
 * same id back. Reserved already lane-bound (`lane` already exists by the time this runs, unlike a
 * declared KB output's own id): from the moment `reserveIds` returns, the reservation is pruned by
 * `lane.path`'s own liveness exactly as before this piece.
 */
async function allocateNumber(
  node: StepNode,
  ctx: ExecuteStepContext,
  lane: LaneHandle,
): Promise<string> {
  const reservation = await reserveIds({
    projectRoot: ctx.projectRoot,
    runId: ctx.runId,
    stepId: node.id,
    idPrefix: ID_PREFIX,
    idWidth: ID_WIDTH,
    count: 1,
    roots: [
      lane.path,
      ctx.integrationPath,
      ctx.projectRoot,
      ...[...ctx.laneRegistry.values()].map((registered) => registered.path),
    ],
    target: directoryIdScan(reportsDirOf(ctx), ID_PREFIX, ID_WIDTH),
    lanePath: lane.path,
  });
  const id = reservation.ids[0];
  if (id === undefined) {
    // reserveIds({count: 1, ...}) always returns exactly one id or throws -- there is no path that
    // returns an empty array. A RangeError, not a ForgeError: this would be a bug in that function, not
    // a caller-facing failure with a remedy to offer (the identical stance @forge/core/ids's own
    // IdAllocator.allocate takes for the same "should never happen" guard).
    throw new RangeError('reserveIds({count: 1}) returned no id.');
  }
  return id;
}

// --- the document ------------------------------------------------------------------------------------

interface WrittenReport {
  readonly id: string;
  readonly file: string;
  readonly content: ReviewReportContent;
  /** The whole rendered file (front matter and body), so `countBlockingFindings` has one implementation
   * both this write path and `resumeSwarmReviewStep`'s own read-only path can share. */
  readonly text: string;
}

/**
 * Builds, validates and (over)writes the report at `id`'s own registered path into the lane's worktree.
 * Validation is `documentProblems`, the function the output check applies afterwards; a document that
 * fails it is never written. Split out of `writeReport` below (`specs/22` M15 P9) so a bounded critic
 * loop's round 2+ can re-render the IDENTICAL report (same id, same file) with that round's own fresh
 * reviews, overwriting round N-1's content rather than allocating a new `REVIEW-NNN` per round -- the
 * step's own `outputs: [{type: ReviewReport}]` declaration, and the P7 output check that reads it, both
 * expect exactly one committed report per step, not one per round.
 */
async function renderAndWriteReport(
  node: StepNode,
  ctx: ExecuteStepContext,
  lane: LaneHandle,
  id: string,
  agentId: string,
  reviews: readonly PerspectiveReview[],
  reviewedRevision: string,
  baseSha: string,
  rounds: number,
): Promise<WrittenReport> {
  const file = outputPathFor('ReviewReport', docRootsOf(ctx), id);
  const content = buildReviewReport({
    stepId: node.id,
    runId: ctx.runId,
    agentId,
    reviews,
    // What the perspectives actually read: the reviewed lane's head when the step is stacked on it, else the
    // project's own checkout (`runParticipantSession`'s `cwd`), so a reader can tell a verdict on that tree from
    // one on a change that is still on an unmerged lane.
    reviewedRevision,
    laneBase: baseSha,
  });
  const text = renderReviewReportFile(
    reviewFrontMatter({
      id,
      stepId: node.id,
      runId: ctx.runId,
      agentId,
      nowMs: ctx.now(),
      verdict: content.verdict,
      rounds,
    }),
    content.body,
  );
  const problems = documentProblems(definitionForType('ReviewReport'), file, text).problems;
  if (problems.length > 0) {
    throw new RangeError(`the engine built an invalid ${id}: ${problems.join('; ')}`);
  }
  await writeFileAtomic(new ProjectPaths(lane.path).resolveWithin(file), text);
  return { id, file, content, text };
}

/**
 * Builds, validates and writes the report into the lane's worktree, allocating a fresh `REVIEW-NNN` id
 * first. Validation is `documentProblems`, the function the output check applies afterwards; a document
 * that fails it is never written.
 */
async function writeReport(
  node: StepNode,
  ctx: ExecuteStepContext,
  lane: LaneHandle,
  baseSha: string,
  agentId: string,
  reviews: readonly PerspectiveReview[],
  reviewedRevision: string,
  rounds: number,
): Promise<WrittenReport> {
  const id = await allocateNumber(node, ctx, lane);
  return renderAndWriteReport(
    node,
    ctx,
    lane,
    id,
    agentId,
    reviews,
    reviewedRevision,
    baseSha,
    rounds,
  );
}

/** `RUN-113` (`specs/22` M15 P9): the identical shape `blockedVerdictFailure` above already is -- a
 * valid, committed report (the P7 output check already passed it) whose own merged verdict is still
 * `blocked`, and the bounded critic loop will not attempt (or re-attempt) a fix: either it already ran
 * `rounds` fix-and-re-review cycles and exhausted its configured cap, OR `rounds` is `0` because the
 * loop's own `maxCostUsd` was already exhausted by round 0's own perspectives before a first fix could
 * ever be dispatched (`codes.ts`'s own doc comment on `RUN-113` names both cases explicitly -- an earlier
 * version of this comment and of `RUN-113`'s own text overclaimed "looping genuinely ran" unconditionally,
 * which a round-1 gauntlet critic found is false for the zero-rounds-but-budget-exhausted case). A
 * DISTINCT code from `RUN-108` either way (not a reuse of it with an extra field): `RUN-108` means
 * `execution.criticRounds` itself is absent/0 for this project -- the loop was never CONFIGURED to run at
 * all; `RUN-113` means it was configured and engaged (this project's own round cap is real and positive)
 * but could not safely continue, whether that is because the configured rounds ran out or because the
 * configured budget did. */
function exhaustedVerdictFailure(
  node: StepNode,
  file: string,
  rounds: number,
  blockingCount: number,
): StepFailureInfo {
  const error = new ForgeError('RUN-113', { stepId: node.id, file, rounds, count: blockingCount });
  return {
    source: 'output',
    code: error.code,
    message: `${error.message} -- Remedy: ${error.remedy}`,
    cause: error,
  };
}

/** One fix session's own outcome, folded into the `runLaneLifecycle`-shaped contract the round loop's own
 * `runWork` callback already returns: `failure` set means the fix session itself did not complete
 * (an adapter crash, a refused assembly) -- never means "the fix did not resolve the findings," which is
 * simply the NEXT round's own re-review verdict, not a failure of this function at all. */
interface FixRoundOutcome {
  readonly detail: StepOutcomeDetail;
  readonly failure?: StepFailureInfo | undefined;
  /** `specs/22` M15 P9: the fix session's own real, reported spend (`0` for a failed/refused dispatch
   * that reached no real session) -- folded into the loop's own cumulative `spentUsd` so "budget caps
   * still bound the loop" is checked against everything the loop has genuinely spent, fix sessions
   * included, not perspectives alone. */
  readonly costUsd: number;
}

/**
 * `specs/22` M15 P9: one round's automatic fix session, dispatched as `node.fixAgent` -- a DIFFERENT
 * agent from the reviewer (`10` §10.6's own reviewer/implementer separation; `types.ts`'s own
 * `AgentStep.fixAgent` doc comment has the fuller reasoning) -- writing directly into `lane` (the
 * review step's OWN lane, already stacked on top of whatever the story's own implementer lanes already
 * committed, via `runAgentWork` rather than `runAgentStep`: the lane already exists, created once by
 * `runLaneLifecycle` for the whole step, not per round). The brief is loaded once per round and combined
 * with this round's own blocking findings as plain `taskText` -- `briefs/fix-review-findings.md`'s own
 * static instructions PLUS this round's own dynamic findings, since `AgentWorkOptions.taskText` and
 * `node.brief` are mutually exclusive (`assemble.ts`'s own `tryAssemble`: `taskText`, when given, is
 * used verbatim instead of loading `node.brief`) -- there is no third slot to carry both separately.
 */
async function runFixRound(
  node: StepNode,
  ctx: ExecuteStepContext,
  lane: LaneHandle,
  baseSha: string,
  findingsText: string,
  remainingUsd: number,
): Promise<FixRoundOutcome> {
  const emptyDetail: StepOutcomeDetail = { kind: 'agent', session: EMPTY_SESSION };
  if (node.fixAgent === undefined) {
    // `AgentStep.fixAgent`'s own doc comment: a swarm-review step with no declared `fixAgent` cannot
    // fix anything, whatever `execution.criticRounds` says -- the caller never reaches this with
    // `maxRounds <= 0` (the only way to have no fix agent and still be here would be a workflow author
    // declaring no `fixAgent` on a step `execution.criticRounds` nonetheless bounds a loop for), so this
    // is a configuration refusal, not a silent skip. `RUN-115` (`codes.ts` has the full reasoning for why
    // this is a dedicated code, not a reuse of the unrelated `RUN-039` an earlier version of this line
    // used -- found and corrected by a round-1 gauntlet critic).
    return {
      detail: emptyDetail,
      failure: refusalFailure(new ForgeError('RUN-115', { stepId: node.id })),
      costUsd: 0,
    };
  }
  let briefText: string;
  try {
    briefText = await ctx.assembly.loadContent('briefs/fix-review-findings.md');
  } catch (cause) {
    // `specs/22` M15 P9: returned as a typed `FixRoundOutcome` failure, NOT re-thrown -- an earlier
    // version of this line did `throw markRefusal(cause)`, matching the shape a `runSwarmReviewStep`-
    // level caller elsewhere in this file catches, but THIS call site's own caller (the bounded critic
    // loop's own `runWork`, below) has no such catch of its own: a round-3 gauntlet critic reproduced
    // directly that this crashed the whole run (`executeStep` rejecting) instead of resolving to
    // `{status: 'failed', ...}`, for the exact scenario this brief being missing/unreadable from a
    // project that never ran `forge upgrade` after this content was added would produce.
    return { detail: emptyDetail, failure: refusalFailure(cause), costUsd: 0 };
  }
  // A synthetic node for this one fix session: `id`/`produces`/`gateEvidence` all stay the REAL review
  // step's own (every telemetry event `runAgentWork` emits is keyed by `node.id`, so a reader sees the
  // fix session as part of THIS step's own run, not a step of its own the compiled DAG never declared) --
  // `agent`/`brief`/`limits` change, to the fix agent, no file reference (`taskText` below supplies the
  // combined prompt instead), and the REMAINING budget (not the step's full nominal `maxCostUsd` -- a
  // round-1 gauntlet critic found an earlier version let one fix session alone spend the whole thing
  // regardless of what round 0 already had). `outputs` is explicitly CLEARED, not inherited, as a
  // declared-shape correctness fix a round-1 gauntlet critic raised: this synthetic node does not itself
  // produce a `ReviewReport` (the engine does, separately, via `renderAndWriteReport`), so claiming it
  // does is simply false, and `resolveStepClaim` would turn an inherited `outputs: [{type: 'ReviewReport'}]`
  // into a WILDCARD glob over the entire `ReviewReport` namespace (its registered path has no fixed id
  // segment). A round-2 gauntlet critic traced this further and found an earlier version of THIS comment
  // overclaimed: `fixNode` IS actually given to `resolveStepClaim`, via `runFixRound` -> `runAgentWork` ->
  // `prepareSession` -> `tryAssemble` -> `assembleAgentSession` -> `compileSession` ->
  // `resolveStepClaim(node, ...)`, where that `node` is `fixNode` -- not bypassed the way the earlier
  // comment claimed. The REAL, narrower reason an inherited wildcard claim would still be harmless THERE
  // is different: `ToolGrant.write` (`@forge/adapter-kit`) is a plain boolean, and `compileSession` only
  // ever reads `claim.globs.length > 0` (already true regardless of this field, since `node.produces` is
  // non-empty either way) and `claim.protectedSet` from the computed claim -- never a path-scoped
  // allowlist a wider glob set could widen in practice. The REAL, governing, FULL-lane claim enforcement
  // (what actually reverts a file outside `node.produces`) is still the separate, later
  // `runLaneLifecycle` check against the OUTER `withReviewReportOutput(node)` `runSwarmReviewStep` itself
  // calls it with -- confirmed end to end in `swarm-review-step.test.ts`'s own dedicated test, which shows
  // a stray write into the ReviewReport namespace is caught regardless, by that outer check, whichever
  // way this field is set. So today this is a real but narrow fix: it makes `fixNode`'s own declared
  // shape honest rather than closing an active exploit THIS call path's own grant computation would
  // otherwise permit. Worth keeping anyway (an honest declared shape costs nothing today and is cheap
  // insurance against the future this comment names next) -- but flagged explicitly, not left implied:
  // if `ToolGrant`/`compileSession`'s own claim consumption ever grows real path-scoped write enforcement,
  // THIS exact spot would silently reactivate the original risk, since `fixNode` genuinely does reach that
  // computation today.
  const fixNode: StepNode = {
    ...node,
    agent: node.fixAgent,
    brief: undefined,
    outputs: [],
    limits: { ...node.limits, maxCostUsd: Math.max(remainingUsd, 0) },
  };
  const work = await runAgentWork(
    fixNode,
    ctx,
    lane,
    baseSha,
    { kind: 'start' },
    { taskText: `${briefText}\n\n${findingsText}` },
  );
  return {
    detail: work.detail,
    failure: work.failure,
    costUsd: work.detail.kind === 'agent' ? (work.detail.session.usage.costUsd ?? 0) : 0,
  };
}

/** One round's fresh re-review -- fresh sessions (`dispatchAgentStep` dispatches a brand-new
 * `runParticipantSession` per perspective, never a resumed one, so round N+1's reviewer carries no
 * memory of round N's own reasoning by construction, the Mandate's own "fresh-context" requirement) run
 * INSIDE the review step's own lane (`cwd: lane.path`) -- not `reviewedLane.path`/`ctx.projectRoot`,
 * which round 1 used: from round 2 onward, the fix session's own changes live ONLY in this lane, so
 * reading anywhere else would review stale, pre-fix content. No `restoreReviewedLane`-style cleanup is
 * needed here the way round 1's own perspectives need for the PREDECESSOR lane they are stacked on:
 * this is the review step's own lane, which this step is already the one, intended author of -- not a
 * foreign lane some OTHER step's own landing depends on staying pristine. */
interface RereviewOutcome {
  readonly reviews: readonly PerspectiveReview[];
  readonly detail: StepOutcomeDetail;
  readonly failure?: StepFailureInfo | undefined;
  /** `specs/22` M15 P9: every real, reported perspective spend this round -- folded into the loop's own
   * cumulative `spentUsd`, the identical reason `FixRoundOutcome.costUsd` is. Real even on a failure
   * path (`broken`/`unreadable`): whatever sessions actually ran before the failure still really spent. */
  readonly costUsd: number;
}

async function rereviewInLane(
  node: StepNode,
  ctx: ExecuteStepContext,
  reviewAgent: AgentDefinition,
  model: string,
  perspectives: readonly string[],
  lane: LaneHandle,
  round: number,
  priorRoundReportText: string,
  remainingUsd: number,
): Promise<RereviewOutcome> {
  // `specs/22` M15 P9's own "the round-2 reviewer prompt contains the findings and the fix but not round
  // 1's reasoning": `dispatchSwarmReview` (`dispatch-agent-step.ts`) prepends `${node.brief ?? ''}` to
  // EVERY perspective's own prompt verbatim -- `node.brief` is `undefined` for round 1 (review's own real
  // YAML declares no `brief:`, unchanged), and set here, for round 2+ only, to the PRIOR round's own
  // committed `ReviewReport` text. That document is already the structured, FINAL digest `buildReviewReport`
  // produces (`perspective`/`findings: [{summary, severity}]`/`checked`) -- never a perspective's own raw
  // session output -- so this satisfies "contains the findings" (and, implicitly, "a fix was applied since
  // this was written" -- the reviewer is looking at the POST-fix lane right now) without ever carrying
  // round 1's own reasoning: that text was never captured into the report in the first place.
  const shared: StepNode = {
    ...node,
    brief: `A fix was applied in response to the following review (round ${String(round)}'s reviewer sees only this structured report, never a prior perspective's own raw reasoning). Verify fresh whether each finding below is actually resolved in the current diff.\n\n${priorRoundReportText}`,
    // `specs/22` M15 P9: the REMAINING budget (after round 0 and every prior fix/re-review), divided
    // across perspectives -- not the step's full nominal `maxCostUsd` an earlier version used here
    // regardless of what had already been spent, a round-1 gauntlet critic found.
    limits: { ...node.limits, maxCostUsd: Math.max(remainingUsd, 0) / perspectives.length },
  };
  let costUsd = 0;
  let interaction: InteractionOutcome;
  const emptyDetail: StepOutcomeDetail = { kind: 'agent', session: EMPTY_SESSION };
  try {
    interaction = await dispatchAgentStep(shared, reviewAgent, ctx, 'swarm-review', {
      perspectives,
      failFast: true,
      onParticipant: (participant) => {
        costUsd += participant.session.usage.costUsd ?? 0;
        return recordUsage(node, ctx, model, participant);
      },
      cwd: lane.path,
    });
  } catch (cause) {
    // `specs/22` M15 P9: mirrors round 0's own identical catch at the top of `runSwarmReviewStep` --
    // `dispatchAgentStep` CAN throw (a raw adapter crash, not merely a session resolving `ok: false`),
    // and round 0's own call to it is wrapped for exactly this reason. This call site, round 1+'s own
    // re-review, had no equivalent handling before a round-3 gauntlet critic reproduced directly that
    // it crashed the whole run (`executeStep` rejecting) instead of resolving to a typed
    // `{status: 'failed', ...}`, for a round-1+ perspective session that throws the identical way the
    // existing round-0 test already covers for round 0 alone.
    if (cause instanceof TelemetryError) throw cause;
    if (isAssemblyRefusal(cause) || (isForgeError(cause) && cause.code === 'RUN-056')) {
      return { reviews: [], detail: emptyDetail, failure: refusalFailure(cause), costUsd };
    }
    const message = messageOf(cause);
    await ctx.telemetry.emit({
      type: 'AdapterError',
      stepId: node.id,
      agentId: node.agent,
      payload: { message },
    });
    return {
      reviews: [],
      detail: emptyDetail,
      failure: {
        source: 'adapter',
        code: isForgeError(cause) ? cause.code : undefined,
        message: `round ${String(round)}'s re-review: ${message}`,
      },
      costUsd,
    };
  }
  const participants = interaction.participants ?? [];
  const detail = interaction.outcome.detail;
  const broken = participants.find((participant) => !participant.session.ok);
  if (broken !== undefined) {
    return {
      reviews: [],
      detail,
      failure: {
        source: 'adapter',
        code: broken.session.error?.code,
        message: `The ${broken.role} session ended without success: ${broken.session.error?.message ?? 'no reason given'}. No ReviewReport was written (round ${String(round)}).`,
      },
      costUsd,
    };
  }
  const reviews = interaction.perspectiveReviews ?? [];
  const unreadable = reviews
    .filter(
      (review) =>
        !review.structured ||
        (review.dropped > 0 && !review.findings.some((finding) => finding.severity === 'blocking')),
    )
    .map((review) => review.perspective);
  if (unreadable.length > 0) {
    return {
      reviews: [],
      detail,
      failure: outputFailure(
        node,
        `the ${unreadable.join(', ')} perspective(s) returned no structured findings, or findings with malformed entries, on round ${String(round)}'s re-review: a review that produced nothing readable is not recorded as a clean one`,
      ),
      costUsd,
    };
  }
  return { reviews, detail, costUsd };
}

// --- the step ----------------------------------------------------------------------------------------

/**
 * Runs a `swarm-review` agent step: the perspectives, then the engine-written, engine-validated report in
 * the step's own lane. Every failure is a typed `StepOutcome`, as for any agent step.
 */
export async function runSwarmReviewStep(
  node: StepNode,
  ctx: ExecuteStepContext,
): Promise<StepOutcome> {
  const startedAt = ctx.now();
  // `PLAN-M14.md` P19: `agentId` and (when the compiled plan attached any) `payload.gateEvidence`, the
  // identical shape `runAgentStep` (`dispatch/steps.ts`) emits and for the identical reason -- `approve.ts`'s
  // own `GATE-511` conflict check reads this same event either way, and a `swarm-review` step is still an
  // `agent`-kind step (`06` §6.2) whose `StepNode.gateEvidence` `attachDependentGateEvidence` populates the
  // identical way.
  await ctx.telemetry.emit({
    type: 'StepStarted',
    stepId: node.id,
    agentId: node.agent,
    ...(node.gateEvidence !== undefined && node.gateEvidence.length > 0
      ? { payload: { gateEvidence: node.gateEvidence } }
      : {}),
  });

  if (node.agent === undefined) {
    throw new ForgeError('RUN-039', {
      stepId: node.id,
      kind: 'agent (missing its own agent field)',
    });
  }
  // `specs/22` M15 P9, `RUN-116`'s own doc comment (`codes.ts`) has the full reasoning: layer TWO of this
  // codebase's own "computed once, enforced twice" defense-in-depth shape, for the identical self-fix
  // refusal `plan/compile.ts`'s own `fix-agent-equals-reviewer` compile issue already enforces for a real,
  // compiled workflow -- checked here too so a caller that builds a `StepNode` by hand (bypassing the
  // compiler entirely) can never dispatch a fix session as the same agent that flagged it either. Thrown,
  // not returned as a typed `failed(...)` outcome: the identical shape `RUN-039` just above already uses
  // for this same class of "the step's own declared configuration cannot possibly run" refusal, reached
  // before any real work (a lane, a session) has started.
  if (node.fixAgent !== undefined && node.fixAgent === node.agent) {
    throw new ForgeError('RUN-116', { stepId: node.id, agentId: node.fixAgent });
  }
  const emptyDetail: StepOutcomeDetail = { kind: 'agent', session: EMPTY_SESSION };
  const perspectives = node.perspectives ?? [];
  if (perspectives.length === 0) {
    return failed(node, startedAt, ctx.now(), emptyDetail, noPerspectives(node));
  }

  // What the perspectives are about to read (`PLAN-M13.md` P38, Q226, `PLAN-M14.md` P34). A review whose
  // sole unmerged predecessor's lane would fast-forward into the review's own new lane (`base.value.stackedOn`,
  // `lane-base.ts`) reads THAT predecessor lane's worktree, so the diff under review is there; otherwise the
  // project checkout as of now, as before -- including a review whose base would be an in-lane JOIN of
  // several predecessors, or a fast-forward `resolveLaneBase` cannot yet predict without ever creating a lane
  // (`isAncestor` unavailable): no shipped workflow reviews a join, and this module does not create one of
  // its own lane's just to find out. Either way it is resolved before any session runs, and no lane of the
  // review's own exists yet (a refused or failed perspective leaves none behind).
  const base = await resolveLaneBase(node, ctx);
  if (!base.ok) return failed(node, startedAt, ctx.now(), emptyDetail, base.failure);
  // `heads[0]` is always defined here: `stackedOn` is only ever set alongside exactly one `heads` entry
  // (`lane-base.ts`'s own doc comment) -- the same "a plain `as`, not `!`, for a business invariant TS
  // cannot itself prove" exception this codebase already uses elsewhere (`run-engine.ts`'s own `outcomes`
  // index, `lanes.ts`'s own `parseLaneWorktrees`).
  const stackedHead =
    base.value.stackedOn === undefined
      ? undefined
      : (base.value.heads[0] as { readonly id: string; readonly sha: string });
  const reviewedLane = stackedHead === undefined ? undefined : ctx.laneRegistry.get(stackedHead.id);
  let reviewedRevision: string;
  try {
    reviewedRevision =
      stackedHead === undefined || reviewedLane === undefined
        ? await ctx.vcs.resolveRevision('HEAD')
        : stackedHead.sha;
  } catch (cause) {
    return failed(node, startedAt, ctx.now(), emptyDetail, {
      source: 'vcs',
      code: isForgeError(cause) ? cause.code : undefined,
      message: messageOf(cause),
    });
  }

  let interaction: InteractionOutcome;
  let agentId: string;
  // `specs/22` M15 P9: hoisted out of the `try` block below (which used to declare both as block-scoped
  // locals) so the bounded critic loop, running well after this block ends, can dispatch a round-2+
  // re-review with the identical reviewer agent and model round 1 used -- never re-resolved per round,
  // which could in principle pick a different tier if `ctx.assembly.models` were mutated mid-run (it
  // never is, but "the same agent/model for every round" is the plain reading of "fresh-context, not a
  // fresh reviewer" the Mandate's own text implies).
  let agent: AgentDefinition;
  let model: string;
  // `specs/22` M15 P9: every real, reported dollar this step's own sessions have spent so far (round 0's
  // own perspectives, below, then every fix/re-review round the loop runs) -- checked against
  // `node.limits.maxCostUsd` (the step's own FULL declared budget, not the per-round share any one
  // dispatch actually gets) before starting another round, so "a loop cannot outspend maxCostUsd" is a
  // real, cumulative check across the WHOLE step's lifetime, not merely each round's own independent
  // share never being exceeded in isolation.
  let spentUsd = 0;
  // `PLAN-M14.md` P36: whatever `restoreReviewedLane` found and did, from the `finally` below -- read
  // after the try/catch to decide the success-path `RUN-083` failure, and inside the `catch` to annotate
  // an adapter failure with what happened. Initialised (not merely declared) so every read of it, on
  // every path, is of a real value rather than one only some paths assign. `undefined` only when there
  // was never a reviewed lane to restore in the first place (no unmerged predecessor).
  let restoreOutcome: ReviewedLaneRestoreOutcome | undefined = undefined;
  try {
    agent = await ctx.assembly.loadAgent(String(node.agent));
    agentId = agent.id;
    // Every participant session runs the same agent on the same tier: one model to record usage against.
    try {
      model = resolveStepModel(agent, ctx.assembly.models, ctx.adapter.id);
    } catch (cause) {
      // An unmapped tier (`RUN-078`) is a refusal like any other prompt-assembly one: nothing was dispatched.
      throw markRefusal(cause);
    }
    // The step reserved `maxCostUsd` for the WHOLE review; each perspective session gets an equal share, so
    // N perspectives cannot spend N times what the step declared.
    const shared: StepNode = {
      ...node,
      limits: { ...node.limits, maxCostUsd: node.limits.maxCostUsd / perspectives.length },
    };
    try {
      interaction = await dispatchAgentStep(shared, agent, ctx, 'swarm-review', {
        perspectives,
        failFast: true,
        // Recorded as each session ends: a later perspective that throws must not lose what was already spent.
        onParticipant: (participant) => {
          spentUsd += participant.session.usage.costUsd ?? 0;
          return recordUsage(node, ctx, model, participant);
        },
        ...(reviewedLane === undefined ? {} : { cwd: reviewedLane.path }),
      });
    } finally {
      // `PLAN-M14.md` P36: restored on every path THIS call can end on -- a clean return (including one
      // where a participant session itself ended `ok: false`, checked below) or a throw straight out of it
      // (caught below) alike -- not merely the success path the pre-existing guard used to check alone.
      // `reviewedLane === undefined` (no unmerged predecessor the review is stacked on) leaves this
      // `undefined`: there is no predecessor lane of its own to restore.
      if (reviewedLane !== undefined) {
        restoreOutcome = await restoreReviewedLane(ctx, reviewedLane, reviewedRevision);
      }
    }
  } catch (cause) {
    // The event log failing (a usage record the hook could not append) is `executeStep`'s to report (`RUN-038`).
    if (cause instanceof TelemetryError) throw cause;
    if (isAssemblyRefusal(cause) || (isForgeError(cause) && cause.code === 'RUN-056')) {
      return failed(node, startedAt, ctx.now(), emptyDetail, refusalFailure(cause));
    }
    const message = messageOf(cause);
    await ctx.telemetry.emit({
      type: 'AdapterError',
      stepId: node.id,
      agentId: node.agent,
      payload: { message },
    });
    return failed(node, startedAt, ctx.now(), emptyDetail, {
      source: 'adapter',
      code: isForgeError(cause) ? cause.code : undefined,
      message: restoreFailureNote(message, reviewedLane, restoreOutcome),
    });
  }

  // The perspectives are read-only, but they ran inside a lane a merge will land: a change left in it would be
  // carried into the integration branch under the implementer's step, unreviewed. `restoreReviewedLane` (above,
  // in the `finally`) already attempted to put the lane back to `reviewedRevision` by this point --
  // `reviewedLaneNeedsAttention` is fail-closed the identical way the pre-existing guard's own
  // `.catch(() => true)` was: known dirty, OR unknown (could not even be listed), OR the reset attempt itself
  // did not provably succeed, all fail the step here (typed `RUN-083`, never silently accepted) rather than
  // trusting an unconfirmed-clean lane. Only a lane confirmed clean AND confirmed reset lets the step succeed.
  if (
    reviewedLane !== undefined &&
    restoreOutcome !== undefined &&
    reviewedLaneNeedsAttention(restoreOutcome)
  ) {
    return failed(
      node,
      startedAt,
      ctx.now(),
      emptyDetail,
      outputFailure(
        node,
        `a review perspective changed the lane under review (${reviewedLane.path}); the perspectives are read-only, so nothing was recorded -- ${describeRestoreOutcome(reviewedLane, restoreOutcome)}`,
      ),
    );
  }
  const participants = interaction.participants ?? [];
  // `dispatchAgentStep` builds this outcome from the first perspective's session.
  const detail = interaction.outcome.detail;
  const broken = participants.find((participant) => !participant.session.ok);
  if (broken !== undefined) {
    // A review that did not run cannot be persisted as one: an empty report would read as a clean review.
    return failed(node, startedAt, ctx.now(), detail, {
      source: 'adapter',
      code: broken.session.error?.code,
      message: `The ${broken.role} session ended without success: ${broken.session.error?.message ?? 'no reason given'}. No ReviewReport was written.`,
    });
  }
  const reviews = interaction.perspectiveReviews ?? [];
  // A perspective that returned nothing readable has told the engine nothing, not "no findings", and one whose
  // output lost entries as malformed may have lost the blocking one (unless it kept a blocking finding of its
  // own: that is recorded, `blocked` outranks everything): recording either would put a report that
  // looks finished on a step that did not review. Fail the step (a `validation`-class failure, so
  // `retry`/`onFailure` apply) instead. A perspective that is readable but lists no findings and nothing it
  // examined is recorded, as `incomplete` (F-REVIEW-2: that is a finding, not a failure).
  const unreadable = reviews
    .filter(
      (review) =>
        !review.structured ||
        (review.dropped > 0 && !review.findings.some((finding) => finding.severity === 'blocking')),
    )
    .map((review) => review.perspective);
  if (unreadable.length > 0) {
    return failed(
      node,
      startedAt,
      ctx.now(),
      detail,
      outputFailure(
        node,
        `the ${unreadable.join(', ')} perspective(s) returned no structured findings, or findings with malformed entries (the contract is one JSON object with "findings" and "checked", as a structured result or as the one fenced json block of the final answer), so no ReviewReport was written: a review that produced nothing readable is not recorded as a clean one`,
      ),
    );
  }

  // `specs/22` M15 P9: `ctx.criticRounds` absent/0 is the bare-engine-context default (`ExecuteStepContext
  // .criticRounds`'s own doc comment) -- EVERY test fixture and caller built before this piece existed
  // leaves it unset, so `maxRounds <= 0` takes the entirely unchanged, byte-identical-to-pre-P9 branch
  // below: one report, `RUN-108` on a `blocked` verdict, no looping ever attempted. Real runs get a real
  // cap (`buildRunEngineContext`, default 3) and take the bounded-critic-loop branch further down.
  const maxRounds = ctx.criticRounds ?? 0;

  if (maxRounds <= 0) {
    let report: WrittenReport | undefined;
    const outcome = await runLaneLifecycle(
      withReviewReportOutput(node),
      ctx,
      startedAt,
      detail,
      async (lane, baseSha) => {
        try {
          const written = await writeReport(
            node,
            ctx,
            lane,
            baseSha,
            agentId,
            reviews,
            reviewedRevision,
            0, // this branch has no round concept at all -- byte-identical to pre-P9 behaviour
          );
          report = written;
          return { changed: true, commitSubject: `swarm review ${written.id}`, detail };
        } catch (cause) {
          // The event log failing is an infrastructure failure `executeStep` reports as such (`RUN-038`), not
          // this step's report failing to be written.
          if (cause instanceof TelemetryError) throw cause;
          return {
            changed: false,
            commitSubject: 'swarm review report not written',
            detail,
            failure: outputFailure(
              node,
              `the engine could not write the swarm-review ReviewReport: ${messageOf(cause)}`,
            ),
          };
        }
      },
    );
    // `PLAN-M14.md` P14, `SPEC-QUESTIONS.md` Q232 decision 7: the report is committed on its lane exactly as
    // any other verdict's -- `runLaneLifecycle` already ran the P7 output check against it, emitted
    // `LaneReady` and registered the lane (precedent for a `LaneReady`'d lane whose step still ends failed:
    // `executeStep`'s own doc comment, Q217 (g)) -- but a `blocked` review must never reach a merge, so the
    // lane is pulled back out of the registry `runLaneLifecycle` just added it to, and the step itself ends
    // failed instead of succeeded. Checked strictly before the `ArtifactCreated` emission below: that event
    // is only ever for a step that actually succeeded.
    if (outcome.status === 'succeeded' && report?.content.verdict === 'blocked') {
      ctx.laneRegistry.delete(node.id);
      return failed(
        node,
        outcome.startedAt,
        outcome.finishedAt,
        outcome.detail,
        blockedVerdictFailure(node, report.file, countBlockingFindings(report.text)),
      );
    }
    // Only for a report that survived the commit, the claim and the output check: the log must not say an
    // artifact was created for a step that then failed. `laneFile`, not `path`: the file lives on the lane
    // branch until a merge, and `path` is what resume re-validates against the project checkout.
    if (outcome.status === 'succeeded' && report !== undefined) {
      await ctx.telemetry.emit({
        type: 'ArtifactCreated',
        stepId: node.id,
        agentId: node.agent,
        payload: {
          type: 'ReviewReport',
          id: report.id,
          laneFile: report.file,
          verdict: report.content.verdict,
          perspectives: report.content.perspectives.map((p) => ({
            name: p.name,
            verdict: p.verdict,
          })),
        },
      });
    }
    return outcome;
  }

  // `specs/22` M15 P9: the bounded critic loop -- `review` -> (findings) -> `fix` -> `review`, bounded by
  // `maxRounds`. "Round N" counts FIX-AND-RE-REVIEW cycles, not review passes: the very first review
  // above (round 1's perspectives, already dispatched, before `maxRounds` was even read) is round 0's own
  // triggering event, not itself a consumed round -- "a finding fixed in round 1" means the FIRST
  // fix-and-re-review cycle resolved it, matching `execution.criticRounds`'s own plain reading ("the
  // (findings) -> fix -> review sequence can repeat up to this many times"), the same mapping this
  // engine's own build process uses for its own gauntlet rounds (BUILD, then up to N CRITIC rounds).
  // Everything from here runs INSIDE the one `runLaneLifecycle` call's own `runWork` -- a single lane,
  // created once, a single eventual commit covering every round's own changes (fix sessions' writes AND
  // the final report alike), a single claim enforcement (`review`'s own widened `produces`, `18` §18.7) and
  // a single P7 output check against whatever the LAST round actually wrote. Resume (`resumeSwarmReviewStep`
  // below) needs no round-level awareness at all: a lane with no committed report yet is simply discarded
  // and the WHOLE step (every round) restarts from round 0 -- the identical, already-established "zero
  // sessions resumed, or a full redo" contract this step has always had.
  let report: WrittenReport | undefined;
  let roundsConsumed = 0;
  const outcome = await runLaneLifecycle(
    withReviewReportOutput(node),
    ctx,
    startedAt,
    detail,
    async (lane, baseSha) => {
      let roundReviews = reviews;
      let reportId: string | undefined;
      for (;;) {
        let written: WrittenReport;
        try {
          written =
            reportId === undefined
              ? await writeReport(
                  node,
                  ctx,
                  lane,
                  baseSha,
                  agentId,
                  roundReviews,
                  reviewedRevision,
                  roundsConsumed,
                )
              : await renderAndWriteReport(
                  node,
                  ctx,
                  lane,
                  reportId,
                  agentId,
                  roundReviews,
                  reviewedRevision,
                  baseSha,
                  roundsConsumed,
                );
        } catch (cause) {
          if (cause instanceof TelemetryError) throw cause;
          return {
            changed: reportId !== undefined,
            commitSubject: 'swarm review report not written',
            detail,
            failure: outputFailure(
              node,
              `the engine could not write the swarm-review ReviewReport: ${messageOf(cause)}`,
            ),
          };
        }
        reportId = written.id;
        report = written;
        const blockingCount = countBlockingFindings(written.text);
        // `specs/22` M15 P9: one `StepProgress` per round (an already-reserved, never-yet-emitted
        // `EventType`, reused rather than a new one invented for this -- M14 P44's own "new payload
        // kinds on existing event types where possible" precedent). `round: 0` is the triggering review
        // before any fix was ever attempted; `round: N >= 1` is the Nth fix-and-re-review cycle's OWN
        // re-review. This is the full record `execution.criticRounds`'s own Mandate text calls for
        // ("round count and outcome are emitted as events") -- read by a later piece (P11) to measure,
        // and the only place this step's own per-round history is recorded at all: the committed
        // `ReviewReport` itself only ever holds the LAST round's own content.
        await ctx.telemetry.emit({
          type: 'StepProgress',
          stepId: node.id,
          laneId: lane.laneId,
          agentId: node.agent,
          payload: {
            kind: 'critic-round',
            round: roundsConsumed,
            reportId: written.id,
            verdict: written.content.verdict,
            blockingCount,
          },
        });
        if (written.content.verdict !== 'blocked') {
          return { changed: true, commitSubject: `swarm review ${written.id}`, detail };
        }
        // `specs/22` M15 P9's own "budget caps still bound the loop (a loop cannot outspend maxCostUsd)":
        // checked here, BEFORE committing to another round's own fix-plus-re-review spend, against every
        // real dollar this step's own sessions have spent so far (round 0's perspectives, `spentUsd`'s own
        // doc comment above, plus every completed round's own fix/re-review, accumulated below). Treated
        // exactly like round-cap exhaustion -- the same `RUN-113`, naming however many rounds genuinely
        // ran (`roundsConsumed`, not `maxRounds`): a budget ceiling and a round ceiling are two different
        // reasons for the identical real outcome ("this loop cannot safely continue"), not two codes.
        // `RUN-113`'s own doc comment (`codes.ts`) has the fuller reasoning for why this holds even when
        // `roundsConsumed` is still `0` here -- round 0's own perspectives can themselves exhaust the
        // WHOLE budget before any fix is ever attempted (a round-1 gauntlet critic found an earlier
        // version of this file's own comments overclaimed RUN-113 always means "a fix was attempted,"
        // when the honest claim is narrower: "the loop was configured and engaged, and could not
        // safely continue," which is equally true at zero rounds consumed.
        if (roundsConsumed >= maxRounds || spentUsd >= node.limits.maxCostUsd) {
          return {
            changed: true,
            commitSubject: `swarm review ${written.id}`,
            detail,
            failure: exhaustedVerdictFailure(node, written.file, roundsConsumed, blockingCount),
          };
        }
        roundsConsumed += 1;
        const fix = await runFixRound(
          node,
          ctx,
          lane,
          baseSha,
          `Round ${String(roundsConsumed)}'s swarm review -- the full ${written.id} report:\n\n${written.text}`,
          // `specs/22` M15 P9: the REMAINING budget, not the step's full nominal `maxCostUsd` -- a round-1
          // gauntlet critic found an earlier version gave the fix session the whole, undivided total every
          // round, letting one round's own fix-plus-re-review spend close to 2x the declared cap before
          // the loop-top gate above ever got another chance to stop it. `runFixRound`'s own doc comment
          // has the fuller reasoning for why this caps the ONE fix session directly, unlike the
          // perspectives below, which still divide their own remaining share by count.
          node.limits.maxCostUsd - spentUsd,
        );
        spentUsd += fix.costUsd;
        if (fix.failure !== undefined) {
          return {
            changed: true,
            commitSubject: `swarm review fix round ${String(roundsConsumed)}`,
            detail: fix.detail,
            failure: fix.failure,
          };
        }
        const reReview = await rereviewInLane(
          node,
          ctx,
          agent,
          model,
          perspectives,
          lane,
          roundsConsumed,
          written.text,
          // `specs/22` M15 P9: the REMAINING budget AFTER the fix session's own real spend above, divided
          // across perspectives the identical way round 0's own perspectives already divide the step's
          // full budget -- not the step's full nominal `maxCostUsd` a round-1 gauntlet critic found an
          // earlier version used here regardless of what round 0 and this round's own fix had already spent.
          node.limits.maxCostUsd - spentUsd,
        );
        spentUsd += reReview.costUsd;
        if (reReview.failure !== undefined) {
          return {
            changed: true,
            commitSubject: `swarm review re-review round ${String(roundsConsumed)}`,
            detail: reReview.detail,
            failure: reReview.failure,
          };
        }
        roundReviews = reReview.reviews;
      }
    },
  );
  // Only for a report that survived the commit, the claim and the output check: the log must not say an
  // artifact was created for a step that then failed (the exhausted-loop case above is `work.failure`,
  // never reaches here). `laneFile`, not `path`: the file lives on the lane branch until a merge, and
  // `path` is what resume re-validates against the project checkout. No post-hoc `ctx.laneRegistry.delete`
  // dance is needed for the exhausted case the way the `maxRounds <= 0` branch above still needs one for
  // `RUN-108`: `runLaneLifecycle`'s own `work.failure !== undefined` path returns BEFORE it ever calls
  // `ctx.laneRegistry.set`, so an exhausted loop's lane is never registered for merging in the first place.
  if (outcome.status === 'succeeded' && report !== undefined) {
    await ctx.telemetry.emit({
      type: 'ArtifactCreated',
      stepId: node.id,
      agentId: node.agent,
      payload: {
        type: 'ReviewReport',
        id: report.id,
        laneFile: report.file,
        verdict: report.content.verdict,
        perspectives: report.content.perspectives.map((p) => ({
          name: p.name,
          verdict: p.verdict,
        })),
      },
    });
  }
  return outcome;
}

/**
 * `resume` for a `swarm-review` step whose lane exists (`06` §6.10): if that lane already committed the
 * report for this (run, step), finish it (the output check and `LaneReady`) without running a single
 * perspective again; otherwise return `undefined`, and the caller discards the lane and re-runs the step.
 * Either way no second `REVIEW-NNN` for the step can appear.
 */
export async function resumeSwarmReviewStep(
  node: StepNode,
  ctx: ExecuteStepContext,
  lane: LaneHandle,
  baseSha: string,
): Promise<StepOutcome | undefined> {
  const reportsDir = reportsDirOf(ctx);
  let changed: Awaited<ReturnType<ExecuteStepContext['vcs']['changedFiles']>>;
  try {
    changed = await ctx.vcs.changedFiles(lane, baseSha);
  } catch {
    // A lane that cannot even be inspected (its worktree is gone) holds nothing to finish: the caller
    // discards what is left of it and re-runs the step.
    return undefined;
  }
  let found: { readonly file: string; readonly text: string } | undefined;
  for (const file of changed.committed) {
    if (path.posix.dirname(file) !== reportsDir || !REPORT_FILE.test(path.posix.basename(file))) {
      continue;
    }
    const text = await ctx.vcs.readAtRevision(lane, 'HEAD', file);
    if (text !== undefined && isProvenance(text, node.id, ctx.runId)) {
      found = { file, text };
      break;
    }
  }
  if (found === undefined) return undefined;
  const detail: StepOutcomeDetail = { kind: 'agent', session: EMPTY_SESSION };
  const outcome = await runLaneLifecycle(
    withReviewReportOutput(node),
    ctx,
    ctx.now(),
    detail,
    () =>
      Promise.resolve({
        changed: false,
        commitSubject: 'swarm review report already committed',
        detail,
      }),
    { lane, baseSha },
  );
  // `PLAN-M14.md` P14, `SPEC-QUESTIONS.md` Q232 decision 7: re-applies the same rule from the report
  // already on the lane, with zero sessions -- the committed text is the exact text the output check just
  // re-validated (nothing changed the lane between the read above and here), so parsing it again here is
  // safe. The front matter, never the rendered body: a perspective's own text can reach the body, never
  // the front matter (`review-report.ts`'s own doc comment).
  if (outcome.status === 'succeeded') {
    const frontMatter = ArtifactDocument.parse(found.text, found.file).frontMatter as Record<
      string,
      unknown
    >;
    if (parseReviewVerdict(frontMatter) === 'blocked') {
      ctx.laneRegistry.delete(node.id);
      // `specs/22` M15 P9: `rounds` (`review-report.ts`'s own `parseReviewRounds`, written into this exact
      // front matter at commit time) is the one thing this function -- zero sessions, no event log read
      // -- has to tell a never-looped `blocked` report (`RUN-108`) from a genuinely-exhausted one
      // (`RUN-113`) apart: a crash in the window between the exhausted loop's own final commit and this
      // step's failure being durably recorded previously left resume unconditionally applying `RUN-108`
      // to BOTH cases, making `RUN-113`'s own remedy text's claim that "forge resume re-applies this same
      // rule" simply false -- found by two independent round-1 gauntlet critics.
      //
      // `rounds > 0` alone is not quite enough, though: a round-2 critic found and reproduced one real
      // remaining ambiguity at `rounds === 0` specifically. The loop's own live-execution code
      // (`maxRounds > 0` branch above) can write a GENUINELY exhausted, `rounds: 0` report whenever round
      // 0's own perspectives alone exhaust `node.limits.maxCostUsd` before a first fix is EVER attempted
      // (the shipped "budget exhausted entirely at round 0" test exercises exactly this, and correctly
      // expects `RUN-113`) -- indistinguishable, by `rounds` alone, from a step that was never configured
      // to loop at all (`ctx.criticRounds` absent/0, the ordinary `RUN-108` case). `ctx.criticRounds`
      // resolves this: round-cap exhaustion at `rounds === 0` is structurally impossible whenever
      // `maxRounds > 0` (the loop's own exhaustion check only runs AFTER `roundsConsumed` has already
      // been checked against `maxRounds`, and `roundsConsumed` is 0 only on the very first pass) -- so
      // `rounds === 0` AND `(ctx.criticRounds ?? 0) > 0` can ONLY mean the budget-exhausted-at-round-0
      // case, never a round-cap one.
      const rounds = parseReviewRounds(frontMatter);
      const exhausted = rounds > 0 || (ctx.criticRounds ?? 0) > 0;
      return failed(
        node,
        outcome.startedAt,
        outcome.finishedAt,
        outcome.detail,
        exhausted
          ? exhaustedVerdictFailure(node, found.file, rounds, countBlockingFindings(found.text))
          : blockedVerdictFailure(node, found.file, countBlockingFindings(found.text)),
      );
    }
  }
  return outcome;
}
