/**
 * `SessionPhaseMachine` — `16` §16.3's own FRAME → DIVERGE → CONVERGE → DECIDE → RECORD anatomy, as a
 * pure state machine.
 *
 * Every method takes the current `SessionState` and phase-appropriate input, and returns the next
 * state plus a `PhaseDirective` describing what the *caller* needs to do next. Nothing here ever
 * calls an adapter or dispatches an agent turn: a batch of ideas, a clustering, a critic's objection,
 * a ruling -- every one of these is caller-supplied data, per this plan's own recorded Surface
 * deviation (`PLAN-M10.md`'s header: "`@forge/sessions` holds pure facilitation logic only... and
 * takes agent-turn results as caller-supplied data, never calling `ctx.adapter` itself"). Driving
 * real agent turns from a `PhaseDirective` is `PLAN-M10.md` P10's job, in `@forge/engine`, which can
 * reach both this package and `dispatchAgentStep`.
 *
 * @see specs/16 §16.3
 * @see specs/16 §16.7
 * @see specs/16 §16.8
 * @see PLAN-M10.md P9
 */
import type { Clock } from '@forge/core';
import { ForgeError } from '@forge/core';

import {
  CRITIC_ROLE,
  type PhaseDirective,
  type SessionAction,
  type SessionCluster,
  type SessionDecision,
  type SessionNonDecision,
  type SessionObjection,
  type SessionParticipant,
  type SessionPhase,
  type SessionState,
  type SessionType,
} from './types.ts';

/** `16` §16.8's own literal bound: "Idea cap in DIVERGE: 30 before forced clustering." */
export const DIVERGE_IDEA_CAP = 30;

/** `16` §16.8's own literal bound: "Max participants: 5 agents + human." */
export const MAX_AGENT_PARTICIPANTS = 5;

const HUMAN_ROLE = 'human';

/** Case/whitespace-insensitive: a gauntlet critic round found a first version compared `role ===
 * CRITIC_ROLE` verbatim, so a participant recorded as `"Critic"` (or with stray whitespace) was
 * silently treated as an ordinary participant everywhere this matters -- not muted in DIVERGE
 * (`16` §16.3 step 2) and not counted towards CONVERGE's own critic-objection gate (`16` §16.7 point
 * 2), a real, structural bypass of both anti-groupthink measures for the cost of a typo. */
function isCriticRole(role: string): boolean {
  return role.trim().toLowerCase() === CRITIC_ROLE;
}

/** Same case/whitespace-insensitivity, for the identical reason, applied to `16` §16.8's own "5
 * agents + human" bound: a miscased `"Human"` role must not silently count against the agent cap. */
function isHumanRole(role: string): boolean {
  return role.trim().toLowerCase() === HUMAN_ROLE;
}

function assertPhase(state: SessionState, expected: SessionPhase): void {
  if (state.phase !== expected) {
    throw new ForgeError('RUN-063', { expected, actual: state.phase });
  }
}

function withPhase(state: SessionState, phase: SessionPhase): SessionState {
  return { ...state, phase };
}

function addTechnique(
  technique: readonly string[],
  techniqueId: string | undefined,
): readonly string[] {
  if (techniqueId === undefined || technique.includes(techniqueId)) return technique;
  return [...technique, techniqueId];
}

function nextId(prefix: string, existingCount: number): string {
  return `${prefix}-${String(existingCount + 1).padStart(3, '0')}`;
}

/**
 * `16` §16.3 step 1's own literal refusal rule -- a cheap, mechanical proxy for "statable in one
 * sentence" (this piece has no NLP): reject an empty question, or one containing a sentence-ending
 * terminator (`.`, `?`, `!`) anywhere but its own very end. The identical "a mechanical proxy, not a
 * judgement" shape `packages/core/test/errors.test.ts`'s own `IMPERATIVE_VERBS` regex already uses.
 */
export function isStatableInOneSentence(question: string): boolean {
  const trimmed = question.trim();
  if (trimmed.length === 0) return false;
  const withoutOwnTerminator = trimmed.replace(/[.?!]+$/, '');
  return !/[.?!]/.test(withoutOwnTerminator);
}

