/**
 * Types for `@forge/engine/interaction` — the real, empirically-resolved mechanism `PLAN-M6.md`'s own
 * top-level open design question asks piece A6 to settle: `pair`/`panel`/`debate`/`swarm-review` need a
 * small, additive extension to this already-committed M5 package (`@forge/engine/dispatch`), not
 * something `@forge/agents` alone can drive — `@forge/agents` has no boundary-graph edge to
 * `@forge/engine` at all (`02` §2.2: `agents ← core, kb, schemas, adapter-kit, templates, extensions`,
 * no `engine`), while `engine ← ... agents` already runs the other way. See `SPEC-QUESTIONS.md` Q104
 * for the full resolution record.
 *
 * @see specs/05 §5.7
 * @see specs/10 §10.1
 * @see SPEC-QUESTIONS.md Q104
 * @see PLAN-M6.md A6
 */
import type { SessionResult } from '@forge/adapter-kit';

import type { StepOutcome } from '../dispatch/types.ts';

/** One finding a single perspective's own review session reported, per `10` §10.1's own worked
 * `swarm-review` example. `perspectives` lists every perspective that independently reported an
 * identical `summary` — the real de-duplication `05` §5.7's own "one real, de-duplicated ReviewReport
 * merging every perspective" describes: two perspectives raising the same concern become one finding
 * with two attributions, not two separate findings a reader has to notice are the same thing. */
export interface ReviewFinding {
  readonly summary: string;
  readonly perspectives: readonly string[];
}

export interface ReviewReport {
  readonly perspectives: readonly string[];
  readonly findings: readonly ReviewFinding[];
}

/** One non-primary session a multi-session mode drove — a panelist's own independent answer, a debate
 * round's proposer/critic turn, or one swarm-review perspective's own raw session (before its findings
 * were folded into `InteractionOutcome.reviewReport`). Kept alongside the primary `outcome` rather than
 * discarded once merged, so a caller/test can inspect exactly how many real sessions ran and what each
 * one said — `05` §5.7's own Checks text ("a fixture proving the chosen mechanism actually drives more
 * than one real session/perspective for one logical step") needs this to be a real, inspectable list,
 * not only provable indirectly through the merged result. */
export interface InteractionParticipant {
  readonly role: string;
  readonly session: SessionResult;
}

/**
 * `dispatchAgentStep`'s own return type — a deliberate deviation from `PLAN-M6.md` A6's own literal
 * `Promise<StepOutcome>` Surface text, recorded here rather than silently: `solo`/`fan-out`/`relay`
 * genuinely need nothing more than the existing `StepOutcome` (and `dispatchAgentStep` returns exactly
 * that, wrapped, for those three modes — no behavioural change from delegating straight to
 * `runAgentStep`), but `panel`/`debate`/`swarm-review` drive more than one real session per logical
 * step and produce data (`reviewReport`, the panelist/round-by-round record) `StepOutcome`'s own
 * already-committed, closed `StepOutcomeDetail` union (`@forge/engine/dispatch`, M5) has no field for —
 * extending that closed union itself would be the "small additive extension" the plan's own preamble
 * anticipates, but every one of its six variants is real, already-tested M5 content this piece has no
 * reason to touch. Wrapping instead keeps `outcome` exactly what every existing `StepOutcome` consumer
 * (P12's `Scheduler`, P16's `classifyFailure`) already expects unchanged, while giving the genuinely new
 * multi-session data its own, honestly-optional home.
 */
export interface InteractionOutcome {
  readonly outcome: StepOutcome;
  readonly participants?: readonly InteractionParticipant[];
  readonly reviewReport?: ReviewReport;
}

export interface DispatchAgentStepOptions {
  /** `panel`/`swarm-review` only — `10` §10.1's own worked `perspectives: [design, security, testing,
   * performance]` field. Required for those two modes (`RUN-046` if absent); ignored otherwise. */
  readonly perspectives?: readonly string[];
  /** `debate` only — `05` §5.7's own "≤3 rounds." Defaults to 3; a caller may lower it, never raise it
   * past 3 (clamped), since `05` §5.7's own table gives 3 as the hard ceiling, not a mere default. */
  readonly maxDebateRounds?: number;
}
