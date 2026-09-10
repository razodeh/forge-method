/**
 * `redactPayload` — `PLAN-M5.md` P6's own Checks section, verbatim.
 *
 * @see specs/18 §18.4
 * @see specs/20 §20.4
 * @see PLAN-M5.md P6
 */
import { describe, expect, it } from 'vitest';

import { TelemetryError } from '../src/errors.ts';
import { redactPayload } from '../src/redact.ts';

const API_KEY_PATTERN = /api[_-]?key/i;

describe('redactPayload', () => {
  it('redacts a value whose key matches a pattern', () => {
    const result = redactPayload({ apiKey: 'sk-abc123', other: 'unchanged' }, [API_KEY_PATTERN]);

    expect(result).toEqual({ apiKey: '[REDACTED]', other: 'unchanged' });
  });

  it("matches a key regardless of the pattern's own case sensitivity flag", () => {
    const result = redactPayload({ 'api-key': 'sk-abc123' }, [API_KEY_PATTERN]);

    expect(result).toEqual({ 'api-key': '[REDACTED]' });
  });

  it("redacts a matched key's entire value even when it is a nested object, not just a string", () => {
    const result = redactPayload({ apiKey: { raw: 'sk-abc123', hint: 'sk-***' } }, [
      API_KEY_PATTERN,
    ]);

    expect(result).toEqual({ apiKey: '[REDACTED]' });
  });

  it('recurses into nested objects to find a matching key at any depth', () => {
    const result = redactPayload({ headers: { Authorization: 'Bearer xyz' } }, [/authorization/i]);

    expect(result).toEqual({ headers: { Authorization: '[REDACTED]' } });
  });

  it('recurses into arrays, redacting matching keys inside each element', () => {
    const result = redactPayload(
      [{ apiKey: 'a' }, { apiKey: 'b' }, { safe: 'c' }],
      [API_KEY_PATTERN],
    );

    expect(result).toEqual([{ apiKey: '[REDACTED]' }, { apiKey: '[REDACTED]' }, { safe: 'c' }]);
  });

  it('redacts a string value that exactly equals a known secret, regardless of its key name', () => {
    const result = redactPayload({ innocentLookingField: 'sk-abc123' }, [], ['sk-abc123']);

    expect(result).toEqual({ innocentLookingField: '[REDACTED]' });
  });

  it('does not redact a string that merely contains a known secret as a substring, only an exact match', () => {
    const result = redactPayload({ message: 'token was sk-abc123 in the log' }, [], ['sk-abc123']);

    expect(result).toEqual({ message: 'token was sk-abc123 in the log' });
  });

  it('leaves a value untouched when it matches neither a pattern nor a known secret', () => {
    const payload = { name: 'story-014', count: 3, active: true, tags: null };

    expect(redactPayload(payload, [API_KEY_PATTERN], ['sk-abc123'])).toEqual(payload);
  });

  it('defaults knownSecrets to empty when omitted', () => {
    expect(redactPayload({ value: 'sk-abc123' }, [])).toEqual({ value: 'sk-abc123' });
  });

  it('does not mutate its input payload', () => {
    const payload = { apiKey: 'sk-abc123', nested: { safe: 'value' } };
    const snapshot = structuredClone(payload);

    redactPayload(payload, [API_KEY_PATTERN]);

    expect(payload).toEqual(snapshot);
  });

  it('correctly redacts every matching key even when the pattern carries the global flag', () => {
    // A g-flagged RegExp is stateful across repeated `.test()` calls on the same instance (confirmed
    // empirically: lastIndex advances, causing alternating true/false results) — this payload has two
    // keys that should each independently match, proving the implementation does not fall into that trap.
    const globalPattern = /api[_-]?key/gi;
    const result = redactPayload({ apiKey: 'a', 'api-key': 'b', other: 'c' }, [globalPattern]);

    expect(result).toEqual({ apiKey: '[REDACTED]', 'api-key': '[REDACTED]', other: 'c' });
  });

  it('passes through non-object, non-array, non-string primitives unchanged', () => {
    expect(redactPayload(42, [API_KEY_PATTERN])).toBe(42);
    expect(redactPayload(true, [API_KEY_PATTERN])).toBe(true);
    expect(redactPayload(null, [API_KEY_PATTERN])).toBeNull();
    expect(redactPayload(undefined, [API_KEY_PATTERN])).toBeUndefined();
  });

  it('redacts a top-level string payload matching a known secret', () => {
    expect(redactPayload('sk-abc123', [], ['sk-abc123'])).toBe('[REDACTED]');
  });

  it('preserves a payload key literally named "__proto__" as a normal own, enumerable property, rather than invoking the special prototype setter', () => {
    // JSON.parse creates a real, own, enumerable "__proto__" property for this input (it uses
    // CreateDataProperty internally, not [[Set]]) -- an object literal with a "__proto__" key in source
    // would instead set the prototype at construction time, so this input must come from JSON.parse (or
    // an equivalent) to reproduce the real shape a caller's own JSON-echoed payload would have.
    const payload = JSON.parse('{"__proto__":{"apiKey":"sk-abc123"},"safe":"kept"}') as Record<
      string,
      unknown
    >;

    const result = redactPayload(payload, [API_KEY_PATTERN]) as Record<string, unknown>;

    // The real, internal prototype chain must be untouched -- a bare bracket assignment to the key
    // "__proto__" would silently redirect this instead of creating a normal own property, and the
    // redacted value would vanish from anything (including JSON.stringify) that walks own properties.
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(JSON.stringify(result)).toBe('{"__proto__":{"apiKey":"[REDACTED]"},"safe":"kept"}');
  });

  it('passes a non-plain object (e.g. a Date) through unchanged rather than collapsing it into {}', () => {
    const when = new Date('2026-01-01T00:00:00.000Z');

    const result = redactPayload({ when }, [API_KEY_PATTERN]) as { when: unknown };

    // Same reference, not a rebuilt copy -- a naive `Object.entries`-based walk would accept a Date (it
    // is a non-null, non-array `object`) but find no own enumerable properties to rebuild it from,
    // silently collapsing it to `{}` instead of leaving it alone.
    expect(result.when).toBe(when);
    expect(JSON.stringify(result)).toBe(JSON.stringify({ when }));
  });

  it('throws a TelemetryError for a self-referencing object, rather than crashing with an unhandled RangeError', () => {
    const payload: Record<string, unknown> = { name: 'story-014' };
    payload['self'] = payload;

    let caught: unknown;
    try {
      redactPayload(payload, [API_KEY_PATTERN]);
    } catch (error) {
      caught = error;
    }

    if (!(caught instanceof TelemetryError)) {
      throw new Error(`expected redactPayload to throw a TelemetryError, got ${String(caught)}`);
    }
    expect(caught.code).toBe('TELEMETRY-PAYLOAD-CIRCULAR');
  });

  it('throws a TelemetryError for two objects that mutually reference each other', () => {
    const a: Record<string, unknown> = { name: 'a' };
    const b: Record<string, unknown> = { name: 'b', a };
    a['b'] = b;

    expect(() => redactPayload(a, [API_KEY_PATTERN])).toThrow(
      expect.objectContaining({ code: 'TELEMETRY-PAYLOAD-CIRCULAR' }) as Error,
    );
  });

  it('throws a TelemetryError for a self-referencing array', () => {
    const payload: unknown[] = ['a'];
    payload.push(payload);

    expect(() => redactPayload(payload, [API_KEY_PATTERN])).toThrow(
      expect.objectContaining({ code: 'TELEMETRY-PAYLOAD-CIRCULAR' }) as Error,
    );
  });

  it('does not falsely reject two independent fields that merely share one reference, which is not a cycle', () => {
    const shared = { apiKey: 'sk-abc123' };

    const result = redactPayload({ a: shared, b: shared }, [API_KEY_PATTERN]) as {
      a: unknown;
      b: unknown;
    };

    expect(result).toEqual({ a: { apiKey: '[REDACTED]' }, b: { apiKey: '[REDACTED]' } });
  });
});
