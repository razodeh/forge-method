/**
 * `RunState` — `06` §6.10 step 1's own "reload event log; rebuild run state," as one pure data shape: a
 * projection of the event log, per `18` §18.4's own rule ("if a value cannot be derived from the log, it
 * does not exist").
 *
 * @see specs/06 §6.10
 * @see specs/18 §18.4
 * @see PLAN-M5.md P18
 */

/** `PLAN-M5.md`'s own literal per-step status enum (`scheduled | running | succeeded | failed | aborted |
 * escalated`) is missing one real, registered event this piece must still handle exhaustively:
 * `StepSkipped` (`18` §18.4's own Step group) — `@forge/engine/scheduler`'s own already-built `StepStatus`
 * (P12) has a `'skipped'` value for the identical real concept (P16's own replan mechanism marking a step
 * as never going to run). Adding `'skipped'` here is the same "the plan's own bullet undersells the
 * signature" correction this build has made once per piece for many pieces running now — the alternative
 * (silently folding `StepSkipped` into one of the six named values, or treating it as a no-op) would
 * either misrepresent a real, distinct outcome as something it isn't, or lose it from the reconstructed
 * state entirely, the one thing `18` §18.4's own "if it isn't in the log, it doesn't exist" rule exists to
 * prevent working the other way too (everything *in* the log must be representable). */
export type StepReconstructedStatus =
  'scheduled' | 'running' | 'succeeded' | 'failed' | 'aborted' | 'escalated' | 'skipped';

/** The Lane event group's own five real event types (`18` §18.4), each naming a distinct point in `06`
 * §6.4's own lane lifecycle — tracked as "whichever happened most recently for this lane," the identical
 * "most recent real transition wins" shape `stepStatuses` below already uses. `'committed'` is reachable
 * more than once for the same lane in a real log (`@forge/engine/dispatch`'s own claim-enforcement revert
 * commit, `SPEC-QUESTIONS.md` Q77, emits a second `LaneCommitted` for the identical lane) — harmless here,
 * since only the most recent transition is ever kept, not a count. */
export type LaneReconstructedStatus = 'created' | 'committed' | 'ready' | 'abandoned' | 'removed';

/** `06` §6.10's own step 1 output, step 2's own input. Every field is a pure projection of the event
 * log — nothing here is inferred, guessed, or defaulted from outside the events actually replayed.
 *
 * `planRef`/`runStatus` come from the Run event group; `stepStatuses`/`unresolvedStepIds` from the Step
 * group; `laneStatuses` from the Lane group; `spentUsd` from the Cost group's own `UsageRecorded` events
 * (the identical `costUsd` summing `@forge/telemetry`'s own `attributedSpend`, P7, already does across an
 * entire ledger — duplicated here rather than composed with it, since `reconstructRunState` consumes its
 * own `AsyncIterable<ForgeEvent>` in one single pass and `attributedSpend` needs an already-materialised
 * `readonly LedgerEntry[]`, a second pass over the same iterable a true single-shot async generator like
 * `readEvents` cannot supply). Every other real event type this catalogue names (Adapter/Artifact/KB/
 * Gate/Merge-detail/Human/Security/Custom groups, beyond what already reaches `laneStatuses`) is read and
 * exhaustively matched by `reconstructRunState`'s own switch but produces no dedicated `RunState` field of
 * its own — out of this piece's own named scope (`PLAN-M5.md`'s own Surface bullet lists exactly what
 * `RunState` carries), not silently dropped: the exhaustiveness check itself is what guarantees a future
 * new event type cannot be forgotten here, even one this piece's own `RunState` shape has nothing to do
 * with yet. */
export interface RunState {
  /** `undefined` for an empty log (`PLAN-M5.md`'s own Checks text: "replaying an empty log produces a
   * well-defined initial state, not a thrown error") — there is no real run identity to report without at
   * least one real event to read it from. */
  readonly runId: string | undefined;
  /** From `RunPlanned`'s own payload — `18` §18.4 gives no payload shape for this event at all (this
   * piece's own invented design, the same "spec gives no payload shape" situation `@forge/telemetry`'s own
   * `UsageRecordedPayload` already resolved once). A plain opaque reference string (a workflow id, a
   * compiled-plan hash — whatever a real caller finds meaningful), not the full compiled `StepNode[]`: the
   * *actual* plan structure a resumed run needs comes from re-compiling the same workflow source fresh
   * (`@forge/engine/plan`, P10), not from a copy duplicated into the append-only log — every step this run
   * ever actually reached already has its own `StepScheduled`/... event regardless, so nothing about
   * *which* steps exist is lost by not also logging the whole plan a second time. */
  readonly planRef: string | undefined;
  /** The Run group's own seven event types collapsed to "whichever happened most recently" — the
   * identical shape `stepStatuses`/`laneStatuses` already use, for the identical reason (a run's own
   * lifecycle is a real state machine, and only the latest transition is ever the current truth). */
  readonly runStatus:
    'planned' | 'started' | 'paused' | 'resumed' | 'completed' | 'aborted' | 'failed' | undefined;
  readonly stepStatuses: ReadonlyMap<string, StepReconstructedStatus>;
  /** Every step id whose own status is `'running'` by the end of replay — `06` §6.10 step 2's own literal
   * input ("for each `StepStarted` without a matching terminal event"). Derivable from `stepStatuses`
   * alone (`[...stepStatuses].filter(([, status]) => status === 'running')`), but named as its own field
   * anyway: `PLAN-M5.md`'s own Surface bullet calls this out with "and — critically —," singling it out as
   * the one value resume orchestration (P19) most directly needs, not merely "any state a caller could
   * derive if it tried." */
  readonly unresolvedStepIds: readonly string[];
  readonly laneStatuses: ReadonlyMap<string, LaneReconstructedStatus>;
  readonly spentUsd: number;
}
