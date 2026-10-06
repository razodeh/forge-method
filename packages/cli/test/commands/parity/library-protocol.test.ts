/**
 * `parseLibraryProbeOutput` — `13` F-TEST-9's library probe protocol: "The probe calls the library
 * and prints exactly one JSON object on stdout: `{"ok": true, "value": ...}` for a return, or
 * `{"ok": false, "error": {"name": ..., "message": ...}}` for a thrown error... Stdout that is not
 * exactly one such object is `error`, never `match`."
 *
 * `stdoutText` is assumed already final-newline-stripped (the shape `runConfinedCommand`'s
 * `preserveRawOutput` option already gives this piece) — this module's own job starts from there.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M16.md P3
 */
import { describe, expect, it } from 'vitest';

import { parseLibraryProbeOutput } from '../../../src/commands/parity/library-protocol.ts';

describe('parseLibraryProbeOutput (specs/22 M16 P3)', () => {
  it('parses a well-formed {"ok":true,"value":...} object', () => {
    const result = parseLibraryProbeOutput('{"ok":true,"value":42}');
    expect(result).toEqual({ outcome: 'ok', result: { ok: true, value: 42 } });
  });

  it('parses a well-formed {"ok":false,"error":{...}} object', () => {
    const result = parseLibraryProbeOutput(
      '{"ok":false,"error":{"name":"TypeError","message":"boom"}}',
    );
    expect(result).toEqual({
      outcome: 'ok',
      result: { ok: false, error: { name: 'TypeError', message: 'boom' } },
    });
  });

  it('parses a nested object/array value exactly', () => {
    const value = { a: [1, 2, { b: 'c' }], d: null, e: true };
    const result = parseLibraryProbeOutput(JSON.stringify({ ok: true, value }));
    expect(result).toEqual({ outcome: 'ok', result: { ok: true, value } });
  });

  it('is malformed for empty stdout (no output at all)', () => {
    const result = parseLibraryProbeOutput('');
    expect(result.outcome).toBe('malformed');
  });

  it('is malformed for stdout holding two JSON objects', () => {
    const result = parseLibraryProbeOutput('{"ok":true,"value":1}\n{"ok":true,"value":2}');
    expect(result.outcome).toBe('malformed');
  });

  it('is malformed for stdout that is not valid JSON at all', () => {
    const result = parseLibraryProbeOutput('undefined');
    expect(result.outcome).toBe('malformed');
  });

  it('is malformed for a JSON value that is not an object (an array, a number, a string)', () => {
    expect(parseLibraryProbeOutput('42').outcome).toBe('malformed');
    expect(parseLibraryProbeOutput('[1,2,3]').outcome).toBe('malformed');
    expect(parseLibraryProbeOutput('"hello"').outcome).toBe('malformed');
  });

  it('is malformed for an object with neither ok:true nor ok:false', () => {
    expect(parseLibraryProbeOutput('{"ok":"yes","value":1}').outcome).toBe('malformed');
  });

  it('is malformed for ok:true with no value key at all', () => {
    expect(parseLibraryProbeOutput('{"ok":true}').outcome).toBe('malformed');
  });

  it('is malformed for ok:true with an extra, undeclared key', () => {
    expect(parseLibraryProbeOutput('{"ok":true,"value":1,"extra":2}').outcome).toBe('malformed');
  });

  it('is malformed for ok:false with an error missing "message"', () => {
    expect(parseLibraryProbeOutput('{"ok":false,"error":{"name":"E"}}').outcome).toBe('malformed');
  });

  it('is malformed for ok:false with an extra key on the error object', () => {
    expect(
      parseLibraryProbeOutput('{"ok":false,"error":{"name":"E","message":"m","stack":"at x"}}')
        .outcome,
    ).toBe('malformed');
  });

  it('is malformed for a duplicate top-level key, which JSON.parse silently collapses but the round-trip check catches', () => {
    // `JSON.parse('{"ok":true,"ok":false,"value":1}')` resolves to `{ok:false,value:1}` -- fewer
    // bytes than the original text, so the round-trip comparison fails even though `JSON.parse`
    // itself raised nothing.
    const result = parseLibraryProbeOutput('{"ok":true,"ok":false,"value":1}');
    expect(result.outcome).toBe('malformed');
  });

  it('is malformed for a value that round-trips differently than it was printed (extra whitespace)', () => {
    const result = parseLibraryProbeOutput('{"ok": true, "value": 1}');
    expect(result.outcome).toBe('malformed');
  });

  it('is malformed for a number that loses precision across a JSON round-trip', () => {
    // A 30-digit integer literal: `JSON.parse` reads it as a `number` (IEEE-754 double), and
    // `JSON.stringify` of that double prints a DIFFERENT digit string than the original.
    const original = '{"ok":true,"value":123456789012345678901234567890}';
    const result = parseLibraryProbeOutput(original);
    expect(result.outcome).toBe('malformed');
  });

  it('a thrown error observation never carries a stack -- the protocol itself has no such field, so one present is an extra, undeclared key and malformed', () => {
    const withStack = '{"ok":false,"error":{"name":"Error","message":"m","stack":"trace..."}}';
    expect(parseLibraryProbeOutput(withStack).outcome).toBe('malformed');
  });
});
