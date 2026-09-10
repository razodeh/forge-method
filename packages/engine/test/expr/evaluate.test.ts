/**
 * `evaluate` — `PLAN-M5.md` P9's own Checks section: every operator and helper exercised; a nested-path
 * miss resolves to a typed "undefined path" outcome, not a thrown JS error; the two real consumer
 * expressions (`failOn`, `when`) evaluate correctly against a constructed context; the sandbox-escape
 * test is explicit, not incidental.
 *
 * @see specs/10 §10.1
 * @see PLAN-M5.md P9
 */
import { describe, expect, it } from 'vitest';

import { ForgeError } from '@forge/core/errors';

import { evaluate } from '../../src/expr/evaluate.ts';
import { parseExpression } from '../../src/expr/parse.ts';
import type { Expr, ExpressionContext } from '../../src/expr/types.ts';

function evalExpr(source: string, context: ExpressionContext = {}): unknown {
  const result = parseExpression(source);
  if (!result.success) throw new Error(`expected "${source}" to parse: ${result.error.message}`);
  return evaluate(result.expr, context);
}

describe('evaluate — literals', () => {
  it('evaluates number, string, and boolean literals to themselves', () => {
    expect(evalExpr('42')).toBe(42);
    expect(evalExpr('"ready"')).toBe('ready');
    expect(evalExpr('true')).toBe(true);
    expect(evalExpr('false')).toBe(false);
  });

  it('evaluates a negative number literal to itself', () => {
    expect(evalExpr('-5')).toBe(-5);
  });

  it('evaluates a negative literal in a comparison, e.g. "delta < -5"', () => {
    expect(evalExpr('delta < -5', { delta: -10 } as unknown as ExpressionContext)).toBe(true);
    expect(evalExpr('delta < -5', { delta: -1 } as unknown as ExpressionContext)).toBe(false);
  });
});

describe('evaluate — paths', () => {
  it('resolves a one-segment path against the context', () => {
    expect(evalExpr('run', { run: 'run-1' })).toBe('run-1');
  });

  it('resolves a multi-segment path through nested objects', () => {
    expect(evalExpr('item.owner_role', { item: { owner_role: 'engineer' } })).toBe('engineer');
  });

  it('resolves the exact "failures.test-failure" worked example', () => {
    expect(evalExpr('failures.test-failure', { failures: { 'test-failure': 3 } })).toBe(3);
  });

  it('resolves a completely missing root helper to undefined, not a thrown error', () => {
    expect(() => evalExpr('config.foo', {})).not.toThrow();
    expect(evalExpr('config.foo', {})).toBeUndefined();
  });

  it('resolves a missing nested key to undefined, not a thrown error -- the "typed undefined path outcome" the Checks text names', () => {
    expect(() => evalExpr('item.owner_role', { item: {} })).not.toThrow();
    expect(evalExpr('item.owner_role', { item: {} })).toBeUndefined();
  });

  it('resolves a path continuing past a scalar (not an object) to undefined, not a thrown error', () => {
    expect(
      evalExpr('item.owner_role.nested', { item: { owner_role: 'engineer' } }),
    ).toBeUndefined();
  });

  it('resolves a path continuing past null to undefined, not a thrown error', () => {
    expect(evalExpr('item.owner_role', { item: null })).toBeUndefined();
  });

  it.each(['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty'])(
    'resolves "%s" against a context with no own property of that name to undefined, not an inherited Object.prototype value',
    (name) => {
      // Confirmed empirically that a bare `context[name]` (no Object.hasOwn guard) silently returns a
      // real, live JS function reference inherited from Object.prototype instead of `undefined` -- not
      // a parse-time corruption like the lexer's own keyword-table bug, but the identical root cause
      // (bracket access on a name that happens to collide with something Object.prototype defines).
      expect(evalExpr(name, {})).toBeUndefined();
      expect(evalExpr(`item.${name}`, { item: {} })).toBeUndefined();
    },
  );

  it('still resolves a genuine own property named the same as an Object.prototype member -- the fix does not overcorrect into always returning undefined for these names', () => {
    expect(
      evalExpr('constructor', { constructor: 'engineer' } as unknown as ExpressionContext),
    ).toBe('engineer');
    expect(evalExpr('item.toString', { item: { toString: 'custom-value' } })).toBe('custom-value');
  });
});

