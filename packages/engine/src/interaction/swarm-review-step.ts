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
import { ProjectPaths, writeFileAtomic } from '@forge/core/fs';
import { definitionForType } from '@forge/schemas';
import { TelemetryError } from '@forge/telemetry/errors';

import { isAssemblyRefusal, markRefusal, refusalFailure } from '../dispatch/assemble.ts';
import { docRootsOf, documentProblems, outputPathFor } from '../dispatch/outputs.ts';
import { directoryIdScan, reserveIds } from '../dispatch/output-ids.ts';
import { resolveLaneBase } from '../dispatch/lane-base.ts';
import { runLaneLifecycle, sanitizeUsageNumber } from '../dispatch/steps.ts';
import type {
  ExecuteStepContext,
  LaneHandle,
  StepFailureInfo,
  StepOutcome,
  StepOutcomeDetail,
} from '../dispatch/types.ts';
import type { StepNode } from '../plan/index.ts';
import { dispatchAgentStep } from './dispatch-agent-step.ts';
import {
  buildReviewReport,
  countBlockingFindings,
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
  await ctx.telemetry.emit({
    type: 'UsageRecorded',
    stepId: node.id,
    agentId: node.agent,
    payload: {
      model,
      platform: ctx.adapter.id,
      inputTokens: sanitizeUsageNumber(session.session.usage.inputTokens),
      outputTokens: sanitizeUsageNumber(session.session.usage.outputTokens),
      cacheReadTokens: 0,
      costUsd:
        session.session.usage.costUsd === undefined
          ? 0
          : sanitizeUsageNumber(session.session.usage.costUsd),
      estimated: true,
      durationMs: sanitizeUsageNumber(session.session.durationMs),
      role: session.role,
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
 * Builds, validates and writes the report into the lane's worktree. Validation is `documentProblems`, the
 * function the output check applies afterwards; a document that fails it is never written.
 */
async function writeReport(
  node: StepNode,
  ctx: ExecuteStepContext,
  lane: LaneHandle,
  baseSha: string,
  agentId: string,
  reviews: readonly PerspectiveReview[],
  reviewedRevision: string,
): Promise<WrittenReport> {
  const id = await allocateNumber(node, ctx, lane);
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
  await ctx.telemetry.emit({ type: 'StepStarted', stepId: node.id });

  if (node.agent === undefined) {
    throw new ForgeError('RUN-039', {
      stepId: node.id,
      kind: 'agent (missing its own agent field)',
    });
  }
  const emptyDetail: StepOutcomeDetail = { kind: 'agent', session: EMPTY_SESSION };
  const perspectives = node.perspectives ?? [];
  if (perspectives.length === 0) {
    return failed(node, startedAt, ctx.now(), emptyDetail, noPerspectives(node));
  }

  // What the perspectives are about to read (`PLAN-M13.md` P38, Q226). A review stacked on the lane it reviews (its
  // predecessor's unmerged lane in the same merge, `lane-base.ts`) reads THAT lane's worktree, so the diff under
  // review is there; otherwise the project checkout as of now, as before. Either way it is resolved before any
  // session runs, and no lane of the review's own exists yet (a refused or failed perspective leaves none behind).
  const base = await resolveLaneBase(node, ctx);
  if (!base.ok) return failed(node, startedAt, ctx.now(), emptyDetail, base.failure);
  const reviewedLane =
    base.value.stackedOn === undefined ? undefined : ctx.laneRegistry.get(base.value.stackedOn);
  let reviewedRevision: string;
  try {
    reviewedRevision =
      reviewedLane === undefined ? await ctx.vcs.resolveRevision('HEAD') : base.value.sha;
  } catch (cause) {
    return failed(node, startedAt, ctx.now(), emptyDetail, {
      source: 'vcs',
      code: isForgeError(cause) ? cause.code : undefined,
      message: messageOf(cause),
    });
  }

  let interaction: InteractionOutcome;
  let agentId: string;
  try {
    const agent = await ctx.assembly.loadAgent(String(node.agent));
    agentId = agent.id;
    // Every participant session runs the same agent on the same tier: one model to record usage against.
    let model: string;
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
    interaction = await dispatchAgentStep(shared, agent, ctx, 'swarm-review', {
      perspectives,
      failFast: true,
      // Recorded as each session ends: a later perspective that throws must not lose what was already spent.
      onParticipant: (participant) => recordUsage(node, ctx, model, participant),
      ...(reviewedLane === undefined ? {} : { cwd: reviewedLane.path }),
    });
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
      message,
    });
  }

  // The perspectives are read-only, but they ran inside a lane a merge will land: a change left in it would be
  // carried into the integration branch under the implementer's step, unreviewed. Checked before anything is
  // recorded, and failed closed.
  if (reviewedLane !== undefined) {
    const dirtied = await ctx.vcs.hasChanges(reviewedLane, base.value.sha).catch(() => true);
    if (dirtied) {
      return failed(
        node,
        startedAt,
        ctx.now(),
        emptyDetail,
        outputFailure(
          node,
          `a review perspective changed the lane under review (${reviewedLane.path}); the perspectives are read-only, so nothing was recorded and the lane needs inspecting before it is merged`,
        ),
      );
    }
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
      return failed(
        node,
        outcome.startedAt,
        outcome.finishedAt,
        outcome.detail,
        blockedVerdictFailure(node, found.file, countBlockingFindings(found.text)),
      );
    }
  }
  return outcome;
}
