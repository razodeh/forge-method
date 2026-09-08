/**
 * `reconstructRunState` — `06` §6.10 step 1: fold the full event catalogue (`18` §18.4) into a `RunState`,
 * one reducer case per event type, exhaustive by construction.
 *
 * @see specs/06 §6.10
 * @see specs/18 §18.4
 * @see PLAN-M5.md P18
 */
import type { EventType, ForgeEvent } from '@forge/telemetry/events';

import type { LaneReconstructedStatus, RunState, StepReconstructedStatus } from './types.ts';

/** The mutable working shape `applyEvent` folds into — `stepStatuses`/`laneStatuses` are real `Map`s here
 * (mutated in place across the whole fold, for the same reason `@forge/engine/dispatch`'s own
 * `ctx.laneRegistry` is a real `Map` threaded through many calls rather than cloned per step: cloning a
 * potentially-large map on every one of a run's own many events is real, avoidable cost for no actual
 * purity benefit — nothing outside this one fold ever aliases or mutates it mid-flight). Still a `Map`
 * assignable to `RunState`'s own `ReadonlyMap` fields with no cast needed at the final return. */
interface Accumulator {
  runId: string | undefined;
  planRef: string | undefined;
  runStatus: RunState['runStatus'];
  readonly stepStatuses: Map<string, StepReconstructedStatus>;
  readonly laneStatuses: Map<string, LaneReconstructedStatus>;
  spentUsd: number;
  readonly sessionIds: Map<string, string>;
  readonly laneOrigins: Map<string, { readonly stepId: string; readonly baseSha: string }>;
  readonly artifactPaths: Set<string>;
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** `RunPlanned`'s own payload has no shape given anywhere in the spec pack — this piece's own invented
 * design (`types.ts`'s own doc comment has the fuller reasoning for why a bare reference string, not the
 * full compiled plan, is the right shape). Read leniently: a malformed or absent `planRef` string leaves
 * `Accumulator.planRef` at whatever it already was rather than throwing, the same "a corrupted single
 * event should not make the whole reconstruction impossible" stance `extractCostUsd` below also takes —
 * `reconstructRunState`'s entire purpose is recovering gracefully after a real crash, where a partially-
 * written last line is a genuine, expected scenario, not a reason to make resume itself impossible. */
function extractPlanRef(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const value = (payload as Record<string, unknown>)['planRef'];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** `UsageRecordedPayload.costUsd` (`@forge/telemetry`, P7) is the one payload field this reducer actually
 * reads a value out of, not just reacts to the presence of. Not imported/reused from `@forge/telemetry/
 * ledger`'s own `isUsageRecordedPayload`: that function throws `TelemetryError` on a malformed payload
 * (the right choice for `projectLedger`, a full second-pass ledger build where a bad row really is worth
 * stopping for), whereas this fold's own job is specifically to survive a possibly-imperfect log — reading
 * `costUsd` defensively and contributing `0` for anything malformed keeps one bad `UsageRecorded` event
 * from making `reconstructRunState` throw on a log otherwise perfectly resumable. */
function extractCostUsd(payload: unknown): number {
  if (typeof payload !== 'object' || payload === null) return 0;
  const value = (payload as Record<string, unknown>)['costUsd'];
  return isFiniteNonNegativeNumber(value) ? value : 0;
}

function extractStringField(payload: unknown, field: string): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const value = (payload as Record<string, unknown>)[field];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** `RunAborted` cascades: every step not already in one of the three terminal-or-skipped statuses
 * (`succeeded`/`failed`/`skipped`) — i.e. still `scheduled`, `running`, or already `escalated` — becomes
 * `aborted`. `18` §18.4's own Step group has no dedicated `StepAborted` event at all (confirmed directly
 * in `EventType`'s own declared union — `06` §6.10's own step-transition diagram names one, but it was
 * never actually registered), so a run-level abort is the only real signal this reducer can derive a
 * per-step `'aborted'` status from; `06` §6.9's own "`abort`... also terminates running lanes" framing
 * (`SPEC-QUESTIONS.md` Q79) already establishes that a run abort is understood to cascade to in-flight
 * work, not stay a purely run-level fact. `escalated` is included in the cascade too: an escalation still
 * under human/stronger-model review when the whole run aborts is not resolved, it is abandoned along with
 * everything else in flight. */
function cascadeAbort(stepStatuses: Map<string, StepReconstructedStatus>): void {
  for (const [stepId, status] of stepStatuses) {
    if (status === 'scheduled' || status === 'running' || status === 'escalated') {
      stepStatuses.set(stepId, 'aborted');
    }
  }
}

/** One case per `EventType`, exhaustive by construction: every branch `return`s, and this function's own
 * non-`void` return type means TypeScript itself refuses to compile if a real event type is ever left
 * unhandled — no `default` case, so a future new `EventType` member is a compile error here, not a silent
 * no-op, matching `PLAN-M5.md`'s own explicit Mandate text for this piece. Groups with no dedicated
 * `RunState` field of their own (Adapter/Artifact/KB/Gate/Merge-detail/Human/Security/Custom — everything
 * beyond what already reaches `stepStatuses`/`laneStatuses`/`spentUsd`/`planRef`/`runStatus`) still get a
 * real, individually-named case each, returning `acc` unchanged — deliberately not a wildcard "everything
 * else" branch, since a wildcard would defeat the entire point of exhaustiveness checking the moment a
 * real new event type is added to the catalogue. */
function applyEvent(acc: Accumulator, event: ForgeEvent): Accumulator {
  switch (event.type) {
    case 'RunPlanned':
      // `?? acc.planRef`, not a bare overwrite: a gauntlet-loop critic round found the original version
      // unconditionally assigned extractPlanRef's own result, silently wiping out a previously-recovered
      // planRef the moment a second (malformed) RunPlanned appeared later in the same log -- doing the
      // opposite of extractPlanRef's own documented "leave it at whatever it already was" leniency.
      acc.planRef = extractPlanRef(event.payload) ?? acc.planRef;
      acc.runStatus = 'planned';
      return acc;
    case 'RunStarted':
      acc.runStatus = 'started';
      return acc;
    case 'RunPaused':
      acc.runStatus = 'paused';
      return acc;
    case 'RunResumed':
      acc.runStatus = 'resumed';
      return acc;
    case 'RunCompleted':
      acc.runStatus = 'completed';
      return acc;
    case 'RunAborted':
      acc.runStatus = 'aborted';
      cascadeAbort(acc.stepStatuses);
      return acc;
    case 'RunFailed':
      acc.runStatus = 'failed';
      return acc;

    case 'StepScheduled':
      if (event.stepId !== undefined) acc.stepStatuses.set(event.stepId, 'scheduled');
      return acc;
    case 'StepStarted':
      if (event.stepId !== undefined) acc.stepStatuses.set(event.stepId, 'running');
      return acc;
    case 'StepProgress':
      return acc;
    case 'StepSucceeded':
      if (event.stepId !== undefined) acc.stepStatuses.set(event.stepId, 'succeeded');
      return acc;
    case 'StepFailed':
      if (event.stepId !== undefined) acc.stepStatuses.set(event.stepId, 'failed');
      return acc;
    case 'StepRetried':
      // A retry un-terminates a previously-failed step: the next real transition for this same stepId
      // is a fresh StepStarted (or another StepScheduled first), so this resets to 'scheduled' rather
      // than leaving the stale 'failed' status of the attempt that is about to be superseded in place.
      if (event.stepId !== undefined) acc.stepStatuses.set(event.stepId, 'scheduled');
      return acc;
    case 'StepSkipped':
      if (event.stepId !== undefined) acc.stepStatuses.set(event.stepId, 'skipped');
      return acc;
    case 'StepEscalated':
      if (event.stepId !== undefined) acc.stepStatuses.set(event.stepId, 'escalated');
      return acc;

    case 'LaneCreated':
      if (event.laneId !== undefined) {
        acc.laneStatuses.set(event.laneId, 'created');
        // Malformed/missing baseSha leaves this lane simply absent from laneOrigins rather than
        // recorded with a bogus baseSha -- the identical "a corrupted single event should not make the
        // whole reconstruction impossible, nor should it fabricate a value nothing actually supplied"
        // leniency extractPlanRef/extractCostUsd already take, applied here to a field (unlike those
        // two) with no safe fallback value to default to at all.
        const stepId = event.stepId;
        const baseSha = extractStringField(event.payload, 'baseSha');
        if (stepId !== undefined && baseSha !== undefined) {
          acc.laneOrigins.set(event.laneId, { stepId, baseSha });
        }
      }
      return acc;
    case 'LaneCommitted':
      if (event.laneId !== undefined) acc.laneStatuses.set(event.laneId, 'committed');
      return acc;
    case 'LaneReady':
      if (event.laneId !== undefined) acc.laneStatuses.set(event.laneId, 'ready');
      return acc;
    case 'LaneAbandoned':
      if (event.laneId !== undefined) acc.laneStatuses.set(event.laneId, 'abandoned');
      return acc;
    case 'LaneRemoved':
      if (event.laneId !== undefined) acc.laneStatuses.set(event.laneId, 'removed');
      return acc;

    case 'UsageRecorded':
      acc.spentUsd += extractCostUsd(event.payload);
      return acc;

    case 'SessionEvent':
      // "Most recent wins," not "first": see RunState.sessionIds' own doc comment.
      if (event.stepId !== undefined) {
        const sessionId = extractStringField(event.payload, 'sessionId');
        if (sessionId !== undefined) acc.sessionIds.set(event.stepId, sessionId);
      }
      return acc;

    case 'ArtifactCreated':
    case 'ArtifactUpdated': {
      const artifactPath = extractStringField(event.payload, 'path');
      if (artifactPath !== undefined) acc.artifactPaths.add(artifactPath);
      return acc;
    }

    // Real, registered event types with no dedicated RunState field of their own -- see this function's
    // own doc comment for why each still needs its own named case.
    case 'SessionStarted':
    case 'SessionEnded':
    case 'AdapterError':
    case 'AdapterRetry':
    case 'ArtifactValidated':
    case 'ArtifactRejected':
    case 'KbWritten':
    case 'KbProposed':
    case 'KbProposalResolved':
    case 'KbContradictionDetected':
    case 'GateEvaluated':
    case 'GateApproved':
    case 'GateRejected':
    case 'GateWaived':
    case 'MergeQueued':
    case 'MergeStarted':
    case 'MergeConflict':
    case 'MergeCompleted':
    case 'MergeReverted':
    case 'ElicitationRequested':
    case 'ElicitationAnswered':
    case 'AssumptionRecorded':
    case 'InterjectionSent':
    case 'BudgetWarning':
    case 'BudgetBreached':
    case 'PolicyViolation':
    case 'SecretRedacted':
    case 'InjectionAttemptBlocked':
    case 'EscalationActive':
    case 'CheckRun':
    case 'DiagramGenerated':
    case 'DriftDetected':
      return acc;
  }
}

/** `06` §6.10 step 1, made real: replays every event in order, folding it into a `RunState`. Deterministic
 * (`21` §21.1) — reads nothing but `events` itself, no wall clock, no ambient state — so replaying the
 * identical sequence twice always produces byte-identical output (`PLAN-M5.md`'s own Checks text). An
 * empty `events` iterable produces a well-defined initial state (every field `undefined`/empty/zero), not
 * a thrown error — there is nothing wrong with a run that has not logged anything yet. */
export async function reconstructRunState(events: AsyncIterable<ForgeEvent>): Promise<RunState> {
  const acc: Accumulator = {
    runId: undefined,
    planRef: undefined,
    runStatus: undefined,
    stepStatuses: new Map(),
    laneStatuses: new Map(),
    spentUsd: 0,
    sessionIds: new Map(),
    laneOrigins: new Map(),
    artifactPaths: new Set(),
  };

  for await (const event of events) {
    // Reassigned on every event, not just the first: harmless under this function's own real contract
    // (`events` is one run's own event log, and `@forge/telemetry`'s own `readEvents` reads exactly one
    // per-run file, so every event here already shares one `runId`). A caller that fed in events from
    // more than one run by mistake would see this silently report the *last* event's own `runId` rather
    // than the first, or a mismatch error -- not a real risk given the real, single-run-per-file source
    // this function is actually ever called with, but worth naming since nothing in this function's own
    // signature enforces it.
    acc.runId = event.runId;
    applyEvent(acc, event);
  }

  const unresolvedStepIds = [...acc.stepStatuses]
    .filter(([, status]) => status === 'running')
    .map(([stepId]) => stepId);

  return {
    runId: acc.runId,
    planRef: acc.planRef,
    runStatus: acc.runStatus,
    stepStatuses: acc.stepStatuses,
    unresolvedStepIds,
    laneStatuses: acc.laneStatuses,
    spentUsd: acc.spentUsd,
    sessionIds: acc.sessionIds,
    laneOrigins: acc.laneOrigins,
    artifactPaths: acc.artifactPaths,
  };
}

/** A gauntlet-loop critic round found `EVENT_TYPES_HANDLED`'s own earlier form (a hand-typed array,
 * `as const satisfies readonly EventType[]`) checked only one direction: every array element really is a
 * valid `EventType`, but nothing caught the array *missing* one — confirmed empirically, removing a real
 * member from that array produced no compile error and no test failure, defeating the doc comment's own
 * stated purpose. `Record<EventType, true>` closes both directions at once, using nothing more exotic
 * than TypeScript's own ordinary object-literal checking: a `Record` type requires *every* key of its own
 * key type to be present in a literal assigned to it (a missing one is `TS2741`), and rejects any key
 * that isn't a real `EventType` (an unknown one is `TS2353`) — the identical bidirectional guarantee
 * `applyEvent`'s own switch already gives at the level of *behaviour*, given here at the level of *this
 * one list a test can iterate*, so the two can never silently drift apart again either. */
const EVENT_TYPE_MEMBERSHIP: Record<EventType, true> = {
  RunPlanned: true,
  RunStarted: true,
  RunPaused: true,
  RunResumed: true,
  RunCompleted: true,
  RunAborted: true,
  RunFailed: true,
  StepScheduled: true,
  StepStarted: true,
  StepProgress: true,
  StepSucceeded: true,
  StepFailed: true,
  StepRetried: true,
  StepSkipped: true,
  StepEscalated: true,
  LaneCreated: true,
  LaneCommitted: true,
  LaneReady: true,
  LaneAbandoned: true,
  LaneRemoved: true,
  SessionStarted: true,
  SessionEvent: true,
  SessionEnded: true,
  AdapterError: true,
  AdapterRetry: true,
  ArtifactCreated: true,
  ArtifactUpdated: true,
  ArtifactValidated: true,
  ArtifactRejected: true,
  KbWritten: true,
  KbProposed: true,
  KbProposalResolved: true,
  KbContradictionDetected: true,
  GateEvaluated: true,
  GateApproved: true,
  GateRejected: true,
  GateWaived: true,
  MergeQueued: true,
  MergeStarted: true,
  MergeConflict: true,
  MergeCompleted: true,
  MergeReverted: true,
  ElicitationRequested: true,
  ElicitationAnswered: true,
  AssumptionRecorded: true,
  InterjectionSent: true,
  UsageRecorded: true,
  BudgetWarning: true,
  BudgetBreached: true,
  PolicyViolation: true,
  SecretRedacted: true,
  InjectionAttemptBlocked: true,
  EscalationActive: true,
  CheckRun: true,
  DiagramGenerated: true,
  DriftDetected: true,
};

/** Exported only so `test/resume/reconstruct.test.ts` can iterate every real, current `EventType` — see
 * `EVENT_TYPE_MEMBERSHIP`'s own doc comment for why this list itself is guaranteed exhaustive, not merely
 * asserted to be. */
export const EVENT_TYPES_HANDLED = Object.keys(EVENT_TYPE_MEMBERSHIP) as readonly EventType[];