describe('evaluate — comparisons', () => {
  it('evaluates 10 §10.3\'s own "errors > 0" against a real failOn-shaped context, both sides of the boundary', () => {
    // "errors" is a bare root path in the spec's own example, meaning a caller supplies it directly as
    // part of the context object handed to evaluate (a gate check's own tally, not nested under one of
    // the seven fixed helpers) -- evaluate has no opinion on this, it just resolves whatever the context
    // actually contains, hence the cast: a real caller's own context shape here is not one of this
    // package's own fixed seven fields.
    expect(evalExpr('errors > 0', { errors: 3 } as unknown as ExpressionContext)).toBe(true);
    expect(evalExpr('errors > 0', { errors: 0 } as unknown as ExpressionContext)).toBe(false);
  });

  it('evaluates 10 §10.3\'s own "failures.test-failure > 2" worked example both ways', () => {
    const context = { failures: { 'test-failure': 3 } };
    expect(evalExpr('failures.test-failure > 2', context)).toBe(true);
    expect(evalExpr('failures.test-failure > 2', { failures: { 'test-failure': 1 } })).toBe(false);
  });

  it('evaluates == with strict equality, not JS-style loose coercion', () => {
    // 0 == false and "" == 0 are both true under loose ==; this language uses ===, deliberately, to
    // avoid exactly those two footguns for an author who did not expect them.
    expect(evalExpr('a == b', { a: 0, b: false } as unknown as ExpressionContext)).toBe(false);
    expect(evalExpr('a == b', { a: '', b: 0 } as unknown as ExpressionContext)).toBe(false);
    expect(evalExpr('a == b', { a: 1, b: 1 } as unknown as ExpressionContext)).toBe(true);
  });

  it('evaluates != as the negation of strict equality', () => {
    expect(evalExpr('a != b', { a: 1, b: 2 } as unknown as ExpressionContext)).toBe(true);
    expect(evalExpr('a != b', { a: 1, b: 1 } as unknown as ExpressionContext)).toBe(false);
  });

  it('evaluates < <= > >= numerically', () => {
    expect(evalExpr('3 < 5')).toBe(true);
    expect(evalExpr('5 <= 5')).toBe(true);
    expect(evalExpr('5 > 3')).toBe(true);
    expect(evalExpr('5 >= 5')).toBe(true);
    expect(evalExpr('3 > 5')).toBe(false);
  });

  it('evaluates < <= > >= lexicographically for two strings', () => {
    expect(evalExpr('"abc" < "abd"')).toBe(true);
    expect(evalExpr('"abd" > "abc"')).toBe(true);
  });

  it('evaluates <= and >= as true for two equal strings, the string-comparison branch <  and > alone do not reach', () => {
    expect(evalExpr('"abc" <= "abc"')).toBe(true);
    expect(evalExpr('"abc" >= "abc"')).toBe(true);
    expect(evalExpr('"abc" < "abc"')).toBe(false);
  });

  it('coerces a numeric-looking string against a number for ordering, matching ordinary JS semantics', () => {
    expect(evalExpr('a > 3', { a: '5' } as unknown as ExpressionContext)).toBe(true);
  });

  it('coerces the right side too, not just the left -- both operands are checked independently', () => {
    expect(evalExpr('5 > a', { a: '3' } as unknown as ExpressionContext)).toBe(true);
    expect(evalExpr('5 > a', { a: '10' } as unknown as ExpressionContext)).toBe(false);
  });

  it('reports every ordering comparison as false, not throwing or producing NaN-shaped confusion, when a side is not orderable', () => {
    expect(evalExpr('a > 0', {})).toBe(false);
    expect(evalExpr('a < 0', {})).toBe(false);
    expect(evalExpr('a >= 0', {})).toBe(false);
    expect(evalExpr('a <= 0', {})).toBe(false);
  });

  it('reports null as not orderable, consistent with == treating null as not equal to 0 -- a verify-round regression test', () => {
    // A bare `Number(x)` fallback (this module's own earlier version) silently reads Number(null) as 0,
    // so `a <= 0`/`a >= 0` were both `true` for `a: null` while `a == 0` was `false` for the identical
    // value -- a real, silent inconsistency a null-valued numeric context field could trigger.
    expect(evalExpr('a == 0', { a: null } as unknown as ExpressionContext)).toBe(false);
    expect(evalExpr('a <= 0', { a: null } as unknown as ExpressionContext)).toBe(false);
    expect(evalExpr('a >= 0', { a: null } as unknown as ExpressionContext)).toBe(false);
    expect(evalExpr('a < 0', { a: null } as unknown as ExpressionContext)).toBe(false);
    expect(evalExpr('a > 0', { a: null } as unknown as ExpressionContext)).toBe(false);
  });

  it('reports an array as not orderable, even a single-element numeric-looking one -- Number([5]) is 5, but this language does not treat an array as a number', () => {
    expect(evalExpr('a <= 0', { a: [] } as unknown as ExpressionContext)).toBe(false);
    expect(evalExpr('a > 3', { a: [5] } as unknown as ExpressionContext)).toBe(false);
  });

  it('reports a boolean as not orderable -- true/false are for &&/||/!, not numeric comparison', () => {
    expect(evalExpr('a >= 1', { a: true } as unknown as ExpressionContext)).toBe(false);
    expect(evalExpr('a <= 0', { a: false } as unknown as ExpressionContext)).toBe(false);
  });

  it('reports a NaN-valued numeric context field as not orderable, not as equal to every other number', () => {
    // Not reachable through parseExpression's own number literal (a digit-only token can never lex to
    // NaN), but evaluate() is a public function a caller can hand any ExpressionContext to directly --
    // a computed field like an average-cost-per-item that divided by zero is a realistic source.
    expect(evalExpr('a > 0', { a: Number.NaN } as unknown as ExpressionContext)).toBe(false);
    expect(evalExpr('a == a', { a: Number.NaN } as unknown as ExpressionContext)).toBe(false);
  });

  it('reports a non-numeric string paired with a number as not orderable, not lexicographic -- only a string-vs-string pair compares lexicographically', () => {
    expect(evalExpr('a > 0', { a: 'not-a-number' } as unknown as ExpressionContext)).toBe(false);
    expect(evalExpr('0 < a', { a: 'not-a-number' } as unknown as ExpressionContext)).toBe(false);
  });
});

