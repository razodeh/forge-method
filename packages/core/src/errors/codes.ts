/**
 * The FORGE error code registry.
 *
 * `specs/02` §2.6 fixes the prefixes and `specs/22` M1 makes the rule blunt: an error without an
 * actionable remedy fails review. Declaring codes as data rather than scattering literal strings is
 * what makes that checkable — a test iterates this table and rejects a remedy that does not open
 * with an imperative verb, which no amount of review discipline achieves on its own.
 *
 * Each row's `message` declares the details it needs *as a parameter type*, and `ErrorDetailsFor`
 * reads that back. So `new ForgeError('VCS-007', { branch })` is a compile error rather than an
 * error message reading "Merge conflict in lane `<missing>`". Retrofitting that once a few hundred
 * call sites exist is a breaking change; doing it here costs one type.
 *
 * @see specs/02 §2.6
 */
import { DOCS_BASE_URL } from '../constants.ts';

// Every interpolation goes through `show`, never a bare `${d.key}`: a revived log line may be
// missing a key, and a template that interpolates directly renders the literal string "undefined",
// which reads like a FORGE bug rather than a malformed record.
import { renderValue as show } from './render.ts';

/** Code prefix groups from `specs/02` §2.6. This set is closed. */
export type ErrorCodePrefix =
  'CFG' | 'ENV' | 'ADP' | 'VCS' | 'SPEC' | 'KB' | 'GATE' | 'RUN' | 'BUD' | 'USR';

/** The ten prefixes as data, so a test can assert the registry uses no others. */
export const ERROR_CODE_PREFIXES = [
  'CFG',
  'ENV',
  'ADP',
  'VCS',
  'SPEC',
  'KB',
  'GATE',
  'RUN',
  'BUD',
  'USR',
] as const satisfies readonly ErrorCodePrefix[];

/**
 * How much of the run a failure ends.
 *
 * `fatal` stops the run, `error` fails the step that raised it, `warning` is recorded and continues.
 */
export type ErrorSeverity = 'fatal' | 'error' | 'warning';

/**
 * Process exit codes from `specs/02` §2.6.
 *
 * These are a public interface: CI configuration and shell scripts branch on them, so a value may
 * never be reassigned to a different meaning.
 */
export const EXIT_CODES = {
  success: 0,
  failure: 1,
  usage: 2,
  gateFailed: 3,
  budgetExceeded: 4,
  prerequisiteMissing: 5,
  lockHeld: 6,
  interrupted: 130,
} as const;

/** A process exit code FORGE may terminate with. */
export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

/** Structured context attached to one occurrence of an error. */
export type ErrorDetails = Readonly<Record<string, unknown>>;

/** Everything known about one error code, independent of any particular occurrence. */
export interface ErrorDefinition<TDetails extends ErrorDetails = ErrorDetails> {
  /** How much of the run this ends. */
  readonly severity: ErrorSeverity;
  /** The process exit code this maps to when it reaches the CLI boundary. */
  readonly exitCode: ExitCode;
  /**
   * Renders the failure, including the observed values.
   *
   * The parameter type is this code's declaration of what it requires — see the file header. A
   * message that names the expectation without the observation forces the reader to reproduce the
   * failure to learn anything, which is the most common defect in CLI error output.
   */
  readonly message: (details: TDetails) => string;
  /**
   * The next action, in the imperative.
   *
   * Not a restatement of the message. `specs/22` M1: an error without one fails review.
   */
  readonly remedy: string;
}

/**
 * The registry.
 *
 * The `satisfies` constraint enforces both halves of §2.6: a key must carry a declared prefix, and a
 * row must be complete. `ErrorDefinition<never>` is the constraint rather than
 * `ErrorDefinition<ErrorDetails>` because function parameters are contravariant — a row declaring
 * `(d: { path: string })` is assignable to a bottom parameter type, not to a wider one.
 *
 * The examples in `specs/02` §2.6 appear verbatim by code and meaning, so the spec's own
 * illustrations resolve against the implementation.
 */
