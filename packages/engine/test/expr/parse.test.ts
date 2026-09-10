/**
 * `parseExpression` — `PLAN-M5.md` P9's own Checks section: every operator and helper in `10` §10.1's
 * own list is exercised.
 *
 * @see specs/10 §10.1
 * @see PLAN-M5.md P9
 */
import { describe, expect, it } from 'vitest';

import { parseExpression } from '../../src/expr/parse.ts';
import type { Expr } from '../../src/expr/types.ts';

function parseOk(source: string): Expr {
  const result = parseExpression(source);
  if (!result.success) {
    throw new Error(
      `expected "${source}" to parse, got: ${result.error.message} at ${String(result.error.position)}`,
    );
  }
  return result.expr;
}

function parseFail(source: string): { readonly message: string; readonly position: number } {
  const result = parseExpression(source);
  if (result.success) throw new Error(`expected "${source}" to fail to parse`);
  return result.error;
}

describe('parseExpression — literals', () => {
  it('parses a number literal', () => {
    expect(parseOk('42')).toEqual({ kind: 'literal', value: 42 });
  });

  it('parses a decimal number literal', () => {
    expect(parseOk('1.5')).toEqual({ kind: 'literal', value: 1.5 });
  });

  it('does not consume a trailing "." that is not followed by another digit -- "5." lexes as the number 5, then a separate dot token', () => {
    // Exercises scanDigits' own `source[next] === '.' && isDigit(...)` check on the branch where the "."
    // is real but nothing digit-shaped follows it, distinct from both "1.5" above (both true) and "42"
    // (no "." at all) -- the dot is left for the next token, which here is nothing at all, so this fails
    // as trailing garbage rather than parsing as a single number.
    const error = parseFail('5.');
    expect(error.message).toContain('trailing');
  });

  it('parses a double-quoted string literal', () => {
    expect(parseOk('"ready"')).toEqual({ kind: 'literal', value: 'ready' });
  });

  it('parses a single-quoted string literal', () => {
    expect(parseOk("'ready'")).toEqual({ kind: 'literal', value: 'ready' });
  });

  it('parses true and false', () => {
    expect(parseOk('true')).toEqual({ kind: 'literal', value: true });
    expect(parseOk('false')).toEqual({ kind: 'literal', value: false });
  });

  it('parses a negative number literal', () => {
    expect(parseOk('-5')).toEqual({ kind: 'literal', value: -5 });
  });

  it('parses a negative decimal number literal', () => {
    expect(parseOk('-1.5')).toEqual({ kind: 'literal', value: -1.5 });
  });

  it('parses a negative literal on the right of a comparison, e.g. "delta < -5"', () => {
    expect(parseOk('delta < -5')).toEqual({
      kind: 'comparison',
      operator: '<',
      left: { kind: 'path', segments: ['delta'] },
      right: { kind: 'literal', value: -5 },
    });
  });

  it('does not treat "-" as unary minus on a path -- there is no such operator in this grammar', () => {
    const error = parseFail('-item');
    expect(error.message).toContain('-');
  });

  it('fails cleanly on a bare "-" with nothing following it, rather than reading past the end of the source', () => {
    // "-" as the very last character of the source has no lookahead character at all -- exercises the
    // negative-literal branch's own `source[pos + 1] ?? ""` fallback for real, unlike every other "-"
    // test above, which always has a real (non-digit) character right after the "-".
    const error = parseFail('-');
    expect(error.message).toContain('-');
  });
});

describe('parseExpression — dotted paths', () => {
  it('parses a bare identifier as a one-segment path', () => {
    expect(parseOk('errors')).toEqual({ kind: 'path', segments: ['errors'] });
  });

  it('parses 10 §10.3\'s own "failures.test-failure" worked example, hyphen included', () => {
    expect(parseOk('failures.test-failure')).toEqual({
      kind: 'path',
      segments: ['failures', 'test-failure'],
    });
  });

  it('parses a multi-segment path', () => {
    expect(parseOk('item.owner_role')).toEqual({ kind: 'path', segments: ['item', 'owner_role'] });
  });

  it('parses a path segment that is also a keyword elsewhere in the grammar (length, in, true, false)', () => {
    expect(parseOk('item.length')).toEqual({ kind: 'path', segments: ['item', 'length'] });
    expect(parseOk('item.in')).toEqual({ kind: 'path', segments: ['item', 'in'] });
    expect(parseOk('item.true')).toEqual({ kind: 'path', segments: ['item', 'true'] });
    expect(parseOk('item.false')).toEqual({ kind: 'path', segments: ['item', 'false'] });
  });

  it.each(['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty'])(
    'parses "%s" as an ordinary identifier, not corrupted by a plain-object keyword table inheriting it from Object.prototype',
    (name) => {
      // Confirmed empirically that a plain-object `{ in: ..., length: ... }` lookup table, indexed by
      // exactly these names, silently returns an *inherited* Object.prototype value instead of
      // `undefined` -- corrupting the resulting token's own `kind` into something that is not a real
      // TokenKind at all, and failing downstream with a confusing "unexpected token" error that gives
      // no hint the real cause is the keyword table itself, not the input.
      expect(parseOk(name)).toEqual({ kind: 'path', segments: [name] });
      expect(parseOk(`item.${name}`)).toEqual({ kind: 'path', segments: ['item', name] });
    },
  );

  it('fails with a position on a trailing dot with no following segment', () => {
    const error = parseFail('item.');
    expect(error.message).toContain('path segment');
    expect(error.position).toBe(5);
  });
});

