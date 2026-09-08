/**
 * A small, local expression evaluator for `11` §11.0's own `rules[].if` grammar — `02` §2.2's own
 * boundary graph gives `@forge/methods` no `engine` edge at all (`methods ← core, kb, schemas` only,
 * confirmed directly against `tools/eslint-plugin-forge-boundaries/src/graph.mjs`), so this package
 * cannot import `@forge/engine/expr`'s own, much richer evaluator. The identical "duplicate a small
 * helper rather than force a cross-cutting dependency" precedent M5 itself already established
 * repeatedly (P16's own `seededHash`, P15's own `createTempRepo`) — not a design gap, a deliberate,
 * bounded scope: every worked example `11`-`14` actually use is a dotted-path field access, an
 * optional comparison against a literal, and boolean combination — nothing this package's own real
 * framework content needs requires more than that.
 *
 * @see specs/11 §11.0
 * @see PLAN-M6.md M1
 */

export type ExprLiteral = string | number | boolean;

export type Expr =
  | { readonly kind: 'path'; readonly segments: readonly string[] }
  | { readonly kind: 'literal'; readonly value: ExprLiteral }
  | {
      readonly kind: 'compare';
      readonly op: '==' | '!=' | '<' | '<=' | '>' | '>=';
      readonly left: Expr;
      readonly right: Expr;
    }
  | { readonly kind: 'not'; readonly operand: Expr }
  | { readonly kind: 'and'; readonly left: Expr; readonly right: Expr }
  | { readonly kind: 'or'; readonly left: Expr; readonly right: Expr };

const TOKEN_PATTERN =
  /\s*(==|!=|<=|>=|&&|\|\||[<>!()]|"[^"]*"|'[^']*'|-?\d+(?:\.\d+)?|true|false|[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)/g;

function tokenize(source: string): readonly string[] {
  const tokens: string[] = [];
  let match;
  let consumed = 0;
  TOKEN_PATTERN.lastIndex = 0;
  while ((match = TOKEN_PATTERN.exec(source)) !== null) {
    if (match.index !== consumed)
      throw new Error(`unexpected character at offset ${String(consumed)}`);
    tokens.push(match[1] ?? '');
    consumed = TOKEN_PATTERN.lastIndex;
  }
  if (source.slice(consumed).trim().length > 0)
    throw new Error(`unexpected trailing content at offset ${String(consumed)}`);
  return tokens;
}

class TokenStream {
  private index = 0;
  private readonly tokens: readonly string[];

  constructor(tokens: readonly string[]) {
    this.tokens = tokens;
  }

  peek(): string | undefined {
    return this.tokens[this.index];
  }

  next(): string {
    const token = this.tokens[this.index];
    if (token === undefined) throw new Error('unexpected end of expression');
    this.index += 1;
    return token;
  }

  atEnd(): boolean {
    return this.index >= this.tokens.length;
  }
}

function parseLiteralOrPath(token: string): Expr {
  if (token === 'true' || token === 'false') return { kind: 'literal', value: token === 'true' };
  if (token.startsWith('"') || token.startsWith("'")) {
    return { kind: 'literal', value: token.slice(1, -1) };
  }
  const asNumber = Number(token);
  if (!Number.isNaN(asNumber) && /^-?\d+(?:\.\d+)?$/.test(token)) {
    return { kind: 'literal', value: asNumber };
  }
  return { kind: 'path', segments: token.split('.') };
}

type CompareOp = '==' | '!=' | '<' | '<=' | '>' | '>=';
const COMPARE_OPS = new Set<string>(['==', '!=', '<', '<=', '>', '>=']);
function isCompareOp(value: string): value is CompareOp {
  return COMPARE_OPS.has(value);
}

function parseComparison(stream: TokenStream): Expr {
  const token = stream.next();
  let left: Expr;
  if (token === '(') {
    left = parseOr(stream);
    const closing = stream.next();
    if (closing !== ')') throw new Error(`expected ")", got "${closing}"`);
  } else {
    left = parseLiteralOrPath(token);
  }
  const op = stream.peek();
  if (op !== undefined && isCompareOp(op)) {
    stream.next();
    const rightToken = stream.next();
    let right: Expr;
    if (rightToken === '(') {
      right = parseOr(stream);
      const closing = stream.next();
      if (closing !== ')') throw new Error(`expected ")", got "${closing}"`);
    } else {
      right = parseLiteralOrPath(rightToken);
    }
    return { kind: 'compare', op, left, right };
  }
  return left;
}