describe('evaluate — logical operators', () => {
  it('evaluates && truth table', () => {
    expect(evalExpr('true && true')).toBe(true);
    expect(evalExpr('true && false')).toBe(false);
    expect(evalExpr('false && true')).toBe(false);
    expect(evalExpr('false && false')).toBe(false);
  });

  it('evaluates || truth table', () => {
    expect(evalExpr('true || false')).toBe(true);
    expect(evalExpr('false || false')).toBe(false);
  });

  it('evaluates ! negation', () => {
    expect(evalExpr('!true')).toBe(false);
    expect(evalExpr('!false')).toBe(true);
  });

  it('coerces a non-boolean operand with Boolean(), matching ordinary JS truthiness', () => {
    expect(evalExpr('a && true', { a: 'non-empty' } as unknown as ExpressionContext)).toBe(true);
    expect(evalExpr('a && true', { a: '' } as unknown as ExpressionContext)).toBe(false);
  });

  it('short-circuits && without evaluating the right side when the left is false', () => {
    // A right side that would itself be false-outcome (an unresolved path) never gets asked for.
    const expr: Expr = {
      kind: 'logical',
      operator: '&&',
      left: { kind: 'literal', value: false },
      right: { kind: 'path', segments: ['never', 'reached'] },
    };
    expect(evaluate(expr, {})).toBe(false);
  });

  it('short-circuits || without evaluating the right side when the left is true', () => {
    const expr: Expr = {
      kind: 'logical',
      operator: '||',
      left: { kind: 'literal', value: true },
      right: { kind: 'path', segments: ['never', 'reached'] },
    };
    expect(evaluate(expr, {})).toBe(true);
  });
});

describe('evaluate — in', () => {
  it('evaluates membership in an array from the context', () => {
    expect(
      evalExpr('role in item.assignees', {
        role: 'reviewer',
        item: { assignees: ['reviewer', 'engineer'] },
      } as unknown as ExpressionContext),
    ).toBe(true);
    expect(
      evalExpr('role in item.assignees', {
        role: 'sdet',
        item: { assignees: ['reviewer', 'engineer'] },
      } as unknown as ExpressionContext),
    ).toBe(false);
  });

  it('evaluates substring membership in a string from the context', () => {
    expect(evalExpr('"fail" in stage.status', { stage: { status: 'failed' } })).toBe(true);
    expect(evalExpr('"fail" in stage.status', { stage: { status: 'passed' } })).toBe(false);
  });

  it('reports false, not throwing, when the collection side is not an array or string', () => {
    expect(
      evalExpr('role in item.assignees', {
        role: 'reviewer',
        item: {},
      } as unknown as ExpressionContext),
    ).toBe(false);
    expect(
      evalExpr('role in item.assignees', { role: 'reviewer' } as unknown as ExpressionContext),
    ).toBe(false);
  });
});

