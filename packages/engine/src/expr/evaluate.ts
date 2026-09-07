/**
 * `evaluate` — walks an `Expr` AST against a caller-supplied `ExpressionContext`, per `10` §10.1's own
 * sandbox requirement: no access to `globalThis`, `process`, module resolution, or anything not
 * explicitly present in `context` itself. There is nothing in this file that could reach any of those —
 * confirmed by a dedicated sandbox-escape test, not merely assumed from the absence of an obvious hole.
 *
 * @see specs/10 §10.1
 * @see PLAN-M5.md P9
 */
import { ForgeError } from '@forge/core/errors';

import type { Expr, ExpressionContext } from './types.ts';

/** Matches `parse.ts`'s own `MAX_EXPRESSION_DEPTH`, but is a separate constant, not an import: confirmed
 * empirically that a perfectly ordinary, non-nested-looking *flat* `&&`/`||` chain — `a && a && a && ...`
 * — parses cleanly (`parseAnd`/`parseOr` are themselves iterative, not recursive) but still builds a
 * left-deep `Expr` tree that blows the real call stack with a raw `RangeError` when this function's own
 * recursive `case 'logical'`/`case 'not'`/etc. walk it, at depths the parser's own guard never sees
 * (parsing never recurses for this shape at all). This is `evaluate`'s own guard for the one failure
 * mode `parseExpression`'s own guard structurally cannot catch, not a duplicate of it. */
const MAX_EVALUATION_DEPTH = 200;

/** A missing path segment at any depth — including the root helper name itself (`config` when the
 * caller's own context has none) — resolves to plain `undefined`, not a bespoke sentinel: `PLAN-M5.md`
 * P9's own Checks text asks for "a typed 'undefined path' outcome, not a thrown JS error," and JS's own
 * `undefined` already *is* that outcome, safely, everywhere this file uses it (every comparison,
 * `in`, and `length` below treats it deliberately, not accidentally). A distinct sentinel would only earn
 * its own complexity if a context could contain a *genuine*, deliberately-stored `undefined` value
 * distinguishable from "not present" — but every real context this piece is fed comes from parsed YAML/
 * JSON (`item`/`stage`/`run`/etc.), neither of which has any way to represent `undefined` as a stored
 * value at all (only `null`), so the ambiguity this would guard against cannot actually arise.
 *
 * `Object.hasOwn` gates every read, not a bare `current[segment]`: confirmed empirically that a plain
 * bracket access on a segment named `constructor` (or `toString`, `valueOf`, `__proto__`, ...) silently
 * returns the *inherited* `Object.prototype` value — a real JS function reference, not the workflow
 * author's own data — for context data this package treats as arbitrary, caller-supplied JSON/YAML where
 * a field genuinely named `constructor` is unusual but not implausible. Treating a non-own property the
 * same as a missing one keeps path resolution consistent regardless of whether `Object.prototype`
 * happens to also define something with that name, and keeps `evaluate`'s own sandbox guarantee honest:
 * nothing reachable through a path should ever be a *live* JS value this package did not put there
 * itself. */