/**
 * `16` §16.7 point 2's own named, unacceptable non-objection ("'this seems fine' is not an acceptable
 * contribution"), as a mechanical, deterministic proxy -- the identical "a cheap mechanical proxy, not
 * a judgement" shape `isStatableInOneSentence` above already uses. Matches an empty response and a
 * small, closed set of the real generic-agreement shapes an agent's own CONVERGE turn plausibly
 * produces ("this seems fine", "looks good", "no objections", "LGTM", "nothing to add") -- not a
 * general sentiment classifier, and not claimed to be one: a real, specific objection that happens to
 * also contain the word "fine" elsewhere in a longer sentence does not match any of these anchored
 * patterns. The caller (`@forge/engine/interaction/session.ts`) uses this to decide whether `critic`'s
 * own CONVERGE turn needs a single re-prompt before its text is accepted as a real objection.
 *
 * Also matches a bare `debate`-mode "CONCEDE" (`dispatchDebate`, `@forge/engine/interaction/dispatch-
 * agent-step.ts`'s own literal concession token): a fresh critic round found an earlier caller-side
 * draft treated a debate concession as a real, substantive objection outright (since "CONCEDE" alone
 * matched none of this function's own patterns) -- a concession is definitionally the *absence* of a
 * real objection, the identical case this function exists to catch, whichever dispatch shape (`panel`
 * or `debate`) produced the text.
 */
