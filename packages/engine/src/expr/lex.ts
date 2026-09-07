/**
 * The tokenizer half of `10` §10.1's "hand-written parser (~300 LOC)" instruction — turns an expression
 * source string into a flat token list, or throws `LexError` (caught and converted to a
 * `ParseExpressionResult` failure at `parse.ts`'s own public boundary, never leaked past it).
 *
 * @see specs/10 §10.1
 * @see PLAN-M5.md P9
 */

export type TokenKind =
  | 'identifier'
  | 'number'
  | 'string'
  | 'boolean'
  | 'dot'
  | 'lparen'
  | 'rparen'
  | '=='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | '&&'
  | '||'
  | '!'
  | 'in'
  | 'length'
  | 'eof';

export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  readonly value?: string | number | boolean;
  readonly position: number;
}

/** Thrown only within this module and `parse.ts`, never past `parseExpression`'s own public boundary. */
export class LexError extends Error {
  readonly position: number;
  constructor(message: string, position: number) {
    super(message);
    this.position = position;
  }
}

/** A `Map`, not a plain object: confirmed empirically that a plain-object lookup table indexed by an
 * identifier this language reads straight from (adversarial or otherwise) *source text* is exactly the
 * prototype-pollution shape this project has already hit once (`redact.ts`'s own `__proto__` finding,
 * `SPEC-QUESTIONS.md` Q69) — `{ in: ..., length: ... }['constructor']` and `[...]['__proto__']` both
 * silently return an *inherited* `Object.prototype` value instead of `undefined`, corrupting the token's
 * own `kind` into something that is not a real `TokenKind` at all. A `Map`'s own `.get` never walks a
 * prototype chain for its keys, closing the whole class of collision rather than special-casing the two
 * names this test happened to try. */
const KEYWORDS = new Map<string, TokenKind>([
  ['in', 'in'],
  ['length', 'length'],
  ['true', 'boolean'],
  ['false', 'boolean'],
]);

function isIdentifierStart(char: string): boolean {
  return /[A-Za-z_]/.test(char);
}

/** Letters, digits, underscore, hyphen — `failures.test-failure` (`10` §10.3's own worked example) is
 * the one real path segment the spec pack shows, and it needs the hyphen. Never the *first* character
 * (`isIdentifierStart` above): a leading hyphen would be indistinguishable from unary negation if this
 * language ever grew arithmetic, and there is no real path anywhere in the spec pack that starts with
 * one. */
function isIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9_-]/.test(char);
}

function isDigit(char: string): boolean {
  return /[0-9]/.test(char);
}

function isWhitespace(char: string): boolean {
  return /\s/.test(char);
}

/** Shared by the plain-digit and leading-`-` number branches below so a negative literal's own decimal
 * scan is identical to a positive one's, not a hand-copied second version of the same three lines.
 * `pos` is already positioned on the first digit (past any leading `-`); returns the position just past
 * the scanned digits, and past a `.` + further digits if this number has a fractional part.
 *
 * Both `?? ''` fallbacks below are `noUncheckedIndexedAccess` type-safety artifacts, not a real runtime
 * possibility: each sits directly behind a `next < source.length` bounds check in the very same
 * condition, so short-circuit evaluation means the index past the end of `source` is never actually
 * read. The same "runtime guard over cast, even where provably unreachable" choice `tokenize`'s own doc
 * comment documents for its one remaining example of the shape (the identifier-scan loop) — not tested
 * directly, since that would mean fabricating an input that cannot actually reach them. The `source[next]
 * === '.'` check just below has no such bounds guard in front of it and *is* meaningfully reachable
 * (whenever a digit run ends at a literal "." with no further digit after it, e.g. "5." at end of
 * source) — covered by `parse.test.ts`'s own "fails on a decimal point with no digit after it" case,
 * not exempted here. */
function scanDigits(source: string, pos: number): number {
  let next = pos;
  while (next < source.length && isDigit(source[next] ?? '')) next += 1;
  if (source[next] === '.' && isDigit(source[next + 1] ?? '')) {
    next += 1;
    while (next < source.length && isDigit(source[next] ?? '')) next += 1;
  }
  return next;
}

/** Scans `source` into a flat token list (including a final `'eof'` token, so the parser never has to
 * special-case running off the end of the array), or throws `LexError` naming the offending character
 * and its position.
 *
 * Every `x[i] ?? fallback`/`x[i] === undefined` check below that sits directly behind a `pos <
 * source.length` (or equivalent) guard in the very same condition — the loop here, and the identifier-
 * scan loop further down (`scanDigits`, above, documents its own two examples of the same shape) — is a
 * `noUncheckedIndexedAccess` type-safety artifact, not a real runtime possibility: short-circuit
 * evaluation means the index is never actually read unless the bounds check already passed. Left as real
 * (if unexercised) checks rather than a cast, the same "runtime guard over cast, even where provably
 * unreachable" choice `@forge/engine/workflow`'s own `validate.ts` documents for its identically-shaped
 * array-indexing guards — not tested directly, since that would mean fabricating an input that cannot
 * actually reach them. */
