/**
 * `@forge/kb/lint` — `08` §8.7's KB linter and `08` §8.8's staleness/verification pass.
 *
 * @see specs/08 §8.7
 * @see specs/08 §8.8
 * @see PLAN-M3.md P10
 */
export { ANTONYM_TAG_PAIRS, checkContradictions } from './contradictions.ts';
export { adrScope, owningAdrIds } from './kb-links.ts';
export { lintKb, type LintKbSpecArtifacts } from './lint.ts';
export { sortFindings, type KbFinding, type KbRuleId } from './types.ts';
export { verifyKb } from './verify.ts';
