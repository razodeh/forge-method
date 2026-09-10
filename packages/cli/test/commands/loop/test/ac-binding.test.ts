/**
 * `extractAcId` — `PLAN-M8.md` P3's own Checks section.
 *
 * @see specs/09 §9.5
 * @see PLAN-M8.md P3
 */
import { describe, expect, it } from 'vitest';

import { extractAcId } from '../../../../src/commands/loop/test/ac-binding.ts';

describe('extractAcId', () => {
  it('extracts the canonical hyphenated form from a real JS/TS test name', () => {
    expect(extractAcId('AC-014-2 returns 422 for an empty invoice')).toBe('AC-014-2');
  });

  it('extracts a 4-digit AC number too', () => {
    expect(extractAcId('AC-0140-2 returns 422 for an empty invoice')).toBe('AC-0140-2');
  });

  it('returns undefined for a name with no AC prefix at all', () => {
    expect(extractAcId('a plain test with no AC prefix')).toBeUndefined();
  });

  it('extracts the underscore-separated form a real Python test function name uses, converted to hyphenated', () => {
    // A real pytest function name cannot contain a hyphen at all (confirmed directly against a real
    // pytest run during this piece's own build) — `test_AC_014_2_returns_422_for_empty_invoice` is
    // the real, idiomatic Python-safe shape.
    expect(extractAcId('test_AC_014_2_returns_422_for_empty_invoice')).toBe('AC-014-2');
  });

  it('prefers the hyphenated form when both could technically match', () => {
    expect(extractAcId('AC-014-2 vs test_AC_099_9')).toBe('AC-014-2');
  });

  it('returns undefined for an AC-shaped token missing its final numeric segment', () => {
    expect(extractAcId('AC-014 is not a complete id')).toBeUndefined();
  });
});
