/**
 * `applyOverlay` — `15` §15.2's merge semantics: JSON-Merge-Patch (RFC 7386) for scalars and
 * objects, six explicit operators for arrays, applied in a fixed order.
 *
 * Deliberately narrower than the whole overlay document format: `$extends` and `$description` are
 * per-document directives naming *which* base an overlay applies against, not fields to merge —
 * `@forge/extensions/resolve` (`PLAN-M2.md` P2) reads and strips them before calling this function.
 * This function only ever sees the fields an overlay actually wants merged into a base.
 *
 * @see specs/15 §15.2
 * @see PLAN-M2.md P1
 */
import { ForgeError } from '@forge/core';

import { APPEND_GUIDANCE_KEY, ARRAY_OPERATOR_ORDER, type ArrayOperator } from './types.ts';

const ARRAY_OPERATOR_SET: ReadonlySet<string> = new Set(ARRAY_OPERATOR_ORDER);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `value is readonly unknown[]`, not `value is any[]`: `Array.isArray` itself narrows to `any[]`,
 * which lets a later `...value` spread silently become an unsafe-`any` spread. This is the same
 * narrowing every other array-shaped operator value below goes through first.
 */
function isArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/** Whether `key` matches an array item by `$remove`'s two matching rules: value or `id`. */
function matchesRemoveTarget(item: unknown, targets: readonly unknown[]): boolean {
  if (isPlainObject(item) && 'id' in item) {
    return targets.includes(item['id']);
  }
  return targets.includes(item);
}

/**
 * Applies one array-operator directive (a plain object whose keys are drawn from
 * `ARRAY_OPERATOR_ORDER`) to `base`, in the fixed order `15` §15.2 gives.
 *
 * @throws {ForgeError} `CFG-011` if `directive` carries any key that is not one of the six operators.
 */
function applyArrayOperators(
  base: readonly unknown[],
  directive: Record<string, unknown>,
  path: string,
): unknown[] {
  for (const key of Object.keys(directive)) {
    if (!ARRAY_OPERATOR_SET.has(key)) {
      throw new ForgeError('CFG-011', { path, detail: `unrecognised operator ${key}` });
    }
  }

  let result = [...base];
  for (const operator of ARRAY_OPERATOR_ORDER) {
    if (!(operator in directive)) continue;
    result = applyOneOperator(result, operator, directive[operator], path);
  }
  return result;
}

function applyOneOperator(
  current: unknown[],
  operator: ArrayOperator,
  value: unknown,
  path: string,
): unknown[] {
  switch (operator) {
    case '$clear':
      return [];
    case '$set':
      if (!isArray(value)) {
        throw new ForgeError('CFG-011', { path, detail: '$set needs an array value' });
      }
      return [...value];
    case '$append':
      if (!isArray(value)) {
        throw new ForgeError('CFG-011', { path, detail: '$append needs an array value' });
      }
      return [...current, ...value];
    case '$prepend':
      if (!isArray(value)) {
        throw new ForgeError('CFG-011', { path, detail: '$prepend needs an array value' });
      }
      return [...value, ...current];
    case '$remove':
      if (!isArray(value)) {
        throw new ForgeError('CFG-011', {
          path,
          detail: '$remove needs an array of values or ids',
        });
      }
      return current.filter((item) => !matchesRemoveTarget(item, value));
    case '$replaceWhere':
      if (!isArray(value)) {
        throw new ForgeError('CFG-011', {
          path,
          detail: '$replaceWhere needs an array of objects',
        });
      }
      return applyReplaceWhere(current, value, path);
  }
}

/** `$replaceWhere`: match on `id`, merge the matched element. No match for an `id` is a no-op. */
function applyReplaceWhere(
  current: unknown[],
  patches: readonly unknown[],
  path: string,
): unknown[] {
  return current.map((item) => {
    if (!isPlainObject(item) || !('id' in item)) return item;
    const patch = patches.find(
      (candidate) => isPlainObject(candidate) && candidate['id'] === item['id'],
    );
    if (patch === undefined) return item;
    return mergeObject(item, patch as Record<string, unknown>, `${path}[id=${String(item['id'])}]`);
  });
}

