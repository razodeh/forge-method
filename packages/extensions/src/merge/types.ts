/**
 * Types for `@forge/extensions/merge` — `15` §15.2's "Merge semantics" subsection.
 *
 * @see specs/15 §15.2
 * @see PLAN-M2.md P1
 */

/** The six array operators, in the fixed order `15` §15.2 applies them. */
export const ARRAY_OPERATOR_ORDER = [
  '$set',
  '$append',
  '$prepend',
  '$remove',
  '$replaceWhere',
  '$clear',
] as const;

export type ArrayOperator = (typeof ARRAY_OPERATOR_ORDER)[number];

/** The one non-array-operator special key a plain object may carry: `15` §15.2's own emphasis. */
export const APPEND_GUIDANCE_KEY = '$append_guidance';
