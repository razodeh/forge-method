/**
 * `toCanonicalJson` (specs/22 M16 P2) — `13` F-TEST-9's canonical form, which the declaration digest
 * and the parity capture both depend on byte-for-byte.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 */
import { describe, expect, it } from 'vitest';

import {
  toCanonicalJson,
  type CanonicalValue,
} from '../../../src/commands/parity/canonical-json.ts';

describe('toCanonicalJson (specs/22 M16 P2)', () => {
  it('sorts object keys at every depth, regardless of input order', () => {
    const a: CanonicalValue = { b: 1, a: { d: 2, c: 3 } };
    const b: CanonicalValue = { a: { c: 3, d: 2 }, b: 1 };
    expect(toCanonicalJson(a)).toBe(toCanonicalJson(b));
    expect(toCanonicalJson(a)).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('keeps array order (never sorted)', () => {
    expect(toCanonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('omits an object member whose value is undefined, rather than writing "undefined" or null', () => {
    expect(toCanonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('produces compact JSON with no insignificant whitespace and no trailing newline', () => {
    const text = toCanonicalJson({ a: [1, 2], b: 'x' });
    expect(text).toBe('{"a":[1,2],"b":"x"}');
    expect(text.endsWith('\n')).toBe(false);
    expect(text).not.toMatch(/\s/);
  });

  it('round-trips a string needing escapes exactly as JSON.stringify would', () => {
    expect(toCanonicalJson('a"b\nc')).toBe(JSON.stringify('a"b\nc'));
  });

  it('refuses NaN rather than silently writing null the way JSON.stringify does', () => {
    expect(() => toCanonicalJson({ a: Number.NaN })).toThrow(TypeError);
    expect(() => toCanonicalJson({ a: Number.NaN })).toThrow(/a.*has no JSON representation/);
  });

  it('refuses Infinity and -Infinity', () => {
    expect(() => toCanonicalJson({ a: Number.POSITIVE_INFINITY })).toThrow(TypeError);
    expect(() => toCanonicalJson({ a: Number.NEGATIVE_INFINITY })).toThrow(TypeError);
  });

  it('refuses a value of a type JSON cannot represent', () => {
    // A function reaches this function only through a deliberately unsound caller — see the type's
    // own doc comment — exercised here via a cast to prove the runtime refusal still holds.
    const notJson = (() => 'x') as unknown as CanonicalValue;
    expect(() => toCanonicalJson(notJson)).toThrow(TypeError);
  });

  it('refuses undefined at the root', () => {
    const notJson = undefined as unknown as CanonicalValue;
    expect(() => toCanonicalJson(notJson)).toThrow(TypeError);
  });

  it('names the exact path of the offending value in the thrown message', () => {
    expect(() => toCanonicalJson({ surfaces: { process: { timeoutMs: Number.NaN } } })).toThrow(
      /surfaces\.process\.timeoutMs/,
    );
  });

  it('renders null, true and false literally', () => {
    expect(toCanonicalJson(null)).toBe('null');
    expect(toCanonicalJson(true)).toBe('true');
    expect(toCanonicalJson(false)).toBe('false');
  });

  it('renders nested arrays and objects together, keys sorted, order preserved within arrays', () => {
    const value: CanonicalValue = { list: [{ z: 1, a: 2 }, 'x', [3, 2, 1]] };
    expect(toCanonicalJson(value)).toBe('{"list":[{"a":2,"z":1},"x",[3,2,1]]}');
  });
});