export function isGenericNonObjection(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  const GENERIC_NON_OBJECTION_PATTERNS: readonly RegExp[] = [
    /^this\s+(all\s+)?(seems|looks|sounds)\s+(fine|good|ok|okay|reasonable)\.?$/i,
    /^(seems|looks|sounds)\s+(fine|good|ok|okay|reasonable)(\s+to\s+me)?\.?$/i,
    /^no\s+(real\s+)?(objections?|concerns?|issues?)(\s+(here|from\s+me))?\.?$/i,
    /^(lgtm|looks good to me)\.?$/i,
    /^(i\s+)?(have\s+)?nothing\s+(to\s+add|further|else)\.?$/i,
    /^(i\s+)?(agree|approve)\.?$/i,
    /^concede[ds]?\.?$/i,
  ];
  return GENERIC_NON_OBJECTION_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * `16` §16.7 point 4's own real, counted signal: whether a participant's own CONVERGE-phase turn
 * actually expressed disagreement with another participant's proposal, as a mechanical, deterministic
 * proxy over its own text -- the same disclosed-heuristic shape `isGenericNonObjection` above already
 * uses, applied to the opposite question. `critic`'s own structural CONVERGE objection already always
 * counts (`advanceToDecide`'s own gate requires one whenever `critic` participates), but most session
 * types (`16` §16.2's own table: `brainstorm`, `retro`, `war-room`, `estimation`, `standup`,
 * `discovery-interview`, `story-refinement`) carry no `critic` participant at all -- without this,
 * every one of those session types would always report "no disagreement observed" regardless of
 * whether a real, substantive disagreement actually occurred between two non-critic participants, the
 * exact false-flag `16` §16.7 point 4's own "so the user can see when a session was theatre" purpose
 * would otherwise produce for the majority of real session types. The caller records a match as a real
 * `SessionObjection` (attributed to the participant who said it), the same structural fact
 * `no_disagreement_observed` is computed from (`assembleSessionRecord`) -- not a second, parallel
 * signal, so the two can never disagree with each other about whether disagreement occurred.
 *
 * `NEGATED_AGREEMENT_PATTERNS` is checked first, and short-circuits to `false`: a fresh critic round
 * found the marker list below has no negation awareness at all, so routine agreement phrasing that
 * happens to *use* one of its own marker words ("no concerns", "low risk", "nothing against it") was
 * misclassified as real disagreement -- exactly backwards for a signal whose whole purpose is
 * distinguishing genuine disagreement from agreement. Still a mechanical proxy, not a full negation
 * parser: it only catches the specific negated shapes a real CONVERGE turn plausibly uses.
 */
export function expressesDisagreement(text: string): boolean {
  const NEGATED_AGREEMENT_PATTERNS: readonly RegExp[] = [
    /\bno\s+(real\s+)?(concerns?|objections?|issues?)\b/i,
    /\b(low|no|little|zero|minimal)\s+risks?\b/i,
    /\bnothing\s+against\b/i,
    /\bnot\s+against\b/i,
  ];
  if (NEGATED_AGREEMENT_PATTERNS.some((pattern) => pattern.test(text))) return false;
  const DISAGREEMENT_MARKERS: readonly RegExp[] = [
    /\bdisagree/i,
    /\bobjection\b/i,
    /\bhowever\b/i,
    /\binstead\b/i,
    /\bshould not\b/i,
    /\bshouldn't\b/i,
    /\brisk(?:y|s)?\b/i,
    /\bconcern(?:ed|s)?\b/i,
    /\bagainst\b/i,
    /\b(is|that's|that is)\s+wrong\b/i,
    /\bi\s+don'?t\s+think\b/i,
    /\bcounter[- ]?argument\b/i,
    /\bpush\s?back\b/i,
  ];
  return DISAGREEMENT_MARKERS.some((pattern) => pattern.test(text));
}

export interface SessionPhaseMachineDeps {
  readonly clock: Clock;
  /** `16` §16.8's own "all configurable" line applied to `MAX_AGENT_PARTICIPANTS` -- defaults to that
   * exact constant when omitted, so every caller that predates this option (every one before
   * `PLAN-M10.md` P12) keeps its exact prior behaviour unchanged. See `SPEC-QUESTIONS.md`. */
  readonly maxAgentParticipants?: number;
  /** The identical "configurable, defaults to the real constant" treatment for `DIVERGE_IDEA_CAP`. */
  readonly divergeIdeaCap?: number;
}

export interface StartInput {
  readonly sessionType: SessionType;
  readonly participants: readonly SessionParticipant[];
}

export interface FrameInput {
  readonly question: string;
  readonly constraintsApplied?: readonly string[];
  readonly outOfScope?: readonly string[];
  readonly goodOutcomeLooksLike: string;
}

export interface DivergeInput {
  readonly techniqueId?: string;
  readonly ideas: readonly { readonly text: string; readonly proposedBy: string }[];
}

export interface ConvergeInput {
  readonly techniqueId?: string;
  readonly clusters?: readonly Omit<SessionCluster, 'id'>[];
  readonly objections?: readonly SessionObjection[];
}

export interface DecideInput {
  readonly decisions?: readonly Omit<SessionDecision, 'id'>[];
  readonly nonDecisions?: readonly SessionNonDecision[];
  readonly actions?: readonly Omit<SessionAction, 'id'>[];
  /** `16` §16.5's own honest-failure path: set when this session reaches DECIDE with nothing to
   * rule on. Ignored (never cleared) if real decisions or actions are also given -- see
   * `canComplete`'s own doc comment for which state this actually gates. */
  readonly inconclusiveReason?: string;
  /** `16` §16.7 point 5's own "the human's position... enters at CONVERGE, where it outranks" --
   * a real precedence rule, not merely a documented intention: when set, `decide()` records *only*
   * this decision, discarding every agent-authored entry in `decisions` above from this same call
   * outright, rather than merely placing the human's decision first alongside them. A caller with
   * both a real agent-resolved decision and a real human position for the identical framed question
   * must never end up with both recorded as if they were equally authoritative -- that is precisely
   * the "converge on the human's stated position instead of outranking it" failure `16` §16.7 point 5
   * exists to prevent, one level later (at the point a decision is actually made, not merely
   * proposed). See `SPEC-QUESTIONS.md` for the disclosed timing deviation from the spec's own literal
   * "enters at CONVERGE" wording -- this piece implements the precedence rule where a decision is
   * actually recorded (DECIDE), since CONVERGE itself never resolves an authoritative decision. */
  readonly humanDecision?:
    | {
        readonly decision: string;
        readonly owner: string;
        readonly artifactRef?: string | undefined;
      }
    | undefined;
}

export interface PhaseResult {
  readonly state: SessionState;
  readonly directive: PhaseDirective;
}

export class SessionPhaseMachine {
  private readonly clock: Clock;
  private readonly maxAgentParticipants: number;
  private readonly divergeIdeaCap: number;

  constructor(deps: SessionPhaseMachineDeps) {
    this.clock = deps.clock;
    this.maxAgentParticipants = deps.maxAgentParticipants ?? MAX_AGENT_PARTICIPANTS;
    this.divergeIdeaCap = deps.divergeIdeaCap ?? DIVERGE_IDEA_CAP;
  }

  /**
   * The initial state, at `FRAME`, before any question has been accepted.
   *
   * @throws {ForgeError} `RUN-067` if more than this machine's own configured
   * `maxAgentParticipants` (default `MAX_AGENT_PARTICIPANTS`) non-human participants are given --
   * `16` §16.8's own "Max participants: 5 agents + human" bound.
   */
  start(input: StartInput): SessionState {
    const agentCount = input.participants.filter(
      (participant) => !isHumanRole(participant.role),
    ).length;
    if (agentCount > this.maxAgentParticipants) {
      throw new ForgeError('RUN-067', { agentCount });
    }

    return {
      phase: 'FRAME',
      sessionType: input.sessionType,
      participants: input.participants,
      technique: [],
      ideas: [],
      clusters: [],
      objections: [],
      decisions: [],
      nonDecisions: [],
      actions: [],
      truncated: false,
    };
  }

  /**
   * FRAME — `16` §16.3 step 1. Refuses (returns `{ kind: 'refused' }`, state unchanged) rather than
   * throwing: an unstatable question is real, expected caller input, not a programmer error.
   */
  frame(state: SessionState, input: FrameInput): PhaseResult {
    assertPhase(state, 'FRAME');

    if (!isStatableInOneSentence(input.question)) {
      return {
        state,
        directive: {
          kind: 'refused',
          error: new ForgeError('RUN-061', { question: input.question }),
        },
      };
    }

    const framed: SessionState = {
      ...state,
      phase: 'DIVERGE',
      framing: {
        question: input.question.trim(),
        constraintsApplied: input.constraintsApplied ?? [],
        outOfScope: input.outOfScope ?? [],
        goodOutcomeLooksLike: input.goodOutcomeLooksLike,
      },
      startedAt: this.clock.now(),
    };

    return {
      state: framed,
      // `16` §16.3 step 2: "criticism suspended, the critic role is muted." The critic participant
      // is simply absent from this directive's own dispatch list, not dispatched-then-ignored.
      directive: {
        kind: 'dispatch-diverge',
        participants: framed.participants
          .map((participant) => participant.role)
          .filter((role) => !isCriticRole(role)),
      },
    };
  }

  /**
   * DIVERGE — `16` §16.3 step 2. Accepts one batch of ideas and appends them, keeping every one:
   * `16` §16.8's own idea cap is enforced by forcing an early transition to CONVERGE once the
   * cumulative total reaches it, never by dropping anything already offered.
   */
  diverge(state: SessionState, input: DivergeInput): PhaseResult {
    assertPhase(state, 'DIVERGE');

    const newIdeas = input.ideas.map((idea, index) => ({
      id: nextId('IDEA', state.ideas.length + index),
      text: idea.text,
      proposedBy: idea.proposedBy,
    }));
    const ideas = [...state.ideas, ...newIdeas];
    const technique = addTechnique(state.technique, input.techniqueId);

    if (ideas.length >= this.divergeIdeaCap) {
      const capped: SessionState = {
        ...state,
        phase: 'CONVERGE',
        ideas,
        technique,
        truncated: true,
      };
      return {
        state: capped,
        directive: { kind: 'diverge-capped', ideaCount: ideas.length },
      };
    }

    return {
      state: { ...state, ideas, technique },
      directive: { kind: 'continue-diverge', ideaCount: ideas.length },
    };
  }

  /**
   * Ends DIVERGE by the caller's own choice (`16` §16.8's own "max rounds per phase: DIVERGE 3" --
   * counted by the caller, not this state), rather than by the idea cap. `16` §16.3 step 3: "critic
   * is unmuted" -- every participant, critic included, is in this directive's own dispatch list.
   */
  endDiverge(state: SessionState): PhaseResult {
    assertPhase(state, 'DIVERGE');
    const converging = withPhase(state, 'CONVERGE');
    return {
      state: converging,
      directive: {
        kind: 'dispatch-converge',
        participants: converging.participants.map((participant) => participant.role),
      },
    };
  }

  /** CONVERGE — `16` §16.3 step 3. Accumulates clusters and objections across one round; may be
   * called more than once (`16` §16.8's own "CONVERGE 2" round bound, again caller-counted). */
  converge(state: SessionState, input: ConvergeInput): PhaseResult {
    assertPhase(state, 'CONVERGE');

    const newClusters = (input.clusters ?? []).map((cluster, index) => ({
      ...cluster,
      id: nextId('CLUSTER', state.clusters.length + index),
    }));

    const converged: SessionState = {
      ...state,
      clusters: [...state.clusters, ...newClusters],
      objections: [...state.objections, ...(input.objections ?? [])],
      technique: addTechnique(state.technique, input.techniqueId),
    };

    return {
      state: converged,
      directive: { kind: 'continue-converge', clusterCount: converged.clusters.length },
    };
  }

  /**
   * Attempts to leave CONVERGE for DECIDE. `16` §16.7 point 2's own structural gate: when a `critic`
   * participant is present, at least one objection attributed to that role must already be recorded
   * -- a purely structural check ("was an objection recorded at all"), never a judgement of whether
   * that objection is any good (`16` §16.7 point 2's own "not acceptable" language governs a later
   * piece's own facilitator content logic, not this state machine).
   */
  advanceToDecide(state: SessionState): PhaseResult {
    assertPhase(state, 'CONVERGE');

    const hasCritic = state.participants.some((participant) => isCriticRole(participant.role));
    const hasCriticObjection = state.objections.some((objection) => isCriticRole(objection.by));

    if (hasCritic && !hasCriticObjection) {
      return {
        state,
        directive: {
          kind: 'converge-refused',
          error: new ForgeError('RUN-062', { sessionType: state.sessionType }),
        },
      };
    }

    return { state: withPhase(state, 'DECIDE'), directive: { kind: 'ready-to-decide' } };
  }

  /**
   * `16` §16.8's own breach behaviour: forces DIVERGE or CONVERGE straight to DECIDE when a bound
   * this pure machine has no knowledge of (max rounds, wall clock, cost -- every one of them
   * "caller-counted," per this file's own `diverge()`/`converge()` doc comments, since `@forge/engine`
   * is the one side of the boundary real enough to own a clock and a cost meter) has fired.
   *
   * Deliberately bypasses `advanceToDecide`'s own structural critic-objection gate: `16` §16.8's own
   * literal "the facilitator forces convergence with what it has" instruction is written to override
   * exactly that kind of in-session structure once a hard resource bound has fired -- a bounded,
   * honest, `truncated` result outranks a theoretically-cleaner but unbounded conversation. Only ever
   * called by a caller reacting to its own bound breach; an ordinary CONVERGE -> DECIDE transition
   * must still go through `advanceToDecide`'s real gate, never this shortcut.
   *
   * @throws {ForgeError} `RUN-063` if `state` is in neither `DIVERGE` nor `CONVERGE` -- both phases
   * this breach behaviour can legitimately fire from, per `16` §16.8's own round-cap table.
   */
  forceToDecide(state: SessionState): SessionState {
    if (state.phase !== 'DIVERGE' && state.phase !== 'CONVERGE') {
      throw new ForgeError('RUN-063', { expected: 'DIVERGE or CONVERGE', actual: state.phase });
    }
    return { ...withPhase(state, 'DECIDE'), truncated: true };
  }

  /**
   * DECIDE — `16` §16.3 step 4. Records the ruling (decisions, explicit non-decisions, and any
   * follow-up actions) and moves unconditionally to RECORD -- even an inconclusive session (zero
   * decisions, zero actions) still gets a real record (`16` §16.5's own "recorded as inconclusive",
   * not "skipped"). `canComplete` is the gate that decides whether that record may say `complete`.
   */
  decide(state: SessionState, input: DecideInput): PhaseResult {
    assertPhase(state, 'DECIDE');

    // `16` §16.7 point 5's own "outranks" rule, implemented as a full override -- see
    // `DecideInput.humanDecision`'s own doc comment for why this is not mere prioritization.
    const effectiveDecisions: readonly Omit<SessionDecision, 'id'>[] =
      input.humanDecision === undefined ? (input.decisions ?? []) : [input.humanDecision];

    const newDecisions = effectiveDecisions.map((decision, index) => ({
      ...decision,
      id: nextId('D', state.decisions.length + index),
    }));
    const newActions = (input.actions ?? []).map((action, index) => ({
      ...action,
      id: nextId('A', state.actions.length + index),
    }));

    const decided: SessionState = {
      ...state,
      phase: 'RECORD',
      decisions: [...state.decisions, ...newDecisions],
      nonDecisions: [...state.nonDecisions, ...(input.nonDecisions ?? [])],
      actions: [...state.actions, ...newActions],
      inconclusiveReason: input.inconclusiveReason ?? state.inconclusiveReason,
    };

    return { state: decided, directive: { kind: 'ready-to-record' } };
  }
}
