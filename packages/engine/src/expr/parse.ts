/**
 * The parser half of `10` §10.1's "hand-written parser (~300 LOC)" instruction — recursive-descent,
 * standard precedence climb, lowest to highest: `||`, `&&`, comparison/`in` (one non-chaining level —
 * `a > b > c` is not a thing this language has any spec evidence it needs), unary `!`, then a primary
 * (literal, path, `length(...)`, or a parenthesised sub-expression) — `!` binds to the single next
 * operand, not a whole comparison (`parseUnary`'s own doc comment has the fuller reasoning, including a
 * real bug an earlier, looser-binding version of this grammar shipped with). Never `eval`/`new Function`
 * (`10` §10.1's own explicit instruction) — every token is consumed by hand.
 *
 * @see specs/10 §10.1
 * @see PLAN-M5.md P9
 */
import { LexError, tokenize, type Token, type TokenKind } from './lex.ts';
import type { ComparisonOperator, Expr, LogicalOperator, ParseExpressionResult } from './types.ts';

/** For a value this module's own construction already guarantees is never actually `undefined` (an
 * internal-invariant assertion, not user-facing validation), rather than an `as`/`!` cast: the two real
 * call sites (`ParserState.peek()`'s own array index, and a number/string/boolean token's own `value`,
 * always set by `lex.ts` for exactly those three kinds) are both `noUncheckedIndexedAccess`/optional-
 * field artifacts, provably safe by construction but not statically provable to the compiler — the same
 * situation, and the same runtime-check-over-cast resolution, `@forge/engine/workflow`'s own
 * `validate.ts` documents for its identically-shaped array-indexing guards. */
function assertDefined<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(`Internal error: ${message}`);
  return value;
}

/** Confirmed empirically that nested `(((...)))`/`!!!!...`/`length(length(...))` blow the real call
 * stack with a raw, uncaught `RangeError` well within a single YAML scalar's realistic size (~1500
 * levels) — directly contradicting `parseExpression`'s own "never throws" contract below, which the
 * existing tests never exercised at anywhere near this depth. Chosen with a wide safety margin under
 * that empirical threshold — no real `failOn`/`when` expression anywhere in the spec pack nests even
 * once — the same proportionate-guard reasoning `@forge/engine/workflow`'s own `validate.ts` documents
 * for its identically-shaped `MAX_TRAVERSAL_DEPTH`. */
const MAX_EXPRESSION_DEPTH = 200;

const COMPARISON_KINDS: readonly TokenKind[] = ['==', '!=', '<', '<=', '>', '>='];
/** Token kinds a path segment may use immediately after a `.`, beyond a plain `identifier` — `10` §10.1
 * gives no evidence a real context object's own field names ever collide with this language's own
 * keywords, but nothing rules it out either (an `item` with a field literally named `length`), and
 * failing to parse `item.length` as a path merely because `length` is also a keyword elsewhere in the
 * grammar would be a real, avoidable usability gap for a one-token fix. */
const CONTEXTUAL_PATH_SEGMENT_KINDS: readonly TokenKind[] = ['in', 'length', 'boolean'];

class ParserState {
  private readonly tokens: readonly Token[];
  private index = 0;
  private recursionDepth = 0;

  constructor(tokens: readonly Token[]) {
    this.tokens = tokens;
  }

  /** Called once at the top of every function that can recurse (`parseUnary`'s own self-call for `!`;
   * `parsePrimary`'s own calls back into `parseOr` for `(...)`/`length(...)`) — the two real recursion
   * sources `MAX_EXPRESSION_DEPTH`'s own doc comment names. Deliberately not a per-precedence-level
   * counter (`parseOr`/`parseAnd`/`parseComparison` are themselves iterative, not recursive, for
   * repeated `&&`/`||`/chained comparisons — confirmed a long *flat* chain of either does not, on its
   * own, reach the real call stack limit at parse time): only the shapes that genuinely nest need to be
   * counted, and a try/finally around each recursive call keeps the counter accurate across sibling
   * (not nested) groups like `a && (b) && (c)`. */
  enterRecursion(): void {
    this.recursionDepth += 1;
    if (this.recursionDepth > MAX_EXPRESSION_DEPTH) {
      throw new LexError(
        `Expression nests more than ${String(MAX_EXPRESSION_DEPTH)} levels deep.`,
        this.peek().position,
      );
    }
  }

  exitRecursion(): void {
    this.recursionDepth -= 1;
  }

  peek(): Token {
    // Always defined: tokenize() always appends a trailing 'eof' token, and this.index never advances
    // past it (check() on 'eof' is always false for every other kind, so nothing ever calls advance()
    // again once positioned on it).
    return assertDefined(this.tokens[this.index], 'token stream exhausted without reaching eof');
  }

  advance(): Token {
    const token = this.peek();
    // Every real call site in this file checks a specific, non-'eof' kind (via check()/match()) before
    // ever calling advance(), so this branch's own 'stay put once on eof' half never actually fires
    // today — kept as part of this class's own documented contract (peek()'s doc comment above) rather
    // than removed as dead code, since it is what makes that contract true regardless of how any future
    // grammar addition happens to call this method, not an accident of how today's grammar calls it.
    if (token.kind !== 'eof') this.index += 1;
    return token;
  }

  check(kind: TokenKind): boolean {
    return this.peek().kind === kind;
  }

