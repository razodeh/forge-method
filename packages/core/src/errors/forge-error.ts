/**
 * `ForgeError` — the one error type every FORGE failure uses (`specs/02` §2.6).
 *
 * The class carries no behaviour beyond assembly and rendering: everything that varies by failure
 * lives in the code registry, so a new failure mode is a data row rather than a new subclass. That
 * is what lets a test iterate every code and reject one whose remedy is not actionable.
 *
 * @see specs/02 §2.6
 */
import {
  EXIT_CODES,
  type ErrorDetails,
  type ErrorDetailsFor,
  type ErrorSeverity,
  type ExitCode,
  type ForgeErrorCode,
  errorDefinition,
  isForgeErrorCode,
} from './codes.ts';
import { renderValue } from './render.ts';

/** The serialised form written to the event log. Deliberately without a stack. */
export interface ForgeErrorJson {
  readonly code: ForgeErrorCode;
  readonly severity: ErrorSeverity;
  readonly message: string;
  readonly remedy: string;
  readonly docsUrl: string;
  readonly details: ErrorDetails;
  /** Rendered rather than nested: a cause may be any throwable, including one that will not encode. */
  readonly cause?: string;
}

/** Marks instances for `isForgeError` across duplicate copies of this module. */
const FORGE_ERROR_BRAND = Symbol.for('forge.ForgeError');

/**
 * Renders a cause for display and serialisation.
 *
 * An `Error` is reduced to name and message deliberately: the stack is neither reproducible across
 * machines nor meaningful to anyone who did not write FORGE, and including it buries the remedy.
 */
export function renderCause(cause: unknown): string | undefined {
  if (cause === undefined) return undefined;
  if (cause instanceof Error) return `${cause.name}: ${cause.message}`;
  return renderValue(cause);
}

/**
 * Makes details safe to serialise, preserving as much structure as JSON allows.
 *
 * Without this, `JSON.stringify(error)` throws on a cyclic object or a `bigint` — and details are
 * exactly where a caller attaches the thing that failed, an adapter response or a Node error with a
 * self-referential cause chain. `specs/18` §18.4 makes the event log the durable record of a run, so
 * an error that cannot be written to it is an error that did not happen. This is the same reasoning
 * `render.ts` gives for existing, applied to the serialisation path rather than only the message.
 */
function toEncodableDetails(details: ErrorDetails): ErrorDetails {
  const encodable: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    try {
      // A replacer with a seen-set rather than a bare stringify: an adapter response with a
      // self-referential field would otherwise collapse the *whole* value to a placeholder, taking
      // the status and body a debugger actually wants with it.
      //
      // Cast because TypeScript types `JSON.stringify` as returning `string`, while it returns
      // undefined for a value that encodes to nothing; see the same note in `render.ts`.
      const seen = new WeakSet<object>();
      const encoded = JSON.stringify(value, (_key, entry: unknown) => {
        if (typeof entry === 'bigint') return entry.toString();
        if (typeof entry === 'function') return '<function>';
        if (typeof entry === 'object' && entry !== null) {
          if (seen.has(entry)) return '<circular>';
          seen.add(entry);
        }
        return entry;
      }) as string | undefined;
      encodable[key] =
        encoded === undefined ? renderValue(value) : (JSON.parse(encoded) as unknown);
    } catch {
      encodable[key] = renderValue(value);
    }
  }
  return encodable;
}

/**
 * A FORGE failure: a stable code, the values that produced it, and the next action.
 *
 * @example
 * ```ts
 * throw new ForgeError('GATE-102', { observed: '61%', threshold: '80%' });
 * ```
 */
export class ForgeError<TCode extends ForgeErrorCode = ForgeErrorCode> extends Error {
  override readonly name = 'ForgeError';

  /** Stable identifier, safe to match on in tests, CI and documentation. */
  readonly code: TCode;

  /** How much of the run this ends. */
  readonly severity: ErrorSeverity;

  /** The next action, in the imperative. Never empty — the registry guarantees it. */
  readonly remedy: string;

  /** Where to read more. Derived from the code; see `SPEC-QUESTIONS.md` Q4. */
  readonly docsUrl: string;

  /**
   * The values that produced this failure.
   *
   * Frozen: an error is a record of something that already happened, and a caller that edits one in
   * a catch block turns the event log into fiction. The freeze is shallow — a nested object can
   * still be mutated — which is a deliberate limit, since deep-freezing an adapter response payload
   * would be both expensive and surprising.
   */
  readonly details: ErrorDetails;

  /** Present so `isForgeError` works on a value from a duplicate copy of this module. */
  readonly [FORGE_ERROR_BRAND] = true;