export const ERROR_CODES = {
  'CFG-001': {
    severity: 'fatal',
    exitCode: EXIT_CODES.usage,
    message: (d: { path: string; line?: number }) =>
      `Invalid configuration in ${show(d.path)} at line ${show(d.line)}.`,
    remedy: 'Run `forge config explain <key>` to see which layer supplied the offending value.',
  },
  'CFG-002': {
    severity: 'fatal',
    exitCode: EXIT_CODES.lockHeld,
    message: (d: { pid: number; host: string }) =>
      `Another FORGE supervisor holds this project: pid ${show(d.pid)} on ${show(d.host)}.`,
    remedy:
      'Stop the other process, or run `forge doctor --reclaim-lock` if it is no longer alive.',
  },
  'ENV-004': {
    severity: 'fatal',
    exitCode: EXIT_CODES.prerequisiteMissing,
    message: (d: { tool: string }) => `Required tool not found on PATH: ${show(d.tool)}.`,
    remedy: 'Install the tool and re-run `forge doctor` to confirm it is discoverable.',
  },
  'ADP-012': {
    severity: 'error',
    exitCode: EXIT_CODES.failure,
    message: (d: { reason: string }) =>
      `Adapter session terminated by the provider: ${show(d.reason)}.`,
    remedy: 'Wait for the rate limit to clear, or set `platform.fallback` to route around it.',
  },
  'VCS-007': {
    severity: 'error',
    exitCode: EXIT_CODES.failure,
    message: (d: { lane: string }) => `Merge conflict in lane ${show(d.lane)}.`,
    remedy: 'Resolve the conflict in the lane worktree, or set `execution.conflictPolicy: human`.',
  },
  'SPEC-021': {
    severity: 'error',
    exitCode: EXIT_CODES.failure,
    message: (d: { artifact: string; expectedParent: string }) =>
      `${show(d.artifact)} has no parent ${show(d.expectedParent)}.`,
    remedy: 'Add the missing parent reference to the artifact front matter, or mark it deprecated.',
  },
  'KB-005': {
    severity: 'error',
    exitCode: EXIT_CODES.failure,
    message: (d: { entry: string; conflictsWith: string }) =>
      `Contradictory knowledge: ${show(d.entry)} conflicts with ${show(d.conflictsWith)}.`,
    remedy: 'Supersede one entry explicitly, or record the contradiction as an open question.',
  },
  'KB-010': {
    // The one warning-severity code. It exists because `specs/08` §8.8 makes staleness a reported
    // condition that does not stop a run — not to give the severity union a third member.
    severity: 'warning',
    exitCode: EXIT_CODES.success,
    message: (d: { entry: string; reviewBy: string }) =>
      `Knowledge entry ${show(d.entry)} passed its review date of ${show(d.reviewBy)}.`,
    remedy: 'Re-verify the entry against the code and update its `verified` date, or supersede it.',
  },
  'GATE-102': {
    severity: 'error',
    exitCode: EXIT_CODES.gateFailed,
    message: (d: { observed: unknown; threshold: unknown }) =>
      `Coverage ${show(d.observed)} is below the threshold ${show(d.threshold)}.`,
    remedy: 'Add tests for the uncovered lines. Lowering the threshold is a review failure.',
  },
  'RUN-033': {
    severity: 'error',
    exitCode: EXIT_CODES.failure,
    message: (d: { step: string; budget: unknown }) =>
      `Step ${show(d.step)} exceeded its wall-clock budget of ${show(d.budget)}.`,
    remedy: 'Raise the step budget, or split the step so each part fits inside it.',
  },
  'BUD-002': {
    severity: 'fatal',
    exitCode: EXIT_CODES.budgetExceeded,
    message: (d: { cap: string; spent?: string }) =>
      `Run exceeded its cost cap of ${show(d.cap)} (spent ${show(d.spent)}).`,
    remedy: 'Raise `budget.perRunUsd`, or resume with a narrower scope.',
  },
  'USR-001': {
    // Exit 130 per `specs/02` §2.6, which assigns it to "interrupted". A deliberate gate rejection
    // and a SIGINT therefore share a code, and CI cannot tell them apart. Recorded in
    // `SPEC-QUESTIONS.md` Q15 rather than quietly improved on, because the spec is explicit.
    severity: 'fatal',
    exitCode: EXIT_CODES.interrupted,
    message: (d: { gate: string }) => `Gate ${show(d.gate)} was rejected by the operator.`,
    remedy: 'Address the reported findings and re-run the gate, or record a waiver with an expiry.',
  },
} as const satisfies Record<`${ErrorCodePrefix}-${string}`, ErrorDefinition<never>>;

/** Every error code FORGE can raise. */
export type ForgeErrorCode = keyof typeof ERROR_CODES;

/**
 * The details a given code requires, read back from its message template.
 *
 * This is what makes a missing or misnamed key a compile error rather than a `<missing>` in the
 * message a user reads.
 */
export type ErrorDetailsFor<TCode extends ForgeErrorCode> = Parameters<
  (typeof ERROR_CODES)[TCode]['message']
>[0];

/** A code's definition, with its identity and documentation link attached. */
export interface ResolvedErrorDefinition {
  readonly code: ForgeErrorCode;
  readonly severity: ErrorSeverity;
  readonly exitCode: ExitCode;
  readonly message: (details: never) => string;
  readonly remedy: string;
  readonly docsUrl: string;
}

/**
 * The documentation link for a code.
 *
 * Derived rather than stored per row; see `SPEC-QUESTIONS.md` Q4.
 */
export function docsUrlFor(code: ForgeErrorCode): string {
  return `${DOCS_BASE_URL}/errors/${code}`;
}

/** Whether `value` is a declared error code. */
export function isForgeErrorCode(value: unknown): value is ForgeErrorCode {
  return typeof value === 'string' && Object.hasOwn(ERROR_CODES, value);
}

/**
 * Looks up a code's definition.
 *
 * The single lookup path, deliberately. Reading `ERROR_CODES[code]` directly elsewhere skips this
 * guard, which is how `exitCodeFor` once returned `undefined` — typed as `ExitCode` — for a value
 * that had already passed `isForgeError`.
 *
 * @throws {RangeError} if the code is not declared. That is a programming error in FORGE itself, not
 * a user-facing failure, so it is deliberately not a `ForgeError`: raising one would need a code for
 * "your error code does not exist", which is a loop.
 */
export function errorDefinition(code: ForgeErrorCode): ResolvedErrorDefinition {
  if (!isForgeErrorCode(code)) {
    throw new RangeError(
      `Unknown error code: ${String(code)}. Add it to ERROR_CODES in @forge/core/errors.`,
    );
  }
  return { ...ERROR_CODES[code], code, docsUrl: docsUrlFor(code) };
}
