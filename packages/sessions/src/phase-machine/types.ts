/**
 * Types for `SessionPhaseMachine` — `16` §16.3's own FRAME → DIVERGE → CONVERGE → DECIDE → RECORD
 * anatomy, as a pure, caller-driven state shape.
 *
 * @see specs/16 §16.2
 * @see specs/16 §16.3
 * @see PLAN-M10.md P9
 */
import type { ForgeError } from '@forge/core';
import type { SessionRecord } from '@forge/schemas';

/** The closed, ten-row table at `16` §16.2 -- derived from the real, already-shipped
 * `sessionRecordSchema` rather than re-declared, so the two can never drift apart. */
export type SessionType = SessionRecord['sessionType'];

/** `16` §16.5's own worked example (`status: complete`) plus the two other real, named outcomes:
 * `inconclusive` (§16.5's own "sessions with zero decisions and zero actions" rule) and `truncated`
 * (§16.8's own "the facilitator forces convergence with what it has and records that the session was
 * truncated" breach behaviour). */
export const SESSION_STATUSES = ['complete', 'inconclusive', 'truncated'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/** `16` §16.3's own five phases, in the one fixed order every session runs. */
export const SESSION_PHASES = ['FRAME', 'DIVERGE', 'CONVERGE', 'DECIDE', 'RECORD'] as const;
export type SessionPhase = (typeof SESSION_PHASES)[number];

/** `16` §16.7 point 2's own named role -- muted in DIVERGE, unmuted and structurally required to
 * object in CONVERGE before DECIDE. */
export const CRITIC_ROLE = 'critic';

/** A session participant, named only by role -- `16` §16.2's own "Typical participants" column names
 * roles (`pm`, `architect`, `human`, ...), never a concrete agent instance; resolving a role to a real
 * agent/adapter turn is `PLAN-M10.md` P10's job, not this pure package's. */
export interface SessionParticipant {
  readonly role: string;
}

export interface SessionFraming {
  /** `16` §16.3 step 1: "state the question in one sentence." */
  readonly question: string;
  /** KB entry ids pulled in as constraints, per `16` §16.3 step 1 and §16.5's own `constraints_applied`. */
  readonly constraintsApplied: readonly string[];
  readonly outOfScope: readonly string[];
  /** "what a good outcome looks like" — `16` §16.3 step 1's fourth, literal element. */
  readonly goodOutcomeLooksLike: string;
}

export interface SessionIdea {
  readonly id: string;
  readonly text: string;
  readonly proposedBy: string;
}

export interface SessionCluster {
  readonly id: string;
  readonly label: string;
  readonly ideaIds: readonly string[];
  readonly score?: number | undefined;
  /** Set when this cluster was evaluated and dropped -- `16` §16.5's own worked example: "options
   * eliminated with the reason." */
  readonly eliminatedReason?: string | undefined;
}

/** `16` §16.7 point 2: "critic... a mandate to produce falsifiable objections." */
export interface SessionObjection {
  readonly by: string;
  readonly text: string;
}

export interface SessionDecision {
  readonly id: string;
  readonly decision: string;
  readonly owner: string;
  /** `16` §16.5's own mandatory write-back rule: every decision needs one, eventually. Optional here
   * because a decision may exist for a time before its artifact is written -- `canComplete` is the
   * gate that refuses to consider the session done while this stays unset. */
  readonly artifactRef?: string | undefined;
}

export interface SessionNonDecision {
  readonly question: string;
  readonly reason: string;
  readonly revisitTrigger: string;
}

export interface SessionAction {
  readonly id: string;
  readonly action: string;
  /** Optional for the identical reason `SessionDecision.artifactRef` is -- `canComplete` gates on it. */
  readonly owner?: string | undefined;
  readonly artifactRef?: string | undefined;
}

/** The full, immutable state `SessionPhaseMachine` threads through every phase. Every array is
 * cumulative across rounds within its own phase (`16` §16.8's own "max rounds per phase" bound is
 * enforced by the caller counting its own calls, not by this state, which has no notion of "round"). */
export interface SessionState {
  readonly phase: SessionPhase;
  readonly sessionType: SessionType;
  readonly participants: readonly SessionParticipant[];
  /** Technique ids applied so far, in application order, deduplicated -- `16` §16.5's own
   * `technique: [ scamper, dot-voting ]` field, verbatim. */
  readonly technique: readonly string[];
  readonly framing?: SessionFraming | undefined;
  readonly ideas: readonly SessionIdea[];
  readonly clusters: readonly SessionCluster[];
  readonly objections: readonly SessionObjection[];
  readonly decisions: readonly SessionDecision[];
  readonly nonDecisions: readonly SessionNonDecision[];
  readonly actions: readonly SessionAction[];
  /** Set once, by `frame()`, from the injected `Clock` -- `16` §16.5's own `started` field. */
  readonly startedAt?: string | undefined;
  /** `16` §16.8's own breach behaviour: set when a bound (the DIVERGE idea cap) forced an early
   * phase transition rather than a caller's own deliberate one. */
  readonly truncated: boolean;
  /** `16` §16.5's own literal rule: "sessions with zero decisions and zero actions are recorded as
   * `inconclusive` with a stated reason." Set by `decide()`; read back by `canComplete`. Undefined
   * everywhere else, including a session that does end with real decisions/actions. */
  readonly inconclusiveReason?: string | undefined;
}

/**
 * What the caller needs to do next, returned alongside the new `SessionState` from every transition.
 * Never a live agent/adapter call: at most a description of the dispatch the caller (`PLAN-M10.md`
 * P10) should go make, per this plan's own recorded "pure facilitation logic" Surface deviation.
 */
export type PhaseDirective =
  | {
      /** FRAME refused the question outright (`RUN-061`) -- the state is unchanged, still `FRAME`. */
      readonly kind: 'refused';
      readonly error: ForgeError;
    }
  | {
      /** FRAME accepted the question. `16` §16.3 step 2: "criticism suspended, the critic role is
       * muted" -- `participants` deliberately excludes any `critic` role. */
      readonly kind: 'dispatch-diverge';
      readonly participants: readonly string[];
    }
  | {
      /** DIVERGE may continue: neither the idea cap nor a caller-driven `endDiverge()` has fired. */
      readonly kind: 'continue-diverge';
      readonly ideaCount: number;
    }
  | {
      /** `16` §16.8's own bound fired: the idea cap forced clustering. Every idea offered is still
       * present in `SessionState.ideas` -- forcing convergence is not the same as dropping ideas. */
      readonly kind: 'diverge-capped';
      readonly ideaCount: number;
    }
  | {
      /** DIVERGE ended (by the cap or by the caller) and CONVERGE may begin. `16` §16.3 step 3:
       * "critic is unmuted" -- `participants` includes every participant, critic included. */
      readonly kind: 'dispatch-converge';
      readonly participants: readonly string[];
    }
  | {
      /** CONVERGE may continue: the caller has not yet called `advanceToDecide()`. */
      readonly kind: 'continue-converge';
      readonly clusterCount: number;
    }
  | {
      /** `advanceToDecide()` refused: `16` §16.7 point 2's own structural gate (`RUN-062`). The
       * state is unchanged, still `CONVERGE`. */
      readonly kind: 'converge-refused';
      readonly error: ForgeError;
    }
  | {
      /** CONVERGE's gate passed; the session may enter DECIDE. */
      readonly kind: 'ready-to-decide';
    }
  | {
      /** DECIDE recorded its ruling; the session may enter RECORD (`assembleSessionRecord`). */
      readonly kind: 'ready-to-record';
    };