describe('parseExpression — comparisons', () => {
  it.each(['==', '!=', '<', '<=', '>', '>='] as const)('parses the %s operator', (operator) => {
    expect(parseOk(`errors ${operator} 0`)).toEqual({
      kind: 'comparison',
      operator,
      left: { kind: 'path', segments: ['errors'] },
      right: { kind: 'literal', value: 0 },
    });
  });

  it("parses 10 §10.3's own two real consumer expressions", () => {
    expect(parseOk('errors > 0')).toEqual({
      kind: 'comparison',
      operator: '>',
      left: { kind: 'path', segments: ['errors'] },
      right: { kind: 'literal', value: 0 },
    });
    expect(parseOk('failures.test-failure > 2')).toEqual({
      kind: 'comparison',
      operator: '>',
      left: { kind: 'path', segments: ['failures', 'test-failure'] },
      right: { kind: 'literal', value: 2 },
    });
  });
});

describe('parseExpression — logical operators and precedence', () => {
  it('parses &&', () => {
    expect(parseOk('a && b')).toEqual({
      kind: 'logical',
      operator: '&&',
      left: { kind: 'path', segments: ['a'] },
      right: { kind: 'path', segments: ['b'] },
    });
  });

  it('parses ||', () => {
    expect(parseOk('a || b')).toEqual({
      kind: 'logical',
      operator: '||',
      left: { kind: 'path', segments: ['a'] },
      right: { kind: 'path', segments: ['b'] },
    });
  });

  it('parses unary !', () => {
    expect(parseOk('!a')).toEqual({ kind: 'not', operand: { kind: 'path', segments: ['a'] } });
  });

  it('binds && tighter than ||: "a || b && c" is "a || (b && c)"', () => {
    expect(parseOk('a || b && c')).toEqual({
      kind: 'logical',
      operator: '||',
      left: { kind: 'path', segments: ['a'] },
      right: {
        kind: 'logical',
        operator: '&&',
        left: { kind: 'path', segments: ['b'] },
        right: { kind: 'path', segments: ['c'] },
      },
    });
  });

  it('binds a comparison tighter than &&: "a > 0 && b > 0" is "(a > 0) && (b > 0)"', () => {
    const expr = parseOk('a > 0 && b > 0');
    expect(expr.kind).toBe('logical');
    if (expr.kind !== 'logical') throw new Error('expected logical');
    expect(expr.left.kind).toBe('comparison');
    expect(expr.right.kind).toBe('comparison');
  });

  it('binds ! tighter than a comparison: "!a == b" is "(!a) == b"', () => {
    const expr = parseOk('!a == b');
    expect(expr.kind).toBe('comparison');
    if (expr.kind !== 'comparison') throw new Error('expected comparison');
    expect(expr.left).toEqual({ kind: 'not', operand: { kind: 'path', segments: ['a'] } });
  });

  it('parses parentheses overriding the default precedence', () => {
    expect(parseOk('(a || b) && c')).toEqual({
      kind: 'logical',
      operator: '&&',
      left: {
        kind: 'logical',
        operator: '||',
        left: { kind: 'path', segments: ['a'] },
        right: { kind: 'path', segments: ['b'] },
      },
      right: { kind: 'path', segments: ['c'] },
    });
  });

  it('parses repeated && left-associatively', () => {
    expect(parseOk('a && b && c')).toEqual({
      kind: 'logical',
      operator: '&&',
      left: {
        kind: 'logical',
        operator: '&&',
        left: { kind: 'path', segments: ['a'] },
        right: { kind: 'path', segments: ['b'] },
      },
      right: { kind: 'path', segments: ['c'] },
    });
  });
});

describe('parseExpression — in', () => {
  it('parses "value in collection"', () => {
    expect(parseOk('role in item.assignees')).toEqual({
      kind: 'in',
      value: { kind: 'path', segments: ['role'] },
      collection: { kind: 'path', segments: ['item', 'assignees'] },
    });
  });

  it('parses a string literal on the left of in', () => {
    expect(parseOk('"reviewer" in item.assignees')).toEqual({
      kind: 'in',
      value: { kind: 'literal', value: 'reviewer' },
      collection: { kind: 'path', segments: ['item', 'assignees'] },
    });
  });
});

