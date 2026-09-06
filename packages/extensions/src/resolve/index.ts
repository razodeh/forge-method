/**
 * `@forge/extensions/resolve` — the five-layer resolver, per `15` §15.2.
 *
 * @see specs/15 §15.2
 * @see PLAN-M2.md P2
 */
export { Resolver, explainField, type ResolveOptions } from './resolve.ts';
export {
  LAYER_ORDER,
  type FieldPath,
  type Layer,
  type LayerContribution,
  type ResolveWarning,
  type ResolvedEntity,
} from './types.ts';
