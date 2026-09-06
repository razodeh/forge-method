/**
 * `@forge/diagrams/drift` — `08` §8.11.4 (transclusion) and §8.11.6 (drift).
 *
 * @see PLAN-M3.md P4
 */
export { applyAutofix } from './autofix.ts';
export { checkDrift } from './drift.ts';
export { checkTransclusion, parseTransclusionMarkers } from './transclusion.ts';
export {
  type DiagramToValidate,
  type DriftResult,
  type TransclusionBlock,
  type ValidateDiagramsOptions,
} from './types.ts';
export { validateDiagrams, type ValidateDiagramsResult } from './validate.ts';
