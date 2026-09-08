/**
 * `@forge/engine/failures` — `06` §6.8's own failure classification table, the never-retry rule, and
 * backoff-with-jitter, applied to a real `StepOutcome` (`@forge/engine/dispatch`, P15).
 *
 * @see specs/06 §6.8
 * @see specs/21 §21.1, §21.3
 * @see PLAN-M5.md P16
 */
export { classifyFailure, normaliseErrorSignature } from './classify.ts';
export { computeBackoff, decideRetry } from './retry.ts';
export type { FailureClass } from './types.ts';
