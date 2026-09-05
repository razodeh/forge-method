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
  'CFG-003': {
    // `specs/02` §2.5: every write goes through @forge/core/fs, which enforces containment. A path
    // that resolves outside the project root — by traversal, by being absolute, or by a symlink —
    // is a defect in the caller (an artifact ID, a lane path) presenting FORGE with something it
    // must never touch, so this is CFG- (an invalid request), not a runtime I/O failure.
    severity: 'fatal',
    exitCode: EXIT_CODES.usage,
    message: (d: { path: string; root: string }) =>
      `Path escapes the project root: ${show(d.path)} is not inside ${show(d.root)}.`,
    remedy: 'Pass a path relative to the project root, with no leading "/" and no ".." segments.',
  },
  'CFG-004': {
    // Distinct from CFG-003: this path IS inside the project, but names a directory FORGE must
    // never write to directly — `.git/` (VCS owns it), `.forge/state/` (the event log is
    // append-only and owns its own durability), `node_modules/` (package-manager owned). Case
    // folded before comparison: `specs/02` §2.7 makes Windows and macOS's default filesystem both
    // first-class, and both are case-insensitive, so `.Git/config` and `.git/config` are the same
    // file there — a case-sensitive check would let the deny-list be bypassed by capitalisation on
    // exactly the platforms this project is required to support.
    severity: 'fatal',
    exitCode: EXIT_CODES.usage,
    message: (d: { path: string }) =>
      `Path is in a directory FORGE must not write to: ${show(d.path)}.`,
    remedy:
      'Write through the owning subsystem instead: git operations through @forge/vcs, event-log ' +
      "entries through the run's append-only writer, dependencies through the package manager.",
  },
  'RUN-034': {
    // One code for every filesystem operation this module performs (write, read, mkdir, list),
    // parameterised by `operation` rather than split into a code per verb — the failure a caller
    // cares about is "the disk said no", and the underlying OS error survives as `cause` regardless
    // of which call produced it.
    severity: 'error',
    exitCode: EXIT_CODES.failure,
    message: (d: { operation: string; path: string }) =>
      `Filesystem operation "${show(d.operation)}" failed for ${show(d.path)}.`,
    remedy: 'Check the underlying cause (permissions, disk space, a locked file) and retry.',
  },
  'CFG-005': {
    // `PLAN-M1.md` P12: `ArtifactDocument.parse` refuses a file with no front matter at all, rather
    // than treating it as a document with empty front matter — every registered artifact type
    // requires `id`/`type`/... (`18` §18.6), so a file missing the block entirely can never validate
    // regardless, and failing at parse time names the actual defect instead of a confusing pile of
    // "required field missing" errors for every field at once.
    severity: 'fatal',
    exitCode: EXIT_CODES.usage,
    message: (d: { path: string }) =>
      `No front matter found in ${show(d.path)}: the file must start with a "---" line.`,
    remedy: 'Add a YAML front-matter block, delimited by "---" lines, to the top of the file.',
  },
  'CFG-006': {
    severity: 'fatal',
    exitCode: EXIT_CODES.usage,
    message: (d: { path: string }) =>
      `Unterminated front matter in ${show(d.path)}: no closing "---" line found.`,
    remedy: 'Add the closing "---" line after the front-matter block.',
  },
  'CFG-007': {
    severity: 'fatal',
    exitCode: EXIT_CODES.usage,
    message: (d: { path: string; issue: string }) =>
      `Front matter in ${show(d.path)} is not valid YAML: ${show(d.issue)}`,
    remedy: 'Fix the YAML syntax between the "---" delimiters.',
  },
  'CFG-008': {
    // Phase 1 of `18` §18.6's two-phase validation: front matter against the type's schema. Distinct
    // from CFG-007 (which fires before a type is even known, for text that is not YAML at all) — this
    // is well-formed YAML that does not satisfy its declared type's fields.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { path: string; issues: string }) =>
      `Front matter in ${show(d.path)} does not match its schema: ${show(d.issues)}`,
    remedy: 'Fix the listed fields, or correct the "type" if the wrong schema is being applied.',
  },
  'CFG-009': {
    // Phase 2 of `18` §18.6's two-phase validation: body structure against the type's
    // `requiredSections`. Fires once per missing section, not once per document, so a document
    // missing three sections is reported as three findings rather than one that a fix might only
    // partially address.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { path: string; section: string }) =>
      `${show(d.path)} is missing its required "## ${show(d.section)}" section.`,
    remedy: 'Add the missing "## " heading and its content to the document body.',
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
