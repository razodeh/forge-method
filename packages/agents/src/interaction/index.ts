/**
 * `@forge/agents/interaction` — `05` §5.7's seven interaction modes and `05` §5.2's own
 * separation-of-duties rule, runtime half.
 *
 * @see specs/05 §5.2
 * @see specs/05 §5.7
 * @see PLAN-M6.md A6
 */
export { checkSeparationOfDuties } from './check-separation-of-duties.ts';
export type { InteractionMode, SeparationOfDutiesRole, SeparationViolation } from './types.ts';