/** `!` binds looser than `==`/`&lt;`/etc: `"!a == b"` parses as `!(a == b)`, not `(!a) == b`. No
 * worked example in `11`-`14` combines `!` with a comparison, so this is a deliberate, documented
 * choice rather than a spec requirement either way. */
function parseNot(stream: TokenStream): Expr {
  if (stream.peek() === '!') {
    stream.next();
    return { kind: 'not', operand: parseNot(stream) };
  }
  return parseComparison(stream);
}

function parseAnd(stream: TokenStream): Expr {
  let left = parseNot(stream);
  while (stream.peek() === '&&') {
    stream.next();
    left = { kind: 'and', left, right: parseNot(stream) };
  }
  return left;
}

function parseOr(stream: TokenStream): Expr {
  let left = parseAnd(stream);
  while (stream.peek() === '||') {
    stream.next();
    left = { kind: 'or', left, right: parseAnd(stream) };
  }
  return left;
}

/** Parses `source` into an `Expr`, or returns `undefined` for anything malformed — never throws, so a
 * caller validating many framework `rules[].if` strings at once (`schema.ts`) can report every bad one
 * rather than stopping at the first. */
export function parseExpression(source: string): Expr | undefined {
  try {
    const tokens = tokenize(source);
    if (tokens.length === 0) return undefined;
    const stream = new TokenStream(tokens);
    const expr = parseOr(stream);
    if (!stream.atEnd()) return undefined;
    return expr;
  } catch {
    return undefined;
  }
}

function readPath(
  segments: readonly string[],
  context: Readonly<Record<string, unknown>>,
): unknown {
  let current: unknown = context;
  for (const segment of segments) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Evaluates an already-parsed `Expr` against `context` (the framework's own resolved
 * `inputs.derived` values plus any raw KB/artifact-derived fields a caller supplies). A bare path with
 * no comparison evaluates as a truthy check on its own resolved value, matching `11` §11.0's own
 * `regulatory.code_isolation_required` worked example (a rule condition with no `==` at all). */
export function evaluateExpression(
  expr: Expr,
  context: Readonly<Record<string, unknown>>,
): unknown {
  switch (expr.kind) {
    case 'literal':
      return expr.value;
    case 'path':
      return readPath(expr.segments, context);
    case 'not':
      return !evaluateExpression(expr.operand, context);
    case 'and':
      return (
        Boolean(evaluateExpression(expr.left, context)) &&
        Boolean(evaluateExpression(expr.right, context))
      );
    case 'or':
      return (
        Boolean(evaluateExpression(expr.left, context)) ||
        Boolean(evaluateExpression(expr.right, context))
      );
    case 'compare': {
      const left = evaluateExpression(expr.left, context);
      const right = evaluateExpression(expr.right, context);
      switch (expr.op) {
        case '==':
          return left === right;
        case '!=':
          return left !== right;
        case '<':
          return typeof left === 'number' && typeof right === 'number' && left < right;
        case '<=':
          return typeof left === 'number' && typeof right === 'number' && left <= right;
        case '>':
          return typeof left === 'number' && typeof right === 'number' && left > right;
        case '>=':
          return typeof left === 'number' && typeof right === 'number' && left >= right;
      }
    }
  }
}

/** Truthy-evaluates `source` against `context` — the one thing `applyRules` (`score.ts`) actually
 * needs; a malformed expression (should be unreachable past `loadFramework`'s own load-time validation)
 * evaluates falsy rather than throwing, the same defensive-but-documented stance this whole codebase
 * takes for "provably unreachable given an earlier validation pass." */
export function evaluateCondition(
  source: string,
  context: Readonly<Record<string, unknown>>,
): boolean {
  const expr = parseExpression(source);
  if (expr === undefined) return false;
  return Boolean(evaluateExpression(expr, context));
}
