/**
 * The five real per-kind handlers `executeStep` (`execute.ts`) dispatches to — `agent`/`command` each
 * drive `06` §6.4's own lane lifecycle (create → run → commit → enforce claim), `gate` drives `10` §10.3's
 * mechanism (`@forge/engine/gates`, P14), `merge` drives `06` §6.5's queue (`@forge/vcs`), `checkpoint` is
 * a marker with no side effect of its own (`types.ts`'s own `StepOutcomeDetail` doc comment has the
 * reasoning).
 *
 * A genuine runtime failure (an adapter session erroring, a `VcsError`/`TelemetryError`, a nonzero exit, a
 * gate rejecting, a merge conflicting) is always returned as a `StepOutcome{status:'failed'}`, never
 * thrown — the same "describe a failure as data" shape `@forge/engine/plan`'s own `compileRunPlan` (P11)
 * and `@forge/engine/gates`' own `evaluateGate` (P14) already establish. A malformed *input* this piece has
 * no way to have reached given an earlier, already-built validation pass (an `agent`-kind node missing its
 * own `agent` field, a `gate`-kind node naming an unregistered gate id) throws a `ForgeError` instead — the
 * identical "structural/config errors throw; expected runtime outcomes are data" split `Scheduler`'s own
 * `RUN-036` constructor check (P12) already establishes for the identical class of "should never happen
 * given a well-formed caller, but do not silently corrupt anything if it does" input.
 *
 * @see specs/06 §6.4, §6.5, §6.7, §6.8
 * @see specs/10 §10.1, §10.3
 * @see SPEC-QUESTIONS.md Q62
 * @see PLAN-M5.md P15
 */
import path from 'node:path';

import { FORGE_AGENT_ID, FORGE_RUN_ID, FORGE_STEP_ID } from '@forge/core';
import { ArtifactDocument } from '@forge/core/artifacts';
import { ForgeError, isForgeError } from '@forge/core/errors';
import type { SessionRequest, SessionResult } from '@forge/adapter-kit';
import { artifactTypeById } from '@forge/schemas';
import { minimatch } from 'minimatch';

import { recordChecks } from '../gates/index.ts';
import { parseReviewVerdict, type ReviewVerdict } from '../interaction/review-report.ts';
import { mergeLandingScope, upstreamOf, type StepNode } from '../plan/index.ts';
import { assertGateApprovalAllowed } from '../security/taint-guard.ts';
import {
  promptRecordDirName,
  refusalFailure,
  resumePrompt,
  tryAssemble,
  tryResolveSessionModel,
  type AssembledSession,
} from './assemble.ts';
import { expandRequestedContext } from './context-expansion.ts';
import { GateNotFoundError } from './facades.ts';
import { contentLanded, landLane, resolveLaneChecks } from './integrate.ts';
import { restoreIntegrationTree, snapshotIntegrationTree } from './inline-tree.ts';
import { resolveLaneBase } from './lane-base.ts';
import { reserveDeclaredKbOutputIds, type KbOutputReservation } from './output-ids.ts';
import {
  docRootsOf,
  outputGlob,
  outputPathFor,
  resolveStepClaim,
  verifyDeclaredOutputs,
} from './outputs.ts';
import { clearResultRecord, writeResultRecord, type ResultRecordRef } from './result-record.ts';
import { commandStepEnvironment } from './elicit.ts';
import { runShellCommand } from './shell.ts';
import { runVcsStep } from './vcs-step.ts';
import type {
  DocRoots,
  ExecuteStepContext,
  LaneHandle,
  MergeOutcome,
  StepFailureInfo,
  StepOutcome,
  StepOutcomeDetail,
} from './types.ts';

/** A gauntlet critic round found `session.usage`'s own numeric fields are not trustworthy input:
 * `@forge/adapter-claude-code`'s own real SDK/CLI mapping (`map-message.ts`/`parse-event.ts`) accepts
 * any `typeof value === 'number'` from raw, external JSON with no finite/non-negative check, unlike
 * `@forge/adapter-kit`'s own event schema for the generic adapter -- so a real platform's own malformed
 * or hostile `total_cost_usd` (`NaN`, negative, `Infinity`) could previously flow straight through this
 * module's own `UsageRecorded` emission into `@forge/telemetry/ledger`'s own `toLedgerEntry`, which
 * throws for exactly this shape (`isFiniteNonNegativeNumber`) -- turning one bad upstream number into an
 * unhandled crash of the *entire run* the moment `@forge/engine/budget`'s own live `canAdmit` refresh
 * next reads this run's own ledger, rather than a graceful, data-shaped step outcome. Sanitised here, at
 * the one place this module turns adapter-reported usage into a durable event: a non-finite or negative
 * value is treated the identical "unknown, not fabricated as free" way `session.usage.costUsd ??
 * 0`'s own missing case already is, never passed through raw. */
