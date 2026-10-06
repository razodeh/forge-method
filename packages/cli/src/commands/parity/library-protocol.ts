/**
 * `parseLibraryProbeOutput` — `13` F-TEST-9's library probe protocol: the probe "prints exactly one
 * JSON object on stdout: `{"ok": true, "value": ...}` for a return, or `{"ok": false, "error":
 * {"name": ..., "message": ...}}` for a thrown error... Stdout that is not exactly one such object
 * is `error`, never `match`."
 *
 * **DECISION: no whitespace or a second line is tolerated around the one object.** The spec leaves
 * this open ("this piece's own report" names it explicitly). `stdoutText` arrives already stripped of
 * its single trailing newline (`runConfinedCommand`'s own `preserveRawOutput`, which this piece's
 * caller always sets for a library surface), so what is left is exactly what the probe printed before
 * that one newline. This parser requires the ROUND TRIP `JSON.stringify(JSON.parse(stdoutText)) ===
 * stdoutText` to hold exactly — which, as a side effect, also refuses leading/trailing whitespace
 * around the object (any extra space makes the two strings differ), a second JSON value on another
 * line (a literal `\n` anywhere in `stdoutText` is checked first and rejected outright, since
 * `JSON.parse` on "object\nobject" simply throws anyway, but a clearer, named reason reads better
 * than a generic parse error), a duplicate top-level key (`JSON.parse` resolves it to its LAST
 * occurrence before any key is ever read, which `JSON.stringify` of that single surviving value
 * re-serialises to fewer bytes than the original, failing the round trip), and a number whose value
 * cannot survive an IEEE-754 double round-trip unchanged. This is the identical discipline
 * `capture.ts`'s own `parseCapture` already uses for the identical class of problem (its own doc
 * comment has the fuller reasoning), reused here rather than re-derived.
 *
 * The object's own shape is then checked closed-schema (`declaration.ts`'s `Collector`/`capture.ts`'s
 * `expectKnownKeys` precedent): exactly `{ok, value}` or `{ok, error: {name, message}}`, nothing more
 * — a probe's own thrown error's `stack`, in particular, is never part of the protocol (`13`
 * F-TEST-9: "a stack trace is not part of the protocol, because it carries host paths"), so one
 * present on the error object is an extra, undeclared key and malformed, exactly like any other.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M16.md P3
 */
import type { CanonicalValue } from './canonical-json.ts';
import type { RawLibraryError, RawLibraryResult } from './observe-types.ts';

/**
 * The result of {@link parseLibraryProbeOutput}: either the probe's own one JSON object, typed as a
 * return (`RawLibraryResult`) or a thrown error (`RawLibraryError`), or why its stdout is not
 * exactly one well-formed object at all (`13` F-TEST-9's library probe protocol — "Stdout that is
 * not exactly one such object is `error`, never `match`"). `malformed` is plain data, never a
 * thrown exception: the caller (`observe.ts`) decides what `ForgeError` code that becomes for the
 * one case it belongs to, never aborting every other case's own observation.
 */
export type LibraryProtocolResult =
  | { readonly outcome: 'ok'; readonly result: RawLibraryResult | RawLibraryError }
  | { readonly outcome: 'malformed'; readonly detail: string };

function malformed(detail: string): LibraryProtocolResult {
  return { outcome: 'malformed', detail };
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every JSON value `JSON.parse` can produce is already within {@link CanonicalValue}'s universe
 * (null/boolean/number/string/array/object of the same, never `undefined`, a `function`, a `symbol`
 * or a `bigint`) — this is a pure type-level narrowing with no runtime check of its own, sound
 * because the value already came from `JSON.parse`, never from an arbitrary caller. */
function asCanonicalValue(value: unknown): CanonicalValue {
  return value as CanonicalValue;
}

/**
 * Parses one `library` surface case's stdout (already final-newline-stripped — see this module's
 * own doc comment) against `13` F-TEST-9's library probe protocol: exactly one well-formed
 * `{"ok":true,"value":...}` or `{"ok":false,"error":{"name":...,"message":...}}` JSON object, round
 * -trip-stable and with no other key. This is this module's own one real entry point, called by
 * `observe.ts` once per `library`-surface case.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 */
export function parseLibraryProbeOutput(stdoutText: string): LibraryProtocolResult {
  if (stdoutText === '') {
    return malformed('the probe printed no output on stdout at all.');
  }
  if (stdoutText.includes('\n')) {
    return malformed('the probe printed more than one line on stdout.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdoutText) as unknown;
  } catch (cause) {
    return malformed(
      `stdout is not parseable JSON (${cause instanceof Error ? cause.message : 'unknown error'}).`,
    );
  }
  let reserialised: string;
  try {
    reserialised = JSON.stringify(parsed);
  } catch (cause) {
    return malformed(
      `the parsed value has no JSON representation (${cause instanceof Error ? cause.message : 'unknown error'}).`,
    );
  }
  if (reserialised !== stdoutText) {
    return malformed(
      'stdout does not round-trip through JSON.stringify byte-for-byte (a duplicated key, ' +
        'non-canonical whitespace, or a number that cannot survive the round-trip unchanged), ' +
        'which this protocol refuses rather than guessing which value was meant.',
    );
  }
  if (!isPlainObject(parsed)) {
    return malformed('stdout is valid JSON but not an object (the protocol requires {"ok":...}).');
  }
  const keys = Object.keys(parsed);
  if (parsed['ok'] === true) {
    if (keys.length !== 2 || !keys.includes('value')) {
      return malformed(
        `a {"ok":true,...} object must have exactly the keys "ok" and "value", found ${keys.join(', ')}.`,
      );
    }
    return { outcome: 'ok', result: { ok: true, value: asCanonicalValue(parsed['value']) } };
  }
  if (parsed['ok'] === false) {
    if (keys.length !== 2 || !keys.includes('error')) {
      return malformed(
        `a {"ok":false,...} object must have exactly the keys "ok" and "error", found ${keys.join(', ')}.`,
      );
    }
    const errorValue = parsed['error'];
    if (!isPlainObject(errorValue)) {
      return malformed('"error" must be an object shaped {"name":...,"message":...}.');
    }
    const errorKeys = Object.keys(errorValue);
    if (
      errorKeys.length !== 2 ||
      !errorKeys.includes('name') ||
      !errorKeys.includes('message') ||
      typeof errorValue['name'] !== 'string' ||
      typeof errorValue['message'] !== 'string'
    ) {
      return malformed(
        `"error" must have exactly the string keys "name" and "message" (never "stack"), found ${errorKeys.join(', ')}.`,
      );
    }
    return {
      outcome: 'ok',
      result: {
        ok: false,
        error: { name: errorValue['name'], message: errorValue['message'] },
      },
    };
  }
  return malformed('the object\'s "ok" key must be exactly true or false.');
}