  match(...kinds: readonly TokenKind[]): boolean {
    return kinds.includes(this.peek().kind);
  }
}

function parsePrimary(state: ParserState): Expr {
  const token = state.peek();

  if (token.kind === 'number' || token.kind === 'string' || token.kind === 'boolean') {
    state.advance();
    return {
      kind: 'literal',
      value: assertDefined(token.value, 'literal token missing its own value'),
    };
  }

  if (token.kind === 'length') {
    state.advance();
    if (!state.check('lparen')) {
      throw new LexError('Expected "(" after "length".', state.peek().position);
    }
    state.advance();
    state.enterRecursion();
    let operand: Expr;
    try {
      operand = parseOr(state);
    } finally {
      state.exitRecursion();
    }
    if (!state.check('rparen')) {
      throw new LexError('Expected ")" to close "length(...)".', state.peek().position);
    }
    state.advance();
    return { kind: 'length', operand };
  }

  if (token.kind === 'lparen') {
    state.advance();
    state.enterRecursion();
    let inner: Expr;
    try {
      inner = parseOr(state);
    } finally {
      state.exitRecursion();
    }
    if (!state.check('rparen')) {
      throw new LexError('Expected ")" to close "(...)".', state.peek().position);
    }
    state.advance();
    return inner;
  }

  if (token.kind === 'identifier') {
    const segments: string[] = [token.text];
    state.advance();
    while (state.check('dot')) {
      state.advance();
      const next = state.peek();
      if (next.kind !== 'identifier' && !CONTEXTUAL_PATH_SEGMENT_KINDS.includes(next.kind)) {
        throw new LexError('Expected a path segment after ".".', next.position);
      }
      segments.push(next.text);
      state.advance();
    }
    return { kind: 'path', segments };
  }

  throw new LexError(`Unexpected token "${token.text || token.kind}".`, token.position);
}

/** Binds tighter than a comparison, not looser: `!a == b` parses as `(!a) == b`, matching the
 * "unary `!` applies to the single next operand" convention every mainstream language with both a `!`
 * operator and comparison operators uses (JS, C, Python's own `not`, ...) — confirmed by a direct test
 * against that expectation after an earlier version of this grammar (with `!` binding *looser* than
 * comparison, `!(a == b)` for the identical source text) shipped the surprising, non-conventional reading
 * instead. An author who *wants* `!` to negate a whole comparison still can, explicitly, with parens:
 * `!(a == b)`. */
function parseUnary(state: ParserState): Expr {
  if (state.check('!')) {
    state.advance();
    state.enterRecursion();
    try {
      return { kind: 'not', operand: parseUnary(state) };
    } finally {
      state.exitRecursion();
    }
  }
  return parsePrimary(state);
}

function parseComparison(state: ParserState): Expr {
  const left = parseUnary(state);

  if (state.check('in')) {
    state.advance();
    const collection = parseUnary(state);
    return { kind: 'in', value: left, collection };
  }

  if (state.match(...COMPARISON_KINDS)) {
    const operator = state.advance().kind as ComparisonOperator;
    const right = parseUnary(state);
    return { kind: 'comparison', operator, left, right };
  }

  return left;
}

function parseAnd(state: ParserState): Expr {
  let left = parseComparison(state);
  while (state.check('&&')) {
    state.advance();
    const right = parseComparison(state);
    left = { kind: 'logical', operator: '&&' as LogicalOperator, left, right };
  }
  return left;
}

function parseOr(state: ParserState): Expr {
  let left = parseAnd(state);
  while (state.check('||')) {
    state.advance();
    const right = parseAnd(state);
    left = { kind: 'logical', operator: '||' as LogicalOperator, left, right };
  }
  return left;
}

/** `10` §10.1's own sandboxed expression language. Never throws: a lex or parse failure — an unexpected
 * character, an unterminated string, a dangling operator, trailing garbage after an otherwise-complete
 * expression — becomes a `ParseExpressionResult` failure naming the offending token and its character
 * position, never a thrown error a caller must remember to catch.
 *
 * The `|| trailing.kind` fallback below is never actually exercised: every token this module's own
 * lexer produces has non-empty `text` except `'eof'` itself, which the enclosing `if` has already ruled
 * out by construction — kept anyway as a description of intent (name *something* useful even if a
 * future token kind were ever added with legitimately-empty text) rather than because today's grammar
 * can reach it. Likewise `throw cause` in the `catch` below: every throw this module's own code performs
 * is a `LexError` (confirmed by inspection, not merely assumed), so re-throwing anything else is a
 * safety net for a genuine bug in this file, not a reachable outcome of any valid or invalid expression
 * text — the same "don't swallow a truly unexpected error into an ordinary-looking failure" reasoning
 * `@forge/engine/workflow`'s own `parseValueAgainstSchema` documents for its own `RangeError`-specific
 * catch. */
export function parseExpression(source: string): ParseExpressionResult {
  try {
    const tokens = tokenize(source);
    const state = new ParserState(tokens);
    const expr = parseOr(state);
    if (!state.check('eof')) {
      const trailing = state.peek();
      return {
        success: false,
        error: {
          message: `Unexpected trailing token "${trailing.text || trailing.kind}".`,
          position: trailing.position,
        },
      };
    }
    return { success: true, expr };
  } catch (cause) {
    if (cause instanceof LexError) {
      return { success: false, error: { message: cause.message, position: cause.position } };
    }
    throw cause;
  }
}