  /**
   * @param code a declared code from the registry
   * @param details the values that code's message declares; a missing key is a compile error
   * @throws {RangeError} if the code is not declared — a FORGE bug, not a user-facing failure
   */
  constructor(code: TCode, details: ErrorDetailsFor<TCode>, options: { cause?: unknown } = {}) {
    const definition = errorDefinition(code);
    super(definition.message(details as never), options);

    this.code = code;
    this.severity = definition.severity;
    this.remedy = definition.remedy;
    this.docsUrl = definition.docsUrl;
    this.details = Object.freeze({ ...details });
  }

  /**
   * The process exit code this failure maps to at the CLI boundary (`specs/02` §2.6).
   *
   * Delegates to `exitCodeFor` so there is exactly one derivation. A getter reading the registry
   * directly is what let a structurally-branded copy of an error yield `undefined` here.
   */
  get exitCode(): ExitCode {
    return exitCodeFor(this);
  }

  /**
   * The form written to `events.ndjson`.
   *
   * No stack: `specs/18` §18.4 makes the event log the durable record of a run, replayed by tooling
   * and read by humans, and a stack is neither reproducible across machines nor useful there.
   */
  toJSON(): ForgeErrorJson {
    const cause = renderCause(this.cause);
    return {
      code: this.code,
      severity: this.severity,
      message: this.message,
      remedy: this.remedy,
      docsUrl: this.docsUrl,
      details: toEncodableDetails(this.details),
      ...(cause === undefined ? {} : { cause }),
    };
  }

  /**
   * Rebuilds an error from a serialised payload.
   *
   * Takes `unknown` because that is what a line of `events.ndjson` is: `QUALITY-BAR.md` R1 names the
   * event log as boundary input, and resume (`specs/02` §2.4) reads failures back out of a file that
   * may be truncated, hand-edited, or written by another version. A typed parameter here would be a
   * claim this function is in no position to make.
   *
   * @throws {RangeError} when the payload is not a recognisable error record. A truncated log needs a
   * diagnosis, not a guess at what it meant.
   */
  static fromJSON(json: unknown): ForgeError {
    if (typeof json !== 'object' || json === null) {
      throw new RangeError(
        `Cannot revive a ForgeError from ${renderValue(json)}: expected an object. ` +
          'The event log line is malformed; run `forge doctor` to check it.',
      );
    }

    const payload = json as { code?: unknown; details?: unknown; cause?: unknown };
    if (!isForgeErrorCode(payload.code)) {
      throw new RangeError(
        `Unknown error code in serialised payload: ${renderValue(payload.code)}. ` +
          'The event log was written by a different FORGE version.',
      );
    }
    // `typeof [] === 'object'`, and an array revives into an error whose every field is missing.
    if (
      typeof payload.details !== 'object' ||
      payload.details === null ||
      Array.isArray(payload.details)
    ) {
      throw new RangeError(
        `Malformed details for ${payload.code}: expected an object, got ${renderValue(payload.details)}.`,
      );
    }

    // Sound because the shape checks above establish everything the constructor needs at runtime —
    // a declared code and an object of details. The compiler cannot narrow a union code to its
    // matching details type, which is exactly the boundary this method exists to cross.
    return new ForgeError(
      payload.code,
      payload.details as ErrorDetailsFor<typeof payload.code>,
      payload.cause === undefined ? {} : { cause: payload.cause },
    );
  }
}

/**
 * Whether `value` is a `ForgeError`.
 *
 * Brand-based rather than `instanceof` so a value from a *duplicate copy of this module* — two
 * versions of `@forge/core` in one dependency tree — is still recognised. It does **not** survive
 * `structuredClone` or `postMessage`: Node's structured-clone algorithm drops symbol-keyed
 * properties and keeps only an `Error`'s name, message and stack. A worker or adapter that needs to
 * send a failure across a process boundary must send `toJSON()` and revive it with `fromJSON`.
 */
export function isForgeError(value: unknown): value is ForgeError {
  return (
    typeof value === 'object' &&
    value !== null &&
    FORGE_ERROR_BRAND in value &&
    (value as Record<symbol, unknown>)[FORGE_ERROR_BRAND] === true
  );
}

/**
 * The process exit code for any thrown value (`specs/02` §2.6).
 *
 * Takes `unknown` because that is what a `catch` binds, and an unrecognised throwable is a generic
 * failure rather than a crash.
 *
 * Re-derives from the code rather than reading an `exitCode` property. A structural copy of an error
 * — `{ ...error, context }`, the ordinary way to add context in a catch block — carries the brand
 * but not the prototype getter, so reading the property returned `undefined`; `process.exit(undefined)`
 * exits **0**, and a failed run reported success.
 */
export function exitCodeFor(error: unknown): ExitCode {
  if (!isForgeError(error)) return EXIT_CODES.failure;
  return isForgeErrorCode(error.code) ? errorDefinition(error.code).exitCode : EXIT_CODES.failure;
}