/**
 * Merges `overlay`'s fields into `base`, applying `APPEND_GUIDANCE_KEY` (if present) once every
 * other field has been merged: its value is appended, with a blank-line separator, to every
 * remaining field of the merged result.
 *
 * `15` §15.2's own example scopes `$append_guidance` to a `briefs` map — brief-name → prompt body,
 * every value a string with nothing else mixed in. "Append to every sibling string field" is *not*
 * a safe generalisation of that: an object mixing prose with scalar config (`{ exec: [...], network:
 * 'allowlist' }`, `15` §15.2's own `tools` example two lines below the `briefs` one) has string
 * fields that are not prose at all, and blindly appending guidance to `network` silently corrupts an
 * enum value into free text with no error. So this requires the merged object to be *homogeneous* —
 * every field a string — before applying guidance at all; a mixed object is refused by name instead
 * of guessing which of its strings were meant to receive guidance and which were not.
 */
function mergeObject(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
  path: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  let guidance: string | undefined;

  for (const [key, value] of Object.entries(overlay)) {
    if (key === APPEND_GUIDANCE_KEY) {
      if (typeof value !== 'string') {
        throw new ForgeError('CFG-011', {
          path: `${path}.${key}`,
          detail: '$append_guidance needs a string',
        });
      }
      guidance = value;
      continue;
    }
    const childPath = `${path}.${key}`;
    if (value === null) {
      Reflect.deleteProperty(result, key);
      continue;
    }
    result[key] = mergeValue(result[key], value, childPath);
  }

  if (guidance !== undefined) {
    const nonStringField = Object.entries(result).find(([, value]) => typeof value !== 'string');
    if (nonStringField !== undefined) {
      throw new ForgeError('CFG-011', {
        path: `${path}.${APPEND_GUIDANCE_KEY}`,
        detail: `every field alongside $append_guidance must be a string, but ${nonStringField[0]} is not`,
      });
    }
    for (const [key, value] of Object.entries(result)) {
      result[key] = `${value as string}\n\n${guidance}`;
    }
  }

  return result;
}

function mergeValue(base: unknown, overlay: unknown, path: string): unknown {
  if (isPlainObject(overlay)) {
    // Any `$`-prefixed key other than `$append_guidance` marks this object as an *attempted* array
    // operator directive — not only a key already known to be one of the six. A typo'd operator
    // (`$appand`) must still route here to be refused by name, rather than falling through to a
    // plain-object merge that then trips over the typo's own array *value* with a confusing message.
    const looksLikeOperatorDirective = Object.keys(overlay).some(
      (key) => key.startsWith('$') && key !== APPEND_GUIDANCE_KEY,
    );
    if (looksLikeOperatorDirective) {
      return applyArrayOperators(Array.isArray(base) ? base : [], overlay, path);
    }
    // A plain (non-operator) object overlay onto an array base is the mirror image of a bare array
    // overlay onto anything: "arrays require an operator" cuts both ways, since silently treating the
    // base as `{}` here would discard the whole array with no error — the same silent-replacement
    // failure `15` §15.2 names as "the single most confusing behaviour in every config system ever
    // built," just approached from the base side instead of the overlay side.
    if (Array.isArray(base)) {
      throw new ForgeError('CFG-011', {
        path,
        detail: 'a plain object cannot overlay an array; use an array operator instead',
      });
    }
    return mergeObject(isPlainObject(base) ? base : {}, overlay, path);
  }
  if (Array.isArray(overlay)) {
    throw new ForgeError('CFG-011', {
      path,
      detail:
        'a bare array needs an explicit operator ($set, $append, $prepend, $remove, $replaceWhere, or $clear)',
    });
  }
  // A scalar overlay onto an array base is the same "arrays require an operator" violation as the
  // plain-object case above, from the third possible shape: `applyOverlay({ hosts: ['a'] }, { hosts:
  // 'oops' })` would otherwise silently discard the array with no error, which is exactly the
  // "single most confusing behaviour" `15` §15.2 names — regardless of which of the three overlay
  // shapes (bare array, plain object, scalar) is the one that tries to replace an array without an
  // operator.
  if (Array.isArray(base)) {
    throw new ForgeError('CFG-011', {
      path,
      detail: 'a scalar cannot overlay an array; use an array operator instead',
    });
  }
  return overlay;
}

/**
 * Applies `overlay` onto `base` per `15` §15.2. `base`/`overlay` are the plain-data form of a
 * document (already YAML/JSON-parsed) — this function never reads or writes a file.
 *
 * @throws {ForgeError} `CFG-011` for an unrecognised operator, a bare array with no operator, a
 * non-array value given to an array operator, or a non-string `$append_guidance`.
 */
export function applyOverlay(base: unknown, overlay: unknown): unknown {
  if (!isPlainObject(overlay)) return overlay === null ? base : overlay;
  return mergeObject(isPlainObject(base) ? base : {}, overlay, '$');
}
