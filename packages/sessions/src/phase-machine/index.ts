/**
 * `@forge/sessions/phase-machine` — `16` §16.3's own five-phase anatomy, as pure state.
 *
 * @see PLAN-M10.md P9
 */
export {
  SessionPhaseMachine,
  DIVERGE_IDEA_CAP,
  MAX_AGENT_PARTICIPANTS,
  isStatableInOneSentence,
  type ConvergeInput,
  type DecideInput,
  type DivergeInput,
  type FrameInput,
  type PhaseResult,
  type SessionPhaseMachineDeps,
  type StartInput,
} from './machine.ts';
export { canComplete } from './can-complete.ts';
export {
  CRITIC_ROLE,
  SESSION_PHASES,
  SESSION_STATUSES,
  type PhaseDirective,
  type SessionAction,
  type SessionCluster,
  type SessionDecision,
  type SessionFraming,
  type SessionIdea,
  type SessionNonDecision,
  type SessionObjection,
  type SessionParticipant,
  type SessionPhase,
  type SessionState,
  type SessionStatus,
  type SessionType,
} from './types.ts';