describe('parseExpression — length', () => {
  it('parses length(...) wrapping a path', () => {
    expect(parseOk('length(item.tags)')).toEqual({
      kind: 'length',
      operand: { kind: 'path', segments: ['item', 'tags'] },
    });
  });

  it('parses length(...) used in a comparison', () => {
    expect(parseOk('length(item.tags) > 0')).toEqual({
      kind: 'comparison',
      operator: '>',
      left: { kind: 'length', operand: { kind: 'path', segments: ['item', 'tags'] } },
      right: { kind: 'literal', value: 0 },
    });
  });

  it('fails without an opening paren after length', () => {
    const error = parseFail('length item.tags');
    expect(error.message).toContain('(');
  });

  it('fails without a closing paren', () => {
    const error = parseFail('length(item.tags');
    expect(error.message).toContain(')');
  });
});

describe('parseExpression — depth guard', () => {
  it('parses exactly MAX_EXPRESSION_DEPTH (200) levels of nested parens', () => {
    const source = '('.repeat(200) + 'a' + ')'.repeat(200);
    const expr = parseOk(source);
    expect(expr).toEqual({ kind: 'path', segments: ['a'] });
  });

  it('fails cleanly, not with a raw RangeError, one level past the limit', () => {
    const source = '('.repeat(201) + 'a' + ')'.repeat(201);
    const error = parseFail(source);
    expect(error.message).toContain('nests more than 200 levels deep');
  });

  it('fails cleanly on deeply nested parens well past the limit -- confirmed empirically this would otherwise blow the real call stack with a raw RangeError', () => {
    const source = '('.repeat(1600) + 'a' + ')'.repeat(1600);
    expect(() => parseExpression(source)).not.toThrow();
    const error = parseFail(source);
    expect(error.message).toContain('nests more than 200 levels deep');
  });

  it('fails cleanly on deeply nested ! well past the limit', () => {
    const source = '!'.repeat(100000) + 'a';
    expect(() => parseExpression(source)).not.toThrow();
    const error = parseFail(source);
    expect(error.message).toContain('nests more than 200 levels deep');
  });

  it('fails cleanly on deeply nested length(...) well past the limit', () => {
    const source = 'length('.repeat(50000) + 'a' + ')'.repeat(50000);
    expect(() => parseExpression(source)).not.toThrow();
    const error = parseFail(source);
    expect(error.message).toContain('nests more than 200 levels deep');
  });

  it('does not reject ordinary, shallow nesting', () => {
    expect(parseOk('!(a && (b || c))')).toEqual({
      kind: 'not',
      operand: {
        kind: 'logical',
        operator: '&&',
        left: { kind: 'path', segments: ['a'] },
        right: {
          kind: 'logical',
          operator: '||',
          left: { kind: 'path', segments: ['b'] },
          right: { kind: 'path', segments: ['c'] },
        },
      },
    });
  });
});

describe('parseExpression — errors', () => {
  it('fails on an unexpected character, naming its position', () => {
    const error = parseFail('errors @ 0');
    expect(error.message).toContain('@');
    expect(error.position).toBe(7);
  });

  it('fails on an unterminated string literal', () => {
    const error = parseFail('errors == "unterminated');
    expect(error.message).toContain('Unterminated string');
  });

  it('fails on a single "=" (not "==")', () => {
    const error = parseFail('errors = 0');
    expect(error.message).toContain('==');
  });

  it('fails on a single "&" (not "&&")', () => {
    expect(parseFail('a & b').message).toContain('&&');
  });

  it('fails on a single "|" (not "||")', () => {
    expect(parseFail('a | b').message).toContain('||');
  });

  it('fails on trailing garbage after an otherwise-complete expression', () => {
    const error = parseFail('errors > 0 extra');
    expect(error.message).toContain('trailing');
    expect(error.position).toBe(11);
  });

  it('fails on a completely empty expression', () => {
    expect(parseExpression('').success).toBe(false);
  });

  it('fails on an unbalanced closing paren with nothing to close', () => {
    expect(parseExpression('a)').success).toBe(false);
  });

  it('fails on an unbalanced opening paren', () => {
    expect(parseExpression('(a').success).toBe(false);
  });

  it('never throws for any malformed input — always returns a ParseExpressionResult', () => {
    const adversarial = [
      '(((',
      ')))',
      '!!!!',
      '&&&&',
      '"',
      "'",
      '..',
      'a.b.',
      '0.0.0',
      'length()',
      '()',
    ];
    for (const source of adversarial) {
      expect(() => parseExpression(source)).not.toThrow();
    }
  });
});

describe('parseExpression — whitespace', () => {
  it('tolerates arbitrary whitespace between tokens', () => {
    expect(parseOk('  errors   >   0  ')).toEqual(parseOk('errors>0'));
  });

  it('tolerates tabs and newlines as whitespace', () => {
    expect(parseOk('errors\t>\n0')).toEqual(parseOk('errors > 0'));
  });
});
