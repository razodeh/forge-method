/**
 * `Resolver` — `15` §15.2's five-layer resolution: L0 through L4, deepest wins, with per-field
 * provenance and same-layer conflict warnings.
 *
 * @see specs/15 §15.2
 * @see PLAN-M2.md P2
 */
import { ForgeError } from '@forge/core';

import { applyOverlay } from '../merge/apply.ts';
import { APPEND_GUIDANCE_KEY } from '../merge/types.ts';
import {
  LAYER_ORDER,
  type FieldPath,
  type Layer,
  type LayerContribution,
  type ResolveWarning,
  type ResolvedEntity,
} from './types.ts';

const EXTENDS_KEY = '$extends';
const DESCRIPTION_KEY = '$description';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface SplitDocument {
  readonly extends: string | undefined;
  readonly rest: Record<string, unknown>;
}

/**
 * Reads `$extends` (validating it is a string when present) and drops `$description`, both
 * per-document directives `15` §15.2 names — neither is a field `applyOverlay` should ever see.
 */
function splitDocument(document: unknown, source: string): SplitDocument {
  if (!isPlainObject(document)) {
    throw new ForgeError('CFG-011', {
      path: source,
      detail: 'an overlay document must be a plain object',
    });
  }
  const rest: Record<string, unknown> = {};
  let extendsValue: string | undefined;
  for (const [key, value] of Object.entries(document)) {
    if (key === EXTENDS_KEY) {
      if (typeof value !== 'string') {
        throw new ForgeError('CFG-011', {
          path: `${source}.${key}`,
          detail: '$extends needs a string',
        });
      }
      extendsValue = value;
      continue;
    }
    if (key === DESCRIPTION_KEY) continue;
    rest[key] = value;
  }
  return { extends: extendsValue, rest };
}

/**
 * Refuses a `$replaceWhere` entry whose `id` does not resolve against `base` — `15` §15.2's own
 * worked example ("compile emits `CFG-04x overlay target not found`"), checked as each contribution
 * is applied rather than only across a version upgrade: a project overlay naming a step or option id
 * that never existed in the layers beneath it is the same defect either way.
 *
 * `$set`/`$append`/`$prepend`/`$remove` in the *same* directive can legitimately introduce or remove
 * an id `$replaceWhere` then targets — `applyOverlay`'s fixed operator order (`merge/types.ts`'s
 * `ARRAY_OPERATOR_ORDER`) always runs them before `$replaceWhere`, so `{ $append: [{id:'new'}],
 * $replaceWhere: [{id:'new', ...}] }` is valid, not a stale target. This walks the same directive in
 * that same order to know which ids `$replaceWhere` will actually see, rather than checking only
 * against `base` as it stood before this directive ran at all.
 */
function checkReplaceWhereTargets(base: unknown, overlay: unknown, path: string): void {
  if (!isPlainObject(overlay)) return;
  const replaceWhere = overlay['$replaceWhere'];
  if (Array.isArray(replaceWhere)) {
    const baseArray = Array.isArray(base) ? base : [];
    const knownIds = new Set(baseArray.filter(isPlainObject).map((item) => item['id']));

    const setValue = overlay['$set'];
    if (Array.isArray(setValue)) {
      knownIds.clear();
      for (const item of setValue) {
        if (isPlainObject(item) && 'id' in item) knownIds.add(item['id']);
      }
    }
    for (const opKey of ['$append', '$prepend'] as const) {
      const opValue = overlay[opKey];
      if (!Array.isArray(opValue)) continue;
      for (const item of opValue) {
        if (isPlainObject(item) && 'id' in item) knownIds.add(item['id']);
      }
    }
    const removeValue = overlay['$remove'];
    if (Array.isArray(removeValue)) {
      for (const target of removeValue) knownIds.delete(target);
    }

    for (const patch of replaceWhere) {
      if (isPlainObject(patch) && 'id' in patch && !knownIds.has(patch['id'])) {
        throw new ForgeError('CFG-012', { path, id: String(patch['id']) });
      }
    }
    return;
  }
  for (const [key, value] of Object.entries(overlay)) {
    if (key.startsWith('$')) continue;
    checkReplaceWhereTargets(isPlainObject(base) ? base[key] : undefined, value, `${path}.${key}`);
  }
}

interface FieldChange {
  readonly path: string;
  readonly value: unknown;
}

/**
 * Every leaf path where `after` differs from `before`, by reference first — `applyOverlay`'s own
 * shallow-copy discipline means an untouched subtree keeps its exact object identity, so
 * `before === after` at any depth proves nothing under it changed without needing to walk it.
 */
