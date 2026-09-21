/**
 * `@forge/engine/expr` — `10` §10.1's tiny, sandboxed expression language: parsing, evaluation, and the
 * `{{...}}` template substitution built on both.
 *
 * @see specs/10 §10.1
 * @see PLAN-M5.md P9
 */
export { evaluate } from './evaluate.ts';
export { parseExpression } from './parse.ts';
export {
  resolveTemplate,
  shellQuoteValue,
  type ResolveTemplateOptions,
  type ShellQuoteContext,
} from './template.ts';
export {
  type ComparisonExpr,
  type ComparisonOperator,
  type Expr,
  type ExpressionContext,
  type ExpressionParseError,
  type InExpr,
  type LengthExpr,
  type LiteralExpr,
  type LogicalExpr,
  type LogicalOperator,
  type NotExpr,
  type ParseExpressionResult,
  type PathExpr,
} from './types.ts';
