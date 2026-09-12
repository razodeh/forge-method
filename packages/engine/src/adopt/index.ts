/**
 * `@forge/engine/adopt` — `17` §17.2 phases 3 (CARTOGRAPHY) and 4 (INFERENCE): the LLM-dispatch
 * orchestration for `forge adopt`, calling back into `@forge/kb/adopt`'s pure evidence/claim logic. See
 * `SPEC-QUESTIONS.md`'s P16 entry for why this orchestration lives here rather than in `@forge/kb`
 * itself.
 *
 * @see specs/17 §17.2
 * @see PLAN-M10.md P16
 */
export type { CartographyDispatchInput } from './cartography.ts';
export { runCartographyPhase } from './cartography.ts';

export type { InferenceDispatchInput } from './inference.ts';
export { runInferencePhase } from './inference.ts';

export type { VerificationPhaseInput } from './verification.ts';
export {
  DEFAULT_BUILD_TIMEOUT_MS,
  DEFAULT_TEST_TIMEOUT_MS,
  runBuildAndTestChecks,
  runVerificationPhase,
} from './verification.ts';
