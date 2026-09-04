/**
 * `@forge/core/errors` — the error taxonomy.
 *
 * A subpath because `PLAN-M1.md` names it, and because consumers that only raise errors should not
 * pull the rest of the domain model into their import graph.
 *
 * @see specs/02 §2.6
 */
export {
  ERROR_CODES,
  ERROR_CODE_PREFIXES,
  EXIT_CODES,
  docsUrlFor,
  errorDefinition,
  isForgeErrorCode,
  type ErrorCodePrefix,
  type ErrorDefinition,
  type ErrorDetails,
  type ErrorDetailsFor,
  type ErrorSeverity,
  type ExitCode,
  type ForgeErrorCode,
  type ResolvedErrorDefinition,
} from './codes.ts';
export {
  ForgeError,
  exitCodeFor,
  isForgeError,
  renderCause,
  type ForgeErrorJson,
} from './forge-error.ts';
export { formatForTerminal, type FormatOptions } from './format.ts';
export { renderValue } from './render.ts';
