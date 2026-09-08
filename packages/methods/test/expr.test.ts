/**
 * `parseExpression`/`evaluateExpression`/`evaluateCondition` — the small local expression evaluator
 * `11` §11.0's own `rules[].if` grammar needs, since `@forge/methods` has no `@forge/engine` edge.
 *
 * @see specs/11 §11.0
 * @see PLAN-M6.md M1
 */
import { describe, expect, it } from 'vitest';

import { evaluateCondition, evaluateExpression, parseExpression } from '../src/expr.ts';

describe('parseExpression / evaluateCondition', () => {
  it('evaluates a bare equality comparison against a numeric field, the worked repo-strategy example', () => {
    expect(evaluateCondition('deployable_units == 1', { deployable_units: 1 })).toBe(true);
    expect(evaluateCondition('deployable_units == 1', { deployable_units: 2 })).toBe(false);
  });

  it('evaluates a bare dotted-path truthy check with no comparison, the second worked example', () => {
    expect(
      evaluateCondition('regulatory.code_isolation_required', {
        regulatory: { code_isolation_required: true },
      }),
    ).toBe(true);
    expect(
      evaluateCondition('regulatory.code_isolation_required', {
        regulatory: { code_isolation_required: false },
      }),
    ).toBe(false);
  });

  it('a missing path resolves to undefined, which is falsy, not a thrown error', () => {
    expect(evaluateCondition('missing.deeply.nested', {})).toBe(false);
  });

  it.each(['==', '!=', '<', '<=', '>', '>='] as const)(
    'supports the %s comparison operator',
    (op) => {
      const expr = parseExpression(`x ${op} 5`);
      expect(expr).toBeDefined();
    },
  );

  it('supports boolean combination: &&, ||, !', () => {
    expect(evaluateCondition('a && b', { a: true, b: true })).toBe(true);
    expect(evaluateCondition('a && b', { a: true, b: false })).toBe(false);
    expect(evaluateCondition('a || b', { a: false, b: true })).toBe(true);
    expect(evaluateCondition('!a', { a: false })).toBe(true);
    expect(evaluateCondition('!a', { a: true })).toBe(false);
  });

  it('supports parenthesised grouping', () => {
    expect(evaluateCondition('(a || b) && c', { a: false, b: true, c: true })).toBe(true);
    expect(evaluateCondition('(a || b) && c', { a: false, b: true, c: false })).toBe(false);
  });

  it('supports string and boolean literals', () => {
    expect(evaluateCondition('tier == "core"', { tier: 'core' })).toBe(true);
    expect(evaluateCondition("tier == 'core'", { tier: 'core' })).toBe(true);
    expect(evaluateCondition('flag == true', { flag: true })).toBe(true);
  });

  it('returns undefined for a genuinely malformed expression, rather than throwing', () => {
    expect(parseExpression('a ==')).toBeUndefined();
    expect(parseExpression('(a')).toBeUndefined();
    expect(parseExpression('a $ b')).toBeUndefined();
    expect(parseExpression('')).toBeUndefined();
  });

  it('evaluateCondition on a malformed expression is falsy, not a thrown error', () => {
    expect(evaluateCondition('a ==', {})).toBe(false);
  });

  it('numeric ordering comparisons only ever compare numbers, never coerce strings', () => {
    expect(evaluateCondition('x < 5', { x: 3 })).toBe(true);
    expect(evaluateCondition('x < 5', { x: '3' })).toBe(false);
  });

  it('evaluateExpression on a bare literal returns the literal itself', () => {
    const expr = parseExpression('42');
    expect(expr).toBeDefined();
    expect(evaluateExpression(expr!, {})).toBe(42);
  });

  it('is deterministic: identical source and context always evaluate identically', () => {
    const context = { deployable_units: 1 };
    const first = evaluateCondition('deployable_units == 1', context);
    const second = evaluateCondition('deployable_units == 1', context);
    expect(second).toBe(first);
  });

  it('tolerates trailing whitespace rather than rejecting an otherwise-valid expression', () => {
    expect(evaluateCondition('deployable_units == 1   ', { deployable_units: 1 })).toBe(true);
  });

  it('rejects trailing garbage content that matches no token', () => {
    expect(parseExpression('a && b $')).toBeUndefined();
  });

  it('rejects a parenthesized group missing its closing paren', () => {
    expect(parseExpression('(a b)')).toBeUndefined();
  });

  it('supports a parenthesized group on the right-hand side of a comparison', () => {
    expect(evaluateCondition('a == (b)', { a: 1, b: 1 })).toBe(true);
  });

  it('rejects two tokens with no operator between them', () => {
    expect(parseExpression('a b')).toBeUndefined();
  });

  it.each(['>=', '>', '<='] as const)(
    'the %s operator only ever compares numbers, never coerces strings',
    (op) => {
      expect(evaluateCondition(`x ${op} 3`, { x: op === '>' ? 5 : 3 })).toBe(true);
      expect(evaluateCondition(`x ${op} 3`, { x: '5' })).toBe(false);
    },
  );

  it('"!" binds looser than a comparison: "!a == b" parses as "!(a == b)"', () => {
    expect(evaluateCondition('!a == b', { a: false, b: true })).toBe(true);
    expect(evaluateCondition('!a == b', { a: false, b: false })).toBe(false);
  });
});