function resolvePath(segments: readonly string[], context: ExpressionContext): unknown {
  let current: unknown = context;
  for (const segment of segments) {
    if (typeof current !== 'object' || current === null || !Object.hasOwn(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** A real number for a value this language considers orderable as a number — a `number` that is not
 * itself `NaN`, or a numeric-looking `string` (`"5"`, matching `compareOrdering`'s own "coerces a
 * numeric-looking string against a number" contract) — `undefined` for anything else, including
 * `null`, a `boolean`, or an object/array.
 *
 * A verify-round finding caught this module's own earlier version calling bare `Number(x)` on *any*
 * `unknown` value here, which — confirmed empirically — is NOT the "NaN for anything non-numeric"
 * fallback the code's own comment used to claim: `Number(null)`, `Number([])`, and `Number([5])` are
 * `0`, `0`, and `5` respectively, not `NaN`, so a `null` or single-element-array context value used to
 * silently read as "orderable, and equal to that number" — `a <= 0` was `true` for `a: null`, directly
 * contradicting `a == 0`'s own strict-equality `false` for the identical value one line of code away.
 * Narrowing to exactly `number`/`string` before ever calling `Number()` closes that whole class at once,
 * the same "gate the type first, then coerce" shape `isFiniteNonNegativeNumber`/`isNonBlankString`
 * already established for this milestone's own numeric/string validation (`SPEC-QUESTIONS.md` Q69) —
 * `null`/a `boolean`/an object now correctly join `undefined` (a missing path) as "not orderable," rather
 * than a `boolean` or `object`-shaped value getting a silent, arbitrary numeric reading no workflow
 * author asked for. */
function toOrderableNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isNaN(value) ? undefined : value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

/** `-1`/`0`/`1` for a genuine ordering, `undefined` when the two values cannot be meaningfully ordered —
 * kept as its own step rather than relying on raw `<`/`>` directly on two `unknown` values, which is both
 * not type-safe here and would silently inherit every quirk of JS's own abstract relational comparison
 * algorithm (string-vs-string is lexicographic *unless* one side looks numeric, `[] < [1]` does
 * surprising things, etc.) rather than the one, deliberate rule below: two strings compare
 * lexicographically; otherwise, each side independently goes through `toOrderableNumber` above (so a
 * numeric-looking string paired with a real number, e.g. `a > 3` against `a: "5"`, still orders
 * correctly — only a string-vs-string pair is ever compared lexicographically instead of numerically);
 * either side coming back `undefined` from that — a non-numeric string, `null`, a `boolean`, an object/
 * array, or a genuinely missing path — makes the whole comparison `undefined`-outcome ("not
 * orderable"). */
function compareOrdering(left: unknown, right: unknown): number | undefined {
  if (typeof left === 'string' && typeof right === 'string') {
    if (left === right) return 0;
    return left < right ? -1 : 1;
  }
  const leftNum = toOrderableNumber(left);
  const rightNum = toOrderableNumber(right);
  if (leftNum === undefined || rightNum === undefined) return undefined;
  if (leftNum === rightNum) return 0;
  return leftNum < rightNum ? -1 : 1;
}

function evaluateAtDepth(expr: Expr, context: ExpressionContext, depth: number): unknown {
  if (depth > MAX_EVALUATION_DEPTH) {
    throw new ForgeError('CFG-016', { maxDepth: MAX_EVALUATION_DEPTH });
  }
  const nextDepth = depth + 1;

  switch (expr.kind) {
    case 'literal':
      return expr.value;

    case 'path':
      return resolvePath(expr.segments, context);

    case 'not':
      return !evaluateAtDepth(expr.operand, context, nextDepth);

    case 'logical': {
      // Short-circuiting, like every other language's own &&/||: the right side is only evaluated when
      // it could actually change the outcome, so a right-hand `length(...)`/path with a side-effect-free
      // but potentially "unresolved" value never gets asked for when it wouldn't matter anyway.
      const left = Boolean(evaluateAtDepth(expr.left, context, nextDepth));
      if (expr.operator === '&&') return left && Boolean(evaluateAtDepth(expr.right, context, nextDepth));
      return left || Boolean(evaluateAtDepth(expr.right, context, nextDepth));
    }

    case 'comparison': {
      const left = evaluateAtDepth(expr.left, context, nextDepth);
      const right = evaluateAtDepth(expr.right, context, nextDepth);
      if (expr.operator === '==') return left === right;
      if (expr.operator === '!=') return left !== right;
      const cmp = compareOrdering(left, right);
      if (cmp === undefined) return false;
      if (expr.operator === '<') return cmp < 0;
      if (expr.operator === '<=') return cmp <= 0;
      if (expr.operator === '>') return cmp > 0;
      return cmp >= 0;
    }

    case 'in': {
      const value = evaluateAtDepth(expr.value, context, nextDepth);
      const collection = evaluateAtDepth(expr.collection, context, nextDepth);
      if (Array.isArray(collection)) return collection.includes(value);
      if (typeof collection === 'string') return typeof value === 'string' && collection.includes(value);
      return false;
    }

    case 'length': {
      const operand = evaluateAtDepth(expr.operand, context, nextDepth);
      if (typeof operand === 'string' || Array.isArray(operand)) return operand.length;
      // Deliberately not 0: `length(item.tags) > 0` against an unresolved item.tags should read as "no
      // signal either way," which the surrounding comparison already turns into `false` on its own (see
      // compareOrdering's own doc comment) — collapsing straight to 0 here would make "definitely has
      // zero tags" and "this path does not exist at all" indistinguishable to a caller that inspects the
      // raw evaluate() result directly, not just the outcome of one comparison built on top of it.
      return undefined;
    }
  }
}

/** Throws a `ForgeError` (`CFG-016`) rather than returning a sentinel `unknown` value when `expr` nests
 * more than `MAX_EVALUATION_DEPTH` levels deep — the one exception to this module's own general "no
 * ambient throwing, everything is an ordinary `unknown` result" shape, and a deliberate one: there is no
 * value this function could return here that a caller could not mistake for a genuine (if surprising)
 * evaluation outcome, the same reasoning `@forge/engine/workflow`'s own `resolveTemplate` documents for
 * choosing a real, catchable `ForgeError` over silently returning something a caller might not think to
 * check for. `engine ← core` is a real, available edge (`SPEC-QUESTIONS.md` Q62), so this is the same
 * registered-code convention `resolveTemplate` already established, not a new one invented here. */
export function evaluate(expr: Expr, context: ExpressionContext): unknown {
  return evaluateAtDepth(expr, context, 0);
}
