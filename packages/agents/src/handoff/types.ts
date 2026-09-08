/**
 * Types for `@forge/agents/handoff` — `05` §5.6's handoff protocol.
 *
 * @see specs/05 §5.6
 * @see PLAN-M6.md A7
 */
import type { Assumption } from '@forge/schemas/artifacts';

/**
 * The event-log write `emitHandoff` performs (`05` §5.6: "A handoff is an artifact, not a vibe" —
 * that sentence is this piece's own justification for reusing `ArtifactCreated`, `18` §18.4's own
 * closed `EventType` catalogue has no dedicated `Handoff*` entry at all, and inventing a new event
 * type is a bigger, cross-package change than this piece's own scope). Re-declared, not imported: the
 * boundary graph (`02` §2.2) gives `agents ← core, kb, schemas, adapter-kit, templates, extensions` —
 * no edge to `@forge/telemetry` — the identical "no edge, so a minimal caller-supplied facade instead
 * of the real dependency" resolution A4's `KbIndexBackend`-adjacent pieces and A6's own `engine`-split
 * already established for this exact class of gap.
 */
export interface HandoffTelemetryEmitter {
  emit(event: {
    readonly type: 'ArtifactCreated';
    readonly runId: string;
    readonly ts: string;
    readonly stepId?: string;
    readonly agentId?: string;
    readonly payload: unknown;
  }): Promise<unknown>;
}

/**
 * Everything `emitHandoff` needs beyond the parsed `FORGE_HANDOFF:` token itself (which supplies only
 * `to`/`reason` — `07` §7.2's own control-token grammar has no room for `HandoffRecord`'s own richer
 * nested `delivered`/`assumptions`/etc. arrays in one line of agent-emitted text). Every field here is
 * real, caller-supplied data about the emitting step — `delivered`/`constraints_for_receiver`/
 * `acceptance_for_receiver` are expected to come from the step's own actual, already-produced output
 * (declared artifact paths, an `AgentDefinition.outputs` entry's own path, a real constraint the
 * emitting agent's own `ceiling`/`ExecuteStepContext` already enforces) — this piece's own Checks text
 * ("real, non-empty... derived from the emitting step's own actual output, not placeholder text") is
 * about the *caller* supplying real content here, not about `emitHandoff` synthesising it from nothing.
 */
export interface EmitHandoffContext {
  /** The real `HO-####` id (`18` §18.7's own `HandoffRecord` registry entry) — id allocation is
   * `@forge/core/ids`' own job (a real project scan for validity hash), out of this piece's own scope;
   * the caller, who already holds a real `IdAllocator`, supplies one. */
  readonly id: string;
  readonly from: string;
  /** `05` §5.6's own worked example: `"design-system → initialize-repo"` — the emitting and receiving
   * step's own human-readable labels, already joined by the caller. */
  readonly step: string;
  /** ISO-8601 with ms — caller-supplied from an injected clock, the identical determinism discipline
   * (`21` §21.1) `@forge/telemetry`'s own `ForgeEvent.ts` doc comment already requires. */
  readonly timestamp: string;
  readonly delivered: readonly string[];
  readonly openQuestions?: readonly string[] | undefined;
  readonly assumptions?: readonly Assumption[] | undefined;
  readonly constraintsForReceiver?: readonly string[] | undefined;
  readonly acceptanceForReceiver?: readonly string[] | undefined;
  readonly runId: string;
  readonly stepId?: string | undefined;
  readonly telemetry: HandoffTelemetryEmitter;
}
