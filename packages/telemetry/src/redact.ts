/**
 * `redactPayload` — the payload half of `20` §20.4's redactor ("runs on every event payload... before
 * serialisation, using both the configured patterns and the known values of resolved secrets"). A pure
 * function: walks a structured, JSON-shaped value and returns a new one with matches replaced, never
 * mutating its input.
 *
 * Two independent checks, both real requirements: `patterns` match against *key names* (the shape of
 * `18` §18.3's own worked example — `api[_-]?key`, `authorization` — are words you'd expect to see as a
 * field name, not appear literally inside a secret value), redacting that key's entire value regardless
 * of its own shape; `knownSecrets` match against *string values* by exact equality, wherever they appear,
 * regardless of the key they're under — a resolved secret can leak through an innocuously-named field a
 * pattern would never catch.
 *
 * @see specs/18 §18.4
 * @see specs/20 §20.4
 * @see PLAN-M5.md P6
 */
import { TelemetryError } from './errors.ts';

const REDACTED_MARKER = '[REDACTED]';

/** A caller-supplied pattern may carry the `g` (or `y`) flag — confirmed empirically that repeated
 * `RegExp.prototype.test` calls on a `g`-flagged pattern are genuinely stateful (`lastIndex` advances
 * between calls), silently alternating true/false for the *same* matching string across the multiple
 * keys a real payload walk tests one pattern against. Constructing a fresh, flagless-of-that-problem
 * `RegExp` per test sidesteps `lastIndex` state entirely, regardless of what flags the caller's own
 * pattern happens to carry. */
function matchesAnyPattern(key: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => new RegExp(pattern.source, pattern.flags).test(key));
}

/** Confirmed empirically that a bare `object`/`null`/`Array.isArray` check is too loose: it also accepts
 * a `Date` (or anything else relying on a custom `toJSON`, or a `RegExp`/`Map`/class instance), which
 * has no *own* enumerable properties for `Object.entries` to walk — rebuilding it key-by-key below would
 * silently collapse it to `{}`, destroying data plain `JSON.stringify` would have serialised correctly.
 * A payload's own object literals, and anything `JSON.parse` ever produces when reading this data back,
 * both have `Object.prototype` (or `null`, for one built via `Object.create(null)`) as their own
 * prototype — checking that specifically is what distinguishes a genuine plain object worth recursing
 * into from anything else, which is treated as an opaque leaf value instead, the same as a string or
 * number. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Confirmed empirically that a payload with a self- or mutually-referencing object (`obj.self = obj`,
 * or two objects each referencing the other) crashes the recursion below with an unhandled `RangeError:
 * Maximum call stack size exceeded` rather than a clear, actionable error — a realistic shape for a
 * caller passing a live object graph (an error with a back-reference, a cache/session object) rather
 * than pre-sanitised JSON-safe data, per this package's own "adapter/MCP-echoed JSON" threat model (`20`
 * §20.5). `appendEvent`'s own later `JSON.stringify` could never represent a cycle either way, so this
 * fails fast with a typed error the moment a cycle is actually detected, rather than merely moving the
 * same crash a little further down the call stack. `ancestors` tracks only the current recursion path,
 * not every object visited overall — two independent fields legitimately sharing one reference (`{a:
 * shared, b: shared}`) is not a cycle and must not be rejected as one. */
function assertNotCircular(value: object, ancestors: ReadonlySet<object>): void {
  if (ancestors.has(value)) {
    throw new TelemetryError({
      code: 'TELEMETRY-PAYLOAD-CIRCULAR',
      message: 'Cannot redact an event payload containing a circular reference.',
      remedy:
        'Ensure the event payload is plain, JSON-serialisable data with no self- or mutually-referencing objects.',
    });
  }
}

function redactValue(
  value: unknown,
  patterns: readonly RegExp[],
  knownSecrets: readonly string[],
  ancestors: ReadonlySet<object>,
): unknown {
  if (typeof value === 'string') {
    return knownSecrets.includes(value) ? REDACTED_MARKER : value;
  }
  if (Array.isArray(value)) {
    assertNotCircular(value, ancestors);
    const nextAncestors = new Set(ancestors).add(value);
    return value.map((entry: unknown) => redactValue(entry, patterns, knownSecrets, nextAncestors));
  }
  if (isPlainObject(value)) {
    assertNotCircular(value, ancestors);
    const nextAncestors = new Set(ancestors).add(value);
    const result: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value)) {
      // Not a bare `result[key] = ...`: confirmed empirically that plain bracket assignment on a key
      // literally named `__proto__` invokes `Object.prototype`'s own special setter instead of creating
      // a normal own property, silently dropping the entire key (and, worse, whatever it was set to)
      // from the object `JSON.stringify` ever sees — an over-redaction that destroys data with no error,
      // for a key shape that is realistic here (JSON.parse produces a real, own, enumerable `__proto__`
      // property for exactly this input, and this package's own payloads can be adapter/MCP-echoed JSON
      // per `20` §20.5's threat model). `Object.defineProperty` always creates a normal own property
      // regardless of the key's name.
      Object.defineProperty(result, key, {
        value: matchesAnyPattern(key, patterns)
          ? REDACTED_MARKER
          : redactValue(entryValue, patterns, knownSecrets, nextAncestors),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return result;
  }
  return value;
}

/** `knownSecrets` defaults empty since full `${secret:name}` resolution (`20` §20.4) is not yet built
 * anywhere in the dependency graph this piece can reach (`SPEC-QUESTIONS.md` Q62) — the parameter exists
 * so a future caller that *does* have resolved secret values can pass them in without this function's
 * own shape changing. */
export function redactPayload(
  payload: unknown,
  patterns: readonly RegExp[],
  knownSecrets: readonly string[] = [],
): unknown {
  return redactValue(payload, patterns, knownSecrets, new Set());
}
