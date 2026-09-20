/**
 * `@forge/engine/interaction` — `05` §5.7's seven interaction modes made runnable.
 *
 * @see specs/05 §5.7
 * @see SPEC-QUESTIONS.md Q104
 * @see PLAN-M6.md A6
 */
export { dispatchAgentStep } from './dispatch-agent-step.ts';
export { resumeSwarmReviewStep, runSwarmReviewStep } from './swarm-review-step.ts';
export {
  buildReviewReport,
  perspectiveVerdict,
  sanitizeInline,
  type ReviewVerdict,
} from './review-report.ts';
export type {
  DispatchAgentStepOptions,
  InteractionOutcome,
  InteractionParticipant,
  PerspectiveReview,
  ReviewFinding,
  ReviewReport,
  ReviewSeverity,
} from './types.ts';
export {
  runSessionStep,
  loadSessionState,
  SESSIONS_DIR,
  type HumanSessionInput,
  type SessionStepResult,
} from './session.ts';
