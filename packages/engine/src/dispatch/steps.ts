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
import { ForgeError, isForgeError } from '@forge/core/errors';
import type { SessionRequest } from '@forge/adapter-kit';

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
import { GateNotFoundError } from './facades.ts';
import { contentLanded, landLane } from './integrate.ts';
import { restoreIntegrationTree, snapshotIntegrationTree } from './inline-tree.ts';
import { docRootsOf, resolveStepClaim, verifyDeclaredOutputs } from './outputs.ts';
import { clearResultRecord, writeResultRecord, type ResultRecordRef } from './result-record.ts';
import { runShellCommand } from './shell.ts';
import { runVcsStep } from './vcs-step.ts';
import type {
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
   * original and only behaviour before P19. */
  existing?: { readonly lane: LaneHandle; readonly baseSha: string },
): Promise<StepOutcome> {
  let lane: LaneHandle;
  let baseSha: string;
  if (existing === undefined) {
    const baseShaResult = await runVcsStep(node.id, () =>
      ctx.vcs.resolveRevision(ctx.integrationBase),
    );
    if (!baseShaResult.ok)
      return failed(node.id, startedAt, ctx.now(), emptyDetail, baseShaResult.failure);

    // From the sha just resolved, not from the branch name again: the integration branch moves during a run
    // (lanes are integrated into it, `PLAN-M13.md` P19), and a lane created from a tip newer than the `baseSha`
    // its claim is enforced against would show other lanes' files as its own out-of-claim writes.
    const laneResult = await runVcsStep(node.id, () =>
      ctx.vcs.createLane(node.id, baseShaResult.value),
    );
    if (!laneResult.ok)
      return failed(node.id, startedAt, ctx.now(), emptyDetail, laneResult.failure);
    lane = laneResult.value;
    baseSha = baseShaResult.value;
    await ctx.telemetry.emit({
      type: 'LaneCreated',
      stepId: node.id,
      laneId: lane.laneId,
      payload: { baseSha },
    });
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
    const claim = resolveStepClaim(node, docRootsOf(ctx), ctx.claimPolicy);
    const enforceResult = await runVcsStep(node.id, () =>
      ctx.vcs.enforceClaim(lane, baseSha, claim.globs, claim.policy, claim.exclude),
    );
    if (!enforceResult.ok)
      return failed(node.id, startedAt, ctx.now(), work.detail, enforceResult.failure);
    claimReverted = enforceResult.value.reverted;
    if (enforceResult.value.outOfClaim.length > 0) {
      // `06` §6.7: an out-of-claim write is a policy violation. Enforcement never fails the step for it, so
      // this event is the record of which files fell outside the claim and whether they were reverted
      // (`strict`) or kept (`warn`): a brief-named document outside a step's outputs and `produces` is
      // otherwise discarded without a trace.
      await ctx.telemetry.emit({
        type: 'PolicyViolation',
        stepId: node.id,
        laneId: lane.laneId,
        payload: {
          kind: 'out-of-claim-write',
          policy: claim.policy,
          paths: enforceResult.value.outOfClaim
            .slice(0, MAX_VIOLATION_PATHS_LOGGED)
            .map((file) => (file.length > 300 ? `${file.slice(0, 300)}...` : file)),
          totalOutOfClaim: enforceResult.value.outOfClaim.length,
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
    verifyDeclaredOutputs(node, ctx, lane, baseSha, claimReverted),
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
 * is read here. */
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
    env: {},
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
      ? await tryAssemble({ node, ctx, taskText: options.taskText, briefKey: options.briefKey })
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
    await clearResultRecord(
      ctx.assembly.paths,
      ctx.runId,
      promptRecordDirName(plan.kind === 'start' ? plan.assembled.stepKey : node.id),
    ).catch(() => undefined);
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
    resultRef = await writeResultRecord(
      ctx.assembly.paths,
      ctx.runId,
      promptRecordDirName(plan.kind === 'start' ? plan.assembled.stepKey : node.id),
      session.finalText,
    );
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
  // P10 already found for S5's control-token stripping. Emitted here, once per real session that
  // actually produced a result (a crash before `handle.result()` ever resolves -- the `catch` block
  // above -- genuinely has no usage figure to report; emitting a fabricated `0` there would misrepresent
  // "unknown" as "free", not merely round down). `estimated: true` unconditionally: `07` §7.3's own
  // "adapter-reported figures are client-side estimates, never presented as an invoice" applies to
  // every real adapter this codebase can construct today, not a caller-decided flag this module has any
  // basis to vary.
  await ctx.telemetry.emit({
    type: 'UsageRecorded',
    stepId: node.id,
    agentId: node.agent,
    payload: {
      model,
      platform: ctx.adapter.id,
      inputTokens: sanitizeUsageNumber(session.usage.inputTokens),
      outputTokens: sanitizeUsageNumber(session.usage.outputTokens),
      cacheReadTokens: 0,
      costUsd: session.usage.costUsd === undefined ? 0 : sanitizeUsageNumber(session.usage.costUsd),
      estimated: true,
      durationMs: sanitizeUsageNumber(session.durationMs),
    },
  });

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
  await ctx.telemetry.emit({ type: 'StepStarted', stepId: node.id });

  if (node.agent === undefined) {
    throw new ForgeError('RUN-039', {
      stepId: node.id,
      kind: 'agent (missing its own agent field)',
    });
  }

  // Assembled before a lane is created: a step refused for a missing agent/brief, an unmapped model or a
  // grant above its ceiling must leave no worktree behind, and dispatches nothing.
  const assembled = await tryAssemble({
    node,
    ctx,
    taskText: options.taskText,
    briefKey: options.briefKey,
  });
  if (!assembled.ok) {
    return failed(
      node.id,
      startedAt,
      ctx.now(),
      { kind: 'agent', session: EMPTY_SESSION_RESULT },
      assembled.failure,
    );
  }

  return runLaneLifecycle(
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
  );
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
  // (or nothing) the user has installed.
  const commandEnv = ctx.commandEnv;

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
    payload: { gateId: node.gate, passed: report.passed },
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

  const merges: { readonly stepId: string; readonly outcome: MergeOutcome }[] = [];
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
    const landed = await landLane(ctx, {
      eventStepId: node.id,
      laneStepId: predecessorId,
      lane,
      conflictPolicy,
      checks: { preCheck: mergePolicy.preChecks, postCheck: mergePolicy.postChecks },
    });
    if (landed.outcome !== undefined)
      merges.push({ stepId: predecessorId, outcome: landed.outcome });
    if (landed.failure !== undefined) anyFailed ??= landed.failure;
    if (!contentLanded(landed.outcome)) {
      notLanded.add(predecessorId);
      ctx.laneRegistry.set(predecessorId, lane);
    }
  }

  const finishedAt = ctx.now();
  const detail: StepOutcomeDetail = { kind: 'merge', merges };
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
