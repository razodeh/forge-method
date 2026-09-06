/**
 * Types for `@forge/extensions/resolve` — `15` §15.2's five-layer resolution model.
 *
 * @see specs/15 §15.2
 * @see PLAN-M2.md P2
 */

/** L0 (built-in) through L4 (personal), in deepest-wins order. */
export const LAYER_ORDER = ['L0', 'L1', 'L2', 'L3', 'L4'] as const;

export type Layer = (typeof LAYER_ORDER)[number];

/** A path into a resolved document's own nested structure, e.g. `['tools', 'exec']`. */
export type FieldPath = readonly (string | number)[];

/**
 * One layer's raw contribution to one entity, before `$extends`/`$description` are read and
 * stripped, and before `applyOverlay` (`@forge/extensions/merge`) has touched it.
 */
export interface LayerContribution {
  readonly layer: Layer;
  /** A human-readable origin (a file path, or a module id) for diagnostics — never merged itself. */
  readonly source: string;
  readonly document: unknown;
}

/** Two same-layer contributions touched the same field with different results — never silent. */
export interface ResolveWarning {
  readonly layer: Layer;
  readonly path: string;
  readonly sources: readonly [string, string];
}

export interface ResolvedEntity {
  readonly value: unknown;
  /** Every field `resolve` actually touched, keyed by its joined path, to the layer that set it. */
  readonly provenance: ReadonlyMap<string, Layer>;
  readonly warnings: readonly ResolveWarning[];
}