describe('evaluate — length', () => {
  it('evaluates the length of an array', () => {
    expect(evalExpr('length(item.tags)', { item: { tags: ['a', 'b', 'c'] } })).toBe(3);
  });

  it('evaluates the length of a string', () => {
    expect(evalExpr('length(stage.status)', { stage: { status: 'ready' } })).toBe(5);
  });

  it('evaluates length(...) of an empty array as 0, distinct from an unresolved path', () => {
    expect(evalExpr('length(item.tags)', { item: { tags: [] } })).toBe(0);
    expect(evalExpr('length(item.tags) > 0', { item: { tags: [] } })).toBe(false);
  });

  it('reports undefined, not 0, for length(...) of an unresolved path -- distinguishable from a genuine zero-length collection', () => {
    expect(evalExpr('length(item.tags)', { item: {} })).toBeUndefined();
  });

  it('a length(...) comparison against an unresolved path is false, the same safe default every other comparison uses', () => {
    expect(evalExpr('length(item.tags) > 0', { item: {} })).toBe(false);
  });
});

describe('evaluate — depth guard', () => {
  it('throws a CFG-016 ForgeError, not a raw RangeError, for a flat && chain that parses cleanly but builds a left-deep tree well past MAX_EVALUATION_DEPTH', () => {
    // parseAnd is itself iterative (confirmed in parse.test.ts's own "repeated && left-associatively"
    // case), so this parses without ever tripping the parser's own, separate depth guard -- the whole
    // point of this test is that the resulting left-deep Expr tree still blows *evaluate*'s own
    // recursive walk, a failure mode parseExpression's "never throws" contract cannot see coming.
    const source = Array.from({ length: 3000 }, () => 'a').join(' && ');
    const result = parseExpression(source);
    expect(result.success).toBe(true);
    if (!result.success) return;
    let caught: unknown;
    try {
      evaluate(result.expr, { a: true } as unknown as ExpressionContext);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ForgeError);
    if (caught instanceof ForgeError) {
      expect(caught.code).toBe('CFG-016');
    }
  });

  it('does not reject an ordinary, short && chain', () => {
    const source = Array.from({ length: 10 }, () => 'a').join(' && ');
    const result = parseExpression(source);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(evaluate(result.expr, { a: true } as unknown as ExpressionContext)).toBe(true);
  });
});

describe('evaluate — sandbox: no access to anything outside the supplied context', () => {
  it('cannot observe a sentinel value placed on globalThis', () => {
    const sentinel = `sentinel-${String(Math.random())}`;
    (globalThis as unknown as Record<string, unknown>)['__forge_expr_sandbox_test__'] = sentinel;
    try {
      const result = parseExpression('__forge_expr_sandbox_test__');
      // Either this fails to parse as a path (it does not, identifiers are valid path segments) or, if
      // it parses, it must resolve strictly against the supplied context object -- never against
      // globalThis, process, or anything else ambient -- so an empty context must yield undefined, not
      // the sentinel.
      if (result.success) {
        expect(evaluate(result.expr, {})).toBeUndefined();
      }
    } finally {
      delete (globalThis as unknown as Record<string, unknown>)['__forge_expr_sandbox_test__'];
    }
  });

  it('cannot reach globalThis, process, or require through any path segment', () => {
    expect(evalExpr('globalThis.process')).toBeUndefined();
    expect(evalExpr('process.env')).toBeUndefined();
    expect(evalExpr('require')).toBeUndefined();
  });

  it('the lexer and parser never call eval or construct a Function -- confirmed by grep, not just by reading the two files', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const files = ['lex.ts', 'parse.ts', 'evaluate.ts', 'template.ts'];
    for (const file of files) {
      const source = await fs.readFile(
        path.join(import.meta.dirname, '..', '..', 'src', 'expr', file),
        'utf8',
      );
      expect(source).not.toMatch(/\beval\s*\(/);
      expect(source).not.toMatch(/new\s+Function\s*\(/);
    }
  });

  it('parsing and evaluating a source string that names dangerous JS constructs treats them as inert path segments, never executing anything', () => {
    // Every one of these looks alarming as a bare string but is just an ordinary (if unresolved) path
    // to this language -- there is no way to reach the real, underlying JS values they name.
    const adversarial = [
      'constructor.constructor',
      'this.constructor',
      '__proto__.constructor',
      'process.mainModule.require',
    ];
    for (const source of adversarial) {
      const result = parseExpression(source);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(() => evaluate(result.expr, {})).not.toThrow();
        expect(evaluate(result.expr, {})).toBeUndefined();
      }
    }
  });
});
