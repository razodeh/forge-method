/**
 * `10` §10.1's own "Expressions" subsection, in full: "A tiny, sandboxed expression language (no
 * `eval`): dotted paths, comparisons, `&&/||/!`, `in`, `length`, and a fixed helper set (`item`,
 * `stage`, `run`, `config`, `kb`, `failures`, `vars`)." That one sentence, plus four concrete example
 * strings across the whole spec pack (`10` §10.3's `"errors > 0"`/`"undefined_refs > 0"`,
 * `"failures.test-failure > 2"`, `15`'s own `"violations > 0"`) — every one of them a bare
 * `<dotted-path> > <number>` comparison — is the entire spec text this piece has to work from. No
 * example anywhere uses `&&`, `||`, `!`, `in`, or `length`. The grammar below (operators, precedence,
 * literal syntax, what `length` takes and returns) is therefore almost entirely this piece's own design,
 * documented at each decision point rather than assumed.
 *
 * @see specs/10 §10.1
 * @see PLAN-M5.md P9
 */

/** A dotted path into an `ExpressionContext` — `failures.test-failure` becomes `['failures',
 * 'test-failure']`. Identifiers may contain hyphens (`test-failure` is the one spec-given example that
 * needs this): with no arithmetic operators anywhere in this language, a bare `-` cannot be confused
 * with subtraction, so nothing is lost by allowing it in identifiers and it directly matches the one
 * real path segment the spec pack shows. */
export interface PathExpr {
  readonly kind: 'path';
  readonly segments: readonly string[];
}

export interface LiteralExpr {
  readonly kind: 'literal';
  readonly value: string | number | boolean;
}

export type ComparisonOperator = '==' | '!=' | '<' | '<=' | '>' | '>=';

export interface ComparisonExpr {
  readonly kind: 'comparison';
  readonly operator: ComparisonOperator;
  readonly left: Expr;
  readonly right: Expr;
}

export type LogicalOperator = '&&' | '||';

export interface LogicalExpr {
  readonly kind: 'logical';
  readonly operator: LogicalOperator;
  readonly left: Expr;
  readonly right: Expr;
}

export interface NotExpr {
  readonly kind: 'not';
  readonly operand: Expr;
}

/** `<value> in <collection>`: `10` §10.1 lists `in` with no worked example anywhere in the spec pack.
 * Modeled as membership-testing `value` against whatever `collection` evaluates to (an array, checked by
 * element; a string, checked by substring; anything else, `false`) — deliberately not requiring an array
 * *literal* grammar of its own (`[a, b, c]`): the one real use this piece can imagine (`role in
 * item.assignees`) already has its collection side reachable as an ordinary path, and adding literal-
 * array syntax with no spec evidence it is ever needed would work against `10` §10.1's own explicit
 * "~300 LOC" budget. */
export interface InExpr {
  readonly kind: 'in';
  readonly value: Expr;
  readonly collection: Expr;
}

/** `length(<expr>)`: `10` §10.1 lists `length` alongside operators, not inside its own "fixed helper
 * set" (`item`/`stage`/`run`/`config`/`kb`/`failures`/`vars` — those are named as root *context* objects,
 * a different kind of thing), which is why this is modeled as a unary, keyword-prefixed call rather than
 * a `.length` postfix property read — nothing in the spec text suggests postfix property access is part
 * of this language at all, only dotted *paths* into the context. */
export interface LengthExpr {
  readonly kind: 'length';
  readonly operand: Expr;
}

export type Expr = LiteralExpr | PathExpr | ComparisonExpr | LogicalExpr | NotExpr | InExpr | LengthExpr;

/** Position of a lex/parse error, as a character offset into the original source string — the
 * "position" `PLAN-M5.md` P9's own Surface text asks a parse error to name. An offset rather than a
 * `{line, column}` pair: unlike `parseWorkflow`'s own workflow *documents* (multi-line YAML files where
 * `02` §2.1 explicitly asks for line/column), an expression is always a single line embedded inside one
 * YAML scalar (`failOn: "errors > 0"`) — a caller that needs to report this against the *surrounding*
 * document's own position already has that document's own line/column from wherever it extracted this
 * expression string, and can add this offset to it; duplicating that arithmetic in here would need this
 * piece to know about a YAML document it has no other reason to depend on. */
export interface ExpressionParseError {
  readonly message: string;
  readonly position: number;
}

/** A discriminated result, not a thrown error — matching `@forge/engine/workflow`'s own established
 * `ParseResult` convention (`parseWorkflow`), not the more literal (but ambiguous between "throws" and
 * "returns") `PLAN-M5.md` P9's own Surface text shows (`parseExpression(source): Expr ... or a typed
 * parse error`). Corrected here for the same reason, and toward the same shape, `Q66`'s `baseSha`
 * addition corrected `enforceClaim`'s own plan-text signature: a caller validating many `failOn`/`when`
 * strings up front (`19`'s own "`failOn` expression parses" check) wants to collect a clear error per
 * expression, not wrap every call in its own `try`/`catch`. */
export type ParseExpressionResult =
  | { readonly success: true; readonly expr: Expr }
  | { readonly success: false; readonly error: ExpressionParseError };

/** The plain object carrying `10` §10.1's own fixed helper set as caller-supplied data — this piece
 * never reads any of these from a real source (a file, a running plan, `globalThis`) itself, only ever
 * receives them as already-resolved values, which is what makes the sandbox guarantee possible: there is
 * no ambient state in here for an expression to reach past what its caller explicitly handed it. */
export interface ExpressionContext {
  readonly item?: unknown;
  readonly stage?: unknown;
  readonly run?: unknown;
  readonly config?: unknown;
  readonly kb?: unknown;
  readonly failures?: unknown;
  readonly vars?: unknown;
}
