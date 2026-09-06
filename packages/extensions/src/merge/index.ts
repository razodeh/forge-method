/**
 * `@forge/extensions/merge` — the overlay merge engine, per `15` §15.2.
 *
 * @see specs/15 §15.2
 * @see PLAN-M2.md P1
 */
export { applyOverlay } from './apply.ts';
export { overlayArrayField, overlayArrayOperatorSchema } from './schema.ts';
export { APPEND_GUIDANCE_KEY, ARRAY_OPERATOR_ORDER, type ArrayOperator } from './types.ts';
