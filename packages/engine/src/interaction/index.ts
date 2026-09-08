/**
 * `@forge/engine/interaction` — `05` §5.7's seven interaction modes made runnable.
 *
 * @see specs/05 §5.7
 * @see SPEC-QUESTIONS.md Q104
 * @see PLAN-M6.md A6
 */
export { dispatchAgentStep } from './dispatch-agent-step.ts';
export type {
  DispatchAgentStepOptions,
  InteractionOutcome,
  InteractionParticipant,
  ReviewFinding,
  ReviewReport,
} from './types.ts';