function collectChanges(
  before: unknown,
  after: unknown,
  path: FieldPath,
  out: FieldChange[],
): void {
  if (before === after) return;
  if (isPlainObject(after)) {
    // Treat a non-object `before` (including the very first contribution, where `before` is
    // `undefined`) as `{}` rather than stopping here: every field of a brand-new object still needs
    // its own provenance entry, not one entry for the whole object.
    const beforeObject = isPlainObject(before) ? before : {};
    const keys = new Set([...Object.keys(beforeObject), ...Object.keys(after)]);
    for (const key of keys) {
      collectChanges(beforeObject[key], after[key], [...path, key], out);
    }
    return;
  }
  // An array (or a scalar, or an object replaced by a non-object) is one field for provenance
  // purposes — arrays are merged wholesale by `applyOverlay`'s operators, never per-index.
  out.push({ path: path.join('.'), value: after });
}

/**
 * `JSON.stringify` with every plain object's keys sorted first, so two structurally-identical values
 * that merely have their keys in a different order (two module authors writing the same overlay
 * content independently) don't produce different strings — `JSON.stringify` alone is key-order
 * sensitive, which would otherwise make `sameValue` below report a same-layer conflict that isn't one.
 */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, val: unknown) => {
    if (isPlainObject(val)) {
      // No equal-keys case to handle: `Object.entries` can never produce two entries with the same
      // key, since an object cannot have a duplicate key in the first place.
      return Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : 1)));
    }
    return val;
  });
}