export function tokenize(source: string): readonly Token[] {
  const tokens: Token[] = [];
  let pos = 0;

  while (pos < source.length) {
    const char = source[pos];
    if (char === undefined) break;

    if (isWhitespace(char)) {
      pos += 1;
      continue;
    }

    const start = pos;

    if (char === '.') {
      pos += 1;
      tokens.push({ kind: 'dot', text: '.', position: start });
      continue;
    }
    if (char === '(') {
      pos += 1;
      tokens.push({ kind: 'lparen', text: '(', position: start });
      continue;
    }
    if (char === ')') {
      pos += 1;
      tokens.push({ kind: 'rparen', text: ')', position: start });
      continue;
    }
    if (char === '!') {
      if (source[pos + 1] === '=') {
        pos += 2;
        tokens.push({ kind: '!=', text: '!=', position: start });
      } else {
        pos += 1;
        tokens.push({ kind: '!', text: '!', position: start });
      }
      continue;
    }
    if (char === '=') {
      if (source[pos + 1] !== '=') {
        throw new LexError('"=" is not a valid operator; did you mean "=="?', start);
      }
      pos += 2;
      tokens.push({ kind: '==', text: '==', position: start });
      continue;
    }
    if (char === '<') {
      if (source[pos + 1] === '=') {
        pos += 2;
        tokens.push({ kind: '<=', text: '<=', position: start });
      } else {
        pos += 1;
        tokens.push({ kind: '<', text: '<', position: start });
      }
      continue;
    }
    if (char === '>') {
      if (source[pos + 1] === '=') {
        pos += 2;
        tokens.push({ kind: '>=', text: '>=', position: start });
      } else {
        pos += 1;
        tokens.push({ kind: '>', text: '>', position: start });
      }
      continue;
    }
    if (char === '&') {
      if (source[pos + 1] !== '&') throw new LexError('"&" is not a valid operator; did you mean "&&"?', start);
      pos += 2;
      tokens.push({ kind: '&&', text: '&&', position: start });
      continue;
    }
    if (char === '|') {
      if (source[pos + 1] !== '|') throw new LexError('"|" is not a valid operator; did you mean "||"?', start);
      pos += 2;
      tokens.push({ kind: '||', text: '||', position: start });
      continue;
    }
    if (char === '"' || char === "'") {
      const quote = char;
      pos += 1;
      let value = '';
      for (;;) {
        // A single read into `next`, checked once: reaching the end of `source` before the closing
        // quote and hitting the closing quote are the loop's only two exits, so this one `undefined`
        // check (not a separate `pos >= source.length` guard) correctly covers both "ran off the end"
        // and "safe to append, definitely a real character" in one place.
        const next = source[pos];
        if (next === undefined) throw new LexError('Unterminated string literal.', start);
        if (next === quote) break;
        value += next;
        pos += 1;
      }
      pos += 1;
      tokens.push({ kind: 'string', text: source.slice(start, pos), value, position: start });
      continue;
    }
    if (isDigit(char)) {
      pos = scanDigits(source, pos);
      const text = source.slice(start, pos);
      tokens.push({ kind: 'number', text, value: Number(text), position: start });
      continue;
    }
    // Unambiguous even without a preceding-token check: `-` has no other meaning anywhere in this
    // grammar (there is no subtraction operator, and `isIdentifierPart`'s own doc comment above already
    // rules out a leading hyphen starting an identifier/path segment), so `-5` is always a negative
    // number literal, never "the previous token, then unary minus, then 5." Only consumed as one when a
    // digit actually follows — a bare trailing `-` (`x -`) still falls through to the final
    // `Unexpected character` throw below, the same as it did before this branch existed.
    if (char === '-' && isDigit(source[pos + 1] ?? '')) {
      pos = scanDigits(source, pos + 1);
      const text = source.slice(start, pos);
      tokens.push({ kind: 'number', text, value: Number(text), position: start });
      continue;
    }
    if (isIdentifierStart(char)) {
      pos += 1;
      while (pos < source.length && isIdentifierPart(source[pos] ?? '')) pos += 1;
      const text = source.slice(start, pos);
      const keyword = KEYWORDS.get(text);
      if (keyword === 'boolean') {
        tokens.push({ kind: 'boolean', text, value: text === 'true', position: start });
      } else if (keyword !== undefined) {
        tokens.push({ kind: keyword, text, position: start });
      } else {
        tokens.push({ kind: 'identifier', text, position: start });
      }
      continue;
    }

    throw new LexError(`Unexpected character "${char}".`, start);
  }

  tokens.push({ kind: 'eof', text: '', position: source.length });
  return tokens;
}