export function sanitizeUsageNumber(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function succeeded(
  stepId: string,
  startedAt: number,
  finishedAt: number,
  detail: StepOutcomeDetail,
): StepOutcome {
  return { stepId, status: 'succeeded', startedAt, finishedAt, detail };
}

function failed(
  stepId: string,
  startedAt: number,
  finishedAt: number,
  detail: StepOutcomeDetail,
  failure: StepFailureInfo,
): StepOutcome {
  return { stepId, status: 'failed', startedAt, finishedAt, detail, failure };
}

/** `06` §6.4 step 3's own commit — built here on the session's behalf, not left to the agent's own tool
 * use to perform: `@forge/testkit`'s own `FakePlatformAdapter` runs a scripted, fake session that cannot
 * itself invoke a real `git commit` unless a test explicitly scripts that, and a real adapter session has
 * no way to know this repository's own conventional-commit trailer format (`Forge-Step`/`Forge-Run`/
 * `Co-Authored-By`) without being told — this function is that telling. `scope` is `node.id`'s own
 * workflow-qualified prefix (everything before the first `:`, `compileStepId`'s own format,
 * `@forge/engine/plan`), a reasonable stand-in for `06` §6.4's own worked example ("story") without this
 * module needing its own concept of "story" at all. */
function buildCommitMessage(node: StepNode, ctx: ExecuteStepContext, subject: string): string {
  // `?? node.id`: required by noUncheckedIndexedAccess, not reachable in practice -- String.split
  // always returns at least one element for any string input (including ''), so index 0 is never
  // actually undefined here; kept as the type checker's own required form rather than an assertion,
  // matching this codebase's established stance for the identical class of guard elsewhere.
  const scope = node.id.split(':')[0] ?? node.id;
  return [
    `forge(${scope}): ${subject}`,
    '',
    `Forge-Step: ${node.id}`,
    `Forge-Run: ${ctx.runId}`,
  ].join('\n');
}

/** Bound on the paths a `PolicyViolation` event lists (the totals are always recorded). */
const MAX_VIOLATION_PATHS_LOGGED = 50;

/** Bound on how many out-of-claim paths `RUN-104`'s own message names — tighter than the event's own
 * `MAX_VIOLATION_PATHS_LOGGED` above: the event is the durable, more-complete record (it always carries
 * the true totals too, whichever bound its own path list hits); this is a one-line failure message a
 * terminal prints. */
const MAX_CLAIM_FAILURE_PATHS = 5;

/** How long a single path may run in `RUN-104`'s own message before being cut, mirroring `outputs.ts`'s
 * own `MAX_PROBLEM_CHARS` discipline for the identical reason: an agent-controlled path is untrusted text
 * reaching the terminal and the event log. */
const MAX_CLAIM_FAILURE_PATH_CHARS = 300;

/** The same character classes `outputs.ts`'s own `clip` strips, duplicated here rather than imported:
 * `outputs.ts` exports neither it nor its `CONTROL_CHARS` (this piece's own Surface list does not touch
 * that file), and a claim-failure path is exactly the same class of untrusted, agent-controlled text that
 * function already exists to sanitise before it reaches a terminal or the event log. */
const CLAIM_FAILURE_CONTROL_CHARS =
  // eslint-disable-next-line no-control-regex -- the point is to match control characters
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g;

function clipClaimPath(path: string): string {
  const clean = path.replace(CLAIM_FAILURE_CONTROL_CHARS, ' ');
  return clean.length > MAX_CLAIM_FAILURE_PATH_CHARS
    ? `${clean.slice(0, MAX_CLAIM_FAILURE_PATH_CHARS)}...`
    : clean;
}

function listClaimFailurePaths(paths: readonly string[]): string {
  const shown = paths.slice(0, MAX_CLAIM_FAILURE_PATHS).map(clipClaimPath).join(', ');
  return paths.length > MAX_CLAIM_FAILURE_PATHS
    ? `${shown}, and ${String(paths.length - MAX_CLAIM_FAILURE_PATHS)} more`
    : shown;
}

/** Whether any `reverted` path sits at a declared output's own registry location (`outputGlob` — the very
 * derivation `resolveStepClaim` unions the claim from, so this asks the identical question the claim
 * itself was built from) — the one way a legitimate output's own path can still end up reverted: a
 * `produces` exclusion (`!<glob>`, `PLAN-M13.md` P36) that happens to carve the declared output's own
 * registry path back out of the claim `outputClaimGlobs` put it in. When it does, `RUN-104` keeps the P7
 * output check's own "check the project's configured docs roots" hint (`outputs.ts`'s own `checkOne`), so
 * the remedy for "my declared output was reverted" reads the same whichever of the two failures reports
 * it. */
function claimFailureHint(node: StepNode, roots: DocRoots, reverted: readonly string[]): string {
  const atDeclaredOutput = node.outputs.some((output) => {
    const definition = artifactTypeById(output.type);
    return (
      definition !== undefined &&
      reverted.some((file) => minimatch(file, outputGlob(definition.id, roots), { dot: true }))
    );
  });
  return atDeclaredOutput
    ? ' A declared output’s own registry path is among what was reverted; check the project’s configured docs roots.'
    : '';
}

/** `RUN-104`'s own `detail`: every out-of-claim path, bounded, plus the true total (`06` §6.7 as amended,
 * `PLAN-M14.md` P3, `SPEC-QUESTIONS.md` Q232 decision 1). The policy itself is not repeated here: the
 * `RUN-104` message template (`codes.ts`) already states it once ("wrote outside its claim under
 * ${policy} enforcement"). */
function claimFailureDetail(
  node: StepNode,
  roots: DocRoots,
  outOfClaim: readonly string[],
  reverted: readonly string[],
): string {
  return (
    `${String(outOfClaim.length)} path(s): ${listClaimFailurePaths(outOfClaim)}.` +
    claimFailureHint(node, roots, reverted)
  );
}

/** The `StepFailureInfo` `runLaneLifecycle` returns when `strict` finds a non-empty `outOfClaim` (`06`
 * §6.7 as amended, `SPEC-QUESTIONS.md` Q232 decision 1): `source: 'claim'`, always `RUN-104`, classified
 * `policy` by `classifyFailure` (never retried — the same session writing the same stray path violates
 * the same claim identically). */
function claimFailure(
  node: StepNode,
  roots: DocRoots,
  policy: 'strict' | 'warn',
  outOfClaim: readonly string[],
  reverted: readonly string[],
): StepFailureInfo {
  const error = new ForgeError('RUN-104', {
    stepId: node.id,
    policy,
    detail: claimFailureDetail(node, roots, outOfClaim, reverted),
  });
  return {
    source: 'claim',
    code: error.code,
    message: `${error.message} -- Remedy: ${error.remedy}`,
    cause: error,
  };
}

/** `PLAN-M14.md` P34: `Forge-Step`/`Forge-Run` trailers on an in-lane join commit — the identical
 * "conventional-commit trailer format" `buildCommitMessage` above already gives lane work commits,
 * applied to a join instead: `headStepId` is the predecessor whose head is being merged in. */
function buildJoinCommitMessage(ctx: ExecuteStepContext, headStepId: string): string {
  return [`Join ${headStepId}`, '', `Forge-Step: ${headStepId}`, `Forge-Run: ${ctx.runId}`].join(
    '\n',
  );
}

/** `headStepId`/`ctx.runId` are interpolated into an in-lane join's own commit trailers
 * (`buildJoinCommitMessage`'s own `Forge-Step`/`Forge-Run`) — a bare newline in either would forge a
 * second trailer line into the permanent join-commit audit trail, the identical concern `@forge/vcs`'s
 * own `assertSingleLine` (`commit.ts`) already guards the landing-time analogue against
 * (`processMergeCandidate`'s own `stepId`/`runId`/`laneId` checks). This module never imports
 * `@forge/vcs` directly (only through `ctx.vcs`, this file's own established convention — every real
 * git call goes through the facade) so the check is duplicated locally rather than imported, the same
 * "duplicated here rather than imported" precedent `CLAIM_FAILURE_CONTROL_CHARS` above already sets for
 * the identical reason. `ctx.runId` is never attacker-influenced in practice (a FORGE-generated id) but
 * is checked anyway, the identical belt-and-braces stance `processMergeCandidate` already takes for it. */
function hasNewline(value: string): boolean {
  return value.includes('\n') || value.includes('\r');
}

/** Reuses `VCS-INVALID-COMMIT-FIELD` — the identical code `assertSingleLine` itself throws for the
 * landing-time analogue — so `classifyFailure`'s own existing `VCS-INVALID-*` → `validation` mapping
 * (`classify.ts`) already covers this without a new rule of its own. */
function invalidJoinFieldFailure(fieldName: string): StepFailureInfo {
  return {
    source: 'vcs',
    code: 'VCS-INVALID-COMMIT-FIELD',
    message:
      `Commit message field "${fieldName}" contains a newline or carriage return, which would ` +
      "corrupt an in-lane join commit's conventional-commit structure and could forge a trailer.",
  };
}

/** `PLAN-M14.md` P34: `LANE-JOIN-CONFLICT` (class `conflict`, `classify.ts`) — the join's own analogue of
 * `landLane`'s `MERGE-CONFLICT-UNRESOLVED` (`integrate.ts`), for the identical reason: naming the files, the
 * predecessor head and the lane a human needs to look at. `listClaimFailurePaths` bounds and sanitises the
 * (git-reported, workflow-influenced) path list the identical way it already does for a claim failure. */
function laneJoinConflictFailure(
  node: StepNode,
  lane: LaneHandle,
  headStepId: string,
  files: readonly string[],
): StepFailureInfo {
  return {
    source: 'vcs',
    code: 'LANE-JOIN-CONFLICT',
    message:
      `Lane ${lane.laneId} for ${node.id} could not be joined with ${headStepId}'s lane: ` +
      `conflict on ${listClaimFailurePaths(files)}.`,
  };
}

/** A lane a join failed to complete is not `LaneCreated` and never will be: removed unconditionally
 * (`retain: false`, `PLAN-M14.md` P34's own "the half-made lane removed"), never left for inspection the
 * way a step's own real failure leaves its lane — there is no real work in it yet, only a partial or
 * aborted join. Best-effort: a lane that resists removal is still not `LaneCreated`, so it is picked up by
 * the next resume's own orphan reclamation exactly like a crash mid-join already would be. */
async function removeHalfMadeLane(ctx: ExecuteStepContext, lane: LaneHandle): Promise<void> {
  try {
    await ctx.vcs.removeLane(lane, false);
  } catch {
    // See this function's own doc comment: a resume's orphan reclamation is the backstop either way.
  }
}

/**
 * `06` §6.4 lifecycle step 1: creates the step's lane — from the integration tip, joining in every
 * unmerged, same-scope predecessor head in plan order (`lane-base.ts`, `PLAN-M14.md` P34) — and records
 * `LaneCreated` with the base it ends up at. `LaneCreated` is emitted only AFTER every join has completed
 * (or immediately, when there are none): a half-made lane a join conflict or failure leaves behind is
 * removed and never becomes `LaneCreated` (`removeHalfMadeLane`). `payload.baseSha` is resolved to a sha
 * once and the lane is created FROM THAT SHA, not from the branch name again: the integration branch moves
 * during a run (lanes are integrated into it, `PLAN-M13.md` P19), and a lane created from a tip newer than
 * the `baseSha` its claim is enforced against would show other lanes' files as its own out-of-claim writes.
 * Shared by `runLaneLifecycle` and by a step that needs its lane before its work starts (`swarm-review`,
 * which instead calls `resolveLaneBase` directly, before any lane of its own exists).
 */
export async function createLaneForStep(
  node: StepNode,
  ctx: ExecuteStepContext,
): Promise<
  | { readonly ok: true; readonly lane: LaneHandle; readonly baseSha: string }
  | { readonly ok: false; readonly failure: StepFailureInfo }
> {
  const base = await resolveLaneBase(node, ctx);
  if (!base.ok) return base;
  const { tipSha, heads } = base.value;

  // Checked before any git operation THIS FUNCTION ITSELF performs -- `resolveLaneBase` above already
  // ran its own read-only git calls (`resolveRevision`/`isAncestor`) to discover `heads` in the first
  // place, but nothing writes anything, and no join message is ever built, before this: the identical
  // "reject before touching git" discipline `resolveRevision`'s own doc comment already establishes for
  // a flag-shaped ref, applied here to a newline instead of a flag.
  if (hasNewline(ctx.runId)) {
    return { ok: false, failure: invalidJoinFieldFailure('runId') };
  }
  const badHead = heads.find((head) => hasNewline(head.id));
  if (badHead !== undefined) {
    return { ok: false, failure: invalidJoinFieldFailure('headStepId') };
  }

  const laneResult = await runVcsStep(node.id, () => ctx.vcs.createLane(node.id, tipSha));
  if (!laneResult.ok) return laneResult;
  const lane = laneResult.value;

  // `stackedOn` when exactly one head fast-forwarded (byte-identical to the old stacking rule);
  // `joinedFrom` names every head a real merge commit was needed for. With more than one head, EVERY one
  // goes into `joinedFrom` regardless of whether that particular join happened to fast-forward (the first
  // of several can, trivially, when the lane is still at the untouched tip) — the overall lane is a join
  // of several predecessors' work, not simply one predecessor's own lane, so `stackedOn`'s "this IS that
  // one lane" meaning (`swarm-review-step.ts`'s own use of it) never applies then.
  let stackedOn: string | undefined;
  const joinedFrom: string[] = [];
  let baseSha = tipSha;
  for (const head of heads) {
    const message = buildJoinCommitMessage(ctx, head.id);
    // `PLAN-M14.md` P38: the identical per-call resolver `landLane` already threads to the merge queue
    // (`integrate.ts`) also flows here -- `MergeConflictResolver` (dispatch/types.ts) is structurally
    // wider than `JoinConflictResolver` (every field `JoinConflictDescription` lacks is optional on
    // `MergeConflictDescription`), so no cast or adapter is needed. In practice the shipped default
    // (`createAgentConflictResolver`) always refuses a join conflict with `MERGE-RESOLVER-NO-STEP` (a
    // join's own `JoinConflictDescription` never carries a `stepId`, `join.ts`'s own
    // `describeJoinConflict`) -- still strictly better than the untyped `VCS-MISSING-CONFLICT-RESOLVER` a
    // join under `conflictPolicy: 'agent'`/`'human'` would throw with none supplied at all
    // (`mergeIntoLane`'s own doc comment), and leaves room for a future, real join-aware resolver with no
    // further wiring here.
    const joinResult = await runVcsStep(node.id, () =>
      ctx.vcs.mergeIntoLane(lane, head.sha, message, ctx.conflictResolver),
    );
    if (!joinResult.ok) {
      await removeHalfMadeLane(ctx, lane);
      return joinResult;
    }
    if (joinResult.value.kind === 'conflict') {
      await removeHalfMadeLane(ctx, lane);
      return {
        ok: false,
        failure: laneJoinConflictFailure(node, lane, head.id, joinResult.value.files),
      };
    }
    baseSha = joinResult.value.sha;
    if (heads.length === 1 && joinResult.value.kind === 'fast-forward') stackedOn = head.id;
    else joinedFrom.push(head.id);
  }

  await ctx.telemetry.emit({
    type: 'LaneCreated',
    stepId: node.id,
    laneId: lane.laneId,
    payload: {
      baseSha,
      integrationTip: tipSha,
      ...(stackedOn === undefined ? {} : { stackedOn }),
      ...(joinedFrom.length === 0 ? {} : { joinedFrom }),
    },
  });
  // `PLAN-M14.md` P35: stamped onto the `LaneHandle` itself (not just this function's own separate
  // `baseSha` return field) so `runMergeStep` -- reading this same handle back out of `ctx.laneRegistry`,
  // possibly long after this call returns -- can compute `replayFrom` from it. Mirrors the identical
  // fields `LaneCreated.payload` just emitted, by construction: both are derived from the same
  // `baseSha`/`stackedOn`/`joinedFrom` locals above, never recomputed separately.
  const enrichedLane: LaneHandle = {
    ...lane,
    baseSha,
    ...(stackedOn === undefined ? {} : { stackedOn }),
    ...(joinedFrom.length === 0 ? {} : { joinedFrom }),
  };
  return { ok: true, lane: enrichedLane, baseSha };
}

/** `06` §6.4's own lane lifecycle, steps 1-3 plus claim enforcement (`Q62`'s own sixth note: enforcement
 * runs once a lane's session ends, before handing the lane to the merge queue — a later, separate
 * `merge`-kind step's own job, `ExecuteStepContext.laneRegistry`'s own doc comment has the fuller
 * reasoning for why this handler does not itself enqueue anything). Shared by `runAgentStep` and a
 * non-inline `runCommandStep`, since both need the identical create/commit/enforce sequence and differ
 * only in *what actually produces the changes* (an adapter session vs a shell command) — parameterised via
 * `runWork`, not duplicated. */
export async function runLaneLifecycle(
  node: StepNode,
  ctx: ExecuteStepContext,
  startedAt: number,
  /** The caller's own kind-correct placeholder for a failure that happens before `runWork` ever runs
   * (`resolveRevision`/`createLane` failing) — `detail.kind` must still match the step's real kind
   * (`agent`/`command`) even when there is no real work to report yet, the same reason `runAgentStep`'s
   * own adapter-crash path already returns a real `{kind:'agent', session: EMPTY_SESSION_RESULT}` rather
   * than something kind-generic. */
  emptyDetail: StepOutcomeDetail,
  runWork: (
    lane: LaneHandle,
    baseSha: string,
  ) => Promise<{
    readonly changed: boolean;
    readonly commitSubject: string;
    readonly detail: StepOutcomeDetail;
    readonly failure?: StepFailureInfo;
  }>,
  /** `@forge/engine/resume` (P19)'s own "roll the lane worktree back... and re-run" path reuses this
   * exact create/commit/enforce sequence against a lane that already exists (rolled back in place by
   * `rollbackLaneToBase`, never recreated — `06` §6.10 step 2's own resume is explicitly *not* a second
   * `git worktree add`), with `baseSha` fixed at the lane's own original divergence point (`LaneCreated`'s
   * own `payload.baseSha`, `laneOrigins` in `RunState`) rather than re-resolved against
   * `ctx.integrationBase`, which may have moved on since — re-resolving it here would silently widen or
   * narrow the claim-enforcement diff window below against a base the lane was never actually built from.
   * `undefined` (every existing caller in this module) means "create a fresh lane," this function's own
   * original and only behaviour before P19. NOTE: `runAgentStep`'s own fresh path ALSO always supplies
   * `existing` (it pre-creates the lane itself so a reservation can be bound before dispatch) -- so
   * `existing !== undefined` alone does NOT mean "an earlier attempt may already have committed to this
   * lane." `priorAttemptContent` below exists precisely because that distinction cannot be read off this
   * parameter; it is why that one is a plain caller-supplied value instead of being derived here. */
  existing?: { readonly lane: LaneHandle; readonly baseSha: string },
  /** The step's own KB-output reservation (`reserveDeclaredKbOutputIds`'s `idsByType`, `PLAN-M14.md` P8/
   * P10), threaded straight into `verifyDeclaredOutputs` below so the output check holds a produced KB
   * output to the SAME reservation its prompt was assembled with -- never recomputed here (a rescan of the
   * lane at check time, after the session already wrote into it, would see its own fresh output as already
   * claimed and reject it). `undefined` for every caller with no reservation of its own to pass (a
   * `command` step, a resumed session continuation, `swarm-review`'s own `ReviewReport`-only lanes): the
   * range rule then does not run this call, exactly as `verifyDeclaredOutputs`'s own doc comment says. */
  reservedIds?: ReadonlyMap<string, readonly string[]>,
  /** What this lane already held, committed, BEFORE this attempt's own session ever ran -- a plain
   * pass-through, NOT computed here: a fresh critic round found the earlier version of this piece computed
   * it internally, gated on `existing !== undefined`, which is true on EVERY ordinary fresh KB-output step
   * (`runAgentStep`'s own pre-created lane, above), not only a genuine crash-resume reroll -- three wasted
   * git subprocess spawns and a new pre-session failure surface on the common path, contradicting this
   * piece's own original "zero extra calls for the overwhelming majority of steps" claim. Computed instead
   * by the one caller that actually knows it might be non-empty (`@forge/engine/resume`'s own
   * `runAgentAttempt`, exactly when it is rerolling), `undefined` from every other caller (a provably fresh
   * lane has nothing to snapshot). See `OutputCheckInput.priorAttemptContent`'s own doc comment for why the
   * id-range check needs it at all. */
  priorAttemptContent?: ReadonlyMap<string, string>,
): Promise<StepOutcome> {
  let lane: LaneHandle;
  let baseSha: string;
  if (existing === undefined) {
    const created = await createLaneForStep(node, ctx);
    if (!created.ok) return failed(node.id, startedAt, ctx.now(), emptyDetail, created.failure);
    lane = created.lane;
    baseSha = created.baseSha;
  } else {
    lane = existing.lane;
    baseSha = existing.baseSha;
  }

  const work = await runWork(lane, baseSha);
  // What claim enforcement reverted, for the output contract check below: an artifact the session wrote
  // but the step's claim did not cover never reached the lane branch, and the check says so.
  let claimReverted: readonly string[] = [];

  if (work.changed) {
    const commitResult = await runVcsStep(node.id, () =>
      ctx.vcs.commit(lane, buildCommitMessage(node, ctx, work.commitSubject), ctx.signCommits),
    );
    if (!commitResult.ok)
      return failed(node.id, startedAt, ctx.now(), work.detail, commitResult.failure);
    await ctx.telemetry.emit({ type: 'LaneCommitted', stepId: node.id, laneId: lane.laneId });

    // `06` §6.7 (P14): an agent step's claim is its `produces` plus its declared outputs' registry paths,
    // and a step that declares outputs is `strict` at every autonomy level (`resolveStepClaim`).
    const roots = docRootsOf(ctx);
    const claim = resolveStepClaim(node, roots, ctx.claimPolicy);
    const enforceResult = await runVcsStep(node.id, () =>
      ctx.vcs.enforceClaim(lane, baseSha, claim.globs, claim.policy, claim.exclude),
    );
    if (!enforceResult.ok)
      return failed(node.id, startedAt, ctx.now(), work.detail, enforceResult.failure);
    claimReverted = enforceResult.value.reverted;
    const outOfClaim = enforceResult.value.outOfClaim;
    // `06` §6.7 as amended (`PLAN-M14.md` P3, `SPEC-QUESTIONS.md` Q232 decision 1): under `strict` a
    // non-empty `outOfClaim` now fails the step too -- `warn` keeps its own unchanged "revert (an excluded
    // path only) or keep, flag, step still succeeds" behaviour. Decided here, before either the event
    // below or the revert commit, but only ACTED on (the early `return` after both) once they have
    // actually landed: the trace and the revert are real regardless of the step's own eventual status.
    const claimFails = claim.policy === 'strict' && outOfClaim.length > 0;
    if (outOfClaim.length > 0) {
      // `06` §6.7: an out-of-claim write is a policy violation, `strict` or `warn` alike -- this event is
      // the record of which files fell outside the claim, whether they were reverted (`strict`) or kept
      // (`warn`), and now whether the violation also fails the step (`stepFailed`): a brief-named document
      // outside a step's outputs and `produces` is otherwise discarded without a trace.
      await ctx.telemetry.emit({
        type: 'PolicyViolation',
        stepId: node.id,
        laneId: lane.laneId,
        payload: {
          kind: 'out-of-claim-write',
          policy: claim.policy,
          stepFailed: claimFails,
          paths: outOfClaim
            .slice(0, MAX_VIOLATION_PATHS_LOGGED)
            .map((file) => (file.length > 300 ? `${file.slice(0, 300)}...` : file)),
          totalOutOfClaim: outOfClaim.length,
          totalReverted: enforceResult.value.reverted.length,
        },
      });
    }
    if (enforceResult.value.reverted.length > 0) {
      const revertCommitResult = await runVcsStep(node.id, () =>
        ctx.vcs.commit(
          lane,
          buildCommitMessage(node, ctx, 'revert out-of-claim changes'),
          ctx.signCommits,
        ),
      );
      if (!revertCommitResult.ok)
        return failed(node.id, startedAt, ctx.now(), work.detail, revertCommitResult.failure);
      // This second, real commit is otherwise invisible to the durable event log -- every other real
      // commit this module ever makes gets a LaneCommitted of its own (the one above), and a
      // claim-enforcement revert is no less real a commit for being policy-triggered rather than
      // work-triggered.
      await ctx.telemetry.emit({
        type: 'LaneCommitted',
        stepId: node.id,
        laneId: lane.laneId,
        payload: { reason: 'claim-revert' },
      });
    }
    if (claimFails) {
      // Returned here -- strictly after the trace and the revert commit above, strictly before the
      // `work.failure` check and the P7 output check below -- so a claim violation never reaches
      // `LaneReady` and its lane never reaches `ctx.laneRegistry` (both happen only past this point). An
      // adapter failure from this same attempt wins over this one (the work itself already went wrong for
      // its own reason, the more informative thing to surface as the step's primary failure), but the
      // violation is never silently lost either way: it is already the `PolicyViolation` event just
      // emitted, `stepFailed: true` regardless of which failure the step itself ends up carrying.
      return failed(
        node.id,
        startedAt,
        ctx.now(),
        work.detail,
        work.failure ??
          claimFailure(node, roots, claim.policy, outOfClaim, enforceResult.value.reverted),
      );
    }
  }

  if (work.failure !== undefined) {
    await ctx.telemetry.emit({ type: 'LaneReady', stepId: node.id, laneId: lane.laneId });
    return failed(node.id, startedAt, ctx.now(), work.detail, work.failure);
  }

  // `PLAN-M13.md` P7 (`05` §5.5): the session ended ok, but "ok" says nothing about whether the step's
  // declared `outputs` exist. Checked against the lane as it now stands (committed, claim-enforced): what
  // a merge would carry forward. `agent` steps only (`outputs.ts`). A lane that fails the contract is not
  // announced `LaneReady`: resume re-registers every `ready` lane for merging, and a lane whose declared
  // output is missing or invalid must not be merged after a resume when it would not have been before.
  const outputCheck = await runVcsStep(node.id, () =>
    verifyDeclaredOutputs(
      node,
      ctx,
      lane,
      baseSha,
      claimReverted,
      reservedIds,
      priorAttemptContent,
    ),
  );
  if (!outputCheck.ok)
    return failed(node.id, startedAt, ctx.now(), work.detail, outputCheck.failure);
  if (outputCheck.value !== undefined) {
    return failed(node.id, startedAt, ctx.now(), work.detail, outputCheck.value);
  }

  await ctx.telemetry.emit({ type: 'LaneReady', stepId: node.id, laneId: lane.laneId });
  ctx.laneRegistry.set(node.id, lane);
  return succeeded(node.id, startedAt, ctx.now(), work.detail);
}

/** `07` §7.2's `SessionRequest` for an agent step, built from the assembled prompt (`assemble.ts`,
 * `PLAN-M13.md` P5): the compiled nine-block prompt is the effective system prompt (`05` §5.3), the user
 * prompt is a fixed kickoff line, and the model, thinking level and tool grant are the agent's own
 * resolved values -- none of `ctx.model`/`ctx.tools` (which serve only ad-hoc, non-agent-step sessions)
 * is read here. `env` carries the FORGE run/step/agent marker (`@forge/core/session-marker`,
 * `PLAN-M14.md` P4, `SPEC-QUESTIONS.md` Q232 decision 9): composed from `ctx.runId`, `node.id` and
 * `assembled.agent.id` -- the agent this assembly actually resolved, never `process.env` (R10). */
function buildSessionRequest(
  node: StepNode,
  ctx: ExecuteStepContext,
  assembled: AssembledSession,
  untrustedInput: string | undefined,
  cwd: string,
  abortSignal: AbortSignal,
): SessionRequest {
  return {
    runId: ctx.runId,
    stepId: node.id,
    cwd,
    systemPrompt: assembled.systemPrompt,
    prompt:
      untrustedInput === undefined ? assembled.prompt : `${assembled.prompt}\n\n${untrustedInput}`,
    model: assembled.model,
    thinking: assembled.thinking,
    tools: assembled.tools,
    permissionMode: 'accept-edits',
    limits: {
      maxTurns: node.limits.maxTurns,
      wallClockMs: node.limits.wallClockMs,
      maxCostUsd: node.limits.maxCostUsd,
    },
    env: {
      [FORGE_RUN_ID]: ctx.runId,
      [FORGE_STEP_ID]: node.id,
      [FORGE_AGENT_ID]: assembled.agent.id,
    },
    abortSignal,
  };
}

/** Options threading a pre-resolved input into an agent step: `taskText` is prose that plays block [4]
 * (an interaction-mode synthesis/decider turn, a session phase's question) instead of a `briefs/<name>.md`
 * reference loaded from `node.brief`; `assembled` is a prompt already assembled for this attempt (by
 * `runAgentStep`, before any lane exists) so `runAgentWork` does not compile it a second time. */
export interface AgentWorkOptions {
  readonly taskText?: string | undefined;
  /** Untrusted data the task needs (a peer session's output; already fenced by `wrapUntrustedContent`).
   * Delivered in the user turn after the kickoff line, never compiled into the system prompt. */
  readonly untrustedInput?: string | undefined;
  /** Overrides the key `prompt.briefs.<key>` is looked up by (see `AssembleInput.briefKey`). */
  readonly briefKey?: string | undefined;
  readonly assembled?: AssembledSession | undefined;
  /** Forwarded to `tryAssemble` as `AssembleInput.reservedOutputIds` when this call still needs to
   * assemble (`assembled` is `undefined`): a crash-resume reroll (`@forge/engine/resume`'s own
   * `runAgentAttempt`) already has a real lane and reserves through it directly, so it passes this
   * rather than going through `runAgentStep`'s own pre-lane path a second time. Ignored once `assembled`
   * is supplied (`runAgentStep`'s own fresh path): that prompt already has whatever it was assembled
   * with. */
  readonly reservedOutputIds?: ReadonlyMap<string, readonly string[]> | undefined;
}

/** What `runAgentWork` is about to hand the adapter: a freshly assembled prompt, or a resume of an existing
 * session (whose system prompt is already in force; only its model is needed, for usage attribution). */
type PreparedSession =
  | { readonly kind: 'start'; readonly assembled: AssembledSession }
  | { readonly kind: 'resume'; readonly sessionId: string; readonly model: string };

async function prepareSession(
  node: StepNode,
  ctx: ExecuteStepContext,
  source: { readonly kind: 'start' } | { readonly kind: 'resume'; readonly sessionId: string },
  options: AgentWorkOptions,
): Promise<
  | { readonly ok: true; readonly value: PreparedSession }
  | { readonly ok: false; readonly failure: StepFailureInfo }
> {
  if (source.kind === 'resume') {
    const resolved = await tryResolveSessionModel(node, ctx);
    return resolved.ok
      ? { ok: true, value: { kind: 'resume', sessionId: source.sessionId, model: resolved.model } }
      : resolved;
  }
  const result =
    options.assembled === undefined
      ? await tryAssemble({
          node,
          ctx,
          taskText: options.taskText,
          briefKey: options.briefKey,
          reservedOutputIds: options.reservedOutputIds,
        })
      : ({ ok: true, value: options.assembled } as const);
  if (!result.ok) return result;
  try {
    await result.value.persist();
  } catch (cause) {
    return { ok: false, failure: refusalFailure(cause) };
  }
  return { ok: true, value: { kind: 'start', assembled: result.value } };
}

/** Acquires an agent session for `lane` — either a fresh one (`source.kind === 'start'`) or a resumed
 * one against an existing `sessionId` (`source.kind === 'resume'`, `@forge/engine/resume` P19's own
 * "resume the adapter session if supported and still valid" path) — then folds its result into the
 * `runLaneLifecycle`-shaped `{changed, commitSubject, detail, failure?}` `runWork` contract, identically
 * for both: a resumed session still gets committed and claim-enforced exactly like a fresh one, since
 * nothing about *how* the session was acquired changes what `06` §6.4 step 3 onward does with its
 * result. Factored out of `runAgentStep` (previously its own inline closure) specifically so P19 can
 * reuse this exact acquire/commit/enforce sequence for a resumed step rather than a second, drifting
 * copy of it — the identical "one implementation, not two that could disagree" reasoning
 * `runScriptPhases` already gives inside `@forge/testkit`'s own fake adapter for the analogous fresh-vs-
 * resumed split at that layer. */
export async function runAgentWork(
  node: StepNode,
  ctx: ExecuteStepContext,
  lane: LaneHandle,
  baseSha: string,
  source: { readonly kind: 'start' } | { readonly kind: 'resume'; readonly sessionId: string },
  options: AgentWorkOptions = {},
): Promise<{
  readonly changed: boolean;
  readonly commitSubject: string;
  readonly detail: StepOutcomeDetail;
  readonly failure?: StepFailureInfo;
}> {
  // Prepared before `SessionStarted` and before anything reaches the adapter: a step that cannot be
  // assembled (`PLAN-M13.md` P5, D4) fails as a typed outcome with nothing dispatched. A fresh session is
  // assembled (unless `runAgentStep` already did, before creating this lane) and its audit record written
  // now, immediately before the session starts. A *resumed* session's system prompt is already in force:
  // only its model is resolved, and the original record is left as the session actually received it.
  const prepared = await prepareSession(node, ctx, source, options);
  if (!prepared.ok) {
    return {
      changed: false,
      commitSubject: 'prompt assembly refused',
      detail: { kind: 'agent', session: EMPTY_SESSION_RESULT },
      failure: prepared.failure,
    };
  }
  const plan = prepared.value;
  const model = plan.kind === 'start' ? plan.assembled.model : plan.model;
  const dirName = promptRecordDirName(plan.kind === 'start' ? plan.assembled.stepKey : node.id);
  // Anything assembly noticed that a reader of the event log needs (`05` §5.4 point 2: declared inputs
  // that could not be packed; KB files that failed to parse) rides on this event, so a step that ran
  // without them is visible outside the prompt text.
  const diagnostics = plan.kind === 'start' ? plan.assembled.diagnostics : undefined;
  const hasDiagnostics =
    diagnostics !== undefined &&
    (diagnostics.unresolvedDeclaredInputs.length > 0 || diagnostics.kbParseErrors > 0);
  await ctx.telemetry.emit({
    type: 'SessionStarted',
    stepId: node.id,
    laneId: lane.laneId,
    agentId: node.agent,
    ...(hasDiagnostics ? { payload: diagnostics } : {}),
  });
  const abortController = new AbortController();
  let session;
  // Every real leg this attempt's own session actually ran -- `[session]` alone for the overwhelmingly
  // common case (no `FORGE_REQUEST_CONTEXT:` ever asked), one entry per real adapter result when
  // `expandRequestedContext` (`PLAN-M14.md` P44) ran a real continuation. Populated below, read after
  // `SessionEnded` to emit `UsageRecorded` (once per leg, summed by nothing here -- each is its own
  // real, distinct spend).
  let legs: readonly SessionResult[] = [];
  try {
    const handle =
      plan.kind === 'start'
        ? await ctx.adapter.startSession(
            buildSessionRequest(
              node,
              ctx,
              plan.assembled,
              options.untrustedInput,
              lane.path,
              abortController.signal,
            ),
          )
        : await ctx.adapter.resumeSession(plan.sessionId, {
            prompt: resumePrompt(node.id),
            limits: {
              maxTurns: node.limits.maxTurns,
              wallClockMs: node.limits.wallClockMs,
              maxCostUsd: node.limits.maxCostUsd,
            },
            abortSignal: abortController.signal,
          });
    // The one real, registered event this whole build's own P19 research found no producer of anywhere:
    // the adapter's own session id, needed by a later resume to even attempt `resumeSession` at all
    // (`@forge/engine/resume`'s own `RunState.sessionIds`). Emitted here -- after a handle is actually
    // acquired, before `handle.result()` is awaited -- so it is durable (`18` §18.10's write-before-effect
    // discipline) even if the session itself crashes mid-stream before ever producing a result.
    await ctx.telemetry.emit({
      type: 'SessionEvent',
      stepId: node.id,
      laneId: lane.laneId,
      agentId: node.agent,
      payload: { sessionId: handle.sessionId },
    });
    session = await handle.result();
    legs = [session];
    // `PLAN-M14.md` P44: an agent step whose session ended with a `FORGE_REQUEST_CONTEXT:` control
    // token gets a real continuation instead of that token being silently discarded (`05` §5.4 point 4).
    // A session with no such token (the overwhelmingly common case) returns unchanged after one cheap
    // scan; `session` below is then this loop's own aggregate outcome (`expandRequestedContext`'s own
    // doc comment), and `legs` every real adapter result it took to reach it, for `UsageRecorded` below.
    // `expandRequestedContext` itself never throws (a rejecting `resumeSession`, an unsupported
    // adapter, or any other unexpected failure inside its own loop is all caught internally and ends
    // the loop with every leg that genuinely completed intact, `context-expansion.ts`'s own doc
    // comment) -- this try/catch is a defensive backstop only, for a failure this module's own
    // reasoning did not anticipate; even then, `session`/`legs` below are simply left at the pre-
    // expansion state (the real, already-obtained initial `session`) rather than fabricated into an
    // adapter crash (`Discloses`: "a crash between request and continuation rerolls" describes a
    // genuine engine crash-resume, not this narrower case).
    try {
      const expanded = await expandRequestedContext(
        {
          ctx,
          nodeLimits: node.limits,
          telemetryStepId: node.id,
          laneId: lane.laneId,
          agentId: node.agent,
          dirName,
        },
        session,
      );
      session = expanded.session;
      legs = expanded.legs;
    } catch {
      // `session`/`legs` stay at the last leg that completed before this unexpected failure; the step
      // proceeds with it exactly as it would have if the agent had never asked for more context at all.
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    await ctx.telemetry.emit({
      type: 'AdapterError',
      stepId: node.id,
      laneId: lane.laneId,
      agentId: node.agent,
      payload: { message },
    });
    // This attempt produced no answer: an earlier attempt's `result.md` must not stand in for it.
    await clearResultRecord(ctx.assembly.paths, ctx.runId, dirName).catch(() => undefined);
    // A crash can land here after real tool-use writes already reached the lane worktree (a
    // session dropped mid-stream, not just one that never started) -- checked for real via
    // hasChanges rather than assumed false, so those writes still get committed and claim-enforced
    // instead of being silently left uncommitted and lost once the lane is eventually cleaned up.
    return {
      changed: await ctx.vcs.hasChanges(lane, baseSha),
      commitSubject: 'partial work before an adapter session crash',
      detail: { kind: 'agent', session: EMPTY_SESSION_RESULT },
      failure: { source: 'adapter', message },
    };
  }
  // The session's final text is kept in the run record before the step can be marked complete
  // (`PLAN-M13.md` P12, `Q208` finding 5); the event carries only a reference to it, never the text.
  let resultRef: ResultRecordRef | undefined;
  let resultFailure: StepFailureInfo | undefined;
  try {
    resultRef = await writeResultRecord(ctx.assembly.paths, ctx.runId, dirName, session.finalText);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    resultFailure = {
      source: 'telemetry',
      code: isForgeError(cause) ? cause.code : undefined,
      message: `Could not record the session result: ${message}`,
      cause,
    };
  }
  await ctx.telemetry.emit({
    type: 'SessionEnded',
    stepId: node.id,
    laneId: lane.laneId,
    agentId: node.agent,
    payload: { ok: session.ok, ...(resultRef === undefined ? {} : { result: resultRef }) },
  });
  // `20` §20.10 S9 / `18` §18.5: `@forge/telemetry/ledger`'s own doc comment already names
  // `UsageRecorded` as "everything a LedgerEntry needs" -- but nothing in this whole codebase ever
  // emitted one for a real session. `forge cost`, `attributedSpend`, and `@forge/engine/budget`'s own
  // `canAdmit` were all real and correct, and all permanently fed an empty ledger in every real run --
  // the identical "the mechanism is real, the wiring to a real call site is not" shape `PLAN-M11.md`
  // P10 already found for S5's control-token stripping. One per real adapter result this attempt
  // actually produced (`legs`, above) -- `[session]` alone for the overwhelmingly common case, and
  // (`PLAN-M14.md` P44) one more per real `FORGE_REQUEST_CONTEXT:` continuation leg, so the ledger sees
  // every real spend this attempt made, not merely the merged/summed total on the outcome's own
  // `session.usage`. `estimated: true` unconditionally: `07` §7.3's own "adapter-reported figures are
  // client-side estimates, never presented as an invoice" applies to every real adapter this codebase
  // can construct today, not a caller-decided flag this module has any basis to vary.
  for (const leg of legs) {
    await ctx.telemetry.emit({
      type: 'UsageRecorded',
      stepId: node.id,
      agentId: node.agent,
      payload: {
        model,
        platform: ctx.adapter.id,
        inputTokens: sanitizeUsageNumber(leg.usage.inputTokens),
        outputTokens: sanitizeUsageNumber(leg.usage.outputTokens),
        cacheReadTokens: 0,
        costUsd: leg.usage.costUsd === undefined ? 0 : sanitizeUsageNumber(leg.usage.costUsd),
        estimated: true,
        durationMs: sanitizeUsageNumber(leg.durationMs),
      },
    });
  }

  const detail: StepOutcomeDetail = { kind: 'agent', session };
  if (!session.ok) {
    const message = session.error?.message ?? 'Session ended without success.';
    return {
      changed: session.changedFiles.length > 0,
      commitSubject: session.finalText.slice(0, 72),
      detail,
      failure: { source: 'adapter', code: session.error?.code, message },
    };
  }
  if (resultFailure !== undefined) {
    return {
      changed: session.changedFiles.length > 0,
      commitSubject: session.finalText.slice(0, 72) || node.id,
      detail,
      failure: resultFailure,
    };
  }
  return {
    changed: session.changedFiles.length > 0,
    commitSubject: session.finalText.slice(0, 72) || node.id,
    detail,
  };
}

export async function runAgentStep(
  node: StepNode,
  ctx: ExecuteStepContext,
  options: {
    readonly taskText?: string | undefined;
    readonly untrustedInput?: string | undefined;
    readonly briefKey?: string | undefined;
  } = {},
): Promise<StepOutcome> {
  const startedAt = ctx.now();
  // `PLAN-M14.md` P19: `agentId` and (when the compiled plan attached any) `payload.gateEvidence` --
  // `approve.ts`'s own "same-run conflict of interest" refusal (`GATE-511`) reads exactly these two
  // fields back off this event (`telemetry/src/events.ts:104`'s own top-level `agentId`, and
  // `StepNode.gateEvidence`, `plan/compile.ts`'s own `attachDependentGateEvidence`) to tell whether the
  // agent this step ran as produced evidence for a gate it might later be asked to approve. Emitted
  // unconditionally with `agentId: node.agent` (undefined here only for a malformed node about to fail
  // `RUN-039` below, in which case the field is simply absent, matching every other `agentId`-bearing
  // event this function emits later for the same node); the payload key itself is omitted rather than an
  // empty array when the compiled plan attached none, so a reader can tell "declared, empty" apart from
  // "nothing declared" without special-casing an empty list.
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

  // Reserved before assembly, before any lane exists (`PLAN-M14.md` P8, `SPEC-QUESTIONS.md` Q232
  // decision 2): a declared KB output's own id must already be in block [5] of the prompt the session
  // reads, not invented by the session itself, which two concurrent steps could pick identically.
  // Exhaustion (`RUN-109`) is refused the identical way a missing agent/brief or an unmapped model is --
  // as a typed, `source: 'prompt'` outcome, nothing dispatched, no worktree.
  let reservation: KbOutputReservation | undefined;
  try {
    reservation = await reserveDeclaredKbOutputIds(node, ctx);
  } catch (cause) {
    return failed(
      node.id,
      startedAt,
      ctx.now(),
      { kind: 'agent', session: EMPTY_SESSION_RESULT },
      refusalFailure(cause),
    );
  }

  // Assembled before a lane is created: a step refused for a missing agent/brief, an unmapped model or a
  // grant above its ceiling must leave no worktree behind, and dispatches nothing.
  const assembled = await tryAssemble({
    node,
    ctx,
    taskText: options.taskText,
    briefKey: options.briefKey,
    reservedOutputIds: reservation?.idsByType,
  });
  if (!assembled.ok) {
    // This attempt will never get a lane: the reservation it made (if any) is pending forever otherwise.
    reservation?.release();
    return failed(
      node.id,
      startedAt,
      ctx.now(),
      { kind: 'agent', session: EMPTY_SESSION_RESULT },
      assembled.failure,
    );
  }

  // The lane is created HERE, not left to `runLaneLifecycle`'s own internal `createLaneForStep` call, so
  // a reservation this call made can be bound to it (or released, if creation itself fails) before
  // `runLaneLifecycle`'s commit/claim/output-check sequence ever runs -- `runLaneLifecycle`'s own
  // `existing` parameter (`@forge/engine/resume`'s own crash-resume reroll path already reuses it the
  // identical way) then runs against this exact lane rather than creating a second one.
  //
  // `bound`, and the surrounding try/finally, are not redundant with the two `{ok:false}` branches
  // below: `createLaneForStep` itself calls `ctx.telemetry.emit({type:'LaneCreated', ...})` UNWRAPPED
  // (`06` §6.4 step 1's own doc comment), and a `TelemetryError` escaping that emit propagates past both
  // `if` checks entirely (`executeStep`'s own contract: it is never folded into a `StepOutcome`, only
  // wrapped into `RUN-038` at the top level) -- a real worktree can already exist by then. Without the
  // `finally`, that one exception path would leak this reservation for the life of the process (a
  // `pending` entry, by design, is never pruned by liveness): the `finally` is what actually makes
  // `output-ids.ts`'s own "released when the step ends without ever getting one" claim hold on EVERY
  // exit, not merely the two anticipated ones.
  let bound = false;
  try {
    const created = await createLaneForStep(node, ctx);
    if (!created.ok) {
      return failed(
        node.id,
        startedAt,
        ctx.now(),
        { kind: 'agent', session: EMPTY_SESSION_RESULT },
        created.failure,
      );
    }
    // From here on this reservation is governed by the lane's own liveness (`existsSync`), exactly like
    // `REVIEW-NNN`'s always was (`output-ids.ts`'s own doc comment): "pending" ends the moment a real
    // lane exists.
    reservation?.bind(created.lane.path);
    bound = true;

    return await runLaneLifecycle(
      node,
      ctx,
      startedAt,
      { kind: 'agent', session: EMPTY_SESSION_RESULT },
      (lane, baseSha) =>
        runAgentWork(
          node,
          ctx,
          lane,
          baseSha,
          { kind: 'start' },
          {
            assembled: assembled.value,
            untrustedInput: options.untrustedInput,
            briefKey: options.briefKey,
          },
        ),
      { lane: created.lane, baseSha: created.baseSha },
      reservation?.idsByType,
    );
  } finally {
    // Covers the `!created.ok` return above AND any exception thrown before `bound` was set (including
    // one thrown by `createLaneForStep` itself after it already created a real worktree) -- idempotent
    // with `IdReservation.release`'s own guard, so this never double-frees a reservation a later
    // attempt for the same step has already superseded.
    if (!bound) reservation?.release();
  }
}

const EMPTY_SESSION_RESULT = {
  sessionId: '',
  ok: false,
  finalText: '',
  usage: { inputTokens: 0, outputTokens: 0, turns: 0 },
  durationMs: 0,
  changedFiles: [],
  controlTokens: [],
} as const;

export async function runCommandStep(
  node: StepNode,
  ctx: ExecuteStepContext,
): Promise<StepOutcome> {
  const startedAt = ctx.now();
  await ctx.telemetry.emit({ type: 'StepStarted', stepId: node.id });

  if (node.run === undefined) {
    throw new ForgeError('RUN-039', {
      stepId: node.id,
      kind: 'command (missing its own run field)',
    });
  }
  // Captured once, here, as its own `const`: TypeScript narrows a `const` correctly across a nested
  // closure (`runWork` below), unlike a bare `node.run` member access re-evaluated inside one, which
  // re-widens to `string | undefined` since the checker cannot prove `node` was not mutated in between
  // — this is what let the original version of this function need (and never actually exercise) a
  // second, redundant runtime check purely to satisfy the type checker.
  const run = node.run;
  // The environment the run's launcher supplied (`ExecuteStepContext.commandEnv`): its `PATH` starts with a
  // directory holding the `forge` that launched this run, so `forge ...` resolves to it and not to whatever
  // (or nothing) the user has installed. On top of it, the answers of the `elicit` steps this one depends on
  // (`FORGE_ANSWER_<name>`) and the project root (`FORGE_PROJECT_ROOT`): data a command reads from its
  // environment, never spliced into its text (`PLAN-M13.md` P20, `elicit.ts`).
  const commandEnv = commandStepEnvironment(node, ctx);

  if (node.laneAffinity === 'inline') {
    // Runs in the integration worktree, not the project root (`PLAN-M13.md` P19, Q221): an inline step has no
    // lane, so it runs against the integrated state of the run, the tree a gate reads and a merge writes, and
    // sees what earlier lanes produced. The tree belongs to the merge queue, so the step may not change it: what
    // it touched is reverted and the step fails (`inline-tree.ts`).
    const inlineCwd = ctx.integrationPath;
    // Snapshot, run and restore are one window in the merge queue (`MergeQueueFacade.exclusive`): a merge, a
    // session's decide-merge or another inline step landing in the same tick would otherwise be undone by the
    // restore, or blamed for its files.
    const exclusive = ctx.mergeQueue.exclusive?.bind(ctx.mergeQueue) ?? ((work) => work());
    const inline = await exclusive(async () => {
      const before = await runVcsStep(node.id, () => snapshotIntegrationTree(inlineCwd));
      if (!before.ok) return { kind: 'unsnapshotted' as const, failure: before.failure };
      const result = await runShellCommand(run, inlineCwd, commandEnv);
      const restored = await runVcsStep(node.id, () =>
        restoreIntegrationTree(inlineCwd, before.value),
      );
      return { kind: 'ran' as const, result, restored };
    });
    if (inline.kind === 'unsnapshotted') {
      return failed(
        node.id,
        startedAt,
        ctx.now(),
        { kind: 'command', exitCode: -1, stdout: '', stderr: '' },
        inline.failure,
      );
    }
    const { exitCode, stdout, stderr } = inline.result;
    const detail: StepOutcomeDetail = { kind: 'command', exitCode, stdout, stderr };
    const reverted = inline.restored;
    if (!reverted.ok) return failed(node.id, startedAt, ctx.now(), detail, reverted.failure);
    const finishedAt = ctx.now();
    const changes = reverted.value.length > 0 ? reverted.value.join('; ') : undefined;
    if (exitCode !== 0) {
      return failed(node.id, startedAt, finishedAt, detail, {
        source: 'command',
        code: String(exitCode),
        message:
          (stderr || stdout) +
          (changes === undefined
            ? ''
            : ` (The step also changed the integration worktree: ${changes}; reverted.)`),
      });
    }
    if (changes !== undefined) {
      return failed(node.id, startedAt, finishedAt, detail, {
        source: 'command',
        code: 'INLINE-CHANGED-INTEGRATION-TREE',
        message:
          `Inline step ${node.id} changed the integration worktree (${changes}); the changes were ` +
          'reverted. An inline step runs against the integrated tree and must leave it as it found it: ' +
          'a step that writes files belongs in a lane (drop "inline: true").',
      });
    }
    return succeeded(node.id, startedAt, finishedAt, detail);
  }

  return runLaneLifecycle(
    node,
    ctx,
    startedAt,
    { kind: 'command', exitCode: -1, stdout: '', stderr: '' },
    async (lane, baseSha) => {
      const { exitCode, stdout, stderr } = await runShellCommand(run, lane.path, commandEnv);
      const detail: StepOutcomeDetail = { kind: 'command', exitCode, stdout, stderr };
      // An arbitrary shell command's own stdout/exit code say nothing about which files, if any, it
      // touched — checked for real (VcsFacade.hasChanges' own doc comment has the fuller reasoning)
      // rather than assumed, so a command that legitimately made no changes (a validation-only command,
      // say) does not spuriously fail a real "nothing to commit" git error.
      const changed = await ctx.vcs.hasChanges(lane, baseSha);
      if (exitCode !== 0) {
        return {
          changed,
          commitSubject: node.id,
          detail,
          failure: { source: 'command', code: String(exitCode), message: stderr || stdout },
        };
      }
      return { changed, commitSubject: node.id, detail };
    },
  );
}

export async function runGateStep(node: StepNode, ctx: ExecuteStepContext): Promise<StepOutcome> {
  const startedAt = ctx.now();
  await ctx.telemetry.emit({ type: 'StepStarted', stepId: node.id });

  if (node.gate === undefined) {
    throw new ForgeError('RUN-039', { stepId: node.id, kind: 'gate (missing its own gate field)' });
  }

  let report;
  try {
    // `integrationPath`, not `projectRoot`: `10` §10.1's own canonical workflow chains a gate step
    // straight off a `merge` step (`dependsOn: [merge]`), and a merge lands its result at
    // `integrationPath` (`runMergeStep`'s own `ctx.mergeQueue`, bound to it at construction) -- the same
    // directory a post-merge gate needs to actually be checking. The two happen to coincide in every
    // test in this package (`helpers.ts`'s own default), so this was unverified either way until now.
    report = await ctx.gates.evaluate(node.gate, ctx.integrationPath);
  } catch (cause) {
    if (cause instanceof GateNotFoundError)
      throw new ForgeError('RUN-040', { stepId: node.id, gateId: node.gate });
    throw cause;
  }

  await ctx.telemetry.emit({
    type: 'GateEvaluated',
    stepId: node.id,
    // `PLAN-M14.md` P17: digests, not the raw check output -- `10` §10.3 rule 4's own audit trail as
    // `GateApproved`/`GateWaived` already carry it (`recordChecks`, `gates/approve.ts`), reused as-is
    // (it reads only `.checks`, which a `GateReport` carries too). This in-run step writes no report
    // FILE of its own (that is `gate check`/`approve`/`waive`'s own job, `gate-commands.ts`) -- only
    // the event gains the per-check digests.
    payload: { gateId: node.gate, passed: report.passed, checks: recordChecks(report, false) },
  });
  const finishedAt = ctx.now();
  const detail: StepOutcomeDetail = { kind: 'gate', report };
  // `20` §20.10 S6 / `15` §15.5.4: a tainted step cannot approve a gate, checked structurally here
  // regardless of whether every deterministic check passed -- `taint-guard.ts`'s own doc comment has
  // the full reasoning for why gate approval is the one of S6's three named surfaces with a real,
  // already-wired per-step runtime call site to attach this check to.
  const taintDecision = assertGateApprovalAllowed(node.taint);
  if (!report.approved || taintDecision.refused) {
    await ctx.telemetry.emit({
      type: 'GateRejected',
      stepId: node.id,
      payload: taintDecision.refused
        ? { gateId: node.gate, reason: taintDecision.reason }
        : { gateId: node.gate },
    });
    return failed(node.id, startedAt, finishedAt, detail, {
      source: 'gate',
      message: taintDecision.refused
        ? `Gate ${node.gate} cannot be approved: ${taintDecision.reason}.`
        : `Gate ${node.gate} was not approved.`,
    });
  }
  await ctx.telemetry.emit({
    type: 'GateApproved',
    stepId: node.id,
    payload: { gateId: node.gate },
  });
  return succeeded(node.id, startedAt, finishedAt, detail);
}

const CONFLICT_POLICIES = new Set(['agent', 'human', 'abort']);

function isConflictPolicy(value: string): value is 'agent' | 'human' | 'abort' {
  return CONFLICT_POLICIES.has(value);
}

// --- PLAN-M14.md P18: runMergeStep reads each swarm-review lane's committed verdict --------------------
//
// A `merge` step must not land a swarm-review lane whose own bound verdict (`PLAN-M14.md` P14,
// `SPEC-QUESTIONS.md` Q232 decision 7) is not `concerns`/`clear`, and must not land the implement lane it
// reviews (P38 stacking) either -- even though `mergeLandingScope`'s own dependencies-first order would
// otherwise land that implement lane BEFORE the review's own turn in the loop below ever comes up.
// Resolved once, up front, entirely from what is actually committed on each lane's own branch
// (`ctx.vcs.readAtRevision`/`listFilesAtRevision`, never in-memory state a crash could have lost, `06`
// §6.10): a lane a hand-edited branch could forge (`SPEC-QUESTIONS.md` Q229's threat model) gets no more
// trust here than one this engine itself wrote. No gate check is added; this is the merge step's own
// last-line read of what P14 already bound into the front matter.
//
// Scope: only lanes an explicit `merge` step lands (`mergeLandingScope`, this piece's own literal
// mandate). A `swarm-review` lane no `merge` step ever claims is instead integrated automatically by the
// engine's own per-step path (`06` §6.4 rule 4, `PLAN-M13.md` P19, `integrateLane` below) once its step
// succeeds -- that path never runs this check at all, so an `incomplete`-verdict review on such a lane
// would land silently. Every shipped workflow's own `review` step is always inside a `merge` step's
// landing scope (`implement-story.workflow.yaml`, `build-stage.workflow.yaml`), so this gap is not
// reachable today; a future workflow shape that leaves a `swarm-review` step unclaimed by any `merge`
// would need this piece's own check ported into `integrateLane`, out of this piece's own scope.

const REVIEW_REPORT_FILE = /^REVIEW-\d{3}(?:-.*)?\.md$/;

interface ReviewLookup {
  readonly verdict: ReviewVerdict;
  readonly reportId: string;
}

/** The swarm-review lane's own committed report at `HEAD`, read from the git object database (never the
 * worktree, `types.ts`'s own `readAtRevision` doc comment) -- `undefined` for anything that is not a
 * clean, landable signal: no `REVIEW-*.md` under the reports root, a file that fails to parse as an
 * artifact document at all, or whose `verdict` key is missing or not one of the four real values
 * (`parseReviewVerdict`'s own contract: never read as `clear`). Several matching files (an unusual lane
 * shape) are tried in order; the first one with a real, parseable verdict wins. */
async function readReviewLookup(
  ctx: ExecuteStepContext,
  lane: LaneHandle,
): Promise<ReviewLookup | undefined> {
  const reportsDir = path.posix.dirname(
    outputPathFor('ReviewReport', docRootsOf(ctx), 'REVIEW-000'),
  );
  // The real `listFilesAtRevision` (`facades.ts`) never actually throws (a missing directory or
  // unresolvable revision reads as an empty array, its own doc comment) -- this `catch`, like
  // `readAtRevision`'s identical "any git-level failure reads as absent" convention this whole lookup
  // already follows, is only reached by a hand-built facade. A genuine infrastructure failure and "the
  // report is not there" are deliberately not distinguished here, matching that established convention:
  // both are `MERGE-REVIEW-INCOMPLETE`, a `policy`-classified (never-retried) failure a human has to look
  // at either way.
  let files: readonly string[];
  try {
    files = await ctx.vcs.listFilesAtRevision(lane, 'HEAD', reportsDir);
  } catch {
    return undefined;
  }
  for (const file of files) {
    // `listFilesAtRevision` lists recursively (`git ls-tree -r`): the dirname check, not just the
    // basename pattern, is what `resumeSwarmReviewStep`'s own identical lookup (`swarm-review-step.ts`)
    // requires too -- keeping the two in step so a nested `<reportsDir>/sub/REVIEW-999.md` (never written
    // by this engine, but not excluded by the basename pattern alone) is rejected here exactly as it
    // already is there, not picked up as a real report by one lookup and refused by the other.
    if (path.posix.dirname(file) !== reportsDir) continue;
    if (!REVIEW_REPORT_FILE.test(path.posix.basename(file))) continue;
    const text = await ctx.vcs.readAtRevision(lane, 'HEAD', file);
    if (text === undefined) continue;
    let frontMatter: unknown;
    try {
      frontMatter = ArtifactDocument.parse(text, file).frontMatter;
    } catch {
      continue;
    }
    if (typeof frontMatter !== 'object' || frontMatter === null) continue;
    const record = frontMatter as Record<string, unknown>;
    const verdict = parseReviewVerdict(record);
    if (verdict === undefined) continue;
    const id = record['id'];
    if (typeof id !== 'string' || id === '') continue;
    return { verdict, reportId: id };
  }
  return undefined;
}

/** `MERGE-REVIEW-INCOMPLETE`, beside `VCS-MISSING-CONFLICT-RESOLVER` in `classifyFailure`'s own `policy`
 * mapping (`classify.ts`): the same committed report fails identically on every retry until a human
 * actually looks at it, so retrying the merge changes nothing. Names the report (or its absence), the
 * review step, and the resume path -- the remedy a run stuck here actually needs. */
function reviewIncompleteFailure(
  reviewStepId: string,
  lookup: ReviewLookup | undefined,
): StepFailureInfo {
  const found =
    lookup === undefined
      ? 'no readable, parseable ReviewReport with a bound verdict'
      : `${lookup.reportId}, whose bound verdict is "${lookup.verdict}"`;
  return {
    source: 'merge',
    code: 'MERGE-REVIEW-INCOMPLETE',
    message:
      `The swarm review ${reviewStepId} was not landed: its committed report is ${found}, neither ` +
      '"concerns" nor "clear". Remedy: look at the findings the review named, fix or accept them, and ' +
      `re-run ${reviewStepId} (a fresh review, not a retry of this merge); then \`forge resume\` this run.`,
  };
}

/** One entry of `runMergeStep`'s own `merges` accumulator -- structurally identical to
 * `StepOutcomeDetail`'s own `'merge'` variant's `merges[]` element (`types.ts`), declared once here so
 * the two review fields are not repeated inline at every use site. */
interface MergeStepEntry {
  readonly stepId: string;
  readonly outcome: MergeOutcome;
  readonly reviewVerdict?: string | undefined;
  readonly reviewReportId?: string | undefined;
}

interface SwarmReviewLanding {
  /** Predecessor ids this merge must not land: a review lane whose own verdict is not landable, plus (the
   * reverse rule) its own direct `dependsOn` predecessors within THIS merge's own landing scope -- the
   * implement lane(s) it reviews (P38 stacking). */
  readonly refused: ReadonlySet<string>;
  /** Why each refused id was refused, keyed by that id -- a review and what it reviews share the same
   * failure object, so both name the same report and the same remedy. */
  readonly reasons: ReadonlyMap<string, StepFailureInfo>;
  /** Every review lane whose verdict landed (`concerns`/`clear`), keyed by the review's own step id. */
  readonly landable: ReadonlyMap<string, ReviewLookup>;
}

/** Resolves every swarm-review lane's own bound verdict BEFORE any lane in `predecessorLanes` is touched:
 * `mergeLandingScope`'s own dependencies-first order would otherwise hand a review's implement lane to the
 * queue before the review's own turn in the loop below ever comes up, so a bad verdict has to be known up
 * front, not discovered only once the review lane's own entry is reached. */
async function resolveSwarmReviewLanding(
  ctx: ExecuteStepContext,
  stepGraph: ReadonlyMap<string, StepNode>,
  predecessorLanes: readonly { readonly predecessorId: string; readonly lane: LaneHandle }[],
): Promise<SwarmReviewLanding> {
  const inScope = new Set(predecessorLanes.map((entry) => entry.predecessorId));
  const refused = new Set<string>();
  const reasons = new Map<string, StepFailureInfo>();
  const landable = new Map<string, ReviewLookup>();
  for (const { predecessorId, lane } of predecessorLanes) {
    const reviewNode = stepGraph.get(predecessorId);
    if (reviewNode?.interactionMode !== 'swarm-review') continue;
    const lookup = await readReviewLookup(ctx, lane);
    if (lookup === undefined || lookup.verdict === 'incomplete' || lookup.verdict === 'blocked') {
      const failure = reviewIncompleteFailure(predecessorId, lookup);
      refused.add(predecessorId);
      reasons.set(predecessorId, failure);
      // The reverse rule: the implement lane(s) this review reviews are landed BEFORE it in
      // mergeLandingScope's own post order, so without this a refused review's own upstream would
      // already be in the integration branch by the time its bad verdict is discovered. Scoped to this
      // merge's own landing scope only (`inScope`): a predecessor no merge in this call is landing was
      // integrated earlier (behind a checkpoint `mergeLandingScope` itself already excluded) and is not
      // this merge's to hold back.
      //
      // The FULL transitive upstream closure (`upstreamOf`, the identical helper `blockedBy` below already
      // uses for the symmetric downstream direction), not just the review's own direct `dependsOn`. A
      // round-2 gauntlet critic found the direct-only version left the real code lanes landing for
      // `implement-story.workflow.yaml`'s own canonical inner loop: `review` there `dependsOn: [self-verify]`
      // (a content-less `forge story verify` command step), several stacked hops downstream of the actual
      // `green`/`refactor` lanes that hold the reviewed code -- reproduced empirically: with the direct-only
      // version, `green`'s own file reached the integration branch even though the merge step's own outcome
      // was `failed`. `upstreamOf` walks every `dependsOn` edge transitively, so it reaches `green`/
      // `refactor`/`red`/`plan` too, exactly the whole stacked chain this review's own diff is actually
      // built on -- correct for a linear inner loop, and for `build-stage.workflow.yaml`'s own shorter
      // `review -> implement -> generate-tests` chain it reaches `generate-tests` as well (the story's own
      // test files, part of the same reviewed unit of work), never anything outside this merge's own scope.
      for (const upstreamId of upstreamOf(stepGraph, predecessorId)) {
        if (!inScope.has(upstreamId) || refused.has(upstreamId)) continue;
        refused.add(upstreamId);
        reasons.set(upstreamId, failure);
      }
      continue;
    }
    landable.set(predecessorId, lookup);
  }
  return { refused, reasons, landable };
}

/** `PLAN-M14.md` P35: `lane`'s own `replayFrom` for landing, or `undefined` for the ordinary, unchanged
 * rebase. Non-`undefined` only when `lane` really is a joined lane (`stackedOn`/`joinedFrom` set,
 * `createLaneForStep`) AND every predecessor it names has already landed -- checked against `notLanded`
 * (this same `runMergeStep` call's own "did not land" set), which is sufficient rather than merely
 * necessary here: `resolveLaneBase`'s own `sharesMergeScope` gate means a `stackedOn`/`joinedFrom`
 * predecessor is ALWAYS in this same merge's own landing scope (never a different one), so this function
 * is only ever called (in the loop below) once `blockedBy`'s own transitive `upstreamOf` check --
 * a superset of `stackedOn`/`joinedFrom` -- has already confirmed nothing upstream is in `notLanded`. The
 * explicit per-id check below is kept anyway rather than trusting that invariant implicitly: cheap,
 * self-documenting, and safe (a false negative here only means the ordinary rebase runs, never a lossy
 * one) even for a plan shape this reasoning has not anticipated.
 *
 * Exported (not merely a closure inside `runMergeStep`) so the `notLanded` guard above is directly
 * testable in isolation: `runMergeStep`'s own loop, the one real call site, never actually reaches this
 * function for a `stackedOn`/`joinedFrom` predecessor genuinely still in `notLanded` (`blockedBy`
 * already `continue`s past it first, per the paragraph above) -- so no test built only through
 * `runMergeStep`/`executeStep` can ever exercise this guard's own `false` branch. The identical
 * "defensive, currently unreachable through the real call site, still worth a real test of its own"
 * situation this codebase's own `conflictStatuses`/`revertMerge` (`@forge/vcs`) already established the
 * "export it, feed it a real edge case" pattern for. */
export function replayFromFor(
  lane: LaneHandle,
  notLanded: ReadonlySet<string>,
): string | undefined {
  const predecessors = lane.stackedOn === undefined ? (lane.joinedFrom ?? []) : [lane.stackedOn];
  if (predecessors.length === 0) return undefined;
  if (predecessors.some((id) => notLanded.has(id))) return undefined;
  return lane.baseSha;
}

export async function runMergeStep(node: StepNode, ctx: ExecuteStepContext): Promise<StepOutcome> {
  const startedAt = ctx.now();
  await ctx.telemetry.emit({ type: 'StepStarted', stepId: node.id });

  if (node.mergePolicy === undefined) {
    throw new ForgeError('RUN-039', {
      stepId: node.id,
      kind: 'merge (missing its own mergePolicy field)',
    });
  }
  if (!isConflictPolicy(node.mergePolicy.conflict)) {
    throw new ForgeError('RUN-041', { stepId: node.id, conflict: node.mergePolicy.conflict });
  }
  // Captured once, here -- via the still-narrowed `node.mergePolicy`/`.conflict` expression path, right
  // after both checks above and before either is ever read inside a closure -- for the identical "a
  // closure re-reading a member access re-widens past a narrowing check on the outer object" reason
  // `runCommandStep`'s own `run` constant exists for. Order matters: capturing `mergePolicy` first and
  // then reading `mergePolicy.conflict` a line later does NOT inherit the narrowing above, since that
  // checked the `node.mergePolicy.conflict` path specifically, not this new one.
  const conflictPolicy = node.mergePolicy.conflict;
  const mergePolicy = node.mergePolicy;

  // The declared checks, resolved once before any lane is touched (`PLAN-M13.md` P38): `preChecks: fast` names a
  // set of test layers (`execution.testCommands`), not a shell command. One that cannot be resolved fails the step
  // as data, with the config key named, and every lane stays where it was.
  const resolvedChecks = resolveLaneChecks(ctx, {
    pre: mergePolicy.preChecks,
    post: mergePolicy.postChecks,
    preSource: `the merge policy preChecks of ${node.id}`,
    postSource: `the merge policy postChecks of ${node.id}`,
  });
  if (!resolvedChecks.ok) {
    return failed(
      node.id,
      startedAt,
      ctx.now(),
      { kind: 'merge', merges: [] },
      resolvedChecks.failure,
    );
  }

  // The lanes this merge lands (`PLAN-M13.md` P19, Q221): with the run's compiled plan at hand, the lanes of
  // every step in the merge's dependency closure (`mergeLandingScope`), dependencies first, so a `build-stage`
  // merge over the per-story reviews lands the `implement` lanes those reviews approved, not just the review
  // lanes. A merge driven with no plan (a handler run on its own) lands its direct predecessors' lanes.
  const landingIds =
    ctx.stepGraph === undefined ? node.dependsOn : mergeLandingScope(ctx.stepGraph, node.id);
  const predecessorLanes = landingIds
    .map((predecessorId) => ({ predecessorId, lane: ctx.laneRegistry.get(predecessorId) }))
    .filter(
      (entry): entry is { readonly predecessorId: string; readonly lane: LaneHandle } =>
        entry.lane !== undefined,
    );

  // `PLAN-M14.md` P18: every swarm-review lane's own bound verdict, resolved BEFORE any lane below is
  // touched (this function's own doc comment above has the ordering reasoning). A merge driven with no
  // compiled plan (`ctx.stepGraph === undefined`) has no way to know which of its predecessors is a
  // `swarm-review` node at all, so nothing here applies then -- the identical "no plan, no scope beyond
  // direct predecessors" fallback `landingIds` above already takes.
  const swarmReview: SwarmReviewLanding =
    ctx.stepGraph === undefined
      ? { refused: new Set(), reasons: new Map(), landable: new Map() }
      : await resolveSwarmReviewLanding(ctx, ctx.stepGraph, predecessorLanes);

  const merges: MergeStepEntry[] = [];
  // First failure wins, not last: several predecessor lanes are each processed independently
  // regardless of an earlier one's own outcome (below), so the *first* thing that went wrong is the
  // more useful signal to surface as the step's own primary failure reason -- `detail.merges` still
  // carries every lane's own real outcome for a reader who wants the full picture, not just the first.
  let anyFailed: StepFailureInfo | undefined;
  // The lanes are claimed up front: taken out of the registry in the same synchronous step that chose them, so
  // a second merge in the same tick whose landing scope shares one (two merges over disjoint reviews that both
  // build on one upstream lane) cannot land it again. A lane that did not land goes back in the registry.
  for (const { predecessorId } of predecessorLanes) ctx.laneRegistry.delete(predecessorId);
  const notLanded = new Set<string>();
  for (const { predecessorId, lane } of predecessorLanes) {
    // `PLAN-M14.md` P18: a swarm-review lane with a non-landable verdict, or the implement lane(s) it
    // reviews (upstream, P38 stacking) -- resolved above, before any lane in this merge's own landing
    // scope was touched, so this always wins over the dependencies-first landing order below.
    if (swarmReview.refused.has(predecessorId)) {
      notLanded.add(predecessorId);
      ctx.laneRegistry.set(predecessorId, lane);
      const failure = swarmReview.reasons.get(predecessorId);
      if (failure !== undefined) anyFailed ??= failure;
      continue;
    }
    // A lane whose own dependency did not land is not landed either: its work builds on a lane that is not in
    // the integration branch (a review report for code that is not there). Independent lanes carry on.
    const blockedBy =
      ctx.stepGraph === undefined
        ? undefined
        : [...upstreamOf(ctx.stepGraph, predecessorId)].find((id) => notLanded.has(id));
    if (blockedBy !== undefined) {
      notLanded.add(predecessorId);
      ctx.laneRegistry.set(predecessorId, lane);
      anyFailed ??= {
        source: 'merge',
        code: 'MERGE-DEPENDENCY-NOT-LANDED',
        message: `Lane ${lane.laneId} was not merged: the lane of ${blockedBy}, which it builds on, did not land.`,
      };
      continue;
    }
    // `PLAN-M14.md` P18: a landable swarm-review lane's own verdict/report id, carried into the merge
    // commit's trailer only for `concerns` (`clear` lands exactly like any other lane, no trailer -- the
    // piece's own mandate) and onto `detail.merges[]` below regardless of which of the two it is.
    const reviewInfo = swarmReview.landable.get(predecessorId);
    const replayFrom = replayFromFor(lane, notLanded);
    const landed = await landLane(ctx, {
      eventStepId: node.id,
      laneStepId: predecessorId,
      lane,
      conflictPolicy,
      checks: resolvedChecks.value.checks,
      skippedLayers: resolvedChecks.value.skipped,
      ...(reviewInfo?.verdict === 'concerns'
        ? { reviewVerdict: reviewInfo.verdict, reviewReportId: reviewInfo.reportId }
        : {}),
      ...(replayFrom === undefined ? {} : { replayFrom }),
    });
    if (landed.outcome !== undefined) {
      merges.push({
        stepId: predecessorId,
        outcome: landed.outcome,
        ...(reviewInfo === undefined
          ? {}
          : { reviewVerdict: reviewInfo.verdict, reviewReportId: reviewInfo.reportId }),
      });
    }
    if (landed.failure !== undefined) anyFailed ??= landed.failure;
    if (!contentLanded(landed.outcome) && landed.alreadyIntegrated !== true) {
      notLanded.add(predecessorId);
      ctx.laneRegistry.set(predecessorId, lane);
    }
  }

  const finishedAt = ctx.now();
  const { skipped } = resolvedChecks.value;
  const detail: StepOutcomeDetail = {
    kind: 'merge',
    merges,
    ...(skipped.pre.length + skipped.post.length === 0 ? {} : { skippedLayers: skipped }),
  };
  if (anyFailed !== undefined) return failed(node.id, startedAt, finishedAt, detail, anyFailed);
  return succeeded(node.id, startedAt, finishedAt, detail);
}

export async function runCheckpointStep(
  node: StepNode,
  ctx: ExecuteStepContext,
): Promise<StepOutcome> {
  const startedAt = ctx.now();
  await ctx.telemetry.emit({ type: 'StepStarted', stepId: node.id });
  const finishedAt = ctx.now();
  return succeeded(node.id, startedAt, finishedAt, { kind: 'checkpoint' });
}