/** Structural equality for two touched-field snapshots — both are plain JSON-compatible data. */
function sameValue(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/**
 * Whether `value` represents "nothing real has been built for this entity yet" — `undefined`
 * (no contribution has run at all), or a plain object with no fields of its own. The latter matters
 * because a no-op contribution (only `$description`, say) still produces a real, defined `{}` via
 * the seed path below; testing `value === undefined` alone would treat that stub as "real content"
 * and wrongly defeat a genuine `$extends` on the very next contribution.
 */
function isEstablished(value: unknown): boolean {
  if (value === undefined) return false;
  return !isPlainObject(value) || Object.keys(value).length > 0;
}

/**
 * Removes every provenance entry nested under `path` (but not `path` itself).
 *
 * `collectChanges` records one leaf entry for a whole subtree that stopped being a plain object —
 * most notably an RFC-7386 `null` deletion, but also any field a later layer replaces with a scalar
 * or array — without visiting what used to be under it. Left alone, a field deleted at L3 would keep
 * reporting `explainField` results from L0 for children that no longer exist anywhere in `value`.
 */
function pruneDescendants(provenance: Map<string, Layer>, path: string): void {
  const prefix = `${path}.`;
  for (const key of provenance.keys()) {
    if (key.startsWith(prefix)) provenance.delete(key);
  }
}

/**
 * Every field `rest` (a contribution's document, `$extends`/`$description` already stripped)
 * explicitly declares, recursively — an *overlay-declared* field is provenance-attributable to its
 * layer even when the value it produces happens to equal what an earlier layer already had, since
 * `collectChanges`' reference-equality diff cannot see that a primitive was re-declared rather than
 * left untouched (`'fast' === 'fast'` regardless of which layer wrote it). An array-operator
 * directive (`{ $append: [...] }`) attributes its whole field, matching `collectChanges`' "arrays are
 * one field" convention; `$append_guidance` is not itself a declared field, since its effect on its
 * sibling fields is exactly what `collectChanges`' value-diff already attributes correctly.
 */
function collectDeclaredPaths(
  rest: Record<string, unknown>,
  path: FieldPath,
  out: Set<string>,
): void {
  for (const [key, value] of Object.entries(rest)) {
    if (key === APPEND_GUIDANCE_KEY) continue;
    const childPath = [...path, key];
    if (isPlainObject(value)) {
      const isOperatorDirective = Object.keys(value).some(
        (childKey) => childKey.startsWith('$') && childKey !== APPEND_GUIDANCE_KEY,
      );
      if (isOperatorDirective) {
        out.add(childPath.join('.'));
      } else {
        collectDeclaredPaths(value, childPath, out);
      }
    } else {
      out.add(childPath.join('.'));
    }
  }
}

/**
 * The value at a dotted `path` within `value`. `path` is always one `collectDeclaredPaths` just
 * produced from the very `rest` object `value` was built from (directly, or by merging onto `base`),
 * so every segment is guaranteed to resolve through a plain object — there is no "path half exists"
 * case here to defend against, unlike `checkReplaceWhereTargets`'s walk of untrusted overlay shapes.
 */
function getAtPath(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const segment of path) {
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

const SET_KEY = '$set';

/**
 * Wraps every bare array in `value` as `{ $set: [...] }`, recursively — but never descends into an
 * object that already carries an array-operator key (or `$append_guidance`), since its own array
 * values are operator arguments, not further overlay content to rewrite.
 *
 * Exists only for the very first contribution to an entity (`resolve`'s "seed" case below): nothing
 * before it exists for a bare array to silently replace, so `applyOverlay`'s "arrays require an
 * operator" rule has nothing to protect there — but the seed document still has to go *through*
 * `applyOverlay` for any operator it *does* use (a redundant `$append`, say) to actually run, rather
 * than being taken as the literal, unexecuted directive object.
 */
function wrapBareArraysForSeed(value: unknown): unknown {
  if (Array.isArray(value)) {
    return { [SET_KEY]: value };
  }
  if (isPlainObject(value)) {
    const hasOperatorKey = Object.keys(value).some(
      (key) => key.startsWith('$') && key !== APPEND_GUIDANCE_KEY,
    );
    if (hasOperatorKey) return value;
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      result[key] = wrapBareArraysForSeed(child);
    }
    return result;
  }
  return value;
}

/** The value the caller supplies when a contribution's own `$extends` names a different entity. */
export interface ResolveOptions {
  readonly extendedBase?: unknown;
}

export class Resolver {
  /**
   * Resolves `id` from `contributions`, applying `applyOverlay` in `L0 → L1 → … → L4` order.
   *
   * A contribution whose own `$extends` names an id other than `id` starts from
   * `options.extendedBase` instead of the value accumulated so far — but *only* while nothing real
   * has been established yet (`isEstablished(value)` is false: no contribution has run at all, or
   * every one so far was a no-op producing an empty `{}`, e.g. a `$description`-only stub). `$extends`
   * seeds a brand-new entity from another one's resolved shape; it is not licence for some *later*
   * contribution to discard whatever earlier contributions to this same `id` already built once real
   * fields exist — a second, redundant `$extends` declaration after that point is a no-op on the base
   * selection; its own other fields still merge normally. `Resolver` never looks up another entity's
   * contributions itself; a caller with visibility across all entities (`compile`, P9) is what
   * supplies `extendedBase`.
   */
  resolve(
    id: string,
    contributions: readonly LayerContribution[],
    options: ResolveOptions = {},
  ): ResolvedEntity {
    // A `Record` over the closed `Layer` union, not a `Map`: indexing it by a value already narrowed
    // to `Layer` is definite under `noUncheckedIndexedAccess`, unlike `Map.get`, which is always
    // `V | undefined` even though every layer is populated below before this is ever read.
    const byLayer: Record<Layer, LayerContribution[]> = { L0: [], L1: [], L2: [], L3: [], L4: [] };
    for (const contribution of contributions) {
      byLayer[contribution.layer].push(contribution);
    }

    let value: unknown;
    const provenance = new Map<string, Layer>();
    const warnings: ResolveWarning[] = [];

    for (const layer of LAYER_ORDER) {
      const layerTouched = new Map<string, { source: string; value: unknown }>();

      for (const contribution of byLayer[layer]) {
        const { extends: extendsId, rest } = splitDocument(
          contribution.document,
          contribution.source,
        );
        const base =
          !isEstablished(value) &&
          extendsId !== undefined &&
          extendsId !== id &&
          options.extendedBase !== undefined
            ? options.extendedBase
            : value;

        checkReplaceWhereTargets(base, rest, contribution.source);
        // No base at all (the very first contribution, for this entity, in this whole resolve): this
        // document is the seed, not an overlay — `applyOverlay`'s "arrays require an operator" rule
        // exists to stop a later layer from *silently replacing* an existing array, which cannot
        // happen when there is nothing yet to replace. A plain `skills: [a, b, c]` in a base agent
        // definition is not asking to overlay anything. Still routed through `applyOverlay` (onto an
        // empty object, with bare arrays pre-wrapped as `$set`), not taken as the literal document: a
        // seed that happens to use a real operator (a redundant `$append`, say) must still have it
        // actually executed, not left as an inert, unexecuted directive object.
        const after =
          base === undefined
            ? applyOverlay({}, wrapBareArraysForSeed(rest))
            : applyOverlay(base, rest);

        const changes: FieldChange[] = [];
        collectChanges(base, after, [], changes);
        const touchedPaths = new Map(changes.map((change) => [change.path, change.value] as const));
        const declaredPaths = new Set<string>();
        collectDeclaredPaths(rest, [], declaredPaths);
        for (const path of declaredPaths) {
          if (!touchedPaths.has(path)) touchedPaths.set(path, getAtPath(after, path.split('.')));
        }

        for (const [path, changeValue] of touchedPaths) {
          pruneDescendants(provenance, path);
          // `changeValue === undefined` means this path was deleted (an RFC-7386 `null` overlay) —
          // `value` no longer has anything there either, so it gets no provenance entry at all,
          // consistent with a field no layer ever touched.
          if (changeValue === undefined) {
            provenance.delete(path);
          } else {
            provenance.set(path, layer);
          }
          const prior = layerTouched.get(path);
          if (prior !== undefined && !sameValue(prior.value, changeValue)) {
            warnings.push({ layer, path, sources: [prior.source, contribution.source] });
          }
          layerTouched.set(path, { source: contribution.source, value: changeValue });
        }

        value = after;
      }
    }

    return { value, provenance, warnings };
  }
}

/** The layer `path` (a joined field path, e.g. `"tools.exec"`) was last set at, if any. */
export function explainField(entity: ResolvedEntity, path: FieldPath): Layer | undefined {
  return entity.provenance.get(path.join('.'));
}
