/**
 * `satisfiesForgeVersionRange`, `parseModuleVersionRange` — `19` §19.1's own `forgeVersion` worked
 * example (`">=1.0 <2"`).
 *
 * @see specs/19 §19.1
 * @see PLAN-M10.md P2
 */
import { describe, expect, it } from 'vitest';

import {
  parseModuleVersionRange,
  satisfiesForgeVersionRange,
} from '../../src/module/version-range.ts';

describe('satisfiesForgeVersionRange', () => {
  it('19 §19.1\'s own worked example: ">=1.0 <2" admits 1.x but not 0.x or 2.x', () => {
    expect(satisfiesForgeVersionRange('1.0.0', '>=1.0 <2')).toBe(true);
    expect(satisfiesForgeVersionRange('1.9.9', '>=1.0 <2')).toBe(true);
    expect(satisfiesForgeVersionRange('0.9.9', '>=1.0 <2')).toBe(false);
    expect(satisfiesForgeVersionRange('2.0.0', '>=1.0 <2')).toBe(false);
  });

  it('treats a bare version as an exact match', () => {
    expect(satisfiesForgeVersionRange('1.2.3', '1.2.3')).toBe(true);
    expect(satisfiesForgeVersionRange('1.2.4', '1.2.3')).toBe(false);
  });

  it('every comparator works standalone', () => {
    expect(satisfiesForgeVersionRange('1.2.3', '>1.2.2')).toBe(true);
    expect(satisfiesForgeVersionRange('1.2.3', '>1.2.3')).toBe(false);
    expect(satisfiesForgeVersionRange('1.2.3', '<1.2.4')).toBe(true);
    expect(satisfiesForgeVersionRange('1.2.3', '<1.2.3')).toBe(false);
    expect(satisfiesForgeVersionRange('1.2.3', '<=1.2.3')).toBe(true);
    expect(satisfiesForgeVersionRange('1.2.3', '=1.2.3')).toBe(true);
  });

  it('a partial version defaults missing components to 0', () => {
    expect(satisfiesForgeVersionRange('2.0.0', '>=2')).toBe(true);
    expect(satisfiesForgeVersionRange('1.9.9', '>=2')).toBe(false);
  });

  it('fails closed on an unparseable range', () => {
    expect(satisfiesForgeVersionRange('1.0.0', 'not-a-range')).toBe(false);
    expect(satisfiesForgeVersionRange('1.0.0', '')).toBe(false);
  });

  it('fails closed on an unparseable version', () => {
    expect(satisfiesForgeVersionRange('not-a-version', '>=1.0 <2')).toBe(false);
  });

  it('parseModuleVersionRange returns undefined for a malformed clause', () => {
    expect(parseModuleVersionRange('>= 1.0')).toBeUndefined(); // no digit immediately after comparator
    expect(parseModuleVersionRange('~1.0')).toBeUndefined(); // unsupported comparator
    expect(parseModuleVersionRange('1.x')).toBeUndefined();
  });

  it('parseModuleVersionRange parses a real multi-clause range into its clauses', () => {
    expect(parseModuleVersionRange('>=1.0 <2')).toEqual([
      { comparator: '>=', version: [1, 0, 0] },
      { comparator: '<', version: [2, 0, 0] },
    ]);
  });
});
