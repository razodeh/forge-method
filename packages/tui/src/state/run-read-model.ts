/**
 * `reduceRun`/`INITIAL_RUN_READ_MODEL` — the first real slice of this package's own event-sourced read
 * model: run/step/lane status and total spend, the same real fields `@forge/engine/resume`'s own
 * already-proven `reconstructRunState` (M5 P18) projects, mirrored here (not imported: that function's
 * own mutable-accumulator, one-shot-batch design is a different, incompatible contract from this
 * package's own `createStore`, whose `Object.is`-based change detection needs every reduction to return
 * a genuinely new object only when something really changed — `store.ts`'s own doc comment has the
 * fuller reasoning). Every real `EventType` this catalogue names gets its own explicit case, no
 * `default` — the identical "a future new event type is a compile error here, not a silent no-op"
 * discipline `reconstructRunState` already establishes, enforced by this project's own
 * `@typescript-eslint/switch-exhaustiveness-check` rule.
 *
 * @see specs/04 §4.6
 * @see specs/18 §18.4
 * @see PLAN-M9.md P1
 */
import type { ForgeEvent } from '@forge/telemetry/events';

export type RunStatus =
  'planned' | 'started' | 'paused' | 'resumed' | 'completed' | 'aborted' | 'failed' | undefined;

export type StepReadStatus =
  'scheduled' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'escalated' | 'aborted';

export type LaneReadStatus = 'created' | 'committed' | 'ready' | 'abandoned' | 'removed';

export interface RunReadModel {
  readonly runStatus: RunStatus;
  readonly stepStatuses: ReadonlyMap<string, StepReadStatus>;
  readonly laneStatuses: ReadonlyMap<string, LaneReadStatus>;
  readonly spentUsd: number;
}

export const INITIAL_RUN_READ_MODEL: RunReadModel = {
  runStatus: undefined,
  stepStatuses: new Map(),
  laneStatuses: new Map(),
  spentUsd: 0,
};

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Leniently reads `payload.costUsd`, contributing `0` for anything malformed or absent -- one bad
 * `UsageRecorded` event should never make an otherwise-healthy read model stop updating, the identical
 * "survive a possibly-imperfect log" stance `reconstructRunState`'s own `extractCostUsd` already takes. */
function extractCostUsd(payload: unknown): number {
  if (typeof payload !== 'object' || payload === null) return 0;
  const value = (payload as Record<string, unknown>)['costUsd'];
  return isFiniteNonNegativeNumber(value) ? value : 0;
}

function withStepStatus(
  state: RunReadModel,
  stepId: string | undefined,
  status: StepReadStatus,
): RunReadModel {
  if (stepId === undefined) return state;
  if (state.stepStatuses.get(stepId) === status) return state;
  const stepStatuses = new Map(state.stepStatuses);
  stepStatuses.set(stepId, status);
  return { ...state, stepStatuses };
}

function withLaneStatus(
  state: RunReadModel,
  laneId: string | undefined,
  status: LaneReadStatus,
): RunReadModel {
  if (laneId === undefined) return state;
  if (state.laneStatuses.get(laneId) === status) return state;
  const laneStatuses = new Map(state.laneStatuses);
  laneStatuses.set(laneId, status);
  return { ...state, laneStatuses };
}

function withRunStatus(state: RunReadModel, runStatus: RunStatus): RunReadModel {
  return state.runStatus === runStatus ? state : { ...state, runStatus };
}

/** `18` §18.4's own Step group has no dedicated `StepAborted` event at all (confirmed directly against
 * the real, registered `EventType` union) -- a run-level abort is the only real signal a per-step
 * `'aborted'` status can be derived from, cascading to every step not already terminal-or-skipped
 * (`succeeded`/`failed`/`skipped`), the identical cascade `reconstructRunState`'s own `cascadeAbort`
 * already establishes for the same reason. */
function cascadeAbort(
  stepStatuses: ReadonlyMap<string, StepReadStatus>,
): ReadonlyMap<string, StepReadStatus> {
  let changed = false;
  const next = new Map(stepStatuses);
  for (const [stepId, status] of next) {
    if (status === 'scheduled' || status === 'running' || status === 'escalated') {
      next.set(stepId, 'aborted');
      changed = true;
    }
  }
  return changed ? next : stepStatuses;
}

export function reduceRun(state: RunReadModel, event: ForgeEvent): RunReadModel {
  switch (event.type) {
    case 'RunPlanned':
      return withRunStatus(state, 'planned');
    case 'RunStarted':
      return withRunStatus(state, 'started');
    case 'RunPaused':
      return withRunStatus(state, 'paused');
    case 'RunResumed':
      return withRunStatus(state, 'resumed');
    case 'RunCompleted':
      return withRunStatus(state, 'completed');
    case 'RunAborted': {
      const stepStatuses = cascadeAbort(state.stepStatuses);
      if (state.runStatus === 'aborted' && stepStatuses === state.stepStatuses) return state;
      return { ...state, runStatus: 'aborted', stepStatuses };
    }
    case 'RunFailed':
      return withRunStatus(state, 'failed');

    case 'StepScheduled':
      return withStepStatus(state, event.stepId, 'scheduled');
    case 'StepStarted':
      return withStepStatus(state, event.stepId, 'running');
    case 'StepProgress':
      return state;
    case 'StepSucceeded':
      return withStepStatus(state, event.stepId, 'succeeded');
    case 'StepFailed':
      return withStepStatus(state, event.stepId, 'failed');
    case 'StepRetried':
      // The identical "un-terminate back to scheduled" reasoning `reconstructRunState` already
      // documents: the next real transition for this stepId is a fresh StepStarted (or another
      // StepScheduled), so this resets rather than leaving the stale, about-to-be-superseded status.
      return withStepStatus(state, event.stepId, 'scheduled');
    case 'StepSkipped':
      return withStepStatus(state, event.stepId, 'skipped');
    case 'StepEscalated':
      return withStepStatus(state, event.stepId, 'escalated');

    case 'LaneCreated':
      return withLaneStatus(state, event.laneId, 'created');
    case 'LaneCommitted':
      return withLaneStatus(state, event.laneId, 'committed');
    case 'LaneReady':
      return withLaneStatus(state, event.laneId, 'ready');
    case 'LaneAbandoned':
      return withLaneStatus(state, event.laneId, 'abandoned');
    case 'LaneRemoved':
      return withLaneStatus(state, event.laneId, 'removed');

    case 'UsageRecorded': {
      const cost = extractCostUsd(event.payload);
      return cost === 0 ? state : { ...state, spentUsd: state.spentUsd + cost };
    }

    // Every other real, registered event type -- no dedicated `RunReadModel` field of its own yet.
    // Later pieces (P7+, per `PLAN-M9.md`) extend this same reducer with their own screen's own needed
    // slice; listed individually, never a wildcard, so a future new `EventType` is a compile error here.
    case 'SessionStarted':
    case 'SessionEvent':
    case 'SessionEnded':
    case 'AdapterError':
    case 'AdapterRetry':
    case 'ArtifactCreated':
    case 'ArtifactUpdated':
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
      return state;
  }
}
